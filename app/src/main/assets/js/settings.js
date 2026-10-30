/* AFG AI · preferences, service health, account panel and data controls */

import {
  $,
  $$,
  applyPrefs,
  bus,
  clearLocalConversations,
  getPrefs,
  loadConversations,
  updatePrefs
} from "./core.js";
import { api, setBaseUrl } from "./api.js";
import { t } from "./i18n.js";
import {
  closeOverlay,
  confirmDialog,
  openOverlay,
  saveTextFile,
  setConnection,
  toast
} from "./ui.js";
import { getUser, isSignedIn, openAuth, signOut } from "./auth.js";

let draft = { ...getPrefs() };

function setStatus(message, kind = "") {
  const node = $("#settingsStatus");
  if (!node) return;
  node.textContent = message || "";
  node.className = `form-status${kind ? " " + kind : ""}`;
}

function normalizeServer(value) {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  if (!raw) return getPrefs().serverUrl;
  if (/^https:\/\/[^\s]+$/i.test(raw)) return raw;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(raw)) return raw;
  return null;
}

function renderSwitch(id, value) {
  const node = document.getElementById(id);
  if (node) node.setAttribute("aria-checked", String(Boolean(value)));
}

function renderSwatches() {
  for (const swatch of $$("[data-accent]")) {
    const active = swatch.dataset.accent === draft.accent;
    swatch.classList.toggle("is-active", active);
    swatch.setAttribute("aria-pressed", String(active));
  }
}

function syncFields() {
  const view = $("#uiLanguage");
  if (view) view.value = draft.uiLanguage;
  const response = $("#responseLanguage");
  if (response) response.value = draft.responseLanguage;
  const theme = $("#themeSelect");
  if (theme) theme.value = draft.theme;
  const size = $("#fontSize");
  if (size) size.value = draft.size;
  const server = $("#serverUrl");
  if (server) server.value = draft.serverUrl;
  renderSwitch("reduceMotion", draft.reduceMotion);
  renderSwitch("sendOnEnter", draft.sendOnEnter);
  renderSwitch("streaming", draft.streaming);
  renderSwatches();
}

function previewAppearance() {
  applyPrefs(draft);
  renderSwatches();
  renderSwitch("reduceMotion", draft.reduceMotion);
  renderSwitch("sendOnEnter", draft.sendOnEnter);
  renderSwitch("streaming", draft.streaming);
}

function accountInitial(user) {
  const source = String(user?.name || user?.email || "G").trim();
  return (source[0] || "G").toUpperCase();
}

function renderAccount() {
  const container = $("#accountContent");
  if (!container) return;
  const user = getUser();
  if (isSignedIn()) {
    container.innerHTML = `
      <div class="account-box">
        <span class="account-avatar" aria-hidden="true">${accountInitial(user)}</span>
        <div class="account-box-copy">
          <strong>${user?.name || user?.email || t("member")}</strong>
          <small>${user?.email || ""} · ${t("planFree")}</small>
        </div>
      </div>
      <button class="btn btn-sm btn-block" type="button" data-account-action="signout">${t(
        "signOut"
      )}</button>`;
    return;
  }
  container.innerHTML = `
    <p class="field-hint">${t("guestNote")}</p>
    <button class="btn btn-sm btn-block btn-primary" type="button" data-account-action="signin">${t(
      "signIn"
    )}</button>`;
}

function renderDataSummary() {
  const node = $("#dataSummary");
  if (!node) return;
  const conversations = loadConversations();
  const messages = conversations.reduce(
    (total, conversation) => total + (conversation.messages?.length || 0),
    0
  );
  node.textContent = t("dataSummary", { conversations: conversations.length, messages });
}

function setHealth(id, value, state = "") {
  const node = document.getElementById(id);
  if (!node) return;
  node.textContent = value;
  node.className = `health-value${state ? " " + state : ""}`;
}

export async function checkHealth({ silent = false } = {}) {
  setHealth("healthServer", t("healthChecking"));
  setHealth("healthAI", t("healthChecking"));
  setHealth("healthSearch", t("healthChecking"));
  setHealth("healthImage", t("healthChecking"));
  setHealth("healthModels", t("healthChecking"));
  try {
    const data = await api.health({ deep: true });
    setHealth("healthServer", t("healthOnline"), "ok");
    setHealth(
      "healthAI",
      data.aiConfigured ? t("healthConfigured") : t("healthNotConfigured"),
      data.aiConfigured ? "ok" : "off"
    );
    setHealth(
      "healthSearch",
      data.webSearchConfigured ? t("healthConfigured") : t("healthNotConfigured"),
      data.webSearchConfigured ? "ok" : "off"
    );
    setHealth(
      "healthImage",
      data.imageConfigured ? t("healthConfigured") : t("healthNotConfigured"),
      data.imageConfigured ? "ok" : "off"
    );
    setHealth(
      "healthModels",
      t("healthModelsValue", { count: Number(data.modelsCached) || 0 }),
      data.modelsCached ? "ok" : "off"
    );
    setConnection("online");
    if (!silent) toast(t("healthOK"), { type: "success" });
    return data;
  } catch (error) {
    setHealth("healthServer", t("healthOffline"), "off");
    setHealth("healthAI", "—");
    setHealth("healthSearch", "—");
    setHealth("healthImage", "—");
    setHealth("healthModels", "—");
    setConnection("offline");
    if (!silent) toast(friendlyCheckError(error), { type: "error" });
    return null;
  }
}

