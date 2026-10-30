/* AFG AI · conversation engine: sending, streaming, actions and rendering */

import {
  $,
  $$,
  bus,
  escapeHtml,
  formatClock,
  getPrefs,
  uid,
  updatePrefs
} from "./core.js";
import { api, streamChat } from "./api.js";
import { modeCaption, t } from "./i18n.js";
import { renderMarkdown } from "./markdown.js";
import {
  buildUserContent,
  consumeAttachment,
  getAttachment
} from "./attachments.js";
import {
  getSelectedModel,
  modelDisplayName
} from "./models.js";
import { saveConversation } from "./conversations.js";
import { copyText, nearBottom, scrollToBottom, setConnection, toast } from "./ui.js";

const MODES = ["chat", "research", "coding", "study", "creative"];
const MODE_CAPTIONS = {
  chat: "modeCaptionChat",
  research: "modeCaptionResearch",
  coding: "modeCaptionCoding",
  study: "modeCaptionStudy",
  creative: "modeCaptionCreative"
};
const SUGGESTION_MODES = {
  learn: "study",
  build: "chat",
  code: "coding",
  create: "creative"
};
const ERROR_KEYS = {
  network: "errorNetwork",
  timeout: "errorTimeout",
  rate_limited: "errorRateLimit",
  no_models: "errorNoModels",
  no_model_eligible: "errorNoEligible",
  vision_unsupported: "errorVision",
  no_search_results: "errorSearch",
  image_unconfigured: "errorImageConfig",
  model_unavailable: "errorModelGone",
  empty_message: "promptRequired"
};

const state = {
  conversation: null,
  busy: false,
  controller: null,
  mode: "chat",
  autoScroll: true,
  runId: 0
};

const els = {};

/* -------------------------------- Utilities ------------------------------- */
function nowIso() {
  return new Date().toISOString();
}

