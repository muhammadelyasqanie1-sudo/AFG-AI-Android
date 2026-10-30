import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { baseHeaders } from "./lib/http.js";

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4"
};

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  "connect-src 'self' https: http://localhost:* http://127.0.0.1:*",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join("; ");

export function createStaticHandler(config) {
  const root = path.resolve(config.assetsDir);

  return async function serveStatic(req, res, pathname) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Method not allowed");
    }

    const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const file = path.resolve(root, requested);
    if (!file.startsWith(root + path.sep) && file !== path.join(root, "index.html")) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Forbidden");
    }

    let stat;
    try {
      stat = await fsp.stat(file);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Not found");
    }
    if (!stat.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Not found");
    }

    const extension = path.extname(file).toLowerCase();
    const headers = {
      "Content-Type": CONTENT_TYPES[extension] || "application/octet-stream",
      "Content-Length": stat.size,
      "Last-Modified": stat.mtime.toUTCString(),
      "X-Content-Type-Options": "nosniff",
      ...baseHeaders(req, config)
    };

    if (extension === ".html") {
      headers["Cache-Control"] = "no-cache";
      headers["Content-Security-Policy"] = CONTENT_SECURITY_POLICY;
    } else if (path.basename(file) === "sw.js") {
      headers["Cache-Control"] = "no-cache";
      headers["Service-Worker-Allowed"] = "/";
    } else {
      headers["Cache-Control"] = "public, max-age=300";
    }

    if (req.method === "HEAD") {
      res.writeHead(200, headers);
      return res.end();
    }

    res.writeHead(200, headers);
    fs.createReadStream(file)
      .on("error", () => {
        if (!res.headersSent) res.writeHead(500);
        res.end();
      })
      .pipe(res);
  };
}
