import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE_URL = process.env.LOCAL_URL || 'http://127.0.0.1:4173/';
const STORAGE_KEY = 'quick-links-mobile-localstorage-v1';
const DAY = 24 * 60 * 60 * 1000;

function isoDaysAgo(days) {
  return new Date(Date.now() - days * DAY).toISOString();
}

function prompt(id, title, daysAgo, copyCount, categoryName = '業務') {
  return {
    id: `prompt-${id}`,
    title,
    categoryName,
    body: `${title}の本文`,
    createdAt: isoDaysAgo(400),
    updatedAt: isoDaysAgo(20),
    copyCount,
    lastCopiedAt: daysAgo == null ? null : isoDaysAgo(daysAgo),
  };
}

function link(id, title, daysAgo, clickCount, projectName = '業務') {
  return {
    id: `link-${id}`,
    title,
    url: `https://example.com/${id}`,
    projectName,
    note: `${title}の備考`,
    addedAt: isoDaysAgo(300),
    updatedAt: isoDaysAgo(20),
    clickCount,
    lastClickedAt: daysAgo == null ? null : isoDaysAgo(daysAgo),
    clickHistory: [],
    archived: false,
    isFavorite: false,
    favoriteType: 'none',
    favoriteExpiry: null,
  };
}

function fixture() {
  const promptMemos = [
    prompt('a', 'Alpha', 1, 8),
    prompt('b', 'Bravo', 2, 5),
    prompt('c', 'Charlie', 3, 3),
    prompt('d', 'Delta', 4, 2),
    prompt('old', 'Long time no see prompt', 180, 12, '保管'),
    prompt('never', 'Never used', null, 0, '保管'),
  ];
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
    linkPerPage: '10',
    promptPerPage: '10',
    items: [
      link('a', 'Alpha Link', 2, 4),
      link('b', 'Bravo Link', null, 0, '保管'),
    ],
    projects: ['業務', '保管'],
    projectColors: {},
    promptMemos,
    promptCategories: ['業務', '保管'],
  };
}

async function seed(page) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key: STORAGE_KEY,
    value: fixture(),
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#deckTrack .card, .card-end').first().waitFor({ state: 'attached' });
}

async function readStored(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
}

async function goToPrompts(page) {
  await page.locator('#rail [data-rail="prompts"]').click();
  await page.locator('#pview:not([hidden])').waitFor({ state: 'visible' });
}

async function reuseTitles(page) {
  return (await page.locator('#reuse button:not(.dormant)').allInnerTexts()).map(t => t.trim());
}

async function waitForPromptCopy(page, id, previousCount) {
  await page.waitForFunction(({ key, promptId, count }) => {
    const stored = JSON.parse(localStorage.getItem(key) || '{}');
    const memo = stored.promptMemos?.find(item => item.id === promptId);
    return Number(memo?.copyCount || 0) > count;
  }, { key: STORAGE_KEY, promptId: id, count: previousCount });
}

