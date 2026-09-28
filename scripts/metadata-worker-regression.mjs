import assert from "node:assert/strict";
import { isUnsafeHostname, cleanText } from "../worker/src/metadata/security.js";
import { youtubeVideoId } from "../worker/src/metadata/youtube.js";

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

console.log("metadata worker regression: ok");
