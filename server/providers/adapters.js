import { HttpError, upstream } from "../lib/errors.js";
import { resolveProviderKey, resolveProviderDescriptor } from "./catalog.js";

const VISION_DATA_RE = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/;

function timeoutSignal(signal, ms) {
  const timeout = AbortSignal.timeout(ms);
  if (!signal) return timeout;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([signal, timeout]);
  return timeout;
}

function imageParts(content) {
  if (!Array.isArray(content)) return [];
  return content.filter((part) => part && part.type === "image" && part.dataUrl);
}

export function toAnthropicMessages(messages) {
  return messages.map((message) => {
    if (typeof message.content === "string") {
      return { role: message.role, content: message.content };
    }
    if (!Array.isArray(message.content)) {
      return { role: message.role, content: String(message.content || "") };
    }
    const content = [];
    for (const part of message.content) {
      if (part.type === "text" && part.text) {
        content.push({ type: "text", text: part.text });
      } else if (part.type === "image" && part.dataUrl) {
        const match = String(part.dataUrl).match(VISION_DATA_RE);
        if (match) {
          content.push({
            type: "image",
            source: { type: "base64", media_type: match[1], data: match[2] }
          });
        }
      }
    }
    return { role: message.role, content: content.length ? content : [{ type: "text", text: "" }] };
  });
}

export function toOpenAIMessages(messages) {
  return messages.map((message) => {
    if (typeof message.content === "string") {
      return { role: message.role, content: message.content };
    }
    if (!Array.isArray(message.content)) {
      return { role: message.role, content: String(message.content || "") };
    }
    return {
      role: message.role,
      content: message.content
        .map((part) => {
          if (part.type === "text") return { type: "text", text: part.text || "" };
          if (part.type === "image" && part.dataUrl) {
            return { type: "image_url", image_url: { url: part.dataUrl, detail: "auto" } };
          }
          return null;
        })
        .filter(Boolean)
    };
  });
}

export function toGeminiMessages(messages) {
  return messages.map((message) => {
    if (typeof message.content === "string") {
      return { role: message.role === "assistant" ? "model" : "user", parts: [{ text: message.content }] };
    }
    if (!Array.isArray(message.content)) {
      return { role: message.role === "assistant" ? "model" : "user", parts: [{ text: String(message.content || "") }] };
    }
    const parts = [];
    for (const part of message.content) {
      if (part.type === "text" && part.text) {
        parts.push({ text: part.text });
      } else if (part.type === "image" && part.dataUrl) {
        const match = String(part.dataUrl).match(VISION_DATA_RE);
        if (match) {
          parts.push({
            inline_data: { mime_type: match[1], data: match[2] }
          });
        }
      }
    }
    return { role: message.role === "assistant" ? "model" : "user", parts: parts.length ? parts : [{ text: "" }] };
  });
}

export function toCohereMessages(messages) {
  return messages.map((message) => {
    if (typeof message.content === "string") {
      return { role: message.role === "assistant" ? "CHATBOT" : "USER", message: message.content };
    }
    if (!Array.isArray(message.content)) {
      return { role: message.role === "assistant" ? "CHATBOT" : "USER", message: String(message.content || "") };
    }
    const textParts = message.content
      .filter((part) => part.type === "text" && part.text)
      .map((part) => part.text)
      .join("\n");
    return { role: message.role === "assistant" ? "CHATBOT" : "USER", message: textParts };
  });
}

export function toMistralMessages(messages) {
  return messages.map((message) => {
    if (typeof message.content === "string") {
      return { role: message.role, content: message.content };
    }
    if (!Array.isArray(message.content)) {
      return { role: message.role, content: String(message.content || "") };
    }
    return {
      role: message.role,
      content: message.content
        .map((part) => {
          if (part.type === "text") return { type: "text", text: part.text || "" };
          if (part.type === "image" && part.dataUrl) {
            return { type: "image_url", image_url: { url: part.dataUrl, detail: "auto" } };
          }
          return null;
        })
        .filter(Boolean)
    };
  });
}