function titleFrom(text) {
  const plain = String(text || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/[#*_>`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return (plain || t("conversationUntitled")).slice(0, 64);
}

function makeMessage(role, content, extra = {}) {
  return {
    id: uid(),
    role,
    content: String(content || ""),
    model: null,
    sources: [],
    createdAt: nowIso(),
    ...extra
  };
}

function normalizeConversation(value) {
  if (!value || typeof value.id !== "string") return null;
  return {
    ...value,
    title: String(value.title || t("conversationUntitled")).slice(0, 90),
    mode: MODES.includes(value.mode) ? value.mode : "chat",
    model: typeof value.model === "string" ? value.model : "auto",
    createdAt: value.createdAt || nowIso(),
    updatedAt: value.updatedAt || nowIso(),
    messages: (Array.isArray(value.messages) ? value.messages : []).map((message) => ({
      ...message,
      id: message.id || uid(),
      content: String(message.content || ""),
      sources: Array.isArray(message.sources) ? message.sources : [],
      createdAt: message.createdAt || nowIso()
    }))
  };
}

function friendlyError(error) {
  const key = ERROR_KEYS[error?.code];
  if (key) return t(key);
  if (error?.status === 429) return t("errorRateLimit");
  return t("errorGeneric");
}

function safeImageUrl(url) {
  const value = String(url || "");
  return /^(https?:\/\/|data:image\/)/i.test(value) ? value : "";
}

export function getActiveConversation() {
  return state.conversation;
}

/* --------------------------------- Header --------------------------------- */
function setHeaderTitle(title, custom = false) {
  const node = els.title;
  if (!node) return;
  const value = title || t("newChat");
  node.textContent = value;
  if (custom) node.removeAttribute("data-i18n");
  else node.setAttribute("data-i18n", "newChat");
  document.title = custom ? `${value} · AFG AI` : "AFG AI — Advanced AI Platform";
}

/* ---------------------------------- Mode ---------------------------------- */
export function setMode(mode, { persist = true } = {}) {
  if (!MODES.includes(mode)) return;
  state.mode = mode;
  if (persist) updatePrefs({ mode });
  for (const button of $$("[data-mode]")) {
    button.classList.toggle("is-active", button.dataset.mode === mode);
  }
  if (els.modeCaption) {
    els.modeCaption.dataset.i18n = MODE_CAPTIONS[mode];
    els.modeCaption.textContent = modeCaption(mode);
  }
  bus.emit("mode", mode);
}

/* -------------------------------- Rendering ------------------------------- */
function sourceChips(sources) {
  if (!Array.isArray(sources) || !sources.length) return "";
  return sources
    .slice(0, 10)
    .map((source, index) => {
      const url = /^https?:\/\//i.test(source?.url || "") ? source.url : "";
      if (!url) return "";
      let label = String(source.title || "").trim();
      if (!label) {
        try {
          label = new URL(url).hostname;
        } catch {
          label = url;
        }
      }
      return `<a class="source-chip" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"><span class="source-index">${
        index + 1
      }</span><span>${escapeHtml(label)}</span></a>`;
    })
    .join("");
}

function modelLabel(message) {
  if (message.model === "image") return t("imageTitle");
  return modelDisplayName(message.model || getSelectedModel());
}

function imageTag(url, alt) {
  const safe = safeImageUrl(url);
  if (!safe) return "";
  return `<img class="msg-image" src="${escapeHtml(safe)}" alt="${escapeHtml(
    alt || t("attachmentImage")
  )}" loading="lazy" decoding="async">`;
}

function actionsFor(message, { pending = false } = {}) {
  if (pending) return "";
  const copy = `<button class="msg-action" type="button" data-action="copy">⧉ ${escapeHtml(
    t("copy")
  )}</button>`;
  if (message.role === "assistant") {
    return `${copy}<button class="msg-action" type="button" data-action="regenerate">↻ ${escapeHtml(
      t("regenerate")
    )}</button>`;
  }
  return copy;
}

function assistantBody(message, streaming = false) {
  if (!message.content && streaming) {
    return '<div class="typing" aria-label="' + escapeHtml(t("thinking")) + '"><i></i><i></i><i></i></div>';
  }
  const prefix =
    message.image && !String(message.content).includes("![")
      ? imageTag(message.image, t("imageCreated"))
      : "";
  const markdown = `<div class="markdown">${renderMarkdown(message.content)}</div>`;
  return prefix + markdown + (streaming ? '<span class="stream-cursor" aria-hidden="true"></span>' : "");
}

function messageNode(message) {
  const role = message.role === "user" ? "user" : "assistant";
  const pending = Boolean(message.pending);
  const node = document.createElement("article");
  node.className = `msg msg-${role}${message.error ? " msg-error" : ""}`;
  node.dataset.id = message.id;
  node.setAttribute("role", "article");

  const avatar =
    role === "assistant"
      ? '<div class="msg-avatar" aria-hidden="true">✦</div>'
      : "";
  const meta = `
    <div class="msg-meta">
      <strong>${escapeHtml(role === "user" ? t("you") : t("afgAI"))}</strong>
      ${
        role === "assistant"
          ? `<span class="msg-model">${escapeHtml(modelLabel(message))}</span>`
          : ""
      }
      <time datetime="${escapeHtml(message.createdAt || "")}">${escapeHtml(
        formatClock(message.createdAt)
      )}</time>
    </div>`;

  let body;
  if (role === "user") {
    const image =
      message.image && !String(message.content).includes("![")
        ? imageTag(message.image, t("attachmentImage"))
        : "";
    body = `<div class="msg-body">${image}${escapeHtml(message.content)}</div>`;
  } else {
    body = `<div class="msg-body">${assistantBody(message, pending)}</div>`;
  }

  const sources =
    role === "assistant"
      ? `<div class="msg-sources"${message.sources?.length ? "" : " hidden"}>${sourceChips(
          message.sources
        )}</div>`
      : "";

  node.innerHTML = `${avatar}
    <div class="msg-main">
      ${meta}
      ${body}
      ${sources}
      <div class="msg-actions">${actionsFor(message, { pending })}</div>
    </div>`;
  return node;
}

function updateStreamingNode(node, message) {
  if (!node) return;
  const body = node.querySelector(".msg-body");
  if (body) body.innerHTML = assistantBody(message, true);
  const model = node.querySelector(".msg-model");
  if (model) model.textContent = modelLabel(message);
  const sources = node.querySelector(".msg-sources");
  if (sources && message.sources?.length) {
    sources.innerHTML = sourceChips(message.sources);
    sources.hidden = false;
  }
}

function updateScrollButton() {
  if (!els.scrollBottom) return;
  const hasMessages = Boolean(state.conversation?.messages?.length);
  els.scrollBottom.hidden = !hasMessages || state.autoScroll;
}

function renderAll({ scroll = false } = {}) {
  if (!els.messages) return;
  const conversation = state.conversation;
  const messages = conversation?.messages || [];
  if (els.welcome) els.welcome.hidden = messages.length > 0;
  els.messages.innerHTML = "";
  for (const message of messages) els.messages.appendChild(messageNode(message));
  if (scroll || state.autoScroll) scrollToBottom(els.conversation, false);
  updateScrollButton();
}

function appendNote(message) {
  const node = document.createElement("article");
  node.className = "msg msg-note msg-error";
  node.innerHTML = `<div class="msg-main">
      <div class="msg-body">${escapeHtml(message)}</div>
      <div class="msg-actions"><button class="msg-action" type="button" data-action="retry">↻ ${escapeHtml(
        t("retry")
      )}</button></div>
    </div>`;
  els.messages?.appendChild(node);
  scrollToBottom(els.conversation, true);
}

/* -------------------------------- Busy state ------------------------------ */
function setBusyUI(busy) {
  state.busy = busy;
  if (els.sendBtn) els.sendBtn.disabled = busy;
  if (els.stopBtn) els.stopBtn.hidden = !busy;
  if (els.prompt) els.prompt.setAttribute("aria-busy", String(busy));
}

export function stopGeneration() {
  if (!state.controller) return;
  try {
    state.controller.abort();
  } catch {
    /* ignore */
  }
}

/* ------------------------------- Sending flow ----------------------------- */
function ensureConversation() {
  if (state.conversation) return state.conversation;
  const conversation = normalizeConversation({
    id: uid(),
    title: t("newConversationTitle"),
    mode: state.mode,
    model: getSelectedModel(),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    messages: []
  });
  state.conversation = conversation;
  bus.emit("conversation:active", conversation.id);
  return conversation;
}

function buildApiMessages(conversation) {
  return conversation.messages
    .filter((message) => !message.pending && !message.error)
    .map((message) => ({ role: message.role, content: message.content }))
    .filter((message) => message.content.trim());
}

function latestImage(conversation) {
  for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
    const message = conversation.messages[index];
    if (message.role === "user" && message.image) return message.image;
    if (message.role === "assistant" && !message.pending) break;
  }
  return null;
}

async function generateReply(conversation) {
  if (!conversation) return;
  const runId = ++state.runId;
  const messages = buildApiMessages(conversation);
  const lastUser = [...messages].reverse().find((message) => message.role === "user");
  if (!lastUser) return;

  const assistant = makeMessage("assistant", "", {
    pending: true,
    model: getSelectedModel() === "auto" ? conversation.model || "auto" : getSelectedModel()
  });
  conversation.messages.push(assistant);
  state.autoScroll = true;
  renderAll({ scroll: true });

  const node = els.messages?.querySelector(`[data-id="${assistant.id}"]`);
  const controller = new AbortController();
  state.controller = controller;
  setBusyUI(true);

  const payload = {
    conversation_id: conversation.id,
    mode: conversation.mode,
    model: getSelectedModel(),
    language: getPrefs().responseLanguage,
    messages,
    image: latestImage(conversation) || undefined
  };

  const onDelta = (delta, accumulated) => {
    if (runId !== state.runId) return;
    assistant.content = accumulated ?? assistant.content + delta;
    updateStreamingNode(node, assistant);
    if (nearBottom(els.conversation)) scrollToBottom(els.conversation, false);
  };

  const applyMeta = (meta) => {
    if (runId !== state.runId || !meta) return;
    if (meta.model) assistant.model = meta.model;
    if (meta.modelId) assistant.modelId = meta.modelId;
    if (meta.title && conversation.messages.filter((message) => message.role === "user").length === 1) {
      conversation.title = meta.title;
      setHeaderTitle(conversation.title, true);
    }
    updateStreamingNode(node, assistant);
  };

  const applySources = (sources) => {
    if (runId !== state.runId || !Array.isArray(sources)) return;
    assistant.sources = sources;
    updateStreamingNode(node, assistant);
  };

  let result = null;
  let stopped = false;
  try {
    if (getPrefs().streaming) {
      result = await streamChat(
        payload,
        {
          onMeta: applyMeta,
          onDelta,
          onSources: applySources,
          onDone: () => {}
        },
        { signal: controller.signal }
      );
    } else {
      result = await api.chat(payload, { signal: controller.signal });
      if (result?.reply) {
        assistant.content = result.reply;
        assistant.model = result.model || assistant.model;
        assistant.sources = result.sources || assistant.sources;
      }
    }
    stopped = Boolean(result?.stopped) || controller.signal.aborted;
  } catch (error) {
    const aborted =
      controller.signal.aborted || error?.name === "AbortError" || error?.code === "AbortError";
    if (runId !== state.runId) return;
    if (aborted) {
      stopped = true;
    } else {
      conversation.messages = conversation.messages.filter((message) => message.id !== assistant.id);
      setBusyUI(false);
      state.controller = null;
      renderAll();
      appendNote(friendlyError(error));
      toast(friendlyError(error), { type: "error" });
      if (error?.code === "network") setConnection("offline");
      return;
    }
  }

  if (runId !== state.runId) return;

  if (result?.reply) assistant.content = result.reply;
  if (result?.model) assistant.model = result.model;
  if (result?.modelId) assistant.modelId = result.modelId;
  if (Array.isArray(result?.sources) && result.sources.length) assistant.sources = result.sources;
  if (result?.mode && MODES.includes(result.mode)) conversation.mode = result.mode;

  assistant.pending = false;
  assistant.createdAt = nowIso();
  conversation.model = assistant.model || conversation.model || "auto";
  conversation.updatedAt = nowIso();

  if (!assistant.content.trim()) {
    conversation.messages = conversation.messages.filter((message) => message.id !== assistant.id);
    setBusyUI(false);
    state.controller = null;
    saveConversation(conversation);
    renderAll();
    appendNote(t("stopped"));
    toast(t("stopped"), { type: "warning" });
    return;
  }

  saveConversation(conversation);
  setBusyUI(false);
  state.controller = null;
  renderAll({ scroll: true });
  setHeaderTitle(conversation.title, true);
  if (stopped) toast(t("stopped"), { type: "warning", timeout: 2400 });
}

async function handleSend() {
  if (state.busy) return;
  const prompt = els.prompt;
  if (!prompt) return;
  const text = String(prompt.value || "");
  const attachment = getAttachment();
  if (!text.trim() && !attachment) {
    toast(t("promptRequired"), { type: "warning" });
    prompt.focus();
    return;
  }

  const conversation = ensureConversation();
  const consumed = consumeAttachment();
  const content = buildUserContent(text, consumed);
  const userMessage = makeMessage("user", content, {
    image: consumed?.kind === "image" ? consumed.dataUrl : undefined
  });

  const isFirst = conversation.messages.length === 0;
  conversation.messages.push(userMessage);
  conversation.mode = state.mode;
  conversation.model = getSelectedModel();
  if (isFirst) conversation.title = titleFrom(content);
  conversation.updatedAt = nowIso();

  prompt.value = "";
  prompt.style.height = "auto";
  updateCharCount();
  state.autoScroll = true;
  setHeaderTitle(conversation.title, true);
  renderAll({ scroll: true });
  saveConversation(conversation);
  prompt.focus({ preventScroll: true });
  await generateReply(conversation);
}

/* ------------------------------- Regeneration ----------------------------- */
async function regenerate(messageId) {
  if (state.busy) return;
  const conversation = state.conversation;
  if (!conversation) return;
  const index = conversation.messages.findIndex(
    (message) => message.id === messageId && message.role === "assistant"
  );
  if (index < 0) {
    toast(t("regenerateFailed"), { type: "warning" });
    return;
  }
  if (index === 0 || conversation.messages[index - 1]?.role !== "user") {
    toast(t("regenerateFailed"), { type: "warning" });
    return;
  }
  conversation.messages = conversation.messages.slice(0, index);
  conversation.updatedAt = nowIso();
  state.autoScroll = true;
  renderAll({ scroll: true });
  await generateReply(conversation);
}

/* ------------------------------ Image results ----------------------------- */
function handleImageResult(result) {
  if (!result?.imageUrl) return;
  const conversation = ensureConversation();
  const prompt = String(result.prompt || "").trim();
  const isData = /^data:/i.test(result.imageUrl);
  const content = isData
    ? `${t("imageCreated")}${prompt ? `\n\n${prompt}` : ""}`
    : `![${prompt.replace(/[[\]]/g, "") || t("imageCreated")}](${result.imageUrl})`;
  const assistant = makeMessage("assistant", content, {
    model: "image",
    image: result.imageUrl
  });
  const isFirst = conversation.messages.length === 0;
  conversation.messages.push(assistant);
  conversation.updatedAt = nowIso();
  if (isFirst) conversation.title = titleFrom(prompt || t("imageCreated"));
  saveConversation(conversation);
  setHeaderTitle(conversation.title, true);
  state.autoScroll = true;
  renderAll({ scroll: true });
  toast(t("imageReady"), { type: "success" });
}

/* ------------------------------- New / open ------------------------------- */
export function startNewChat({ focus = true } = {}) {
  state.runId += 1;
  if (state.controller) {
    try {
      state.controller.abort();
    } catch {
      /* ignore */
    }
  }
  state.controller = null;
  setBusyUI(false);
  state.conversation = null;
  state.mode = MODES.includes(getPrefs().mode) ? getPrefs().mode : "chat";
  setMode(state.mode, { persist: false });
  state.autoScroll = true;
  renderAll();
  setHeaderTitle(t("newChat"), false);
  bus.emit("conversation:active", null);
  if (focus) setTimeout(() => els.prompt?.focus({ preventScroll: true }), 30);
}

export function openConversation(value) {
  const conversation = normalizeConversation(value);
  if (!conversation) return;
  state.runId += 1;
  if (state.controller) {
    try {
      state.controller.abort();
    } catch {
      /* ignore */
    }
  }
  state.controller = null;
  setBusyUI(false);
  state.conversation = conversation;
  setMode(conversation.mode, { persist: false });
  state.autoScroll = true;
  renderAll({ scroll: true });
  setHeaderTitle(conversation.title, true);
  bus.emit("conversation:active", conversation.id);
}

/* -------------------------------- Composer -------------------------------- */
function updateCharCount() {
  if (!els.charCount || !els.prompt) return;
  const length = els.prompt.value.length;
  els.charCount.textContent = length ? String(length) : "";
}

function autoResize() {
  const prompt = els.prompt;
  if (!prompt) return;
  prompt.style.height = "auto";
  prompt.style.height = `${Math.min(prompt.scrollHeight, 190)}px`;
}

function sendSuggestion(key) {
  const mode = SUGGESTION_MODES[key] || "chat";
  setMode(mode);
  if (!els.prompt) return;
  els.prompt.value = t(`prompt${key[0].toUpperCase()}${key.slice(1)}`);
  autoResize();
  updateCharCount();
  handleSend();
}

/* ---------------------------------- Init ---------------------------------- */
export function initChat() {
  els.conversation = $("#conversation");
  els.messages = $("#messages");
  els.welcome = $("#welcome");
  els.title = $("#chatTitle");
  els.prompt = $("#prompt");
  els.form = $("#chatForm");
  els.sendBtn = $("#sendBtn");
  els.stopBtn = $("#stopBtn");
  els.charCount = $("#charCount");
  els.modeCaption = $("#modeCaption");
  els.scrollBottom = $("#scrollBottom");

  setMode(MODES.includes(getPrefs().mode) ? getPrefs().mode : "chat", { persist: false });
  setHeaderTitle(t("newChat"), false);
  renderAll();
  updateCharCount();

  els.form?.addEventListener("submit", (event) => {
    event.preventDefault();
    handleSend();
  });

  els.stopBtn?.addEventListener("click", () => stopGeneration());

  els.prompt?.addEventListener("input", () => {
    autoResize();
    updateCharCount();
  });

  els.prompt?.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    const wantsEnter = event.key === "Enter" && !event.shiftKey;
    const modifierSend = event.key === "Enter" && (event.ctrlKey || event.metaKey);
    if (!wantsEnter && !modifierSend) return;
    if (wantsEnter && !getPrefs().sendOnEnter) return;
    event.preventDefault();
    handleSend();
  });

  for (const card of $$("[data-prompt-key]")) {
    card.addEventListener("click", () => sendSuggestion(card.dataset.promptKey));
  }

  els.messages?.addEventListener("click", (event) => {
    const codeButton = event.target.closest("[data-copy-code]");
    if (codeButton) {
      const code = codeButton.closest(".code-block")?.querySelector("pre code")?.textContent || "";
      copyText(code, t("copied"));
      return;
    }
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const article = button.closest(".msg");
    const message = state.conversation?.messages.find((entry) => entry.id === article?.dataset.id);
    const action = button.dataset.action;
    if (action === "retry") {
      if (state.busy || !state.conversation) return;
      article?.remove();
      generateReply(state.conversation);
    } else if (action === "copy") {
      const value = message?.content || article?.querySelector(".msg-body")?.textContent || "";
      copyText(value, message?.role === "user" ? t("copied") : t("replyCopied"));
    } else if (action === "regenerate") {
      if (message) regenerate(message.id);
    }
  });

  els.conversation?.addEventListener("scroll", () => {
    state.autoScroll = nearBottom(els.conversation);
    updateScrollButton();
  });

  els.scrollBottom?.addEventListener("click", () => {
    state.autoScroll = true;
    scrollToBottom(els.conversation, true);
    updateScrollButton();
  });

  bus.on("conversation:new", () => startNewChat());
  bus.on("conversation:open", (conversation) => openConversation(conversation));
  bus.on("mode:set", (mode) => setMode(mode));
  bus.on("image:result", (result) => handleImageResult(result));
  bus.on("conversations:changed", (payload) => {
    if (payload?.cleared) startNewChat({ focus: false });
  });
  bus.on("language", () => {
    if (state.conversation) setHeaderTitle(state.conversation.title, true);
    else setHeaderTitle(t("newChat"), false);
    setMode(state.mode, { persist: false });
    if (!state.busy) renderAll();
    updateCharCount();
  });
  bus.on("prefs", () => {
    // Keep the composer/send behaviour in sync with settings changes.
    updateCharCount();
  });
}
