/**
 * Next-Generation Multimodal Processing
 * Vision (multi-image, OCR, charts), Documents (PDF, DOCX, XLSX),
 * Audio (Whisper transcription), Code Execution Sandbox
 */

import { HttpError, upstream } from "../lib/errors.js";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const MAX_IMAGES_PER_REQUEST = 10;
const SUPPORTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const SUPPORTED_DOC_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
];
const SUPPORTED_AUDIO_TYPES = [
  "audio/mpeg", "audio/wav", "audio/mp4", "audio/ogg", "audio/webm",
  "audio/flac", "audio/x-m4a", "audio/aac"
];

export function validateImage(dataUrl, maxSize = MAX_FILE_SIZE) {
  if (!dataUrl || typeof dataUrl !== "string") {
    throw new HttpError(400, "invalid_image", "Image data is required");
  }
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    throw new HttpError(400, "unsupported_image", "Unsupported image format. Use PNG, JPEG, WebP, or GIF");
  }
  const mimeType = match[1];
  if (!SUPPORTED_IMAGE_TYPES.includes(mimeType)) {
    throw new HttpError(400, "unsupported_image", `Unsupported image type: ${mimeType}`);
  }
  const base64 = match[2];
  const sizeBytes = Math.ceil(base64.length * 0.75);
  if (sizeBytes > maxSize) {
    throw new HttpError(413, "image_too_large", `Image exceeds ${maxSize / 1024 / 1024}MB limit`);
  }
  return { mimeType, base64, sizeBytes };
}

export function validateDocument(base64, mimeType, filename, maxSize = MAX_FILE_SIZE) {
  if (!base64 || typeof base64 !== "string") {
    throw new HttpError(400, "invalid_document", "Document data is required");
  }
  if (!SUPPORTED_DOC_TYPES.includes(mimeType)) {
    throw new HttpError(400, "unsupported_document", `Unsupported document type: ${mimeType}`);
  }
  const sizeBytes = Math.ceil(base64.length * 0.75);
  if (sizeBytes > maxSize) {
    throw new HttpError(413, "document_too_large", `Document exceeds ${maxSize / 1024 / 1024}MB limit`);
  }
  return { mimeType, base64, sizeBytes, filename };
}

export function validateAudio(base64, mimeType, maxSize = 25 * 1024 * 1024) {
  if (!base64 || typeof base64 !== "string") {
    throw new HttpError(400, "invalid_audio", "Audio data is required");
  }
  if (!SUPPORTED_AUDIO_TYPES.includes(mimeType)) {
    throw new HttpError(400, "unsupported_audio", `Unsupported audio type: ${mimeType}`);
  }
  const sizeBytes = Math.ceil(base64.length * 0.75);
  if (sizeBytes > maxSize) {
    throw new HttpError(413, "audio_too_large", `Audio exceeds ${maxSize / 1024 / 1024}MB limit`);
  }
  return { mimeType, base64, sizeBytes };
}

// ============================================================================
// DOCUMENT PROCESSING (text extraction)
// ============================================================================

export async function extractTextFromDocument({ base64, mimeType, filename }, { fetchImpl = fetch } = {}) {
  // For now, return a placeholder - in production this would use:
  // - pdf-parse for PDF
  // - mammoth for DOCX
  // - xlsx for XLSX
  // - pptxgenjs for PPTX
  // - Direct text for txt/md/csv/json
  const textTypes = ["text/plain", "text/markdown", "text/csv", "application/json"];
  if (textTypes.includes(mimeType)) {
    try {
      return Buffer.from(base64, "base64").toString("utf-8");
    } catch {
      throw new HttpError(400, "document_decode_failed", "Failed to decode text document");
    }
  }
  // For binary formats, return metadata only (full extraction requires native libraries)
  return `[Document: ${filename || "untitled"} (${mimeType}) - Text extraction requires server-side processing. Please provide key excerpts or use a supported text format.]`;
}

// ============================================================================
// OCR & IMAGE ANALYSIS (using vision models)
// ============================================================================

