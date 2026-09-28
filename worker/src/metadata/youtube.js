import { cleanText, timedFetch } from "./security.js";
import { extractHtmlMetadata } from "./html.js";

export function youtubeVideoId(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch (_) { return ""; }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  let id = "";

  if (host === "youtu.be") {
    id = url.pathname.split("/").filter(Boolean)[0] || "";
  } else if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    if (url.pathname === "/watch") {
      id = url.searchParams.get("v") || "";
    } else {
      const m = url.pathname.match(/^\/(?:shorts|live|embed)\/([^/?#]+)/);
      id = m ? m[1] : "";
    }
  }

  return /^[A-Za-z0-9_-]{6,20}$/.test(id) ? id : "";
}

function isGenericYoutubeDescription(text) {
  const value = cleanText(text);
  return !value ||
    /^Enjoy the videos and music you love/i.test(value) ||
    /^作成した動画を友だち、家族、世界中の人たちと共有/.test(value);
}

async function youtubeOembed(rawUrl) {
  try {
    const endpoint = new URL("https://www.youtube.com/oembed");
    endpoint.searchParams.set("url", rawUrl);
    endpoint.searchParams.set("format", "json");
    const res = await timedFetch(endpoint.href, { headers: { "Accept": "application/json" } });
    if (!res.ok) return null;
    return await res.json();
  } catch (_) {
    return null;
  }
}

export async function resolveYoutubeMetadata(rawUrl, env) {
  const id = youtubeVideoId(rawUrl);
  if (!id) return null;

  if (env.YOUTUBE_API_KEY) {
    try {
      const endpoint = new URL("https://www.googleapis.com/youtube/v3/videos");
      endpoint.searchParams.set("part", "snippet");
      endpoint.searchParams.set("id", id);
      endpoint.searchParams.set("key", env.YOUTUBE_API_KEY);

      const res = await timedFetch(endpoint.href, { headers: { "Accept": "application/json" } });
      if (res.ok) {
        const payload = await res.json();
        const snippet = payload?.items?.[0]?.snippet;
        if (snippet) {
          return {
            url: rawUrl,
            title: cleanText(snippet.title, 240),
            description: cleanText(snippet.description, 1000),
            provider: "youtube",
            descriptionSource: "youtube-api",
            confidence: "high",
            author: cleanText(snippet.channelTitle, 240)
          };
        }
      }
    } catch (_) {}
  }

  const pair = await Promise.all([
    youtubeOembed(rawUrl),
    extractHtmlMetadata(rawUrl).catch(() => null)
  ]);
  const oembed = pair[0];
  const html = pair[1];
  const description = html && !isGenericYoutubeDescription(html.description) ? html.description : "";

  return {
    url: html?.url || rawUrl,
    title: cleanText(oembed?.title || html?.title || "", 240),
    description,
    provider: "youtube",
    descriptionSource: description ? (html?.descriptionSource || "html") : "none",
    confidence: description ? "medium" : "low",
    author: cleanText(oembed?.author_name || "", 240)
  };
}
