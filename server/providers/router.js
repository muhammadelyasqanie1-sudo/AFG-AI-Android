/**
 * Next-Generation Intelligent Model Router
 * Task classification, cost/latency optimization, per-user preferences,
 * circuit breakers, A/B testing, and comprehensive analytics.
 */

import { inferCapabilities, inferTier } from "./catalog.js";

// ============================================================================
// TASK CLASSIFICATION
// ============================================================================

const TASK_PATTERNS = {
  coding: [
    /\b(code|program|function|class|api|endpoint|database|sql|debug|refactor|algorithm|data structure|github|git|docker|kubernetes|aws|gcp|azure|terraform|ci\/cd|pipeline|deploy|test|unit test|integration test)\b/i,
    /\b(python|javascript|typescript|java|go|rust|c\+\+|c#|swift|kotlin|php|ruby|scala|haskell|sql|html|css|react|vue|angular|next\.js|node\.js|express|django|fastapi|spring|laravel)\b/i,
    /\b(leetcode|hackerrank|codeforces|atcoder|competitive programming|system design|architecture|design pattern|clean code|solid|dry|kiss)\b/i,
  ],
  reasoning: [
    /\b(logic|reason|deduce|infer|analyze|evaluate|compare|contrast|pros and cons|trade.?off|decision|strategy|plan|step.by.step|think through|break down)\b/i,
    /\b(math|mathematics|proof|theorem|calculate|compute|solve|equation|probability|statistics|optimization)\b/i,
    /\b(why|how does|explain|understand|concept|principle|fundamental|mechanism|underlying)\b/i,
  ],
  creative: [
    /\b(write|create|compose|generate|brainstorm|ideate|story|poem|script|novel|article|blog|copy|marketing|slogan|name|brand|design|illustrate|imagine)\b/i,
    /\b(creative|artistic|original|unique|inspire|fiction|narrative|character|plot|world.building|dialogue)\b/i,
  ],
  analysis: [
    /\b(analyze|analysis|review|audit|assess|examine|inspect|investigate|research|summarize|extract|key points|insights|patterns|trends|anomalies)\b/i,
    /\b(data|dataset|chart|graph|visualization|report|dashboard|metric|kpi|performance|benchmark)\b/i,
  ],
  vision: [
    /\b(image|photo|picture|screenshot|diagram|chart|graph|visual|ui|ux|mockup|wireframe|design|figma|sketch)\b/i,
    /\b(what.{0,10}(see|show|look|appear)|describe.{0,10}(image|photo|picture)|read.{0,10}(text|code|data).{0,10}(image|photo|picture|screenshot))\b/i,
  ],
  research: [
    /\b(latest|recent|current|news|trend|2024|2025|now|today|this week|this month|search|find|lookup|verify|fact.check|source|citation|reference)\b/i,
    /\b(what is|who is|when did|where is|how to|best|top|compare|vs|versus|alternative|option)\b/i,
  ],
  study: [
    /\b(learn|study|teach|explain|tutorial|lesson|course|concept|definition|example|practice|exercise|quiz|homework|assignment|exam|certification)\b/i,
    /\b(beginner|intro|basics|fundamentals|advanced|expert|master|guide|walkthrough|step.by.step)\b/i,
  ],
};

const MODE_TASK_AFFINITY = {
  chat: { chat: 1.0, coding: 0.3, reasoning: 0.4, creative: 0.5, analysis: 0.4, vision: 0.3, research: 0.3, study: 0.4 },
  coding: { coding: 1.0, reasoning: 0.8, analysis: 0.6, chat: 0.4, creative: 0.3, study: 0.5, vision: 0.4, research: 0.4 },
  research: { research: 1.0, analysis: 0.9, reasoning: 0.7, chat: 0.3, coding: 0.3, creative: 0.2, vision: 0.3, study: 0.5 },
  creative: { creative: 1.0, chat: 0.6, reasoning: 0.4, analysis: 0.3, coding: 0.2, study: 0.3, vision: 0.5, research: 0.2 },
  study: { study: 1.0, reasoning: 0.7, chat: 0.5, analysis: 0.4, creative: 0.3, coding: 0.3, vision: 0.3, research: 0.4 },
  analysis: { analysis: 1.0, reasoning: 0.8, research: 0.7, coding: 0.5, chat: 0.3, creative: 0.2, vision: 0.4, study: 0.4 },
};

const TIER_COST = { fast: 1, standard: 3, pro: 10, ultra: 50 };
const TIER_LATENCY = { fast: 1, standard: 2, pro: 4, ultra: 8 };

// ============================================================================
// TASK CLASSIFIER
// ============================================================================

export function classifyTask(text, explicitMode = null) {
  if (explicitMode && Object.keys(MODE_TASK_AFFINITY).includes(explicitMode)) {
    return { primary: explicitMode, scores: { [explicitMode]: 1.0 }, confidence: 1.0 };
  }

  const lower = String(text || "").toLowerCase();
  const scores = {};

  for (const [task, patterns] of Object.entries(TASK_PATTERNS)) {
    let score = 0;
    for (const pattern of patterns) {
      const matches = lower.match(pattern);
      if (matches) score += matches.length;
    }
    scores[task] = score;
  }

  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  if (total === 0) return { primary: "chat", scores: { chat: 1 }, confidence: 0.5 };

  const normalized = {};
  for (const [task, score] of Object.entries(scores)) {
    normalized[task] = score / total;
  }

  const primary = Object.entries(normalized).sort((a, b) => b[1] - a[1])[0][0];
  const confidence = Math.min(normalized[primary] * 2, 1);

  return { primary, scores: normalized, confidence };
}

// ============================================================================
// MODEL SCORING
// ============================================================================

const MODE_GROUP_BONUS = {
  chat: { claude: 6, codex: 6, uncensored: 4, multi: 5, local: 3, gemini: 5, grok: 4, cohere: 3, mistral: 3, azure: 5, bedrock: 4 },
  research: { claude: 16, codex: 12, uncensored: 4, multi: 10, local: 0, gemini: 14, grok: 8, cohere: 6, mistral: 5, azure: 10, bedrock: 8 },
  coding: { codex: 18, claude: 14, uncensored: 8, multi: 12, local: 4, gemini: 10, grok: 8, cohere: 5, mistral: 8, azure: 10, bedrock: 8 },
  study: { claude: 8, codex: 10, uncensored: 4, multi: 8, local: 5, gemini: 10, grok: 6, cohere: 6, mistral: 6, azure: 8, bedrock: 6 },
  creative: { claude: 14, codex: 8, uncensored: 6, multi: 10, local: 2, gemini: 12, grok: 6, cohere: 5, mistral: 5, azure: 8, bedrock: 6 },
  analysis: { claude: 12, codex: 10, uncensored: 5, multi: 9, local: 3, gemini: 11, grok: 7, cohere: 7, mistral: 6, azure: 9, bedrock: 7 },
  vision: { claude: 15, codex: 14, uncensored: 6, multi: 8, local: 5, gemini: 16, grok: 8, cohere: 2, mistral: 4, azure: 10, bedrock: 8 },
};

const MODE_TIER_BONUS = {
  chat: { fast: 6, standard: 3, pro: 2, ultra: 0 },
  research: { fast: 0, standard: 1, pro: 6, ultra: 6 },
  coding: { fast: 1, standard: 2, pro: 6, ultra: 5 },
  study: { fast: 5, standard: 3, pro: 2, ultra: 0 },
  creative: { fast: 2, standard: 2, pro: 5, ultra: 3 },
  analysis: { fast: 1, standard: 2, pro: 5, ultra: 4 },
  vision: { fast: 2, standard: 3, pro: 6, ultra: 5 },
};

export function scoreModel(model, requirements = {}) {
  const {
    mode = "chat",
    task = null,
    hasImage = false,
    preferredModelId = null,
    preferFast = false,
    preferCheap = false,
    needsLongContext = false,
    needsReasoning = false,
    userPreferences = {},
    abTestVariant = null,
  } = requirements;

  const reasons = [];
  let score = 0;

  const capabilities = model.capabilities || {};
  const group = model.group || model.providerId || "";
  const tier = model.tier || "standard";
  const modelId = model.id || "";

  // Explicit user preference
  if (preferredModelId && (model.uid === preferredModelId || model.id === preferredModelId)) {
    score += 1000;
    reasons.push("preferred");
  }

  // Per-user model preferences
  if (userPreferences.favoriteModels?.includes(model.uid)) {
    score += 50;
    reasons.push("user_favorite");
  }
  if (userPreferences.blockedModels?.includes(model.uid)) {
    return { score: -Infinity, reasons: ["user_blocked"] };
  }

  // Task affinity bonus
  if (task && MODE_TASK_AFFINITY[task]) {
    const affinity = MODE_TASK_AFFINITY[task][group] || 0;
    if (affinity > 0) {
      score += affinity * 1.5;
      reasons.push(`task:${task}`);
    }
  }

  // Mode-group affinity
  const groupBonus = (MODE_GROUP_BONUS[mode] || MODE_GROUP_BONUS.chat)[group] || 0;
  if (groupBonus) {
    score += groupBonus;
    reasons.push("group:" + group);
  }

  // Tier bonus for mode
  const tierBonus = (MODE_TIER_BONUS[mode] || MODE_TIER_BONUS.chat)[tier] || 0;
  if (tierBonus) {
    score += tierBonus;
    reasons.push("tier:" + tier);
  }

  // Capability bonuses
  if (mode === "coding" && capabilities.coding) {
    score += 30;
    reasons.push("coding");
  }
  if ((mode === "research" || mode === "analysis" || mode === "study") && capabilities.reasoning) {
    score += 18;
    reasons.push("reasoning");
  }
  if ((mode === "research" || mode === "analysis") && capabilities.longContext) {
    score += 12;
    reasons.push("long-context");
  }
  if (mode === "creative" && (tier === "pro" || tier === "ultra")) {
    score += 10;
    reasons.push("creative");
  }
  if ((mode === "chat" || mode === "study") && capabilities.fast) {
    score += 8;
    reasons.push("fast");
  }

  // Vision handling
  if (hasImage) {
    if (capabilities.vision === false) return { score: -Infinity, reasons: ["no-vision"] };
    if (capabilities.vision) {
      score += 20;
      reasons.push("vision");
    }
  }

  // Prefer fast
  if (preferFast && capabilities.fast) {
    score += 15;
    reasons.push("latency");
  }

  // Prefer cheap (inverse of cost)
  if (preferCheap) {
    const costFactor = TIER_COST[tier] || 10;
    score += Math.max(0, 20 - costFactor);
    reasons.push("cost_optimized");
  }

  // Long context requirement
  if (needsLongContext && capabilities.longContext) {
    score += 20;
    reasons.push("long-context-required");
  }

  // Reasoning requirement
  if (needsReasoning && capabilities.reasoning) {
    score += 15;
    reasons.push("reasoning-required");
  }

  // A/B testing variant
  if (abTestVariant === "experimental" && tier === "ultra") {
    score += 5;
    reasons.push("ab_experimental");
  }

  // Stable, catalog-order-independent tiebreaker
  score -= (modelId || "").length / 1000;

  // Circuit breaker penalty
  if (model._circuitBreaker?.failures > 3) {
    score -= 100;
    reasons.push("circuit_breaker");
  }

  return { score, reasons: [...new Set(reasons)] };
}

// ============================================================================
// ROUTING ENGINE
// ============================================================================

export function routeModels(models, requirements = {}) {
  const {
    mode = "chat",
    task = null,
    hasImage = false,
    preferredModelId = null,
    exclude = [],
    limit = 4,
    preferFast = false,
    preferCheap = false,
    needsLongContext = false,
    needsReasoning = false,
    userPreferences = {},
    abTestVariant = null,
  } = requirements;

  const excludedIds = new Set(exclude);
  const eligible = [];
  const excluded = [];

  for (const model of models) {
    if (!model || !model.uid) continue;
    if (excludedIds.has(model.uid) || excludedIds.has(model.id)) {
      excluded.push({ model, reason: "excluded" });
      continue;
    }
    if (hasImage && model.capabilities && model.capabilities.vision === false) {
      excluded.push({ model, reason: "no-vision" });
      continue;
    }

    const { score, reasons } = scoreModel(model, {
      mode,
      task,
      hasImage,
      preferredModelId,
      preferFast,
      preferCheap,
      needsLongContext,
      needsReasoning,
      userPreferences,
      abTestVariant,
    });

    if (score === -Infinity) {
      excluded.push({ model, reason: reasons[0] });
      continue;
    }

    eligible.push({ model, score, reasons });
  }

  eligible.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return String(a.model.id).localeCompare(String(b.model.id));
  });

  const ordered = eligible.slice(0, Math.max(1, limit));
  const primary = ordered[0] || null;

  return {
    primary: primary ? primary.model : null,
    ordered: ordered.map((entry) => entry.model),
    reasons: primary ? primary.reasons : [],
    scores: ordered.map((entry) => ({ uid: entry.model.uid, score: Math.round(entry.score * 100) / 100 })),
    excluded,
    task: task || mode,
  };
}

