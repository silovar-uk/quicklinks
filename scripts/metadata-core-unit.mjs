import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const store = new Map();
const now = new Date();
const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
store.set('quick-links-refetch-v1', JSON.stringify({
  day, used: 20, blockedUntil: null, queue: ['persisted-id'], pos: 0, batch: null, failed: {},
}));

let resolverCalls = 0, microlinkCalls = 0;
const fakeFetch = async rawUrl => {
  const url = String(rawUrl);
  if (url.startsWith('https://quicklinks-sync.silovar-uk.workers.dev/v1/metadata?')) {
    resolverCalls += 1;
    const target = new URL(url).searchParams.get('url');
    if (target.includes('/failure')) return new Response('Down', { status: 502 });
    return Response.json({ status: 'success', data: {
      url: target, title: 'Resolved title', description: 'Resolved description', provider: 'web',
    }});
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

api("RF.day = '2000-01-01'; RF.used = 20; RF.blockedUntil = null;");
assert.equal(api('refetchBlocked()'), false);
assert.equal(api('RF.used'), 0, 'budget resets at local midnight without reload');
assert.equal(api('RF.queue.length'), 1, 'queued work survives a day change');
console.log('metadata core unit regression: PASS');
