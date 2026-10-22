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
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
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

function clientKey(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
}
const rateBuckets = new Map();
function rateLimited(req, limit = 20, windowMs = 60_000) {
  const now = Date.now(), key = clientKey(req);
  let bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.start >= windowMs) bucket = { start: now, count: 0 };
  bucket.count++;
  rateBuckets.set(key, bucket);
  if (rateBuckets.size > 5000) {
    for (const [k, v] of rateBuckets) if (now - v.start > windowMs) rateBuckets.delete(k);
  }
  return bucket.count > limit;
}

async function searchWeb(query) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    const error = new Error("Live web search is not configured yet. The administrator must add TAVILY_API_KEY on the server.");
    error.status = 503; throw error;
  }
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey, query: query.slice(0, 500), search_depth: "advanced", max_results: 5, include_answer: false }),
    signal: AbortSignal.timeout(20000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("Web search provider returned HTTP", response.status);
    const error = new Error(response.status === 429 ? "Web search is temporarily rate-limited. Try again shortly." : "The web search provider returned an error. Check its server configuration.");
    error.status = response.status === 429 ? 429 : 502; throw error;
  }
  return (Array.isArray(data.results) ? data.results : []).slice(0, 5).map(item => ({
    title: String(item.title || "Web result").slice(0, 250),
    url: String(item.url || ""),
    content: String(item.content || "").slice(0, 1800)
  })).filter(item => /^https?:\/\//i.test(item.url));
}

async function handleChat(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { detail: "Use POST for this endpoint." });
  }
  if (rateLimited(req, 20)) return sendJson(res, 429, { detail: "Too many requests from this connection. Please wait a minute and try again." });
  const apiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return sendJson(res, 503, { detail: "The AI provider key is not configured. The administrator must add AI_API_KEY in Render." });

  let body;
  try { body = await readJson(req, 7 * 1024 * 1024); }
  catch (error) { return sendJson(res, error.status || 400, { detail: error.message || "Could not read request." }); }

  const inputMessages = Array.isArray(body.messages) ? body.messages : [];
  const messages = inputMessages
    .filter(m => m && ["user", "assistant"].includes(m.role) && typeof m.content === "string")
    .slice(-20).map(m => ({ role: m.role, content: m.content.slice(0, 12000) }));
  const lastUser = messages.filter(m => m.role === "user").slice(-1)[0];
  if (!lastUser || !lastUser.content.trim()) return sendJson(res, 400, { detail: "Send a non-empty user message." });
  let imageData = "";
  if (typeof body.image === "string" && body.image) {
    if (body.image.length > 7 * 1024 * 1024 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(body.image)) {
      return sendJson(res, 400, { detail: "Unsupported image. Choose a PNG, JPEG, or WebP image under 5 MB." });
    }
    imageData = body.image;
  }
  const aiMessages = messages.map((m, index) => {
    if (imageData && m === lastUser) {
      return { role: m.role, content: [
        { type: "text", text: m.content },
        { type: "image_url", image_url: { url: imageData, detail: "auto" } }
      ] };
    }
    return m;
  });

  const language = body.language === "fa" ? "Persian/Dari" : body.language === "en" ? "English" : "the same language as the user's latest message (detect it automatically)";
  const mode = ["chat", "research", "coding", "creative", "study"].includes(body.mode) ? body.mode : "chat";
  const modeInstructions = {
    chat: "Answer naturally and helpfully. Ask a clarifying question only when it is genuinely needed.",
    research: "Act as a careful research assistant. Separate verified facts from uncertainty, compare sources, and cite source titles and URLs when sources are provided.",
    coding: "Act as an expert software engineer. Give runnable code when appropriate, explain assumptions, consider edge cases, and include security and testing notes.",
    creative: "Act as a creative partner. Offer original, concrete, polished ideas and respect the requested style and constraints.",
    study: "Act as a patient tutor. Teach step by step, use examples, check understanding, and adapt the explanation to the learner."
  };
  let sources = [];
  if (body.web_search === true || mode === "research") {
    try { sources = await searchWeb(lastUser.content); }
    catch (error) { return sendJson(res, error.status || 502, { detail: error.message || "Live web search failed." }); }
    if (!sources.length) return sendJson(res, 502, { detail: "The search provider returned no usable results. Try a more specific query." });
  }
  const baseUrl = (process.env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = process.env.AI_MODEL || "gpt-4.1-mini";
  const systemText = "You are AFG AI, a genuinely useful, accurate, respectful assistant designed for people in Afghanistan. Reply in " + language +
    ". When the user writes in Dari/Persian, use natural Afghan Dari vocabulary and clear readable phrasing; do not force Iranian-specific expressions when an Afghan expression fits better. Give practical steps that work on Android and with limited bandwidth when relevant. Consider Afghanistan-specific context only when useful; do not assume the user's province, beliefs, budget, or circumstances. Explain unfamiliar technical terms simply. For education, teach step by step; for coding, provide complete safe code and explain exactly where it belongs; for documents, help draft and translate useful real-world text. If asked about prices, laws, news, or other changing facts, distinguish current verified information from general knowledge and do not invent live facts. Protect privacy: never ask for passwords or API keys, and advise keeping secrets on the server. If an image is attached, inspect it carefully and describe uncertainty rather than guessing. Be transparent about uncertainty and never claim you performed an action you did not perform. For every answer, identify the user’s actual goal first; prioritize the direct answer, then give clear actionable steps. Use headings or lists only when they improve readability. Avoid generic filler, repeating the question, and unnecessary disclaimers. If a request is ambiguous, ask one focused question; otherwise make a reasonable assumption and state it briefly when needed. For technical tasks, inspect the provided context, preserve existing working behavior, give complete compatible solutions, and explain likely failure points. For factual or research tasks, distinguish evidence from inference, cite available source URLs, and explicitly say when evidence is insufficient. For calculations, check the arithmetic. For Dari/Persian, use natural Afghan Dari, right-to-left-friendly formatting, and practical wording. " +
    modeInstructions[mode] +
    (sources.length ? "\n\nUse these live web search results as evidence. Do not invent details beyond them. Mention relevant source titles in the answer and clearly distinguish source claims from your own explanation:\n" +
      sources.map((x, i) => "[" + (i + 1) + "] " + x.title + "\nURL: " + x.url + "\nSnippet: " + x.content).join("\n\n") : "");
  try {
    const upstream = await fetch(baseUrl + "/chat/completions", {
      method: "POST",
      headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "system", content: systemText }, ...aiMessages], temperature: mode === "coding" || mode === "research" ? 0.3 : 0.7 }),
      signal: AbortSignal.timeout(60000)
    });
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      console.error("AI provider returned HTTP", upstream.status, JSON.stringify(data).slice(0, 1200));
      const status = upstream.status === 429 ? 429 : 502;
      return sendJson(res, status, { detail: upstream.status === 401 || upstream.status === 403
        ? "The AI provider rejected the API key. Check AI_API_KEY and provider settings."
        : upstream.status === 429 ? "The AI provider rate limit or account quota was reached. Check provider usage."
        : "The AI provider returned an error. Check Render logs and AI_BASE_URL / AI_MODEL settings." });
    }
    const choice = data.choices && data.choices[0];
    const reply = choice && choice.message && choice.message.content;
    if (typeof reply !== "string" || !reply.trim()) return sendJson(res, 502, { detail: "The AI provider response did not contain text." });
    await persistChatTurn(body, lastUser.content, reply, model);
    return sendJson(res, 200, { reply, model, mode, sources: sources.map(({ title, url }) => ({ title, url })) });
  } catch (error) {
    console.error("AI request failed:", error.name, error.message);
    return sendJson(res, 502, { detail: error.name === "TimeoutError" ? "The AI provider timed out. Try again shortly." : "Could not connect to the AI provider. Check AI_BASE_URL and Render logs." });
  }
}

