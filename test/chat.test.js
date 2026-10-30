import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startApp, jsonRequest, DEVICE_ID } from "./lib/helpers.js";

function createFakeProvider() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      let parsed = {};
      try {
        parsed = body ? JSON.parse(body) : {};
      } catch {}
      requests.push({ url: req.url, body: parsed });

      if (req.url === "/v1/models") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(
          JSON.stringify({
            data: [{ id: "test-chat" }, { id: "gpt-5-vision" }]
          })
        );
      }

      if (req.url.endsWith("/chat/completions")) {
        if (parsed.stream) {
          res.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive"
          });
          res.write('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n');
          res.write('data: {"choices":[{"delta":{"content":" from AFG"}}]}\n\n');
          res.write('data: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":5}}\n\n');
          res.write("data: [DONE]\n\n");
          return res.end();
        }
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(
          JSON.stringify({
            choices: [{ message: { content: "Non-stream reply" } }],
            usage: { prompt_tokens: 2, completion_tokens: 3 }
          })
        );
      }

      res.writeHead(404, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        server,
        requests,
        base: `http://127.0.0.1:${server.address().port}`
      });
    });
  });
}

async function startWithProvider(t) {
  const provider = await createFakeProvider();
  const app = await startApp({
    AI_API_KEY: "fake-key",
    AI_BASE_URL: provider.base + "/v1",
    AI_MODELS: "test-chat,gpt-5-vision",
    MODEL_CATALOG_TTL_SECONDS: "300"
  });
  t.after(async () => {
    await app.close();
    await new Promise((resolve) => provider.server.close(resolve));
  });
  return { app, provider };
}

test("model catalog is discovered from an OpenAI-compatible provider", async (t) => {
  const { app } = await startWithProvider(t);
  const response = await jsonRequest(app.base, "/api/models?refresh=1");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.configured, true);
  assert.equal(body.count, 2);
  assert.ok(body.models.every((model) => model.providerId === "openai"));
  assert.ok(body.models.every((model) => model.uid.startsWith("openai:")));
  assert.ok(body.recommended.chat);
  assert.equal(body.autoRouting, true);
});

test("streaming chat emits meta, deltas and persists the conversation", async (t) => {
  const { app } = await startWithProvider(t);

  const response = await jsonRequest(app.base, "/api/chat", {
    method: "POST",
    deviceId: DEVICE_ID,
    body: {
      messages: [{ role: "user", content: "Say hello" }],
      mode: "chat",
      stream: true,
      conversation_id: "22222222-2222-4222-8222-222222222222"
    }
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/event-stream/);
  const text = await response.text();
  assert.match(text, /event: meta/);
  assert.match(text, /event: delta/);
  assert.match(text, /"text":"Hello"/);
  assert.match(text, /"text":" from AFG"/);
  assert.match(text, /event: done/);
  assert.match(text, /"reply":"Hello from AFG"/);
  assert.match(text, /"auto":true/);

  const list = await jsonRequest(app.base, "/api/conversations", { deviceId: DEVICE_ID });
  const conversations = (await list.json()).conversations;
  assert.equal(conversations.length, 1);
  assert.equal(conversations[0].messageCount, 2);

  const fetched = await jsonRequest(
    app.base,
    "/api/conversations/22222222-2222-4222-8222-222222222222",
    { deviceId: DEVICE_ID }
  );
  const conversation = (await fetched.json()).conversation;
  assert.equal(conversation.messages[1].role, "assistant");
  assert.equal(conversation.messages[1].content, "Hello from AFG");
});

test("non-streaming chat returns JSON and uses the selected model", async (t) => {
  const { app } = await startWithProvider(t);
  const response = await jsonRequest(app.base, "/api/chat", {
    method: "POST",
    deviceId: DEVICE_ID,
    body: {
      messages: [{ role: "user", content: "hello" }],
      model: "openai:test-chat",
      stream: false
    }
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.reply, "Non-stream reply");
  assert.equal(body.model, "openai:test-chat");
  assert.equal(body.routing.auto, false);
  assert.ok(body.conversation_id);
});

test("image requests are routed only to vision models", async (t) => {
  const { app, provider } = await startWithProvider(t);
  const image = "data:image/png;base64," + Buffer.from("fake-image").toString("base64");
  const response = await jsonRequest(app.base, "/api/chat", {
    method: "POST",
    deviceId: DEVICE_ID,
    body: {
      messages: [{ role: "user", content: "What is in this image?" }],
      image,
      stream: true
    }
  });
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.match(text, /"model":"openai:gpt-5-vision"/);

  const chatRequest = provider.requests.find((entry) => entry.url.endsWith("/chat/completions"));
  const userMessage = chatRequest.body.messages.find((message) => message.role === "user");
  assert.ok(Array.isArray(userMessage.content));
  assert.equal(userMessage.content[1].type, "image_url");
});

test("research mode without a search key fails clearly before streaming", async (t) => {
  const { app } = await startWithProvider(t);
  const response = await jsonRequest(app.base, "/api/chat", {
    method: "POST",
    deviceId: DEVICE_ID,
    body: {
      messages: [{ role: "user", content: "latest news" }],
      mode: "research",
      stream: true
    }
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "search_unconfigured");
});

test("chat rejects oversized images and empty messages", async (t) => {
  const { app } = await startWithProvider(t);
  const empty = await jsonRequest(app.base, "/api/chat", {
    method: "POST",
    deviceId: DEVICE_ID,
    body: { messages: [] }
  });
  assert.equal(empty.status, 400);

  const badImage = await jsonRequest(app.base, "/api/chat", {
    method: "POST",
    deviceId: DEVICE_ID,
    body: {
      messages: [{ role: "user", content: "look" }],
      image: "data:image/gif;base64,AAAA"
    }
  });
  assert.equal(badImage.status, 400);
  assert.equal((await badImage.json()).code, "unsupported_image");
});