export async function analyzeImageWithVision(imageData, prompt, model, adapter) {
  const messages = [{
    role: "user",
    content: [
      { type: "text", text: prompt || "Describe this image in detail. Extract any text, charts, diagrams, or code visible." },
      { type: "image", dataUrl: imageData }
    ]
  }];
  return adapter.complete({ model, messages, system: "", temperature: 0.3, maxTokens: 4096 });
}

// ============================================================================
// AUDIO TRANSCRIPTION (Whisper-compatible)
// ============================================================================

export async function transcribeAudio(audioData, mimeType, { fetchImpl = fetch, apiKey, baseUrl } = {}) {
  if (!apiKey) {
    throw new HttpError(503, "transcription_unconfigured", "Audio transcription requires WHISPER_API_KEY or OPENAI_API_KEY");
  }

  const formData = new FormData();
  const buffer = Buffer.from(audioData, "base64");
  const blob = new Blob([buffer], { type: mimeType });
  formData.append("file", blob, "audio." + mimeType.split("/")[1]);
  formData.append("model", "whisper-1");
  formData.append("response_format", "json");
  formData.append("language", "auto");

  const url = (baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "") + "/audio/transcriptions";
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { Authorization: "Bearer " + apiKey },
    body: formData,
    signal: AbortSignal.timeout(120000)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new HttpError(response.status, "transcription_failed", error.error?.message || "Transcription failed");
  }

  const data = await response.json();
  return data.text || "";
}

// ============================================================================
// CODE EXECUTION SANDBOX
// ============================================================================

export async function executeCode({ code, language, timeoutMs = 30000 }, { fetchImpl = fetch, sandboxUrl } = {}) {
  if (!sandboxUrl) {
    throw new HttpError(503, "sandbox_unconfigured", "Code execution requires SANDBOX_URL");
  }

  const response = await fetchImpl(sandboxUrl + "/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, language, timeout: timeoutMs }),
    signal: AbortSignal.timeout(timeoutMs + 5000)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new HttpError(response.status, "execution_failed", error.error || "Code execution failed");
  }

  return response.json();
}

// ============================================================================
// MULTIMODAL MESSAGE BUILDER
// ============================================================================

export function buildMultimodalContent({ text, images = [], documents = [], audio = [] }) {
  const content = [];

  if (text) content.push({ type: "text", text });

  for (const img of images) {
    content.push({ type: "image", dataUrl: img.dataUrl });
  }

  for (const doc of documents) {
    content.push({
      type: "document",
      data: doc.base64,
      mimeType: doc.mimeType,
      filename: doc.filename
    });
  }

  for (const aud of audio) {
    content.push({
      type: "audio",
      data: aud.base64,
      mimeType: aud.mimeType
    });
  }

  return content.length === 1 && content[0].type === "text" ? content[0].text : content;
}

export function parseMultimodalInput(input) {
  const result = { text: "", images: [], documents: [], audio: [] };

  if (typeof input === "string") {
    result.text = input;
    return result;
  }

  if (Array.isArray(input)) {
    for (const part of input) {
      if (!part) continue;
      if (part.type === "text") result.text += part.text + "\n";
      else if (part.type === "image") result.images.push(part);
      else if (part.type === "document") result.documents.push(part);
      else if (part.type === "audio") result.audio.push(part);
    }
    result.text = result.text.trim();
    return result;
  }

  return result;
}

// ============================================================================
// FILE TYPE DETECTION
// ============================================================================

export function detectFileType(base64, filename = "") {
  const ext = filename.split(".").pop()?.toLowerCase();
  const mimeMap = {
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    txt: "text/plain",
    md: "text/markdown",
    csv: "text/csv",
    json: "application/json",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    m4a: "audio/mp4",
    ogg: "audio/ogg",
    webm: "audio/webm",
    flac: "audio/flac",
    aac: "audio/aac",
  };
  return mimeMap[ext] || "application/octet-stream";
}

export function isVisionModel(model) {
  return model.capabilities?.vision === true;
}

export function isAudioModel(model) {
  return model.capabilities?.audio === true || model.id?.includes("whisper");
}

export function getSupportedMimeTypes() {
  return {
    images: SUPPORTED_IMAGE_TYPES,
    documents: SUPPORTED_DOC_TYPES,
    audio: SUPPORTED_AUDIO_TYPES,
  };
}