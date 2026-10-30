/* AFG AI · toasts, overlays, focus handling and small DOM helpers */

import { $, bus } from "./core.js";
import { t } from "./i18n.js";

const overlayStack = [];
let restoreFocus = null;

/* --------------------------------- Toasts --------------------------------- */
const TOAST_LIMIT = 4;

export function toast(message, { type = "info", timeout = 3600 } = {}) {
  const stack = $("#toasts");
  if (!stack || !message) return null;
  const node = document.createElement("div");
  node.className = `toast ${type}`;
  node.textContent = String(message);
  stack.appendChild(node);
  while (stack.children.length > TOAST_LIMIT) stack.firstElementChild?.remove();
  const remove = () => {
    node.classList.add("is-leaving");
    setTimeout(() => node.remove(), 220);
  };
  const timer = setTimeout(remove, Math.max(1200, timeout));
  node.addEventListener("click", () => {
    clearTimeout(timer);
    remove();
  });
  return node;
}

/* -------------------------------- Overlays -------------------------------- */
function focusableWithin(root) {
  return Array.from(
    root.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((node) => node.offsetParent !== null || node === document.activeElement);
}

export function openOverlay(id) {
  const element = document.getElementById(id);
  if (!element || !element.hidden) return element;
  restoreFocus = document.activeElement;
  overlayStack.push(id);
  element.hidden = false;
  bus.emit("overlay:open", id);
  requestAnimationFrame(() => {
    const preferred = element.querySelector("[autofocus]");
    const target = preferred || focusableWithin(element)[0];
    target?.focus({ preventScroll: true });
  });
  return element;
}

export function closeOverlay(id) {
  const element = document.getElementById(id);
  if (!element || element.hidden) return;
  element.hidden = true;
  const index = overlayStack.lastIndexOf(id);
  if (index >= 0) overlayStack.splice(index, 1);
  bus.emit("overlay:closed", id);
  if (!overlayStack.length && restoreFocus && document.contains(restoreFocus)) {
    try {
      restoreFocus.focus({ preventScroll: true });
    } catch {
      /* ignore */
    }
    restoreFocus = null;
  }
}

export const openModal = openOverlay;
export const closeModal = closeOverlay;

export function closeTopOverlay() {
  const id = overlayStack[overlayStack.length - 1];
  if (id) closeOverlay(id);
}

export function isOverlayOpen(id) {
  return overlayStack.includes(id);
}

function trapFocus(event) {
  const id = overlayStack[overlayStack.length - 1];
  const element = id ? document.getElementById(id) : null;
  if (!element) return;
  const nodes = focusableWithin(element);
  if (!nodes.length) {
    event.preventDefault();
    return;
  }
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !element.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

/* ------------------------------ Confirm dialog ---------------------------- */
export function confirmDialog({
  title = t("confirmTitle"),
  message,
  confirmLabel = t("remove"),
  cancelLabel = t("cancel"),
  danger = true
} = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal";
    overlay.id = "confirmDialog";
    overlay.innerHTML = `
      <div class="modal-card confirm-card" role="dialog" aria-modal="true" aria-labelledby="confirmTitle">
        <div class="modal-head">
          <span class="modal-head-icon" aria-hidden="true">!</span>
          <div class="modal-head-copy">
            <h2 id="confirmTitle"></h2>
            <p></p>
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn" type="button" data-confirm="cancel"></button>
          <button class="btn ${danger ? "btn-danger" : "btn-primary"}" type="button" data-confirm="ok"></button>
        </div>
      </div>`;
    overlay.querySelector("h2").textContent = title;
    overlay.querySelector("p").textContent = message || "";
    overlay.querySelector('[data-confirm="cancel"]').textContent = cancelLabel;
    overlay.querySelector('[data-confirm="ok"]').textContent = confirmLabel;
    document.body.appendChild(overlay);

    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      overlay.remove();
      bus.emit("overlay:closed", "confirmDialog");
      resolve(value);
    };
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) finish(false);
      const button = event.target.closest("[data-confirm]");
      if (!button) return;
      finish(button.dataset.confirm === "ok");
    });
    overlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
    });
    restoreFocus = document.activeElement;
    overlayStack.push("confirmDialog");
    bus.emit("overlay:open", "confirmDialog");
    requestAnimationFrame(() => {
      overlay.querySelector('[data-confirm="ok"]')?.focus({ preventScroll: true });
    });
  });
}

