/* AFG AI · image generation dialog */

import { $, bus } from "./core.js";
import { api } from "./api.js";
import { t } from "./i18n.js";
import { closeOverlay, openOverlay, toast } from "./ui.js";

let busy = false;

function setStatus(message, kind = "") {
  const node = $("#imageStatus");
  if (!node) return;
  node.textContent = message || "";
  node.className = `form-status${kind ? " " + kind : ""}`;
}

function errorMessage(error) {
  if (error?.code === "image_unconfigured") return t("errorImageConfig");
  if (error?.code === "rate_limited" || error?.status === 429) return t("errorRateLimit");
  if (error?.code === "image_timeout" || error?.code === "timeout") return t("errorTimeout");
  if (error?.code === "network") return t("errorNetwork");
  if (error?.code === "empty_prompt") return t("promptRequired");
  return t("imageFailed");
}

export function openImage() {
  const prompt = $("#imagePrompt");
  const composerText = String($("#prompt")?.value || "").trim();
  if (prompt && !prompt.value && composerText) prompt.value = composerText.slice(0, 4000);
  setStatus("");
  openOverlay("imageModal");
  setTimeout(() => $("#imagePrompt")?.focus({ preventScroll: true }), 60);
}

async function generate(event) {
  event.preventDefault();
  if (busy) return;
  const prompt = String($("#imagePrompt")?.value || "").trim();
  if (!prompt) {
    setStatus(t("promptRequired"), "error");
    $("#imagePrompt")?.focus();
    return;
  }
  const size = $("#imageSize")?.value || "1024x1024";
  const button = $("#imageGenerate");
  busy = true;
  if (button) {
    button.disabled = true;
    button.textContent = t("imageGenerating");
  }
  setStatus(t("imageGenerating"));
  try {
    const data = await api.image({ prompt, size });
    if (!data?.imageUrl) throw new Error("empty image");
    closeOverlay("imageModal");
    $("#imagePrompt").value = "";
    setStatus("");
    bus.emit("image:result", data);
  } catch (error) {
    setStatus(errorMessage(error), "error");
    toast(errorMessage(error), { type: "error" });
  } finally {
    busy = false;
    if (button) {
      button.disabled = false;
      button.textContent = t("generate");
    }
  }
}

export function initImage() {
  $("#imageBtn")?.addEventListener("click", openImage);
  $("#imageForm")?.addEventListener("submit", generate);

  bus.on("overlay:open", (id) => {
    if (id === "imageModal" && !busy) {
      setStatus("");
      const button = $("#imageGenerate");
      if (button) button.textContent = t("generate");
    }
  });

  bus.on("language", () => {
    if (!busy) {
      const button = $("#imageGenerate");
      if (button) button.textContent = t("generate");
    }
  });
}
