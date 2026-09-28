import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE_URL = process.env.LOCAL_URL || 'http://127.0.0.1:4173/';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const RESOLVER_PATTERN = 'https://quicklinks-sync.silovar-uk.workers.dev/v1/metadata?**';

async function routeResolverFailure(page) {
  await page.route(RESOLVER_PATTERN, route => route.fulfill({
    status: 502,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
    body: JSON.stringify({ status: 'error', error: 'qa_resolver_failure' }),
  }));
}


async function loadApp(page) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.locator('#deckTrack .card, .card-end').first().waitFor({ state: 'attached' });
}

async function openLinkSheet(page) {
  await page.locator('#bottomAdd').click();
  await page.locator('#linkSheet[open]').waitFor({ state: 'visible' });
}

async function beginFetch(page, url) {
  await page.locator('#fUrl').fill(url);
  await page.locator('#fUrl').dispatchEvent('change');
  await page.locator('#fStatus[aria-busy="true"]').waitFor({ state: 'visible' });
}

async function spinnerSnapshot(page) {
  return page.locator('.spin').evaluate(element => {
    const style = getComputedStyle(element);
    return { display: style.display, animationName: style.animationName, transform: style.transform };
  });
}

async function testDirectSuccess(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'no-preference' });
  const page = await context.newPage();
  let directRequests = 0;

  await routeResolverFailure(page);

  await page.route('https://qa-success.test/page', async route => {
    directRequests += 1;
    await sleep(550);
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8', 'access-control-allow-origin': '*' },
      body: '<!doctype html><html><head><title>QA Success</title><meta name="description" content="Loading regression success"></head><body>QA body</body></html>',
    });
  });

  try {
    await loadApp(page);
    await openLinkSheet(page);
    await beginFetch(page, 'https://qa-success.test/page');

    const spinner = page.locator('.spin');
    await spinner.waitFor({ state: 'visible' });
    const first = await spinnerSnapshot(page);
    assert.equal(first.animationName, 'spin', 'normal motion uses the spin animation');

    await page.waitForTimeout(180);
    const second = await spinnerSnapshot(page);
    assert.notEqual(second.transform, first.transform, 'spinner transform changes while loading');

    await page.waitForFunction(() => document.getElementById('fTitle').value.trim().length > 0, null, { timeout: 8000 });
    assert.equal(directRequests, 1, 'direct metadata is fetched once');
    assert.equal(await page.locator('#fTitle').inputValue(), 'QA Success', 'direct metadata populates the form');
    assert.equal(await page.locator('#fNote').inputValue(), 'Loading regression success', 'direct metadata populates the note');
    assert.equal(await page.locator('#fStatus').getAttribute('aria-busy'), 'false', 'busy state clears after success');
    assert.equal(await page.locator('.spin').count(), 0, 'spinner is removed after success');

    return 'PASS';
  } finally {
    await context.close();
  }
}

async function testReducedMotion(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const page = await context.newPage();

  await routeResolverFailure(page);

  await page.route('https://qa-reduced.test/page', async route => {
    await sleep(450);
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8', 'access-control-allow-origin': '*' },
      body: '<!doctype html><html><head><title>Reduced Motion</title></head><body>QA body</body></html>',
    });
  });

  try {
    await loadApp(page);
    await openLinkSheet(page);
    await beginFetch(page, 'https://qa-reduced.test/page');

    const spinner = page.locator('.spin');
    assert.equal(await spinner.count(), 1, 'loading state still has a spinner node');
    const style = await spinnerSnapshot(page);
    assert.equal(style.display, 'none', 'reduced motion hides rotating feedback');
    assert.match(await page.locator('#fStatus').innerText(), /取得/, 'loading text remains visible with reduced motion');

    await page.waitForFunction(() => document.getElementById('fStatus').getAttribute('aria-busy') === 'false', null, { timeout: 8000 });

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

  await routeResolverFailure(page);

  await page.route('https://qa-fallback.test/page', route => {
    directRequests += 1;
    return route.abort('failed');
  });
  await page.route('https://api.microlink.io/**', async route => {
    microlinkRequests += 1;
    await sleep(250);
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        status: 'success',
        data: { url: 'https://qa-fallback.test/page', title: 'Microlink Fallback', description: 'Fallback metadata' },
      }),
    });
  });

  try {
    await loadApp(page);
    await openLinkSheet(page);
    await beginFetch(page, 'https://qa-fallback.test/page');
    await page.waitForFunction(() => document.getElementById('fTitle').value.trim().length > 0, null, { timeout: 8000 });

    assert.equal(directRequests, 1, 'direct metadata is attempted once');
    assert.equal(microlinkRequests, 1, 'Microlink is used once after direct failure');
    assert.equal(await page.locator('#fTitle').inputValue(), 'Microlink Fallback', 'fallback metadata populates the form');
    assert.equal(await page.locator('.spin').count(), 0, 'spinner clears after fallback success');

    return 'PASS';
  } finally {
    await context.close();
  }
}

