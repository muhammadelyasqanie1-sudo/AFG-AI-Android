import test from "node:test";
import assert from "node:assert/strict";
import { inferCapabilities, inferTier } from "../server/providers/catalog.js";
import { routeModels, scoreModel, buildFallbackChain } from "../server/providers/router.js";

function model(id, overrides = {}) {
  return {
    uid: (overrides.providerId || "test") + ":" + id,
    id,
    providerId: overrides.providerId || "test",
    group: overrides.group || "codex",
    tier: overrides.tier || inferTier(id),
    capabilities: overrides.capabilities || inferCapabilities(id),
    ...overrides
  };
}

const catalog = [
  model("claude-sonnet-4-5", { providerId: "llmsrelay-claude", group: "claude", tier: "pro" }),
  model("gpt-5-codex", { providerId: "llmsrelay-codex", group: "codex", tier: "pro" }),
  model("glm-4.5-air", { providerId: "llmsrelay-uncensored", group: "uncensored", tier: "fast" }),
  model("deepseek-r1", { providerId: "llmsrelay-uncensored", group: "uncensored", tier: "ultra" }),
  model("llava-local", { providerId: "ollama", group: "local", tier: "fast" })
];

test("capability inference recognizes vision, coding and fast models", () => {
  assert.equal(inferCapabilities("claude-sonnet-4-5", { api: "anthropic" }).vision, true);
  assert.equal(inferCapabilities("gpt-5-codex").coding, true);
  assert.equal(inferCapabilities("glm-4.5-air").fast, true);
  assert.equal(inferCapabilities("deepseek-r1").vision, false);
  assert.equal(inferTier("claude-opus-4-1"), "ultra");
  assert.equal(inferTier("gpt-4.1-mini"), "fast");
});

test("explicit model preference wins", () => {
  const preferred = catalog[2].uid;
  const result = routeModels(catalog, { mode: "chat", preferredModelId: preferred });
  assert.equal(result.primary.uid, preferred);
  assert.ok(result.reasons.includes("preferred"));
});

test("image requests exclude models without vision", () => {
  const result = routeModels(catalog, { mode: "chat", hasImage: true });
  assert.ok(result.ordered.every((entry) => entry.capabilities.vision));
  assert.ok(result.excluded.some((entry) => entry.model.id === "deepseek-r1" && entry.reason === "no-vision"));
});

test("coding mode prefers coding-capable models", () => {
  const result = routeModels(catalog, { mode: "coding" });
  assert.ok(["gpt-5-codex", "claude-sonnet-4-5"].includes(result.primary.id));
  assert.ok(result.reasons.includes("coding"));
  const codex = scoreModel(catalog[1], { mode: "coding" });
  const air = scoreModel(catalog[2], { mode: "coding" });
  assert.ok(codex.score > air.score);
});

test("fallback chain excludes failed models and stays small", () => {
  const first = routeModels(catalog, { mode: "coding" }).primary;
  const chain = buildFallbackChain(catalog, { mode: "coding", exclude: [first.uid] });
  assert.equal(chain.chain.length, 3);
  assert.ok(chain.chain.every((entry) => entry.uid !== first.uid));
  assert.ok(chain.primary.uid !== first.uid);
});

test("unsupported preferences are simply not selected", () => {
  const result = routeModels(catalog, { mode: "chat", preferredModelId: "missing-model" });
  assert.ok(result.primary);
  assert.ok(!result.reasons.includes("preferred"));
});

test("empty catalog yields no primary", () => {
  const result = routeModels([], { mode: "chat" });
  assert.equal(result.primary, null);
  assert.deepEqual(result.ordered, []);
});
