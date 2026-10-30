import crypto from "node:crypto";
import { badRequest, tooMany, unavailable, HttpError } from "../lib/errors.js";
import { readJson, sendError, sendJson, sseSend, sseStart } from "../lib/http.js";
import { clientKey } from "../lib/rate-limit.js";
import { buildSystemPrompt, MODES, deriveTitle } from "../prompts.js";
import { buildFallbackChain, routeModels, classifyTask, recordModelResult, recordRoutingAnalytics } from "../providers/router.js";
import { isUuid } from "../lib/auth.js";
import { validateImage, validateDocument, validateAudio, extractTextFromDocument, buildMultimodalContent, parseMultimodalInput, transcribeAudio, isVisionModel } from "../lib/multimodal.js";

const IMAGE_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const MAX_IMAGES_PER_REQUEST = 10;
const DOCUMENT_RE = /^data:(application\/pdf|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation)|text\/(plain|markdown|csv)|application\/json);base64,[A-Za-z0-9+/=]+$/;
const AUDIO_RE = /^data:(audio\/(?:mpeg|wav|mp4|ogg|webm|flac|x-m4a|aac));base64,[A-Za-z0-9+/=]+$/;

function normalizeMessages(input, limits) {
  if (!Array.isArray(input)) return [];
  return input
    .filter(
      (message) =>
        message &&
        (message.role === "user" || message.role === "assistant" || message.role === "system") &&
        (typeof message.content === "string" || Array.isArray(message.content))
    )
    .slice(-limits.maxMessages)
    .map((message) => {
      const content = typeof message.content === "string"
        ? message.content.slice(0, limits.maxMessageChars)
        : message.content;
      return {
        role: message.role,
        content,
        model: message.model || null,
        sources: Array.isArray(message.sources) ? message.sources : [],
        createdAt: message.createdAt || new Date().toISOString(),
      };
    })
    .filter((message) => {
      if (typeof message.content === "string") return message.content.trim().length > 0;
      return Array.isArray(message.content) && message.content.some(p => p.type === "text" && p.text?.trim());
    });
}

function validateImageInput(value, limits) {
  if (!value) return null;
  try {
    return validateImage(value, limits.imageBytes);
  } catch (error) {
    throw badRequest(error.message, error.code);
  }
}

function validateDocumentInput(value, limits) {
  if (!value) return null;
  const match = value.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw badRequest("Invalid document format. Use data URI with base64.", "invalid_document");
  try {
    return validateDocument(match[2], match[1], "document", limits.bodyBytes);
  } catch (error) {
    throw badRequest(error.message, error.code);
  }
}

function validateAudioInput(value, limits) {
  if (!value) return null;
  const match = value.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw badRequest("Invalid audio format. Use data URI with base64.", "invalid_audio");
  try {
    return validateAudio(match[2], match[1], 25 * 1024 * 1024);
  } catch (error) {
    throw badRequest(error.message, error.code);
  }
}

function publicRouting(selection, attempted = []) {
  return {
    auto: true,
    primary: selection.primary ? selection.primary.uid : null,
    reasons: selection.reasons,
    candidates: selection.ordered.map((model) => ({
      uid: model.uid,
      id: model.id,
      provider: model.provider,
      tier: model.tier
    })),
    attempted,
    excluded: selection.excluded.slice(0, 8).map((entry) => ({
      uid: entry.model.uid,
      reason: entry.reason
    }))
  };
}

function conversationPayload({ conversationId, title, mode, model, messages, sources }) {
  return {
    id: conversationId,
    title,
    mode,
    model,
    messages: messages.map((message, index) =>
      index === messages.length - 1
        ? { ...message, sources: sources || [] }
        : message
    )
  };
}

