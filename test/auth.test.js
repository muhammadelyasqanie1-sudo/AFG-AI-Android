import test from "node:test";
import assert from "node:assert/strict";
import { createAuth, validateCredentials, isUuid } from "../server/lib/auth.js";
import { HttpError } from "../server/lib/errors.js";

const auth = createAuth({ secret: "unit-test-secret", tokenTtlSeconds: 3600 });

test("tokens round-trip and carry the subject", () => {
  const token = auth.sign({ sub: "user-1", kind: "user", email: "a@b.co" });
  const payload = auth.verify(token);
  assert.equal(payload.sub, "user-1");
  assert.equal(payload.kind, "user");
  assert.ok(payload.exp > Date.now() / 1000);
});

test("tampered and expired tokens are rejected", () => {
  const token = auth.sign({ sub: "user-1" });
  const [version, payload, signature] = token.split(".");
  assert.equal(auth.verify(`${version}.${payload}.${signature.slice(0, -1)}x`), null);
  assert.equal(auth.verify("not-a-token"), null);
  assert.equal(auth.verify(auth.sign({ sub: "user-1" }, -1)), null);
});

test("passwords hash with a unique salt and verify", async () => {
  const first = await auth.hashPassword("correct horse battery staple");
  const second = await auth.hashPassword("correct horse battery staple");
  assert.notEqual(first.hash, second.hash);
  assert.notEqual(first.salt, second.salt);
  assert.equal(await auth.verifyPassword("correct horse battery staple", first.hash, first.salt), true);
  assert.equal(await auth.verifyPassword("wrong", first.hash, first.salt), false);
});

test("credential validation rejects bad input", () => {
  assert.equal(validateCredentials(" User@Example.COM ", "longenough"), "user@example.com");
  assert.throws(() => validateCredentials("not-an-email", "longenough"), HttpError);
  assert.throws(() => validateCredentials("a@b.co", "short"), /at least 8/);
});

test("identity comes from bearer token or device id", () => {
  const token = auth.sign({ sub: "user-1", kind: "user" });
  assert.equal(auth.identityFromRequest({ headers: { authorization: "Bearer " + token } }).userId, "user-1");
  assert.equal(
    auth.identityFromRequest({ headers: { "x-device-id": "99999999-9999-4999-8999-999999999999" } }).kind,
    "guest"
  );
  assert.equal(auth.identityFromRequest({ headers: {} }), null);
  assert.throws(() => auth.requireIdentity({ headers: {} }), /Sign in/);
});

test("uuid validation is strict", () => {
  assert.equal(isUuid("99999999-9999-4999-8999-999999999999"), true);
  assert.equal(isUuid("not-a-uuid"), false);
  assert.equal(isUuid(null), false);
});
