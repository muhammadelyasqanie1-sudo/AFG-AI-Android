/**
 * Provider catalog: discovers which models are actually usable right now.
 * Keys never leave the server. The client receives only descriptive metadata.
 * Extended with Gemini, Grok, Cohere, Mistral, Azure, Bedrock, Vertex AI.
 */

const VISION_RE = /(claude|gpt-4|gpt-5|gemini|vision|llava|pixtral|omni|qwen[\w.-]*(vl|vision)|glm-[\d.]+v|internvl)/i;
const CODING_RE = /(codex|coder|code|devstral|deepseek|sonnet|opus|gpt-5|gpt-4\.1|qwen[\w.-]*coder)/i;
const REASONING_RE = /(opus|sonnet|o[1-4](\b|-)|r1|reason|thinking|gpt-5|deepseek-r1|qwq)/i;
const FAST_RE = /(haiku|mini|flash|turbo|lite|air|small|nano|8b|7b|3b)/i;
const LONG_RE = /(claude|gpt-4\.1|gpt-5|gemini|deepseek|glm|qwen|128k|200k|1m)/i;

export function inferCapabilities(id, { api } = {}) {
  const name = String(id || "").toLowerCase();
  return {
    vision: api === "anthropic" || VISION_RE.test(name),
    coding: CODING_RE.test(name),
    reasoning: REASONING_RE.test(name),
    fast: FAST_RE.test(name),
    longContext: LONG_RE.test(name),
    streaming: true,
    tools: /(gpt-4|gpt-5|claude-3|claude-4|gemini|mistral-large|cohere-command|azure)/i.test(name),
    jsonMode: /(gpt-4|gpt-5|claude|gemini|mistral|cohere)/i.test(name),
  };
}

export function inferTier(id) {
  const name = String(id || "").toLowerCase();
  if (/(opus|o3(?!-mini)|o1(?!-mini)|r1(?!-distill)|ultra|gpt-5-pro|gemini-1.5-pro|claude-3-opus|claude-4-opus)/i.test(name)) return "ultra";
  if (/(sonnet|gpt-5|gpt-4\.1(?!-mini)|deepseek-chat|glm-4\.5(?!-air)|kimi|qwen-max|gemini-1.5-flash|claude-3.5-sonnet|claude-4-sonnet|mistral-large|cohere-command-r\+)/i.test(name)) {
    return "pro";
  }
  if (FAST_RE.test(name)) return "fast";
  return "standard";
}

export const RELAY_GROUPS = [
  {
    id: "llmsrelay-claude",
    group: "claude",
    label: "Claude · Basic / Pro",
    keyEnv: "LLMSRELAY_CLAUDE_API_KEY",
    api: "anthropic",
    baseUrl: "https://api.llmsrelay.com",
    tier: "pro",
    priority: 10,
  },
  {
    id: "llmsrelay-codex",
    group: "codex",
    label: "GPT / Codex · Codex Pro",
    keyEnv: "LLMSRELAY_CODEX_API_KEY",
    api: "openai",
    baseUrl: "https://api.llmsrelay.com",
    tier: "pro",
    priority: 20,
  },
  {
    id: "llmsrelay-uncensored",
    group: "uncensored",
    label: "GLM / DeepSeek · Uncensored",
    keyEnv: "LLMSRELAY_UNCENSORED_API_KEY",
    api: "openai",
    baseUrl: "https://api.llmsrelay.com",
    tier: "standard",
    priority: 30,
  },
];

