import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const store = new Map();
const now = new Date();
const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
store.set('quick-links-refetch-v1', JSON.stringify({
  day, used: 20, blockedUntil: null, queue: ['persisted-id'], pos: 0, batch: null, failed: {},
}));

let resolverCalls = 0, microlinkCalls = 0, readerCalls = 0;
const fakeFetch = async rawUrl => {
  const url = String(rawUrl);
  if (url.startsWith('https://quicklinks-sync.silovar-uk.workers.dev/v1/metadata?')) {
    resolverCalls += 1;
    const target = new URL(url).searchParams.get('url');
    if (target.includes('/failure')) return new Response('Down', { status: 502 });
    if (target.includes('/reader-success')) return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
    return Response.json({ status: 'success', data: {
      url: target, title: 'Resolved title', description: 'Resolved description', provider: 'web',
    }});
  }
  if (url.startsWith('https://r.jina.ai/')) {
    readerCalls += 1;
    if (url.includes('/cloudfront-block')) {
      return new Response('Title: Request blocked.\n\nMarkdown Content:\nRequest blocked. We can\'t connect to the server for this app or website at this time. There might be too much traffic or a configuration error. You can find steps to troubleshoot and help prevent this error by reviewing the CloudFront documentation.', { status: 200 });
    }
    if (url.includes('/reader-success')) {
      return new Response('Title: Actual Reader Title\n\nURL Source: https://qa-worker.test/reader-success\n\nMarkdown Content:\nThis is an actual article paragraph containing a useful description for the saved link, not just a placeholder.', { status: 200 });
    }
    throw new Error('Reader upstream blocked');
  }
  if (url.startsWith('https://api.microlink.io/')) {
    microlinkCalls += 1;
    return Response.json({ status: 'error' }, { status: 429 });
  }
  throw new Error('Direct fetch not available');
};

const sandbox = {
  console, URL, URLSearchParams, Response, AbortController, setTimeout, clearTimeout,
  fetch: fakeFetch, Date,
  document: { getElementById: () => null, querySelectorAll: () => [] },
  window: {},
  localStorage: {
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: key => store.delete(key),
  },
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(new URL('../core.js', import.meta.url), 'utf8'), sandbox);

const api = expression => vm.runInContext(expression, sandbox);

const first = await api("fetchPageMetadata('https://qa-worker.test/first', { bulk: true })");
assert.equal(first.status, 'complete');
assert.equal(first.data.description, 'Resolved description');
assert.equal(resolverCalls, 1);
assert.equal(microlinkCalls, 0, 'quota exhaustion must not prevent Worker requests');

const second = await api("fetchPageMetadata('https://qa-worker.test/first', { bulk: true })");
assert.equal(second.cacheHit, true);
assert.equal(resolverCalls, 1, 'complete metadata must be cached');

const fresh = await api("fetchPageMetadata('https://qa-worker.test/first', { force: true })");
assert.equal(fresh.status, 'complete');
assert.equal(resolverCalls, 2, 'manual refresh must bypass the cache');

const blocked = await api("fetchPageMetadata('https://qa-worker.test/failure', { bulk: true })");
assert.equal(blocked.status, 'unavailable');
assert.equal(blocked.reason, 'rate');
assert.equal(microlinkCalls, 0, 'bulk quota is limited to Microlink only');
assert.equal(api('RF.used'), 20, 'quota-free paths must not consume the Microlink budget');

const readerResult = await api("fetchPageMetadata('https://qa-worker.test/reader-success', { bulk: true })");
assert.equal(readerResult.ok, true, 'Reader succeeds when deployed Worker has no metadata route');
assert.equal(readerResult.status, 'complete');
assert.equal(readerResult.data.title, 'Actual Reader Title');
assert.match(readerResult.data.description, /actual article paragraph/);
assert.equal(readerCalls, 2, 'Reader fallback is attempted after normal site fetch fails');
assert.equal(microlinkCalls, 0, 'Reader success prevents consuming the Microlink quota');
assert(api('resolverUnavailableUntil > Date.now()'), '404 Worker endpoint disables repeated Worker attempts for 15 minutes');
assert.equal(api("isSafePublicReaderUrl('https://example.com/private?access_token=abc')"), false, 'sensitive query parameters are never sent to Reader');
const readerParse = api('parseReaderMetadata');
const tweet = readerParse(
  'Title: YouTube (@YouTube) on X\n\nMarkdown Content:\n## Post\n\n[Log in](https://x.com/i/signup)[Sign up](https://x.com/i/signup)\n\n# YouTube on X: "\"go touch grass\" ok but have you ever touched a crunchy fall leaf"\n\n## Conversation',
  'https://x.com/YouTube/status/2102412606308757511'
);
assert.equal(tweet.description, '"go touch grass" ok but have you ever touched a crunchy fall leaf');
assert.equal(tweet.descriptionSource, 'reader-post', 'X login prompts are not used as the description');
const blockedPage = 'Title: Request blocked.\n\nMarkdown Content:\nRequest blocked. We cannot connect to the server for this app or website at this time. There might be too much traffic or a configuration error. CloudFront documentation.';
assert.equal(readerParse(blockedPage, 'https://note.com/abc/n/n6c5e0426eb7b'), null, 'CloudFront errors must not turn into article metadata');
assert.equal(api("looksSuspicious({title: 'ERROR: The request could not be satisfied', description: ''})"), true, 'CDN error titles are rejected');
assert.equal(api("looksPlaceholder('Request blocked.', 'https://note.com/a/n/n6c5e0426eb7b')"), true, 'corrupt saved titles are repairable');
const blockedReader = await api("fetchPageMetadata('https://qa-worker.test/cloudfront-block', { bulk: true })");
assert.equal(blockedReader.status, 'unavailable', 'blocked Reader text must not count as fetched metadata');


api("RF.day = '2000-01-01'; RF.used = 20; RF.blockedUntil = null;");
assert.equal(api('refetchBlocked()'), false);
assert.equal(api('RF.used'), 0, 'budget resets at local midnight without reload');
assert.equal(api('RF.queue.length'), 1, 'queued work survives a day change');
console.log('metadata core unit regression: PASS');
