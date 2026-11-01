import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(here, "..");

const RELAY_BASE = "https://api.llmsrelay.com";

/**
 * Provider definitions are declarative so the router never needs to know
 * provider-specific details. Keys stay on the server; the client only ever
 * receives safe model metadata.
 */
export const RELAY_GROUPS = [
  {
    id: "llmsrelay-claude",
    group: "claude",
    label: "Claude · Basic / Pro",
    keyEnv: "LLMSRELAY_CLAUDE_API_KEY",
    api: "anthropic",
    baseUrl: RELAY_BASE,
    tier: "pro",
    priority: 10
  },
  {
    id: "llmsrelay-codex",
    group: "codex",
    label: "GPT / Codex · Codex Pro",
    keyEnv: "LLMSRELAY_CODEX_API_KEY",
    api: "openai",
    baseUrl: RELAY_BASE,
    tier: "pro",
    priority: 20
  },
  {
    id: "llmsrelay-uncensored",
    group: "uncensored",
    label: "GLM / DeepSeek · Uncensored",
    keyEnv: "LLMSRELAY_UNCENSORED_API_KEY",
    api: "openai",
    baseUrl: RELAY_BASE,
    tier: "standard",
    priority: 30
  }
];

function splitList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function bool(value, fallback = false) {
  if (value === undefined || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}

function int(value, fallback, min, max) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

/**
 * Build configuration from environment variables. Accepts an explicit env for
 * tests and keeps every tunable in one place.
 */
export function loadConfig(env = process.env, overrides = {}) {
  const assetsDir = overrides.assetsDir || path.join(projectRoot, "app", "src", "main", "assets");
  const dataDir = overrides.dataDir || env.DATA_DIR || path.join(projectRoot, ".data");
  const authSecret = env.AUTH_SECRET || overrides.authSecret || crypto.randomBytes(32).toString("hex");

  return Object.freeze({
    version: "2.0.0",
    env: env.NODE_ENV || "development",
    port: int(env.PORT, 3000, 1, 65535),
    host: env.HOST || "0.0.0.0",
    projectRoot,
    assetsDir,
    dataDir,
    databaseFile: path.join(dataDir, "afg-ai.json"),
    auth: Object.freeze({
      secret: authSecret,
      ephemeralSecret: !env.AUTH_SECRET && !overrides.authSecret,
      tokenTtlSeconds: int(env.AUTH_TOKEN_TTL, 60 * 60 * 24 * 30, 300, 60 * 60 * 24 * 365),
      passwordMinLength: 8,
      scrypt: Object.freeze({ N: 16384, r: 8, p: 1, keylen: 64 })
    }),
    limits: Object.freeze({
      chatPerMinute: int(env.RATE_LIMIT_CHAT, 20, 1, 600),
      authPerMinute: int(env.RATE_LIMIT_AUTH, 10, 1, 120),
      imagePerMinute: int(env.RATE_LIMIT_IMAGE, 5, 1, 60),
      bodyBytes: 8 * 1024 * 1024,
      imageBytes: 5 * 1024 * 1024,
      maxMessages: 40,
      maxMessageChars: 24000,
      maxConversations: 100,
      maxStoredMessages: 200
    }),
    corsOrigins: splitList(
      env.CORS_ORIGINS ||
        "https://appassets.androidplatform.net,http://localhost:3000,http://127.0.0.1:3000"
    ),
    allowAnyOrigin: env.CORS_ORIGINS === "*",
    providers: Object.freeze({
      relayGroups: RELAY_GROUPS,
      relayKeys: Object.freeze(
        Object.fromEntries(
          RELAY_GROUPS.map((group) => [group.group, env[group.keyEnv] || ""])
        )
      ),
      anthropicKey: env.ANTHROPIC_API_KEY || "",
      anthropicModels: splitList(env.ANTHROPIC_MODELS || env.AI_MODEL || "claude-sonnet-4-5"),
      openaiKey: env.AI_API_KEY || env.OPENAI_API_KEY || "",
      openaiBaseUrl: (env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, ""),
      openaiModels: splitList(env.AI_MODELS || env.AI_MODEL || "gpt-4.1-mini"),
      cloudflareAccountId: env.CLOUDFLARE_ACCOUNT_ID || "",
      cloudflareApiToken: env.CLOUDFLARE_API_TOKEN || "",
      cloudflareModels: splitList(env.CLOUDFLARE_AI_MODELS || ""),
      openrouterKey: env.OPENROUTER_API_KEY || "",
      openrouterBaseUrl: "https://openrouter.ai/api/v1",
      // Google Gemini
      geminiKey: env.GEMINI_API_KEY || "",
      geminiModels: splitList(env.GEMINI_MODELS || "gemini-1.5-pro,gemini-1.5-flash,gemini-1.0-pro"),
      // xAI Grok
      grokKey: env.GROK_API_KEY || "",
      grokModels: splitList(env.GROK_MODELS || "grok-beta,grok-vision-beta"),
      // Cohere
      cohereKey: env.COHERE_API_KEY || "",
      cohereModels: splitList(env.COHERE_MODELS || "command-r-plus,command-r,command"),
      // Mistral
      mistralKey: env.MISTRAL_API_KEY || "",
      mistralModels: splitList(env.MISTRAL_MODELS || "mistral-large-latest,mistral-medium,mistral-small,codestral-latest"),
      // Azure OpenAI
      azureOpenaiKey: env.AZURE_OPENAI_API_KEY || "",
      azureOpenaiEndpoint: env.AZURE_OPENAI_ENDPOINT || "",
      azureOpenaiModels: splitList(env.AZURE_OPENAI_MODELS || ""),
      azureOpenaiApiVersion: env.AZURE_OPENAI_API_VERSION || "2024-02-15-preview",
      // AWS Bedrock
      bedrockAccessKey: env.AWS_BEDROCK_ACCESS_KEY || "",
      bedrockSecretKey: env.AWS_BEDROCK_SECRET_KEY || "",
      bedrockRegion: env.AWS_BEDROCK_REGION || "us-east-1",
      bedrockModels: splitList(env.AWS_BEDROCK_MODELS || "anthropic.claude-3-sonnet-20240229-v1:0,anthropic.claude-3-haiku-20240307-v1:0,meta.llama3-70b-instruct-v1:0"),
      // Google Vertex AI
      vertexProjectId: env.GOOGLE_VERTEX_PROJECT_ID || "",
      vertexLocation: env.GOOGLE_VERTEX_LOCATION || "us-central1",
      vertexCredentials: env.GOOGLE_VERTEX_CREDENTIALS || "",
      vertexModels: splitList(env.GOOGLE_VERTEX_MODELS || "gemini-1.5-pro-001,gemini-1.5-flash-001"),
      ollamaBaseUrl: (env.OLLAMA_BASE_URL || "").replace(/\/+$/, ""),
      ollamaModels: splitList(env.OLLAMA_MODELS || ""),
      catalogTtlMs: int(env.MODEL_CATALOG_TTL_SECONDS, 120, 5, 3600) * 1000
    }),
    search: Object.freeze({
      tavilyKey: env.TAVILY_API_KEY || "",
      maxResults: int(env.SEARCH_MAX_RESULTS, 5, 1, 10),
      timeoutMs: 20000
    }),
    image: Object.freeze({
      apiKey: env.IMAGE_API_KEY || "",
      baseUrl: (env.IMAGE_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, ""),
      model: env.IMAGE_MODEL || "gpt-image-1",
      timeoutMs: 120000
    }),
    upstream: Object.freeze({
      timeoutMs: int(env.UPSTREAM_TIMEOUT_MS, 90000, 5000, 300000),
      maxOutputTokens: int(env.MAX_OUTPUT_TOKENS, 4096, 256, 32000)
    }),
    supabase: Object.freeze({
      url: (env.SUPABASE_URL || "").replace(/\/+$/, ""),
      key: env.SUPABASE_ANON_KEY || ""
    }),
    trustProxy: bool(env.TRUST_PROXY, true),
    logRequests: bool(env.LOG_REQUESTS, false)
  });
}

export const defaultConfig = loadConfig();