function splitList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function createProviderDescriptors(config) {
  const p = config.providers;
  const descriptors = p.relayGroups.map((group) => ({
    id: group.id,
    label: group.label,
    api: group.api,
    baseUrl: group.baseUrl,
    key: p.relayKeys?.[group.group] || "",
    group: group.group,
    tier: group.tier,
    priority: group.priority,
    kind: "relay",
    dynamic: "relay",
    staticModels: [],
  }));

  // Native Anthropic
  if (p.anthropicKey) {
    descriptors.push({
      id: "anthropic",
      label: "Anthropic",
      api: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      key: p.anthropicKey,
      group: "claude",
      tier: "pro",
      priority: 40,
      kind: "native",
      dynamic: null,
      staticModels: p.anthropicModels,
    });
  }

  // Native OpenAI
  if (p.openaiKey) {
    descriptors.push({
      id: "openai",
      label: "OpenAI",
      api: "openai",
      baseUrl: p.openaiBaseUrl,
      key: p.openaiKey,
      group: "codex",
      tier: "pro",
      priority: 50,
      kind: "native",
      dynamic: "openai",
      staticModels: p.openaiModels,
    });
  }

  // OpenRouter
  if (p.openrouterKey) {
    descriptors.push({
      id: "openrouter",
      label: "OpenRouter",
      api: "openai",
      baseUrl: p.openrouterBaseUrl,
      key: p.openrouterKey,
      group: "multi",
      tier: "pro",
      priority: 60,
      kind: "native",
      dynamic: "openai",
      staticModels: [],
    });
  }

  // Google Gemini
  if (p.geminiKey) {
    descriptors.push({
      id: "gemini",
      label: "Google Gemini",
      api: "gemini",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      key: p.geminiKey,
      group: "gemini",
      tier: "pro",
      priority: 55,
      kind: "native",
      dynamic: "gemini",
      staticModels: p.geminiModels || ["gemini-1.5-pro", "gemini-1.5-flash", "gemini-1.0-pro"],
    });
  }

  // xAI Grok
  if (p.grokKey) {
    descriptors.push({
      id: "grok",
      label: "xAI Grok",
      api: "openai",
      baseUrl: "https://api.x.ai/v1",
      key: p.grokKey,
      group: "grok",
      tier: "pro",
      priority: 65,
      kind: "native",
      dynamic: "openai",
      staticModels: p.grokModels || ["grok-beta", "grok-vision-beta"],
    });
  }

  // Cohere
  if (p.cohereKey) {
    descriptors.push({
      id: "cohere",
      label: "Cohere",
      api: "cohere",
      baseUrl: "https://api.cohere.ai/v1",
      key: p.cohereKey,
      group: "cohere",
      tier: "pro",
      priority: 70,
      kind: "native",
      dynamic: "cohere",
      staticModels: p.cohereModels || ["command-r-plus", "command-r", "command"],
    });
  }

  // Mistral
  if (p.mistralKey) {
    descriptors.push({
      id: "mistral",
      label: "Mistral AI",
      api: "mistral",
      baseUrl: "https://api.mistral.ai/v1",
      key: p.mistralKey,
      group: "mistral",
      tier: "pro",
      priority: 75,
      kind: "native",
      dynamic: "mistral",
      staticModels: p.mistralModels || ["mistral-large-latest", "mistral-medium", "mistral-small", "codestral-latest"],
    });
  }

  // Azure OpenAI
  if (p.azureOpenaiKey && p.azureOpenaiEndpoint) {
    descriptors.push({
      id: "azure",
      label: "Azure OpenAI",
      api: "openai",
      baseUrl: p.azureOpenaiEndpoint.replace(/\/+$/, "") + "/openai/deployments",
      key: p.azureOpenaiKey,
      group: "azure",
      tier: "pro",
      priority: 45,
      kind: "native",
      dynamic: "azure",
      staticModels: p.azureOpenaiModels || [],
      apiVersion: p.azureOpenaiApiVersion || "2024-02-15-preview",
    });
  }

  // AWS Bedrock
  if (p.bedrockAccessKey && p.bedrockSecretKey && p.bedrockRegion) {
    descriptors.push({
      id: "bedrock",
      label: "AWS Bedrock",
      api: "bedrock",
      baseUrl: `https://bedrock-runtime.${p.bedrockRegion}.amazonaws.com`,
      key: p.bedrockAccessKey,
      secret: p.bedrockSecretKey,
      region: p.bedrockRegion,
      group: "bedrock",
      tier: "pro",
      priority: 80,
      kind: "native",
      dynamic: "bedrock",
      staticModels: p.bedrockModels || ["anthropic.claude-3-sonnet-20240229-v1:0", "anthropic.claude-3-haiku-20240307-v1:0", "meta.llama3-70b-instruct-v1:0"],
    });
  }

  // Google Vertex AI
  if (p.vertexProjectId && p.vertexLocation && p.vertexCredentials) {
    descriptors.push({
      id: "vertex",
      label: "Google Vertex AI",
      api: "vertex",
      baseUrl: `https://${p.vertexLocation}-aiplatform.googleapis.com/v1`,
      key: p.vertexCredentials,
      projectId: p.vertexProjectId,
      location: p.vertexLocation,
      group: "vertex",
      tier: "pro",
      priority: 85,
      kind: "native",
      dynamic: "vertex",
      staticModels: p.vertexModels || ["gemini-1.5-pro-001", "gemini-1.5-flash-001"],
    });
  }

  // Ollama (local)
  if (p.ollamaBaseUrl) {
    descriptors.push({
      id: "ollama",
      label: "Local · Ollama",
      api: "openai",
      baseUrl: p.ollamaBaseUrl.replace(/\/+$/, "") + "/v1",
      key: "ollama",
      group: "local",
      tier: "fast",
      priority: 90,
      kind: "local",
      dynamic: "ollama",
      staticModels: p.ollamaModels,
    });
  }

  return descriptors;
}