function friendlyCheckError(error) {
  if (error?.code === "network") return t("serverTestFail");
  if (error?.code === "timeout") return t("errorTimeout");
  return t("healthFail");
}

export function exportData() {
  const conversations = loadConversations();
  if (!conversations.length) {
    toast(t("exportEmpty"), { type: "warning" });
    return;
  }
  const prefs = { ...getPrefs() };
  const payload = {
    app: "AFG AI",
    version: "2.0.0",
    exportedAt: new Date().toISOString(),
    preferences: prefs,
    conversations
  };
  const stamp = new Date().toISOString().slice(0, 10);
  saveTextFile(`afg-ai-backup-${stamp}.json`, "application/json", JSON.stringify(payload, null, 2));
  toast(t("exportDone"), { type: "success" });
}

export async function clearHistory() {
  const confirmed = await confirmDialog({
    title: t("clearHistory"),
    message: t("clearConfirm"),
    confirmLabel: t("clearHistory")
  });
  if (!confirmed) return;
  clearLocalConversations();
  renderDataSummary();
  toast(t("cleared"), { type: "success" });
}

async function testServer() {
  const url = normalizeServer($("#serverUrl")?.value);
  if (!url) {
    setStatus(t("serverInvalid"), "error");
    toast(t("serverInvalid"), { type: "error" });
    return;
  }
  setStatus(t("healthChecking"));
  try {
    const response = await fetch(url + "/api/health?deep=0", {
      headers: { Accept: "application/json", "X-AFG-Client": "android-webview/2.0" },
      cache: "no-store",
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    setStatus(t("serverTestOk"), "success");
    toast(t("serverTestOk"), { type: "success" });
  } catch {
    setStatus(t("serverTestFail"), "error");
    toast(t("serverTestFail"), { type: "error" });
  }
}

function saveSettings() {
  const server = normalizeServer($("#serverUrl")?.value);
  if (!server) {
    setStatus(t("serverInvalid"), "error");
    toast(t("serverInvalid"), { type: "error" });
    return;
  }
  draft.serverUrl = server;
  updatePrefs({ ...draft });
  setBaseUrl(getPrefs().serverUrl);
  syncFields();
  setStatus(t("settingsSaved"), "success");
  toast(t("settingsSaved"), { type: "success" });
  renderDataSummary();
  checkHealth({ silent: true });
  bus.emit("server:changed", getPrefs().serverUrl);
}

export function openSettings() {
  draft = { ...getPrefs() };
  syncFields();
  renderAccount();
  renderDataSummary();
  setStatus("");
  openOverlay("settingsModal");
  checkHealth({ silent: true });
}

export function initSettings() {
  $("#settingsBtn")?.addEventListener("click", () => {
    openSettings();
    bus.emit("sidebar:close");
  });

  $("#themeSelect")?.addEventListener("change", () => {
    draft.theme = $("#themeSelect").value;
    previewAppearance();
    setStatus("");
  });
  $("#fontSize")?.addEventListener("change", () => {
    draft.size = $("#fontSize").value;
    previewAppearance();
    setStatus("");
  });
  $("#uiLanguage")?.addEventListener("change", () => {
    draft.uiLanguage = $("#uiLanguage").value;
    setStatus("");
  });
  $("#responseLanguage")?.addEventListener("change", () => {
    draft.responseLanguage = $("#responseLanguage").value;
    setStatus("");
  });
  $("#serverUrl")?.addEventListener("input", () => {
    draft.serverUrl = $("#serverUrl").value;
    setStatus("");
  });

  for (const swatch of $$("[data-accent]")) {
    swatch.addEventListener("click", () => {
      draft.accent = swatch.dataset.accent;
      previewAppearance();
      setStatus("");
    });
  }

  for (const [id, key] of [
    ["reduceMotion", "reduceMotion"],
    ["sendOnEnter", "sendOnEnter"],
    ["streaming", "streaming"]
  ]) {
    document.getElementById(id)?.addEventListener("click", () => {
      draft[key] = !draft[key];
      previewAppearance();
      setStatus("");
    });
  }

  $("#saveSettings")?.addEventListener("click", saveSettings);
  $("#checkHealth")?.addEventListener("click", () => checkHealth());
  $("#testServer")?.addEventListener("click", testServer);
  $("#exportData")?.addEventListener("click", exportData);
  $("#clearHistory")?.addEventListener("click", clearHistory);

  $("#accountContent")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-account-action]");
    if (!button) return;
    if (button.dataset.accountAction === "signout") {
      signOut().then(renderAccount);
    } else if (button.dataset.accountAction === "signin") {
      closeOverlay("settingsModal");
      openAuth("signin");
    }
  });

  bus.on("overlay:open", (id) => {
    if (id === "settingsModal") {
      if (draft.serverUrl !== getPrefs().serverUrl) draft = { ...getPrefs() };
      syncFields();
      renderAccount();
      renderDataSummary();
    }
  });

  bus.on("overlay:closed", (id) => {
    if (id === "settingsModal") applyPrefs(getPrefs());
    if (id === "authModal") renderAccount();
  });

  bus.on("auth:changed", () => {
    renderAccount();
    renderDataSummary();
  });
  bus.on("account:changed", () => renderAccount());
  bus.on("conversations:changed", () => {
    if (!$("#settingsModal")?.hidden) renderDataSummary();
  });
  bus.on("language", () => {
    syncFields();
    renderAccount();
    renderDataSummary();
  });
}
