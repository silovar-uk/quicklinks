// 受け入れ確認「寄らずに、寄り添う」(iPhone SEで入力しても画面が寄らず、入力が手元に来る)
// 使い方:
//   手元     : LOCAL_URL=http://127.0.0.1:4173/ node scripts/yoranai-qa.mjs
//   公開後   : LOCAL_URL=https://silovar-uk.github.io/quicklinks/ node scripts/yoranai-qa.mjs(新しいブラウザー環境で動くため、実データや同期には触れない)
//   段階を絞る: QA_PHASES=P1(既定は P1,P2,P3)
// iOS Safariの「16px未満の入力欄にフォーカスすると拡大する」挙動は、PlaywrightのChromium・WebKitでは再現しない。
// そのため「入力欄の文字が16px以上か」を拡大しない条件の代わりに確かめ、拡大されたときの外枠はChromiumのページ拡大で再現する。
// キーボードは「見える高さが375×300に縮む」ことで代用する(iPhone SEのSafariで日本語キーボードと入力補助バーが出たときの厳しめの値)。
import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';

const BASE_URL = process.env.LOCAL_URL || 'http://127.0.0.1:4173/';
const PHASES = new Set((process.env.QA_PHASES || 'P1,P2,P3').split(','));
const KEY = 'quick-links-mobile-localstorage-v1';
const SE = { width: 375, height: 667 };
const KB = { width: 375, height: 300 };
const PC = { width: 1366, height: 633 };
const DAY = 864e5;
const NEW_URL = n => `https://qa-yoranai.test/new/${n}`;

/* ---------- 架空データ(保存形式どおり)。いちばん新しい1件が「しごと」なので、最近の引き出しの先頭は「しごと」 ---------- */
function fixture() {
  const now = Date.now();
  const drawers = ['しごと', 'あとで読む', 'ときめき', 'まなび', 'ごはん'];
  const iso = t => new Date(t).toISOString();
  const items = Array.from({ length: 30 }, (_, i) => ({
    id: 'link-' + i, title: i === 7 ? '季節の炊き込みごはん12選' : `架空の記事 ${i + 1}`, url: `https://qa-yoranai.test/a/${i}`,
    projectName: drawers[i % drawers.length], description: '', descriptionSource: '', descriptionUpdatedAt: null, note: '',
    addedAt: iso(now - i * DAY), updatedAt: iso(now - i * DAY), lastClickedAt: null, clickCount: 0, clickHistory: [],
    archived: false, isFavorite: false, favoriteType: 'none', favoriteExpiry: null
  }));
  const promptMemos = [{ id: 'prompt-0', title: '記事要約', categoryName: '要約', body: '次の文章を3行で要約してください。', createdAt: iso(now - 9 * DAY), updatedAt: iso(now - DAY), copyCount: 3, lastCopiedAt: null }];
  return {
    activeTab: 'links', query: '', currentProject: 'ALL', currentPromptCategory: 'ALL', onlyFavorites: false,
    linkSort: 'recent', promptSort: 'popular', viewMode: 'rich', linkPage: 1, promptPage: 1, linkPerPage: 'all', promptPerPage: '10',
    items, projects: drawers, projectColors: {}, promptMemos, promptCategories: ['要約']
  };
}

/* ---------- ページの準備 ---------- */
async function open(browser, viewport, extra = {}) {
  const context = await browser.newContext({ viewport, locale: 'ja-JP', timezoneId: 'Asia/Tokyo', ...extra });
  const origin = new URL(BASE_URL).origin;
  // 外への通信はすべて止める(ページ情報の取得は失敗扱いになるが、この確認は取得結果に依存しない)
  await context.route(u => u.origin !== origin, route => route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ key, value }) => { localStorage.clear(); localStorage.setItem(key, JSON.stringify(value)); }, { key: KEY, value: fixture() });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#deckTrack .card, .card-end').first().waitFor({ state: 'attached', timeout: 15000 });
  return { context, page, errors };
}
const stored = page => page.evaluate(key => JSON.parse(localStorage.getItem(key) || '{}'), KEY);
const box = (page, sel) => page.locator(sel).first().evaluate(el => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; });
const active = page => page.evaluate(() => ({ id: document.activeElement?.id || '', tag: document.activeElement?.tagName || '' }));
const closeAll = page => page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
const kbOpen = page => page.evaluate(() => document.documentElement.classList.contains('keyboard-open'));
// 見えていて文字を打てる欄(チェックボックス・ラジオ・読み取り専用は除く)の文字サイズ
const smallFields = (page, where) => page.evaluate(where => [...document.querySelectorAll('input, textarea, select, [contenteditable="true"]')]
  .filter(el => el.getClientRects().length && !['checkbox', 'radio', 'hidden'].includes(el.type) && !el.readOnly)
  .map(el => ({ f: `${where}:${el.id || el.className}`, px: parseFloat(getComputedStyle(el).fontSize) }))
  .filter(x => x.px < 16).map(x => `${x.f} ${x.px}px`), where);