function fetchJson(fetchImpl, url, options, timeoutMs = 12000) {
  return fetchImpl(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
}

async function discover(descriptor, fetchImpl) {
  if (!descriptor.key && descriptor.kind !== "local") return [];
  if (descriptor.dynamic === "relay") {
    const response = await fetchJson(fetchImpl, descriptor.baseUrl + "/v1/models", {
      headers: {
        "x-api-key": descriptor.key,
        Authorization: "Bearer " + descriptor.key,
      },
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const data = await response.json().catch(() => ({}));
    return (Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : [])
      .map((item) => (item && typeof item.id === "string" ? item.id : ""))
      .filter(Boolean);
  }
  if (descriptor.dynamic === "openai") {
    const response = await fetchJson(fetchImpl, descriptor.baseUrl + "/models", {
      headers: { Authorization: "Bearer " + descriptor.key },
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const data = await response.json().catch(() => ({}));
    const items = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : [];
    return items
      .map((item) => (item && typeof item.id === "string" ? item.id : ""))
      .filter(Boolean)
      .slice(0, 150);
  }
  if (descriptor.dynamic === "gemini") {
    const response = await fetchJson(fetchImpl, descriptor.baseUrl + "/models", {
      headers: { "x-goog-api-key": descriptor.key },
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const data = await response.json().catch(() => ({}));
    return (Array.isArray(data.models) ? data.models : [])
      .map((item) => (item && typeof item.name === "string" ? item.name.replace("models/", "") : ""))
      .filter(Boolean);
  }
  if (descriptor.dynamic === "cohere") {
    const response = await fetchJson(fetchImpl, descriptor.baseUrl + "/models", {
      headers: { Authorization: "Bearer " + descriptor.key },
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const data = await response.json().catch(() => ({}));
    return (Array.isArray(data.models) ? data.models : [])
      .map((item) => (item && typeof item.name === "string" ? item.name : ""))
      .filter(Boolean);
  }
  if (descriptor.dynamic === "mistral") {
    const response = await fetchJson(fetchImpl, descriptor.baseUrl + "/models", {
      headers: { Authorization: "Bearer " + descriptor.key },
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const data = await response.json().catch(() => ({}));
    return (Array.isArray(data.data) ? data.data : [])
      .map((item) => (item && typeof item.id === "string" ? item.id : ""))
      .filter(Boolean);
  }
  if (descriptor.dynamic === "azure") {
    const url = `${descriptor.baseUrl}?api-version=${descriptor.apiVersion}`;
    const response = await fetchJson(fetchImpl, url, {
      headers: { "api-key": descriptor.key },
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const data = await response.json().catch(() => ({}));
    return (Array.isArray(data.data) ? data.data : [])
      .map((item) => (item && typeof item.id === "string" ? item.id : ""))
      .filter(Boolean);
  }
  if (descriptor.dynamic === "ollama") {
    const base = descriptor.baseUrl.replace(/\/v1$/, "");
    const response = await fetchJson(fetchImpl, base + "/api/tags", {});
    if (!response.ok) throw new Error("HTTP " + response.status);
    const data = await response.json().catch(() => ({}));
    return (Array.isArray(data.models) ? data.models : [])
      .map((item) => (item && typeof item.name === "string" ? item.name : ""))
      .filter(Boolean);
  }
  // For bedrock and vertex, use static models (dynamic discovery requires AWS/GCP SDKs)
  return descriptor.staticModels;
}

function toModel(descriptor, rawId, displayName) {
  const id = String(rawId).trim();
  const src = descriptor.staticModels || [];
  const model = {
    uid: descriptor.id + ":" + id,
    id,
    name: displayName || id,
    displayName: displayName || id,
    providerId: descriptor.id,
    provider: descriptor.label,
    providerLabel: descriptor.label,
    group: descriptor.group,
    api: descriptor.api,
    tier: inferTier(id),
    capabilities: inferCapabilities(id, { api: descriptor.api }),
  };
  if (descriptor.tier && descriptor.tier === "fast") model.tier = "fast";
  Object.defineProperty(model, "_descriptor", { value: descriptor, enumerable: false });
  return model;
}

export function createCatalog(config, { fetchImpl = fetch } = {}) {
  let cache = { at: 0, models: [], providers: [] };
  let pending = null;

  async function refresh() {
    const descriptors = createProviderDescriptors(config);
    const results = await Promise.allSettled(
      descriptors.map(async (descriptor) => {
        let ids = [];
        try {
          ids = await discover(descriptor, fetchImpl);
        } catch (error) {
          descriptor.error = error.message;
          ids = descriptor.staticModels;
        }
        if (!ids.length) ids = descriptor.staticModels;
        return { descriptor, ids: [...new Set(ids)] };
      })
    );

    const seen = new Set();
    const models = [];
    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      for (const id of result.value.ids) {
        const key = result.value.descriptor.id + ":" + id;
        if (seen.has(key)) continue;
        seen.add(key);
        models.push(toModel(result.value.descriptor, id));
      }
    }

    models.sort((a, b) => {
      const pa = a._descriptor.priority || 999;
      const pb = b._descriptor.priority || 999;
      if (pa !== pb) return pa - pb;
      return a.id.localeCompare(b.id);
    });

    const providers = descriptors.map((descriptor) => ({
      id: descriptor.id,
      label: descriptor.label,
      group: descriptor.group,
      configured: Boolean(descriptor.key || descriptor.kind === "local"),
      available: models.some((model) => model.providerId === descriptor.id),
      kind: descriptor.kind,
      error: descriptor.error || null,
    }));

    cache = { at: Date.now(), models, providers };
    return cache;
  }

  async function get({ force = false } = {}) {
    const fresh = Date.now() - cache.at < config.providers.catalogTtlMs;
    if (!force && fresh && cache.models.length) return cache;
    if (!pending) {
      pending = refresh()
        .catch((error) => {
          console.warn("Model catalog refresh failed:", error.message);
          return cache;
        })
        .finally(() => {
          pending = null;
        });
    }
    return pending;
  }

  function find(modelRef) {
    if (!modelRef || typeof modelRef !== "string") return null;
    return (
      cache.models.find((model) => model.uid === modelRef) ||
      cache.models.find((model) => model.id === modelRef) ||
      null
    );
  }

  function invalidate() {
    cache = { at: 0, models: cache.models, providers: cache.providers };
  }

  return {
    get,
    find,
    invalidate,
    get cached() {
      return cache;
    },
    publicModels() {
      return cache.models.map(({ _descriptor, ...model }) => model);
    },
  };
}

export function resolveProviderKey(model, config) {
  const descriptor = model._descriptor;
  if (!descriptor) return "";
  if (descriptor.kind === "local") return "ollama";
  return descriptor.key || "";
}

export function resolveProviderDescriptor(model) {
  return model._descriptor || null;
}