import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../../server/app.js";

export async function startApp(env = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "afg-ai-test-"));
  const app = await createApp({
    env: {
      NODE_ENV: "test",
      DATA_DIR: dataDir,
      AUTH_SECRET: "test-secret-do-not-use-in-production",
      ...env
    },
    dataDir,
    authSecret: "test-secret-do-not-use-in-production"
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;

  async function close() {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }

  return { app, base, dataDir, close };
}

export function jsonRequest(base, pathname, { method = "GET", body, token, deviceId, headers = {} } = {}) {
  const finalHeaders = { ...headers };
  if (body !== undefined) finalHeaders["content-type"] = "application/json";
  if (token) finalHeaders.authorization = "Bearer " + token;
  if (deviceId) finalHeaders["x-device-id"] = deviceId;
  return fetch(base + pathname, {
    method,
    headers: finalHeaders,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

export const DEVICE_ID = "99999999-9999-4999-8999-999999999999";