async function runCoreRegression(browser) {
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    permissions: ['clipboard-read', 'clipboard-write'],
    acceptDownloads: true,
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  // このテストはデータ層の確認が目的なので、ページ情報の自動取得は起こさせない
  await context.route('https://example.com/**', route => route.abort());
  await context.route('https://api.microlink.io/**', route => route.abort());

  try {
    await seed(page);
    await goToPrompts(page);

    // 最近コピーした順・久しぶりの表示
    assert.deepEqual(await reuseTitles(page), ['Alpha', 'Bravo', 'Charlie'], 'recent history order');
    const dormant = page.locator('#reuse button.dormant');
    assert.equal(await dormant.count(), 1, 'dormant shown');
    const firstDormantId = await dormant.getAttribute('data-copy');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('#deckTrack .card, .card-end').first().waitFor({ state: 'attached' });
    await goToPrompts(page);
    assert.equal(await page.locator('#reuse button.dormant').getAttribute('data-copy'), firstDormantId, 'dormant is stable during the day');

    // コピー回数・時刻
    const alphaBefore = (await readStored(page)).promptMemos.find(item => item.id === 'prompt-a');
    await page.locator('#promptList .row[data-id="prompt-a"] .row-copy').click();
    await waitForPromptCopy(page, 'prompt-a', alphaBefore.copyCount);
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'Alphaの本文', 'clipboard has prompt body');
    const alphaAfter = (await readStored(page)).promptMemos.find(item => item.id === 'prompt-a');
    assert.equal(alphaAfter.copyCount, alphaBefore.copyCount + 1, 'copy count increment');
    assert.ok(Date.parse(alphaAfter.lastCopiedAt) > Date.now() - 10_000, 'copy timestamp updated');
    assert.deepEqual(await reuseTitles(page), ['Alpha', 'Bravo', 'Charlie'], 'recent history reorders to newest copy');

    // プロンプトの追加・編集・削除
    await page.locator('#promptAddButton').click();
    await page.locator('#promptSheet[open]').waitFor();
    await page.locator('#pCat').fill('業務');
    await page.locator('#pTitle').fill('Regression Prompt');
    await page.locator('#pBody').fill('Regression body');
    await page.locator('#pSave').click();
    await page.locator('#promptSheet[open]').waitFor({ state: 'detached' }).catch(() => {});
    let stored = await readStored(page);
    const addedPrompt = stored.promptMemos.find(item => item.title === 'Regression Prompt');
    assert.ok(addedPrompt, 'prompt add');

    await page.locator(`#promptList .row[data-id="${addedPrompt.id}"] .row-main`).click();
    await page.locator('#promptPane [data-pedit]').click();
    await page.locator('#promptSheet[open]').waitFor();
    await page.locator('#pTitle').fill('Regression Prompt Edited');
    await page.locator('#pSave').click();
    stored = await readStored(page);
    assert.equal(stored.promptMemos.find(item => item.id === addedPrompt.id)?.title, 'Regression Prompt Edited', 'prompt edit');

    await page.locator(`#promptList .row[data-id="${addedPrompt.id}"] .row-main`).click();
    await page.locator('#promptPane [data-pedit]').click();
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#pDelete').click();
    assert.equal((await readStored(page)).promptMemos.some(item => item.id === addedPrompt.id), false, 'prompt delete');

    // リンクの保存・編集・開いた回数
    await page.locator('[data-rail="all"]').click();
    await page.locator('#addButton').click();
    await page.locator('#linkSheet[open]').waitFor();
    await page.locator('#fUrl').fill('https://example.com/regression');
    await page.locator('#fCat').fill('業務');
    await page.keyboard.press('Enter');
    await page.locator('#fTitle').fill('Regression Link');
    await page.locator('#fNote').fill('Regression note');
    await page.locator('#fSave').click();
    await page.locator('#linkSheet[open]').waitFor({ state: 'detached' }).catch(() => {});
    stored = await readStored(page);
    const addedLink = stored.items.find(item => item.title === 'Regression Link');
    assert.ok(addedLink, 'link add');

    await page.locator(`#lib .item[data-id="${addedLink.id}"] .item-more`).click();
    await page.locator('#detailSheet [data-act="edit"]').click();
    await page.locator('#linkSheet[open]').waitFor();
    await page.locator('#fTitle').fill('Regression Link Edited');
    await page.locator('#fSave').click();
    assert.equal((await readStored(page)).items.find(item => item.id === addedLink.id)?.title, 'Regression Link Edited', 'link edit');

    const initialClickCount = (await readStored(page)).items.find(item => item.id === 'link-a').clickCount;
    const popupPromise = context.waitForEvent('page', { timeout: 4000 }).catch(() => null);
    await page.locator('#lib .item[data-id="link-a"] .item-main').click();
    const popup = await popupPromise;
    if (popup) await popup.close();
    await page.waitForTimeout(150);
    stored = await readStored(page);
    const clickedLink = stored.items.find(item => item.id === 'link-a');
    assert.equal(clickedLink.clickCount, initialClickCount + 1, 'link click count');
    assert.ok(Date.parse(clickedLink.lastClickedAt) > Date.now() - 10_000, 'link last-clicked timestamp');

    await page.locator('#searchInput').fill('Regression Link Edited');
    assert.equal(await page.locator('#lib .item[data-id]').count(), 1, 'link search');
    await page.locator('#searchClear').click();

    await page.locator(`#lib .item[data-id="${addedLink.id}"] .item-more`).click();
    await page.locator('#detailSheet [data-act="letgo"]').click();
    assert.equal((await readStored(page)).items.some(item => item.id === addedLink.id), false, 'link delete (letgo)');
    await page.locator('#toast button').click();
    assert.equal((await readStored(page)).items.some(item => item.title === 'Regression Link Edited'), true, 'link delete undo');

    // 書き出し
    await page.locator('[data-rail="manage"]').click();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#exportBtn').click();
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /^quick_links_mobile_backup_\d{4}-\d{2}-\d{2}\.json$/, 'export filename');

    // 旧形式の取り込み
    const importPayload = {
      schemaVersion: 'quick-links-backup-v2',
      quickLinks: {
        items: [
          { id: 'active-import', title: 'Active Import', url: 'https://example.com/active', projectName: 'Imported', addedAt: isoDaysAgo(1) },
          { id: 'archived-import', title: 'Archived Import', url: 'https://example.com/archived', projectName: 'Imported', archived: true },
        ],
      },
      promptMemos: {
        items: [
          { id: 'legacy-import', title: 'Legacy Import', body: 'Legacy body', projectName: 'Imported', addedAt: isoDaysAgo(10) },
        ],
      },
    };
    await page.locator('#importText').fill(JSON.stringify(importPayload));
    await page.locator('#runImportBtn').click();
    stored = await readStored(page);
    const legacyPrompt = stored.promptMemos.find(item => item.id === 'legacy-import');
    assert.equal(legacyPrompt.copyCount, 0, 'legacy prompt copy default');
    assert.equal(legacyPrompt.lastCopiedAt, null, 'legacy prompt timestamp default');
    assert.ok(stored.items.some(item => item.id === 'active-import'), 'active import retained');
    assert.equal(stored.items.some(item => item.id === 'archived-import'), false, 'archived import excluded');
    assert.equal(await page.evaluate(key => localStorage.getItem(key) !== null, STORAGE_KEY), true, 'storage key unchanged');

    // プロンプトへ新しい項目を足していないこと
    const allowedPromptKeys = ['body', 'categoryName', 'copyCount', 'createdAt', 'id', 'lastCopiedAt', 'title', 'updatedAt'];
    stored.promptMemos.forEach(item => {
      assert.deepEqual(Object.keys(item).sort(), allowedPromptKeys, 'no new stored prompt fields');
    });

    assert.deepEqual(pageErrors, [], 'core page errors');
    return { status: 'PASS' };
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch({ headless: true });
try {
  const core = await runCoreRegression(browser);
  console.log(JSON.stringify({ core }, null, 2));
} finally {
  await browser.close();
}
