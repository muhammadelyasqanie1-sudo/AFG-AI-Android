import { HttpError } from "./errors.js";

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(self), microphone=(), geolocation=()"
};

export function originAllowed(origin, config) {
  if (!origin) return true; // Native apps, curl and same-origin requests may omit Origin.
  if (config.allowAnyOrigin) return true;
  const list = config.corsOrigins || [];
  if (list.includes(origin)) return true;
  // Android WebView hosts locally loaded assets on this origin.
  if (origin === "https://appassets.androidplatform.net") return true;
  try {
    const url = new URL(origin);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return true;
    const configured = list.some((allowed) => {
      try {
        const allowedUrl = new URL(allowed);
        return allowedUrl.origin === url.origin;
      } catch {
        return false;
      }
    });
    return configured;
  } catch {
    return false;
  }
}

function corsHeaders(req, config) {
  const origin = req.headers.origin;
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Device-Id, X-AFG-Client",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
  if (!origin) return headers;
  if (!originAllowed(origin, config)) return { Vary: "Origin" };
  headers["Access-Control-Allow-Origin"] = config.allowAnyOrigin ? "*" : origin;
  return headers;
}

export function baseHeaders(req, config) {
  return { ...SECURITY_HEADERS, ...corsHeaders(req, config) };
}

export function send(res, status, body, headers = {}) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ""), "utf8");
  res.writeHead(status, { "Content-Length": payload.length, ...headers });
  res.end(payload);
}

export function sendJson(req, res, config, status, data, extraHeaders = {}) {
  const payload = Buffer.from(JSON.stringify(data), "utf8");
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...baseHeaders(req, config),
    ...extraHeaders
  });
  res.end(payload);
}

export function sendError(req, res, config, error) {
  const status = error instanceof HttpError ? error.status : 500;
  const code = error instanceof HttpError ? error.code : "internal_error";
  const message =
    error instanceof HttpError
      ? error.message
      : "Something went wrong on the server. Please try again.";
  if (status >= 500 && !(error instanceof HttpError)) {
    console.error("Unhandled server error:", error);
  }
  const headers = {};
  if (error instanceof HttpError && error.extra?.retryAfter) {
    headers["Retry-After"] = String(error.extra.retryAfter);
  }
  sendJson(req, res, config, status, { detail: message, code, ...error.extra }, headers);
}

export async function readJson(req, limit) {
  const type = String(req.headers["content-type"] || "");
  if (type && !/^application\/json\b/i.test(type)) {
    throw new HttpError(415, "unsupported_media_type", "Send the request as application/json.");
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    req.on("data", (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        fail(new HttpError(413, "payload_too_large", "The request body is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new HttpError(400, "invalid_json", "The request body is not valid JSON."));
      }
    });
    req.on("error", (error) => fail(error));
  });
}

export function sseStart(req, res, config) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    ...baseHeaders(req, config)
  });
  res.flushHeaders?.();
}

export function sseSend(res, event, data) {
  if (res.writableEnded) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function sseEnd(res) {
  if (res.writableEnded) return;
  res.write("event: done\ndata: {}\n\n");
  res.end();
}

export function swallowClientDisconnect(res) {
  res.on("close", () => {
    if (!res.writableEnded) res.end();
  });
}
