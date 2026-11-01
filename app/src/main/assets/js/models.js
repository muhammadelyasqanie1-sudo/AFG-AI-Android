/* AFG AI · live model catalog, grouped picker and routing strip */

import { $, bus, getPrefs, setPref } from "./core.js";
import { api } from "./api.js";
import { groupLabel, modelTierLabel, t } from "./i18n.js";
import { toast } from "./ui.js";

const GROUP_ORDER = ["claude", "codex", "uncensored", "cloudflare", "multi", "local"];

const state = {
  models: [],
  byUid: new Map(),
  providers: [],
  groups: [],
  recommended: {},
  count: 0,
  configured: false,
  loading: false,
  loaded: false,
  error: null
};

let requestId = 0;

export function getModelsState() {
  return state;
}

export function getModelByRef(ref) {
  if (!ref || ref === "auto") return null;
  return state.byUid.get(ref) || state.models.find((model) => model.id === ref) || null;
}

export function modelDisplayName(ref) {
  const model = getModelByRef(ref);
  if (!model) return ref && ref !== "auto" ? String(ref) : t("modelAuto");
  return model.name || model.displayName || model.id;
}

export function recommendedFor(mode = getPrefs().mode) {
  return state.recommended?.[mode] || state.recommended?.chat || state.models[0]?.uid || null;
}

export function getSelectedModel() {
  const pref = getPrefs().model;
  if (!pref || pref === "auto") return "auto";
  return state.byUid.has(pref) ? pref : "auto";
}

function option(label, value) {
  const node = document.createElement("option");
  node.value = value;
  node.textContent = label;
  return node;
}

function groupModels() {
  const buckets = new Map();
  for (const model of state.models) {
    const group = GROUP_ORDER.includes(model.group) ? model.group : "multi";
    if (!buckets.has(group)) buckets.set(group, []);
    buckets.get(group).push(model);
  }
  return [...buckets.entries()].sort(
    (a, b) => GROUP_ORDER.indexOf(a[0]) - GROUP_ORDER.indexOf(b[0])
  );
}

function renderSelect() {
  const select = $("#modelSelect");
  if (!select) return;
  select.innerHTML = "";
  select.appendChild(option(t("modelAuto"), "auto"));

  if (state.loading && !state.models.length) {
    select.appendChild(option(t("loadingModels"), "__loading"));
    select.disabled = true;
    return;
  }
  if (state.error && !state.models.length) {
    select.appendChild(option(t("modelLoadError"), "__error"));
    select.disabled = true;
    return;
  }
  if (!state.models.length) {
    select.appendChild(option(t("modelNone"), "__none"));
    select.disabled = true;
    return;
  }

  for (const [group, models] of groupModels()) {
    const optgroup = document.createElement("optgroup");
    optgroup.label = groupLabel(group);
    for (const model of models) {
      const tier = modelTierLabel(model.tier);
      const name = model.name || model.displayName || model.id;
      optgroup.appendChild(option(`${name} · ${tier}`, model.uid));
    }
    select.appendChild(optgroup);
  }

  select.disabled = false;
  const selected = getSelectedModel();
  select.value = selected;
  if (select.value !== selected) select.value = "auto";
}

export function renderRouteStrip() {
  const title = $("#routeTitle");
  const detail = $("#routeDetail");
  if (!title || !detail) return;
  const selected = getSelectedModel();
  detail.classList.remove("error");

  if (selected !== "auto") {
    const model = getModelByRef(selected);
    title.textContent = t("autoRoutePinned");
    detail.textContent = model
      ? `${model.provider || model.providerId} · ${modelTierLabel(model.tier)}`
      : t("autoRoutePinnedDetail");
    return;
  }

  title.textContent = t("autoRouteTitle");
  if (state.loading && !state.models.length) {
    detail.textContent = t("loadingModels");
    return;
  }
  if (state.error && !state.models.length) {
    detail.textContent = t("modelLoadError");
    detail.classList.add("error");
    return;
  }
  if (!state.models.length) {
    detail.textContent = t("modelNone");
    detail.classList.add("error");
    return;
  }
  const recommended = getModelByRef(recommendedFor());
  detail.textContent = recommended
    ? t("routeRecommended", { model: recommended.name || recommended.id })
    : t("autoRouteDetail");
}

export function setSelectedModel(ref) {
  const value = ref && ref !== "auto" && state.byUid.has(ref) ? ref : "auto";
  setPref("model", value);
  const select = $("#modelSelect");
  if (select) select.value = value;
  renderRouteStrip();
}

export async function loadModels({ force = false, notify = false } = {}) {
  const current = ++requestId;
  state.loading = true;
  state.error = null;
  const refreshButton = $("#refreshModels");
  if (refreshButton) refreshButton.disabled = true;
  renderSelect();
  renderRouteStrip();

  try {
    const data = await api.models({ force });
    if (current !== requestId) return null;
    const models = Array.isArray(data?.models) ? data.models : [];
    state.models = models.filter(
      (model) => model && typeof model.uid === "string" && typeof model.id === "string"
    );
    state.byUid = new Map(state.models.map((model) => [model.uid, model]));
    state.providers = Array.isArray(data?.providers) ? data.providers : [];
    state.groups = Array.isArray(data?.groups) ? data.groups : [];
    state.recommended = data?.recommended && typeof data.recommended === "object" ? data.recommended : {};
    state.count = Number(data?.count) || state.models.length;
    state.configured = Boolean(data?.configured);
    state.loaded = true;
    state.error = null;
    if (notify) {
      toast(t("modelsAvailable", { count: state.models.length }), { type: "success" });
    }
  } catch (error) {
    if (current !== requestId) return null;
    state.error = error;
    state.loaded = true;
    if (notify) toast(t("modelLoadError"), { type: "error" });
  } finally {
    if (current === requestId) {
      state.loading = false;
      if (refreshButton) refreshButton.disabled = false;
      renderSelect();
      renderRouteStrip();
      bus.emit("models:changed", state);
    }
  }
  return state;
}

export function refreshModels() {
  return loadModels({ force: true, notify: true });
}

export function initModels() {
  const select = $("#modelSelect");
  select?.addEventListener("change", () => {
    setSelectedModel(select.value);
    bus.emit("model:selected", getSelectedModel());
  });
  $("#refreshModels")?.addEventListener("click", () => refreshModels());
  bus.on("language", () => {
    renderSelect();
    renderRouteStrip();
  });
  bus.on("mode", () => renderRouteStrip());
  renderSelect();
  renderRouteStrip();
  return loadModels();
}
