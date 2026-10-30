import { sendJson } from "../lib/http.js";

export function createHealthHandler(ctx) {
  const { config, db, catalog, search, limiter } = ctx;

  return async function handleHealth(req, res, url) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");
      return sendJson(req, res, config, 405, { detail: "Use GET for this endpoint.", code: "method_not_allowed" });
    }
    const deep = url.searchParams.get("deep") === "1";
    let modelState = catalog.cached;
    if (deep) modelState = await catalog.get();
    const providers = modelState.providers || [];
    const payload = {
      ok: true,
      service: "AFG AI",
      version: config.version,
      environment: config.env,
      uptimeSeconds: Math.round((Date.now() - ctx.startedAt) / 1000),
      aiConfigured: providers.some((provider) => provider.configured),
      llmsRelayConfigured: config.providers.relayGroups.some(
        (group) => Boolean(config.providers.relayKeys?.[group.group])
      ),
      webSearchConfigured: search.configured,
      imageConfigured: Boolean(config.image.apiKey),
      authConfigured: true,
      modelsCached: (modelState.models || []).length,
      providers: providers.map((provider) => ({
        id: provider.id,
        label: provider.label,
        configured: provider.configured,
        available: provider.available
      })),
      storage: db.stats(),
      rateLimitBuckets: limiter.size(),
      timestamp: new Date().toISOString()
    };
    if (deep) {
      payload.features = {
        streaming: true,
        multimodal: true,
        intelligentRouting: true,
        conversations: true,
        accounts: true,
        liveSearch: search.configured,
        imageGeneration: Boolean(config.image.apiKey)
      };
    }
    return sendJson(req, res, config, 200, payload);
  };
}
