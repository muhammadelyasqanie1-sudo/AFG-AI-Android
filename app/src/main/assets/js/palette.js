/* AFG AI · keyboard-first command palette */

import { $, bus, getPrefs, setPref, updatePrefs } from "./core.js";
import { getLanguage, setUiLanguage, t } from "./i18n.js";
import { closeOverlay, openOverlay, toast } from "./ui.js";
import { openAuth, openAccount, signOut, isSignedIn } from "./auth.js";
import {
  checkHealth,
  clearHistory,
  exportData,
  openSettings
} from "./settings.js";
import { openImage } from "./image.js";
import { refreshModels } from "./models.js";

const THEMES = ["midnight", "oled", "aurora"];

function commands() {
  const list = [
    {
      id: "new-chat",
      glyph: "＋",
      hint: "⌘⇧O",
      label: () => t("cmdNewChat"),
      run: () => bus.emit("conversation:new")
    },
    {
      id: "settings",
      glyph: "⚙",
      label: () => t("cmdSettings"),
      run: () => openSettings()
    },
    {
      id: "image",
      glyph: "✧",
      label: () => t("cmdImage"),
      run: () => openImage()
    },
    {
      id: "theme",
      glyph: "◐",
      label: () => t("cmdTheme"),
      run: () => {
        const current = getPrefs().theme;
        const next = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length];
        updatePrefs({ theme: next });
        toast(t("themeChanged"), { type: "success", timeout: 1800 });
      }
    },
    {
      id: "language",
      glyph: "文",
      label: () => t("cmdLanguage"),
      run: () => {
        setUiLanguage(getLanguage() === "en" ? "fa" : "en");
        toast(t("languageChanged"), { type: "success", timeout: 1800 });
      }
    },
    {
      id: "account",
      glyph: "◈",
      label: () => t("cmdAccount"),
      run: () => openAccount()
    },
    {
      id: "export",
      glyph: "▤",
      label: () => t("cmdExport"),
      run: () => exportData()
    },
    {
      id: "clear",
      glyph: "⌫",
      label: () => t("cmdClear"),
      run: () => clearHistory()
    },
    {
      id: "health",
      glyph: "⌁",
      label: () => t("cmdCheckHealth"),
      run: () => checkHealth()
    },
    {
      id: "models",
      glyph: "↻",
      label: () => t("cmdRefreshModels"),
      run: () => refreshModels()
    }
  ];

  for (const mode of ["chat", "research", "coding", "study", "creative"]) {
    list.push({
      id: "mode-" + mode,
      glyph: "✦",
      label: () => t("cmd" + mode[0].toUpperCase() + mode.slice(1)),
      run: () => {
        setPref("mode", mode);
        bus.emit("mode:set", mode);
      }
    });
  }

  if (isSignedIn()) {
    list.push({
      id: "signout",
      glyph: "⏻",
      label: () => t("cmdSignOut"),
      run: () => signOut()
    });
  } else {
    list.push({
      id: "signin",
      glyph: "→",
      label: () => t("signIn"),
      run: () => openAuth("signin")
    });
  }
  return list;
}

let filtered = [];
let active = 0;

function render() {
  const list = $("#paletteList");
  if (!list) return;
  const query = String($("#paletteInput")?.value || "").trim().toLowerCase();
  const all = commands();
  filtered = query
    ? all.filter((command) => command.label().toLowerCase().includes(query) || command.id.includes(query))
    : all;
  if (active >= filtered.length) active = Math.max(0, filtered.length - 1);
  list.innerHTML = "";

  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "empty-list";
    empty.textContent = t("paletteEmpty");
    list.appendChild(empty);
    return;
  }

  filtered.forEach((command, index) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `palette-item${index === active ? " is-active" : ""}`;
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", String(index === active));
    item.dataset.index = String(index);
    const glyph = document.createElement("span");
    glyph.className = "glyph";
    glyph.setAttribute("aria-hidden", "true");
    glyph.textContent = command.glyph;
    const label = document.createElement("span");
    label.textContent = command.label();
    item.appendChild(glyph);
    item.appendChild(label);
    if (command.hint) {
      const hint = document.createElement("span");
      hint.className = "palette-hint";
      hint.textContent = command.hint;
      item.appendChild(hint);
    }
    list.appendChild(item);
  });
}

function move(delta) {
  if (!filtered.length) return;
  active = (active + delta + filtered.length) % filtered.length;
  render();
  const activeNode = $("#paletteList")?.querySelector(".palette-item.is-active");
  activeNode?.scrollIntoView({ block: "nearest" });
}

function run(index = active) {
  const command = filtered[index];
  if (!command) return;
  closeOverlay("palette");
  // Let the overlay close before another one opens on top of it.
  setTimeout(() => command.run(), 10);
}

export function openPalette() {
  const input = $("#paletteInput");
  if (input) input.value = "";
  active = 0;
  render();
  openOverlay("palette");
  setTimeout(() => input?.focus({ preventScroll: true }), 40);
}

export function initPalette() {
  $("#paletteBtn")?.addEventListener("click", openPalette);
  $("#paletteInput")?.addEventListener("input", () => {
    active = 0;
    render();
  });

  $("#paletteInput")?.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      run();
    }
  });

  $("#paletteList")?.addEventListener("click", (event) => {
    const item = event.target.closest(".palette-item");
    if (!item) return;
    run(Number(item.dataset.index));
  });

  document.addEventListener("keydown", (event) => {
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.key.toLowerCase() === "k" && !event.shiftKey) {
      event.preventDefault();
      if ($("#palette")?.hidden === false) closeOverlay("palette");
      else {
        // Ctrl+K is for commands; the native prompt stays untouched.
        const openSettingsOverlay = $("#settingsModal")?.hidden === false;
        if (openSettingsOverlay) closeOverlay("settingsModal");
        openPalette();
      }
    } else if (mod && event.shiftKey && event.key.toLowerCase() === "o") {
      event.preventDefault();
      bus.emit("conversation:new");
      closeOverlay("palette");
    }
  });

  bus.on("overlay:open", (id) => {
    if (id === "palette") {
      active = 0;
      render();
      setTimeout(() => $("#paletteInput")?.focus({ preventScroll: true }), 40);
    }
  });

  bus.on("language", () => {
    if ($("#palette")?.hidden === false) render();
  });
}
