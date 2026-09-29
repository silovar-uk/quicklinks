// 受け入れ確認「積まずに、めくる」
// 使い方:
//   本番実装 : LOCAL_URL=http://127.0.0.1:4173/ node scripts/mekuru-qa.mjs
//   公開後   : LOCAL_URL=https://silovar-uk.github.io/quicklinks/ node scripts/mekuru-qa.mjs(新しいブラウザー環境で動くため、実データや同期には触れない)
//   試作     : QA_TARGET=mock LOCAL_URL=http://127.0.0.1:8127/docs/mekuru-mock/ node scripts/mekuru-qa.mjs
//   段階を絞る: QA_PHASES=P1,P2(既定は P1,P2,P3,P4 すべて)
//   WebKit(iPhoneのSafariと同じ系統)は、入っていればスマホの外枠の検査で使う。CIは `npx playwright install --with-deps chromium webkit` 済み
import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';

const BASE_URL = process.env.LOCAL_URL || 'http://127.0.0.1:4173/';
const MOCK = process.env.QA_TARGET === 'mock';
const PHASES = new Set((process.env.QA_PHASES || 'P1,P2,P3,P4').split(','));
const STORAGE_KEY = 'quick-links-mobile-localstorage-v1';
const DAY = 864e5;
// 本番実装は時計を固定して、束の並びと「◯か月前の今日」を毎回同じにする
const CLOCK = new Date('2026-10-15T12:00:00+09:00').getTime();

/* ---------- 本番実装に入れる架空データ(保存形式どおり。実データの形をまねる) ---------- */
function fixture(now) {
  const iso = t => new Date(t).toISOString();
  const at = age => now - age * DAY;
  // CIの実行環境(協定世界時)でも本番(日本時間)でも同じ日付になるよう、Node側のローカルタイムゾーンに
  // 依存しないUTC明示のsetterで日付だけをずらす(正午UTC=21時JSTで、どちらの側から見ても同じ暦日になる)
  const monthsAgo = k => { const d = new Date(now); d.setUTCMonth(d.getUTCMonth() - k); d.setUTCHours(12, 0, 0, 0); return d.getTime(); };
  const link = (id, title, url, projectName, note, time, clicks = 0) => ({
    id, title, url, projectName, note, addedAt: iso(time), updatedAt: iso(time),
    lastClickedAt: clicks ? iso(now - 3 * DAY) : null, clickCount: clicks, clickHistory: clicks ? [iso(now - 3 * DAY)] : [],
    archived: false, isFavorite: false, favoriteType: 'none', favoriteExpiry: null
  });
  const moods = ['学び', 'いつか', 'ほっこり', '感動', 'デザイン', '真似したい', 'AI関連', '事例'];
  const items = [
    link('link-x-auto', 'Xユーザーのデザインのメモ帳さん: 「配色に迷ったら、まず白黒だけで組んでから1色足す。」 / X', 'https://x.com/memo_design_jp/status/1', 'デザイン', '配色に迷ったら、まず白黒だけで組んでから1色足す。', at(20)),
    link('link-x-handle', 'Xユーザーのねこと暮らす（@neko_kurasu）さん', 'https://x.com/neko_kurasu/status/2', 'ほっこり', '雨の日だけ窓辺で外を眺める猫。毎回同じ場所で、同じ姿勢。', at(40)),
    link('link-x-en', 'つむぎ (@tsumugi_slides) on X', 'https://x.com/tsumugi_slides/status/3', '学び', '資料は結論から書く。見出しを文にするだけで伝わる。', at(64)),
    link('link-yt', '子猫がはじめて雪を見た日 - YouTube', 'https://m.youtube.com/watch?v=qa1', 'ほっこり', '作成した動画を友だち、家族、世界中の人たちと共有', at(33)),
    link('link-note', '視点と視野と視座を整理してみた｜やまもと', 'https://note.com/yamamoto/n/qa2', '学び', '視点・視野・視座の違いを図で整理した記事。', at(70)),
    link('link-deck', '伝わるスライドの作り方 - Speaker Deck', 'https://speakerdeck.com/sample/qa3', 'パワポ', '発表資料。', at(88)),
    link('link-gpt', 'ChatGPT', 'https://chatgpt.com/', 'ツール', '', at(150), 12),
    link('link-refetch', 'qa-refetch.test', 'https://qa-refetch.test/article', '学び', '', at(50)),
    link('link-login', 'notion.so', 'https://www.notion.so/workspace/qa', 'ツール', '', at(120)),
    link('link-mem1', 'Xユーザーのねこと暮らすさん: 「窓辺の猫、今日も同じ場所。」 / X', 'https://x.com/neko_kurasu/status/9', 'ほっこり', '窓辺の猫、今日も同じ場所。', monthsAgo(1)),
    link('link-mem2', '引退試合の花道 - YouTube', 'https://m.youtube.com/watch?v=qa9', '感動', '引退試合のあと、相手チームが花道を作った場面。', monthsAgo(2)),
    link('link-mem3', '「伝わる図解」の3つの型｜はたらく図解', 'https://note.com/zukai/n/qa9', '学び', '比較・流れ・分類の3つの型。', monthsAgo(3)),
    ...Array.from({ length: 40 }, (_, i) => link(`link-bulk-${i}`, `まとめて取得する記事 ${i + 1}`, `https://qa-bulk.test/p/${i}`, moods[i % moods.length], '', at(4 + i * 6), i % 13 === 0 ? 1 : 0)),
    ...Array.from({ length: 24 }, (_, i) => link(`link-xq-${i}`, `Xユーザーの架空の人${i}さん: 「さっと読める投稿 ${i + 1}。」 / X`, `https://x.com/sample_${i}/status/${100 + i}`, moods[(i + 3) % moods.length], `さっと読める投稿 ${i + 1}。`, at(3 + i * 7)))
  ];
  const body = 'あなたは編集者です。\n\n# 条件\n- 結論を先に\n\n# 文章\n(ここに貼る)';
  const promptMemos = Array.from({ length: 14 }, (_, i) => ({
    id: `prompt-${i}`, title: i === 0 ? '記事要約' : `架空のプロンプト ${i}`, categoryName: ['要約', '連想', '文字起こし', 'PPT'][i % 4], body: body.repeat(1 + (i % 3)),
    createdAt: iso(now - 200 * DAY), updatedAt: iso(now - 20 * DAY), copyCount: i === 0 ? 42 : i % 5, lastCopiedAt: i === 0 ? iso(now - DAY / 2) : i % 5 ? iso(now - (i % 4 + 1) * DAY) : null
  }));
  return {
    activeTab: 'links', query: '', currentProject: 'ALL', currentPromptCategory: 'ALL', onlyFavorites: false,
    linkSort: 'recent', promptSort: 'popular', viewMode: 'rich', linkPage: 1, promptPage: 1, linkPerPage: '10', promptPerPage: '10',
    items, projects: [...new Set(items.map(x => x.projectName))], projectColors: {}, promptMemos, promptCategories: [...new Set(promptMemos.map(x => x.categoryName))]
  };
}

