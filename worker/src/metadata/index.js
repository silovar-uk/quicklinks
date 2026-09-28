import { validateTarget } from "./security.js";
import { extractHtmlMetadata } from "./html.js";
import { resolveYoutubeMetadata } from "./youtube.js";

export async function resolveMetadata(rawUrl, env) {
  const target = validateTarget(rawUrl);
  const youtube = await resolveYoutubeMetadata(target.href, env);
  if (youtube) return youtube;
  return extractHtmlMetadata(target.href);
}
