import crypto from "node:crypto";
import { promisify } from "node:util";
import { badRequest, unauthorized, forbidden } from "./errors.js";

const scrypt = promisify(crypto.scrypt);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function b64url(input) {
  return Buffer.from(input).toString("base64url");
}
function fromB64url(input) {
  return Buffer.from(input, "base64url");
}
function safeEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function isUuid(value) {
  return typeof value === "string" && UUID_RE.test(value);
}

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function validateCredentials(email, password, minLength = 8) {
  const normalized = normalizeEmail(email);
  if (!EMAIL_RE.test(normalized) || normalized.length > 200) {
    throw badRequest("Enter a valid email address.", "invalid_email");
  }
  if (typeof password !== "string" || password.length < minLength) {
    throw badRequest(`Use a password with at least ${minLength} characters.`, "weak_password");
  }
  if (password.length > 200) {
    throw badRequest("The password is too long.", "password_too_long");
  }
  return normalized;
}

// ============================================================================
// ENCRYPTION AT REST
// ============================================================================

const ENCRYPTION_ALGO = "aes-256-gcm";
const KEY_DERIVATION = "scrypt";

function deriveEncryptionKey(masterSecret, salt) {
  return crypto.scryptSync(masterSecret, salt, 32);
}

export function encryptAtRest(plaintext, masterSecret) {
  const salt = crypto.randomBytes(16);
  const key = deriveEncryptionKey(masterSecret, salt);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    encrypted: encrypted.toString("base64"),
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: authTag.toString("base64"),
    algo: ENCRYPTION_ALGO
  };
}

export function decryptAtRest(encryptedData, masterSecret) {
  const { encrypted, salt, iv, tag, algo } = encryptedData;
  if (algo !== ENCRYPTION_ALGO) throw new Error("Unsupported encryption algorithm");
  const key = deriveEncryptionKey(masterSecret, Buffer.from(salt, "base64"));
  const decipher = crypto.createDecipheriv(algo, key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64")),
    decipher.final()
  ]);
  return decrypted.toString("utf8");
}

// ============================================================================
// TOTP (MFA)
// ============================================================================

function generateTOTPSecret() {
  return crypto.randomBytes(20).toString("base32").toUpperCase().replace(/=/g, "");
}

function totp(secret, timeStep = 30, digits = 6) {
  const counter = Math.floor(Date.now() / 1000 / timeStep);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", Buffer.from(secret, "base32"));
  hmac.update(buffer);
  const hash = hmac.digest();
  const offset = hash[hash.length - 1] & 0xf;
  const code = ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff);
  return String(code % Math.pow(10, digits)).padStart(digits, "0");
}

export function verifyTOTP(token, secret, window = 1) {
  const now = Math.floor(Date.now() / 1000 / 30);
  for (let i = -window; i <= window; i++) {
    const expected = totp(secret, 30, 6);
    if (safeEqual(token, expected)) return true;
  }
  return false;
}

// ============================================================================
// API KEYS FOR DEVELOPERS
// ============================================================================

export function generateApiKey(prefix = "afg") {
  const randomPart = crypto.randomBytes(32).toString("base64url");
  return `${prefix}_${randomPart}`;
}

export function hashApiKey(apiKey) {
  return crypto.createHash("sha256").update(apiKey).digest("hex");
}

export function verifyApiKey(apiKey, hashedKey) {
  return safeEqual(hashApiKey(apiKey), hashedKey);
}

// ============================================================================
// OAUTH2/OIDC PROVIDERS
// ============================================================================

export const OAUTH_PROVIDERS = {
  google: {
    name: "Google",
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userInfoUrl: "https://www.googleapis.com/oauth2/v2/userinfo",
    scopes: ["openid", "email", "profile"],
    pkce: true
  },
  github: {
    name: "GitHub",
    authorizationUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    userInfoUrl: "https://api.github.com/user",
    scopes: ["read:user", "user:email"],
    pkce: true
  },
  microsoft: {
    name: "Microsoft",
    authorizationUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    userInfoUrl: "https://graph.microsoft.com/v1.0/me",
    scopes: ["openid", "email", "profile", "User.Read"],
    pkce: true
  }
};

