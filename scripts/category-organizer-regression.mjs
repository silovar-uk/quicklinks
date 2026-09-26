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
      { id:'link-a1', title:'Alpha One', url:'https://example.com/a1', projectName:'Alpha', note:'note-a1', addedAt:now, updatedAt:now, lastClickedAt:now, clickCount:4, clickHistory:[now], archived:false, isFavorite:true, favoriteType:'normal', favoriteExpiry:null },
      { id:'link-a2', title:'Alpha Two', url:'https://example.com/a2', projectName:'Alpha', note:'note-a2', addedAt:now, updatedAt:now, lastClickedAt:null, clickCount:0, clickHistory:[], archived:false, isFavorite:false, favoriteType:'none', favoriteExpiry:null },
      { id:'link-b1', title:'Beta One', url:'https://example.com/b1', projectName:'Beta', note:'note-b1', addedAt:now, updatedAt:now, lastClickedAt:null, clickCount:1, clickHistory:[], archived:false, isFavorite:false, favoriteType:'none', favoriteExpiry:null },
    ],
    projects: ['Alpha', 'Beta'],
    projectColors: {
      Alpha: { bg:'#fff', text:'#111', border:'#aaa' },
      Beta: { bg:'#eee', text:'#222', border:'#bbb' },
    },
    promptMemos: [
      { id:'prompt-x1', title:'Prompt X', categoryName:'X', body:'body x', createdAt:now, updatedAt:now, copyCount:2, lastCopiedAt:now },
      { id:'prompt-y1', title:'Prompt Y', categoryName:'Y', body:'body y', createdAt:now, updatedAt:now, copyCount:1, lastCopiedAt:null },
    ],
    promptCategories: ['X', 'Y'],
  };
}