function errorFor(status, payload) {
  const providerMessage = String(
    payload?.error?.message || payload?.message || payload?.detail || ""
  ).slice(0, 300);
  if (status === 401 || status === 403) {
    return new HttpError(
      502,
      "provider_auth",
      "The AI provider rejected the server credentials. Check the API key and account access."
    );
  }
  if (status === 429) {
    return new HttpError(
      429,
      "provider_rate_limited",
      "The AI provider rate limit or account quota was reached. Try again shortly.",
      { retryAfter: 30 }
    );
  }
  if (status === 404) {
    return new HttpError(
      502,
      "provider_model_unavailable",
      "The provider no longer exposes this model. Choose another model or use Auto."
    );
  }
  return new HttpError(
    502,
    "provider_error",
    providerMessage && /timeout|overloaded/i.test(providerMessage)
      ? "The AI provider is busy right now. Please try again."
      : "The AI provider could not complete this request. Try again or choose another model."
  );
}

function textFromOpenAI(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : part?.text || ""))
      .join("");
  }
  return "";
}

function textFromAnthropic(data) {
  if (typeof data?.content === "string") return data.content;
  if (!Array.isArray(data?.content)) return "";
  return data.content
    .filter((block) => block && block.type === "text")
    .map((block) => block.text || "")
    .join("\n");
}

function textFromGemini(data) {
  const candidate = data?.candidates?.[0];
  if (!candidate) return "";
  const parts = candidate.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts.map((p) => p.text || "").join("");
}

function textFromCohere(data) {
  return data?.text || data?.generations?.[0]?.text || "";
}

function textFromMistral(data) {
  return data?.choices?.[0]?.message?.content || "";
}

async function* sseData(response) {
  const decoder = new TextDecoder();
  let buffer = "";
  const readBlock = (block) => {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    return data || null;
  };

  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, "\n");
    let index;
    while ((index = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const data = readBlock(block);
      if (data) yield data;
    }
  }
  buffer += decoder.decode();
  const data = readBlock(buffer);
  if (data) yield data;
}

async function* sseGemini(response) {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        yield JSON.parse(line);
      } catch {
        continue;
      }
    }
  }
  if (buffer.trim()) {
    try {
      yield JSON.parse(buffer);
    } catch {}
  }
}