export function generateOAuthState() {
  return crypto.randomBytes(32).toString("base64url");
}

export function generatePKCE() {
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge };
}

export function buildAuthorizationUrl(provider, clientId, redirectUri, state, codeChallenge) {
  const p = OAUTH_PROVIDERS[provider];
  if (!p) throw new Error(`Unknown OAuth provider: ${provider}`);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: p.scopes.join(" "),
    state,
    access_type: "offline",
    prompt: "consent"
  });
  if (p.pkce && codeChallenge) {
    params.append("code_challenge", codeChallenge);
    params.append("code_challenge_method", "S256");
  }
  return `${p.authorizationUrl}?${params.toString()}`;
}

// ============================================================================
// MAGIC LINKS
// ============================================================================

export function generateMagicToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function createMagicLinkToken(email, redirectUrl, ttlSeconds = 900) {
  const payload = {
    type: "magic_link",
    email: normalizeEmail(email),
    redirect: redirectUrl,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    jti: crypto.randomUUID()
  };
  return b64url(JSON.stringify(payload));
}

export function verifyMagicLinkToken(token, secret) {
  try {
    const payload = JSON.parse(fromB64url(token).toString("utf8"));
    if (payload.type !== "magic_link") return null;
    if (payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

// ============================================================================
// PASSKEYS / WEBAUTHN
// ============================================================================

export function generatePasskeyChallenge() {
  return crypto.randomBytes(32).toString("base64url");
}

export function verifyPasskeyAuthentication(credential, challenge, publicKey, expectedOrigin, expectedRpId) {
  // Simplified verification - in production use @simplewebauthn/server
  try {
    const clientData = JSON.parse(Buffer.from(credential.response.clientDataJSON, "base64url").toString("utf8"));
    if (clientData.type !== "webauthn.get") return false;
    if (clientData.challenge !== challenge) return false;
    if (clientData.origin !== expectedOrigin) return false;

    const authenticatorData = Buffer.from(credential.response.authenticatorData, "base64url");
    // Verify RP ID hash
    const rpIdHash = authenticatorData.slice(0, 32);
    const expectedRpIdHash = crypto.createHash("sha256").update(expectedRpId).digest();
    if (!safeEqual(rpIdHash, expectedRpIdHash)) return false;

    // Verify user presence and verification flags
    const flags = authenticatorData[32];
    if (!(flags & 0x01)) return false; // User present
    if (!(flags & 0x04)) return false; // User verified

    // Verify signature (simplified - production needs proper COSE parsing)
    const signature = Buffer.from(credential.response.signature, "base64url");
    const verify = crypto.createVerify("SHA256");
    verify.update(Buffer.concat([authenticatorData, Buffer.from(credential.response.clientDataJSON, "base64url")]));
    return verify.verify(publicKey, signature);
  } catch {
    return false;
  }
}

// ============================================================================
// ROLE-BASED ACCESS CONTROL
// ============================================================================

export const ROLES = {
  admin: ["*"],
  developer: ["api:read", "api:write", "conversations:read", "conversations:write", "models:read"],
  user: ["conversations:read", "conversations:write", "models:read"],
  guest: ["conversations:read", "conversations:write"]
};

export function hasPermission(role, permission) {
  const rolePerms = ROLES[role] || [];
  if (rolePerms.includes("*")) return true;
  if (rolePerms.includes(permission)) return true;
  // Check wildcard
  const parts = permission.split(":");
  for (let i = parts.length; i > 0; i--) {
    const wildcard = parts.slice(0, i).join(":") + ":*";
    if (rolePerms.includes(wildcard)) return true;
  }
  return false;
}

export function requirePermission(role, permission) {
  if (!hasPermission(role, permission)) {
    throw forbidden(`Requires permission: ${permission}`, "permission_denied");
  }
}

// ============================================================================
// AUDIT LOGGING
// ============================================================================

const auditLog = [];
const MAX_AUDIT_ENTRIES = 10000;

export function auditLogEntry({ userId, action, resource, resourceId, ip, userAgent, success, details }) {
  const entry = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    userId: userId || "anonymous",
    action,
    resource,
    resourceId: resourceId || null,
    ip: ip || "unknown",
    userAgent: userAgent || "unknown",
    success: Boolean(success),
    details: details || {}
  };
  auditLog.push(entry);
  if (auditLog.length > MAX_AUDIT_ENTRIES) {
    auditLog.splice(0, auditLog.length - MAX_AUDIT_ENTRIES);
  }
  return entry;
}

export function getAuditLog({ userId, action, resource, startDate, endDate, limit = 100 } = {}) {
  let entries = [...auditLog].reverse();
  if (userId) entries = entries.filter(e => e.userId === userId);
  if (action) entries = entries.filter(e => e.action === action);
  if (resource) entries = entries.filter(e => e.resource === resource);
  if (startDate) entries = entries.filter(e => e.timestamp >= startDate);
  if (endDate) entries = entries.filter(e => e.timestamp <= endDate);
  return entries.slice(0, limit);
}

// ============================================================================
// DEVICE TRUST
// ============================================================================

export function fingerprintDevice(req) {
  const ua = req.headers["user-agent"] || "";
  const acceptLang = req.headers["accept-language"] || "";
  const acceptEnc = req.headers["accept-encoding"] || "";
  const fp = crypto.createHash("sha256")
    .update(ua + "|" + acceptLang + "|" + acceptEnc)
    .digest("hex")
    .slice(0, 16);
  return fp;
}

const trustedDevices = new Map(); // userId -> Set(deviceFingerprints)

export function trustDevice(userId, fingerprint) {
  if (!trustedDevices.has(userId)) trustedDevices.set(userId, new Set());
  trustedDevices.get(userId).add(fingerprint);
}

export function isDeviceTrusted(userId, fingerprint) {
  const devices = trustedDevices.get(userId);
  return devices?.has(fingerprint) || false;
}

export function revokeDeviceTrust(userId, fingerprint) {
  const devices = trustedDevices.get(userId);
  if (devices) devices.delete(fingerprint);
}

// ============================================================================
// SESSION MANAGEMENT
// ============================================================================

const activeSessions = new Map(); // sessionId -> { userId, createdAt, lastActivity, ip, userAgent, trusted }

export function createSession(userId, req, tokenTtlSeconds) {
  const sessionId = crypto.randomUUID();
  const session = {
    id: sessionId,
    userId,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    ip: req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown",
    userAgent: req.headers["user-agent"] || "unknown",
    trusted: isDeviceTrusted(userId, fingerprintDevice(req)),
    tokenTtlSeconds
  };
  activeSessions.set(sessionId, session);
  return sessionId;
}

export function getSession(sessionId) {
  return activeSessions.get(sessionId) || null;
}

export function updateSessionActivity(sessionId) {
  const session = activeSessions.get(sessionId);
  if (session) {
    session.lastActivity = Date.now();
    return true;
  }
  return false;
}

export function revokeSession(sessionId) {
  return activeSessions.delete(sessionId);
}

export function revokeAllUserSessions(userId) {
  for (const [sessionId, session] of activeSessions) {
    if (session.userId === userId) activeSessions.delete(sessionId);
  }
}

export function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [sessionId, session] of activeSessions) {
    if (now - session.lastActivity > session.tokenTtlSeconds * 1000) {
      activeSessions.delete(sessionId);
    }
  }
}

