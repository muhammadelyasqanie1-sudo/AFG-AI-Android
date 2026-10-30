/* AFG AI · conversation list, search, local persistence and cloud sync */

import {
  $,
  $$,
  bus,
  debounce,
  escapeHtml,
  findLocalConversation,
  getToken,
  loadConversations,
  removeLocalConversation,
  upsertLocalConversation
} from "./core.js";
import { api } from "./api.js";
import { t } from "./i18n.js";
import { plainPreview } from "./markdown.js";
import { confirmDialog, toast } from "./ui.js";

const state = {
  list: [],
  remote: [],
  activeId: null,
  query: ""
};

const syncTimers = new Map();

function merged() {
  const ids = new Set(state.list.map((conversation) => conversation.id));
  const remoteOnly = state.remote.filter((conversation) => !ids.has(conversation.id));
  return [...state.list, ...remoteOnly].sort((a, b) =>
    String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))
  );
}

function matches(conversation, query) {
  if (!query) return true;
  const haystack = [
    conversation.title,
    ...(Array.isArray(conversation.messages)
      ? conversation.messages.slice(-4).map((message) => plainPreview(message.content, 400))
      : [])
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

export function refreshConversationList() {
  state.list = loadConversations();
  render();
}

export function render() {
  const container = $("#recentChats");
  const count = $("#conversationCount");
  if (!container) return;
  const all = merged();
  if (count) count.textContent = String(all.length);

  const query = state.query.trim().toLowerCase();
  const visible = all.filter((conversation) => matches(conversation, query));
  container.innerHTML = "";

  if (!visible.length) {
    const empty = document.createElement("div");
    empty.className = "empty-list";
    empty.textContent = query ? t("noSearchResults") : t("noChats");
    container.appendChild(empty);
    return;
  }

  for (const conversation of visible) {
    const item = document.createElement("div");
    item.className = "recent-item";
    item.dataset.id = conversation.id;
    item.setAttribute("role", "button");
    item.setAttribute("tabindex", "0");
    item.setAttribute("aria-current", conversation.id === state.activeId ? "true" : "false");
    item.innerHTML = `
      <span class="recent-dot" aria-hidden="true"></span>
      <span class="recent-title">${escapeHtml(
        conversation.title || t("conversationUntitled")
      )}</span>
      <button class="recent-delete" type="button" data-delete="${escapeHtml(
        conversation.id
      )}" aria-label="${escapeHtml(t("deleteChat"))}">×</button>`;
    container.appendChild(item);
  }
}

export function setActiveConversation(id) {
  state.activeId = id || null;
  render();
}

export function setSearchQuery(value) {
  state.query = String(value || "");
  render();
}

/* ------------------------------- Persistence ------------------------------ */
function scheduleServerSave(conversation) {
  if (!getToken()) return;
  const previous = syncTimers.get(conversation.id);
  if (previous) clearTimeout(previous);
  syncTimers.set(
    conversation.id,
    setTimeout(async () => {
      syncTimers.delete(conversation.id);
      try {
        await api.saveConversation(conversation);
      } catch (error) {
        // Offline or a guest-owned server copy: the local copy still stands.
        if (error?.status === 401) {
          bus.emit("auth:expired");
        }
      }
    }, 900)
  );
}

export function saveConversation(conversation) {
  if (!conversation || !conversation.id) return conversation;
  const next = {
    ...conversation,
    title: String(conversation.title || t("conversationUntitled")).slice(0, 90),
    updatedAt: conversation.updatedAt || new Date().toISOString()
  };
  upsertLocalConversation(next);
  scheduleServerSave(next);
  return next;
}

export async function deleteConversation(id) {
  const confirmed = await confirmDialog({
    title: t("deleteChat"),
    message: t("deleteConfirm"),
    confirmLabel: t("remove")
  });
  if (!confirmed) return false;
  removeLocalConversation(id);
  state.remote = state.remote.filter((conversation) => conversation.id !== id);
  if (getToken()) api.deleteConversation(id).catch(() => {});
  if (state.activeId === id) {
    state.activeId = null;
    bus.emit("conversation:new");
  }
  toast(t("conversationDeleted"), { type: "success" });
  render();
  return true;
}

function normalizeRemote(conversation) {
  if (!conversation || typeof conversation.id !== "string") return null;
  return {
    ...conversation,
    title: String(conversation.title || t("conversationUntitled")).slice(0, 90),
    mode: ["chat", "research", "coding", "study", "creative"].includes(conversation.mode)
      ? conversation.mode
      : "chat",
    model: typeof conversation.model === "string" ? conversation.model : "auto",
    messages: Array.isArray(conversation.messages)
      ? conversation.messages.map((message) => ({
          ...message,
          id: message.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          sources: Array.isArray(message.sources) ? message.sources : []
        }))
      : [],
    updatedAt: conversation.updatedAt || new Date().toISOString()
  };
}

export async function refreshServerConversations() {
  if (!getToken()) {
    state.remote = [];
    render();
    return;
  }
  try {
    const data = await api.listConversations();
    state.remote = Array.isArray(data?.conversations) ? data.conversations : [];
    render();
  } catch {
    state.remote = [];
    render();
  }
}

export async function openConversation(id) {
  if (!id) return;
  let conversation = findLocalConversation(id);
  if (!conversation) {
    try {
      const data = await api.getConversation(id);
      conversation = normalizeRemote(data?.conversation);
      if (conversation) upsertLocalConversation(conversation);
    } catch (error) {
      toast(error?.status === 404 ? t("conversationDeleted") : t("errorNetwork"), {
        type: "error"
      });
      return;
    }
  }
  if (!conversation) return;
  state.activeId = conversation.id;
  render();
  bus.emit("conversation:open", conversation);
  bus.emit("sidebar:close");
}

/* ---------------------------------- Init ---------------------------------- */
export function initConversations() {
  state.list = loadConversations();
  render();

  const search = $("#chatSearch");
  const runSearch = debounce((value) => setSearchQuery(value), 140);
  search?.addEventListener("input", () => runSearch(search.value));

  for (const button of [$("#newChatBtn"), $("#brandHome")]) {
    button?.addEventListener("click", (event) => {
      event.preventDefault();
      bus.emit("conversation:new");
      bus.emit("sidebar:close");
    });
  }

  for (const button of $$("[data-mode]")) {
    button.addEventListener("click", () => {
      const mode = button.dataset.mode;
      if (!mode) return;
      bus.emit("mode:set", mode);
      bus.emit("sidebar:close");
    });
  }

  $("#recentChats")?.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-delete]");
    if (remove) {
      event.stopPropagation();
      deleteConversation(remove.dataset.delete);
      return;
    }
    const item = event.target.closest(".recent-item");
    if (item?.dataset.id) openConversation(item.dataset.id);
  });

  $("#recentChats")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const item = event.target.closest(".recent-item");
    if (!item || event.target.closest("[data-delete]")) return;
    event.preventDefault();
    openConversation(item.dataset.id);
  });

  bus.on("conversations:changed", () => {
    state.list = loadConversations();
    // A deleted active conversation should not keep a stale highlight.
    if (state.activeId && !state.list.some((entry) => entry.id === state.activeId)) {
      const remoteExists = state.remote.some((entry) => entry.id === state.activeId);
      if (!remoteExists) state.activeId = null;
    }
    render();
  });

  bus.on("conversation:active", (id) => setActiveConversation(id));
  bus.on("language", () => render());
  bus.on("auth:changed", () => {
    if (getToken()) refreshServerConversations();
    else {
      state.remote = [];
      render();
    }
  });

  if (getToken()) refreshServerConversations();
}