export function createChatHandler(ctx) {
  const { config, db, auth, catalog, adapter, search, supabase, limiter } = ctx;

  return async function handleChat(req, res) {
    const startTime = Date.now();
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return sendJson(req, res, config, 405, { detail: "Use POST for this endpoint.", code: "method_not_allowed" });
    }

    const body = await readJson(req, config.limits.bodyBytes);
    const identity = auth.identityFromRequest(req, body);
    const bucket = limiter.hit("chat:" + clientKey(req, identity), config.limits.chatPerMinute, 60_000);
    if (bucket.limited) {
      throw tooMany("Too many chat requests. Please wait a moment.", bucket.retryAfter);
    }

    const mode = MODES.includes(body.mode) ? body.mode : "chat";
    const messages = normalizeMessages(body.messages, config.limits);
    if (!messages.length && typeof body.message === "string" && body.message.trim()) {
      messages.push({ role: "user", content: body.message.trim().slice(0, config.limits.maxMessageChars) });
    }
    const lastUser = [...messages].reverse().find((message) => message.role === "user");
    if (!lastUser) throw badRequest("Send a non-empty message.", "empty_message");

    // Multimodal input handling
    const images = [];
    const documents = [];
    const audioFiles = [];

    // Handle legacy single image
    if (body.image) {
      const validated = validateImageInput(body.image, config.limits);
      if (validated) images.push({ dataUrl: body.image, ...validated });
    }

    // Handle multiple images
    if (Array.isArray(body.images)) {
      for (const img of body.images.slice(0, MAX_IMAGES_PER_REQUEST)) {
        const validated = validateImageInput(img, config.limits);
        if (validated) images.push({ dataUrl: img, ...validated });
      }
    }

    // Handle documents
    if (Array.isArray(body.documents)) {
      for (const doc of body.documents.slice(0, 5)) {
        const validated = validateDocumentInput(doc, config.limits);
        if (validated) documents.push(validated);
      }
    }

    // Handle audio
    if (Array.isArray(body.audio)) {
      for (const aud of body.audio.slice(0, 3)) {
        const validated = validateAudioInput(aud, config.limits);
        if (validated) audioFiles.push(validated);
      }
    }

    const language = ["fa", "en", "auto"].includes(body.language) ? body.language : "auto";
    const requestedModel =
      typeof body.model === "string" && body.model && body.model !== "auto" ? body.model : null;

    const catalogState = await catalog.get({ force: Boolean(body.refresh_models) });
    const models = catalogState.models;
    if (!models.length) {
      throw unavailable(
        "No AI models are available right now. Ask the administrator to configure a provider key.",
        "no_models"
      );
    }

    // Classify task for intelligent routing
    const userText = typeof lastUser.content === "string" ? lastUser.content : "";
    const taskClassification = classifyTask(userText, body.mode);

    const requirements = {
      mode,
      task: taskClassification.primary,
      hasImage: images.length > 0,
      hasDocuments: documents.length > 0,
      hasAudio: audioFiles.length > 0,
      preferredModelId: requestedModel,
      preferFast: Boolean(body.prefer_fast),
      preferCheap: Boolean(body.prefer_cheap),
      needsLongContext: Boolean(body.needs_long_context),
      needsReasoning: Boolean(body.needs_reasoning),
      userPreferences: body.user_preferences || {},
      abTestVariant: body.ab_test_variant || null,
    };

    let selection;
    if (requestedModel) {
      const chosen = models.find((model) => model.uid === requestedModel || model.id === requestedModel);
      if (!chosen) {
        throw badRequest("That model is not available anymore. Pick another model or use Auto.", "model_unavailable");
      }
      if (images.length && !isVisionModel(chosen)) {
        throw badRequest("The selected model cannot read images. Use Auto or a vision model.", "vision_unsupported");
      }
      selection = routeModels(models, { ...requirements, preferredModelId: chosen.uid, limit: 4 });
    } else {
      selection = routeModels(models, { ...requirements, limit: 4 });
    }
    if (!selection.primary) throw unavailable("No model is eligible for this request.", "no_model_eligible");

    // Process documents (extract text)
    let documentText = "";
    if (documents.length) {
      const extracted = await Promise.all(
        documents.map(doc => extractTextFromDocument(doc))
      );
      documentText = extracted.join("\n\n---\n\n");
    }

    // Transcribe audio
    let audioText = "";
    if (audioFiles.length) {
      const whisperKey = config.search.tavilyKey || config.providers.openaiKey; // fallback
      const whisperUrl = config.providers.openaiBaseUrl;
      for (const aud of audioFiles) {
        try {
          const transcript = await transcribeAudio(aud.base64, aud.mimeType, { apiKey: whisperKey, baseUrl: whisperUrl });
          audioText += transcript + "\n";
        } catch (error) {
          console.warn("Audio transcription failed:", error.message);
        }
      }
    }

    // Build enhanced user message with multimodal content
    const enhancedContent = buildMultimodalContent({
      text: userText + (documentText ? "\n\n[Documents]\n" + documentText : "") + (audioText ? "\n\n[Audio Transcript]\n" + audioText : ""),
      images: images.map(i => ({ dataUrl: i.dataUrl })),
      documents,
      audio: audioFiles
    });

    // Update last user message with multimodal content
    lastUser.content = enhancedContent;

    const wantsResearch = body.web_search === true || mode === "research";
    let sources = [];
    if (wantsResearch) {
      sources = await search.search(lastUser.content);
      if (!sources.length) {
        throw new HttpError(502, "no_search_results", "The search provider returned no usable results. Try a more specific question.");
      }
    }

    const system = buildSystemPrompt({ language, mode, sources, hasImage: images.length > 0, hasDocuments: documents.length > 0, hasAudio: audioFiles.length > 0 });
    const conversationId =
      typeof body.conversation_id === "string" && body.conversation_id.length < 80
        ? body.conversation_id
        : crypto.randomUUID();
    const streamRequested = body.stream !== false;
    const shouldPersist = identity && body.persist !== false;
    const title = deriveTitle(userText);

    const modelMessages = messages.map((message) =>
      message === lastUser
        ? { ...message, content: enhancedContent }
        : message
    );

    const persist = (reply, usedModel, replySources) => {
      if (!shouldPersist) return;
      try {
        const stored = [
          ...messages.map((message) => ({ ...message })),
          {
            role: "assistant",
            content: reply,
            model: usedModel.id,
            sources: replySources || [],
            createdAt: new Date().toISOString()
          }
        ].slice(-config.limits.maxStoredMessages);
        db.upsertConversation(identity.userId, conversationPayload({
          conversationId,
          title,
          mode,
          model: usedModel.uid,
          messages: stored,
          sources: replySources
        }));
        db.recordUsage(identity.userId, usedModel.uid);
      } catch (error) {
        console.warn("Could not persist conversation:", error.message);
      }
      if (identity.kind === "user") {
        supabase
          .persistChatTurn({
            userId: identity.userId,
            sessionId: isUuid(conversationId) ? conversationId : crypto.randomUUID(),
            userText: userText,
            assistantText: reply,
            model: usedModel.id,
            language
          })
          .catch(() => {});
      }
    };

    const routing = publicRouting(
      routeModels(models, { ...requirements, limit: 4 })
    );

    if (!streamRequested) {
      const attempted = [];
      let lastError = null;
      let current = selection;
      for (let hop = 0; hop < 3 && current.primary; hop += 1) {
        const model = current.primary;
        attempted.push(model.uid);
        try {
          const result = await adapter.complete({
            model,
            messages: modelMessages,
            system,
            temperature: mode === "coding" || mode === "research" ? 0.3 : 0.7,
            maxTokens: config.upstream.maxOutputTokens
          });
          const latency = Date.now() - startTime;
          recordModelResult(model.uid, true, latency);
          recordRoutingAnalytics({ mode, task: taskClassification.primary, model: model.uid, latencyMs: latency });
          persist(result.text, model, sources);
          return sendJson(req, res, config, 200, {
            reply: result.text,
            response: result.text,
            model: model.uid,
            modelId: model.id,
            provider: model.provider,
            mode,
            sources: sources.map(({ title: sourceTitle, url }) => ({ title: sourceTitle, url })),
            usage: result.usage,
            conversation_id: conversationId,
            routing: { ...routing, auto: !requestedModel, attempted },
            task: taskClassification,
          });
        } catch (error) {
          recordModelResult(model.uid, false);
          lastError = error;
          if (!(error instanceof HttpError) || error.status === 400 || error.status === 401) throw error;
          current = buildFallbackChain(models, {
            ...requirements,
            preferredModelId: null,
            exclude: attempted
          });
        }
      }
      recordRoutingAnalytics({ mode, task: taskClassification.primary, model: "none", error: true });
      throw lastError || unavailable("No model could complete this request.", "no_model");
    }

    // ---- Server-sent events streaming -------------------------------------
    sseStart(req, res, config);
    const controller = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) controller.abort();
    });

    const attempted = [];
    let reply = "";
    let usedModel = null;

    try {
      let current = selection;
      let lastError = null;
      for (let hop = 0; hop < 3 && current.primary; hop += 1) {
        const model = current.primary;
        attempted.push(model.uid);
        try {
          sseSend(res, "meta", {
            model: model.uid,
            modelId: model.id,
            provider: model.provider,
            mode,
            title,
            conversation_id: conversationId,
            routing: { ...routing, auto: !requestedModel, attempted },
            fallback: hop > 0,
            task: taskClassification,
          });
          for await (const event of adapter.stream({
            model,
            messages: modelMessages,
            system,
            temperature: mode === "coding" || mode === "research" ? 0.3 : 0.7,
            maxTokens: config.upstream.maxOutputTokens,
            signal: controller.signal
          })) {
            if (event.type === "delta" && event.text) {
              reply += event.text;
              sseSend(res, "delta", { text: event.text });
            } else if (event.type === "usage") {
              sseSend(res, "usage", event.usage);
            } else if (event.type === "tool_calls") {
              sseSend(res, "tool_calls", { toolCalls: event.toolCalls });
            }
          }
          usedModel = model;
          break;
        } catch (error) {
          lastError = error;
          if (controller.signal.aborted) return res.end();
          if (reply) throw error;
          if (!(error instanceof HttpError) || error.status === 400 || error.status === 401) throw error;
          sseSend(res, "fallback", { failed: model.uid, reason: error.code || "error" });
          current = buildFallbackChain(models, {
            ...requirements,
            preferredModelId: null,
            exclude: attempted
          });
        }
      }

      if (!usedModel || !reply.trim()) {
        const error = lastError || new HttpError(502, "empty_response", "The model returned no text.");
        recordRoutingAnalytics({ mode, task: taskClassification.primary, model: "none", error: true });
        sseSend(res, "error", {
          detail: error.message,
          code: error.code || "error",
          retryAfter: error.extra?.retryAfter
        });
        return res.end();
      }

      const latency = Date.now() - startTime;
      recordModelResult(usedModel.uid, true, latency);
      recordRoutingAnalytics({ mode, task: taskClassification.primary, model: usedModel.uid, latencyMs: latency });

      if (sources.length) {
        sseSend(res, "sources", {
          sources: sources.map(({ title: sourceTitle, url }) => ({ title: sourceTitle, url }))
        });
      }
      persist(reply, usedModel, sources);
      sseSend(res, "done", {
        reply,
        model: usedModel.uid,
        modelId: usedModel.id,
        provider: usedModel.provider,
        conversation_id: conversationId,
        mode,
        routing: { ...routing, auto: !requestedModel, attempted },
        task: taskClassification,
      });
      res.end();
    } catch (error) {
      if (controller.signal.aborted) return res.end();
      recordRoutingAnalytics({ mode, task: taskClassification.primary, model: usedModel?.uid || "none", error: true });
      if (!res.writableEnded) {
        sseSend(res, "error", {
          detail: error instanceof HttpError ? error.message : "The request failed. Please try again.",
          code: error instanceof HttpError ? error.code : "error"
        });
        res.end();
      } else {
        sendError(req, res, config, error);
      }
    }
  };
}

export { normalizeMessages, validateImageInput, validateDocumentInput, validateAudioInput, publicRouting };