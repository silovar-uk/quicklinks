import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE_URL = process.env.LOCAL_URL || 'http://127.0.0.1:4173/';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function loadApp(page) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.locator('#quickUrlInput').waitFor({ state: 'attached' });
}

async function openQuickAdd(page) {
  await page.evaluate(() => openYamlAddModal());
  await page.locator('#quickUrlModal.open').waitFor({ state: 'visible' });
}

async function beginFetch(page, url) {
  await page.locator('#quickUrlInput').fill(url);
  await page.locator('#fetchQuickUrlBtn').click();
  await page.locator('#quickUrlStatus[aria-busy="true"]').waitFor({ state: 'visible' });
}

async function spinnerSnapshot(page) {
  return page.locator('.loading-spinner').evaluate(element => {
    const style = getComputedStyle(element);
    return {
      display: style.display,
      animationName: style.animationName,
      transform: style.transform,
    };
  });
}

async function testDirectSuccess(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'no-preference' });
  const page = await context.newPage();
  let directRequests = 0;

  await page.route('https://qa-success.test/page', async route => {
    directRequests += 1;
    await sleep(550);
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'access-control-allow-origin': '*',
      },
      body: '<!doctype html><html><head><title>QA Success</title><meta name="description" content="Loading regression success"></head><body>QA body</body></html>',
    });
  });

  try {
    await loadApp(page);
    await openQuickAdd(page);
    await beginFetch(page, 'https://qa-success.test/page');

    const spinner = page.locator('.loading-spinner');
    await spinner.waitFor({ state: 'visible' });
    const first = await spinnerSnapshot(page);
    assert.equal(first.animationName, 'quickAddSpin', 'normal motion uses the quick-add spinner animation');

    await page.waitForTimeout(180);
    const second = await spinnerSnapshot(page);
    assert.notEqual(second.transform, first.transform, 'spinner transform changes while loading');
    assert.equal(await page.locator('#fetchQuickUrlBtn').isDisabled(), true, 'fetch button is disabled while loading');
    assert.equal(await page.locator('#quickUrlInput').isDisabled(), true, 'URL input is disabled while loading');

    await page.evaluate(() => document.getElementById('fetchQuickUrlBtn').click());
    assert.equal(directRequests, 1, 'disabled action does not start a duplicate request');

    await page.locator('#linkModal.open').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#linkTitle').inputValue(), 'QA Success', 'direct metadata populates the editor');
    assert.equal(await page.locator('#quickUrlStatus').getAttribute('aria-busy'), 'false', 'busy state clears after success');
    assert.equal(await page.locator('.loading-spinner').count(), 0, 'spinner is removed after success');

    return 'PASS';
  } finally {
    await context.close();
  }
}

async function testReducedMotion(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const page = await context.newPage();

  await page.route('https://qa-reduced.test/page', async route => {
    await sleep(450);
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'access-control-allow-origin': '*',
      },
      body: '<!doctype html><html><head><title>Reduced Motion</title></head><body>QA body</body></html>',
    });
  });

  try {
    await loadApp(page);
    await openQuickAdd(page);
    await beginFetch(page, 'https://qa-reduced.test/page');

    const spinner = page.locator('.loading-spinner');
    assert.equal(await spinner.count(), 1, 'loading state still has a semantic spinner node');
    const style = await spinnerSnapshot(page);
    assert.equal(style.display, 'none', 'reduced motion hides rotating feedback');
    assert.equal(style.animationName, 'none', 'reduced motion disables spinner animation');
    assert.match(await page.locator('#quickUrlStatus').innerText(), /取得/, 'loading text remains visible with reduced motion');

    await page.locator('#linkModal.open').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#quickUrlStatus').getAttribute('aria-busy'), 'false', 'busy state clears with reduced motion');

    return 'PASS';
  } finally {
    await context.close();
  }
}

