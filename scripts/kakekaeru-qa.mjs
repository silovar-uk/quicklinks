// 受け入れ確認「迷わずに、掛け替える」(画面が動かず、引き出しを作る・選び直す・掛け替えるが迷わずできる)
// 使い方:
//   手元     : LOCAL_URL=http://127.0.0.1:4173/ node scripts/kakekaeru-qa.mjs
//   公開後   : LOCAL_URL=https://silovar-uk.github.io/quicklinks/ node scripts/kakekaeru-qa.mjs(新しいブラウザー環境で動くため、実データや同期には触れない)
//   段階を絞る: QA_PHASES=P1,P2(既定は P1,P2,P3,P4)
// iOS Safariの拡大・キーボード・日本語入力の確定は、Playwrightでは再現しない。代わりに次で確かめる。
//   拡大しない条件 … 文字を打てる欄が16px以上・touch-action・最初のフォーカスの置き場所
//   キーボード     … 見える高さを375×300に縮める(iPhone SEで日本語キーボードと入力補助バーが出たときの厳しめの値)
//   日本語入力     … 変換中のEnter(keyCode 229)では決めないこと、打つたびに札を作り直さないこと(要素が同じまま残る)
import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';

const BASE_URL = process.env.LOCAL_URL || 'http://127.0.0.1:4173/';
const PHASES = new Set((process.env.QA_PHASES || 'P1,P2,P3,P4').split(','));
const KEY = 'quick-links-mobile-localstorage-v1';
const SE = { width: 375, height: 667 };
const KB = { width: 375, height: 300 };
const PC = { width: 1366, height: 633 };
const DAY = 864e5;
const NEW_URL = n => `https://qa-kakekaeru.test/new/${n}`;

/* ---------- 架空データ(保存形式どおり)。いちばん新しい1件が「しごと」。件数は「しごと」が最多 ---------- */
const DRAWERS = ['しごと', 'あとで読む', 'ときめき', 'まなび', 'ごはん', 'AIツール', 'AI記事', '音楽', '旅行', '買い物', '健康', 'デザイン', '写真', '未分類'];
function fixture() {
  const now = Date.now();
  const iso = t => new Date(t).toISOString();
  const items = Array.from({ length: 42 }, (_, i) => ({
    id: 'link-' + i, title: `架空の記事 ${i + 1}`, url: `https://qa-kakekaeru.test/a/${i}`,
    projectName: i < 6 ? 'しごと' : DRAWERS[i % DRAWERS.length], description: '', descriptionSource: '', descriptionUpdatedAt: null, note: '',
    addedAt: iso(now - i * DAY), updatedAt: iso(now - i * DAY), lastClickedAt: null, clickCount: 0, clickHistory: [],
    archived: false, isFavorite: false, favoriteType: 'none', favoriteExpiry: null
  }));
  const promptMemos = [
    { id: 'prompt-0', title: '記事要約', categoryName: '要約', body: '次の文章を3行で要約してください。', createdAt: iso(now - 9 * DAY), updatedAt: iso(now - DAY), copyCount: 3, lastCopiedAt: null },
    { id: 'prompt-1', title: '英訳', categoryName: '翻訳', body: '次の文を英語にしてください。', createdAt: iso(now - 8 * DAY), updatedAt: iso(now - 2 * DAY), copyCount: 1, lastCopiedAt: null }
  ];
  return {
    activeTab: 'links', query: '', currentProject: 'ALL', currentPromptCategory: 'ALL', onlyFavorites: false,
    linkSort: 'recent', promptSort: 'popular', viewMode: 'rich', linkPage: 1, promptPage: 1, linkPerPage: 'all', promptPerPage: '10',
    items, projects: DRAWERS, projectColors: {}, promptMemos, promptCategories: ['要約', '翻訳']
  };
}

/* ---------- ページの準備 ---------- */
async function open(browser, viewport, extra = {}, path = '') {
  const context = await browser.newContext({ viewport, locale: 'ja-JP', timezoneId: 'Asia/Tokyo', ...extra });
  const origin = new URL(BASE_URL).origin;
  // 外への通信はすべて止める(ページ情報の取得は失敗扱いになるが、この確認は取得結果に依存しない)
  await context.route(u => u.origin !== origin, route => route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ key, value }) => { localStorage.clear(); localStorage.setItem(key, JSON.stringify(value)); }, { key: KEY, value: fixture() });
  await page.goto(new URL(path, BASE_URL).href, { waitUntil: 'domcontentloaded' });
  await page.locator('#deckTrack .card, .card-end').first().waitFor({ state: 'attached', timeout: 15000 });
  return { context, page, errors };
}
const mobile = { isMobile: true, hasTouch: true };
const stored = page => page.evaluate(key => JSON.parse(localStorage.getItem(key) || '{}'), KEY);
const itemOf = async (page, url) => (await stored(page)).items.find(x => x.url === url);
const box = (page, sel) => page.locator(sel).first().evaluate(el => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; });
const active = page => page.evaluate(() => ({ id: document.activeElement?.id || '', tag: document.activeElement?.tagName || '', cls: document.activeElement?.className || '' }));
const closeAll = page => page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
async function keyboardUp(page) { await page.setViewportSize(KB); await page.waitForTimeout(300); }
async function openAdd(page) { await page.locator('#bottomAdd:visible, #addButton:visible').first().click(); await page.locator('#linkSheet[open]').waitFor(); }
async function openEditFirst(page) {
  await page.locator('#lib .item .item-more').first().click();
  await page.locator('#detailSheet [data-act="edit"]').click();
  await page.locator('#linkSheet[open]').waitFor();
}
// エンジンは1つずつ起動して必ず閉じる(失敗した確認でブラウザーが残ると、node が終わらない)
async function eachEngine(fn) {
  for (const [name, launcher] of [['chromium', chromium], ['webkit', webkit]]) {
    let browser;
    try { browser = await launcher.launch({ headless: true }); }
    catch { SKIPPED.push(`${name}が入っていないため、その確認を省きました`); continue; }
    try { await fn(browser, name); } finally { await browser.close(); }
  }
}

