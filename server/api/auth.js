import {
  conflict,
  tooMany,
  unauthorized,
  badRequest
} from "../lib/errors.js";
import { readJson, sendJson } from "../lib/http.js";
import { clientKey } from "../lib/rate-limit.js";
import {
  normalizeEmail,
  validateCredentials
} from "../lib/auth.js";
import { publicUser } from "../lib/store.js";

export function createAuthHandlers(ctx) {
  const { config, db, auth, limiter } = ctx;

  function rateCheck(req, action) {
    const key = "auth:" + action + ":" + clientKey(req);
    const bucket = limiter.hit(key, config.limits.authPerMinute, 60_000);
    if (bucket.limited) {
      throw tooMany("Too many authentication attempts. Please wait a minute.", bucket.retryAfter);
    }
  }

  async function register(req, res) {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return sendJson(req, res, config, 405, { detail: "Use POST for this endpoint.", code: "method_not_allowed" });
    }
    rateCheck(req, "register");
    const body = await readJson(req, 16 * 1024);
    const email = validateCredentials(body.email, body.password, config.auth.passwordMinLength);
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 60) : "";
    if (db.findUserByEmail(email)) {
      throw conflict("An account with this email already exists.", "email_taken");
    }
    const { hash, salt } = await auth.hashPassword(body.password);
    const user = db.createUser({ email, name, passwordHash: hash, salt });
    if (!user) throw conflict("An account with this email already exists.", "email_taken");
    const token = auth.sign({ sub: user.id, kind: "user", email: user.email, name: user.name });
    return sendJson(req, res, config, 201, {
      token,
      user: publicUser(user),
      expiresIn: config.auth.tokenTtlSeconds
    });
  }

  async function login(req, res) {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return sendJson(req, res, config, 405, { detail: "Use POST for this endpoint.", code: "method_not_allowed" });
    }
    rateCheck(req, "login");
    const body = await readJson(req, 16 * 1024);
    const email = normalizeEmail(body.email);
    if (!email || typeof body.password !== "string") {
      throw badRequest("Enter your email and password.", "missing_credentials");
    }
    const user = db.findUserByEmail(email);
    // Always run a hash comparison to keep timing uniform for unknown emails.
    const valid = user
      ? await auth.verifyPassword(body.password, user.passwordHash, user.salt)
      : await auth.verifyPassword(body.password, "AA==", "00");
    if (!user || !valid) throw unauthorized("Email or password is incorrect.", "invalid_credentials");
    db.touchUser(user.id);
    const token = auth.sign({ sub: user.id, kind: "user", email: user.email, name: user.name });
    return sendJson(req, res, config, 200, {
      token,
      user: publicUser(user),
      expiresIn: config.auth.tokenTtlSeconds
    });
  }

  async function me(req, res) {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return sendJson(req, res, config, 405, { detail: "Use GET for this endpoint.", code: "method_not_allowed" });
    }
    const identity = auth.identityFromRequest(req);
    if (!identity) throw unauthorized();
    if (identity.kind === "guest") {
      return sendJson(req, res, config, 200, {
        user: {
          id: identity.userId,
          kind: "guest",
          name: "Guest",
          plan: "guest",
          createdAt: null
        }
      });
    }
    const user = db.findUserById(identity.userId);
    if (!user) throw unauthorized("This account no longer exists.", "account_missing");
    return sendJson(req, res, config, 200, { user: { ...publicUser(user), kind: "user" } });
  }

  function logout(req, res) {
    // Tokens are stateless; the client discards the token. Endpoint exists so
    // clients have a clean, explicit logout call.
    return sendJson(req, res, config, 200, { ok: true });
  }

  return { register, login, me, logout };
}