/* ---------- ページの準備 ---------- */
async function open(browser, { width, height } = {}) {
  // CIは協定世界時で動く。日付に関わる検査がずれないよう日本時間に固定する
  // クリップボードの許可はChromiumだけが受け付ける(WebKitに渡すと失敗する)
  const permissions = browser.browserType().name() === 'chromium' ? ['clipboard-read', 'clipboard-write'] : [];
  const context = await browser.newContext({ viewport: { width, height }, timezoneId: 'Asia/Tokyo', locale: 'ja-JP', permissions });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  if (!MOCK) {
    await page.clock.install({ time: CLOCK });
    const baseOrigin = new URL(BASE_URL).origin; // 公開後のURLに当てるときは、そのオリジンだけ通す
    await context.route(u => u.origin !== baseOrigin && !['127.0.0.1', 'localhost'].includes(u.hostname), route => route.abort());
    const html = (title, desc) => ({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'access-control-allow-origin': '*' }, body: `<title>${title}</title><meta name="description" content="${desc}">` });
    await context.route('https://qa-success.test/**', r => r.fulfill(html('QA Success', 'QA success description')));
    await context.route('https://qa-refetch.test/**', r => r.fulfill(html('取り直したタイトル', '取り直した説明')));
    await context.route('https://qa-bulk.test/**', r => r.fulfill(html('まとめて取得したタイトル', 'まとめて取得した説明')));
    await context.route('https://api.microlink.io/**', r => r.fulfill({ status: 429, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: '{"status":"fail","code":"ERATE"}' }));
  }
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  if (!MOCK) {
    await page.evaluate(({ key, value }) => { localStorage.clear(); localStorage.setItem(key, JSON.stringify(value)); }, { key: STORAGE_KEY, value: fixture(CLOCK) });
    await page.reload({ waitUntil: 'domcontentloaded' });
  } else {
    await page.evaluate(() => { try { localStorage.removeItem('quick-links-mekuru-v1'); } catch { } });
    await page.reload({ waitUntil: 'domcontentloaded' });
  }
  await page.locator('#deckTrack .card').first().waitFor({ state: 'attached', timeout: 15000 });
  return { context, page, errors };
}
const stored = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
async function linkCount(page, id) {
  if (MOCK) return page.evaluate(i => count(find('link', i)), id);
  return (await stored(page)).items.find(x => x.id === id)?.clickCount;
}
async function promptCount(page, id) {
  if (MOCK) return page.evaluate(i => find('prompt', i).copyCount, id);
  return (await stored(page)).promptMemos.find(x => x.id === id)?.copyCount;
}
// 試作ではデータの中から条件に合う項目を探す。本番実装では架空データのIDを使う
async function pick(page, what) {
  if (!MOCK) return { xAuto: 'link-x-auto', xHandle: 'link-x-handle', yt: 'link-yt', gpt: 'link-gpt', placeholder: 'link-refetch', login: 'link-login', prompt: 'prompt-0' }[what];
  return page.evaluate(w => {
    const L = links;
    if (w === 'xAuto') return L.find(l => /^Xユーザーの.+さん: 「/.test(l.title)).id;
    if (w === 'xHandle') return L.find(l => /^Xユーザーの.+（@[A-Za-z0-9_]+）さん$/.test(l.title)).id;
    if (w === 'yt') return L.find(l => / - YouTube$/.test(l.title) && /作成した動画を友だち/.test(l.note)).id;
    if (w === 'gpt') return L.find(l => /chatgpt\.com/.test(l.url)).id;
    if (w === 'placeholder') { const l = L.find(x => x.title === hostOf(x.url) && !isLoginHost(x.url)) || L.find(x => !x.note && !isLoginHost(x.url)); return l.id; }
    if (w === 'login') return L.find(l => isLoginHost(l.url)).id;
    if (w === 'prompt') return prompts[0].id;
  }, what);
}
const deckCount = async page => (await page.locator('#deckCount').innerText()).match(/(\d+)\s*\/\s*(\d+)/).slice(1).map(Number);
async function deckIds(page) { return page.locator('#deckTrack .card').evaluateAll(cs => cs.map(c => c.dataset.id)); }
async function newTabOrCount(page, id, action) {
  const before = await linkCount(page, id);
  const popup = MOCK ? null : page.context().waitForEvent('page', { timeout: 4000 }).catch(() => null);
  await action();
  if (popup) { const p = await popup; if (p) await p.close(); }
  await page.waitForTimeout(150);
  return { before, after: await linkCount(page, id) };
}
async function openEdit(page, id) {
  await page.locator(`#lib .item[data-id="${id}"] .item-more`).click({ timeout: 5000 }).catch(async () => {
    // 一覧で見えないときは検索で出す
    const title = MOCK ? await page.evaluate(i => view(find('link', i)).title, id) : (await stored(page)).items.find(x => x.id === id).title;
    await page.locator('#searchInput').fill(title.slice(0, 8));
    await page.locator(`#lib .item[data-id="${id}"] .item-more`).click();
  });
  await page.locator('#detailSheet [data-act="edit"]').click();
  await page.locator('#linkSheet[open]').waitFor();
}

