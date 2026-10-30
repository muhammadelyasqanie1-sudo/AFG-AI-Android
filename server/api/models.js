import { sendJson } from "../lib/http.js";
import { clientKey } from "../lib/rate-limit.js";
import { MODES } from "../prompts.js";
import { routeModels } from "../providers/router.js";

export function createModelsHandler(ctx) {
  const { config, catalog, limiter, auth } = ctx;

  return async function handleModels(req, res, url) {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return sendJson(req, res, config, 405, { detail: "Use GET for this endpoint.", code: "method_not_allowed" });
    }
    const identity = auth.identityFromRequest(req);
    const bucket = limiter.hit("models:" + clientKey(req, identity), 60, 60_000);
    if (bucket.limited) {
      return sendJson(req, res, config, 429, { detail: "Too many model requests. Try again shortly.", code: "rate_limited" }, {
        "Retry-After": String(bucket.retryAfter)
      });
    }

    const state = await catalog.get({ force: url.searchParams.get("refresh") === "1" });
    const models = catalog.publicModels();
    const recommended = {};
    for (const mode of MODES) {
      const selection = routeModels(models, { mode, limit: 1 });
      recommended[mode] = selection.primary ? selection.primary.uid : null;
    }

    const configured = state.providers.some((provider) => provider.configured);
    return sendJson(req, res, config, 200, {
      configured,
      count: models.length,
      models,
      groups: [...new Set(models.map((model) => model.group))],
      providers: state.providers,
      recommended,
      defaultModel: recommended.chat,
      autoRouting: true,
      detail: configured
        ? null
        : "No AI provider keys are configured on the server yet. Add a provider key in the server environment."
    });
  };
}
