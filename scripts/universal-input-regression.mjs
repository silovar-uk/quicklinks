import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE_URL = process.env.LOCAL_URL || 'http://127.0.0.1:4173/';

async function prepare(context) {
  await context.route('https://quicklinks-sync.silovar-uk.workers.dev/v1/metadata?**', route => route.fulfill({
    status: 502,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
    body: JSON.stringify({ status: 'error', error: 'qa_resolver_failure' }),
  }));
  await context.route('https://qa-universal.test/**', async route => {
    await new Promise(resolve => setTimeout(resolve, 900));
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8', 'access-control-allow-origin': '*' },
      body: '<!doctype html><html><head><title>Universal Input QA</title><meta name="description" content="Universal input metadata"></head><body>QA</body></html>',
    });
  });
  await context.route('https://api.microlink.io/**', route => route.fulfill({
    status: 200,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
    body: JSON.stringify({ status: 'success', data: {} }),
  }));
}

async function reset(page) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.removeItem('quick-links-mobile-localstorage-v1');
    localStorage.removeItem('quick-links-mekuru-v1');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  const isMobile = await page.evaluate(() => matchMedia('(max-width: 899px)').matches);
  await page.locator(isMobile ? '#bottomAdd' : '#addButton').waitFor({ state: 'visible' });
}

async function storedLinks(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('quick-links-mobile-localstorage-v1') || '{}').items || []);
}

async function desktop(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await prepare(context);
  const page = await context.newPage();
  try {
    await reset(page);

    const search = page.locator('#searchInput');
    await search.fill('https://qa-universal.test/page');
    await page.locator('[data-url-intent]').waitFor();
    assert.match(await page.locator('[data-url-intent]').innerText(), /このURLを保存/);
    assert.equal(await page.locator('#linkSheet[open]').count(), 0, 'URL intent should not open the save sheet by itself');

    await search.press('Enter');
    await page.waitForFunction(() => {
      const data = JSON.parse(localStorage.getItem('quick-links-mobile-localstorage-v1') || '{}');
      return (data.items || []).some(x => x.url === 'https://qa-universal.test/page');
    }, null, { timeout: 500 });

    const saved = (await storedLinks(page)).filter(x => x.url === 'https://qa-universal.test/page');
    assert.equal(saved.length, 1, 'Enter quick-save creates exactly one link');
    assert.equal(saved[0].projectName, '未分類', 'quick-save intentionally bypasses category choice and lands in 未分類');
    assert.equal(saved[0].note, '', 'quick-save never invents a personal note');
    assert.equal(await search.inputValue(), '', 'universal input clears after quick-save');
    assert.equal(await page.locator('#linkSheet[open]').count(), 0, 'quick-save does not require the detailed save sheet');
    assert.equal(await page.locator('#categoryAssistSheet[open]').count(), 0, 'quick-save is the explicit save-now path and does not interrupt with category assist');

    await search.fill('https://qa-universal.test/page');
    await page.locator('[data-url-intent]').waitFor();
    assert.match(await page.locator('[data-url-intent]').innerText(), /保存済みです/);
    const beforeDuplicate = (await storedLinks(page)).length;
    await search.press('Enter');
    const afterDuplicate = (await storedLinks(page)).length;
    assert.equal(afterDuplicate, beforeDuplicate, 'saving an exact duplicate from the universal input does not add another row');

    await search.fill('qa-universal.test');
    assert.equal(await page.locator('[data-url-intent]').count(), 0, 'domain-like text without URL scheme stays a search');

    await search.fill('https://qa-universal.test/with-context memo');
    assert.equal(await page.locator('[data-url-intent]').count(), 0, 'a sentence containing a URL stays a search');

    await search.fill('https://qa-universal.test/detail');
    await search.press('Shift+Enter');
    assert.equal(await page.locator('#linkSheet[open]').count(), 1, 'Shift+Enter opens the detailed save flow');
    assert.equal(await page.locator('#fUrl').inputValue(), 'https://qa-universal.test/detail');
    assert.equal((await storedLinks(page)).some(x => x.url === 'https://qa-universal.test/detail'), false, 'detail flow does not save until the user confirms');

    return 'PASS';
  } finally {
    await context.close();
  }
}

async function mobile(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await prepare(context);
  const page = await context.newPage();
  try {
    await reset(page);
    await page.locator('#searchOpen').click();
    const input = page.locator('#mSearchInput');
    await input.fill('https://qa-universal.test/mobile');
    await page.locator('#mResults [data-url-intent]').waitFor();
    assert.match(await page.locator('#mResults [data-url-intent]').innerText(), /このURLを保存/);

    await input.press('Enter');
    await page.waitForFunction(() => !document.querySelector('#searchSheet').open);
    await page.waitForFunction(() => {
      const data = JSON.parse(localStorage.getItem('quick-links-mobile-localstorage-v1') || '{}');
      return (data.items || []).some(x => x.url === 'https://qa-universal.test/mobile');
    }, null, { timeout: 500 });

    const saved = (await storedLinks(page)).find(x => x.url === 'https://qa-universal.test/mobile');
    assert.equal(saved.projectName, '未分類');
    assert.equal(await page.locator('#linkSheet[open]').count(), 0, 'mobile Enter also quick-saves without opening the detailed sheet');
    assert.equal(await page.locator('#categoryAssistSheet[open]').count(), 0, 'mobile quick-save also skips category assist');
    return 'PASS';
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch({ headless: true });
try {
  const result = {
    desktop: await desktop(browser),
    mobile: await mobile(browser),
  };
  console.log('universal input regression:', result);
} finally {
  await browser.close();
}
