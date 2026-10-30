import { badRequest, notFound, tooMany } from "../lib/errors.js";
import { readJson, sendJson } from "../lib/http.js";
import { clientKey } from "../lib/rate-limit.js";

export function createConversationHandlers(ctx) {
  const { config, db, auth, limiter } = ctx;

  function identityOrFail(req, body = {}) {
    const identity = auth.requireIdentity(req, body);
    const bucket = limiter.hit("conversations:" + clientKey(req, identity), 120, 60_000);
    if (bucket.limited) throw tooMany("Too many requests. Try again shortly.", bucket.retryAfter);
    return identity;
  }

  function validatePayload(body) {
    if (body.title !== undefined && typeof body.title !== "string") {
      throw badRequest("The conversation title must be text.", "invalid_title");
    }
    if (body.messages !== undefined && !Array.isArray(body.messages)) {
      throw badRequest("Messages must be an array.", "invalid_messages");
    }
    if (Array.isArray(body.messages) && body.messages.length > config.limits.maxStoredMessages) {
      body.messages = body.messages.slice(-config.limits.maxStoredMessages);
    }
    return body;
  }

  async function list(req, res) {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET, POST");
      return sendJson(req, res, config, 405, { detail: "Use GET for this endpoint.", code: "method_not_allowed" });
    }
    const identity = identityOrFail(req);
    return sendJson(req, res, config, 200, {
      conversations: db.listConversations(identity.userId)
    });
  }

  async function create(req, res) {
    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return sendJson(req, res, config, 405, { detail: "Use POST for this endpoint.", code: "method_not_allowed" });
    }
    const body = await readJson(req, config.limits.bodyBytes);
    const identity = identityOrFail(req, body);
    const conversation = db.upsertConversation(identity.userId, validatePayload(body));
    if (!conversation) throw badRequest("That conversation belongs to another account.", "conversation_owner_mismatch");
    return sendJson(req, res, config, 201, { conversation });
  }

  async function item(req, res, id) {
    const body = req.method === "PATCH" || req.method === "PUT" ? await readJson(req, config.limits.bodyBytes) : {};
    const identity = identityOrFail(req, body);
    if (!id || id.length > 80) throw badRequest("Invalid conversation id.", "invalid_id");

    if (req.method === "GET") {
      const conversation = db.getConversation(identity.userId, id);
      if (!conversation) throw notFound("Conversation not found.", "conversation_not_found");
      return sendJson(req, res, config, 200, { conversation });
    }

    if (req.method === "PATCH" || req.method === "PUT") {
      const conversation = db.upsertConversation(identity.userId, { ...validatePayload(body), id });
      if (!conversation) throw notFound("Conversation not found.", "conversation_not_found");
      return sendJson(req, res, config, 200, { conversation });
    }

    if (req.method === "DELETE") {
      const deleted = db.deleteConversation(identity.userId, id);
      if (!deleted) throw notFound("Conversation not found.", "conversation_not_found");
      return sendJson(req, res, config, 200, { ok: true });
    }

    res.setHeader("Allow", "GET, PATCH, DELETE");
    return sendJson(req, res, config, 405, { detail: "Method not allowed.", code: "method_not_allowed" });
  }

  return { list, create, item };
}
