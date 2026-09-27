import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE_URL = process.env.LOCAL_URL || 'http://127.0.0.1:4173/';
const STORAGE_KEY = 'quick-links-mobile-localstorage-v1';

function fixture() {
  const now = new Date().toISOString();
  return {
    activeTab: 'links',
    query: '',
    currentProject: 'Alpha',
    currentPromptCategory: 'ALL',
    onlyFavorites: false,
    linkSort: 'recent',
    promptSort: 'popular',
    viewMode: 'rich',
    linkPage: 1,
    promptPage: 1,
    linkPerPage: '10',
    promptPerPage: '10',
    items: [
      { id: 'link-a1', title: 'Alpha One', url: 'https://example.com/a1', projectName: 'Alpha', note: 'note-a1', addedAt: now, updatedAt: now, lastClickedAt: now, clickCount: 4, clickHistory: [now], archived: false, isFavorite: true, favoriteType: 'normal', favoriteExpiry: null },
      { id: 'link-a2', title: 'Alpha Two', url: 'https://example.com/a2', projectName: 'Alpha', note: 'note-a2', addedAt: now, updatedAt: now, lastClickedAt: null, clickCount: 0, clickHistory: [], archived: false, isFavorite: false, favoriteType: 'none', favoriteExpiry: null },
      { id: 'link-b1', title: 'Beta One', url: 'https://example.com/b1', projectName: 'Beta', note: 'note-b1', addedAt: now, updatedAt: now, lastClickedAt: null, clickCount: 1, clickHistory: [], archived: false, isFavorite: false, favoriteType: 'none', favoriteExpiry: null },
    ],
    projects: ['Alpha', 'Beta'],
    projectColors: {
      Alpha: { bg: '#fff', text: '#111', border: '#aaa' },
      Beta: { bg: '#eee', text: '#222', border: '#bbb' },
    },
    promptMemos: [
      { id: 'prompt-x1', title: 'Prompt X', categoryName: 'X', body: 'body x', createdAt: now, updatedAt: now, copyCount: 2, lastCopiedAt: now },
      { id: 'prompt-y1', title: 'Prompt Y', categoryName: 'Y', body: 'body y', createdAt: now, updatedAt: now, copyCount: 1, lastCopiedAt: null },
    ],
    promptCategories: ['X', 'Y'],
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

async function stored(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
}

function orgRow(page, root, name) {
  return page.locator(`${root} .org-row`).filter({ hasText: name });
}

async function openLinkOrganizer(page) {
  await page.locator('[data-rail="all"]').click();
  const active = page.locator('#rail #organizer');
  if (await active.count()) return;
  await page.locator('#rail [data-rail="organize"]').click();
  await page.locator('#rail #organizer').waitFor({ state: 'visible' });
}

async function testDesktop(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));

  try {
    await seed(page);
    const before = await stored(page);
    const originalA1 = structuredClone(before.items.find(item => item.id === 'link-a1'));

    await openLinkOrganizer(page);
    assert.equal(await orgRow(page, '#rail', 'Alpha').count(), 1, 'Alpha row is shown');
    assert.equal(await orgRow(page, '#rail', 'Beta').count(), 1, 'Beta row is shown');
    assert.match(await orgRow(page, '#rail', 'Alpha').locator('.n').innerText(), /2件/);

    await orgRow(page, '#rail', 'Alpha').locator('.org-more').click();
    await page.locator('#actionSheet').getByRole('button', { name: '別の引き出しに統合' }).click();
    await page.locator('#mergeTargetSelect').selectOption('Beta');

    const preview = await page.locator('#mergePreview').innerText();
    assert.match(preview, /Beta/);
    assert.match(preview, /1件.*3件/);
    assert.match(preview, /Alpha/);
    assert.match(preview, /統合後に消えます/);

    await page.locator('#mergeConfirmBtn').click();

    let data = await stored(page);
    assert.equal(data.items.length, 3, 'merge keeps link count');
    assert.equal(data.items.filter(item => item.projectName === 'Beta').length, 3, 'all Alpha links move to Beta');
    assert.equal(data.items.some(item => item.projectName === 'Alpha'), false, 'Alpha is removed after merge');
    assert.equal(data.projects.includes('Alpha'), false, 'Alpha project disappears');
    assert.equal(data.currentProject, 'Beta', 'current project follows merge target');
    const mergedA1 = data.items.find(item => item.id === 'link-a1');
    for (const key of ['id', 'title', 'url', 'note', 'clickCount', 'lastClickedAt', 'favoriteType']) {
      assert.deepEqual(mergedA1[key], originalA1[key], 'merge preserves ' + key);
    }
    assert.deepEqual(data.projectColors.Beta, before.projectColors.Beta, 'target color is preserved');

    await page.locator('#toast button').waitFor({ state: 'visible' });
    assert.match(await page.locator('#toast .msg').innerText(), /2件を「Beta」へ統合しました/);
    await page.locator('#toast button').click();

    data = await stored(page);
    assert.equal(data.items.filter(item => item.projectName === 'Alpha').length, 2, 'undo restores Alpha items');
    assert.equal(data.items.filter(item => item.projectName === 'Beta').length, 1, 'undo restores Beta count');
    assert.equal(data.currentProject, 'Alpha', 'undo restores active project');
    assert.deepEqual(data.projectColors.Alpha, before.projectColors.Alpha, 'undo restores source color');

    await openLinkOrganizer(page);
    const drag = orgRow(page, '#rail', 'Alpha').locator('.org-drag');
    assert.equal(await drag.count(), 1, 'desktop drag handle is available');
    await drag.dragTo(orgRow(page, '#rail', 'Beta'));
    await page.locator('#mergeTargetSelect').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#mergeTargetSelect').inputValue(), 'Beta', 'drop chooses merge target');
    await page.locator('#actionSheet [data-close]').first().click();

    await page.locator('[data-rail="prompts"]').click();
    await page.locator('#promptOrganizeButton').click();
    await page.locator('#catSheet[open]').waitFor();
    await orgRow(page, '#catMenu', 'X').locator('.org-more').click();
    await page.locator('#actionSheet').getByRole('button', { name: '別のカテゴリに統合' }).click();
    await page.locator('#mergeTargetSelect').selectOption('Y');
    await page.locator('#mergeConfirmBtn').click();
    data = await stored(page);
    assert.equal(data.promptMemos.filter(item => item.categoryName === 'Y').length, 2, 'prompt categories merge');
    assert.equal(data.promptCategories.includes('X'), false, 'source prompt category disappears');

    assert.deepEqual(pageErrors, [], 'no desktop page errors');
    return { desktop: 'PASS' };
  } finally {
    await context.close();
  }
}