// ============================================================================
// CIRCUIT BREAKER
// ============================================================================

const circuitBreakers = new Map();

export function recordModelResult(modelUid, success, latencyMs = 0) {
  const cb = circuitBreakers.get(modelUid) || { failures: 0, successes: 0, lastFailure: 0, latencySum: 0, latencyCount: 0 };
  if (success) {
    cb.successes += 1;
    cb.latencySum += latencyMs;
    cb.latencyCount += 1;
  } else {
    cb.failures += 1;
    cb.lastFailure = Date.now();
  }
  circuitBreakers.set(modelUid, cb);
}

export function getCircuitBreakerStatus(modelUid) {
  const cb = circuitBreakers.get(modelUid);
  if (!cb) return { state: "closed", failures: 0, avgLatency: null };
  const avgLatency = cb.latencyCount > 0 ? cb.latencySum / cb.latencyCount : null;
  const state = cb.failures > 5 ? "open" : cb.failures > 2 ? "half-open" : "closed";
  return { state, failures: cb.failures, avgLatency };
}

export function resetCircuitBreaker(modelUid) {
  circuitBreakers.delete(modelUid);
}

// ============================================================================
// FALLBACK CHAIN
// ============================================================================

export function buildFallbackChain(models, requirements) {
  const result = routeModels(models, { ...requirements, limit: 10 });
  return {
    ...result,
    chain: result.ordered.slice(0, 3),
  };
}

