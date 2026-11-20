import { validateTarget } from "./security.js";
import { extractHtmlMetadata } from "./html.js";
import { resolveYoutubeMetadata } from "./youtube.js";
import { resolveNoteMetadata } from "./note.js";

export async function resolveMetadata(rawUrl, env) {
  const target = validateTarget(rawUrl);
  const youtube = await resolveYoutubeMetadata(target.href, env);
  if (youtube) return youtube;
  // A blocked page fetch should not prevent trying the article metadata source.
  try {
    const note = await resolveNoteMetadata(target.href);
    if (note) return note;
  } catch (_) { /* note API may be blocked too; try ordinary HTML next */ }
  return extractHtmlMetadata(target.href);
}