async function testMicrolinkFallback(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  let directRequests = 0;
  let microlinkRequests = 0;

  // Count only the metadata document request. Asset requests must not be
  // mistaken for duplicate direct metadata fetches.
  await page.route('https://qa-fallback.test/page', route => {
    directRequests += 1;
    return route.abort('failed');
  });
  await page.route('https://api.microlink.io/**', async route => {
    microlinkRequests += 1;
    await sleep(250);
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'access-control-allow-origin': '*',
      },
      body: JSON.stringify({
        status: 'success',
        data: {
          url: 'https://qa-fallback.test/page',
          title: 'Microlink Fallback',
          publisher: 'QA',
          description: 'Fallback metadata',
          function: { isFulfilled: true, value: 'Fallback body' },
        },
      }),
    });
  });

  try {
    await loadApp(page);
    await openQuickAdd(page);
    await beginFetch(page, 'https://qa-fallback.test/page');
    await page.locator('#linkModal.open').waitFor({ state: 'visible' });

    assert.equal(directRequests, 1, 'direct metadata is attempted once');
    assert.equal(microlinkRequests, 1, 'Microlink is used once after direct failure');
    assert.equal(await page.locator('#linkTitle').inputValue(), 'Microlink Fallback', 'fallback metadata populates the editor');
    assert.equal(await page.locator('.loading-spinner').count(), 0, 'spinner clears after fallback success');

    return 'PASS';
  } finally {
    await context.close();
  }
}

async function testCancellation(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  let directRequests = 0;
  let microlinkRequests = 0;

  await page.route('https://qa-cancel.test/page', async route => {
    directRequests += 1;
    await sleep(1200);
    try {
      await route.fulfill({
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'access-control-allow-origin': '*',
        },
        body: '<!doctype html><html><head><title>Should Not Open</title></head><body></body></html>',
      });
    } catch (_) {}
  });
  await page.route('https://api.microlink.io/**', route => {
    microlinkRequests += 1;
    return route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
      body: JSON.stringify({ status: 'success', data: { title: 'Should Not Fallback' } }),
    });
  });

  try {
    await loadApp(page);
    await openQuickAdd(page);
    await beginFetch(page, 'https://qa-cancel.test/page');
    await page.locator('.loading-spinner').waitFor({ state: 'visible' });

    await page.locator('[data-close-modal="quickUrlModal"]').click();
    await page.locator('#quickUrlModal').waitFor({ state: 'hidden' });
    await page.waitForTimeout(1450);

    assert.equal(directRequests, 1, 'cancelled flow starts only one direct request');
    assert.equal(microlinkRequests, 0, 'user cancellation prevents the fallback request');
    assert.equal(await page.locator('#linkModal.open').count(), 0, 'cancelled flow does not reopen the editor');
    assert.equal(await page.locator('#quickUrlStatus').getAttribute('aria-busy'), 'false', 'cancelled flow eventually clears busy state');

    return 'PASS';
  } finally {
    await context.close();
  }
}

async function testTimeout(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  let microlinkRequests = 0;

  await page.route('https://qa-timeout.test/page', route => route.abort('failed'));
  await page.route('https://api.microlink.io/**', async route => {
    microlinkRequests += 1;
    await sleep(10_500);
    try {
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
        body: JSON.stringify({ status: 'success', data: { title: 'Too Late' } }),
      });
    } catch (_) {}
  });

  try {
    await loadApp(page);
    await openQuickAdd(page);
    await beginFetch(page, 'https://qa-timeout.test/page');

    await page.locator('#linkModal.open').waitFor({ state: 'visible', timeout: 12_000 });
    assert.equal(microlinkRequests, 1, 'Microlink timeout path makes one fallback request');
    assert.equal(await page.locator('#linkTitle').inputValue(), 'qa-timeout.test', 'timeout falls back to URL-derived metadata');
    assert.equal(await page.locator('#quickUrlStatus').getAttribute('aria-busy'), 'false', 'timeout clears busy state');
    assert.equal(await page.locator('.loading-spinner').count(), 0, 'timeout clears spinner');

    return 'PASS';
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch({ headless: true });
try {
  const results = {
    directSuccess: await testDirectSuccess(browser),
    reducedMotion: await testReducedMotion(browser),
    microlinkFallback: await testMicrolinkFallback(browser),
    cancellation: await testCancellation(browser),
    timeout: await testTimeout(browser),
  };
  console.log(JSON.stringify({ loadingRegression: 'PASS', results }, null, 2));
} finally {
  await browser.close();
}
