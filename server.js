const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = path.join(__dirname, "app", "src", "main", "assets");
const port = Number(process.env.PORT || 3000);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  });
  res.end(JSON.stringify(data));
}

function readJson(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    req.on("data", chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error("Request body too large"), { status: 413 }));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(Object.assign(new Error("Invalid JSON body"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

async function persistChatTurn(body, userText, assistantText, model) {
  const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return;

  const isUuid = value => typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  const userId = isUuid(body.user_id) ? body.user_id : crypto.randomUUID();
  const sessionId = isUuid(body.session_id) ? body.session_id : crypto.randomUUID();
  const language = body.language === "en" ? "en" : "fa";
  const headers = {
    "apikey": supabaseKey,
    "Authorization": "Bearer " + supabaseKey,
    "Content-Type": "application/json",
    "Prefer": "return=minimal"
  };

  try {
    const sessionResponse = await fetch(supabaseUrl + "/rest/v1/chat_sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        id: sessionId,
        user_id: userId,
        title: userText.slice(0, 120),
        language
      }),
      signal: AbortSignal.timeout(8000)
    });
    // A 409 means this browser session was already created; continue appending messages.
    if (!sessionResponse.ok && sessionResponse.status !== 409) {
      console.warn("Supabase session insert failed:", sessionResponse.status);
      return;
    }

    const messageResponse = await fetch(supabaseUrl + "/rest/v1/chat_messages", {
      method: "POST",
      headers,
      body: JSON.stringify([
        { session_id: sessionId, role: "user", content: userText.slice(0, 12000), model },
        { session_id: sessionId, role: "assistant", content: assistantText.slice(0, 24000), model }
      ]),
      signal: AbortSignal.timeout(8000)
    });
    if (!messageResponse.ok) {
      console.warn("Supabase message insert failed:", messageResponse.status);
    }
  } catch (error) {
    console.warn("Supabase persistence unavailable:", error.name, error.message);
  }
}

async function handleChat(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { detail: "Use POST for this endpoint." });
  }

  const apiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return sendJson(res, 503, {
      detail: "AI backend is deployed, but no provider API key is configured. Add AI_API_KEY in the Render environment variables."
    });
  }

  let body;
  try {
    body = await readJson(req);
  } catch (error) {
    return sendJson(res, error.status || 400, { detail: error.message || "Could not read request." });
  }

  const inputMessages = Array.isArray(body.messages) ? body.messages : [];
  const messages = inputMessages
    .filter(m => m && ["user", "assistant"].includes(m.role) && typeof m.content === "string")
    .slice(-20)
    .map(m => ({ role: m.role, content: m.content.slice(0, 12000) }));

  if (!messages.length || !messages.some(m => m.role === "user" && m.content.trim())) {
    return sendJson(res, 400, { detail: "Send a non-empty user message." });
  }

  const language = body.language === "fa" ? "Persian/Dari" :
    body.language === "en" ? "English" : "the same language as the user's latest message (detect it automatically)";
  const baseUrl = (process.env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = process.env.AI_MODEL || "gpt-4.1-mini";

  try {
    const upstream = await fetch(baseUrl + "/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: "You are AFG AI, a helpful, accurate, respectful assistant for users in Afghanistan. Reply in " +
              language + ". When the user writes in Dari/Persian, use clear natural Dari/Persian. Be transparent about uncertainty."
          },
          ...messages
        ],
        temperature: 0.7
      }),
      signal: AbortSignal.timeout(60000)
    });

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      console.error("AI provider returned HTTP", upstream.status, JSON.stringify(data).slice(0, 1200));
      const status = upstream.status === 401 || upstream.status === 403 ? 502 :
        upstream.status === 429 ? 429 : 502;
      return sendJson(res, status, {
        detail: upstream.status === 401 || upstream.status === 403
          ? "The AI provider rejected the API key. Check AI_API_KEY and provider settings."
          : upstream.status === 429
            ? "The AI provider rate limit or account quota was reached. Check provider usage and billing."
            : "The AI provider returned an error. Check Render logs and AI_BASE_URL / AI_MODEL settings."
      });
    }

    const choice = data.choices && data.choices[0];
    const reply = choice && choice.message && choice.message.content;
    if (typeof reply !== "string" || !reply.trim()) {
      console.error("Unexpected AI provider response:", JSON.stringify(data).slice(0, 1200));
      return sendJson(res, 502, { detail: "The AI provider response did not contain text." });
    }
    await persistChatTurn(body, messages.filter(m => m.role === "user").slice(-1)[0].content, reply, model);
    return sendJson(res, 200, { reply, model });
  } catch (error) {
    console.error("AI request failed:", error.name, error.message);
    return sendJson(res, 502, {
      detail: error.name === "TimeoutError"
        ? "The AI provider timed out. Try again shortly."
        : "Could not connect to the AI provider. Check AI_BASE_URL and Render logs."
    });
  }
}

http.createServer(async (req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  } catch {
    return sendJson(res, 400, { detail: "Invalid URL." });
  }

  if (pathname.startsWith("/api/") && req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400"
    });
    return res.end();
  }

  if (pathname === "/api/health") {
    return sendJson(res, 200, {
      ok: true,
      service: "AFG AI",
      aiConfigured: Boolean(process.env.AI_API_KEY || process.env.OPENAI_API_KEY)
    });
  }

  if (pathname === "/api/chat") {
    return handleChat(req, res);
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "Allow": "GET, HEAD, POST" });
    return res.end("Method not allowed");
  }

  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const file = path.resolve(root, requested);
  if (!file.startsWith(root + path.sep) && file !== path.join(root, "index.html")) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(err.code === "ENOENT" ? 404 : 500, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end(err.code === "ENOENT" ? "Not found" : "Server error");
    }
    res.writeHead(200, {
      "Content-Type": types[path.extname(file)] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": path.extname(file) === ".html" ? "no-cache" : "public, max-age=3600"
    });
    if (req.method === "HEAD") return res.end();
    res.end(data);
  });
}).listen(port, "0.0.0.0", () => console.log("AFG AI listening on port " + port));
