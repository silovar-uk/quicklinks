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
    localStorage.removeItem('quick-links-sync-v1');
  }, { key: STORAGE_KEY, value: fixture() });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.QuickLinksMobileShell));
}

async function snapshot(page) {
  return page.evaluate(() => {
    const main = document.querySelector('main');
    const nav = document.querySelector('.tabs');
    const fab = document.querySelector('.fab');
    const app = document.querySelector('.app');
    const navRect = nav.getBoundingClientRect();
    const fabRect = fab.getBoundingClientRect();
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      shellHeight: app.getBoundingClientRect().height,
      bodyScroll: document.body.scrollTop,
      docScroll: document.documentElement.scrollTop,
      mainScroll: main.scrollTop,
      mainScrollHeight: main.scrollHeight,
      mainClientHeight: main.clientHeight,
      docWidth: document.documentElement.scrollWidth,
      bodyOverflow: getComputedStyle(document.body).overflow,
      appDisplay: getComputedStyle(app).display,
      mainOverflowY: getComputedStyle(main).overflowY,
      navPosition: getComputedStyle(nav).position,
      navTop: navRect.top,
      navBottom: navRect.bottom,
      navHeight: navRect.height,
      fabBottom: fabRect.bottom,
      shellClass: document.documentElement.classList.contains('quick-mobile-shell'),
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
    let before = await snapshot(page);

    assert.equal(before.shellClass, true, engineName + ' shell class is active');
    assert.equal(before.bodyOverflow, 'hidden', engineName + ' body does not scroll');
    assert.equal(before.appDisplay, 'grid', engineName + ' app uses grid shell');
    assert.equal(before.mainOverflowY, 'auto', engineName + ' main owns vertical scrolling');
    assert.equal(before.navPosition, 'relative', engineName + ' bottom nav is not fixed');
    assert.ok(before.mainScrollHeight > before.mainClientHeight, engineName + ' fixture is scrollable');
    assert.ok(Math.abs(before.navBottom - before.innerHeight) <= 2, engineName + ' nav sits at visible bottom');
    assert.ok(before.docWidth <= before.innerWidth, engineName + ' has no horizontal page overflow');
    assert.ok(before.fabBottom <= before.navTop - 6, engineName + ' FAB stays above bottom nav');

    await page.locator('main').evaluate(node => { node.scrollTop = 1200; });
    await page.waitForTimeout(80);
    let afterScroll = await snapshot(page);

    assert.ok(afterScroll.mainScroll > 500, engineName + ' main scrolls deeply');
    assert.equal(afterScroll.bodyScroll, 0, engineName + ' body scroll remains zero');
    assert.equal(afterScroll.docScroll, 0, engineName + ' document scroll remains zero');
    assert.ok(Math.abs(afterScroll.navTop - before.navTop) <= 1, engineName + ' nav top is stable while main scrolls');
    assert.ok(Math.abs(afterScroll.navBottom - before.navBottom) <= 1, engineName + ' nav bottom is stable while main scrolls');

    await page.setViewportSize({ width, height: 760 });
    await page.waitForTimeout(120);
    const shrunk = await snapshot(page);
    assert.ok(Math.abs(shrunk.navBottom - shrunk.innerHeight) <= 2, engineName + ' nav follows smaller viewport');
    assert.equal(shrunk.bodyScroll, 0, engineName + ' body remains fixed after viewport shrink');
    assert.ok(shrunk.fabBottom <= shrunk.navTop - 6, engineName + ' FAB remains above nav after shrink');

    await page.setViewportSize({ width, height: 844 });
    await page.waitForTimeout(120);
    const restored = await snapshot(page);
    assert.ok(Math.abs(restored.navBottom - restored.innerHeight) <= 2, engineName + ' nav follows restored viewport');
    assert.equal(restored.bodyScroll, 0, engineName + ' body remains fixed after restore');
    assert.ok(restored.docWidth <= restored.innerWidth, engineName + ' restored viewport has no horizontal overflow');

    assert.deepEqual(pageErrors, [], engineName + ' has no page errors');
    return {
      engine: engineName,
      width,
      status: 'PASS',
      navHeight: restored.navHeight,
      shellHeight: restored.shellHeight,
    };
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
      shellClass: document.documentElement.classList.contains('quick-mobile-shell'),
      bodyOverflow: getComputedStyle(document.body).overflow,
      appDisplay: getComputedStyle(document.querySelector('.app')).display,
      navPosition: getComputedStyle(document.querySelector('.tabs')).position,
    }));

    assert.equal(data.shellClass, false, 'desktop does not use mobile shell');
    assert.notEqual(data.bodyOverflow, 'hidden', 'desktop keeps document scrolling available');
    assert.equal(data.appDisplay, 'block', 'desktop keeps normal document layout');
    assert.equal(data.navPosition, 'sticky', 'desktop navigation remains sticky');
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
