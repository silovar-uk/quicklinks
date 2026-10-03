import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';

const BASE_URL = process.env.LOCAL_URL || 'http://127.0.0.1:4173/';
const STATE_KEY = 'quick-links-mobile-localstorage-v1';
const META_KEY = 'quick-links-sync-v1';
const ENDPOINT = 'https://quicklinks-sync.test';
const ORIGIN = new URL(BASE_URL).origin;

function stateFixture() {
  const now = new Date().toISOString();
  return {
    activeTab: 'links',
    query: '',
    currentProject: 'ALL',
    currentPromptCategory: 'ALL',
    onlyFavorites: false,
    linkSort: 'recent',
    promptSort: 'popular',
    viewMode: 'rich',
    linkPage: 1,
    promptPage: 1,
    linkPerPage: 'all',
    promptPerPage: '10',
    items: [{
      id: 'sync-link-1',
      title: 'Before sync',
      url: 'https://example.com/before',
      projectName: '未分類',
      description: '',
      descriptionSource: '',
      descriptionUpdatedAt: null,
      note: '',
      addedAt: now,
      updatedAt: now,
      lastClickedAt: null,
      clickCount: 0,
      clickHistory: [],
      archived: false,
      isFavorite: false,
      favoriteType: 'none',
      favoriteExpiry: null,
    }],
    projects: ['未分類'],
    projectColors: {},
    promptMemos: [],
    promptCategories: ['未分類'],
  };
}

function syncMeta(overrides = {}) {
  const secret = Buffer.alloc(32, 7).toString('base64url');
  return {
    enabled: true,
    endpoint: ENDPOINT,
    vaultId: 'qa-vault-1234567890',
    secret,
    deviceId: 'qa-device',
    dirty: true,
    syncing: false,
    lastSyncedAt: '',
    lastError: '',
    etag: '',
    tombstones: { links: {}, prompts: {} },
    base: null,
    observed: null,
    ...overrides,
  };
}

async function openSeeded(page, meta, timeoutMs = 120) {
  await page.addInitScript(({ stateKey, metaKey, state, sync, timeout }) => {
    window.__QUICKLINKS_SYNC_TIMEOUT_MS__ = timeout;
    localStorage.setItem(stateKey, JSON.stringify(state));
    localStorage.setItem(metaKey, JSON.stringify(sync));
  }, { stateKey: STATE_KEY, metaKey: META_KEY, state: stateFixture(), sync: meta, timeout: timeoutMs });
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.locator('#syncButton').waitFor({ state: 'attached' });
}

async function testStaleRecovery(name, browserType) {
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await openSeeded(page, syncMeta({ syncing: true }));
    const result = await page.evaluate(metaKey => {
      const publicMeta = window.QuickLinksSync.getMeta();
      const stored = JSON.parse(localStorage.getItem(metaKey));
      return {
        publicMeta,
        storedHasSyncing: Object.prototype.hasOwnProperty.call(stored, 'syncing'),
        label: document.querySelector('#syncLabel')?.textContent || '',
      };
    }, META_KEY);

    assert.equal(result.publicMeta.syncing, false, name + ' resets stale runtime syncing state');
    assert.match(result.publicMeta.lastError, /途中で止まりました/, name + ' explains automatic recovery');
    assert.equal(result.storedHasSyncing, false, name + ' removes syncing from persistent metadata');
    assert.notEqual(result.label, '同期中…', name + ' does not stay visually stuck');
  } finally {
    await context.close();
    await browser.close();
  }
}

