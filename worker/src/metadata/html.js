import { cleanText, fetchSafeHtml } from "./security.js";

class MetaCollector {
  constructor() { this.values = {}; }
  element(el) {
    const key = String(el.getAttribute("property") || el.getAttribute("name") || "").toLowerCase().trim();
    const value = cleanText(el.getAttribute("content") || "", 1200);
    if (key && value && !this.values[key]) this.values[key] = value;
  }
}

class TextCollector {
  constructor(limit = 800) { this.limit = limit; this.value = ""; }
  text(chunk) {
    if (this.value.length < this.limit) this.value += chunk.text;
  }
}

class ParagraphCollector {
  constructor(maxParagraphs = 8, maxChars = 1800) {
    this.maxParagraphs = maxParagraphs;
    this.maxChars = maxChars;
    this.paragraphs = [];
    this.current = null;
    this.total = 0;
  }
  element(el) {
    if (this.paragraphs.length >= this.maxParagraphs || this.total >= this.maxChars) return;
    this.current = "";
    el.onEndTag(() => {
      if (this.current == null) return;
      const text = cleanText(this.current, 600);
      this.current = null;
      if (text.length < 40) return;
      if (/^(share|共有|シェア|関連記事|おすすめ|目次|menu|home|トップ|公開日|更新日)\b/i.test(text)) return;
      this.paragraphs.push(text);
      this.total += text.length;
    });
  }
  text(chunk) {
    if (this.current != null && this.total < this.maxChars) this.current += chunk.text;
  }
}

class JsonLdCollector {
  constructor() { this.blocks = []; this.current = null; }
  element(el) {
    this.current = "";
    el.onEndTag(() => {
      const text = String(this.current || "").trim();
      this.current = null;
      if (text && text.length <= 120000) this.blocks.push(text);
    });
  }
  text(chunk) {
    if (this.current != null && this.current.length <= 120000) this.current += chunk.text;
  }
}

function findDescription(value, depth = 0) {
  if (depth > 6 || value == null) return "";
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findDescription(item, depth + 1);
      if (hit) return hit;
    }
    return "";
  }
  if (typeof value !== "object") return "";
  if (typeof value.description === "string" && cleanText(value.description).length >= 20) return value.description;
  if (Array.isArray(value["@graph"])) {
    const hit = findDescription(value["@graph"], depth + 1);
    if (hit) return hit;
  }
  for (const item of Object.values(value)) {
    const hit = findDescription(item, depth + 1);
    if (hit) return hit;
  }
  return "";
}

function jsonLdDescription(blocks) {
  for (const block of blocks) {
    try {
      const hit = findDescription(JSON.parse(block));
      if (hit) return cleanText(hit, 1000);
    } catch (_) {}
  }
  return "";
}

function paragraphDescription(paragraphs) {
  const out = [];
  let total = 0;
  for (const paragraph of paragraphs || []) {
    const text = cleanText(paragraph, 500);
    if (text.length < 40 || out.includes(text)) continue;
    if (total && total + text.length + 1 > 460) break;
    out.push(text);
    total += text.length + 1;
    if (total >= 260) break;
  }
  return cleanText(out.join(" "), 460);
}

export async function extractHtmlMetadata(rawUrl) {
  const fetched = await fetchSafeHtml(rawUrl);
  const meta = new MetaCollector();
  const title = new TextCollector(500);
  const articleH1 = new TextCollector(500);
  const mainH1 = new TextCollector(500);
  const anyH1 = new TextCollector(500);
  const articleP = new ParagraphCollector();
  const mainP = new ParagraphCollector();
  const bodyP = new ParagraphCollector(6, 1200);
  const jsonLd = new JsonLdCollector();

  await new HTMLRewriter()
    .on("meta[property]", meta)
    .on("meta[name]", meta)
    .on("title", title)
    .on("article h1", articleH1)
    .on("main h1", mainH1)
    .on("h1", anyH1)
    .on("article p", articleP)
    .on("main p", mainP)
    .on("body p", bodyP)
    .on('script[type="application/ld+json"]', jsonLd)
    .transform(new Response(fetched.html, { headers: { "Content-Type": "text/html; charset=utf-8" } }))
    .text();

  const jsonDescription = jsonLdDescription(jsonLd.blocks);
  const bodyDescription = paragraphDescription(articleP.paragraphs) ||
    paragraphDescription(mainP.paragraphs) ||
    paragraphDescription(bodyP.paragraphs);

  const host = new URL(fetched.url).hostname.replace(/^www\./i, "");
  const titleValue = cleanText(
    meta.values["og:title"] || meta.values["twitter:title"] || articleH1.value || mainH1.value || anyH1.value || title.value || host,
    240
  );
  const description = cleanText(
    meta.values["description"] ||
    meta.values["og:description"] ||
    meta.values["twitter:description"] ||
    jsonDescription ||
    bodyDescription,
    1000
  );

  let source = "none";
  if (meta.values["description"]) source = "meta";
  else if (meta.values["og:description"]) source = "og";
  else if (meta.values["twitter:description"]) source = "twitter";
  else if (jsonDescription) source = "json-ld";
  else if (bodyDescription) source = "body";

  return {
    url: fetched.url,
    title: titleValue,
    description,
    provider: "web",
    descriptionSource: source,
    confidence: description ? (source === "body" ? "medium" : "high") : "low"
  };
}