async function keyboardUp(page) { await page.setViewportSize(KB); await page.waitForTimeout(300); }
async function openHand(page) { await page.locator('#searchOpen').click(); await page.locator('#searchSheet[open]').waitFor(); }
async function engines() {
  const list = [['chromium', await chromium.launch({ headless: true })]];
  try { list.push(['webkit', await webkit.launch({ headless: true })]); } catch { SKIPPED.push('WebKitが入っていないため、キーボード相当の検査はChromiumだけで行いました'); }
  return list;
}
async function eachEngine(fn) {
  for (const [name, browser] of await engines()) {
    try { await fn(browser, name); } finally { await browser.close(); }
  }
}

/* ---------- 確認項目 ---------- */
const SKIPPED = [];
const check = (phase, name, fn) => ({ phase, name, fn });
const checks = [
  // P1 守「画面は寄らない」
  check('P1', 'iPhone SE:文字を打てる欄はすべて16px以上(保存・編集・プロンプト・探す・管理)', async b => {
    const { page, context } = await open(b, SE);
    const small = [];
    await page.locator('#bottomAdd').click(); await page.locator('#linkSheet[open]').waitFor();
    small.push(...await smallFields(page, '保存')); await closeAll(page);
    await page.locator('#lib .item .item-more').first().click(); await page.locator('#detailSheet [data-act="edit"]').click(); await page.locator('#linkSheet[open]').waitFor();
    small.push(...await smallFields(page, '編集')); await closeAll(page);
    await openHand(page); small.push(...await smallFields(page, '探す')); await closeAll(page);
    await page.locator('#seg [data-seg="prompts"]').click(); await page.locator('#promptAddButton').click(); await page.locator('#promptSheet[open]').waitFor();
    small.push(...await smallFields(page, 'プロンプト')); await closeAll(page);
    await page.locator('#manageButton').click(); await page.locator('#importText').waitFor();
    small.push(...await smallFields(page, '管理'));
    assert.deepEqual(small, [], `16px未満の欄: ${small.join(', ')}`); await context.close();
  }),
  check('P1', 'iPhone SE:画面が拡大されても外枠の高さは変わらない(寄ったままでも右端が切れない)', async b => {
    // ページ拡大はモバイル表示のChromiumでだけ再現できる
    const { page, context } = await open(b, SE, { isMobile: true, hasTouch: true });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 16 / 13 });
    await page.waitForTimeout(300);
    const m = await page.evaluate(() => ({ scale: visualViewport.scale, app: document.querySelector('#app').getBoundingClientRect().height, kb: document.documentElement.classList.contains('keyboard-open') }));
    assert.ok(m.scale > 1.2, `拡大を再現できていない(scale ${m.scale})`);
    assert.ok(Math.abs(m.app - SE.height) <= 1, `拡大につられて外枠が ${Math.round(m.app)}px に縮んだ`);
    assert.equal(m.kb, false, '拡大しただけでキーボードが出た扱いになった'); await context.close();
  }),
  check('P1', 'ピンチでの拡大は残す(viewportで拡大を禁止しない)', async b => {
    const { page, context } = await open(b, SE);
    const v = await page.evaluate(() => document.querySelector('meta[name="viewport"]').content);
    assert.doesNotMatch(v, /maximum-scale|user-scalable\s*=\s*(no|0)/i, `viewport: ${v}`); await context.close();
  }),
  check('P1', 'スマホ:＋はURL欄から打てる。URL入り・編集のシートはキーボードを勝手に出さない', async b => {
    const { page, context } = await open(b, SE);
    await page.locator('#bottomAdd').click(); await page.locator('#linkSheet[open]').waitFor();
    assert.equal((await active(page)).id, 'fUrl', '＋でURL欄にフォーカスが入らない'); await closeAll(page);
    await page.evaluate(u => { location.hash = '#save=' + encodeURIComponent(u); }, NEW_URL('shared'));
    await page.locator('#linkSheet[open]').waitFor();
    assert.ok(!['INPUT', 'TEXTAREA'].includes((await active(page)).tag), `共有から開くと ${(await active(page)).id} にフォーカスが入る`); await closeAll(page);
    await page.locator('#lib .item .item-more').first().click(); await page.locator('#detailSheet [data-act="edit"]').click(); await page.locator('#linkSheet[open]').waitFor();
    assert.ok(!['INPUT', 'TEXTAREA'].includes((await active(page)).tag), `編集を開くと ${(await active(page)).id} にフォーカスが入る`); await context.close();
  }),
  check('P1', 'スマホ:URL欄は「完了」キーで、Enterでキーボードを閉じて取得を始める', async b => {
    const { page, context } = await open(b, SE);
    await page.locator('#bottomAdd').click(); await page.locator('#linkSheet[open]').waitFor();
    const a = await page.locator('#fUrl').evaluate(el => ({ hint: el.getAttribute('enterkeyhint'), cap: el.getAttribute('autocapitalize'), cor: el.getAttribute('autocorrect') }));
    assert.equal(a.hint, 'done', 'enterkeyhint="done" がない'); assert.equal(a.cap, 'off', 'autocapitalize="off" がない'); assert.equal(a.cor, 'off', 'autocorrect="off" がない');
    await page.locator('#fUrl').fill(NEW_URL('enter')); await page.locator('#fUrl').press('Enter');
    assert.notEqual((await active(page)).id, 'fUrl', 'EnterでURL欄から抜けない');
    await page.locator('#fStatus').waitFor({ state: 'visible', timeout: 3000 }); await context.close();
  }),
  check('P1', 'スマホ:引き出しの提案で「ほかの引き出し」を押すと、引き出し欄にそのまま打てる', async b => {
    const { page, context } = await open(b, SE);
    await page.locator('#bottomAdd').click(); await page.locator('#fUrl').fill(NEW_URL('assist'));
    await page.locator('#fSave').click(); await page.locator('#categoryAssist:not([hidden])').waitFor();
    await page.locator('#categoryAssistMore').click();
    assert.equal((await active(page)).id, 'fCat', '引き出し欄にフォーカスが入らない'); await context.close();
  }),
  check('P1', 'PC:URL入りで保存シートを開くと、これまでどおり引き出し欄から打てる', async b => {
    const { page, context } = await open(b, PC);
    await page.evaluate(u => { location.hash = '#save=' + encodeURIComponent(u); }, NEW_URL('pc'));
    await page.locator('#linkSheet[open]').waitFor();
    assert.equal((await active(page)).id, 'fCat', 'PCで引き出し欄にフォーカスが入らない'); await context.close();
  }),
  check('P1', 'キーボード相当(375×300):保存シートは見える範囲に収まり、保存ボタンがキーボードの上に残る', async () => {
    await eachEngine(async (browser, name) => {
      const { page, context } = await open(browser, SE);
      await page.locator('#bottomAdd').click(); await page.locator('#linkSheet[open]').waitFor();
      await keyboardUp(page);
      assert.equal(await kbOpen(page), true, `${name}: キーボードが出た扱いにならない`);
      const s = await box(page, '#linkSheet'), f = await box(page, '#fSave');
      assert.ok(s.top >= -1 && s.bottom <= KB.height + 1, `${name}: シート ${Math.round(s.top)}〜${Math.round(s.bottom)}`);
      assert.ok(f.top >= 0 && f.bottom <= KB.height, `${name}: 保存ボタン ${Math.round(f.top)}〜${Math.round(f.bottom)}`);
      await context.close();
    });
  }),

  // P2 破「入力が手元に来る」
  check('P2', '探す:入力欄は「探す」ボタンと同じ場所・同じ大きさで現れる', async b => {
    const { page, context } = await open(b, SE);
    const pill = await box(page, '#searchOpen');
    await openHand(page);
    const inp = await box(page, '#mSearchInput');
    const d = { left: inp.left - pill.left, width: inp.width - pill.width, bottom: inp.bottom - pill.bottom };
    assert.ok(Object.values(d).every(v => Math.abs(v) <= 4), `ずれ(px): ${JSON.stringify(d)}`);
    assert.ok(inp.height >= 44, `入力欄の高さ ${inp.height}`);
    assert.equal((await active(page)).id, 'mSearchInput'); await context.close();
  }),
  check('P2', 'キーボード相当:入力欄はキーボードのすぐ上、結果はその上に出る', async () => {
    await eachEngine(async (browser, name) => {
      const { page, context } = await open(browser, SE);
      await openHand(page); await keyboardUp(page);
      assert.equal(await kbOpen(page), true, `${name}: キーボードが出た扱いにならない`);
      const s = await box(page, '#searchSheet'), inp = await box(page, '#mSearchInput'), res = await box(page, '#mResults');
      assert.ok(s.top >= -1 && s.bottom <= KB.height + 1, `${name}: シート ${Math.round(s.top)}〜${Math.round(s.bottom)}`);
      assert.ok(inp.bottom <= KB.height && inp.bottom >= KB.height - 14, `${name}: 入力欄の下端 ${Math.round(inp.bottom)} / 見える高さ ${KB.height}`);
      assert.ok(res.bottom <= inp.top + 1, `${name}: 結果(${Math.round(res.bottom)})が入力欄(${Math.round(inp.top)})に重なる`);
      await context.close();
    });
  }),
  check('P2', '探す:結果が少ないときは入力欄のすぐ上に寄せる', async b => {
    const { page, context } = await open(b, SE);
    await openHand(page); await page.locator('#mSearchInput').fill('炊き込み');
    await page.locator('#mResults .item').first().waitFor();
    const last = await page.locator('#mResults .item').last().evaluate(el => el.getBoundingClientRect().bottom);
    const head = await box(page, '#searchSheet .sheet-head');
    assert.ok(last <= head.top + 1, `結果(${Math.round(last)})が入力欄(${Math.round(head.top)})より下にある`);
    assert.ok(head.top - last <= 24, `最後の結果と入力欄の間が ${Math.round(head.top - last)}px 空いている`); await context.close();
  }),
  check('P2', '探す:「閉じる」は入力欄の右(＋があった場所)にあり、44px以上で、押すと閉じる', async b => {
    const { page, context } = await open(b, SE);
    const add = await box(page, '#bottomAdd');
    await openHand(page);
    const inp = await box(page, '#mSearchInput'), x = await box(page, '#searchSheet [data-close]');
    assert.ok(x.left >= inp.right, '閉じるが入力欄の右にない');
    assert.ok(Math.abs(x.left - add.left) <= 4 && Math.abs(x.bottom - add.bottom) <= 4, `閉じるが＋の場所にない ${JSON.stringify({ x, add })}`);
    assert.ok(x.width >= 44 && x.height >= 44, `閉じる ${Math.round(x.width)}×${Math.round(x.height)}`);
    await page.locator('#searchSheet [data-close]').click();
    assert.equal(await page.evaluate(() => document.querySelector('#searchSheet').open), false); await context.close();
  }),

  // P3 離「引き出しが寄り添う」
  check('P3', '下のバーは「探す・貼る」', async b => {
    const { page, context } = await open(b, SE);
    assert.match(await page.locator('#searchOpen').innerText(), /探す・貼る/); await context.close();
  }),
  check('P3', 'URLを貼ると、入力欄のすぐ上に引き出しが並ぶ(最近の引き出しが先頭。未分類と詳しくもある)', async () => {
    await eachEngine(async (browser, name) => {
      const { page, context } = await open(browser, SE);
      await openHand(page); await page.locator('#mSearchInput').fill(NEW_URL('strip-' + name));
      await page.locator('#mResults .hand-drawers').waitFor();
      await keyboardUp(page);
      const strip = await box(page, '#mResults .hand-drawers'), head = await box(page, '#searchSheet .sheet-head');
      assert.ok(strip.bottom <= head.top + 1 && strip.bottom >= head.top - 12, `${name}: 引き出しの列(下端 ${Math.round(strip.bottom)})が入力欄(${Math.round(head.top)})から離れている`);
      assert.ok(strip.top >= 0, `${name}: 引き出しの列が見える範囲の上にはみ出す`);
      assert.equal(await page.locator('.hand-drawers [data-url-save-to]').first().getAttribute('data-url-save-to'), 'しごと', `${name}: 先頭が最近の引き出しではない`);
      assert.equal(await page.locator('.hand-drawers [data-url-quick-save]').count(), 1, `${name}: 未分類がない`);
      assert.equal(await page.locator('.hand-drawers [data-url-detail-save]').count(), 1, `${name}: 詳しくがない`);
      const low = await page.locator('.hand-drawers button').evaluateAll(bs => bs.filter(x => x.getBoundingClientRect().height < 44).length);
      assert.equal(low, 0, `${name}: 高さ44px未満のボタンが ${low}個`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: 横にはみ出す`);
      await context.close();
    });
  }),
  check('P3', '引き出しを押すと、その引き出しに1件だけ入り、シートが閉じ、「◯◯」に入れたと知らせてカードが光る', async b => {
    const { page, context } = await open(b, SE);
    const url = NEW_URL('drop');
    await openHand(page); await page.locator('#mSearchInput').fill(url);
    await page.locator('.hand-drawers [data-url-save-to="しごと"]').dblclick();
    await page.waitForFunction(() => !document.querySelector('#searchSheet').open, null, { timeout: 3000 });
    const saved = (await stored(page)).items.filter(x => x.url === url);
    assert.equal(saved.length, 1, `保存された件数 ${saved.length}`); assert.equal(saved[0].projectName, 'しごと');
    assert.match(await page.locator('#toast').innerText(), /「しごと」/, '知らせに引き出しの名前がない');
    assert.ok(await page.locator('#lib .item.flash').count() >= 1, '保存したカードが光らない'); await context.close();
  }),
  check('P3', '保存済みのURLには引き出しを出さず「保存済み」を示す', async b => {
    const { page, context } = await open(b, SE);
    await openHand(page); await page.locator('#mSearchInput').fill('https://qa-yoranai.test/a/3');
    await page.locator('#mResults [data-url-intent]').waitFor();
    assert.match(await page.locator('#mResults [data-url-intent]').innerText(), /保存済み/);
    assert.equal(await page.locator('#mResults .hand-drawers').count(), 0, '保存済みなのに引き出しが並ぶ'); await context.close();
  }),
  check('P3', '「未分類」はいったん保存、「詳しく」は保存シートへ(まだ保存しない)', async b => {
    const { page, context } = await open(b, SE);
    await openHand(page); await page.locator('#mSearchInput').fill(NEW_URL('later'));
    await page.locator('.hand-drawers [data-url-quick-save]').click();
    await page.waitForFunction(() => !document.querySelector('#searchSheet').open, null, { timeout: 3000 });
    assert.equal((await stored(page)).items.find(x => x.url === NEW_URL('later'))?.projectName, '未分類');
    await openHand(page); await page.locator('#mSearchInput').fill(NEW_URL('detail'));
    await page.locator('.hand-drawers [data-url-detail-save]').click();
    await page.locator('#linkSheet[open]').waitFor();
    assert.equal(await page.locator('#fUrl').inputValue(), NEW_URL('detail'));
    assert.equal((await stored(page)).items.some(x => x.url === NEW_URL('detail')), false, '詳しくを押しただけで保存された'); await context.close();
  }),
  check('P3', '引き出しを開いているときは、その引き出しが先頭に来る', async b => {
    const { page, context } = await open(b, SE);
    await page.locator('#chips [data-drawer="まなび"]').click();
    await openHand(page); await page.locator('#mSearchInput').fill(NEW_URL('current'));
    assert.equal(await page.locator('.hand-drawers [data-url-save-to]').first().getAttribute('data-url-save-to'), 'まなび'); await context.close();
  }),
  check('P3', '動きを減らす設定でも、押せばすぐ保存できる', async b => {
    const { page, context } = await open(b, SE, { reducedMotion: 'reduce' });
    await openHand(page); await page.locator('#mSearchInput').fill(NEW_URL('calm'));
    await page.locator('.hand-drawers [data-url-save-to="ときめき"]').click();
    await page.waitForFunction(() => !document.querySelector('#searchSheet').open, null, { timeout: 1000 });
    assert.equal((await stored(page)).items.find(x => x.url === NEW_URL('calm'))?.projectName, 'ときめき'); await context.close();
  }),
  check('P3', 'PC:URLの保存カードはこれまでどおり(いったん保存/引き出しを選ぶ)', async b => {
    const { page, context } = await open(b, PC);
    await page.locator('#searchInput').fill(NEW_URL('pc-intent'));
    await page.locator('#lib [data-url-intent]').waitFor();
    assert.match(await page.locator('#lib [data-url-quick-save]').innerText(), /いったん保存/);
    assert.match(await page.locator('#lib [data-url-detail-save]').innerText(), /引き出しを選ぶ/);
    assert.equal(await page.locator('#lib .hand-drawers').count(), 0, 'PCにも引き出しの列が出ている'); await context.close();
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
if (failed) process.exitCode = 1;