export function createAdapter({ config, fetchImpl = fetch } = {}) {
  function requestFor(model, { messages, system, temperature, maxTokens, tools, toolChoice }) {
    const descriptor = model._descriptor;
    const key = resolveProviderKey(model, config);
    if (!key) throw upstream("No server credentials are available for this provider.", "provider_unconfigured");
    const base = String(descriptor?.baseUrl || "").replace(/\/+$/, "");

    // Anthropic
    if (model.api === "anthropic") {
      const body = {
        model: model.id,
        max_tokens: Math.min(maxTokens || config.upstream.maxOutputTokens, 32000),
        system,
        messages: toAnthropicMessages(messages)
      };
      if (typeof temperature === "number") body.temperature = temperature;
      if (tools?.length) body.tools = tools;
      if (toolChoice) body.tool_choice = toolChoice;
      return {
        url: base + "/messages",
        headers: {
          "content-type": "application/json",
          "x-api-key": key,
          Authorization: "Bearer " + key,
          "anthropic-version": "2023-06-01"
        },
        body
      };
    }

    // Gemini
    if (model.api === "gemini") {
      const body = {
        contents: toGeminiMessages(messages),
        generationConfig: {
          maxOutputTokens: Math.min(maxTokens || config.upstream.maxOutputTokens, 32000),
          temperature: typeof temperature === "number" ? temperature : 0.7,
        },
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      };
      if (tools?.length) body.tools = [{ functionDeclarations: tools }];
      return {
        url: base + "/models/" + model.id + ":generateContent",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": key,
        },
        body
      };
    }

    // Cohere
    if (model.api === "cohere") {
      const body = {
        model: model.id,
        message: messages[messages.length - 1]?.content || "",
        chatHistory: toCohereMessages(messages.slice(0, -1)),
        preamble: system,
        temperature: typeof temperature === "number" ? temperature : 0.7,
        maxTokens: Math.min(maxTokens || config.upstream.maxOutputTokens, 32000),
      };
      if (tools?.length) body.tools = tools;
      return {
        url: base + "/chat",
        headers: {
          "content-type": "application/json",
          Authorization: "Bearer " + key,
        },
        body
      };
    }

    // Mistral
    if (model.api === "mistral") {
      const body = {
        model: model.id,
        messages: toMistralMessages(messages),
        temperature: typeof temperature === "number" ? temperature : 0.7,
        max_tokens: Math.min(maxTokens || config.upstream.maxOutputTokens, 32000),
      };
      if (system) body.messages.unshift({ role: "system", content: system });
      if (tools?.length) body.tools = tools;
      return {
        url: base + "/chat/completions",
        headers: {
          "content-type": "application/json",
          Authorization: "Bearer " + key,
        },
        body
      };
    }

    // Azure OpenAI
    if (model.api === "openai" && descriptor?.id === "azure") {
      const deployment = model.id;
      const apiVersion = descriptor.apiVersion || "2024-02-15-preview";
      const body = {
        model: deployment,
        messages: [{ role: "system", content: system }, ...toOpenAIMessages(messages)],
        temperature: typeof temperature === "number" ? temperature : 0.7,
        max_tokens: Math.min(maxTokens || config.upstream.maxOutputTokens, 32000),
      };
      if (tools?.length) body.tools = tools;
      if (toolChoice) body.tool_choice = toolChoice;
      return {
        url: base + "/" + deployment + "/chat/completions?api-version=" + apiVersion,
        headers: {
          "content-type": "application/json",
          "api-key": key,
        },
        body
      };
    }

    // OpenAI-compatible (OpenAI, OpenRouter, Grok, etc.)
    const body = {
      model: model.id,
      messages: [{ role: "system", content: system }, ...toOpenAIMessages(messages)],
    };
    if (maxTokens) body.max_tokens = Math.min(maxTokens, 32000);
    if (typeof temperature === "number" && !/^(o[1-4]|gpt-5|deepseek-r1)/i.test(model.id)) {
      body.temperature = temperature;
    }
    if (tools?.length) body.tools = tools;
    if (toolChoice) body.tool_choice = toolChoice;

    const extraHeaders = {};
    if (descriptor?.id === "openrouter") {
      extraHeaders["HTTP-Referer"] = "https://afgai.app";
      extraHeaders["X-Title"] = "AFG AI";
    }
    if (descriptor?.id === "grok") {
      // Grok uses OpenAI-compatible format
    }

    return {
      url: base + "/chat/completions",
      headers: {
        "content-type": "application/json",
        Authorization: "Bearer " + key,
        ...extraHeaders
      },
      body
    };
  }

  async function complete({ model, messages, system, temperature, maxTokens, signal, tools, toolChoice }) {
    const request = requestFor(model, { messages, system, temperature, maxTokens, tools, toolChoice });
    let response;
    try {
      response = await fetchImpl(request.url, {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify(request.body),
        signal: timeoutSignal(signal, config.upstream.timeoutMs)
      });
    } catch (error) {
      if (error?.name === "TimeoutError" || error?.name === "AbortError") {
        throw new HttpError(504, "provider_timeout", "The AI provider timed out. Please try again.");
      }
      throw new HttpError(502, "provider_unreachable", "Could not reach the AI provider.");
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw errorFor(response.status, data);

    let text = "";
    if (model.api === "anthropic") text = textFromAnthropic(data);
    else if (model.api === "gemini") text = textFromGemini(data);
    else if (model.api === "cohere") text = textFromCohere(data);
    else if (model.api === "mistral") text = textFromMistral(data);
    else text = textFromOpenAI(data);

    if (!text.trim()) {
      throw new HttpError(502, "empty_response", "The selected model returned no text. Try another model.");
    }

    const usage = model.api === "anthropic"
      ? { input: data.usage?.input_tokens ?? null, output: data.usage?.output_tokens ?? null }
      : model.api === "gemini"
      ? { input: data.usageMetadata?.promptTokenCount ?? null, output: data.usageMetadata?.candidatesTokenCount ?? null }
      : model.api === "cohere"
      ? { input: data.meta?.tokens?.inputTokens ?? null, output: data.meta?.tokens?.outputTokens ?? null }
      : model.api === "mistral"
      ? { input: data.usage?.prompt_tokens ?? null, output: data.usage?.completion_tokens ?? null }
      : { input: data.usage?.prompt_tokens ?? null, output: data.usage?.completion_tokens ?? null };

    return { text, usage, model: model.id, provider: model.provider, toolCalls: data?.tool_calls || data?.candidates?.[0]?.content?.parts?.filter(p => p.functionCall) || [] };
  }

  async function* stream({ model, messages, system, temperature, maxTokens, signal, tools, toolChoice }) {
    const request = requestFor(model, { messages, system, temperature, maxTokens, tools, toolChoice });

    // Gemini doesn't support streaming via the same SSE format
    if (model.api === "gemini") {
      request.body.stream = false;
      let response;
      try {
        response = await fetchImpl(request.url, {
          method: "POST",
          headers: request.headers,
          body: JSON.stringify(request.body),
          signal: timeoutSignal(signal, config.upstream.timeoutMs)
        });
      } catch (error) {
        if (error?.name === "TimeoutError" || error?.name === "AbortError") {
          throw new HttpError(504, "provider_timeout", "The AI provider timed out. Please try again.");
        }
        throw new HttpError(502, "provider_unreachable", "Could not reach the AI provider.");
      }
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw errorFor(response.status, data);
      }
      const data = await response.json().catch(() => ({}));
      const text = textFromGemini(data);
      if (text) {
        // Simulate streaming by chunking
        const chunks = text.match(/.{1,50}/g) || [text];
        for (const chunk of chunks) {
          yield { type: "delta", text: chunk };
        }
        yield { type: "usage", usage: { input: data.usageMetadata?.promptTokenCount, output: data.usageMetadata?.candidatesTokenCount } };
      }
      return;
    }

    // Cohere streaming
    if (model.api === "cohere") {
      request.body.stream = true;
      let response;
      try {
        response = await fetchImpl(request.url, {
          method: "POST",
          headers: request.headers,
          body: JSON.stringify(request.body),
          signal: timeoutSignal(signal, config.upstream.timeoutMs)
        });
      } catch (error) {
        if (error?.name === "TimeoutError" || error?.name === "AbortError") {
          throw new HttpError(504, "provider_timeout", "The AI provider timed out. Please try again.");
        }
        throw new HttpError(502, "provider_unreachable", "Could not reach the AI provider.");
      }
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw errorFor(response.status, data);
      }
      let produced = false;
      for await (const raw of sseData(response)) {
        if (raw === "[DONE]") break;
        let event;
        try {
          event = JSON.parse(raw);
        } catch {
          continue;
        }
        if (event.eventType === "text-generation") {
          produced = true;
          yield { type: "delta", text: event.text || "" };
        } else if (event.eventType === "stream-end") {
          yield { type: "usage", usage: { input: event.meta?.tokens?.inputTokens, output: event.meta?.tokens?.outputTokens } };
        }
      }
      if (!produced) {
        throw new HttpError(502, "empty_stream", "The model stream ended without text. Try another model.");
      }
      return;
    }

    // Standard OpenAI-compatible streaming (OpenAI, OpenRouter, Grok, Mistral, Azure)
    request.body.stream = true;
    let response;
    try {
      response = await fetchImpl(request.url, {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify(request.body),
        signal: timeoutSignal(signal, config.upstream.timeoutMs)
      });
    } catch (error) {
      if (error?.name === "TimeoutError" || error?.name === "AbortError") {
        throw new HttpError(504, "provider_timeout", "The AI provider timed out. Please try again.");
      }
      throw new HttpError(502, "provider_unreachable", "Could not reach the AI provider.");
    }

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw errorFor(response.status, data);
    }

    const contentType = String(response.headers.get("content-type") || "");
    if (!contentType.includes("text/event-stream")) {
      const data = await response.json().catch(() => ({}));
      let text = "";
      if (model.api === "anthropic") text = textFromAnthropic(data);
      else if (model.api === "mistral") text = textFromMistral(data);
      else text = textFromOpenAI(data);
      if (text) yield { type: "delta", text };
      return;
    }

    let produced = false;
    for await (const raw of sseData(response)) {
      if (raw === "[DONE]") break;
      let event;
      try {
        event = JSON.parse(raw);
      } catch {
        continue;
      }
      if (event.type === "error") {
        throw errorFor(502, event);
      }
      if (model.api === "anthropic") {
        if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
          produced = true;
          yield { type: "delta", text: event.delta.text || "" };
        } else if (event.type === "message_delta" && event.usage) {
          yield {
            type: "usage",
            usage: { input: event.usage.input_tokens ?? null, output: event.usage.output_tokens ?? null }
          };
        }
      } else {
        const delta = event.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta) {
          produced = true;
          yield { type: "delta", text: delta };
        }
        if (event.usage) {
          yield {
            type: "usage",
            usage: {
              input: event.usage.prompt_tokens ?? null,
              output: event.usage.completion_tokens ?? null
            }
          };
        }
        // Tool calls
        const toolCalls = event.choices?.[0]?.delta?.tool_calls;
        if (toolCalls) {
          yield { type: "tool_calls", toolCalls };
        }
      }
    }
    if (!produced) {
      throw new HttpError(502, "empty_stream", "The model stream ended without text. Try another model.");
    }
  }

  return { complete, stream };
}