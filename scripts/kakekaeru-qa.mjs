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
  }),

  // P2 守「どこでも、同じ札」
  check('P2', '古い選び方(最近の札・コンボ・おすすめ・全画面の選び方・たぶんここ)が残っていない', async b => {
    const { page, context } = await open(b, PC);
    const left = await page.evaluate(() => ['#fRecent', '#fCatList', '#categoryAssist', '#destinationPicker', '#pRecent', '#pCatList', '[data-assist-cat]'].filter(s => document.querySelector(s)));
    assert.deepEqual(left, []); await context.close();
  }),
  check('P2', 'スマホ:新しい名前を打ってEnter → その札が先頭で選ばれ、ボタンは「「名前」に入れる」。保存するとその引き出しに1件入る', async () => {
    await eachEngine(async (b, name) => {
      const { page, context } = await open(b, SE, mobile);
      const url = NEW_URL('create-' + name);
      await openAdd(page); await page.locator('#fUrl').fill(url); await page.locator('#fUrl').press('Enter');
      await page.locator('#fCat').click(); await page.locator('#fCat').fill('新しい棚');
      assert.match(await page.locator('#fTags [data-new]').innerText(), /新しい棚/, `${name}: 新しく作る札が出ない`);
      assert.equal(await page.locator('#fSave').innerText(), '「新しい棚」に入れる', `${name}: 打っている間のボタン名`);
      await page.locator('#fCat').press('Enter');
      assert.equal(await page.locator('#fTags .tag:not([hidden])').first().getAttribute('data-name'), '新しい棚', `${name}: 作った札が先頭にない`);
      assert.equal(await page.locator('#fTags [aria-selected="true"]').getAttribute('data-name'), '新しい棚', `${name}: 作った札が選ばれていない`);
      assert.equal(await page.locator('#fCat').inputValue(), '', `${name}: 欄が空にならない`);
      assert.notEqual((await active(page)).id, 'fCat', `${name}: 決めたあとも欄にフォーカスが残る(キーボードが閉じない)`);
      await page.locator('#fSave').click();
      await page.waitForFunction(() => !document.querySelector('#linkSheet').open, null, { timeout: 3000 });
      const saved = (await stored(page)).items.filter(x => x.url === url);
      assert.equal(saved.length, 1, `${name}: 保存件数 ${saved.length}`); assert.equal(saved[0].projectName, '新しい棚');
      await context.close();
    });
  }),
  check('P2', 'スマホ:打っただけ(Enterも札も押さず)で保存しても、その名前の引き出しに入る', async b => {
    const { page, context } = await open(b, SE, mobile);
    const url = NEW_URL('typed-only');
    await openAdd(page); await page.locator('#fUrl').fill(url); await page.locator('#fUrl').press('Enter');
    await page.locator('#fCat').fill('打っただけ');
    await page.locator('#fSave').click();
    await page.waitForFunction(() => !document.querySelector('#linkSheet').open, null, { timeout: 3000 });
    assert.equal((await itemOf(page, url))?.projectName, '打っただけ'); await context.close();
  }),
  check('P2', 'スマホ:編集を開くと、いまの引き出しが先頭で選ばれて見え、ほかの札を押せば選び直せる', async () => {
    await eachEngine(async (b, name) => {
      const { page, context } = await open(b, SE, mobile);
      await openEditFirst(page);
      const id = await page.evaluate(() => F.id);
      const cur = (await stored(page)).items.find(x => x.id === id).projectName;
      const first = page.locator('#fTags .tag:not([hidden])').first();
      assert.equal(await first.getAttribute('data-name'), cur, `${name}: 先頭がいまの引き出しではない`);
      assert.equal(await first.getAttribute('aria-selected'), 'true', `${name}: いまの引き出しが選ばれていない`);
      assert.ok(await first.isVisible(), `${name}: 札が見えない`);
      const other = await page.locator(`#fTags .tag:not([hidden]):not([data-new]):not([data-name="${cur}"])`).first().getAttribute('data-name');
      await page.locator(`#fTags [data-name="${other}"]`).click();
      await page.locator('#fSave').click();
      await page.waitForFunction(() => !document.querySelector('#linkSheet').open, null, { timeout: 3000 });
      assert.equal((await stored(page)).items.find(x => x.id === id).projectName, other, `${name}: 選び直しが保存されない`);
      await context.close();
    });
  }),
  check('P2', 'PC:編集で引き出し欄に触れても、候補はいまの引き出しに絞られない。「すべて」で残りも出る', async b => {
    const { page, context } = await open(b, PC);
    await openEditFirst(page);
    await page.locator('#fCat').click();
    const shown = await page.locator('#fTags .tag:not([hidden]):not([data-new])').count();
    assert.ok(shown >= 5, `見える札が${shown}個`);
    await page.locator('#fCatAll').click();
    const all = await page.locator('#fTags .tag:not([hidden]):not([data-new])').count();
    assert.equal(all, DRAWERS.length, `すべてで${all}個(引き出しは${DRAWERS.length}個)`); await context.close();
  }),
  check('P2', 'PC:名前を打ってEnter、もう一度Enterで保存できる(マウスなし)', async b => {
    const { page, context } = await open(b, PC);
    const url = NEW_URL('pc-keys');
    await page.evaluate(u => { location.hash = '#save=' + encodeURIComponent(u); }, url);
    await page.locator('#linkSheet[open]').waitFor();
    assert.equal((await active(page)).id, 'fCat', 'URL入りで開いたら引き出し欄から打てる');
    await page.keyboard.type('まなび'); await page.keyboard.press('Enter');
    assert.equal((await active(page)).id, 'fSave', '決めたら保存ボタンへ移る');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.querySelector('#linkSheet').open, null, { timeout: 3000 });
    assert.equal((await itemOf(page, url))?.projectName, 'まなび'); await context.close();
  }),
  check('P2', '似た札があるときは、Enterは似た札を選ぶ(「AI」→ AIツール・AI記事)。「新しく作る」は後ろにあり、押せば「AI」を作れる', async b => {
    const { page, context } = await open(b, PC);
    await openAdd(page);
    await page.locator('#fCat').fill('AI');
    assert.match(await page.locator('#fTags .tag.is-active').getAttribute('data-name'), /^AI(ツール|記事)$/, 'Enterで選ばれる札');
    const order = await page.locator('#fTags [data-new]').evaluate(el => getComputedStyle(el).order);
    assert.equal(order, '1', '新しく作る札が後ろにない');
    await page.locator('#fTags [data-new]').click();
    assert.equal(await page.evaluate(() => F.cat), 'AI'); await context.close();
  }),
  check('P2', 'かな・カナ・空白の違いは同じ札とみなし、新しく作らない(「シゴト」「しご と」→ しごと)', async b => {
    const { page, context } = await open(b, PC);
    await openAdd(page);
    for (const typed of ['シゴト', 'しご と', 'ｼｺﾞﾄ']) {
      await page.locator('#fCat').fill(typed);
      assert.equal(await page.locator('#fTags [data-new]').isVisible(), false, `「${typed}」で新しく作る札が出た`);
      assert.equal(await page.locator('#fTags .tag.is-active').getAttribute('data-name'), 'しごと', `「${typed}」`);
    }
    await page.locator('#fCat').press('Enter');
    assert.equal(await page.evaluate(() => F.cat), 'しごと'); await context.close();
  }),
  check('P2', '日本語の変換を確定するEnter(keyCode 229)では決めない', async () => {
    await eachEngine(async (b, name) => {
      const { page, context } = await open(b, SE, mobile);
      await openAdd(page);
      await page.locator('#fCat').fill('へんかんちゅう');
      await page.locator('#fCat').evaluate(el => {
        const e = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
        Object.defineProperty(e, 'keyCode', { get: () => 229 });
        el.dispatchEvent(e);
      });
      assert.equal(await page.locator('#fCat').inputValue(), 'へんかんちゅう', `${name}: 確定のEnterで決まってしまった`);
      assert.equal(await page.evaluate(() => F.cat), '', `${name}: 確定のEnterで引き出しが決まった`);
      await context.close();
    });
  }),
  check('P2', '打つたびに札を作り直さない(押そうとしている札が消えない)', async () => {
    await eachEngine(async (b, name) => {
      const { page, context } = await open(b, SE, mobile);
      await openAdd(page);
      await page.evaluate(() => { window.__qaNew = document.querySelector('#fTags [data-new]'); window.__qaFirst = document.querySelector('#fTags .tag:not([data-new])'); });
      for (const s of ['あ', 'あた', 'あたら', 'あたらしい', 'しご', 'しごと']) await page.locator('#fCat').fill(s);
      const same = await page.evaluate(() => window.__qaNew.isConnected && window.__qaFirst.isConnected && window.__qaNew === document.querySelector('#fTags [data-new]'));
      assert.equal(same, true, `${name}: 打っている間に札が作り直された`);
      await context.close();
    });
  }),
  check('P2', '引き出しなしで保存を押すと、保存せずに選ぶ場所を示す(ボタン名は「引き出しを選ぶ」。スマホはキーボードを出さない)', async b => {
    for (const [vp, extra, label] of [[SE, mobile, 'スマホ'], [PC, {}, 'PC']]) {
      const { page, context } = await open(b, vp, extra);
      const url = NEW_URL('ask-' + label);
      await openAdd(page); await page.locator('#fUrl').fill(url); await page.locator('#fUrl').press('Enter');
      assert.equal(await page.locator('#fSave').innerText(), '引き出しを選ぶ', `${label}: ボタン名`);
      await page.locator('#fSave').click();
      assert.equal(await page.evaluate(() => document.querySelector('#linkSheet').open), true, `${label}: 保存して閉じてしまった`);
      assert.equal(await itemOf(page, url), undefined, `${label}: 引き出しなしで保存された`);
      const a = (await active(page)).id;
      if (label === 'PC') assert.equal(a, 'fCat', 'PCは引き出し欄へ');
      else assert.notEqual(a, 'fCat', 'スマホでキーボードを出した');
      await context.close();
    }
  }),
  check('P2', '取得の知らせが出ても変わっても、引き出し欄は動かない', async b => {
    const { page, context } = await open(b, SE, mobile);
    await openAdd(page);
    await page.locator('#fUrl').fill(NEW_URL('shift'));
    const before = await box(page, '#fCatField');
    await page.locator('#fUrl').press('Enter');
    await page.locator('#fStatus:not([hidden])').waitFor();
    const busy = await box(page, '#fCatField');
    await page.locator('#fStatus.bad, #fStatus.warn, #fStatus.ok').waitFor({ timeout: 15000 });
    const done = await box(page, '#fCatField');
    assert.ok(Math.abs(busy.top - before.top) <= 1 && Math.abs(done.top - before.top) <= 1, `引き出し欄が動いた ${Math.round(before.top)} → ${Math.round(busy.top)} → ${Math.round(done.top)}`);
    await context.close();
  }),
  check('P2', 'URL入りで開くとURL欄はたたまれ、ページの札だけを見せる。「URLを直す」で開く', async b => {
    const { page, context } = await open(b, SE, mobile);
    await page.evaluate(u => { location.hash = '#save=' + encodeURIComponent(u); }, NEW_URL('fold'));
    await page.locator('#linkSheet[open]').waitFor();
    assert.equal(await page.locator('#fUrlField').isVisible(), false, 'URL欄がたたまれていない');
    assert.match(await page.locator('#fPage').innerText(), /qa-kakekaeru\.test/);
    await page.locator('#fUrlEdit').click();
    assert.equal(await page.locator('#fUrlField').isVisible(), true);
    assert.equal(await page.locator('#fUrl').inputValue(), NEW_URL('fold')); await context.close();
  }),
  check('P2', 'キーボード相当(375×300):引き出し欄に触れると、欄と札がキーボードの上に見える', async () => {
    await eachEngine(async (b, name) => {
      const { page, context } = await open(b, SE);
      await openEditFirst(page);
      await page.locator('#fCat').click();
      await keyboardUp(page);
      await page.locator('#fCat').fill('AI'); await page.waitForTimeout(150);
      const inp = await box(page, '#fCat'), chip = await box(page, '#fTags .tag.is-active'), save = await box(page, '#fSave');
      assert.ok(inp.top >= 0 && inp.bottom <= save.top, `${name}: 欄が見えない(${Math.round(inp.top)}〜${Math.round(inp.bottom)} / 保存 ${Math.round(save.top)})`);
      assert.ok(chip.top >= 0 && chip.bottom <= save.top, `${name}: 札が見えない(${Math.round(chip.top)}〜${Math.round(chip.bottom)})`);
      await context.close();
    });
  }),
  check('P2', 'プロンプト:編集でカテゴリを選び直せる。新しいカテゴリは打ってEnterで作れる', async b => {
    const { page, context } = await open(b, PC);
    await page.locator('[data-rail="prompts"]').click();
    await page.locator('#promptList .row[data-id="prompt-0"] .row-main').click();
    await page.locator('#promptPane [data-pedit]').click(); await page.locator('#promptSheet[open]').waitFor();
    assert.equal(await page.locator('#pTags [aria-selected="true"]').getAttribute('data-name'), '要約');
    await page.locator('#pTags [data-name="翻訳"]').click();
    await page.locator('#pSave').click();
    assert.equal((await stored(page)).promptMemos.find(x => x.id === 'prompt-0').categoryName, '翻訳');
    await page.locator('#promptAddButton').click(); await page.locator('#promptSheet[open]').waitFor();
    await page.locator('#pCat').fill('新カテゴリ'); await page.locator('#pCat').press('Enter');
    await page.locator('#pTitle').fill('QAのプロンプト'); await page.locator('#pBody').fill('本文');
    await page.locator('#pSave').click();
    assert.equal((await stored(page)).promptMemos.find(x => x.title === 'QAのプロンプト')?.categoryName, '新カテゴリ'); await context.close();
  }),

  // P3 破「札を押せば、掛け替わる」
  check('P3', 'スマホ:束のカードの札を押すと掛け替えのシートが開き、いまの引き出しが選ばれている(キーボードは出さない)', async () => {
    await eachEngine(async (b, name) => {
      const { page, context } = await open(b, SE, mobile);
      const card = page.locator('#deckTrack .card.is-current');
      const id = await card.getAttribute('data-id');
      const cur = (await stored(page)).items.find(x => x.id === id).projectName;
      await card.locator('[data-refile]').click();
      await page.locator('#refileSheet[open]').waitFor();
      assert.equal(await page.locator('#rTags [aria-selected="true"]').getAttribute('data-name'), cur, `${name}: いまの引き出しが選ばれていない`);
      assert.notEqual((await active(page)).tag, 'INPUT', `${name}: 開いただけでキーボードを出した`);
      await context.close();
    });
  }),
  check('P3', '札を押して別の引き出しを選ぶと、すぐ掛け替わってシートが閉じ、「◯◯へ掛け替えました」と元に戻すが出る。元に戻すで戻る', async b => {
    const { page, context } = await open(b, SE, mobile);
    const card = page.locator('#deckTrack .card.is-current');
    const id = await card.getAttribute('data-id');
    const cur = (await stored(page)).items.find(x => x.id === id).projectName;
    const to = cur === 'まなび' ? 'ごはん' : 'まなび';
    await card.locator('[data-refile]').click(); await page.locator('#refileSheet[open]').waitFor();
    await page.locator('#rCatAll').click();
    await page.locator(`#rTags [data-name="${to}"]`).click();
    await page.waitForFunction(() => !document.querySelector('#refileSheet').open, null, { timeout: 3000 });
    assert.equal((await stored(page)).items.find(x => x.id === id).projectName, to);
    assert.match(await page.locator('#toast').innerText(), new RegExp(`「${to}」へ掛け替えました`));
    await page.locator('#toast button').click();
    assert.equal((await stored(page)).items.find(x => x.id === id).projectName, cur, '元に戻らない'); await context.close();
  }),
  check('P3', '詳細シートの札からも掛け替えられる', async b => {
    const { page, context } = await open(b, SE, mobile);
    await page.locator('#lib .item .item-more').first().click(); await page.locator('#detailSheet[open]').waitFor();
    const id = await page.evaluate(() => U.sel.id);
    await page.locator('#detailSheet [data-refile]').click();
    await page.locator('#refileSheet[open]').waitFor();
    assert.equal(await page.evaluate(() => document.querySelector('#detailSheet').open), false, '詳細シートが閉じない');
    await page.locator('#rTags [data-name="未分類"]').click();
    assert.equal((await stored(page)).items.find(x => x.id === id).projectName, '未分類'); await context.close();
  }),
  check('P3', '掛け替えで新しい引き出しを作れる(打ってEnter)。元に戻すと、その空の引き出しも片づく', async b => {
    const { page, context } = await open(b, PC);
    const id = await page.locator('#deckTrack .card.is-current').getAttribute('data-id');
    await page.locator('#deckTrack .card.is-current [data-refile]').click(); await page.locator('#refileSheet[open]').waitFor();
    await page.locator('#rCat').fill('掛け替え先'); await page.locator('#rCat').press('Enter');
    await page.waitForFunction(() => !document.querySelector('#refileSheet').open, null, { timeout: 3000 });
    let s = await stored(page);
    assert.equal(s.items.find(x => x.id === id).projectName, '掛け替え先');
    assert.ok(s.projects.includes('掛け替え先'));
    await page.locator('#toast button').click();
    s = await stored(page);
    assert.notEqual(s.items.find(x => x.id === id).projectName, '掛け替え先');
    assert.equal(s.projects.includes('掛け替え先'), false, '空の引き出しが残った'); await context.close();
  }),
  check('P3', 'スマホ:札は見た目が小さくても、押せる範囲は縦44px以上', async () => {
    await eachEngine(async (b, name) => {
      const { page, context } = await open(b, SE, mobile);
      const hit = await page.locator('#deckTrack .card.is-current [data-refile]').evaluate(el => {
        const r = el.getBoundingClientRect(), x = r.left + r.width / 2;
        let top = r.top, bottom = r.bottom;
        while (document.elementFromPoint(x, top - 1)?.closest('[data-refile]') === el) top--;
        while (document.elementFromPoint(x, bottom + 1)?.closest('[data-refile]') === el) bottom++;
        return bottom - top;
      });
      assert.ok(hit >= 43, `${name}: 押せる高さ ${hit}px`); await context.close();
    });
  }),
  check('P3', '「いったん保存」の知らせの「引き出しを選ぶ」で、掛け替えのシートが開く', async b => {
    const { page, context } = await open(b, SE, mobile);
    await page.locator('#searchOpen').click(); await page.locator('#mSearchInput').fill(NEW_URL('later-refile'));
    await page.locator('.hand-drawers [data-url-quick-save]').click();
    await page.waitForFunction(() => !document.querySelector('#searchSheet').open, null, { timeout: 3000 });
    await page.locator('#toast button').click();
    await page.locator('#refileSheet[open]').waitFor();
    await page.locator('#rTags [data-name="しごと"]').click();
    assert.equal((await itemOf(page, NEW_URL('later-refile')))?.projectName, 'しごと'); await context.close();
  }),
  check('P3', 'PC:一覧のリンクを左の引き出しへ落とすと掛け替わる。保存していないURLを落とすと、その引き出しに保存される', async b => {
    const { page, context } = await open(b, PC);
    const drop = async (url, drawer) => {
      const dt = await page.evaluateHandle(u => { const d = new DataTransfer(); d.setData('text/uri-list', u); return d; }, url);
      const target = page.locator(`#rail [data-rail="cat:${drawer}"]`);
      await target.dispatchEvent('dragover', { dataTransfer: dt });
      assert.equal(await target.evaluate(el => el.classList.contains('is-drop-target')), true, '落とす先が光らない');
      await target.dispatchEvent('drop', { dataTransfer: dt });
    };
    const first = (await stored(page)).items[0];
    const to = first.projectName === 'まなび' ? 'ごはん' : 'まなび';
    await drop(first.url, to);
    assert.equal((await stored(page)).items.find(x => x.id === first.id).projectName, to, '掛け替わらない');
    assert.equal(await page.evaluate(() => document.querySelector('#linkSheet').open), false, '保存シートが開いた');
    await drop(NEW_URL('dropped'), 'ごはん');
    assert.equal((await itemOf(page, NEW_URL('dropped')))?.projectName, 'ごはん', '新しいURLが保存されない'); await context.close();
  }),

  // P4 離「名前を書けば、引き出しが生まれる」
  check('P4', 'まだない名前を打つと、点線の札に「名前から決まる色」の点が出る(名前を変えると色も変わる)', async b => {
    const { page, context } = await open(b, SE, mobile);
    await openAdd(page);
    const colorOf = async name => { await page.locator('#fCat').fill(name); return page.locator('#fTags [data-new] .dot').evaluate(el => getComputedStyle(el).backgroundColor); };
    const expect = name => page.evaluate(n => { const d = document.createElement('span'); d.style.color = getProjectColor(n).border; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; }, name);
    const a = await colorOf('うみ'), b2 = await colorOf('やま');
    assert.equal(a, await expect('うみ')); assert.equal(b2, await expect('やま'));
    assert.notEqual(a, b2, '名前が違っても同じ色'); await context.close();
  }),
  check('P4', '作った札は生まれる動きで出る(動きを減らす設定では動かない)', async b => {
    const a = await open(b, SE, mobile);
    await openAdd(a.page); await a.page.locator('#fCat').fill('生まれたて'); await a.page.locator('#fCat').press('Enter');
    assert.equal(await a.page.locator('#fTags [data-name="生まれたて"]').evaluate(el => el.classList.contains('is-born') && getComputedStyle(el).animationName), 'born'); await a.context.close();
    const r = await open(b, SE, { ...mobile, reducedMotion: 'reduce' });
    await openAdd(r.page); await r.page.locator('#fCat').fill('生まれたて'); await r.page.locator('#fCat').press('Enter');
    assert.equal(await r.page.locator('#fTags [data-name="生まれたて"]').evaluate(el => getComputedStyle(el).animationName), 'none'); await r.context.close();
  }),
  check('P4', 'スマホ:新しい引き出しに保存すると、上の引き出しの列の先頭に出て光り、「新しい引き出し「◯◯」に入れました」と知らせる', async () => {
    await eachEngine(async (b, name) => {
      const { page, context } = await open(b, SE, mobile);
      await page.locator('#searchOpen').click(); await page.locator('#mSearchInput').fill(`${NEW_URL('born-' + name)} #はじめての棚`);
      await page.locator('#mSearchInput').press('Enter');
      await page.waitForFunction(() => !document.querySelector('#searchSheet').open, null, { timeout: 3000 });
      assert.equal((await itemOf(page, NEW_URL('born-' + name)))?.projectName, 'はじめての棚', `${name}: 保存先`);
      const first = page.locator('#chips [data-drawer]:not([data-drawer="ALL"]):not([data-drawer="UNOPENED"])').first();
      assert.equal(await first.getAttribute('data-drawer'), 'はじめての棚', `${name}: 列の先頭にない`);
      assert.equal(await first.evaluate(el => el.classList.contains('is-born')), true, `${name}: 光らない`);
      assert.match(await page.locator('#toast').innerText(), /新しい引き出し「はじめての棚」に入れました/);
      await context.close();
    });
  }),
  check('P4', 'PC:「URL #名前」でEnter → その引き出しに保存。カードは「「名前」に入れる」と「新しい引き出し」を示し、左の引き出しが光る', async b => {
    const { page, context } = await open(b, PC);
    const url = NEW_URL('pc-hash');
    await page.locator('#searchInput').fill(`${url} #PCで生まれた`);
    await page.locator('#lib [data-url-intent]').waitFor();
    const card = await page.locator('#lib [data-url-intent]').innerText();
    assert.match(card, /「PCで生まれた」に入れる/); assert.match(card, /新しい引き出し/);
    await page.locator('#searchInput').press('Enter');
    assert.equal((await itemOf(page, url))?.projectName, 'PCで生まれた');
    assert.equal(await page.locator('#rail [data-rail="cat:PCで生まれた"]').evaluate(el => el.classList.contains('is-born')), true, '左の引き出しが光らない');
    assert.equal(await page.locator('#searchInput').inputValue(), '', '入力欄が空にならない'); await context.close();
  }),
  check('P4', 'スマホ:全角の「＃名前」でも、すでにある引き出しへ寄せて入れる(「URL ＃シゴト」→ しごと)。札の列の先頭はその引き出し', async b => {
    const { page, context } = await open(b, SE, mobile);
    const url = NEW_URL('zenkaku');
    await page.locator('#searchOpen').click(); await page.locator('#mSearchInput').fill(`${url} ＃シゴト`);
    assert.equal(await page.locator('.hand-drawers [data-url-save-to]').first().getAttribute('data-url-save-to'), 'しごと');
    await page.locator('#mSearchInput').press('Enter');
    await page.waitForFunction(() => !document.querySelector('#searchSheet').open, null, { timeout: 3000 });
    assert.equal((await itemOf(page, url))?.projectName, 'しごと'); await context.close();
  }),
  check('P4', '保存済みのURLに「#名前」を付けてEnterすると、その引き出しへ掛け替わる', async b => {
    const { page, context } = await open(b, PC);
    const target = (await stored(page)).items.find(x => x.projectName !== 'まなび');
    await page.locator('#searchInput').fill(`${target.url} #まなび`);
    assert.match(await page.locator('#lib [data-url-intent]').innerText(), /掛け替える/);
    await page.locator('#searchInput').press('Enter');
    assert.equal((await stored(page)).items.find(x => x.id === target.id).projectName, 'まなび');
    assert.match(await page.locator('#toast').innerText(), /「まなび」へ掛け替えました/); await context.close();
  }),
  check('P4', '「URL #名前」でも、変換を確定するEnter(keyCode 229)では保存しない', async () => {
    await eachEngine(async (b, name) => {
      const { page, context } = await open(b, SE, mobile);
      const url = NEW_URL('ime-' + name);
      await page.locator('#searchOpen').click(); await page.locator('#mSearchInput').fill(`${url} #へんかん`);
      await page.locator('#mSearchInput').evaluate(el => {
        const e = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
        Object.defineProperty(e, 'keyCode', { get: () => 229 });
        el.dispatchEvent(e);
      });
      await page.waitForTimeout(200);
      assert.equal(await itemOf(page, url), undefined, `${name}: 確定のEnterで保存された`);
      assert.equal(await page.evaluate(() => document.querySelector('#searchSheet').open), true, `${name}: シートが閉じた`);
      await context.close();
    });
  }),
  check('P4', 'URLの中の#(ページ内の位置)は引き出しとみなさない', async b => {
    const { page, context } = await open(b, PC);
    const url = 'https://qa-kakekaeru.test/doc#section-2';
    await page.locator('#searchInput').fill(url);
    assert.match(await page.locator('#lib [data-url-intent]').innerText(), /このURLを保存/);
    await page.locator('#searchInput').press('Enter');
    const saved = await itemOf(page, url);
    assert.equal(saved?.projectName, '未分類', `保存先 ${saved?.projectName}`); await context.close();
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
