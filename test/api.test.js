import test from "node:test";
import assert from "node:assert/strict";
import { jsonRequest, startApp, DEVICE_ID } from "./lib/helpers.js";

test("health, models and security headers", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const health = await fetch(app.base + "/api/health?deep=1");
  assert.equal(health.status, 200);
  assert.equal(health.headers.get("x-content-type-options"), "nosniff");
  const healthBody = await health.json();
  assert.equal(healthBody.ok, true);
  assert.equal(healthBody.version, "2.0.0");
  assert.equal(typeof healthBody.features.streaming, "boolean");

  const models = await jsonRequest(app.base, "/api/models");
  assert.equal(models.status, 200);
  const modelBody = await models.json();
  assert.equal(modelBody.configured, false);
  assert.deepEqual(modelBody.models, []);
  assert.ok(modelBody.detail.includes("No AI provider"));

  const missing = await jsonRequest(app.base, "/api/nope");
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).code, "endpoint_not_found");
});

test("CORS allows the Android WebView origin and blocks unknown origins", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const allowed = await fetch(app.base + "/api/health", {
    headers: { Origin: "https://appassets.androidplatform.net" }
  });
  assert.equal(allowed.headers.get("access-control-allow-origin"), "https://appassets.androidplatform.net");

  const denied = await fetch(app.base + "/api/health", {
    headers: { Origin: "https://evil.example" }
  });
  assert.equal(denied.status, 403);

  const preflight = await fetch(app.base + "/api/chat", {
    method: "OPTIONS",
    headers: {
      Origin: "https://appassets.androidplatform.net",
      "Access-Control-Request-Method": "POST"
    }
  });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get("access-control-allow-headers"), /Authorization/);
});

test("account lifecycle: register, login, me, duplicate email", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const registration = await jsonRequest(app.base, "/api/auth/register", {
    method: "POST",
    body: { email: "User@Example.com", password: "strong-password", name: "  Ahmad  " }
  });
  assert.equal(registration.status, 201);
  const registered = await registration.json();
  assert.equal(registered.user.email, "user@example.com");
  assert.equal(registered.user.name, "Ahmad");
  assert.ok(registered.token);
  assert.equal(registered.user.passwordHash, undefined);

  const duplicate = await jsonRequest(app.base, "/api/auth/register", {
    method: "POST",
    body: { email: "user@example.com", password: "strong-password" }
  });
  assert.equal(duplicate.status, 409);

  const wrong = await jsonRequest(app.base, "/api/auth/login", {
    method: "POST",
    body: { email: "user@example.com", password: "wrong-password" }
  });
  assert.equal(wrong.status, 401);

  const login = await jsonRequest(app.base, "/api/auth/login", {
    method: "POST",
    body: { email: "user@example.com", password: "strong-password" }
  });
  assert.equal(login.status, 200);
  const { token } = await login.json();

  const me = await jsonRequest(app.base, "/api/auth/me", { token });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).user.kind, "user");

  const anonymous = await jsonRequest(app.base, "/api/auth/me");
  assert.equal(anonymous.status, 401);
});

test("conversation storage is scoped to the caller", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const registration = await jsonRequest(app.base, "/api/auth/register", {
    method: "POST",
    body: { email: "owner@example.com", password: "strong-password" }
  });
  const { token } = await registration.json();
  const id = "11111111-1111-4111-8111-111111111111";

  const created = await jsonRequest(app.base, "/api/conversations", {
    method: "POST",
    token,
    body: {
      id,
      title: "Plan a study schedule",
      mode: "study",
      messages: [{ role: "user", content: "Help me study" }]
    }
  });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).conversation.title, "Plan a study schedule");

  const list = await jsonRequest(app.base, "/api/conversations", { token });
  assert.equal(list.status, 200);
  assert.equal((await list.json()).conversations.length, 1);

  const fetched = await jsonRequest(app.base, `/api/conversations/${id}`, { token });
  assert.equal(fetched.status, 200);

  const otherDevice = await jsonRequest(app.base, `/api/conversations/${id}`, {
    deviceId: DEVICE_ID
  });
  assert.equal(otherDevice.status, 404);

  const deleted = await jsonRequest(app.base, `/api/conversations/${id}`, {
    method: "DELETE",
    token
  });
  assert.equal(deleted.status, 200);
  assert.equal((await deleted.json()).ok, true);
});

test("guest device ids can chat and persist their own conversations", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const devices = await jsonRequest(app.base, "/api/health");
  assert.equal(devices.status, 200);

  const list = await jsonRequest(app.base, "/api/conversations", { deviceId: DEVICE_ID });
  assert.equal(list.status, 200);
  assert.deepEqual((await list.json()).conversations, []);
});

test("rate limiting returns 429 with Retry-After", async (t) => {
  const app = await startApp({ RATE_LIMIT_AUTH: "2" });
  t.after(() => app.close());

  const attempt = () =>
    jsonRequest(app.base, "/api/auth/login", {
      method: "POST",
      body: { email: "nobody@example.com", password: "wrong-password" }
    });
  assert.equal((await attempt()).status, 401);
  assert.equal((await attempt()).status, 401);
  const limited = await attempt();
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
});
