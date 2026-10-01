import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';

const BASE_URL = process.env.LOCAL_URL || 'http://127.0.0.1:4173/';
const STORAGE_KEY = 'quick-links-mobile-localstorage-v1';

function fixture() {
  const now = new Date().toISOString();
  const items = Array.from({ length: 90 }, (_, index) => ({
    id: 'link-' + index,
    title: 'Scrollable Link ' + index,
    url: 'https://example.com/' + index,
    projectName: index % 2 ? 'Alpha' : 'Beta',
    note: 'Long enough note ' + index,
    addedAt: now,
    updatedAt: now,
    lastClickedAt: null,
    clickCount: index % 7,
    clickHistory: [],
    archived: false,
    isFavorite: false,
    favoriteType: 'none',
    favoriteExpiry: null,
  }));
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
    items,
    projects: ['Alpha', 'Beta'],
    projectColors: {},
    promptMemos: [],
    promptCategories: ['未分類'],
  };
}

async function seed(page) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value));
  }, { key: STORAGE_KEY, value: fixture() });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#deckTrack .card, .card-end').first().waitFor({ state: 'attached' });
}

async function snapshotMobile(page) {
  return page.evaluate(() => {
    const center = document.querySelector('#center');
    const bar = document.querySelector('#bottomBar').getBoundingClientRect();
    const app = document.querySelector('#app');
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      shellHeight: app.getBoundingClientRect().height,
      bodyScroll: document.body.scrollTop,
      docScroll: document.documentElement.scrollTop,
      centerScroll: center.scrollTop,
      centerScrollHeight: center.scrollHeight,
      centerClientHeight: center.clientHeight,
      docWidth: document.documentElement.scrollWidth,
      bodyOverflow: getComputedStyle(document.body).overflow,
      appDisplay: getComputedStyle(app).display,
      centerOverflowY: getComputedStyle(center).overflowY,
      barPosition: getComputedStyle(document.querySelector('#bottomBar')).position,
      barTop: bar.top,
      barBottom: bar.bottom,
      shellClass: document.documentElement.classList.contains('keyboard-open'),
    };
  });
}

async function testMobile(engineName, browserType, width) {
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width, height: 844 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));

  try {
    await seed(page);
    let before = await snapshotMobile(page);

    assert.equal(before.bodyOverflow, 'hidden', engineName + ' body does not scroll');
    assert.equal(before.appDisplay, 'grid', engineName + ' app uses grid shell');
    assert.equal(before.centerOverflowY, 'auto', engineName + ' #center owns vertical scrolling');
    assert.notEqual(before.barPosition, 'fixed', engineName + ' bottom bar is not fixed');
    assert.ok(before.centerScrollHeight > before.centerClientHeight, engineName + ' fixture is scrollable');
    assert.ok(Math.abs(before.barBottom - before.innerHeight) <= 2, engineName + ' bar sits at visible bottom');
    assert.ok(before.docWidth <= before.innerWidth, engineName + ' has no horizontal page overflow');

    // Safari can retain the keyboard-sized visualViewport measurement after dismissal.
    // The resting shell must fill the viewport even when that dialog measurement is stale.
    await page.evaluate(() => document.documentElement.style.setProperty('--shell-h', '420px'));
    const staleKeyboard = await snapshotMobile(page);
    assert.ok(Math.abs(staleKeyboard.barBottom - staleKeyboard.innerHeight) <= 2,
      engineName + ' stale keyboard height does not leave a blank area below the bar');
    assert.ok(Math.abs(staleKeyboard.shellHeight - staleKeyboard.innerHeight) <= 2,
      engineName + ' resting shell follows the CSS viewport, not dialog measurements');

    await page.locator('#center').evaluate(node => { node.scrollTop = 1200; });
    await page.waitForTimeout(80);
    let afterScroll = await snapshotMobile(page);

    assert.ok(afterScroll.centerScroll > 500, engineName + ' #center scrolls deeply');
    assert.equal(afterScroll.bodyScroll, 0, engineName + ' body scroll remains zero');
    assert.equal(afterScroll.docScroll, 0, engineName + ' document scroll remains zero');
    assert.ok(Math.abs(afterScroll.barTop - before.barTop) <= 1, engineName + ' bar top is stable while #center scrolls');

    await page.setViewportSize({ width, height: 760 });
    await page.waitForTimeout(150);
    const shrunk = await snapshotMobile(page);
    assert.ok(Math.abs(shrunk.barBottom - shrunk.innerHeight) <= 2, engineName + ' bar follows smaller viewport');
    assert.equal(shrunk.bodyScroll, 0, engineName + ' body remains fixed after viewport shrink');

    await page.setViewportSize({ width, height: 844 });
    await page.waitForTimeout(150);
    const restored = await snapshotMobile(page);
    assert.ok(Math.abs(restored.barBottom - restored.innerHeight) <= 2, engineName + ' bar follows restored viewport');
    assert.equal(restored.bodyScroll, 0, engineName + ' body remains fixed after restore');
    assert.ok(restored.docWidth <= restored.innerWidth, engineName + ' restored viewport has no horizontal overflow');

    assert.deepEqual(pageErrors, [], engineName + ' has no page errors');
    return { engine: engineName, width, status: 'PASS', shellHeight: restored.shellHeight };
  } finally {
    await context.close();
    await browser.close();
  }
}

async function testDesktop() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();

  try {
    await seed(page);
    const data = await page.evaluate(() => ({
      bodyOverflow: getComputedStyle(document.body).overflow,
      appDisplay: getComputedStyle(document.querySelector('#app')).display,
      railOverflowY: getComputedStyle(document.querySelector('#rail')).overflowY,
      centerOverflowY: getComputedStyle(document.querySelector('#center')).overflowY,
      docScrollsFully: document.documentElement.scrollHeight <= window.innerHeight + 2,
    }));

    assert.notEqual(data.bodyOverflow, 'hidden', 'desktop keeps the page from being clipped');
    assert.equal(data.appDisplay, 'grid', 'desktop keeps the header/desk grid shell');
    assert.equal(data.railOverflowY, 'auto', 'desktop rail scrolls on its own');
    assert.equal(data.centerOverflowY, 'auto', 'desktop center scrolls on its own');
    assert.equal(data.docScrollsFully, true, 'desktop page itself does not need to scroll (rail/center do)');
    return { desktop: 'PASS' };
  } finally {
    await context.close();
    await browser.close();
  }
}

const results = [];
for (const width of [375, 390, 430]) {
  results.push(await testMobile('chromium', chromium, width));
}
results.push(await testMobile('webkit', webkit, 390));
const desktop = await testDesktop();

console.log(JSON.stringify({ mobileShell: 'PASS', results, desktop }, null, 2));