async function handleImage(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return sendJson(res, 405, { detail: "Use POST for this endpoint." }); }
  if (rateLimited(req, 5)) return sendJson(res, 429, { detail: "Too many image requests. Please wait a minute and try again." });
  let body;
  try { body = await readJson(req, 100 * 1024); }
  catch (error) { return sendJson(res, error.status || 400, { detail: error.message || "Could not read request." }); }
  const prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 4000) : "";
  if (!prompt) return sendJson(res, 400, { detail: "Write a description of the image you want." });
  const apiKey = process.env.IMAGE_API_KEY;
  if (!apiKey) return sendJson(res, 503, { detail: "Image generation is not configured yet. The administrator must add IMAGE_API_KEY and configure an image provider on the server." });
  const baseUrl = (process.env.IMAGE_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = process.env.IMAGE_MODEL || "gpt-image-1";
  try {
    const upstream = await fetch(baseUrl + "/images/generations", {
      method: "POST",
      headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, n: 1, size: "1024x1024" }),
      signal: AbortSignal.timeout(120000)
    });
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      console.error("Image provider returned HTTP", upstream.status, JSON.stringify(data).slice(0, 800));
      return sendJson(res, upstream.status === 429 ? 429 : 502, { detail: upstream.status === 401 || upstream.status === 403 ? "The image provider rejected IMAGE_API_KEY." : upstream.status === 429 ? "Image generation is rate-limited. Try again later." : "The image provider returned an error. Check IMAGE_BASE_URL and IMAGE_MODEL." });
    }
    const item = data.data && data.data[0];
    const imageUrl = item && (item.url || (item.b64_json ? "data:image/png;base64," + item.b64_json : ""));
    if (typeof imageUrl !== "string" || !imageUrl) return sendJson(res, 502, { detail: "The image provider returned no image." });
    return sendJson(res, 200, { imageUrl, model });
  } catch (error) {
    console.error("Image request failed:", error.name, error.message);
    return sendJson(res, 502, { detail: error.name === "TimeoutError" ? "Image generation timed out." : "Could not connect to the image provider." });
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
      aiConfigured: Boolean(process.env.AI_API_KEY || process.env.OPENAI_API_KEY),
      webSearchConfigured: Boolean(process.env.TAVILY_API_KEY),
      imageConfigured: Boolean(process.env.IMAGE_API_KEY)
    });
  }

  if (pathname === "/api/chat") {
    return handleChat(req, res);
  }

  if (pathname === "/api/image") {
    return handleImage(req, res);
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
