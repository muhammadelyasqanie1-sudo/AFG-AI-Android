import http from "node:http";
import path from "node:path";
import { loadConfig } from "./config.js";
import { createAuth } from "./lib/auth.js";
import { HttpError, notFound } from "./lib/errors.js";
import {
  baseHeaders,
  originAllowed,
  sendError,
  sendJson
} from "./lib/http.js";
import { createRateLimiter } from "./lib/rate-limit.js";
import { createSearch } from "./lib/search.js";
import { createDatabase } from "./lib/store.js";
import { createSupabaseMirror } from "./lib/supabase.js";
import { createAdapter } from "./providers/adapters.js";
import { createCatalog } from "./providers/catalog.js";
import { createChatHandler } from "./api/chat.js";
import { createModelsHandler } from "./api/models.js";
import { createAuthHandlers } from "./api/auth.js";
import { createConversationHandlers } from "./api/conversations.js";
import { createImageHandler } from "./api/image.js";
import { createHealthHandler } from "./api/health.js";
import { createStaticHandler } from "./static.js";

/**
 * Build the whole application without listening. This keeps the server
 * testable and makes it trivial to embed in another runner.
 */
export async function createApp(overrides = {}) {
  const env = overrides.env || process.env;
  const config = loadConfig(env, overrides);

  const db = createDatabase({
    file: config.databaseFile,
    maxConversations: config.limits.maxConversations,
    maxStoredMessages: config.limits.maxStoredMessages
  });
  await db.init();

  const limiter = createRateLimiter();
  const auth = createAuth({
    secret: config.auth.secret,
    tokenTtlSeconds: config.auth.tokenTtlSeconds,
    scryptParams: config.auth.scrypt
  });
  const catalog = createCatalog(config);
  const adapter = createAdapter({ config });
  const search = createSearch(config);
  const supabase = createSupabaseMirror(config);

  const ctx = {
    config,
    db,
    limiter,
    auth,
    catalog,
    adapter,
    search,
    supabase,
    startedAt: Date.now()
  };

  const handlers = {
    health: createHealthHandler(ctx),
    models: createModelsHandler(ctx),
    chat: createChatHandler(ctx),
    image: createImageHandler(ctx),
    auth: createAuthHandlers(ctx),
    conversations: createConversationHandlers(ctx),
    static: createStaticHandler(config)
  };

  async function route(req, res) {
    let url;
    let pathname;
    try {
      url = new URL(req.url, "http://localhost");
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return sendJson(req, res, config, 400, {
        detail: "Invalid URL.",
        code: "invalid_url"
      });
    }

    if (pathname.startsWith("/api/") && !originAllowed(req.headers.origin, config)) {
      return sendJson(req, res, config, 403, {
        detail: "This origin is not allowed to call the API.",
        code: "origin_not_allowed"
      });
    }

    if (pathname.startsWith("/api/") && req.method === "OPTIONS") {
      res.writeHead(204, baseHeaders(req, config));
      return res.end();
    }

    if (pathname === "/api/health") return handlers.health(req, res, url);
    if (pathname === "/api/models") return handlers.models(req, res, url);
    if (pathname === "/api/chat") return handlers.chat(req, res);
    if (pathname === "/api/image") return handlers.image(req, res);

    if (pathname === "/api/auth/register") return handlers.auth.register(req, res);
    if (pathname === "/api/auth/login") return handlers.auth.login(req, res);
    if (pathname === "/api/auth/me") return handlers.auth.me(req, res);
    if (pathname === "/api/auth/logout") return handlers.auth.logout(req, res);

    if (pathname === "/api/conversations") {
      return req.method === "POST"
        ? handlers.conversations.create(req, res)
        : handlers.conversations.list(req, res);
    }
    if (pathname.startsWith("/api/conversations/")) {
      const id = pathname.slice("/api/conversations/".length);
      return handlers.conversations.item(req, res, id);
    }

    if (pathname.startsWith("/api/")) {
      throw notFound("That API endpoint does not exist.", "endpoint_not_found");
    }

    return handlers.static(req, res, pathname);
  }

  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    try {
      await route(req, res);
    } catch (error) {
      if (!res.headersSent) {
        sendError(req, res, config, error);
      } else if (!res.writableEnded) {
        res.end();
      }
    } finally {
      if (config.logRequests) {
        console.log(
          `${req.method} ${req.url} ${res.statusCode} ${Date.now() - started}ms`
        );
      }
    }
  });

  server.on("clientError", (error, socket) => {
    if (!socket.writable) return;
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  });

  async function close() {
    await new Promise((resolve) => {
      if (!server.listening) return resolve();
      server.close(() => resolve());
    });
    await db.close();
  }

  return { server, config, ctx, db, handlers, close };
}

export { HttpError };
