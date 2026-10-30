/* AFG AI · small, dependency-free, XSS-safe Markdown renderer */

import { escapeHtml } from "./core.js";
import { t } from "./i18n.js";

const SAFE_URL = /^https?:\/\//i;
const SAFE_IMAGE_DATA = /^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i;

function safeUrl(url) {
  const value = String(url || "").trim();
  return SAFE_URL.test(value) ? value : "";
}

function safeImageUrl(url) {
  const value = String(url || "").trim();
  return SAFE_URL.test(value) || SAFE_IMAGE_DATA.test(value) ? value : "";
}

function renderInline(text, store) {
  let value = escapeHtml(text);

  // Protect inline code before applying emphasis.
  value = value.replace(/`([^`\n]+)`/g, (_, code) => {
    const index = store.inline.push(`<code>${code}</code>`) - 1;
    return `\u0001IC${index}\u0001`;
  });

  value = value.replace(
    /!\[([^\]]*)\]\(((?:https?:\/\/|data:image\/)[^\s)]+)\)/gi,
    (match, alt, url) => {
      const safe = safeImageUrl(url);
      if (!safe) return match;
      return `<img src="${escapeHtml(safe)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async">`;
    }
  );

  value = value.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label, url) => {
    const safe = safeUrl(url);
    if (!safe) return match;
    return `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });

  value = value.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  value = value.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  value = value.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  value = value.replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  value = value.replace(/(^|[\s(])_([^_\n]+)_/g, "$1<em>$2</em>");
  value = value.replace(/  \n/g, "<br>");
  value = value.replace(/\n/g, "<br>");

  value = value.replace(/\u0001IC(\d+)\u0001/g, (_, index) => store.inline[Number(index)] || "");
  return value;
}

function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableSeparator(line) {
  return /^\s*\|?[\s:-]*-{2,}[\s:|-]*\|?\s*$/.test(line) && line.includes("|");
}

function isBlockStart(line) {
  return (
    /^\s*#{1,6}\s+/.test(line) ||
    /^\s*```/.test(line) ||
    /^\s*>\s?/.test(line) ||
    /^\s*([-*+]|\d+[.)])\s+/.test(line) ||
    /^\s*(\*\*\*|---|___)\s*$/.test(line) ||
    /^\u0000CB\d+\u0000\s*$/.test(line)
  );
}

export function renderMarkdown(source) {
  let text = String(source ?? "").replace(/\r\n?/g, "\n");

  // Close an unterminated code fence while a response is streaming.
  const fenceCount = (text.match(/^```/gm) || []).length;
  if (fenceCount % 2 === 1) text += "\n```";

  const store = { code: [], inline: [] };
  text = text.replace(/^```([^\n`]*)\n([\s\S]*?)```/gm, (_, language, code) => {
    const lang = String(language || "").trim().split(/\s+/)[0].slice(0, 24);
    const index = store.code.push({ language: lang, code }) - 1;
    return `\u0000CB${index}\u0000`;
  });

  const lines = text.split("\n");
  const html = [];
  let paragraph = [];
  let index = 0;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${renderInline(paragraph.join("\n"), store)}</p>`);
    paragraph = [];
  };

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      flushParagraph();
      index += 1;
      continue;
    }

    const codeToken = line.match(/^\u0000CB(\d+)\u0000\s*$/);
    if (codeToken) {
      flushParagraph();
      const block = store.code[Number(codeToken[1])];
      if (block) {
        html.push(
          `<div class="code-block"><div class="code-head"><span>${escapeHtml(
            block.language || "code"
          )}</span><button class="code-copy" type="button" data-copy-code>${escapeHtml(
            t("copy")
          )}</button></div><pre><code>${escapeHtml(block.code.replace(/\n$/, ""))}</code></pre></div>`
        );
      }
      index += 1;
      continue;
    }

    const heading = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      const level = Math.min(6, heading[1].length);
      html.push(`<h${level}>${renderInline(heading[2], store)}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^\s*(\*\*\*|---|___)\s*$/.test(line)) {
      flushParagraph();
      html.push("<hr>");
      index += 1;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      flushParagraph();
      const quote = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      html.push(`<blockquote>${renderInline(quote.join("\n"), store)}</blockquote>`);
      continue;
    }

    if (isTableSeparator(line) && index > 0 && lines[index - 1].includes("|")) {
      // The header was consumed as paragraph text; rebuild from the raw line.
      const headerLine = paragraph.length ? paragraph.pop() : "";
      flushParagraph();
      const header = splitTableRow(headerLine || lines[index - 1]);
      const rows = [];
      index += 1;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      html.push(
        `<table><thead><tr>${header
          .map((cell) => `<th>${renderInline(cell, store)}</th>`)
          .join("")}</tr></thead><tbody>${rows
          .map(
            (row) =>
              `<tr>${header
                .map((_, cellIndex) => `<td>${renderInline(row[cellIndex] || "", store)}</td>`)
                .join("")}</tr>`
          )
          .join("")}</tbody></table>`
      );
      continue;
    }

    const unordered = line.match(/^\s*[-*+]\s+(.*)$/);
    const ordered = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    if (unordered || ordered) {
      flushParagraph();
      const tag = unordered ? "ul" : "ol";
      const items = [];
      while (index < lines.length) {
        const match = unordered
          ? lines[index].match(/^\s*[-*+]\s+(.*)$/)
          : lines[index].match(/^\s*\d+[.)]\s+(.*)$/);
        if (!match) break;
        items.push(`<li>${renderInline(match[1], store)}</li>`);
        index += 1;
      }
      html.push(`<${tag}>${items.join("")}</${tag}>`);
      continue;
    }

    if (isBlockStart(line)) {
      flushParagraph();
      index += 1;
      continue;
    }

    paragraph.push(line);
    index += 1;
  }

  flushParagraph();
  return html.join("");
}

export function plainPreview(markdown, max = 90) {
  const text = String(markdown || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#*_>`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, max) + (text.length > max ? "…" : "");
}