async function testTimeoutRetryAndInFlightEdit(name, browserType) {
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  let mode = 'hang';
  let remoteBody = null;
  let remoteEtag = '"qa-etag-0"';
  let putCount = 0;

  await page.route(ENDPOINT + '/**', async route => {
    const req = route.request();
    const requestMode = mode;
    const headers = {
      'Access-Control-Allow-Origin': ORIGIN,
      'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization,Content-Type,If-Match,If-None-Match',
      'Access-Control-Expose-Headers': 'ETag',
      'Cache-Control': 'no-store',
    };
    if (req.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
      return;
    }
    if (requestMode === 'hang') {
      await new Promise(resolve => setTimeout(resolve, 1300));
      try { await route.fulfill({ status: 504, headers, body: 'late response' }); } catch (_) {}
      return;
    }
    if (req.method() === 'GET') {
      if (!remoteBody) {
        await route.fulfill({ status: 404, headers, body: 'Not found' });
      } else {
        await route.fulfill({
          status: 200,
          headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8', ETag: remoteEtag },
          body: remoteBody,
        });
      }
      return;
    }
    if (req.method() === 'PUT') {
      if (requestMode === 'slow-success') await new Promise(resolve => setTimeout(resolve, 180));
      remoteBody = req.postData() || '';
      putCount += 1;
      remoteEtag = '"qa-etag-' + putCount + '"';
      await route.fulfill({ status: 204, headers: { ...headers, ETag: remoteEtag } });
      return;
    }
    await route.fulfill({ status: 405, headers });
  });

  try {
    await openSeeded(page, syncMeta(), 1000);

    await page.click('#syncButton');
    await page.waitForFunction(() => window.QuickLinksSync.getMeta().lastError.includes('応答がありません'));
    let timedOut = await page.evaluate(() => ({
      syncing: window.QuickLinksSync.getMeta().syncing,
      label: document.querySelector('#syncLabel')?.textContent || '',
    }));
    assert.equal(timedOut.syncing, false, name + ' leaves syncing state after timeout');
    assert.equal(timedOut.label, '再同期', name + ' offers immediate retry after timeout');

    mode = 'slow-success';
    await page.click('#syncButton');
    await page.waitForFunction(() => window.QuickLinksSync.getMeta().syncing === true);

    // Change local state after syncNow() captured its snapshot. The completed request must not
    // overwrite this newer edit; it should become a queued follow-up sync instead.
    await page.evaluate(() => {
      state.items.push({
        id: 'sync-link-during-flight',
        title: 'Saved during sync',
        url: 'https://example.com/during',
        projectName: '未分類',
        description: '',
        descriptionSource: '',
        descriptionUpdatedAt: null,
        note: '',
        addedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastClickedAt: null,
        clickCount: 0,
        clickHistory: [],
        archived: false,
        isFavorite: false,
        favoriteType: 'none',
        favoriteExpiry: null
      });
      save();
    });

    mode = 'fresh';
    await page.waitForFunction(() => {
      const m = window.QuickLinksSync.getMeta();
      return !m.syncing && !m.dirty && !m.lastError;
    }, { timeout: 5000 });

    const success = await page.evaluate(() => ({
      meta: window.QuickLinksSync.getMeta(),
      label: document.querySelector('#syncLabel')?.textContent || '',
      keptDuringFlightEdit: state.items.some(item => item.id === 'sync-link-during-flight'),
    }));
    assert.equal(success.meta.syncing, false, name + ' successful retry finishes cleanly');
    assert.equal(success.meta.lastError, '', name + ' clears the previous timeout error');
    assert.equal(success.label, '同期済み', name + ' reports success after retry');
    assert.equal(success.keptDuringFlightEdit, true, name + ' preserves edits made while a sync is in flight');
    assert.ok(putCount >= 2, name + ' queues a follow-up write for the in-flight edit');
  } finally {
    await context.close();
    await browser.close();
  }
}

for (const [name, browserType] of [['chromium', chromium], ['webkit', webkit]]) {
  await testStaleRecovery(name, browserType);
  await testTimeoutRetryAndInFlightEdit(name, browserType);
}

console.log(JSON.stringify({ syncRecovery: 'PASS', engines: ['chromium', 'webkit'] }, null, 2));