/* ------------------------------- Clipboard -------------------------------- */
export async function copyText(value, successMessage = t("copied")) {
  const text = String(value ?? "");
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      throw new Error("clipboard unavailable");
    }
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }
    area.remove();
    if (!copied) {
      toast(t("copyFailed"), { type: "error" });
      return false;
    }
  }
  if (successMessage) toast(successMessage, { type: "success", timeout: 2000 });
  return true;
}

/* --------------------------------- Files ---------------------------------- */
function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * Save a text file. On Android the native bridge can place it in Downloads or
 * open a share sheet; browsers fall back to a normal download.
 */
export function saveTextFile(filename, mime, content) {
  const safeName = String(filename || "afg-ai.txt").replace(/[^\w.-]+/g, "-");
  const bridge = globalThis.AFGApp;
  if (bridge && typeof bridge.saveTextFile === "function") {
    try {
      if (bridge.saveTextFile(safeName, mime, content)) return true;
    } catch {
      /* fall through to download */
    }
  }
  triggerDownload(new Blob([content], { type: mime || "text/plain;charset=utf-8" }), safeName);
  return true;
}

export function saveImageFile(filename, dataUrl) {
  const bridge = globalThis.AFGApp;
  if (bridge && typeof bridge.saveImage === "function") {
    try {
      if (bridge.saveImage(String(filename || "afg-ai.png"), String(dataUrl))) return true;
    } catch {
      /* fall through to download */
    }
  }
  if (/^data:image\//i.test(dataUrl)) {
    const [head, body] = dataUrl.split(",");
    const mime = head.slice(5).split(";")[0] || "image/png";
    const bytes = atob(body || "");
    const buffer = new Uint8Array(bytes.length);
    for (let index = 0; index < bytes.length; index += 1) buffer[index] = bytes.charCodeAt(index);
    triggerDownload(new Blob([buffer], { type: mime }), filename || "afg-ai.png");
    return true;
  }
  window.open(dataUrl, "_blank", "noopener");
  return false;
}

/* ------------------------------- Connection ------------------------------- */
const STATUS_IDS = ["statusDot", "sidebarStatusDot"];
const TEXT_IDS = ["statusText", "sidebarStatusText"];
const STATUS_KEYS = { online: "statusOnline", offline: "statusOffline", connecting: "statusConnecting" };

export function setConnection(status, label) {
  const normalized = ["online", "offline", "connecting"].includes(status) ? status : "connecting";
  for (const id of STATUS_IDS) {
    const node = document.getElementById(id);
    if (node) node.className = `status-dot ${normalized}`;
  }
  const text = label || t(STATUS_KEYS[normalized]);
  for (const id of TEXT_IDS) {
    const node = document.getElementById(id);
    if (node) node.textContent = text;
  }
}

/* --------------------------------- Scroll --------------------------------- */
export function scrollToBottom(element, smooth = true) {
  if (!element) return;
  element.scrollTo({ top: element.scrollHeight, behavior: smooth ? "smooth" : "auto" });
}

export function nearBottom(element, threshold = 140) {
  if (!element) return true;
  return element.scrollHeight - element.scrollTop - element.clientHeight < threshold;
}

/* ---------------------------------- Init ---------------------------------- */
export function initUi() {
  document.addEventListener("click", (event) => {
    const closer = event.target.closest("[data-close]");
    if (closer) {
      event.preventDefault();
      closeOverlay(closer.dataset.close);
      return;
    }
    const overlay = event.target;
    if (overlay.classList?.contains("modal") && overlay.id) {
      // Runtime confirm dialogs handle themselves; standard dialogs close on a
      // backdrop click for a fast mobile feel.
      if (overlay.id !== "confirmDialog") closeOverlay(overlay.id);
    } else if (overlay.classList?.contains("palette") && overlay.id) {
      closeOverlay(overlay.id);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (!overlayStack.length) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeTopOverlay();
      return;
    }
    if (event.key === "Tab") trapFocus(event);
  });
}
