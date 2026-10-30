/* AFG AI · account UI, sign in, registration and guest identity */

import {
  $,
  bus,
  getCachedUser,
  getToken,
  setCachedUser,
  setToken
} from "./core.js";
import { api } from "./api.js";
import { t } from "./i18n.js";
import { closeOverlay, openOverlay, toast } from "./ui.js";

const state = { user: getCachedUser(), mode: "signin", busy: false };

export function getUser() {
  return state.user;
}

export function isSignedIn() {
  return Boolean(getToken() && state.user && state.user.kind !== "guest");
}

function initialOf(user) {
  const name = String(user?.name || user?.email || "G").trim();
  return (name[0] || "G").toUpperCase();
}

function displayName(user) {
  return user?.name || user?.email || t("guest");
}

export function updateAccountUI() {
  const signedIn = isSignedIn();
  const name = signedIn ? displayName(state.user) : t("guest");
  const avatar = signedIn ? initialOf(state.user) : "G";

  const nameNode = $("#accountName");
  if (nameNode) nameNode.textContent = name;
  const avatarNode = $("#accountAvatar");
  if (avatarNode) avatarNode.textContent = avatar;
  const sideDot = $("#sidebarAccountDot");
  if (sideDot) sideDot.textContent = avatar;
  const sideLabel = $("#sidebarAccountLabel");
  if (sideLabel) sideLabel.textContent = signedIn ? name : t("account");
  const badge = $("#accountBadge");
  if (badge) badge.textContent = signedIn ? t("member") : t("guest");
  bus.emit("account:changed", state.user);
}

function setTab(tab) {
  const register = tab === "register";
  state.mode = register ? "register" : "signin";
  $("#signInTab")?.classList.toggle("is-active", !register);
  $("#registerTab")?.classList.toggle("is-active", register);
  $("#signInTab")?.setAttribute("aria-selected", String(!register));
  $("#registerTab")?.setAttribute("aria-selected", String(register));
  const field = $("#nameField");
  if (field) field.hidden = !register;
  const nameInput = $("#authName");
  if (nameInput) nameInput.required = register;
  const password = $("#authPassword");
  if (password) password.autocomplete = register ? "new-password" : "current-password";
  const submit = $("#authSubmit");
  if (submit) submit.textContent = register ? t("authSubmitCreate") : t("authSubmitSignIn");
  setStatus("");
}

function setStatus(message, kind = "") {
  const node = $("#authStatus");
  if (!node) return;
  node.textContent = message || "";
  node.className = `form-status${kind ? " " + kind : ""}`;
}

function setBusy(busy) {
  state.busy = busy;
  const submit = $("#authSubmit");
  if (!submit) return;
  submit.disabled = busy;
  submit.textContent = busy
    ? t("updating")
    : state.mode === "register"
      ? t("authSubmitCreate")
      : t("authSubmitSignIn");
}

function friendlyAuthError(error) {
  const code = error?.code;
  if (code === "invalid_credentials" || error?.status === 401) return t("authInvalid");
  if (code === "email_taken") return t("emailTaken");
  if (code === "weak_password") return t("passwordTooShort");
  if (code === "invalid_email") return t("emailInvalid");
  if (code === "rate_limited") return t("errorRateLimit");
  if (code === "network") return t("errorNetwork");
  if (code === "timeout") return t("errorTimeout");
  return t("errorGeneric");
}

function emailLooksValid(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

export function openAuth(tab = "signin") {
  setTab(tab);
  setStatus("");
  openOverlay("authModal");
  setTimeout(() => $("#authEmail")?.focus({ preventScroll: true }), 60);
}

export function openAccount() {
  if (isSignedIn()) openOverlay("settingsModal");
  else openAuth("signin");
}

export async function signOut() {
  try {
    await api.logout();
  } catch {
    /* stateless tokens: local removal is enough */
  }
  setToken("");
  setCachedUser(null);
  state.user = null;
  updateAccountUI();
  bus.emit("auth:changed", null);
  toast(t("signedOut"), { type: "success" });
}

export async function refreshUser() {
  if (!getToken()) {
    state.user = null;
    updateAccountUI();
    return null;
  }
  try {
    const data = await api.me();
    const user = data?.user || null;
    state.user = user && user.kind ? user : user ? { ...user, kind: "user" } : null;
    setCachedUser(state.user);
  } catch (error) {
    if (error?.status === 401) {
      setToken("");
      setCachedUser(null);
      state.user = null;
    }
  }
  updateAccountUI();
  return state.user;
}

function handleExpired() {
  if (!getToken() && !state.user) return;
  setToken("");
  setCachedUser(null);
  state.user = null;
  updateAccountUI();
  bus.emit("auth:changed", null);
  toast(t("authRequired"), { type: "warning" });
}

export function initAuth() {
  updateAccountUI();

  $("#accountBtn")?.addEventListener("click", () => {
    openAccount();
    bus.emit("sidebar:close");
  });
  $("#accountChip")?.addEventListener("click", () => openAccount());
  $("#signInTab")?.addEventListener("click", () => setTab("signin"));
  $("#registerTab")?.addEventListener("click", () => setTab("register"));
  $("#continueGuest")?.addEventListener("click", () => {
    closeOverlay("authModal");
    toast(t("guestModeOn"), { timeout: 4200 });
  });

  $("#authForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.busy) return;
    const email = String($("#authEmail")?.value || "").trim().toLowerCase();
    const password = String($("#authPassword")?.value || "");
    const name = String($("#authName")?.value || "").trim();

    if (!emailLooksValid(email)) {
      setStatus(t("emailInvalid"), "error");
      $("#authEmail")?.focus();
      return;
    }
    if (password.length < 8) {
      setStatus(t("passwordTooShort"), "error");
      $("#authPassword")?.focus();
      return;
    }

    setBusy(true);
    setStatus(t("updating"));
    const mode = state.mode;
    try {
      const data =
        mode === "register"
          ? await api.register({ name, email, password })
          : await api.login({ email, password });
      if (!data?.token || !data?.user) throw new Error("invalid response");
      setToken(data.token);
      state.user = { ...data.user, kind: "user" };
      setCachedUser(state.user);
      updateAccountUI();
      closeOverlay("authModal");
      $("#authForm")?.reset();
      setTab("signin");
      toast(mode === "register" ? t("accountCreated") : t("signInSuccess"), {
        type: "success"
      });
      bus.emit("auth:changed", state.user);
    } catch (error) {
      setStatus(friendlyAuthError(error), "error");
    } finally {
      setBusy(false);
    }
  });

  bus.on("auth:expired", handleExpired);

  if (getToken()) refreshUser();
}
