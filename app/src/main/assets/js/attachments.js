/* AFG AI · image and text-file attachments for multimodal prompts */

import { $, formatBytes } from "./core.js";
import { t } from "./i18n.js";
import { toast } from "./ui.js";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_BYTES = 1.5 * 1024 * 1024;
const MAX_TEXT_CHARS = 20000;
const MAX_MESSAGE_CHARS = 24000;

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "csv",
  "json",
  "log",
  "js",
  "mjs",
  "ts",
  "jsx",
  "tsx",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "kt",
  "html",
  "htm",
  "css",
  "xml",
  "yaml",
  "yml",
  "toml",
  "ini",
  "sh"
]);

let attachment = null;
let menuOpen = false;

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

function readAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("read failed"));
    reader.readAsText(file);
  });
}

function extensionOf(name) {
  const parts = String(name || "").toLowerCase().split(".");
  return parts.length > 1 ? parts.pop() : "";
}

function renderPreview() {
  const wrap = $("#attachmentPreview");
  const thumb = $("#attachmentThumb");
  const name = $("#attachmentName");
  const size = $("#attachmentSize");
  if (!wrap || !thumb || !name || !size) return;
  if (!attachment) {
    wrap.hidden = true;
    thumb.removeAttribute("src");
    name.textContent = "";
    size.textContent = "";
    return;
  }
  wrap.hidden = false;
  if (attachment.kind === "image") {
    thumb.src = attachment.dataUrl;
    thumb.alt = t("attachmentImage");
  } else {
    thumb.src = "./icon.svg";
    thumb.alt = t("attachmentTextFile");
  }
  name.textContent = attachment.name;
  const kind = attachment.kind === "image" ? t("attachmentImage") : t("attachmentTextFile");
  size.textContent = `${kind} · ${formatBytes(attachment.size)}`;
}

function setAttachment(next) {
  attachment = next;
  renderPreview();
  if (!next) return;
  toast(next.kind === "image" ? t("attachImageLoaded") : t("attachLoaded"), {
    type: "success",
    timeout: 2400
  });
  $("#prompt")?.focus({ preventScroll: true });
}

export function getAttachment() {
  return attachment;
}

export function clearAttachment() {
  attachment = null;
  renderPreview();
}

export function consumeAttachment() {
  const value = attachment;
  attachment = null;
  renderPreview();
  return value;
}

export function openAttachmentMenu(open = !menuOpen) {
  const menu = $("#attachMenu");
  const button = $("#attachBtn");
  menuOpen = Boolean(open);
  if (menu) menu.hidden = !menuOpen;
  button?.setAttribute("aria-expanded", String(menuOpen));
}

export async function addFile(file) {
  if (!file) return false;
  const name = String(file.name || (file.type.startsWith("image/") ? "image" : "file"));
  const type = String(file.type || "").toLowerCase();

  if (type.startsWith("image/")) {
    if (!IMAGE_TYPES.has(type)) {
      toast(t("attachImageType"), { type: "error" });
      return false;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast(t("attachImageLimit"), { type: "error" });
      return false;
    }
    try {
      const dataUrl = await readAsDataUrl(file);
      setAttachment({ kind: "image", name, size: file.size, mime: type, dataUrl });
      return true;
    } catch {
      toast(t("errorGeneric"), { type: "error" });
      return false;
    }
  }

  const extension = extensionOf(name);
  const looksText =
    TEXT_EXTENSIONS.has(extension) || type.startsWith("text/") || type === "application/json";
  if (!looksText) {
    toast(t("attachFileType"), { type: "error" });
    return false;
  }
  if (file.size > MAX_TEXT_BYTES) {
    toast(t("attachFileLimit"), { type: "error" });
    return false;
  }
  try {
    const text = await readAsText(file);
    setAttachment({
      kind: "text",
      name,
      size: file.size,
      mime: type || "text/plain",
      text: text.slice(0, MAX_TEXT_CHARS)
    });
    return true;
  } catch {
    toast(t("errorGeneric"), { type: "error" });
    return false;
  }
}

/**
 * Combine the typed prompt with any attachment into the message that is both
 * displayed and sent. Images travel separately as a data URL.
 */
export function buildUserContent(text, value = attachment) {
  const typed = String(text || "").trim();
  if (!value) return typed;
  if (value.kind === "image") return typed || t("imageOnlyPrompt");
  const body = String(value.text || "").replace(/\r\n?/g, "\n");
  const fence = "```";
  const block = `${fence}${extensionOf(value.name) || "text"} · ${value.name}\n${body}\n${fence}`;
  return (typed ? `${typed}\n\n${block}` : block).slice(0, MAX_MESSAGE_CHARS);
}

function handleFiles(files) {
  const list = Array.from(files || []);
  if (!list.length) return;
  const preferred =
    list.find((file) => IMAGE_TYPES.has(String(file.type || "").toLowerCase())) || list[0];
  addFile(preferred);
}

export function initAttachments() {
  const attachButton = $("#attachBtn");
  const menu = $("#attachMenu");
  const photoInput = $("#photoInput");
  const cameraInput = $("#cameraInput");
  const fileInput = $("#fileInput");
  const prompt = $("#prompt");
  const composer = $("#chatForm");

  attachButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    openAttachmentMenu();
  });

  $("#choosePhoto")?.addEventListener("click", () => {
    openAttachmentMenu(false);
    photoInput?.click();
  });

  $("#takePhoto")?.addEventListener("click", () => {
    openAttachmentMenu(false);
    const bridge = globalThis.AFGCamera;
    if (bridge && typeof bridge.setCameraMode === "function") {
      try {
        bridge.setCameraMode(true);
      } catch {
        /* the system picker will still open */
      }
    }
    if (cameraInput) cameraInput.click();
    else if (!bridge) toast(t("cameraUnavailable"), { type: "error" });
  });

  $("#chooseFile")?.addEventListener("click", () => {
    openAttachmentMenu(false);
    fileInput?.click();
  });

  for (const input of [photoInput, cameraInput, fileInput]) {
    input?.addEventListener("change", () => {
      const file = input.files && input.files[0];
      if (file) handleFiles([file]);
      input.value = "";
    });
  }

  $("#removeAttachment")?.addEventListener("click", () => clearAttachment());

  document.addEventListener("click", (event) => {
    if (!menuOpen) return;
    if (menu?.contains(event.target) || attachButton?.contains(event.target)) return;
    openAttachmentMenu(false);
  });

  composer?.addEventListener("dragover", (event) => {
    if (!event.dataTransfer?.types?.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });
  composer?.addEventListener("drop", (event) => {
    if (!event.dataTransfer?.files?.length) return;
    event.preventDefault();
    openAttachmentMenu(false);
    handleFiles(event.dataTransfer.files);
  });

  prompt?.addEventListener("paste", (event) => {
    const items = Array.from(event.clipboardData?.items || []);
    const imageItem = items.find((item) => item.type.startsWith("image/"));
    if (!imageItem) return;
    const file = imageItem.getAsFile();
    if (!file) return;
    event.preventDefault();
    handleFiles([file]);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menuOpen) openAttachmentMenu(false);
  });

  renderPreview();
}