/* ---------- 確認項目 ---------- */
const PC = { width: 1366, height: 633 };
const PHONE = { width: 390, height: 844 };
const SAFARI_HEIGHT = 664; // iPhoneのSafariで上下のツールバーが出ているときの表示の高さ(目安)
const SKIPPED = [];
const check = (phase, name, fn) => ({ phase, name, fn });
const checks = [
  // P1 めくり台と引き出し
  check('P1', 'PC 1366×633:横スクロールがなく、束のカード2枚以上と一覧のカード3件以上がまるごと見える', async b => {
    const { page, context, errors } = await open(b, PC);
    const m = await page.evaluate(() => {
      const full = el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth; };
      return { h: document.documentElement.scrollWidth > innerWidth, railOverflow: document.querySelector('#rail').scrollWidth > document.querySelector('#rail').clientWidth, cards: [...document.querySelectorAll('#deckTrack .card')].filter(full).length, current: full(document.querySelector('#deckTrack .card.is-current')), items: [...document.querySelectorAll('#lib .item')].filter(full).length };
    });
    assert.equal(m.h, false, '横スクロールがある'); assert.equal(m.railOverflow, false, '引き出しが横にはみ出す');
    assert.ok(m.cards >= 2, `束のカード ${m.cards}枚`); assert.equal(m.current, true, 'いまの1枚が見切れている'); assert.ok(m.items >= 3, `一覧のカード ${m.items}件`);
    assert.equal(await page.locator('#searchClear').isVisible(), false, '検索が空なのに消去ボタンが出ている');
    assert.deepEqual(errors, []); await context.close();
  }),
  check('P1', 'PC:本文と主要メタ情報は12px以上(URLプレビュー・キー表示を除く)', async b => {
    const { page, context } = await open(b, PC);
    const small = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(e => e.offsetParent && !e.closest('kbd, .kbd, dialog, .item-url') && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())).filter(e => parseFloat(getComputedStyle(e).fontSize) < 12).map(e => e.className || e.tagName).slice(0, 5));
    assert.deepEqual(small, [], `12px未満: ${small.join(', ')}`); await context.close();
  }),
  check('P1', '表示の整え:Xは本文と投稿者に分け、YouTubeの末尾と定型の説明を出さない', async b => {
    const { page, context } = await open(b, PC);
    const ids = { a: await pick(page, 'xAuto'), h: await pick(page, 'xHandle'), y: await pick(page, 'yt') };
    await page.locator('#searchInput').fill(' ');
    await page.locator('#searchInput').fill('');
    const text = async id => page.evaluate(i => { const el = document.querySelector(`#lib .item[data-id="${i}"]`) || document.querySelector(`#deckTrack .card[data-id="${i}"]`); return el ? el.innerText : ''; }, id);
    for (const id of [ids.a, ids.h]) {
      const t = await text(id); assert.ok(t, `Xの項目 ${id} が見つからない`);
      assert.doesNotMatch(t, /Xユーザーの|\s\/\sX\b|on X/, `Xの自動タイトルが残っている: ${t.slice(0, 40)}`);
    }
    assert.match(await text(ids.h), /@[A-Za-z0-9_]+/, '投稿者(@)が出ていない');
    const y = await text(ids.y); assert.doesNotMatch(y, /- YouTube|作成した動画を友だち/, `YouTubeの末尾か定型文が残っている: ${y.slice(0, 40)}`);
    await context.close();
  }),
  check('P1', '一覧:新しい順では保存月ごとに分かれ、説明はPCで3行まで', async b => {
    const { page, context } = await open(b, PC);
    assert.ok(await page.locator('#lib .month').count() >= 2, '保存月の見出しがない');
    const tooLong = await page.locator('#lib .item-desc').evaluateAll(els => els.filter(e => e.getBoundingClientRect().height > parseFloat(getComputedStyle(e).lineHeight) * 3 + 1).length);
    assert.equal(tooLong, 0, '3行を超える説明がある'); await context.close();
  }),
  check('P1', '束:「次へ」で2枚目へ進み、再読み込みしても同じ日は続きから', async b => {
    const { page, context } = await open(b, PC);
    const [p0, n] = await deckCount(page); assert.equal(p0, 1); assert.ok(n > 10);
    await page.locator('#deckNext').click(); await page.locator('#deckNext').click();
    assert.equal((await deckCount(page))[0], 3);
    const cur = await page.locator('#deckTrack .card.is-current').getAttribute('data-id');
    await page.reload({ waitUntil: 'domcontentloaded' }); await page.locator('#deckTrack .card').first().waitFor({ state: 'attached' });
    assert.equal((await deckCount(page))[0], 3, '再読み込みで位置が戻った');
    assert.equal(await page.locator('#deckTrack .card.is-current').getAttribute('data-id'), cur, '同じ日なのに並びが変わった');
    await context.close();
  }),
  check('P1', '検索:Enterで1件目を開き、ひらがなでカタカナに当たる', async b => {
    const { page, context } = await open(b, PC);
    await page.locator('#searchInput').fill('ChatGPT');
    const id = await pick(page, 'gpt');
    const r = await newTabOrCount(page, id, () => page.locator('#searchInput').press('Enter'));
    assert.equal(r.after, r.before + 1, `回数 ${r.before}→${r.after}`);
    await page.locator('#searchInput').fill('ぱわぽ');
    assert.match(await page.locator('#lib').innerText(), /パワポ/);
    await context.close();
  }),
  check('P1', 'プロンプト:選ぶと本文全体が出て、行の「コピー」でコピーできる', async b => {
    const { page, context } = await open(b, PC);
    await page.locator('[data-rail="prompts"]').click();
    const id = await pick(page, 'prompt');
    await page.locator(`#promptList .row[data-id="${id}"] .row-main`).click();
    const body = MOCK ? await page.evaluate(i => find('prompt', i).body, id) : (await stored(page)).promptMemos.find(x => x.id === id).body;
    assert.equal((await page.locator('#promptPane .d-body').innerText()).trim(), body.trim(), '本文全体が出ていない');
    const before = await promptCount(page, id);
    await page.locator(`#promptList .row[data-id="${id}"] .row-copy`).click(); await page.waitForTimeout(200);
    assert.equal(await promptCount(page, id), before + 1, 'コピー回数が増えていない');
    // Windowsのクリップボードは改行をCRLFにするため、そろえてから比べる
    const clip = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n');
    assert.equal(clip.trim(), body.trim(), 'クリップボードの中身が本文と違う'); await context.close();
  }),
  check('P1', 'スマホ 390×844:いまの1枚が下のバーより上にまるごと見え、幅は画面の8割以上', async b => {
    const { page, context, errors } = await open(b, PHONE);
    const m = await page.evaluate(() => { const c = document.querySelector('#deckTrack .card.is-current').getBoundingClientRect(), bar = document.querySelector('#bottomBar').getBoundingClientRect(); return { h: document.documentElement.scrollWidth > innerWidth, top: c.top, bottom: c.bottom, barTop: bar.top, width: c.width, vw: innerWidth, s: document.querySelector('#searchOpen').getBoundingClientRect().height, a: document.querySelector('#bottomAdd').getBoundingClientRect() }; });
    assert.equal(m.h, false, '横スクロールがある'); assert.ok(m.top >= 0 && m.bottom <= m.barTop, `カード ${Math.round(m.top)}〜${Math.round(m.bottom)} / バー ${Math.round(m.barTop)}`);
    assert.ok(m.width >= m.vw * .8, `カードの幅 ${Math.round(m.width)}`); assert.ok(m.s >= 44 && m.a.height >= 44 && m.a.width >= 44, '下のバーが44px未満');
    assert.deepEqual(errors, []); await context.close();
  }),
  check('P1', 'スマホ:指でめくる(横スクロール)と、いまの1枚と枚数が進む', async b => {
    const { page, context } = await open(b, PHONE);
    await page.evaluate(() => { const t = document.querySelector('#deckTrack'), c = t.querySelectorAll('.card')[1]; t.scrollTo({ left: c.offsetLeft - 16, behavior: 'auto' }); });
    await page.waitForFunction(() => /^今日の束 2 \//.test(document.querySelector('#deckCount').textContent), null, { timeout: 3000 });
    await context.close();
  }),
  check('P1', 'スマホ:「探す」で検索シートが開き、入力にフォーカスが入る', async b => {
    const { page, context } = await open(b, PHONE);
    await page.locator('#searchOpen').click();
    assert.equal(await page.evaluate(() => document.querySelector('#searchSheet').open), true);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'mSearchInput'); await context.close();
  }),
  check('P1', '保存:URLを入れると待たずに取得し、保存するとシートが閉じて保存したカードが光る。項目は増えない', async b => {
    const { page, context } = await open(b, PC);
    await page.locator('#addButton').click();
    await page.locator('#fUrl').fill(MOCK ? 'https://example.com/qa-save' : 'https://qa-success.test/save');
    await page.locator('#fUrl').dispatchEvent('change');
    await page.waitForFunction(() => document.querySelector('#fTitle').value.trim().length > 0, null, { timeout: 8000 });
    if (!MOCK) { assert.equal(await page.locator('#fTitle').inputValue(), 'QA Success'); assert.equal(await page.locator('#fNote').inputValue(), 'QA success description'); }
    assert.match(await page.locator('#fSave').innerText(), /未分類で保存/, '分類なしのときのボタン名');
    await page.locator('#fCat').fill('受け入れ確認'); await page.keyboard.press('Enter');
    await page.locator('#fSave').click();
    await page.waitForFunction(() => !document.querySelector('#linkSheet').open);
    assert.equal(await page.locator('#lib .item.flash').count(), 1, '光るカードがない');
    if (!MOCK) {
      const allowed = ['addedAt', 'archived', 'clickCount', 'clickHistory', 'favoriteExpiry', 'favoriteType', 'id', 'isFavorite', 'lastClickedAt', 'note', 'projectName', 'title', 'updatedAt', 'url'];
      const s = await stored(page);
      s.items.forEach(x => Object.keys(x).forEach(k => assert.ok(allowed.includes(k), `リンクに新しい項目 ${k}`)));
      s.promptMemos.forEach(x => assert.deepEqual(Object.keys(x).sort(), ['body', 'categoryName', 'copyCount', 'createdAt', 'id', 'lastCopiedAt', 'title', 'updatedAt']));
      assert.ok(s.items.some(x => x.projectName === '受け入れ確認'), '新しい引き出しで保存されていない');
    }
    await context.close();
  }),
  check('P1', 'スマホの外枠:本文はスクロールせず中身だけが動き、下のバーは画面の下にとどまる(ツールバーで縮んでもついてくる)', async b => {
    const engines = [['chromium', b]];
    try { engines.push(['webkit', await webkit.launch({ headless: true })]); } catch { SKIPPED.push('WebKitが入っていないため、外枠の検査はChromiumだけで行いました'); }
    for (const [name, browser] of engines) {
      const { page, context, errors } = await open(browser, PHONE);
      const snap = () => page.evaluate(() => {
        const c = document.querySelector('#center'), bar = document.querySelector('#bottomBar').getBoundingClientRect(), card = document.querySelector('#deckTrack .card.is-current').getBoundingClientRect();
        return { inner: innerHeight, body: getComputedStyle(document.body).overflow, app: getComputedStyle(document.querySelector('#app')).display, centerY: getComputedStyle(c).overflowY, barPos: getComputedStyle(document.querySelector('#bottomBar')).position, barTop: bar.top, barBottom: bar.bottom, cardBottom: card.bottom, doc: document.documentElement.scrollTop + document.body.scrollTop, center: c.scrollTop, h: document.documentElement.scrollWidth > innerWidth };
      });
      const a = await snap();
      assert.equal(a.body, 'hidden', `${name}: 本文がスクロールする`); assert.equal(a.app, 'grid', `${name}: 外枠がgridでない`);
      assert.equal(a.centerY, 'auto', `${name}: 中身の欄がスクロールしない`); assert.notEqual(a.barPos, 'fixed', `${name}: 下のバーがfixed`);
      assert.ok(Math.abs(a.barBottom - a.inner) <= 2, `${name}: 下のバーが画面の下にない(${Math.round(a.barBottom)} / ${a.inner})`); assert.equal(a.h, false, `${name}: 横スクロールがある`);
      await page.locator('#center').evaluate(n => { n.scrollTop = 1200; }); await page.waitForTimeout(80);
      const s2 = await snap();
      assert.ok(s2.center > 500 && s2.doc === 0, `${name}: 中身だけが動いていない`); assert.ok(Math.abs(s2.barTop - a.barTop) <= 1, `${name}: スクロールで下のバーが動いた`);
      await page.locator('#center').evaluate(n => { n.scrollTop = 0; });
      // iPhoneのSafariでツールバーが出ている高さ
      await page.setViewportSize({ width: PHONE.width, height: SAFARI_HEIGHT }); await page.waitForTimeout(150);
      const s3 = await snap();
      assert.ok(Math.abs(s3.barBottom - s3.inner) <= 2, `${name}: 縮んだ画面で下のバーがついてこない(${Math.round(s3.barBottom)} / ${s3.inner})`);
      assert.ok(s3.cardBottom <= s3.barTop, `${name}: 高さ${SAFARI_HEIGHT}でいまの1枚が下のバーに隠れる`);
      assert.deepEqual(errors, []); await context.close();
      if (browser !== b) await browser.close();
    }
  }),
  check('P1', 'スマホ:リンクとプロンプトを行き来しても、それぞれのスクロール位置が戻る', async b => {
    const { page, context } = await open(b, PHONE);
    await page.locator('#center').evaluate(n => { n.scrollTop = 700; });
    await page.locator('#seg [data-seg="prompts"]').click();
    await page.locator('#seg [data-seg="links"]').click();
    const top = await page.locator('#center').evaluate(n => n.scrollTop);
    assert.ok(Math.abs(top - 700) <= 2, `戻った位置 ${top}`); await context.close();
  }),
  check('P1', '引き出しを整理:入口があり、引き出しごとの件数が並ぶ(PCはつかんで統合できる)', async b => {
    const { page, context } = await open(b, PC);
    const drawers = await page.locator('#rail [data-rail^="cat:"]').count();
    await page.locator('#rail [data-rail="organize"]').click();
    await page.locator('#organizer').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#rail .org-row').count(), drawers, '整理の行数が引き出しの数と違う');
    assert.match(await page.locator('#rail .org-row').first().innerText(), /\d+件/, '件数が出ていない');
    assert.equal(await page.locator('#rail .org-row .org-drag').first().isVisible(), true, 'PCでつかむ印が出ていない');
    await context.close();
  }),
  // P2 情報の手入れ
  check('P2', '保存:取得に失敗したら「もう一度取得」が出て、押すと取り直せる', async b => {
    const { page, context } = await open(b, PC);
    if (MOCK) await page.evaluate(() => { S.failFetch = true; });
    else await context.route('https://qa-flaky.test/**', r => r.abort());
    await page.locator('#addButton').click();
    await page.locator('#fUrl').fill(MOCK ? 'https://example.com/flaky' : 'https://qa-flaky.test/page');
    await page.locator('#fUrl').dispatchEvent('change');
    await page.locator('#fRetry').waitFor({ state: 'visible', timeout: 15000 });
    if (MOCK) await page.evaluate(() => { S.failFetch = false; });
    else { await context.unroute('https://qa-flaky.test/**'); await context.route('https://qa-flaky.test/**', r => r.fulfill({ status: 200, headers: { 'content-type': 'text/html', 'access-control-allow-origin': '*' }, body: '<title>Flaky Recovered</title>' })); }
    await page.locator('#fRetry').click();
    await page.waitForFunction(() => document.querySelector('#fTitle').value.trim().length > 0, null, { timeout: 8000 });
    await context.close();
  }),
  check('P2', '編集:「ページ情報を取り直す」で差分が出る。URLのままのタイトルは差し替えが既定', async b => {
    const { page, context } = await open(b, PC);
    const id = await pick(page, 'placeholder');
    await openEdit(page, id);
    const before = await page.locator('#fTitle').inputValue();
    await page.locator('#fRefetch').click();
    await page.locator('#fDiff').waitFor({ state: 'visible', timeout: 8000 });
    const titleBox = page.locator('#dTitle');
    if (await titleBox.count()) {
      if (!MOCK) assert.equal(await titleBox.isChecked(), true, 'URLのままのタイトルなのに差し替えが既定でない');
      await page.locator('#dApply').click();
      if (!MOCK) assert.notEqual(await page.locator('#fTitle').inputValue(), before);
    } else await page.locator('#dApply').click();
    await context.close();
  }),
  check('P2', '編集:ログインが必要なページは取得せず、今の内容を残してブックマークレットを案内する', async b => {
    const { page, context } = await open(b, PC);
    const id = await pick(page, 'login');
    await openEdit(page, id);
    const before = await page.locator('#fTitle').inputValue();
    await page.locator('#fRefetch').click();
    await page.waitForFunction(() => /ブックマークレット/.test(document.querySelector('#fStatus').textContent), null, { timeout: 8000 });
    assert.equal(await page.locator('#fTitle').inputValue(), before, 'タイトルを書き換えた');
    assert.equal(await page.locator('#fDiff').isVisible(), false); await context.close();
  }),
  check('P2', '管理:まとめて取り直すと、取得枠が尽きたところで止まり「明日」再開を案内する', async b => {
    const { page, context } = await open(b, PC);
    // 本番実装では直接取得を失敗させ、外部サービス(429)へ回して枠切れを起こす
    if (MOCK) await page.evaluate(() => { S.quota = 2; });
    else { await context.unroute('https://qa-bulk.test/**'); await context.route('https://qa-bulk.test/**', r => r.abort()); }
    await page.locator('[data-rail="manage"]').click();
    await page.locator('#careRun').click();
    await page.waitForFunction(() => /明日/.test(document.querySelector('#care').textContent), null, { timeout: 60000 });
    await context.close();
  }),
  // P3 出会い直し
  check('P3', '束:先頭は「ちょうど◯か月前の今日に保存」(1日3枚まで)', async b => {
    const { page, context } = await open(b, PC);
    const reasons = await page.locator('#deckTrack .card .card-reason').allInnerTexts();
    assert.match(reasons[0], /ちょうど\d+か月前の今日に保存|ちょうど1年前の今日に保存/, `先頭の理由: ${reasons[0]}`);
    assert.ok(reasons.filter(r => /前の今日に保存/.test(r)).length <= 3, '「今日に保存」が3枚を超える');
    await context.close();
  }),
  check('P1', '束:寝かせたもの・まだ開いていないものが先に出る', async b => {
    const { page, context } = await open(b, PC);
    const ids = await deckIds(page);
    const ages = MOCK
      ? await page.evaluate(list => list.map(id => ({ age: ageDays(find('link', id)), open: count(find('link', id)) > 0, mem: !!MK.mem[id] })), ids)
      : await page.evaluate(({ list, key, now }) => { const s = JSON.parse(localStorage.getItem(key)); return list.map(id => { const x = s.items.find(i => i.id === id); return { age: (now - Date.parse(x.addedAt)) / 864e5, open: x.clickCount > 0, mem: false }; }); }, { list: ids, key: STORAGE_KEY, now: CLOCK });
    const reasons = await page.locator('#deckTrack .card .card-reason').allInnerTexts();
    const rest = ages.filter((x, i) => !/前の今日に保存/.test(reasons[i]));
    const mean = a => a.reduce((s, x) => s + x.age, 0) / a.length;
    assert.ok(mean(rest.slice(0, 10)) >= mean(rest), `先頭10枚の平均 ${Math.round(mean(rest.slice(0, 10)))}日 < 全体 ${Math.round(mean(rest))}日`);
    assert.ok(rest.slice(0, 10).filter(x => !x.open).length >= 8, '先頭10枚にまだ開いていないものが少ない');
    await context.close();
  }),
  check('P1', '引き出し:ほっこりを選ぶと、束も一覧もほっこりだけになる', async b => {
    const { page, context } = await open(b, PC);
    await page.locator('[data-rail="cat:ほっこり"]').click();
    const moods = await page.locator('#deckTrack .card .mood').allInnerTexts();
    assert.ok(moods.length > 0 && moods.every(m => m.trim() === 'ほっこり'), `束に別の引き出し: ${[...new Set(moods)].join(',')}`);
    const libMoods = await page.locator('#lib .item .mood').allInnerTexts();
    assert.ok(libMoods.every(m => m.trim() === 'ほっこり')); await context.close();
  }),
  check('P3', '見る長さ:「さっと」はXとショートだけ、「じっくり」はXを含まない', async b => {
    const { page, context } = await open(b, PC);
    await page.locator('.kinds [data-kind="quick"]').click();
    const quick = await page.locator('#deckTrack .card .src').allInnerTexts();
    assert.ok(quick.length && quick.every(s => ['X', 'ショート'].includes(s.trim())), `さっと: ${[...new Set(quick)].join(',')}`);
    await page.locator('.kinds [data-kind="deep"]').click();
    const deep = await page.locator('#deckTrack .card .src').allInnerTexts();
    assert.ok(deep.length && !deep.some(s => ['X', 'ショート'].includes(s.trim())), `じっくり: ${[...new Set(deep)].join(',')}`);
    await context.close();
  }),
  check('P3', '手放す:束から消え、「元に戻す」で同じ位置に戻る', async b => {
    const { page, context } = await open(b, PC);
    await page.locator('#deckNext').click();
    const id = await page.locator('#deckTrack .card.is-current').getAttribute('data-id');
    const [, n] = await deckCount(page);
    await page.locator('#deckTrack .card.is-current [data-letgo]').click();
    assert.equal(await page.locator(`#deckTrack .card[data-id="${id}"]`).count(), 0, '束に残っている');
    assert.equal((await deckCount(page))[1], n - 1);
    await page.locator('#toast button').click();
    assert.equal(await page.locator('#deckTrack .card.is-current').getAttribute('data-id'), id, '元の位置に戻らない');
    await context.close();
  }),
  check('P1', '束:翌日は並びが変わり、1枚目から始まる', async b => {
    const { page, context } = await open(b, PC);
    const today = (await deckIds(page)).slice(0, 8).join(',');
    if (MOCK) { await page.locator('#simButton').click(); await page.locator('#simNextDay').click(); }
    else { await page.clock.setSystemTime(CLOCK + DAY); await page.reload({ waitUntil: 'domcontentloaded' }); await page.locator('#deckTrack .card').first().waitFor({ state: 'attached' }); }
    assert.notEqual((await deckIds(page)).slice(0, 8).join(','), today, '翌日も同じ並び');
    assert.equal((await deckCount(page))[0], 1, '翌日は1枚目から');
    await context.close();
  }),
  // P4 どこでも
  check('P4', 'PC:入力欄の外で文字を打つと検索に入る(1文字目も残る)', async b => {
    const { page, context } = await open(b, PC);
    await page.locator('#libHead h2').click();
    await page.keyboard.press('g'); await page.keyboard.press('p');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'searchInput');
    assert.equal(await page.locator('#searchInput').inputValue(), 'gp'); await context.close();
  }),
  check('P4', 'PC:/ と Ctrl+K で検索へ', async b => {
    const { page, context } = await open(b, PC);
    await page.locator('#libHead h2').click();
    await page.keyboard.press('/'); assert.equal(await page.evaluate(() => document.activeElement.id), 'searchInput');
    await page.locator('#searchInput').blur(); await page.keyboard.press('Control+k');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'searchInput'); await context.close();
  }),
  check('P4', 'PC:→で束をめくり、Enterでいまの1枚を開く', async b => {
    const { page, context } = await open(b, PC);
    await page.locator('#libHead h2').click();
    await page.keyboard.press('ArrowRight');
    assert.equal((await deckCount(page))[0], 2, '→でめくれない');
    const id = await page.locator('#deckTrack .card.is-current').getAttribute('data-id');
    const r = await newTabOrCount(page, id, () => page.keyboard.press('Enter'));
    assert.equal(r.after, r.before + 1, 'Enterで開かない'); await context.close();
  }),
  check('P4', 'PC:どこでもCtrl+V(URL入り)で保存シートが開き、URLが入る', async b => {
    const { page, context } = await open(b, PC);
    await page.evaluate(() => { const dt = new DataTransfer(); dt.setData('text/plain', 'メモ https://example.com/pasted です'); document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); });
    assert.equal(await page.evaluate(() => document.querySelector('#linkSheet').open), true);
    assert.equal(await page.locator('#fUrl').inputValue(), 'https://example.com/pasted'); await context.close();
  }),
  check('P4', 'PC:リンクを落とすと保存シートが開く', async b => {
    const { page, context } = await open(b, PC);
    await page.evaluate(() => { const dt = new DataTransfer(); dt.setData('text/uri-list', 'https://example.com/dropped'); for (const type of ['dragenter', 'dragover', 'drop']) window.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true })); });
    assert.equal(await page.locator('#fUrl').inputValue(), 'https://example.com/dropped'); await context.close();
  }),
  check('P4', 'iPhoneの共有(ショートカット):#save=URL で開くと保存シートにURLが入り、アドレスから消える', async b => {
    const { page, context } = await open(b, PHONE);
    await page.evaluate(() => { location.hash = '#save=' + encodeURIComponent('https://example.com/shared-from-iphone'); });
    await page.locator('#linkSheet[open]').waitFor({ timeout: 5000 });
    assert.equal(await page.locator('#fUrl').inputValue(), 'https://example.com/shared-from-iphone');
    assert.equal(await page.evaluate(() => location.hash), '', 'アドレスに #save= が残っている');
    await context.close();
  }),
  check('P4', 'プロンプト:行でEnterを押すとコピーし、もう一度EnterでAIツールが開く', async b => {
    const { page, context } = await open(b, PC);
    await page.locator('[data-rail="prompts"]').click();
    const pid = await pick(page, 'prompt'), gid = await pick(page, 'gpt');
    const before = await promptCount(page, pid);
    await page.locator(`#promptList .row[data-id="${pid}"] .row-main`).focus();
    await page.keyboard.press('Enter'); await page.waitForTimeout(200);
    assert.equal(await promptCount(page, pid), before + 1, 'Enterでコピーされない');
    const r = await newTabOrCount(page, gid, () => page.keyboard.press('Enter'));
    assert.equal(r.after, r.before + 1, 'AIツールが開いていない'); await context.close();
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
