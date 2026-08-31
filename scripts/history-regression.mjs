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
  const longBodyPrompt = prompt('long-body', 'Long body prompt', 75, 2, '保管');
  longBodyPrompt.body = '長文プロンプト。'.repeat(140);
  const promptMemos = [
    prompt('a', 'Alpha', 1, 8),
    prompt('b', 'Bravo', 2, 5),
    prompt('c', 'Charlie', 3, 3),
    prompt('d', 'Delta', 4, 2),
    prompt('old', 'Long time no see prompt with a deliberately long title', 180, 12, '保管'),
    prompt('old-2', 'Quarterly archive check', 240, 3, '保管'),
    prompt('old-3', 'Frequently used in the past', 90, 40, '保管'),
    prompt('old-4', 'Very old small helper', 500, 2, '保管'),
    longBodyPrompt,
    prompt('never', 'Never used', null, 0, '保管'),
    ...Array.from({ length: 8 }, (_, index) => prompt(`extra-${index}`, `Extra ${index + 1}`, 10 + index, 1)),
  ];
  return {
    activeTab: 'prompts',
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
  await page.waitForSelector('.prompt-reuse', { state: 'visible' });
}

async function readStored(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
}

async function reuseTitles(page) {
  return (await page.locator('.prompt-reuse-button').allTextContents()).map(value => value.trim());
}

async function setPromptPerPage(page, value) {
  await page.evaluate(nextValue => {
    const select = document.getElementById('promptPerPageSelect');
    select.value = nextValue;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

async function setSelectValue(page, id, value) {
  await page.evaluate(({ selectId, nextValue }) => {
    const select = document.getElementById(selectId);
    select.value = nextValue;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }, { selectId: id, nextValue: value });
}

async function runViewport(browser, width, height) {
  const context = await browser.newContext({ viewport: { width, height }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));

  try {
    await seed(page);
    const recent = page.locator('.prompt-reuse-button');
    assert.equal(await recent.count(), 3, `${width}px: recent count`);
    assert.deepEqual(await reuseTitles(page), ['Alpha', 'Bravo', 'Charlie'], `${width}px: recent order`);
    const alphaMeta = await page.locator('[data-id="prompt-a"] .meta').innerText();
    assert.match(alphaMeta, /8回使用/, `${width}px: usage count meta`);
    assert.match(alphaMeta, /最終利用 \d{1,4}\/\d{1,2}/, `${width}px: last-used meta`);

    await setPromptPerPage(page, 'all');
    const neverUsedMeta = await page.locator('[data-id="prompt-never"] .meta').innerText();
    assert.doesNotMatch(neverUsedMeta, /0回使用|最終利用/, `${width}px: no empty usage noise`);
    await setPromptPerPage(page, '10');

    await page.evaluate(() => document.getElementById('promptSimpleViewBtn').click());
    const alphaSimpleMeta = await page.locator('[data-id="prompt-a"] .simple-sub').innerText();
    assert.match(alphaSimpleMeta, /8回使用/, `${width}px: simple usage count`);
    assert.match(alphaSimpleMeta, /最終 \d{1,4}\/\d{1,2}/, `${width}px: simple last-used`);
    await page.evaluate(() => document.getElementById('promptRichViewBtn').click());

    const dormant = page.locator('.prompt-dormant-button');
    assert.equal(await dormant.count(), 1, `${width}px: dormant count`);
    const firstDormantId = await dormant.getAttribute('data-copy-prompt-id');
    const firstDormantText = (await dormant.innerText()).trim();
    assert.match(firstDormantText, /(日|か月|年)ぶり.*以前[\d,]+回使用/s, `${width}px: dormant facts`);
    await page.reload({ waitUntil: 'domcontentloaded' });
    assert.equal(await page.locator('.prompt-dormant-button').getAttribute('data-copy-prompt-id'), firstDormantId, `${width}px: dormant is stable during the day`);

    const bounds = await recent.evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width, viewport: innerWidth };
    }));
    assert.ok(bounds.every(rect => rect.left >= 0 && rect.right <= rect.viewport && rect.width >= 80), `${width}px: recent buttons fit`);

    await page.getByRole('button', { name: 'Alphaをコピー' }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'Alphaの本文', `${width}px: reuse clipboard`);
    const afterReuse = await readStored(page);
    const alpha = afterReuse.promptMemos.find(item => item.id === 'prompt-a');
    assert.equal(alpha.copyCount, 9, `${width}px: reuse count increment`);
    assert.ok(Date.parse(alpha.lastCopiedAt) > Date.now() - 10_000, `${width}px: reuse timestamp`);

    await page.locator('#globalSearch').fill('Alpha');
    assert.equal(await page.locator('.prompt-reuse').count(), 0, `${width}px: hidden during search`);
    await page.locator('#clearSearchBtn').click();
    await page.locator('[data-prompt-category="保管"]').click();
    assert.equal(await page.locator('.prompt-reuse').count(), 0, `${width}px: hidden during category filter`);
    await page.locator('[data-prompt-category="ALL"]').click();

    const deltaCard = page.locator('[data-id="prompt-d"]');
    await deltaCard.getByRole('button', { name: 'コピー' }).click();
    assert.deepEqual((await reuseTitles(page)).slice(0, 3), ['Delta', 'Alpha', 'Bravo'], `${width}px: normal copy updates recent`);

    const dormantBeforeCopy = page.locator('.prompt-dormant-button');
    const dormantId = await dormantBeforeCopy.getAttribute('data-copy-prompt-id');
    const storedBeforeDormantCopy = await readStored(page);
    const dormantMemoBefore = storedBeforeDormantCopy.promptMemos.find(item => item.id === dormantId);
    await dormantBeforeCopy.click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), dormantMemoBefore.body, `${width}px: dormant clipboard`);
    const storedAfterDormantCopy = await readStored(page);
    const dormantMemoAfter = storedAfterDormantCopy.promptMemos.find(item => item.id === dormantId);
    assert.equal(dormantMemoAfter.copyCount, dormantMemoBefore.copyCount + 1, `${width}px: dormant count increment`);
    assert.ok(Date.parse(dormantMemoAfter.lastCopiedAt) > Date.now() - 10_000, `${width}px: dormant timestamp`);
    assert.equal((await reuseTitles(page))[0], dormantMemoBefore.title, `${width}px: dormant moves to recent`);
    const allowedPromptKeys = ['body', 'categoryName', 'copyCount', 'createdAt', 'id', 'lastCopiedAt', 'title', 'updatedAt'];
    storedAfterDormantCopy.promptMemos.forEach(item => {
      assert.deepEqual(Object.keys(item).sort(), allowedPromptKeys, `${width}px: no new stored fields`);
    });

    if (process.env.HISTORY_QA_SCREENSHOT && width === 390) {
      await page.screenshot({ path: process.env.HISTORY_QA_SCREENSHOT, fullPage: true });
    }

    assert.deepEqual(pageErrors, [], `${width}px: page errors`);
    return { width, status: 'PASS' };
  } finally {
    await context.close();
  }
}

