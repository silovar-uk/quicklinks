import assert from "node:assert/strict";
import { isUnsafeHostname, cleanText } from "../worker/src/metadata/security.js";
import { youtubeVideoId } from "../worker/src/metadata/youtube.js";
import { noteArticleKey, resolveNoteMetadata } from "../worker/src/metadata/note.js";

assert.equal(youtubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
assert.equal(youtubeVideoId("https://youtu.be/dQw4w9WgXcQ?t=12"), "dQw4w9WgXcQ");
assert.equal(youtubeVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
assert.equal(youtubeVideoId("https://www.youtube.com/live/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
assert.equal(youtubeVideoId("https://example.com/watch?v=dQw4w9WgXcQ"), "");

for (const host of ["localhost", "127.0.0.1", "10.0.0.1", "169.254.1.1", "172.16.0.1", "192.168.1.1", "::1", "fd00::1", "fe80::1"]) {
  assert.equal(isUnsafeHostname(host), true, "expected unsafe host: " + host);
}
for (const host of ["studio.persol-group.co.jp", "youtube.com", "8.8.8.8"]) {
  assert.equal(isUnsafeHostname(host), false, "expected public host: " + host);
}

assert.equal(cleanText("  a\n b   c  "), "a b c");

assert.equal(noteArticleKey("https://note.com/norinity1103/n/n6c5e0426eb7b"), "n6c5e0426eb7b");
assert.equal(noteArticleKey("https://example.com/norinity1103/n/n6c5e0426eb7b"), "");
assert.equal(noteArticleKey("https://note.com/api/v3/notes/n6c5e0426eb7b"), "");

const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async (url) => {
    assert.equal(String(url), "https://note.com/api/v3/notes/n6c5e0426eb7b");
    return Response.json({
      data: { key: "n6c5e0426eb7b", status: "published", price: 0,
        name: "A real article title", description: "A published article summary" }
    });
  };
  const note = await resolveNoteMetadata("https://note.com/norinity1103/n/n6c5e0426eb7b");
  assert.equal(note.title, "A real article title");
  assert.equal(note.description, "A published article summary");
  assert.equal(note.descriptionSource, "note-api-description");

  globalThis.fetch = async () => new Response("Request blocked", { status: 403 });
  assert.equal(await resolveNoteMetadata("https://note.com/norinity1103/n/n6c5e0426eb7b"), null,
    "note API blocks should fall through without being misidentified as metadata");
} finally {
  globalThis.fetch = originalFetch;
}

console.log("metadata worker regression: ok");
