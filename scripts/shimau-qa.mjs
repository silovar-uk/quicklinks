// 受け入れ確認「揺らさずに、仕舞う」(＋から、キーボードを呼ばずに貼って、押すだけで引き出しに入る)
// 使い方:
//   手元     : LOCAL_URL=http://127.0.0.1:4173/ node scripts/shimau-qa.mjs
//   公開後   : LOCAL_URL=https://silovar-uk.github.io/quicklinks/ node scripts/shimau-qa.mjs(新しいブラウザー環境で動くため、実データや同期には触れない)
//   段階を絞る: QA_PHASES=P1,P2(既定は P1,P2,P3,P4)
// iOSの拡大・キーボード・日本語の確定・「ペースト」の吹き出しは、Playwrightでは再現しない。代わりに次で確かめる。
//   拡大       … iPhoneのUAでだけ viewport に maximum-scale=1 が入ること(ピンチはiOSが残す)
//   キーボード … フォーカスが入力欄に入らないこと(=キーボードを呼ばない)。名前のカードの欄が画面の上半分(300px以内)にあること
//   ペースト   … navigator.clipboard.readText を差し替え、＋を押した処理の中で呼ばれること
import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';

const BASE_URL = process.env.LOCAL_URL || 'http://127.0.0.1:4173/';
const PHASES = new Set((process.env.QA_PHASES || 'P1,P2,P3,P4').split(','));
const KEY = 'quick-links-mobile-localstorage-v1';
const SE = { width: 375, height: 667 };
const PC = { width: 1366, height: 633 };
const DAY = 864e5;
const NEW_URL = n => `https://qa-shimau.test/new/${n}`;
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';

