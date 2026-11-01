/* AFG AI · application bootstrap and global shell behaviour */

import { $, bus, getPrefs, updatePrefs } from "./core.js";
import { initI18n, setUiLanguage, t } from "./i18n.js";
import { api, setBaseUrl } from "./api.js";
import { initUi, setConnection, toast } from "./ui.js";
import { initModels, loadModels } from "./models.js";
import { initAttachments } from "./attachments.js";
import { initConversations, refreshServerConversations } from "./conversations.js";
import { initAuth } from "./auth.js";
import { initSettings } from "./settings.js";
import { initChat } from "./chat.js";
import { initImage } from "./image.js";
import { initPalette } from "./palette.js";
import { openAuth } from "./auth.js";

const THEMES = ["midnight", "oled", "aurora"];
let lastConnection = null;
let lastCheck = 0;

/* -------------------------------- Sidebar --------------------------------- */
function setSidebar(open) {
  const sidebar = $("#sidebar");
  const scrim = $("#scrim");
  if (!sidebar || !scrim) return;
  sidebar.classList.toggle("is-open", open);
  scrim.hidden = !open;
  if (open) sidebar.querySelector("button, a")?.focus({ preventScroll: true });
}

/* ------------------------------- Connection ------------------------------- */
async function checkConnection({ notify = true } = {}) {
  lastCheck = Date.now();
  setConnection("connecting");
  const wake = setTimeout(() => setConnection("connecting", t("statusWake")), 4200);
  try {
    await api.health({ deep: false });
    setConnection("online");
    if (notify && lastConnection === "offline") toast(t("connectionRestored"), { type: "success" });
    lastConnection = "online";
  } catch {
    setConnection("offline");
    if (notify && lastConnection !== "offline") toast(t("connectionLost"), { type: "warning" });
    lastConnection = "offline";
  } finally {
    clearTimeout(wake);
  }
}

/* ------------------------------- Onboarding ------------------------------- */
function finishOnboarding() {
  const overlay = $("#onboarding");
  if (overlay) overlay.hidden = true;
  updatePrefs({ onboarded: true });
}

function initOnboarding() {
  const gate = $("#languageGate");
  const overlay = $("#onboarding");
  if (!overlay || !gate) return;

  const hasChosenLanguage = ["fa", "en"].includes(getPrefs().uiLanguage);
  gate.hidden = hasChosenLanguage;
  overlay.hidden = hasChosenLanguage ? Boolean(getPrefs().onboarded) : true;

  const chooseLanguage = (language) => {
    setUiLanguage(language);
    gate.hidden = true;
    overlay.hidden = Boolean(getPrefs().onboarded);
  };

  $("#languageDari")?.addEventListener("click", () => chooseLanguage("fa"));
  $("#languageEnglish")?.addEventListener("click", () => chooseLanguage("en"));

  $("#onboardingSignIn")?.addEventListener("click", () => {
    finishOnboarding();
    openAuth("signin");
  });
  $("#onboardingGuest")?.addEventListener("click", () => {
    finishOnboarding();
    toast(t("guestModeOn"), { timeout: 4200 });
  });
}

/* --------------------------------- Theme ---------------------------------- */
function cycleTheme() {
  const current = getPrefs().theme;
  const next = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length];
  updatePrefs({ theme: next });
  toast(t("themeChanged"), { type: "success", timeout: 1800 });
}

/* ------------------------------ External links ----------------------------- */
function initExternalLinks() {
  document.addEventListener("click", (event) => {
    const anchor = event.target.closest("a[href]");
    if (!anchor) return;
    const href = anchor.getAttribute("href") || "";
    if (!/^https?:\/\//i.test(href)) return;
    if (href.startsWith(location.origin)) return;
    event.preventDefault();
    const bridge = globalThis.AFGApp;
    if (bridge && typeof bridge.openExternal === "function") bridge.openExternal(href);
    else window.open(href, "_blank", "noopener,noreferrer");
  });
}

/* --------------------------------- Service -------------------------------- */
function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (!/^https:$/.test(location.protocol)) return;
  navigator.serviceWorker.register("./sw.js").catch(() => {
    /* offline caching is an enhancement, never a blocker */
  });
}

/* ---------------------------------- Boot ---------------------------------- */
function boot() {
  setBaseUrl(getPrefs().serverUrl);
  initI18n();
  initUi();
  initModels();
  initAttachments();
  initConversations();
  initChat();
  initAuth();
  initSettings();
  initImage();
  initPalette();
  initOnboarding();
  initExternalLinks();

  $("#openSidebar")?.addEventListener("click", () => setSidebar(true));
  $("#closeSidebar")?.addEventListener("click", () => setSidebar(false));
  $("#scrim")?.addEventListener("click", () => setSidebar(false));
  $("#themeBtn")?.addEventListener("click", cycleTheme);
  bus.on("sidebar:close", () => setSidebar(false));

  window.addEventListener("resize", () => {
    if (window.innerWidth > 980) setSidebar(false);
  });

  bus.on("server:changed", (url) => {
    setBaseUrl(url);
    loadModels({ force: true });
    refreshServerConversations();
    checkConnection({ notify: true });
  });

  window.addEventListener("online", () => checkConnection({ notify: true }));
  window.addEventListener("offline", () => {
    setConnection("offline");
    lastConnection = "offline";
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - lastCheck > 60_000) {
      checkConnection({ notify: false });
    }
  });

  checkConnection({ notify: false });
  setInterval(() => {
    if (document.visibilityState === "visible") checkConnection({ notify: true });
  }, 60_000);

  registerServiceWorker();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