async function testMicrolinkExtractedDescription(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  let directRequests = 0;
  let microlinkRequests = 0;

  await routeResolverFailure(page);
  await page.route('https://www.youtube.com/watch?v=qaVideo123', route => {
    directRequests += 1;
    return route.abort('failed');
  });
  await page.route('https://api.microlink.io/**', route => {
    microlinkRequests += 1;
    const requestUrl = new URL(route.request().url());
    assert.equal(
      requestUrl.searchParams.get('data.quickDescription.0.selector'),
      'meta[itemprop="description"]',
      'Microlink fallback asks for YouTube microdata description'
    );
    return route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        status: 'success',
        data: {
          url: 'https://www.youtube.com/watch?v=qaVideo123',
          title: 'QA Video - YouTube',
          description: 'Enjoy the videos and music you love, upload original content, and share it all with friends, family, and the world on YouTube.',
          quickDescription: 'This is the actual video description from microdata.',
        },
      }),
    });
  });

  try {
    await loadApp(page);
    await openLinkSheet(page);
    await beginFetch(page, 'https://www.youtube.com/watch?v=qaVideo123');
    await page.waitForFunction(() => document.getElementById('fNote').value.trim().length > 0, null, { timeout: 8000 });

    assert.equal(directRequests, 1, 'direct YouTube fetch is attempted after resolver failure');
    assert.equal(microlinkRequests, 1, 'Microlink fallback is used once');
    assert.equal(
      await page.locator('#fNote').inputValue(),
      'This is the actual video description from microdata.',
      'generic YouTube description is replaced by extracted video description'
    );
    return 'PASS';
  } finally {
    await context.close();
  }
}

async function testResolverSuccess(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  let resolverRequests = 0;
  let directRequests = 0;
  let microlinkRequests = 0;

  await page.route(RESOLVER_PATTERN, route => {
    resolverRequests += 1;
    return route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        status: 'success',
        data: {
          url: 'https://qa-resolver.test/page',
          title: 'Resolver Success',
          description: 'Resolver metadata',
          provider: 'web',
          descriptionSource: 'meta',
          confidence: 'high',
        },
      }),
    });
  });
  await page.route('https://qa-resolver.test/page', route => {
    directRequests += 1;
    return route.abort('failed');
  });
  await page.route('https://api.microlink.io/**', route => {
    microlinkRequests += 1;
    return route.abort('failed');
  });

  try {
    await loadApp(page);
    await openLinkSheet(page);
    await beginFetch(page, 'https://qa-resolver.test/page');
    await page.waitForFunction(() => document.getElementById('fTitle').value.trim().length > 0, null, { timeout: 8000 });

    assert.equal(resolverRequests, 1, 'resolver metadata is fetched once');
    assert.equal(directRequests, 0, 'complete resolver metadata skips direct fetch');
    assert.equal(microlinkRequests, 0, 'complete resolver metadata skips Microlink');
    assert.equal(await page.locator('#fTitle').inputValue(), 'Resolver Success');
    assert.equal(await page.locator('#fNote').inputValue(), 'Resolver metadata');

    return 'PASS';
  } finally {
    await context.close();
  }
}

async function testCancellation(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  let resolverRequests = 0;
  let directRequests = 0;
  let microlinkRequests = 0;

  await page.route(RESOLVER_PATTERN, async route => {
    resolverRequests += 1;
    await sleep(1200);
    try {
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
        body: JSON.stringify({ status: 'success', data: { title: 'Should Not Apply', description: 'Should Not Apply' } }),
      });
    } catch { /* シートを閉じた後に届いても無視する */ }
  });

  await page.route('https://qa-cancel.test/page', async route => {
    directRequests += 1;
    await sleep(1200);
    try {
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8', 'access-control-allow-origin': '*' },
        body: '<!doctype html><html><head><title>Should Not Apply</title></head><body></body></html>',
      });
    } catch { /* シートを閉じた後に届いても無視する */ }
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
    await openLinkSheet(page);
    await beginFetch(page, 'https://qa-cancel.test/page');
    await page.locator('.spin').waitFor({ state: 'visible' });

    await page.locator('#linkSheet [data-close]').first().click();
    await page.locator('#linkSheet[open]').waitFor({ state: 'detached' }).catch(() => {});
    await page.waitForTimeout(1450);

    assert.equal(resolverRequests, 1, 'cancelled flow starts one resolver request');
    assert.equal(directRequests, 0, 'closing the sheet prevents downstream direct fetch');
    assert.equal(microlinkRequests, 0, 'closing the sheet prevents the fallback request');
    assert.equal(await page.locator('#fTitle').inputValue(), '', 'cancelled flow does not fill the closed form');

    // 開き直した後の取得は、前の回の結果に邪魔されない
    await openLinkSheet(page);
    assert.equal(await page.locator('#fTitle').inputValue(), '', 'reopening starts from a clean form');

    assert.deepEqual(pageErrors, [], 'no page errors after cancellation');
    return 'PASS';
  } finally {
    await context.close();
  }
}

async function testTimeout(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  let microlinkRequests = 0;

  await routeResolverFailure(page);

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
    } catch { /* すでに時間切れの表示へ進んでいる */ }
  });

  try {
    await loadApp(page);
    await openLinkSheet(page);
    await beginFetch(page, 'https://qa-timeout.test/page');

    await page.locator('#fRetry').waitFor({ state: 'visible', timeout: 12_000 });
    assert.equal(microlinkRequests, 1, 'Microlink timeout path makes one fallback request');
    assert.match(await page.locator('#fStatus').innerText(), /時間切れ/, 'timeout message shown');
    assert.equal(await page.locator('#fStatus').getAttribute('aria-busy'), 'false', 'timeout clears busy state');
    assert.equal(await page.locator('.spin').count(), 0, 'timeout clears spinner');

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
    microlinkExtractedDescription: await testMicrolinkExtractedDescription(browser),
    resolverSuccess: await testResolverSuccess(browser),
    cancellation: await testCancellation(browser),
    timeout: await testTimeout(browser),
  };
  console.log(JSON.stringify({ loadingRegression: 'PASS', results }, null, 2));
} finally {
  await browser.close();
}