async function seed(page) {
  await page.goto(BASE_URL, { waitUntil:'domcontentloaded' });
  await page.evaluate(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value));
    localStorage.removeItem('quick-links-sync-v1');
  }, { key: STORAGE_KEY, value: fixture() });
  await page.reload({ waitUntil:'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.QuickLinksCategoryOrganizer));
}

async function stored(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
}

function row(page, kind, name) {
  return page.locator('.category-organizer-row[data-category-kind="' + kind + '"]').filter({ hasText:name });
}

async function openOrganizer(page, kind) {
  const chipsId = kind === 'links' ? '#linkChips' : '#promptChips';
  const active = page.locator(chipsId + '.category-organizer-active');
  if (await active.count()) {
    await active.waitFor({ state:'visible' });
    return;
  }
  await page.locator(chipsId + ' [data-category-organizer-toggle="' + kind + '"]').click();
  await active.waitFor({ state:'visible' });
}

async function testDesktop(browser) {
  const context = await browser.newContext({ viewport:{ width:1440, height:1000 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));

  try {
    await seed(page);

    const before = await stored(page);
    const originalA1 = structuredClone(before.items.find(item => item.id === 'link-a1'));

    await openOrganizer(page, 'links');
    assert.equal(await row(page, 'links', 'Alpha').count(), 1, 'Alpha row is shown');
    assert.equal(await row(page, 'links', 'Beta').count(), 1, 'Beta row is shown');
    assert.equal(await row(page, 'links', 'Alpha').locator('.category-organizer-count').innerText(), '2件');

    await row(page, 'links', 'Alpha').locator('.category-organizer-more').click();
    await page.getByRole('button', { name:'別の分類に統合' }).click();
    await page.locator('#categoryMergeTarget').selectOption('Beta');

    const preview = await page.locator('#categoryMergePreview').innerText();
    assert.match(preview, /Beta/);
    assert.match(preview, /1件 → 3件/);
    assert.match(preview, /Alpha/);
    assert.match(preview, /2件 → 統合後に消えます/);

    await page.locator('#categoryMergeConfirm').click();

    let data = await stored(page);
    assert.equal(data.items.length, 3, 'merge keeps link count');
    assert.equal(data.items.filter(item => item.projectName === 'Beta').length, 3, 'all Alpha links move to Beta');
    assert.equal(data.items.some(item => item.projectName === 'Alpha'), false, 'Alpha is removed after merge');
    assert.equal(data.projects.includes('Alpha'), false, 'Alpha project disappears');
    assert.equal(data.currentProject, 'Beta', 'current project follows merge target');
    const mergedA1 = data.items.find(item => item.id === 'link-a1');
    for (const key of ['id','title','url','note','clickCount','lastClickedAt','favoriteType']) {
      assert.deepEqual(mergedA1[key], originalA1[key], 'merge preserves ' + key);
    }
    assert.deepEqual(data.projectColors.Beta, before.projectColors.Beta, 'target color is preserved');

    const snackbar = page.locator('#categoryOrganizerSnackbar');
    await snackbar.waitFor({ state:'visible' });
    assert.match(await snackbar.innerText(), /2件を「Beta」へ統合しました/);
    await snackbar.getByRole('button', { name:'元に戻す' }).click();

    data = await stored(page);
    assert.equal(data.items.filter(item => item.projectName === 'Alpha').length, 2, 'undo restores Alpha items');
    assert.equal(data.items.filter(item => item.projectName === 'Beta').length, 1, 'undo restores Beta count');
    assert.equal(data.currentProject, 'Alpha', 'undo restores active project');
    assert.deepEqual(data.projectColors.Alpha, before.projectColors.Alpha, 'undo restores source color');

    await openOrganizer(page, 'links');
    const drag = row(page, 'links', 'Alpha').locator('.category-organizer-drag');
    assert.equal(await drag.count(), 1, 'desktop drag handle is available');
    await drag.dragTo(row(page, 'links', 'Beta'));
    await page.locator('#categoryMergeTarget').waitFor({ state:'visible' });
    assert.equal(await page.locator('#categoryMergeTarget').inputValue(), 'Beta', 'drop chooses merge target');
    await page.getByRole('button', { name:'キャンセル' }).click();

    await page.getByRole('button', { name:'プロンプト', exact:true }).click();
    await openOrganizer(page, 'prompts');
    await row(page, 'prompts', 'X').locator('.category-organizer-more').click();
    await page.getByRole('button', { name:'別のカテゴリに統合' }).click();
    await page.locator('#categoryMergeTarget').selectOption('Y');
    await page.locator('#categoryMergeConfirm').click();
    data = await stored(page);
    assert.equal(data.promptMemos.filter(item => item.categoryName === 'Y').length, 2, 'prompt categories merge');
    assert.equal(data.promptCategories.includes('X'), false, 'source prompt category disappears');

    assert.deepEqual(pageErrors, [], 'no desktop page errors');
    return { desktop:'PASS' };
  } finally {
    await context.close();
  }
}

async function testMobile(browser) {
  const context = await browser.newContext({ viewport:{ width:390, height:844 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));

  try {
    await seed(page);
    await openOrganizer(page, 'links');
    const mobileDragHandles = page.locator('.category-organizer-drag');
    if (await mobileDragHandles.count()) {
      assert.equal(await mobileDragHandles.first().isVisible(), false, 'mobile hides drag-only affordance');
    }
    const geometry = await page.evaluate(() => ({
      body: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
      rows: [...document.querySelectorAll('.category-organizer-row')].map(row => {
        const rect = row.getBoundingClientRect();
        return { left:rect.left, right:rect.right };
      }),
    }));
    assert.ok(geometry.body <= geometry.viewport, 'mobile has no page-level horizontal overflow');
    assert.ok(geometry.rows.every(rect => rect.left >= 0 && rect.right <= geometry.viewport), 'mobile organizer rows fit viewport');

    await row(page, 'links', 'Alpha').locator('.category-organizer-more').click();
    await page.getByRole('button', { name:'別の分類に統合' }).click();
    const sheetBox = await page.locator('.category-organizer-sheet').boundingBox();
    assert.ok(sheetBox && sheetBox.x >= 0 && sheetBox.x + sheetBox.width <= 390, 'mobile merge sheet fits viewport');

    assert.deepEqual(pageErrors, [], 'no mobile page errors');
    return { mobile:'PASS' };
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch({ headless:true });
try {
  const desktop = await testDesktop(browser);
  const mobile = await testMobile(browser);
  console.log(JSON.stringify({ desktop, mobile }, null, 2));
} finally {
  await browser.close();
}
