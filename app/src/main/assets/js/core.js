/* AFG AI · core utilities, preferences, local storage and event bus */

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function uid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let index = 0; index < 16; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function debounce(fn, wait = 250) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatClock(iso) {
  try {
    return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(
      new Date(iso)
    );
  } catch {
    return "";
  }
}

/* ------------------------------ Storage helpers --------------------------- */
export const storage = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
  getText(key, fallback = "") {
    try {
      return localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  },
  setText(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
};

export function getDeviceId() {
  let id = storage.getText("afg.device.id", "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    id = uid();
    storage.setText("afg.device.id", id);
  }
  return id;
}

/* ------------------------------- Event bus -------------------------------- */
function createBus() {
  const handlers = new Map();
  return {
    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event).add(handler);
      return () => handlers.get(event)?.delete(handler);
    },
    emit(event, payload) {
      for (const handler of handlers.get(event) || []) {
        try {
          handler(payload);
        } catch (error) {
          console.error(`Listener for "${event}" failed:`, error);
        }
      }
    }
  };
}
export const bus = createBus();

/* ------------------------------- Preferences ------------------------------ */
const PREFERENCES_KEY = "afg.prefs.v1";

const isLocalHost =
  ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname) ||
  location.hostname.endsWith(".localhost");

export const DEFAULT_SERVER = (() => {
  if (location.protocol === "file:") return "https://afg-ai.onrender.com";
  if (location.hostname.endsWith("androidplatform.net")) return "https://afg-ai.onrender.com";
  if (isLocalHost) return location.origin;
  return location.origin;
})();

export const DEFAULT_PREFS = Object.freeze({
  uiLanguage: "auto",
  responseLanguage: "auto",
  theme: "midnight",
  accent: "cyan",
  size: "md",
  reduceMotion: false,
  sendOnEnter: true,
  streaming: true,
  mode: "chat",
  model: "auto",
  serverUrl: DEFAULT_SERVER,
  onboarded: false
});

function sanitizePrefs(raw) {
  const prefs = { ...DEFAULT_PREFS };
  if (!raw || typeof raw !== "object") return prefs;
  if (["auto", "fa", "en"].includes(raw.uiLanguage)) prefs.uiLanguage = raw.uiLanguage;
  if (["auto", "fa", "en"].includes(raw.responseLanguage)) prefs.responseLanguage = raw.responseLanguage;
  if (["midnight", "oled", "aurora"].includes(raw.theme)) prefs.theme = raw.theme;
  if (["cyan", "violet", "emerald", "amber"].includes(raw.accent)) prefs.accent = raw.accent;
  if (["sm", "md", "lg"].includes(raw.size)) prefs.size = raw.size;
  if (typeof raw.reduceMotion === "boolean") prefs.reduceMotion = raw.reduceMotion;
  if (typeof raw.sendOnEnter === "boolean") prefs.sendOnEnter = raw.sendOnEnter;
  if (typeof raw.streaming === "boolean") prefs.streaming = raw.streaming;
  if (["chat", "research", "coding", "study", "creative"].includes(raw.mode)) prefs.mode = raw.mode;
  if (typeof raw.model === "string" && raw.model.length < 180) prefs.model = raw.model;
  if (typeof raw.serverUrl === "string" && /^https?:\/\//i.test(raw.serverUrl)) {
    prefs.serverUrl = raw.serverUrl.replace(/\/+$/, "");
  }
  if (raw.onboarded === true) prefs.onboarded = true;
  return prefs;
}

export let prefs = sanitizePrefs(storage.get(PREFERENCES_KEY, null));

export function getPrefs() {
  return prefs;
}

export function updatePrefs(patch, { persist = true } = {}) {
  prefs = sanitizePrefs({ ...prefs, ...patch });
  if (persist) storage.set(PREFERENCES_KEY, prefs);
  applyPrefs(prefs);
  bus.emit("prefs", prefs);
  return prefs;
}

export function setPref(key, value) {
  return updatePrefs({ [key]: value });
}

export function getServerUrl() {
  return (prefs.serverUrl || DEFAULT_SERVER).replace(/\/+$/, "");
}

export function applyPrefs(value = prefs) {
  const root = document.documentElement;
  root.dataset.theme = value.theme;
  root.dataset.accent = value.accent;
  root.dataset.size = value.size;
  root.dataset.motion = value.reduceMotion ? "reduced" : "full";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute(
      "content",
      value.theme === "oled" ? "#000000" : value.theme === "aurora" ? "#05030f" : "#020711"
    );
  }
}

/* ---------------------------- Legacy data migration ----------------------- */
const CONVERSATIONS_KEY = "afg.conversations.v1";

function legacyMessageRole(kind) {
  return kind === "ai" ? "assistant" : "user";
}