// ============================================================================
// MAIN AUTH FACTORY
// ============================================================================

export function createAuth({ secret, tokenTtlSeconds = 60 * 60 * 24 * 30, scryptParams, masterEncryptionKey, oauthConfig }) {
  const params = scryptParams || { N: 16384, r: 8, p: 1, keylen: 64 };
  const encryptionKey = masterEncryptionKey || secret;

  function sign(payload, ttlSeconds = tokenTtlSeconds) {
    const now = Math.floor(Date.now() / 1000);
    const body = { ...payload, iat: now, exp: now + ttlSeconds, jti: crypto.randomUUID() };
    const encoded = b64url(JSON.stringify(body));
    const signature = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
    return `v1.${encoded}.${signature}`;
  }

  function verify(token) {
    if (typeof token !== "string" || token.length > 4096) return null;
    const parts = token.split(".");
    if (parts.length !== 3 || parts[0] !== "v1") return null;
    const [, encoded, signature] = parts;
    const expected = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
    if (!safeEqual(signature, expected)) return null;
    let payload;
    try {
      payload = JSON.parse(fromB64url(encoded).toString("utf8"));
    } catch {
      return null;
    }
    if (!payload || typeof payload.exp !== "number" || payload.exp < Date.now() / 1000) return null;
    return payload;
  }

  async function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
    const derived = await scrypt(password, salt, params.keylen, {
      N: params.N,
      r: params.r,
      p: params.p,
      maxmem: 128 * params.N * params.r * 2
    });
    return { hash: derived.toString("base64"), salt };
  }

  async function verifyPassword(password, hash, salt) {
    if (!hash || !salt) return false;
    try {
      const derived = await scrypt(password, salt, params.keylen, {
        N: params.N,
        r: params.r,
        p: params.p,
        maxmem: 128 * params.N * params.r * 2
      });
      return safeEqual(derived.toString("base64"), hash);
    } catch {
      return false;
    }
  }

  function identityFromRequest(req, body = {}) {
    const header = String(req.headers.authorization || "");
    if (header.startsWith("Bearer ")) {
      const payload = verify(header.slice(7).trim());
      if (payload && typeof payload.sub === "string") {
        return {
          userId: payload.sub,
          kind: payload.kind === "guest" ? "guest" : "user",
          email: payload.email || null,
          name: payload.name || null,
          role: payload.role || "user",
          token: true
        };
      }
      return null;
    }
    const deviceId = req.headers["x-device-id"] || body.device_id || body.user_id;
    if (isUuid(deviceId)) {
      return { userId: "guest_" + deviceId.toLowerCase(), kind: "guest", email: null, name: null, role: "guest", token: false };
    }
    return null;
  }

  function requireIdentity(req, body = {}) {
    const identity = identityFromRequest(req, body);
    if (!identity) {
      throw unauthorized("Sign in or provide a device id to continue.", "identity_required");
    }
    return identity;
  }

  let cleanupInterval = null;

  function startCleanup() {
    if (cleanupInterval) return;
    cleanupInterval = setInterval(cleanupExpiredSessions, 60 * 60 * 1000);
    cleanupInterval.unref?.();
  }

  function stopCleanup() {
    if (cleanupInterval) {
      clearInterval(cleanupInterval);
      cleanupInterval = null;
    }
  }

  // Auto-start cleanup
  startCleanup();

  return {
    sign,
    verify,
    hashPassword,
    verifyPassword,
    identityFromRequest,
    requireIdentity,
    // Encryption
    encryptAtRest: (data) => encryptAtRest(data, encryptionKey),
    decryptAtRest: (data) => decryptAtRest(data, encryptionKey),
    // MFA/TOTP
    generateTOTPSecret,
    verifyTOTP,
    // API Keys
    generateApiKey,
    hashApiKey,
    verifyApiKey,
    // OAuth
    OAUTH_PROVIDERS,
    generateOAuthState,
    generatePKCE,
    buildAuthorizationUrl,
    // Magic Links
    generateMagicToken,
    createMagicLinkToken,
    verifyMagicLinkToken,
    // Passkeys
    generatePasskeyChallenge,
    verifyPasskeyAuthentication,
    // RBAC
    ROLES,
    hasPermission,
    requirePermission,
    // Audit
    auditLogEntry,
    getAuditLog,
    // Device Trust
    fingerprintDevice,
    trustDevice,
    isDeviceTrusted,
    revokeDeviceTrust,
    // Sessions
    createSession,
    getSession,
    updateSessionActivity,
    revokeSession,
    revokeAllUserSessions,
    stopCleanup
  };
}