async function runCoreRegression(browser) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    permissions: ['clipboard-read', 'clipboard-write'],
    acceptDownloads: true,
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));

  try {
    await seed(page);

    await setPromptPerPage(page, 'all');
    const longBodyPreview = await page.locator('[data-id="prompt-long-body"] .prompt-body').innerText();
    assert.ok(longBodyPreview.endsWith('…') && longBodyPreview.length <= 361, 'long prompt is safely previewed');
    await setPromptPerPage(page, '10');

    await setSelectValue(page, 'promptSortSelect', 'title');
    assert.equal(await page.locator('#promptsList [data-id]').first().getAttribute('data-id'), 'prompt-a', 'prompt sort');
    await page.locator('#promptPagerTop [data-page-action="next"]').click();
    assert.equal((await readStored(page)).promptPage, 2, 'prompt pagination next');
    assert.equal(await page.locator('.prompt-reuse-group').count(), 0, 'reuse hidden after page one');
    await page.locator('#promptPagerTop [data-page-action="prev"]').click();

    await page.evaluate(() => openPromptModal());
    await page.locator('#promptTitle').fill('Regression Prompt');
    await page.locator('#promptCategory').fill('業務');
    await page.locator('#promptBody').fill('Regression body');
    await page.locator('#savePromptBtn').click();
    let stored = await readStored(page);
    const addedPrompt = stored.promptMemos.find(item => item.title === 'Regression Prompt');
    assert.ok(addedPrompt, 'prompt add');

    await page.locator('#globalSearch').fill('Regression Prompt');
    const addedPromptRow = page.locator(`[data-id="${addedPrompt.id}"]`);
    await addedPromptRow.getByRole('button', { name: '編集' }).click();
    await page.locator('#promptTitle').fill('Regression Prompt Edited');
    await page.locator('#savePromptBtn').click();
    stored = await readStored(page);
    assert.equal(stored.promptMemos.find(item => item.id === addedPrompt.id)?.title, 'Regression Prompt Edited', 'prompt edit');

    await page.locator(`[data-id="${addedPrompt.id}"]`).getByRole('button', { name: 'その他の操作' }).click();
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#precisionActionMenu').getByRole('button', { name: '削除' }).click();
    assert.equal((await readStored(page)).promptMemos.some(item => item.id === addedPrompt.id), false, 'prompt delete');
    await page.locator('#clearSearchBtn').click();

    await page.getByRole('button', { name: 'リンク', exact: true }).click();
    await page.evaluate(() => openLinkModal(null, { skipClipboardAutofill: true }));
    await page.locator('#linkTitle').fill('Regression Link');
    await page.locator('#linkUrl').fill('https://example.com/regression');
    await page.locator('#linkProject').fill('業務');
    await page.locator('#linkNote').fill('Regression note');
    await page.locator('#saveLinkBtn').click();
    stored = await readStored(page);
    const addedLink = stored.items.find(item => item.title === 'Regression Link');
    assert.ok(addedLink, 'link add');

    await page.locator(`[data-id="${addedLink.id}"]`).getByRole('button', { name: 'その他の操作' }).click();
    await page.locator('#precisionActionMenu').getByRole('button', { name: '編集' }).click();
    await page.locator('#linkTitle').fill('Regression Link Edited');
    await page.locator('#saveLinkBtn').click();
    assert.equal((await readStored(page)).items.find(item => item.id === addedLink.id)?.title, 'Regression Link Edited', 'link edit');

    const initialClickCount = (await readStored(page)).items.find(item => item.id === 'link-a').clickCount;
    await page.locator('[data-id="link-a"]').getByRole('button', { name: '開く' }).click();
    stored = await readStored(page);
    const clickedLink = stored.items.find(item => item.id === 'link-a');
    assert.equal(clickedLink.clickCount, initialClickCount + 1, 'link click count');
    assert.ok(Date.parse(clickedLink.lastClickedAt) > Date.now() - 10_000, 'link last-clicked timestamp');

    await page.locator('#globalSearch').fill('Regression Link Edited');
    assert.equal(await page.locator('#linksList [data-id]').count(), 1, 'link search');
    await page.locator('#clearSearchBtn').click();

    await page.locator(`[data-id="${addedLink.id}"]`).getByRole('button', { name: 'その他の操作' }).click();
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#precisionActionMenu').getByRole('button', { name: '削除' }).click();
    assert.equal((await readStored(page)).items.some(item => item.id === addedLink.id), false, 'link delete');

    await page.getByRole('button', { name: '管理', exact: true }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#exportBtn').click();
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /^quick_links_mobile_backup_\d{4}-\d{2}-\d{2}\.json$/, 'export filename');

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
    const importDisclosure = page.locator('details').filter({ hasText: 'JSON貼り付けインポート' });
    await importDisclosure.locator('summary').click();
    await page.locator('#importText').fill(JSON.stringify(importPayload));
    await page.locator('#runImportBtn').click();
    stored = await readStored(page);
    const legacyPrompt = stored.promptMemos.find(item => item.id === 'legacy-import');
    assert.equal(legacyPrompt.copyCount, 0, 'legacy prompt copy default');
    assert.equal(legacyPrompt.lastCopiedAt, null, 'legacy prompt timestamp default');
    assert.ok(stored.items.some(item => item.id === 'active-import'), 'active import retained');
    assert.equal(stored.items.some(item => item.id === 'archived-import'), false, 'archived import excluded');
    assert.equal(await page.evaluate(key => localStorage.getItem(key) !== null, STORAGE_KEY), true, 'storage key unchanged');

    assert.deepEqual(pageErrors, [], 'core page errors');
    return { status: 'PASS' };
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch({ headless: true });
try {
  const results = [];
  for (const viewport of [
    { width: 375, height: 812 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 1440, height: 1000 },
  ]) {
    results.push(await runViewport(browser, viewport.width, viewport.height));
  }
  const core = await runCoreRegression(browser);
  console.log(JSON.stringify({ step1: 'PASS', step2: 'PASS', step3: 'PASS', core, results }, null, 2));
} finally {
  await browser.close();
}
