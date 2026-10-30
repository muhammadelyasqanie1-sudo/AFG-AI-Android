/* AFG AI · API client with JSON, SSE streaming and friendly errors */

import { getDeviceId, getPrefs, getServerUrl, getToken } from "./core.js";

export class ApiError extends Error {
  constructor(status, code, detail, extra = {}) {
    super(detail || "Request failed.");
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

let baseUrl = getServerUrl();

export function setBaseUrl(value) {
  baseUrl = String(value || "").replace(/\/+$/, "");
}

export function getBaseUrl() {
  return baseUrl;
}

function headers(extra = {}) {
  const result = {
    "X-Device-Id": getDeviceId(),
    "X-AFG-Client": "android-webview/2.0",
    ...extra
  };
  const token = getToken();
  if (token) result.Authorization = "Bearer " + token;
  return result;
}

function timeoutSignal(ms, inputSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("Timeout", "TimeoutError")), ms);
  const onAbort = () => controller.abort(inputSignal?.reason);
  if (inputSignal) {
    if (inputSignal.aborted) controller.abort(inputSignal.reason);
    else inputSignal.addEventListener("abort", onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    clear() {
      clearTimeout(timer);
      inputSignal?.removeEventListener("abort", onAbort);
    }
  };
}

async function parseError(response) {
  let data = {};
  try {
    data = await response.json();
  } catch {
    /* ignore */
  }
  return new ApiError(
    response.status,
    data.code || "http_" + response.status,
    data.detail || `Request failed (${response.status}).`,
    data
  );
}

async function request(pathname, options = {}) {
  const { method = "GET", body, timeout = 25000, signal, extraHeaders } = options;
  const control = timeoutSignal(timeout, signal);
  let response;
  try {
    response = await fetch(baseUrl + pathname, {
      method,
      headers: headers({
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...extraHeaders
      }),
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: control.signal
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      if (signal?.aborted) throw error;
      throw new ApiError(0, "timeout", "timeout");
    }
    throw new ApiError(0, "network", "network");
  } finally {
    control.clear();
  }

  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return null;
  const type = response.headers.get("content-type") || "";
  if (!type.includes("application/json")) return response.text();
  return response.json();
}

/* ------------------------------- Endpoints -------------------------------- */
export const api = {
  health({ deep = true, signal } = {}) {
    return request("/api/health" + (deep ? "?deep=1" : ""), { timeout: 12000, signal });
  },
  models({ force = false, signal } = {}) {
    return request("/api/models" + (force ? "?refresh=1" : ""), { timeout: 30000, signal });
  },
  chat(payload, { signal } = {}) {
    return request("/api/chat", {
      method: "POST",
      body: { ...payload, stream: false },
      timeout: 180000,
      signal
    });
  },
  image(payload, { signal } = {}) {
    return request("/api/image", {
      method: "POST",
      body: payload,
      timeout: 150000,
      signal
    });
  },
  register({ name, email, password }) {
    return request("/api/auth/register", {
      method: "POST",
      body: { name, email, password },
      timeout: 25000
    });
  },
  login({ email, password }) {
    return request("/api/auth/login", {
      method: "POST",
      body: { email, password },
      timeout: 25000
    });
  },
  me() {
    return request("/api/auth/me", { timeout: 15000 });
  },
  logout() {
    return request("/api/auth/logout", { method: "POST", timeout: 10000 }).catch(() => null);
  },
  listConversations() {
    return request("/api/conversations", { timeout: 20000 });
  },
  getConversation(id) {
    return request("/api/conversations/" + encodeURIComponent(id), { timeout: 20000 });
  },
  saveConversation(conversation) {
    return request("/api/conversations/" + encodeURIComponent(conversation.id), {
      method: "PUT",
      body: {
        title: conversation.title,
        mode: conversation.mode,
        model: conversation.model,
        messages: conversation.messages
      },
      timeout: 20000
    });
  },
  deleteConversation(id) {
    return request("/api/conversations/" + encodeURIComponent(id), {
      method: "DELETE",
      timeout: 15000
    });
  }
};

/* ----------------------------- Streaming chat ----------------------------- */
function parseSseBlock(block) {
  let event = "message";
  const data = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  return { event, data: data.join("\n") };
}

/**
 * POST /api/chat and consume server-sent events. Resolves with the final
 * payload. If the server responds with JSON instead of SSE, it is treated as
 * a completed response.
 */
export async function streamChat(payload, handlers = {}, { signal } = {}) {
  const control = timeoutSignal(180000, signal);
  let response;
  try {
    response = await fetch(baseUrl + "/api/chat", {
      method: "POST",
      headers: headers({ "content-type": "application/json", Accept: "text/event-stream" }),
      body: JSON.stringify({ ...payload, stream: true }),
      cache: "no-store",
      signal: control.signal
    });
  } catch (error) {
    control.clear();
    if (signal?.aborted) throw error;
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new ApiError(0, "timeout", "timeout");
    }
    throw new ApiError(0, "network", "network");
  }
  // The request has been accepted; a long answer may legitimately take a while.
  control.clear();

  if (!response.ok) throw await parseError(response);

  const type = response.headers.get("content-type") || "";
  if (!type.includes("text/event-stream") || !response.body) {
    const data = await response.json().catch(() => ({}));
    if (!data.reply) throw new ApiError(502, "bad_stream", "bad_stream");
    handlers.onDelta?.(data.reply);
    handlers.onDone?.(data);
    return data;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result = null;
  let sourceList = [];
  let accumulated = "";
  let streamError = null;

  const dispatch = (block) => {
    const { event, data } = parseSseBlock(block);
    if (!data) return;
    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    if (event === "meta") handlers.onMeta?.(parsed);
    else if (event === "delta" && typeof parsed.text === "string") {
      accumulated += parsed.text;
      handlers.onDelta?.(parsed.text, accumulated);
    } else if (event === "sources" && Array.isArray(parsed.sources)) {
      sourceList = parsed.sources;
      handlers.onSources?.(parsed.sources);
    } else if (event === "usage") handlers.onUsage?.(parsed);
    else if (event === "fallback") handlers.onFallback?.(parsed);
    else if (event === "error") {
      streamError = new ApiError(502, parsed.code || "stream_error", parsed.detail || "stream_error", parsed);
    } else if (event === "done") {
      result = { ...parsed, sources: parsed.sources || sourceList, reply: parsed.reply || accumulated };
      handlers.onDone?.(result);
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let index;
      while ((index = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        dispatch(block);
      }
      if (streamError) throw streamError;
    }
    buffer += decoder.decode();
    if (buffer.trim()) dispatch(buffer);
  } catch (error) {
    if (signal?.aborted) {
      return { reply: accumulated, stopped: true };
    }
    if (error instanceof ApiError) throw error;
    throw new ApiError(0, "stream_broken", "stream_broken");
  } finally {
    reader.releaseLock?.();
  }

  if (streamError) throw streamError;
  if (result) return result;
  if (accumulated) {
    const fallback = { reply: accumulated, sources: sourceList };
    handlers.onDone?.(fallback);
    return fallback;
  }
  throw new ApiError(502, "empty_stream", "empty_stream");
}

export function clearAuthState() {
  // Auth storage lives in core; this module only reads it per request.
  return getPrefs();
}