/* ---------- 確認項目 ---------- */
const SKIPPED = [];
const check = (phase, name, fn) => ({ phase, name, fn });
const checks = [
  // P1 守「画面は、動かない」
  check('P1', 'ダブルタップ拡大を止める(html・dialogがtouch-action:manipulation)。横向きの文字の自動拡大も止める', async () => {
    await eachEngine(async (b, name) => {
      const { page, context } = await open(b, SE, mobile);
      const s = await page.evaluate(() => ({ html: getComputedStyle(document.documentElement).touchAction, dialog: getComputedStyle(document.querySelector('#linkSheet')).touchAction, adjust: getComputedStyle(document.documentElement).webkitTextSizeAdjust || getComputedStyle(document.documentElement).textSizeAdjust }));
      assert.equal(s.html, 'manipulation', `${name}: html ${s.html}`);
      assert.equal(s.dialog, 'manipulation', `${name}: dialog ${s.dialog}`);
      // 文字の自動拡大の指定は、手元のWebKit(Windows版)では読み出せないため、Chromiumで確かめる
      if (name === 'chromium') assert.match(String(s.adjust), /100%/, `${name}: text-size-adjust ${s.adjust}`);
      await context.close();
    });
  }),
  check('P1', 'ピンチ拡大は残す(viewportで拡大を禁止しない)', async b => {
    const { page, context } = await open(b, SE);
    const v = await page.evaluate(() => document.querySelector('meta[name="viewport"]').content);
    assert.doesNotMatch(v, /maximum-scale|user-scalable\s*=\s*(no|0)/i, `viewport: ${v}`); await context.close();
  }),
  check('P1', 'iPhone SE:これから増える欄も16px以上になる(13pxを指定した欄を足しても16px)', async b => {
    const { page, context } = await open(b, SE, mobile);
    const px = await page.evaluate(() => {
      const box = document.createElement('div');
      box.innerHTML = '<input id="qaSmall" style="font-size:13px"><textarea id="qaSmallTa" class="quick-sync-pair"></textarea><select id="qaSmallSel" style="font-size:12px"><option>a</option></select>';
      document.body.append(box);
      return ['qaSmall', 'qaSmallTa', 'qaSmallSel'].map(id => parseFloat(getComputedStyle(document.getElementById(id)).fontSize));
    });
    assert.ok(px.every(x => x >= 16), `文字の大きさ ${px.join(', ')}`); await context.close();
  }),
  check('P1', 'iPhone SE:文字を打てる欄はすべて16px以上(保存・編集・プロンプト・探す・管理)', async b => {
    const { page, context } = await open(b, SE, mobile);
    const smallFields = where => page.evaluate(where => [...document.querySelectorAll('input, textarea, select')]
      .filter(el => el.getClientRects().length && !['checkbox', 'radio', 'hidden'].includes(el.type) && !el.readOnly)
      .map(el => ({ f: `${where}:${el.id || el.className}`, px: parseFloat(getComputedStyle(el).fontSize) }))
      .filter(x => x.px < 16).map(x => `${x.f} ${x.px}px`), where);
    const small = [];
    await openAdd(page); small.push(...await smallFields('保存')); await closeAll(page);
    await openEditFirst(page); small.push(...await smallFields('編集')); await closeAll(page);
    await page.locator('#searchOpen').click(); small.push(...await smallFields('探す')); await closeAll(page);
    await page.locator('#seg [data-seg="prompts"]').click(); await page.locator('#promptAddButton').click(); await page.locator('#promptSheet[open]').waitFor();
    small.push(...await smallFields('プロンプト')); await closeAll(page);
    await page.locator('#manageButton').click(); await page.locator('#importText').waitFor();
    small.push(...await smallFields('管理'));
    assert.deepEqual(small, [], `16px未満の欄: ${small.join(', ')}`); await context.close();
  }),
  check('P1', 'スマホ:詳細・編集・プロンプトの編集を開くと、最初のフォーカスは見出し(閉じるボタンに枠が出ない・キーボードを出さない)', async () => {
    await eachEngine(async (b, name) => {
      const { page, context } = await open(b, SE, mobile);
      await page.locator('#deckTrack .card [data-more]').first().click(); await page.locator('#detailSheet[open]').waitFor();
      assert.equal((await active(page)).id, 'detailSheetTitle', `${name}: 詳細 ${JSON.stringify(await active(page))}`);
      await page.locator('#detailSheet [data-act="edit"]').click(); await page.locator('#linkSheet[open]').waitFor();
      assert.equal((await active(page)).id, 'linkSheetTitle', `${name}: 編集 ${JSON.stringify(await active(page))}`);
      await closeAll(page);
      await page.locator('#seg [data-seg="prompts"]').click();
      await page.locator('#promptList .row-main').first().click(); await page.locator('#detailSheet[open]').waitFor();
      await page.locator('#detailSheet [data-pedit]').click(); await page.locator('#promptSheet[open]').waitFor();
      assert.equal((await active(page)).id, 'promptSheetTitle', `${name}: プロンプトの編集 ${JSON.stringify(await active(page))}`);
      await context.close();
    });
  }),
  check('P1', 'スマホ:＋はこれまでどおりURL欄から打てる', async b => {
    const { page, context } = await open(b, SE, mobile);
    await openAdd(page);
    assert.equal((await active(page)).id, 'fUrl'); await context.close();
  }),
  check('P1', 'キーボード相当(375×300):短いシートでも中でスクロールでき、文書ごと動かない', async () => {
    await eachEngine(async (b, name) => {
      const { page, context } = await open(b, SE);
      await page.locator('#seg [data-seg="prompts"]').click(); await page.locator('#promptAddButton').click(); await page.locator('#promptSheet[open]').waitFor();
      await page.locator('#pTitle').focus();
      await keyboardUp(page);
      const m = await page.evaluate(() => { const s = document.querySelector('#promptSheet .sheet-body'); return { kb: document.documentElement.classList.contains('keyboard-open'), sh: s.scrollHeight, ch: s.clientHeight }; });
      assert.equal(m.kb, true, `${name}: キーボードが出た扱いにならない`);
      assert.ok(m.sh > m.ch + 80, `${name}: 中でスクロールできる余地がない(${m.sh} / ${m.ch})`);
      await context.close();
    });
  }),
  check('P1', 'スマホ:保存しても見ている引き出しと位置は動かない(知らせと光で伝える)', async b => {
    const { page, context } = await open(b, SE, mobile);
    await page.locator('#chips [data-drawer="あとで読む"]').click();
    await page.locator('#center').evaluate(el => { el.scrollTop = 200; });
    const before = await page.locator('#center').evaluate(el => el.scrollTop);
    await page.locator('#searchOpen').click(); await page.locator('#mSearchInput').fill(NEW_URL('stay'));
    await page.locator('.hand-drawers [data-url-save-to="しごと"]').click();
    await page.waitForFunction(() => !document.querySelector('#searchSheet').open, null, { timeout: 3000 });
    await page.waitForTimeout(200);
    assert.equal((await itemOf(page, NEW_URL('stay')))?.projectName, 'しごと');
    assert.equal(await page.locator('#chips [aria-pressed="true"]').getAttribute('data-drawer'), 'あとで読む', '保存で引き出しが切り替わった');
    const after = await page.locator('#center').evaluate(el => el.scrollTop);
    assert.ok(Math.abs(after - before) <= 2, `一覧が動いた(${before} → ${after})`);
    assert.match(await page.locator('#toast').innerText(), /「しごと」/); await context.close();
  }),
  check('P1', '?vv を付けたときだけ、拡大と位置の数字の窓が出る', async b => {
    const a = await open(b, SE, mobile);
    assert.equal(await a.page.locator('#vvProbe').count(), 0, '?vvなしで窓が出た'); await a.context.close();
    const v = await open(b, SE, mobile, '?vv');
    await v.page.locator('#vvProbe').waitFor();
    assert.match(await v.page.locator('#vvProbe').innerText(), /倍率 1\.00/); await v.context.close();
  })
];

const browser = await chromium.launch({ headless: true });
const results = []; let failed = 0;
try {
  for (const c of checks.filter(c => PHASES.has(c.phase))) {
    try { await c.fn(browser); results.push(`PASS ${c.phase} ${c.name}`); }
    catch (e) { failed++; results.push(`FAIL ${c.phase} ${c.name}\n     ${String(e.message).split('\n')[0]}`); }
  }
} finally { await browser.close(); }
console.log(results.join('\n'));
if (SKIPPED.length) console.log('\n' + [...new Set(SKIPPED)].map(x => 'SKIP ' + x).join('\n'));
console.log(`\n${results.length - failed} / ${results.length} 合格`);
process.exit(failed ? 1 : 0);