/* ---------- 架空データ(保存形式どおり)。引き出しは20個。いちばん新しい保存は「しごと」、次が「まなび」 ---------- */
const DRAWERS = ['しごと', 'まなび', 'ときめき', 'あとで読む', 'ごはん', 'AIツール', 'AI記事', '音楽', '旅行', '買い物', '健康', 'デザイン', '写真', '本', '映画', 'ゲーム', 'お店', '道具', '言葉', '未分類'];
function fixture() {
  const now = Date.now();
  const iso = t => new Date(t).toISOString();
  const items = Array.from({ length: 60 }, (_, i) => ({
    id: 'link-' + i, title: `架空の記事 ${i + 1}`, url: `https://qa-shimau.test/a/${i}`,
    projectName: i < 8 ? 'しごと' : DRAWERS[i % DRAWERS.length], description: '', descriptionSource: '', descriptionUpdatedAt: null, note: '',
    addedAt: iso(now - i * DAY), updatedAt: iso(now - i * DAY), lastClickedAt: null, clickCount: 0, clickHistory: [],
    archived: false, isFavorite: false, favoriteType: 'none', favoriteExpiry: null
  }));
  items[1].projectName = 'まなび';
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
// clip:クリップボードの中身(文字列)か、'deny'(「ペースト」を押さなかった)。指定すると navigator.clipboard.readText を差し替える
async function open(browser, viewport, extra = {}, { path = '', clip } = {}) {
  const { clip: _c, ...ctx } = extra;
  const context = await browser.newContext({ viewport, locale: 'ja-JP', timezoneId: 'Asia/Tokyo', ...ctx });
  const origin = new URL(BASE_URL).origin;
  // 外への通信はすべて止める(ページ情報の取得だけは、少し待ってから架空の題名を返す)
  await context.route(u => u.origin !== origin, route => {
    const u = route.request().url();
    if (u.includes('/v1/metadata')) return setTimeout(() => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ status: 'success', data: { url: new URL(u).searchParams.get('url'), title: '架空のページの題名', description: '架空のページの説明です。' } }) }).catch(() => {}), 300);
    return route.abort();
  });
  if (clip !== undefined) {
    await context.addInitScript(c => {
      window.__qaClipCalls = [];
      const fake = () => { window.__qaClipCalls.push({ t: performance.now(), inClick: !!window.__qaInClick }); return c === 'deny' ? Promise.reject(new DOMException('not allowed', 'NotAllowedError')) : Promise.resolve(c); };
      try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: fake, writeText: () => Promise.resolve() } }); } catch { /* 差し替えられない環境 */ }
      // ＋を押した処理の中で呼ばれたかを見る(クリックの処理中だけ印を立てる)
      document.addEventListener('click', () => { window.__qaInClick = true; queueMicrotask(() => { window.__qaInClick = false; }); }, true);
    }, clip);
  }
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
const itemsOf = async (page, url) => (await stored(page)).items.filter(x => x.url === url);
const box = (page, sel) => page.locator(sel).first().evaluate(el => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; });
const active = page => page.evaluate(() => ({ id: document.activeElement?.id || '', tag: document.activeElement?.tagName || '' }));
const typing = async page => ['INPUT', 'TEXTAREA', 'SELECT'].includes((await active(page)).tag);
const closeAll = page => page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
async function openAdd(page) { await page.locator('#bottomAdd:visible, #addButton:visible').first().click(); await page.locator('#linkSheet[open]').waitFor(); }
async function pasteUrl(page, url) { await page.locator('#fUrl').fill(url); await page.locator('#fUrl').press('Enter'); }
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
  // P1 守「キーボードを、呼ばない」
  check('P1', 'iPhoneのSafariでだけ、入力欄での自動拡大を止める(viewportに maximum-scale=1)。Androidとパソコンには入れない', async () => {
    const ua = async (b, userAgent, extra = {}) => { const c = await b.newContext({ viewport: SE, ...(userAgent ? { userAgent } : {}), ...extra }); const p = await c.newPage(); await p.goto(BASE_URL, { waitUntil: 'domcontentloaded' }); const v = await p.evaluate(() => document.querySelector('meta[name="viewport"]').content); await c.close(); return v; };
    const wk = await webkit.launch(); const ch = await chromium.launch();
    try {
      assert.match(await ua(wk, IPHONE_UA, mobile), /maximum-scale=1/, 'iPhoneで自動拡大が止まらない');
      assert.doesNotMatch(await ua(ch, ANDROID_UA, mobile), /maximum-scale/, 'Androidでピンチ拡大まで止めた');
      assert.doesNotMatch(await ua(ch, ''), /maximum-scale/, 'パソコンで拡大を止めた');
    } finally { await wk.close(); await ch.close(); }
  }),
  check('P1', 'スマホ:＋ではキーボードを呼ばない。「コピーしたURLを貼る」が大きく出る(44px以上)', async () => {
    await eachEngine(async (b, name) => {
      const { page, context } = await open(b, SE, mobile);
      await openAdd(page);
      assert.equal(await typing(page), false, `${name}: ＋で ${(await active(page)).id} にフォーカスが入る`);
      assert.equal(await page.locator('#fPaste').innerText(), 'コピーしたURLを貼る', `${name}: 貼るボタンの文言`);
      assert.ok((await box(page, '#fPaste')).height >= 44, `${name}: 貼るボタンが小さい`);
      await context.close();
    });
  }),
  check('P1', 'スマホ:URLを入れて取得が進んでも、下の引き出しの欄は1pxも動かない(URLの欄とページの札は同じ場所に入れ替わる)', async () => {
    await eachEngine(async (b, name) => {
      const { page, context } = await open(b, SE, mobile);
      await openAdd(page);
      const before = await box(page, '#fCatField');
      await pasteUrl(page, NEW_URL('slot-' + name));
      await page.locator('#fStatus:not([hidden])').waitFor();
      const busy = await box(page, '#fCatField');
      await page.locator('#fStatus.ok, #fStatus.bad, #fStatus.warn').waitFor({ timeout: 15000 });
      const done = await box(page, '#fCatField');
      assert.equal(await page.locator('#fUrlField').isVisible(), false, `${name}: URL欄がたたまれない`);
      assert.ok([busy, done].every(x => Math.abs(x.top - before.top) <= 1), `${name}: 引き出しの欄が動いた ${Math.round(before.top)} → ${Math.round(busy.top)} → ${Math.round(done.top)}`);
      assert.equal(await typing(page), false, `${name}: Enterのあともキーボードが残る`);
      await context.close();
    });
  }),
  check('P1', 'シートは開くたびに先頭から見える(前回スクロールした位置のまま開かない)', async () => {
    await eachEngine(async (b, name) => {
      const { page, context } = await open(b, SE, mobile);
      await openEditFirst(page);
      await page.locator('#linkSheet .sheet-body').evaluate(el => { el.scrollTop = el.scrollHeight; });
      assert.ok(await page.locator('#linkSheet .sheet-body').evaluate(el => el.scrollTop) > 0, `${name}: スクロールできる長さがない`);
      await closeAll(page);
      await openEditFirst(page);
      assert.equal(await page.locator('#linkSheet .sheet-body').evaluate(el => el.scrollTop), 0, `${name}: 前回の位置のまま開いた`);
      await context.close();
    });
  }),
  check('P1', 'スマホ:一覧を下まで見ているときに保存しても、見ていたカードは同じ高さに残る(上に増えても押し下げない)', async () => {
    await eachEngine(async (b, name) => {
      const { page, context } = await open(b, SE, mobile);
      await page.locator('#center').evaluate(el => { el.scrollTop = 1500; });
      await page.waitForTimeout(100);
      const firstVisible = () => page.evaluate(() => { const top = document.querySelector('#center').getBoundingClientRect().top; const el = [...document.querySelectorAll('#lib .item')].find(x => x.getBoundingClientRect().bottom > top); return { id: el.id, top: el.getBoundingClientRect().top }; });
      const before = await firstVisible();
      await page.locator('#searchOpen').click(); await page.locator('#mSearchInput').fill(NEW_URL('keep-' + name));
      await page.locator('.hand-drawers [data-url-save-to="まなび"]').click();
      await page.waitForFunction(() => !document.querySelector('#searchSheet').open, null, { timeout: 3000 });
      await page.waitForTimeout(150);
      const after = await page.evaluate(id => document.getElementById(id).getBoundingClientRect().top, before.id);
      assert.equal((await itemsOf(page, NEW_URL('keep-' + name))).length, 1, `${name}: 保存されない`);
      assert.ok(Math.abs(after - before.top) <= 2, `${name}: 見ていたカードが動いた(${Math.round(before.top)} → ${Math.round(after)})`);
      await context.close();
    });
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
