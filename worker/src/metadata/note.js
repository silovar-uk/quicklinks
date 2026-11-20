import { cleanText, timedFetch } from "./security.js";

// note's public article-detail endpoint is unofficial; treat it as a best-effort
// metadata source, and fall back to normal HTML when it is unavailable.
export function noteArticleKey(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || !/^(?:www\.)?note\.com$/i.test(url.hostname)) return "";
    const match = url.pathname.match(/^\/[^/]+\/n\/(n[0-9a-f]{10,20})\/?$/i);
    return match ? match[1] : "";
  } catch (_) {
    return "";
  }
}

const MAX_JSON_BYTES = 1536 * 1024;

async function readJsonBounded(response) {
  const length = Number(response.headers.get("content-length") || 0);
  if (length > MAX_JSON_BYTES) throw new Error("note_json_too_large");
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES) throw new Error("note_json_too_large");
    return JSON.parse(text);
  }
  const chunks = [];
  let total = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > MAX_JSON_BYTES) {
      try { await reader.cancel(); } catch (_) {}
      throw new Error("note_json_too_large");
    }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(total);
  let pos = 0;
  for (const chunk of chunks) { bytes.set(chunk, pos); pos += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function publicBodyExcerpt(body) {
  if (typeof body !== "string") return "";
  const text = body
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:nbsp|amp|lt|gt|quot|#39);/gi, " ");
  return cleanText(text, 460);
}

export async function resolveNoteMetadata(rawUrl) {
  const key = noteArticleKey(rawUrl);
  if (!key) return null;

  const response = await timedFetch("https://note.com/api/v3/notes/" + key, {
    method: "GET",
    redirect: "manual",
    headers: { "Accept": "application/json", "Accept-Language": "ja,en;q=0.7" }
  });
  if (!response.ok || !/application\/json/i.test(response.headers.get("content-type") || "")) return null;

  const payload = await readJsonBounded(response);
  const data = payload?.data?.note || payload?.data;
  if (!data || typeof data !== "object" || (data.key && data.key !== key)) return null;
  if (data.status && !["published", "public"].includes(data.status)) return null;

  const title = cleanText(data.name || data.title, 240);
  if (!title) return null;
  // Only use the public excerpt for paid articles. Never request draft/private APIs.
  const description = cleanText(data.description, 1000) ||
    (Number(data.price || 0) === 0 && data.canRead !== false ? publicBodyExcerpt(data.body) : "");

  return {
    url: rawUrl,
    title,
    description,
    provider: "note",
    descriptionSource: description ? (data.description ? "note-api-description" : "note-api-public-body") : "none",
    confidence: description ? "high" : "medium"
  };
}
