const MAX_BYTES = 5 * 1024 * 1024;
const PROD_ORIGIN = "https://silovar-uk.github.io";

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (origin === PROD_ORIGIN) return true;
  try {
    const u = new URL(origin);
    return (u.hostname === "localhost" || u.hostname === "127.0.0.1") && (u.protocol === "http:" || u.protocol === "https:");
  } catch (_) {
    return false;
  }
}

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,Content-Type,If-Match,If-None-Match",
    "Access-Control-Expose-Headers": "ETag",
    "Access-Control-Max-Age": "86400"
  };
}

function response(body, status, origin, extra = {}) {
  return new Response(body, {
    status,
    headers: {
      ...cors(origin),
      "Cache-Control": "no-store",
      ...extra
    }
  });
}

function bearer(request) {
  const value = request.headers.get("Authorization") || "";
  const m = value.match(/^Bearer\s+([A-Za-z0-9_-]{20,200})$/);
  return m ? m[1] : "";
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let out = "";
  for (const b of digest) out += b.toString(16).padStart(2, "0");
  return out;
}

function safeEqual(a, b) {
  a = String(a || "");
  b = String(b || "");
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

function vaultPath(url) {
  const m = url.pathname.match(/^\/v1\/vault\/([A-Za-z0-9_-]{16,80})$/);
  return m ? m[1] : "";
}

async function readJsonBytes(request) {
  const len = Number(request.headers.get("Content-Length") || 0);
  if (len && len > MAX_BYTES) throw Object.assign(new Error("too_large"), { status: 413 });
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) throw Object.assign(new Error("too_large"), { status: 413 });
  let value;
  try { value = JSON.parse(new TextDecoder().decode(bytes)); }
  catch (_) { throw Object.assign(new Error("invalid_json"), { status: 400 }); }
  if (
    value?.schemaVersion !== "quick-links-cipher-v1" ||
    typeof value?.iv !== "string" ||
    typeof value?.ciphertext !== "string"
  ) throw Object.assign(new Error("invalid_envelope"), { status: 400 });
  return bytes;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (!isAllowedOrigin(origin)) return new Response("Forbidden origin", { status: 403 });
    if (request.method === "OPTIONS") return response(null, 204, origin);

    const url = new URL(request.url);
    const vaultId = vaultPath(url);
    if (!vaultId) return response("Not found", 404, origin);

    const token = bearer(request);
    if (!token) return response("Unauthorized", 401, origin);

    const authHash = await sha256(token);
    const key = "vaults/" + vaultId;

    try {
      if (request.method === "GET") {
        const head = await env.SYNC_BUCKET.head(key);
        if (!head) return response("Not found", 404, origin);
        if (!safeEqual(head.customMetadata?.authHash, authHash)) return response("Unauthorized", 401, origin);

        const object = await env.SYNC_BUCKET.get(key);
        if (!object) return response("Not found", 404, origin);
        return response(object.body, 200, origin, {
          "Content-Type": "application/json; charset=utf-8",
          "ETag": object.httpEtag
        });
      }

      if (request.method === "PUT") {
        const contentType = (request.headers.get("Content-Type") || "").toLowerCase();
        if (!contentType.startsWith("application/json")) return response("Unsupported media type", 415, origin);

        const existing = await env.SYNC_BUCKET.head(key);
        if (existing && !safeEqual(existing.customMetadata?.authHash, authHash)) return response("Unauthorized", 401, origin);

        const ifMatch = request.headers.get("If-Match");
        const ifNoneMatch = request.headers.get("If-None-Match");

        if (existing && !ifMatch) return response("Precondition required", 428, origin);
        if (!existing && ifNoneMatch !== "*") return response("Precondition required", 428, origin);

        const bytes = await readJsonBytes(request);
        const stamp = new Date().toISOString();

        const conditions = new Headers();
        if (existing) conditions.set("If-Match", ifMatch);
        else conditions.set("If-None-Match", "*");

        const put = await env.SYNC_BUCKET.put(key, bytes, {
          onlyIf: conditions,
          httpMetadata: {
            contentType: "application/json; charset=utf-8",
            cacheControl: "no-store"
          },
          customMetadata: {
            authHash,
            createdAt: existing?.customMetadata?.createdAt || stamp,
            updatedAt: stamp
          }
        });

        if (!put) return response("Precondition failed", 412, origin);
        return response(null, 204, origin, { "ETag": put.httpEtag });
      }

      return response("Method not allowed", 405, origin, { "Allow": "GET,PUT,OPTIONS" });
    } catch (error) {
      const status = Number(error?.status || 500);
      if (status >= 500) console.error("sync worker error", error);
      return response(
        status === 413 ? "Payload too large" :
        status === 400 ? "Invalid payload" :
        "Internal server error",
        status,
        origin
      );
    }
  }
};