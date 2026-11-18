import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE_URL = process.env.LOCAL_URL || 'http://127.0.0.1:4173/';
const RESOLVER = 'https://quicklinks-sync.silovar-uk.workers.dev/v1/metadata?**';
const MICROLINK = 'https://api.microlink.io/**';

function dayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function seedLinks(page, count, host = 'qa-quota.test') {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ count, host, day }) => {
    const now = new Date().toISOString();
    const items = Array.from({ length: count }, (_, i) => ({
      id: 'quota-' + i,
      url: `https://${host}/page-${i}`,
      title: host,
      description: '',
      note: 'Keep personal note ' + i,
      projectName: '未分類',
      addedAt: now,
      updatedAt: now,
      clickCount: 0,
      clickHistory: [],
      favoriteType: 'none',
    }));
    localStorage.setItem('quick-links-mobile-localstorage-v1', JSON.stringify({
      items, projects: ['未分類'], projectColors: {}, promptMemos: [], promptCategories: ['未分類'],
    }));
    localStorage.setItem('quick-links-refetch-v1', JSON.stringify({
      day, used: 20, blockedUntil: null, queue: [], pos: 0, batch: null, failed: {},
    }));
    localStorage.removeItem('quick-links-metadata-cache-v1');
  }, { count, host, day: dayKey() });
}

async function openCare(page) {
  await page.locator('#manageButton').click();
  await page.locator('#careRun').waitFor({ state: 'visible' });
}

async function readLinks(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('quick-links-mobile-localstorage-v1') || '{}').items || []);
}

async function testQuotaFreeBulk(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  let workerCalls = 0, microlinkCalls = 0;
  try {
    await seedLinks(page, 26);
    await page.route(RESOLVER, route => {
      workerCalls += 1;
      const target = new URL(route.request().url()).searchParams.get('url');
      return route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
        body: JSON.stringify({ status: 'success', data: {
          url: target, title: 'Fetched page ' + workerCalls,
          description: 'Useful information ' + workerCalls,
          provider: 'web', descriptionSource: 'meta',
        }}),
      });
    });
    await page.route(MICROLINK, route => { microlinkCalls++; return route.abort(); });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openCare(page);
    await page.locator('#careRun').click();
    await page.waitForFunction(() => {
      const saved = JSON.parse(localStorage.getItem('quick-links-mobile-localstorage-v1') || '{}').items || [];
      const state = JSON.parse(localStorage.getItem('quick-links-refetch-v1') || '{}');
      return saved.length === 26 && saved.every(x => x.description.startsWith('Useful information')) && state.queue?.length === 0;
    }, null, { timeout: 20000 });
    const saved = await readLinks(page);
    assert.equal(saved.length, 26);
    assert.equal(workerCalls, 26, 'all items use quota-free Worker');
    assert.equal(microlinkCalls, 0, 'Microlink is skipped after bulk limit');
    assert(saved.every((x, i) => x.note === 'Keep personal note ' + i), 'user notes remain untouched');
    assert.match(await page.locator('#care').innerText(), /確認完了/);
    return 'PASS';
  } finally { await context.close(); }
}

async function testQuotaBlockedDoesNotSkip(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  let microlinkCalls = 0, workerCalls = 0;
  try {
    await seedLinks(page, 7, 'qa-denied.test');
    await page.route(RESOLVER, route => {
      workerCalls++;
      return route.fulfill({ status: 502, body: '{"status":"error"}',
        headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } });
    });
    await page.route('https://qa-denied.test/**', route => route.abort('failed'));
    await page.route(MICROLINK, route => { microlinkCalls++; return route.abort(); });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openCare(page);
    await page.locator('#careRun').click();
    await page.waitForFunction(() => {
      const rf = JSON.parse(localStorage.getItem('quick-links-refetch-v1') || '{}');
      return rf.queue?.length === 0;
    }, null, { timeout: 20000 });
    const rf = await page.evaluate(() => JSON.parse(localStorage.getItem('quick-links-refetch-v1') || '{}'));
    assert.equal(workerCalls, 7, 'every item attempts its quota-free route');
    assert.equal(microlinkCalls, 0, 'quota-limited API is not called');
    assert.deepEqual(rf.failed, {}, 'quota exhaustion must not penalize each item for six hours');
    assert((await readLinks(page)).every(x => x.description === ''), 'unavailable information stays empty');
    return 'PASS';
  } finally { await context.close(); }
}

async function testPauseResume(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await seedLinks(page, 12, 'qa-pause.test');
    await page.route(RESOLVER, async route => {
      await new Promise(resolve => setTimeout(resolve, 120));
      const target = new URL(route.request().url()).searchParams.get('url');
      return route.fulfill({ status: 200,
        headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
        body: JSON.stringify({ status: 'success', data: {
          url: target, title: 'Pause QA', description: 'Resume QA complete',
          descriptionSource: 'meta',
        }}),
      });
    });
    await page.route(MICROLINK, route => route.abort());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openCare(page);
    await page.locator('#careRun').click();
    await page.locator('#carePause').click();
    await page.waitForFunction(() => {
      const rf = JSON.parse(localStorage.getItem('quick-links-refetch-v1') || '{}');
      return rf.queue?.length === 12 && document.querySelector('#careRun')?.disabled === false;
    }, null, { timeout: 15000 });
    await page.locator('#careRun').click();
    await page.waitForFunction(() => {
      const rf = JSON.parse(localStorage.getItem('quick-links-refetch-v1') || '{}');
      const data = JSON.parse(localStorage.getItem('quick-links-mobile-localstorage-v1') || '{}');
      return rf.queue?.length === 0 && data.items?.length === 12 && data.items.every(x => x.description === 'Resume QA complete');
    }, null, { timeout: 20000 });
    return 'PASS';
  } finally { await context.close(); }
}

async function testCompleteMetadataCache(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  let workerCalls = 0, microlinkCalls = 0;
  const url = 'https://qa-metadata-cache.test/abc';
  try {
    await page.route(RESOLVER, route => {
      workerCalls++;
      return route.fulfill({ status: 200,
        headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
        body: JSON.stringify({ status: 'success', data: {
          url, title: 'Cached Title', description: 'Cached Description', descriptionSource: 'meta',
        }}),
      });
    });
    await page.route(MICROLINK, route => { microlinkCalls++; return route.abort(); });
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    const first = await page.evaluate(url => fetchPageMetadata(url), url);
    const second = await page.evaluate(url => fetchPageMetadata(url), url);
    assert.equal(first.status, 'complete');
    assert.equal(second.cacheHit, true, 'repeated metadata loads from the cache');
    await page.reload({ waitUntil: 'domcontentloaded' });
    const third = await page.evaluate(url => fetchPageMetadata(url), url);
    assert.equal(third.cacheHit, true, 'cache survives a reload');
    assert.equal(workerCalls, 1, 'complete metadata makes one Worker call');
    assert.equal(microlinkCalls, 0);
    return 'PASS';
  } finally { await context.close(); }
}

const browser = await chromium.launch({ headless: true });
try {
  const results = {
    bulkWithQuotaExhausted: await testQuotaFreeBulk(browser),
    blockedPagesStillChecked: await testQuotaBlockedDoesNotSkip(browser),
    pauseResume: await testPauseResume(browser),
    sevenDayCompleteCache: await testCompleteMetadataCache(browser),
  };
  console.log(JSON.stringify({ metadataFallbackRegression: 'PASS', results }, null, 2));
} finally { await browser.close(); }