async function testMobile(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));

  try {
    await seed(page);
    await page.locator('#chips [data-drawer="…"]').click();
    await page.locator('#catSheet[open]').waitFor();
    await page.locator('#catMenu [data-org-open]').click();
    await page.locator('#catMenu #organizer').waitFor({ state: 'visible' });

    const mobileDragHandles = page.locator('#catMenu .org-drag');
    assert.equal(await mobileDragHandles.count(), 0, 'mobile hides drag-only affordance');

    const geometry = await page.evaluate(() => ({
      body: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
      rows: [...document.querySelectorAll('#catMenu .org-row')].map(row => {
        const rect = row.getBoundingClientRect();
        return { left: rect.left, right: rect.right };
      }),
    }));
    assert.ok(geometry.body <= geometry.viewport, 'mobile has no page-level horizontal overflow');
    assert.ok(geometry.rows.every(rect => rect.left >= 0 && rect.right <= geometry.viewport), 'mobile organizer rows fit viewport');

    await orgRow(page, '#catMenu', 'Alpha').locator('.org-more').click();
    await page.locator('#actionSheet').getByRole('button', { name: '別の引き出しに統合' }).click();
    const sheetBox = await page.locator('#actionSheet').boundingBox();
    assert.ok(sheetBox && sheetBox.x >= 0 && sheetBox.x + sheetBox.width <= 390, 'mobile merge sheet fits viewport');

    assert.deepEqual(pageErrors, [], 'no mobile page errors');
    return { mobile: 'PASS' };
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch({ headless: true });
try {
  const desktop = await testDesktop(browser);
  const mobile = await testMobile(browser);
  console.log(JSON.stringify({ desktop, mobile }, null, 2));
} finally {
  await browser.close();
}
