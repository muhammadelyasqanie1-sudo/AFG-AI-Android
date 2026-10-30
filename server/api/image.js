import { badRequest, tooMany, unavailable, HttpError } from "../lib/errors.js";
import { readJson, sendJson } from "../lib/http.js";
import { clientKey } from "../lib/rate-limit.js";

const SIZES = new Set(["1024x1024", "1024x1536", "1536x1024", "512x512"]);

export function createImageHandler(ctx) {
  const { config, limiter, fetchImpl = fetch } = ctx;

  return async function handleImage(req, res) {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return sendJson(req, res, config, 405, { detail: "Use POST for this endpoint.", code: "method_not_allowed" });
    }
    const bucket = limiter.hit("image:" + clientKey(req), config.limits.imagePerMinute, 60_000);
    if (bucket.limited) {
      throw tooMany("Too many image requests. Please wait a minute.", bucket.retryAfter);
    }

    const body = await readJson(req, 128 * 1024);
    const prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 4000) : "";
    if (!prompt) throw badRequest("Describe the image you want to create.", "empty_prompt");
    if (!config.image.apiKey) {
      throw unavailable(
        "Image generation is not configured. Add IMAGE_API_KEY on the server.",
        "image_unconfigured"
      );
    }
    const size = SIZES.has(body.size) ? body.size : "1024x1024";

    let response;
    try {
      response = await fetchImpl(config.image.baseUrl + "/images/generations", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + config.image.apiKey,
          "content-type": "application/json"
        },
        body: JSON.stringify({ model: config.image.model, prompt, n: 1, size }),
        signal: AbortSignal.timeout(config.image.timeoutMs)
      });
    } catch (error) {
      if (error?.name === "TimeoutError") {
        throw new HttpError(504, "image_timeout", "Image generation timed out. Try again.");
      }
      throw new HttpError(502, "image_unreachable", "Could not reach the image provider.");
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 429) {
        throw tooMany("Image generation is rate-limited. Try again later.", 60);
      }
      throw new HttpError(
        502,
        "image_provider_error",
        response.status === 401 || response.status === 403
          ? "The image provider rejected the server credentials."
          : "The image provider returned an error."
      );
    }
    const item = data.data && data.data[0];
    const imageUrl = item && (item.url || (item.b64_json ? "data:image/png;base64," + item.b64_json : ""));
    if (typeof imageUrl !== "string" || !imageUrl) {
      throw new HttpError(502, "image_empty", "The image provider returned no image.");
    }
    return sendJson(req, res, config, 200, {
      imageUrl,
      model: config.image.model,
      prompt,
      size
    });
  };
}
