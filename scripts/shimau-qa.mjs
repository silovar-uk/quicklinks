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
  }),

  // P2 守「新しい引き出しは、＋の札から」
  check('P2', 'スマホ:打つ欄は出さず、札を3列で全部並べる。先頭は「＋ 新しい引き出し」、続いて最近使った順、未分類は最後', async () => {
    await eachEngine(async (b, name) => {
      const { page, context } = await open(b, SE, mobile);
      await openAdd(page); await pasteUrl(page, NEW_URL('tiles-' + name));
      assert.equal(await page.locator('#fCat').isVisible(), false, `${name}: 名前の欄が出ている`);
      assert.equal(await page.locator('#fCatAll').isVisible(), false, `${name}: 「すべて」が出ている`);
      const tiles = await page.locator('#fTags .tag:visible').evaluateAll(els => els.map(el => el.hasAttribute('data-add') ? '＋' : el.dataset.name));
      assert.equal(tiles.length, DRAWERS.length + 1, `${name}: 並んだ札 ${tiles.length}`);
      assert.deepEqual(tiles.slice(0, 3), ['＋', 'しごと', 'まなび'], `${name}: 並び ${tiles.slice(0, 3)}`);
      assert.equal(tiles.at(-1), '未分類', `${name}: 未分類が最後にない`);
      const cols = await page.locator('#fTags').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
      assert.equal(cols, 3, `${name}: ${cols}列`);
      const small = await page.locator('#fTags .tag:visible').evaluateAll(els => els.filter(el => el.getBoundingClientRect().height < 44).length);
      assert.equal(small, 0, `${name}: 44pxより低い札が${small}個`);
      await context.close();
    });
  }),
  check('P2', 'スマホ:札は引き出しの色の地で見分けられる(名前から決まる色)', async b => {
    const { page, context } = await open(b, SE, mobile);
    await openAdd(page);
    const r = await page.locator('#fTags [data-name="まなび"]').evaluate(el => { const d = document.createElement('span'); d.style.color = getProjectColor('まなび').bg; document.body.append(d); const want = getComputedStyle(d).color; d.remove(); return { got: getComputedStyle(el).backgroundColor, want }; });
    assert.equal(r.got, r.want); await context.close();
  }),
  check('P2', 'スマホ:「＋ 新しい引き出し」で名前のカードが画面の上に開き、そのまま打てる(欄は上から300px以内・16px以上)', async () => {
    await eachEngine(async (b, name) => {
      const { page, context } = await open(b, SE, mobile);
      await openAdd(page); await pasteUrl(page, NEW_URL('name-' + name));
      await page.locator('#fTags [data-add]').click();
      await page.locator('#nameSheet[open]').waitFor();
      assert.equal((await active(page)).id, 'nName', `${name}: 名前の欄にフォーカスが入らない`);
      const r = await box(page, '#nName');
      assert.ok(r.bottom <= 300, `${name}: 欄が低い(${Math.round(r.top)}〜${Math.round(r.bottom)})`);
      assert.ok(await page.locator('#nName').evaluate(el => parseFloat(getComputedStyle(el).fontSize)) >= 16, `${name}: 16px未満`);
      await page.setViewportSize({ width: 375, height: 300 }); await page.waitForTimeout(300);
      // 似た名前と色見本が出ている、いちばん背の高い状態でも、決めるボタンが見える
      await page.locator('#nName').fill('AI'); await page.waitForTimeout(100);
      const ok = await box(page, '#nOk');
      assert.ok(ok.top >= 0 && ok.bottom <= 300, `${name}: キーボード相当で決めるボタンが隠れる(${Math.round(ok.top)}〜${Math.round(ok.bottom)})`);
      await context.close();
    });
  }),
  // 名前のカードの確認は、選んでから保存する編集で見る(新規はP3から押せば保存になるため)
  check('P2', '名前を書くと、その色の札が先に見える。似た名前(含む・含まれる)があれば先に示し、押せばそれを使う', async b => {
    const { page, context } = await open(b, SE, mobile);
    await openEditFirst(page);
    await page.locator('#fTags [data-add]').click(); await page.locator('#nName').fill('AI');
    assert.match(await page.locator('#nPreview').innerText(), /AI[\s\S]*新しく作る/);
    const like = await page.locator('#nLikeTags [data-like]').evaluateAll(els => els.map(el => el.dataset.like));
    assert.deepEqual(like.sort(), ['AIツール', 'AI記事'], `似た名前 ${like}`);
    assert.equal(await page.locator('#nOk').innerText(), '「AI」を作る');
    await page.locator('#nLikeTags [data-like="AI記事"]').click();
    assert.equal(await page.evaluate(() => document.querySelector('#nameSheet').open), false, 'カードが閉じない');
    assert.equal(await page.evaluate(() => F.cat), 'AI記事'); await context.close();
  }),
  check('P2', 'かな・カナ・空白の違いは同じ名前とみなす(「シゴト」→ すでにある「しごと」を使う)', async b => {
    const { page, context } = await open(b, SE, mobile);
    await openEditFirst(page);
    await page.locator('#fTags [data-add]').click(); await page.locator('#nName').fill('シゴト');
    assert.match(await page.locator('#nPreview').innerText(), /しごと[\s\S]*すでにあります/);
    assert.equal(await page.locator('#nOk').innerText(), '「しごと」を選ぶ');
    await page.locator('#nName').press('Enter');
    assert.equal(await page.evaluate(() => F.cat), 'しごと');
    assert.equal(await page.evaluate(() => organizerConfig.links.names().includes('シゴト')), false, '似た引き出しが増えた'); await context.close();
  }),
  check('P2', '変換を確定するEnter(keyCode 229)では決めない。もう一度のEnterで決まり、生まれた札が「＋」の次に選ばれて出る', async () => {
    await eachEngine(async (b, name) => {
      const { page, context } = await open(b, SE, mobile);
      await openEditFirst(page);
      await page.locator('#fTags [data-add]').click(); await page.locator('#nName').fill('へんかん');
      await page.locator('#nName').evaluate(el => { const e = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }); Object.defineProperty(e, 'keyCode', { get: () => 229 }); el.dispatchEvent(e); });
      assert.equal(await page.evaluate(() => document.querySelector('#nameSheet').open), true, `${name}: 確定のEnterで決まった`);
      await page.locator('#nName').press('Enter');
      assert.equal(await page.evaluate(() => document.querySelector('#nameSheet').open), false, `${name}: Enterで決まらない`);
      assert.equal(await typing(page), false, `${name}: 決めたあともキーボードが残る`);
      const second = page.locator('#fTags .tag:visible').nth(1);
      assert.equal(await second.getAttribute('data-name'), 'へんかん', `${name}: 生まれた札が「＋」の次にない`);
      assert.equal(await second.getAttribute('aria-selected'), 'true', `${name}: 選ばれていない`);
      assert.equal(await second.evaluate(el => el.classList.contains('is-born')), true, `${name}: 生まれる動きがない`);
      await context.close();
    });
  }),
  check('P2', 'スマホの編集:いまの引き出しが「＋」の次に選ばれて見え、「＋」から作った引き出しで保存できる', async b => {
    const { page, context } = await open(b, SE, mobile);
    await openEditFirst(page);
    const id = await page.evaluate(() => F.id);
    const cur = (await stored(page)).items.find(x => x.id === id).projectName;
    const second = page.locator('#fTags .tag:visible').nth(1);
    assert.equal(await second.getAttribute('data-name'), cur); assert.equal(await second.getAttribute('aria-selected'), 'true');
    await page.locator('#fTags [data-add]').click(); await page.locator('#nName').fill('編集で作った'); await page.locator('#nName').press('Enter');
    await page.locator('#fSave').click();
    await page.waitForFunction(() => !document.querySelector('#linkSheet').open, null, { timeout: 3000 });
    assert.equal((await stored(page)).items.find(x => x.id === id).projectName, '編集で作った'); await context.close();
  }),
  check('P2', 'スマホのプロンプト:カテゴリも同じ札と名前のカードで作れる', async b => {
    const { page, context } = await open(b, SE, mobile);
    await page.locator('#seg [data-seg="prompts"]').click(); await page.locator('#promptAddButton').click(); await page.locator('#promptSheet[open]').waitFor();
    assert.equal(await page.locator('#pTags [data-add]').innerText(), '＋ 新しいカテゴリ');
    await page.locator('#pTags [data-add]').click(); await page.locator('#nName').fill('しらべもの'); await page.locator('#nName').press('Enter');
    await page.locator('#pTitle').fill('QAのプロンプト'); await page.locator('#pBody').fill('本文');
    await page.locator('#pSave').click();
    assert.equal((await stored(page)).promptMemos.find(x => x.title === 'QAのプロンプト')?.categoryName, 'しらべもの'); await context.close();
  }),
  check('P2', 'スマホの掛け替え:「＋」から新しい引き出しを作ると、すぐ掛け替わる。元に戻すと空の引き出しも片づく', async b => {
    const { page, context } = await open(b, SE, mobile);
    const card = page.locator('#deckTrack .card.is-current');
    const id = await card.getAttribute('data-id');
    await card.locator('[data-refile]').click(); await page.locator('#refileSheet[open]').waitFor();
    await page.locator('#rTags [data-add]').click();
    assert.equal(await page.locator('#nOk').innerText(), '作る');
    await page.locator('#nName').fill('掛け替え先'); assert.equal(await page.locator('#nOk').innerText(), '「掛け替え先」を作って掛け替える');
    await page.locator('#nOk').click();
    await page.waitForFunction(() => !document.querySelector('#refileSheet').open, null, { timeout: 3000 });
    assert.equal((await stored(page)).items.find(x => x.id === id).projectName, '掛け替え先');
    assert.match(await page.locator('#toast').innerText(), /新しい引き出し「掛け替え先」へ掛け替えました/);
    await page.locator('#toast button').click();
    assert.equal((await stored(page)).projects.includes('掛け替え先'), false, '空の引き出しが残った'); await context.close();
  }),
  check('P2', 'PCは今までどおり:名前の欄に打って選ぶ。「＋ 新しい引き出し」の札は出さない', async b => {
    const { page, context } = await open(b, PC);
    await openAdd(page);
    assert.equal(await page.locator('#fCat').isVisible(), true, 'PCで名前の欄がない');
    assert.equal(await page.locator('#fTags [data-add]').isVisible(), false, 'PCで「＋」の札が出る'); await context.close();
  }),

  // P3 破「押せば、入る」
  check('P3', 'スマホの新規:保存ボタンはなく、札を押すとページの札がそこへ飛び込み、1件だけ保存される。知らせは「「◯◯」に入れました」と「変える」', async () => {
    await eachEngine(async (b, name) => {
      const { page, context } = await open(b, SE, mobile);
      const url = NEW_URL('press-' + name);
      await openAdd(page); await pasteUrl(page, url);
      await page.locator('#fStatus.ok').waitFor({ timeout: 15000 });
      assert.equal(await page.locator('#fSave').isVisible(), false, `${name}: 保存ボタンが出ている`);
      assert.match(await page.locator('#fCatField .lab').innerText(), /押すと、そこへ保存/, `${name}: 押せば保存と分からない`);
      await page.locator('#fTags [data-name="まなび"]').click();
      const flying = await page.evaluate(() => document.querySelector('#fPage').getAnimations().length);
      assert.ok(flying > 0, `${name}: 飛び込む動きがない`);
      await page.waitForFunction(() => !document.querySelector('#linkSheet').open, null, { timeout: 3000 });
      const saved = await itemsOf(page, url);
      assert.equal(saved.length, 1, `${name}: 保存件数 ${saved.length}`); assert.equal(saved[0].projectName, 'まなび');
      assert.equal(saved[0].title, '架空のページの題名', `${name}: 取得した題名で保存されない`);
      assert.match(await page.locator('#toast').innerText(), /「まなび」に入れました[\s\S]*変える/);
      await context.close();
    });
  }),
  check('P3', '二度押ししても1件だけ。飛んでいるあいだに別の札を押しても、最初に押した引き出しに入る', async b => {
    const { page, context } = await open(b, SE, mobile);
    const url = NEW_URL('twice'), url2 = NEW_URL('race');
    await openAdd(page); await pasteUrl(page, url);
    await page.locator('#fTags [data-name="まなび"]').dblclick();
    await page.waitForFunction(() => !document.querySelector('#linkSheet').open, null, { timeout: 3000 });
    await page.waitForTimeout(400);
    assert.equal((await itemsOf(page, url)).length, 1, '二度押しで2件入った');
    await openAdd(page); await pasteUrl(page, url2);
    await page.evaluate(() => { document.querySelector('#fTags [data-name="まなび"]').click(); document.querySelector('#fTags [data-name="ごはん"]').click(); });
    await page.waitForFunction(() => !document.querySelector('#linkSheet').open, null, { timeout: 3000 });
    const saved = await itemsOf(page, url2);
    assert.equal(saved.length, 1); assert.equal(saved[0].projectName, 'まなび', `あとから押した札に入った(${saved[0].projectName})`); await context.close();
  }),
  check('P3', 'URLがまだないと札は薄く、押しても保存しない(貼る場所を示し、キーボードは出さない)', async b => {
    const { page, context } = await open(b, SE, mobile);
    await openAdd(page);
    assert.ok(await page.locator('#fTags [data-name="まなび"]').evaluate(el => parseFloat(getComputedStyle(el).opacity)) < 0.6, '札が薄くならない');
    const before = (await stored(page)).items.length;
    await page.locator('#fTags [data-name="まなび"]').click();
    assert.equal((await stored(page)).items.length, before, 'URLなしで保存された');
    assert.equal(await page.evaluate(() => document.querySelector('#linkSheet').open), true, 'シートが閉じた');
    assert.equal(await typing(page), false, 'キーボードを出した');
    assert.match(await page.locator('#toast').innerText(), /先にURLを貼ってください/);
    await page.locator('#fTags [data-add]').click();
    assert.equal(await page.evaluate(() => document.querySelector('#nameSheet').open), false, 'URLなしで名前のカードが開いた'); await context.close();
  }),
  check('P3', '「＋」で書いた新しい引き出しに、そのまま入る。知らせは「新しい引き出し「◯◯」に入れました」、上の列の先頭で光る', async () => {
    await eachEngine(async (b, name) => {
      const { page, context } = await open(b, SE, mobile);
      const url = NEW_URL('born-' + name);
      await openAdd(page); await pasteUrl(page, url);
      await page.locator('#fTags [data-add]').click(); await page.locator('#nName').fill('はじめての棚');
      assert.equal(await page.locator('#nOk').innerText(), '「はじめての棚」を作って入れる', `${name}: ボタンの文言`);
      await page.locator('#nName').press('Enter');
      await page.waitForFunction(() => !document.querySelector('#linkSheet').open, null, { timeout: 3000 });
      assert.equal((await itemsOf(page, url))[0]?.projectName, 'はじめての棚', `${name}: 保存先`);
      assert.match(await page.locator('#toast').innerText(), /新しい引き出し「はじめての棚」に入れました/);
      const first = page.locator('#chips [data-drawer]:not([data-drawer="ALL"]):not([data-drawer="UNOPENED"])').first();
      assert.equal(await first.getAttribute('data-drawer'), 'はじめての棚', `${name}: 列の先頭にない`);
      assert.equal(await first.evaluate(el => el.classList.contains('is-born')), true, `${name}: 光らない`);
      await context.close();
    });
  }),
  check('P3', '保存済みのURLなら、新しく足さずに押した引き出しへ掛け替える', async b => {
    const { page, context } = await open(b, SE, mobile);
    const url = 'https://qa-shimau.test/a/5';
    const before = (await itemsOf(page, url))[0];
    const to = before.projectName === 'ごはん' ? 'まなび' : 'ごはん';
    await openAdd(page); await pasteUrl(page, url);
    assert.match(await page.locator('#fDup').innerText(), /保存済み/);
    await page.locator(`#fTags [data-name="${to}"]`).click();
    await page.waitForFunction(() => !document.querySelector('#linkSheet').open, null, { timeout: 3000 });
    const after = await itemsOf(page, url);
    assert.equal(after.length, 1, '重ねて保存された'); assert.equal(after[0].projectName, to);
    assert.match(await page.locator('#toast').innerText(), new RegExp(`「${to}」へ掛け替えました`)); await context.close();
  }),
  check('P3', '動きを減らす設定では、飛び込まずにすぐ保存する', async b => {
    const { page, context } = await open(b, SE, { ...mobile, reducedMotion: 'reduce' });
    const url = NEW_URL('reduce');
    await openAdd(page); await pasteUrl(page, url);
    await page.locator('#fTags [data-name="まなび"]').click();
    assert.equal(await page.evaluate(() => document.querySelector('#linkSheet').open), false, 'すぐ閉じない');
    assert.equal((await itemsOf(page, url)).length, 1); await context.close();
  }),
  check('P3', '「変える」で掛け替えのシートが開く。次の＋では、ページの札が消えたままにならない', async b => {
    const { page, context } = await open(b, SE, mobile);
    const url = NEW_URL('change');
    await openAdd(page); await pasteUrl(page, url);
    await page.locator('#fTags [data-name="まなび"]').click();
    await page.waitForFunction(() => !document.querySelector('#linkSheet').open, null, { timeout: 3000 });
    await page.locator('#toast button').click();
    await page.locator('#refileSheet[open]').waitFor();
    assert.equal(await page.locator('#rTags [aria-selected="true"]').getAttribute('data-name'), 'まなび');
    await page.locator('#rTags [data-name="ごはん"]').click();
    assert.equal((await itemsOf(page, url))[0].projectName, 'ごはん');
    await openAdd(page); await pasteUrl(page, NEW_URL('again'));
    assert.equal(await page.locator('#fPage').evaluate(el => getComputedStyle(el).opacity), '1', '札が消えたまま'); await context.close();
  }),
  check('P3', '自分メモを書いてから札を押せば、メモごと保存される', async b => {
    const { page, context } = await open(b, SE, mobile);
    const url = NEW_URL('note');
    await openAdd(page); await pasteUrl(page, url);
    await page.locator('#fDetailsToggle').click(); await page.locator('#fNote').fill('あとで読む理由');
    await page.locator('#fTags [data-name="まなび"]').click();
    await page.waitForFunction(() => !document.querySelector('#linkSheet').open, null, { timeout: 3000 });
    assert.equal((await itemsOf(page, url))[0].note, 'あとで読む理由'); await context.close();
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