// ============================================================================
// ROUTING ANALYTICS
// ============================================================================

const routingAnalytics = {
  totalRequests: 0,
  byMode: {},
  byTask: {},
  byModel: {},
  fallbacks: 0,
  errors: 0,
  avgLatency: 0,
  latencySum: 0,
};

export function recordRoutingAnalytics(data) {
  routingAnalytics.totalRequests += 1;
  routingAnalytics.byMode[data.mode] = (routingAnalytics.byMode[data.mode] || 0) + 1;
  routingAnalytics.byTask[data.task] = (routingAnalytics.byTask[data.task] || 0) + 1;
  routingAnalytics.byModel[data.model] = (routingAnalytics.byModel[data.model] || 0) + 1;
  if (data.fallback) routingAnalytics.fallbacks += 1;
  if (data.error) routingAnalytics.errors += 1;
  if (data.latencyMs) {
    routingAnalytics.latencySum += data.latencyMs;
    routingAnalytics.avgLatency = routingAnalytics.latencySum / routingAnalytics.totalRequests;
  }
}

export function getRoutingAnalytics() {
  return { ...routingAnalytics };
}

export function resetRoutingAnalytics() {
  routingAnalytics.totalRequests = 0;
  routingAnalytics.byMode = {};
  routingAnalytics.byTask = {};
  routingAnalytics.byModel = {};
  routingAnalytics.fallbacks = 0;
  routingAnalytics.errors = 0;
  routingAnalytics.avgLatency = 0;
  routingAnalytics.latencySum = 0;
}