function migrateLegacyStorage() {
  try {
    const existing = storage.get(CONVERSATIONS_KEY, null);
    if (Array.isArray(existing)) return;

    const conversations = [];
    const archived = storage.get("afg_ai_archived_chats_v1", []);
    if (Array.isArray(archived)) {
      for (const chat of archived) {
        if (!chat || !Array.isArray(chat.messages) || !chat.messages.length) continue;
        const messages = chat.messages
          .filter((message) => message && typeof message.text === "string" && message.text.trim())
          .slice(-100)
          .map((message) => ({
            id: uid(),
            role: legacyMessageRole(message.kind),
            content: message.text.slice(0, 40000),
            createdAt: new Date(chat.savedAt || Date.now()).toISOString()
          }));
        if (!messages.length) continue;
        conversations.push({
          id: chat.id || uid(),
          title: String(chat.title || messages[0].content).slice(0, 80),
          mode: "chat",
          model: "auto",
          messages,
          updatedAt: new Date(chat.savedAt || Date.now()).toISOString()
        });
      }
    }

    if (!conversations.length) {
      const current = storage.get("afg_ai_chat_history_v3", []);
      if (Array.isArray(current) && current.length) {
        const messages = current
          .filter((message) => message && typeof message.text === "string" && message.text.trim())
          .slice(-80)
          .map((message) => ({
            id: uid(),
            role: legacyMessageRole(message.kind),
            content: message.text.slice(0, 40000),
            createdAt: new Date().toISOString()
          }));
        if (messages.length) {
          conversations.push({
            id: uid(),
            title: messages[0].content.slice(0, 80),
            mode: "chat",
            model: "auto",
            messages,
            updatedAt: new Date().toISOString()
          });
        }
      }
    }

    storage.set(CONVERSATIONS_KEY, conversations.slice(-100));

    const legacyModel = storage.getText("afg_ai_selected_model", "");
    const legacyUi = storage.getText("afg_ai_ui_language", "auto");
    const legacyResponse = storage.getText("afg_ai_language", "auto");
    const legacyAppearance = storage.getText("afg_ai_appearance", "dark");
    const patch = {};
    if (legacyModel) patch.model = legacyModel;
    if (["auto", "fa", "en"].includes(legacyUi)) patch.uiLanguage = legacyUi;
    if (["auto", "fa", "en"].includes(legacyResponse)) patch.responseLanguage = legacyResponse;
    if (legacyAppearance === "black") patch.theme = "oled";
    if (Object.keys(patch).length) updatePrefs(patch, { persist: true });

    for (const key of [
      "afg_ai_chat_history_v1",
      "afg_ai_chat_history_v2",
      "afg_ai_chat_history_v3",
      "afg_ai_archived_chats_v1"
    ]) {
      storage.remove(key);
    }
  } catch (error) {
    console.warn("Legacy migration skipped:", error);
  }
}

/* ----------------------------- Conversations ------------------------------ */
function validConversation(value) {
  return (
    value &&
    typeof value.id === "string" &&
    value.id.length <= 80 &&
    Array.isArray(value.messages) &&
    value.messages.every(
      (message) =>
        message &&
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string"
    )
  );
}

export function loadConversations() {
  const stored = storage.get(CONVERSATIONS_KEY, []);
  if (!Array.isArray(stored)) return [];
  return stored
    .filter(validConversation)
    .map((conversation) => ({
      ...conversation,
      title: String(conversation.title || "New conversation").slice(0, 90),
      mode: ["chat", "research", "coding", "study", "creative"].includes(conversation.mode)
        ? conversation.mode
        : "chat",
      model: typeof conversation.model === "string" ? conversation.model : "auto",
      updatedAt: conversation.updatedAt || new Date().toISOString()
    }))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, 100);
}

export function saveLocalConversations(list) {
  const compact = (Array.isArray(list) ? list : [])
    .filter(validConversation)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, 100)
    .map((conversation) => ({
      ...conversation,
      messages: conversation.messages.slice(-200).map((message) => ({
        id: message.id || uid(),
        role: message.role,
        content: String(message.content || "").slice(0, 40000),
        model: message.model || null,
        sources: Array.isArray(message.sources) ? message.sources.slice(0, 10) : [],
        createdAt: message.createdAt || new Date().toISOString()
      }))
    }));
  storage.set(CONVERSATIONS_KEY, compact);
  return compact;
}

export function upsertLocalConversation(conversation) {
  const list = loadConversations();
  const index = list.findIndex((item) => item.id === conversation.id);
  if (index >= 0) list[index] = conversation;
  else list.unshift(conversation);
  saveLocalConversations(list);
  bus.emit("conversations:changed", { conversation });
  return conversation;
}

export function removeLocalConversation(id) {
  saveLocalConversations(loadConversations().filter((conversation) => conversation.id !== id));
  bus.emit("conversations:changed", { deleted: id });
}

export function findLocalConversation(id) {
  return loadConversations().find((conversation) => conversation.id === id) || null;
}

export function clearLocalConversations() {
  storage.set(CONVERSATIONS_KEY, []);
  bus.emit("conversations:changed", { cleared: true });
}

/* ---------------------------------- Auth ---------------------------------- */
const TOKEN_KEY = "afg.auth.token";
const USER_KEY = "afg.auth.user";

export function getToken() {
  return storage.getText(TOKEN_KEY, "");
}
export function setToken(token) {
  if (token) storage.setText(TOKEN_KEY, token);
  else storage.remove(TOKEN_KEY);
}
export function getCachedUser() {
  return storage.get(USER_KEY, null);
}
export function setCachedUser(user) {
  if (user) storage.set(USER_KEY, user);
  else storage.remove(USER_KEY);
}

/* ---------------------------------- Boot ---------------------------------- */
migrateLegacyStorage();
applyPrefs(prefs);
