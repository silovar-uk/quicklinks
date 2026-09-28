const METADATA_MAX_BYTES = 1536 * 1024;
const METADATA_FETCH_TIMEOUT = 7000;
const MAX_REDIRECTS = 4;

export function cleanText(value, max = 0) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!max || text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 1)).trim() + "…";
}

function parseIpv4(hostname) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return null;
  const parts = hostname.split(".").map(Number);
  return parts.every(n => n >= 0 && n <= 255) ? parts : null;
}

export function isUnsafeHostname(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  const ip = parseIpv4(host);
  if (ip) {
    const a = ip[0], b = ip[1];
    return a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224;
  }
  if (host.includes(":")) {
    if (host === "::1" || host === "::" || /^::ffff:/i.test(host) || /^f[cd]/i.test(host) || /^fe[89ab]/i.test(host)) return true;
  }
  return false;
}

export function validateTarget(raw) {
  let url;
  try { url = raw instanceof URL ? raw : new URL(String(raw || "")); }
  catch (_) { throw Object.assign(new Error("invalid_url"), { status: 400 }); }
  if (!["http:", "https:"].includes(url.protocol)) throw Object.assign(new Error("invalid_protocol"), { status: 400 });
  if (url.username || url.password) throw Object.assign(new Error("credentials_not_allowed"), { status: 400 });
  if (isUnsafeHostname(url.hostname)) throw Object.assign(new Error("unsafe_target"), { status: 400 });
  return url;
}

export async function timedFetch(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), METADATA_FETCH_TIMEOUT);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw Object.assign(new Error("timeout"), { status: 504 });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchSafeHtml(rawUrl) {
  let current = validateTarget(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await timedFetch(current.href, {
      method: "GET",
      redirect: "manual",
      headers: {
        "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
        "Accept-Language": "ja,en;q=0.7",
        "User-Agent": "QuickLinksMetadata/1.0 (+https://silovar-uk.github.io/quicklinks/)"
      }
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("Location");
      if (!location || hop === MAX_REDIRECTS) throw Object.assign(new Error("redirect_error"), { status: 502 });
      current = validateTarget(new URL(location, current));
      continue;
    }

    if (!res.ok) throw Object.assign(new Error("upstream_" + res.status), { status: res.status === 404 ? 404 : 502 });

    const contentType = (res.headers.get("Content-Type") || "").toLowerCase();
    if (!/text\/html|application\/xhtml\+xml/.test(contentType)) throw Object.assign(new Error("not_html"), { status: 415 });

    const declared = Number(res.headers.get("Content-Length") || 0);
    if (declared && declared > METADATA_MAX_BYTES) throw Object.assign(new Error("too_large"), { status: 413 });

    const reader = res.body?.getReader();
    if (!reader) return { html: await res.text(), url: current.href };

    const chunks = [];
    let total = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > METADATA_MAX_BYTES) {
        try { await reader.cancel(); } catch (_) {}
        throw Object.assign(new Error("too_large"), { status: 413 });
      }
      chunks.push(part.value);
    }

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { html: new TextDecoder().decode(bytes), url: current.href };
  }
  throw Object.assign(new Error("redirect_error"), { status: 502 });
}
