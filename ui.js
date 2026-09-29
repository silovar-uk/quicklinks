'use strict';
/*
 * ui.js — 描画・操作・シート・スマホの外枠・引き出しの整理の画面・管理・
 * ブックマークレット(#add=)の受け取りをここにまとめる。データは core.js を使う。
 */

const ICON = {
  all: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 10h16"/></svg>',
  unopened: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"/><circle class="f" cx="12" cy="12" r="2.5"/></svg>',
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 4 2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 16.3 7.2 18.9l.9-5.4-3.9-3.8 5.4-.8z"/></svg>',
  prompt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19h4l10-10-4-4L5 15v4Z"/><path d="m13.5 6.5 4 4"/></svg>',
  gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/></svg>',
  more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="f" cx="5" cy="12" r="1.5"/><circle class="f" cx="12" cy="12" r="1.5"/><circle class="f" cx="19" cy="12" r="1.5"/></svg>',
  undo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>',
  organize: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h11M4 17h7"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5"/></svg>'
};

// 画面だけのはたらき(検索欄の値・引き出し・見る長さ・選択中など)。保存データには入れない
const U = { view: 'links', drawer: 'ALL', kind: 'all', query: '', active: -1, sel: null, organize: false, scroll: {} };
const mqHand = matchMedia('(max-width: 899px)');
const hand = () => mqHand.matches;
const find = (kind, id) => (kind === 'link' ? state.items : state.promptMemos).find(x => x.id === id);
const dot = name => `<span class="dot" style="--c:${escapeHtml(getProjectColor(name).border || getProjectColor(name).text || '#bbb')}" aria-hidden="true"></span>`;

/* ============ フォーカスの保存・復元(innerHTML再描画でbodyへ落ちるのを防ぐ) ============ */
function focusLocator(el) {
  if (!el || el === document.body) return null;
  if (el.id) return { by: 'id', value: el.id };
  for (const attr of ['data-rail', 'data-drawer', 'data-kind', 'data-seg', 'data-sort', 'data-id', 'data-cat', 'data-org']) {
    if (el.hasAttribute(attr)) return { by: 'attr', attr, value: el.getAttribute(attr) };
  }
  return null;
}
function restoreFocus(locator) {
  if (!locator) return;
  let el = null;
  try {
    el = locator.by === 'id' ? document.getElementById(locator.value) : document.querySelector(`[${locator.attr}="${CSS.escape(locator.value)}"]`);
  } catch { /* CSS.escapeが使えない環境では諦める */ }
  el?.focus?.({ preventScroll: true });
}

/* ============ 引き出し(左のrail・スマホのchips) ============ */
function moodCounts() {
  const m = new Map();
  state.items.filter(i => !i.archived).forEach(item => { const p = item.projectName || '未分類'; m.set(p, (m.get(p) || 0) + 1); });
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'));
}
function railItem(key, icon, name, n, current) {
  return `<button class="rail-item" type="button" data-rail="${escapeHtml(key)}" aria-current="${current}">${icon}<span class="nm">${escapeHtml(name)}</span><span class="n">${n}</span></button>`;
}
function currentRailKey() {
  if (U.view === 'manage') return 'manage';
  if (U.view === 'prompts') return 'prompts';
  if (U.drawer === 'ALL') return 'all';
  if (U.drawer === 'UNOPENED') return 'unopened';
  if (U.drawer === 'FAV') return 'fav';
  return 'cat:' + U.drawer;
}
function orgHtml(kind = 'links') {
  const c = organizerConfig[kind];
  const list = c.names().map(n => [n, c.count(n)]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'));
  const canDrag = window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;
  const label = c.label;
  return `<div class="org-head" id="organizer"><b>${escapeHtml(label)}を整理</b><span>${list.length}個${canDrag ? `・つかんで別の${escapeHtml(label)}へ重ねると統合` : ''}</span><button class="btn" type="button" data-org-done>完了</button></div>` +
    list.map(([n, cnt]) => `<div class="org-row" data-category-kind="${kind}" data-org="${escapeHtml(n)}">${canDrag ? '<span class="org-drag" draggable="true" aria-hidden="true">⋮⋮</span>' : ''}${dot(n)}<span class="nm">${escapeHtml(n)}</span><span class="n">${cnt}件</span><button class="org-more" type="button" data-org-more="${escapeHtml(n)}" data-org-kind="${kind}" aria-label="${escapeHtml(n)}の操作">${ICON.more}</button></div>`).join('');
}
function renderRail() {
  const cur = currentRailKey();
  const favs = state.items.filter(i => !i.archived && isFavorite(i)).length;
  const drawers = U.organize ? orgHtml() : moodCounts().map(([n, c]) => railItem('cat:' + n, dot(n), n, c, String(cur === 'cat:' + n))).join('') + railItem('organize', ICON.organize, '引き出しを整理', '', 'false');
  const activeLinks = state.items.filter(i => !i.archived).length;
  $('rail').innerHTML = `<div class="rail-label">リンク</div>${railItem('all', ICON.all, 'ぜんぶ', activeLinks, String(cur === 'all'))}${railItem('unopened', ICON.unopened, 'まだ開いていない', state.items.filter(i => !i.archived && !Number(i.clickCount || 0)).length, String(cur === 'unopened'))}${favs ? railItem('fav', ICON.star, 'お気に入り', favs, String(cur === 'fav')) : ''}<div class="rail-label">引き出し</div>${drawers}<div class="rail-label">プロンプト</div>${railItem('prompts', ICON.prompt, 'すべてのプロンプト', state.promptMemos.length, String(cur === 'prompts'))}<div class="rail-sep"></div>${railItem('manage', ICON.gear, '管理', '', String(cur === 'manage'))}`;
  if (U.organize) bindOrganizerDrag($('rail'), 'links');
}
function renderChips() {
  const seg = U.view === 'prompts' ? 'prompts' : 'links';
  $$('#seg [data-seg]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.seg === seg)));
  $('segLinks').textContent = state.items.filter(i => !i.archived).length;
  $('segPrompts').textContent = state.promptMemos.length;
  $('chips').hidden = U.view !== 'links';
  const activeLinks = state.items.filter(i => !i.archived).length;
  $('chips').innerHTML = `<button class="chip" type="button" data-drawer="ALL" aria-pressed="${U.drawer === 'ALL'}">ぜんぶ ${activeLinks}</button><button class="chip" type="button" data-drawer="UNOPENED" aria-pressed="${U.drawer === 'UNOPENED'}">まだ開いていない ${state.items.filter(i => !i.archived && !Number(i.clickCount || 0)).length}</button>` +
    moodCounts().slice(0, 12).map(([n, c]) => `<button class="chip" type="button" data-drawer="${escapeHtml(n)}" aria-pressed="${U.drawer === n}">${escapeHtml(n)} ${c}</button>`).join('') +
    `<button class="chip" type="button" data-drawer="…">引き出し・並び ›</button>`;
}

/* ============ めくる束 ============ */
function cardHtml(item, i, cur, mem) {
  const v = view(item), r = reasonOf(item, mem);
  return `<article class="card${i === cur ? ' is-current' : ''}" data-id="${escapeHtml(item.id)}" data-index="${i}" aria-label="${i + 1}枚目">
    <div class="card-meta"><span class="src">${escapeHtml(v.src)}</span><span class="mood">${dot(item.projectName)}${escapeHtml(item.projectName || '未分類')}</span></div>
    <span class="card-reason${r.hot ? ' hot' : ''}">${escapeHtml(r.text)}</span>
    <h3 class="card-title ${v.desc ? 'clamp3' : 'clamp6 text'}">${escapeHtml(v.title)}</h3>
    ${v.by ? `<span class="card-by">${escapeHtml(v.by)}</span>` : ''}
    ${v.desc ? `<p class="card-desc clamp4">${escapeHtml(v.desc)}</p>` : v.title.length < 30 ? `<p class="card-desc"><button class="btn quiet" type="button" data-refetch style="padding:0;height:auto">説明がありません。ページ情報を取り直す</button></p>` : ''}
    <div class="card-actions"><a class="btn primary" href="${escapeHtml(item.url)}" target="_blank" rel="noopener" data-open>開く</a><button class="btn quiet" type="button" data-letgo>手放す</button><button class="btn quiet more" type="button" data-more aria-label="${escapeHtml(v.title.slice(0, 20))}の詳細と操作">${ICON.more}</button></div>
  </article>`;
}
function renderDeck() {
  const show = U.view === 'links' && !U.query.trim();
  $('deck').hidden = !show;
  if (!show) return;
  const mk = deck(U.drawer, U.kind);
  const n = mk.order.length, pos = Math.min(mk.pos, Math.max(0, n - 1));
  $('deckCount').textContent = n ? `今日の束 ${pos + 1} / ${n}` : '';
  $$('.kinds [data-kind]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.kind === U.kind)));
  const track = $('deckTrack');
  track.innerHTML = n
    ? mk.order.map((id, i) => cardHtml(find('link', id), i, pos, mk.mem)).join('') + `<div class="card-end">今日の束はここまで。<br>明日はまた違う順番で並びます。</div>`
    : `<div class="card-end">この条件の束はありません。</div>`;
  const card = track.children[pos];
  if (card) track.scrollLeft = card.offsetLeft - 16;
  markShown(mk.order[pos]);
  $('deckPrev').disabled = pos <= 0;
  $('deckNext').disabled = n === 0 || pos >= n - 1;
}
// 「いまの1枚」を決めて表示だけ直す。スクロールはしない(自分からスクロールし直すと途中で引き戻す)
function markCurrent(p) {
  const key = `${U.drawer}|${U.kind}`;
  const mk = deck(U.drawer, U.kind);
  const n = mk.order.length;
  if (!n) return 0;
  p = Math.max(0, Math.min(n - 1, p));
  deckSetPos(key, p);
  $$('#deckTrack .card').forEach((c, i) => c.classList.toggle('is-current', i === p));
  $('deckCount').textContent = `今日の束 ${p + 1} / ${n}`;
  $('deckPrev').disabled = p <= 0;
  $('deckNext').disabled = p >= n - 1;
  markShown(mk.order[p]);
  return p;
}
function setPos(p, { smooth = true } = {}) {
  p = markCurrent(p);
  const track = $('deckTrack'), card = track.children[p];
  if (card) track.scrollTo({ left: card.offsetLeft - 16, behavior: smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto' });
}

/* ============ 一覧(棚) ============ */
function passesUi(item) {
  if (U.drawer === 'UNOPENED' && Number(item.clickCount || 0) > 0) return false;
  if (U.drawer === 'FAV' && !isFavorite(item)) return false;
  if (!['ALL', 'UNOPENED', 'FAV'].includes(U.drawer) && (item.projectName || '未分類') !== U.drawer) return false;
  const k = sourceOf(item.url).kind;
  if (U.kind === 'quick' && k !== 'quick') return false;
  if (U.kind === 'deep' && k !== 'deep') return false;
  return true;
}
function libList() {
  const list = state.items.filter(item => !item.archived && passesUi(item));
  const by = {
    recent: (a, b) => timeValue(b.addedAt) - timeValue(a.addedAt),
    oldest: (a, b) => timeValue(a.addedAt) - timeValue(b.addedAt),
    unopened: (a, b) => (Number(a.clickCount || 0) > 0) - (Number(b.clickCount || 0) > 0) || timeValue(b.addedAt) - timeValue(a.addedAt),
    clicked: (a, b) => timeValue(b.lastClickedAt) - timeValue(a.lastClickedAt) || timeValue(b.addedAt) - timeValue(a.addedAt),
    clicks: (a, b) => Number(b.clickCount || 0) - Number(a.clickCount || 0) || timeValue(b.addedAt) - timeValue(a.addedAt),
    project: (a, b) => String(a.projectName || '').localeCompare(String(b.projectName || ''), 'ja') || view(a).title.localeCompare(view(b).title, 'ja'),
    title: (a, b) => view(a).title.localeCompare(view(b).title, 'ja')
  };
  return list.sort(by[state.linkSort] || by.recent);
}
function urlPreview(url) {
  try {
    const u = new URL(String(url || ''));
    const host = u.hostname.replace(/^www\./i, '');
    const parts = u.pathname.split('/').filter(Boolean);
    const shown = parts.slice(0, 2).map(seg => {
      let value = seg;
      try { value = decodeURIComponent(seg); } catch {}
      return value.length > 28 ? `${value.slice(0, 27)}…` : value;
    });
    return {
      host,
      path: [...shown, ...(parts.length > 2 ? ['…'] : [])].join(' › ')
    };
  } catch {
    const plain = String(url || '')
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .split(/[?#]/)[0];
    const [host = '', ...rest] = plain.split('/').filter(Boolean);
    const shown = rest.slice(0, 2);
    return { host, path: [...shown, ...(rest.length > 2 ? ['…'] : [])].join(' › ') };
  }
}
function itemHtml(item, q = '', idx = null) {
  const v = view(item), c = Number(item.clickCount || 0), up = urlPreview(item.url);
  return `<article class="item${idx !== null && idx === U.active ? ' is-active' : ''}" data-id="${escapeHtml(item.id)}" id="item-${escapeHtml(item.id)}">
    <a class="item-main" href="${escapeHtml(item.url)}" target="_blank" rel="noopener">
      <span class="item-meta"><span class="src">${escapeHtml(v.src)}</span><span class="mood">${dot(item.projectName)}${escapeHtml(item.projectName || '未分類')}</span><span>${escapeHtml(agoText(ageDays(item)))}</span>${c ? `<span>${c}回開いた</span>` : ''}${isFavorite(item) ? '<span aria-label="お気に入り">★</span>' : ''}</span>
      <span class="item-title clamp2">${highlight(v.title, q)}</span>
      <span class="item-url" aria-hidden="true"><span class="item-url-host">${escapeHtml(up.host)}</span>${up.path ? `<span class="item-url-path"> › ${escapeHtml(up.path)}</span>` : ''}</span>
      ${v.desc ? `<span class="item-desc clamp3">${highlight(v.desc, q)}</span>` : ''}
    </a>
    <div class="item-foot"><span class="by">${escapeHtml(v.by)}</span><button class="item-more" type="button" aria-label="${escapeHtml(v.title.slice(0, 20))}の詳細と操作">${ICON.more}</button></div>
  </article>`;
}
function rowHtml(p, q = '', idx = null) {
  return `<div class="row${(idx !== null && idx === U.active) || (U.sel && U.sel.id === p.id && U.view === 'prompts') ? ' is-active' : ''}" data-kind="prompt" data-id="${escapeHtml(p.id)}" id="row-${escapeHtml(p.id)}"><button class="row-main" type="button">${dot(p.categoryName)}<span class="title">${highlight(p.title, q)}</span><span class="meta"><span>${escapeHtml(p.categoryName)}</span><span>${p.body.length.toLocaleString()}字</span><span>${Number(p.copyCount || 0)}回</span></span></button><button class="row-copy" type="button" aria-label="${escapeHtml(p.title)}をコピー">コピー</button></div>`;
}
function searchResultList() {
  const q = U.query.trim();
  const links = q ? searchLinks(q) : [];
  const prompts = q ? searchPrompts(q) : [];
  return { links, prompts, combined: [...links.slice(0, 20).map(item => ({ kind: 'link', item })), ...prompts.slice(0, 20).map(item => ({ kind: 'prompt', item }))] };
}
function renderLib() {
  const q = U.query.trim();
  const showLib = U.view === 'links' || q;
  $('lib').hidden = !showLib;
  $('libHead').hidden = !showLib;
  if (!showLib) return;
  const sel = $('sortSelect');
  if (q) {
    const r = searchResultList();
    $('libTitle').textContent = `「${q}」`;
    $('libCount').textContent = `${r.links.length + r.prompts.length}件`;
    sel.hidden = true;
    let i = 0, html = '';
    if (r.links.length) {
      html += `<div class="group-head">リンク <span class="n">${r.links.length}件</span></div><div class="grid">${r.links.slice(0, 20).map(l => itemHtml(l, q, i++)).join('')}</div>`;
      if (r.links.length > 20) html += `<div class="group-more">ほか${r.links.length - 20}件</div>`;
    }
    if (r.prompts.length) html += `<div class="group-head">プロンプト <span class="n">${r.prompts.length}件</span></div><div role="list">${r.prompts.slice(0, 20).map(p => rowHtml(p, q, i++)).join('')}</div>`;
    $('lib').innerHTML = html || `<div class="empty"><b>見つかりませんでした</b>別の言葉か、ひらがなで打ってみてください。</div>`;
    $('lib').classList.add('list1');
    return;
  }
  $('lib').classList.remove('list1');
  sel.hidden = false;
  const name = U.drawer === 'ALL' ? 'ぜんぶ' : U.drawer === 'UNOPENED' ? 'まだ開いていない' : U.drawer === 'FAV' ? 'お気に入り' : U.drawer;
  const list = libList();
  $('libTitle').textContent = name + (U.kind === 'quick' ? '(さっと)' : U.kind === 'deep' ? '(じっくり)' : '');
  $('libCount').textContent = `${list.length}件`;
  const opts = [['recent', '新しい順'], ['oldest', '寝かせた順(古い順)'], ['unopened', 'まだ開いていない順'], ['clicked', '最近開いた順'], ['clicks', 'よく開く順'], ['project', '引き出し順'], ['title', '名前順']];
  sel.innerHTML = opts.map(([v, t]) => `<option value="${v}" ${state.linkSort === v ? 'selected' : ''}>${t}</option>`).join('');
  if (!list.length) { $('lib').innerHTML = `<div class="empty"><b>まだありません</b>「保存」から追加できます。</div>`; return; }
  if (state.linkSort === 'recent' || state.linkSort === 'oldest') {
    const groups = new Map();
    list.forEach(l => { const d = new Date(l.addedAt), k = `${d.getFullYear()}年${d.getMonth() + 1}月`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(l); });
    $('lib').innerHTML = [...groups].map(([k, arr]) => `<div class="month">${k}に保存 <span class="n">${arr.length}件</span></div><div class="grid">${arr.map(l => itemHtml(l)).join('')}</div>`).join('');
  } else {
    $('lib').innerHTML = `<div class="grid" style="margin-top:12px">${list.map(l => itemHtml(l)).join('')}</div>`;
  }
}

/* ============ プロンプト ============ */
function promptDetail(p) {
  return `<div class="d"><div class="d-top"><span class="d-cat">${dot(p.categoryName)}${escapeHtml(p.categoryName)}</span><h2>${escapeHtml(p.title)}</h2><div class="d-facts"><span>${p.body.length.toLocaleString()}字</span><span>${Number(p.copyCount || 0)}回コピー</span></div></div><div class="d-actions"><button class="btn primary" type="button" data-pcopy="${escapeHtml(p.id)}">コピー</button><button class="btn" type="button" data-pedit="${escapeHtml(p.id)}">編集</button></div><div class="d-sec"><h3>本文</h3><pre class="d-body">${escapeHtml(p.body)}</pre></div></div>`;
}
function renderPrompts() {
  const show = U.view === 'prompts' && !U.query.trim();
  $('pview').hidden = !show;
  if (!show) return;
  const recent = getRecentPrompts();
  const dormant = getDormantPrompt(recent);
  $('reuse').innerHTML = recent.length || dormant
    ? `<span class="lab">最近</span>${recent.map(p => `<button type="button" data-copy="${escapeHtml(p.id)}">${escapeHtml(p.title)}</button>`).join('')}${dormant ? `<span class="lab">久しぶり</span><button type="button" class="dormant" data-copy="${escapeHtml(dormant.memo.id)}">${escapeHtml(dormant.memo.title)}</button>` : ''}`
    : '';
  const list = state.promptMemos.slice().sort((a, b) => Number(b.copyCount || 0) - Number(a.copyCount || 0) || timeValue(b.updatedAt) - timeValue(a.updatedAt));
  $('promptList').innerHTML = list.map(p => rowHtml(p)).join('') || `<div class="empty"><b>まだありません</b>「＋ プロンプトを保存」から追加できます。</div>`;
  const sel = U.sel && U.sel.kind === 'prompt' ? find('prompt', U.sel.id) : null;
  $('promptPane').innerHTML = sel ? promptDetail(sel) : `<div class="hints"><h2>プロンプト</h2><div class="hint-row"><span class="kbd">クリック</span><span>本文を右に出す</span></div><div class="hint-row"><span class="kbd">コピー</span><span>そのままコピー</span></div></div>`;
}

/* ============ 管理 ============ */
function renderManage() {
  const el = $('manage');
  if (el.dataset.built !== '1') {
    el.dataset.built = '1';
    el.innerHTML = `<h2>管理</h2>
      <div class="m-sec" id="manageSync"></div>
      <div class="m-sec" id="care"></div>
      <div class="m-sec"><h3>データ</h3><p>JSONで書き出し・読み込みができます。形式はこれまでと同じです。</p>
        <div class="m-row"><button class="btn" type="button" id="exportBtn">JSONを書き出す</button></div>
        <div class="m-row"><textarea id="importText" class="textarea" placeholder="ここにJSONを貼り付け"></textarea></div>
        <div class="m-row"><label class="switch"><input type="radio" name="importMode" id="importModeMerge" value="merge" checked>統合</label><label class="switch"><input type="radio" name="importMode" id="importModeReplace" value="replace">置き換え</label><button class="btn primary" type="button" id="runImportBtn">取り込む</button></div>
      </div>
      <div class="m-sec"><h3>ブックマークレット</h3><p>「Quick Linksに追加」をブックマークバーへドラッグしておくと、見ているページをその場で保存・更新できます。</p>
        <div class="m-row"><a class="btn" id="bookmarkletLink" href="#">Quick Linksに追加</a></div>
      </div>
      <div class="m-sec"><h3>iPhoneの共有から保存</h3><p>ショートカットを作ると、Xのアプリなどで見ているページを共有シートからそのまま保存できます。</p>
        <ol style="margin:0;padding-left:18px;display:grid;gap:6px;font-size:13px;color:var(--ink2);line-height:1.7">
          <li>ショートカットAppで新規作成し、名前を「Quick Linksに保存」にする</li>
          <li>詳細で「共有シートに表示」をオンにし、受け付ける種類を「URL」にする</li>
          <li>アクション「URLエンコード」を足し、入力を「ショートカットの入力」にする</li>
          <li>アクション「テキスト」を足し、<code>https://silovar-uk.github.io/quicklinks/#save=</code> のすぐ後ろに、手順3の結果を差し込む</li>
          <li>アクション「URLを開く」を足し、手順4のテキストを渡す</li>
        </ol>
        <p class="diff-note">使い方:共有したいページで共有→「Quick Linksに保存」→Safariで保存シートが開く→引き出しを選んで保存。</p>
      </div>
      <div class="m-sec"><h3>重複の整理・リセット</h3><p>完全に同じ内容のリンク・プロンプトをまとめます。リセットはこの端末のデータを消します。</p>
        <div class="m-row"><button class="btn" type="button" id="dedupeBtn">完全重複を整理</button><button class="btn danger" type="button" id="resetAllBtn">この端末のデータをリセット</button></div>
      </div>`;
    $('exportBtn').addEventListener('click', () => { exportData(); toast('JSONを書き出しました'); });
    $('runImportBtn').addEventListener('click', () => {
      const mode = $('importModeReplace').checked ? 'replace' : 'merge';
      const text = $('importText').value.trim();
      if (!text) { toast('JSONを入力してください'); return; }
      try {
        const r = importFromText(text, mode);
        if (r.empty) { toast('取り込めるデータが見つかりません'); return; }
        $('importText').value = '';
        render();
        toast(r.replaced ? `置き換えました：リンク${r.linkAdd}件 / プロンプト${r.promptAdd}件` : `統合しました：リンク追加${r.linkAdd}件 / プロンプト追加${r.promptAdd}件`);
      } catch (error) {
        toast('JSONの形式を確認してください');
      }
    });
    $('bookmarkletLink').setAttribute('href', createDirectBookmarkletCode());
    $('dedupeBtn').addEventListener('click', () => {
      const r = dedupe();
      toast(r.removedLinks || r.removedPrompts ? '重複を整理しました' : '完全重複はありませんでした');
      if (r.removedLinks || r.removedPrompts) render();
    });
    $('resetAllBtn').addEventListener('click', () => {
      if (!confirm('このブラウザ内のデータをすべて削除しますか？')) return;
      resetAll();
      render();
      toast('リセットしました');
    });
  }
  renderCare();
  window.dispatchEvent(new CustomEvent('quicklinks-sync-meta'));
}

/* ============ 情報の手入れ(管理の#care。計画書7章) ============ */
const CARE = { running: false, log: [] };
function fetchFailureText(reason) {
  if (reason === 'login') return 'ログインが必要なページのようです。外からは中身を読めないため、取得しません。そのページを開いてブックマークレットを押すと、表示中のタイトルと説明で保存・更新できます。';
  if (reason === 'rate') return '今日の取得枠を使い切りました。URLだけでも保存できます。取得は明日また試せます。';
  if (reason === 'suspicious') return 'ログイン画面やエラー画面のようです。URLだけでも保存できます。';
  if (reason === 'network') return '取得できませんでした（通信エラー）。URLだけでも保存できます。';
  return '取得できませんでした（時間切れ）。URLだけでも保存できます。';
}
function renderCare() {
  const el = $('care');
  if (!el || $('manage').hidden) return;
  const c = careCandidates();
  const queued = RF.queue.length > 0;
  const paused = !CARE.running && queued && RF.pos < RF.queue.length;
  const finishedJustNow = !CARE.running && queued && RF.pos >= RF.queue.length && CARE.log.length > 0;
  const total = queued ? RF.queue.length : c.fetchable.length;
  const done = queued ? RF.pos : 0;
  const label = CARE.running ? '取り直しています…' : paused ? '続きから取り直す' : `取り直す（${c.fetchable.length}件）`;
  const canRun = !CARE.running && (paused || c.fetchable.length > 0);
  el.innerHTML = `<h3>情報の手入れ</h3>
    <div class="care-stats"><div class="care-stat"><b>${c.noDescription}</b><span>説明がないリンク</span></div><div class="care-stat"><b>${c.placeholder}</b><span>タイトルがURLのまま</span></div><div class="care-stat"><b>${c.login.length}</b><span>外から読めないページ</span></div></div>
    <p>タイトルとページの説明だけを補います。自分メモには触れません。取得に使う外部サービスの無料枠は1日25件です。枠がなくなったら止まり、翌日に続きから再開できます。</p>
    <div class="m-row"><button class="btn primary" type="button" id="careRun" ${canRun ? '' : 'disabled'}>${label}</button>${RF.batch && RF.batch.length ? `<button class="btn" type="button" id="careUndo">${ICON.undo}いまの手入れを元に戻す</button>` : ''}</div>
    ${CARE.running || paused || finishedJustNow ? `<div class="progress" aria-hidden="true"><i style="width:${total ? Math.round(done / total * 100) : 0}%"></i></div><p aria-live="polite">${CARE.running ? `取り直しています… ${done} / ${total}件` : paused ? `今日の取得枠を使い切りました。${done} / ${total}件まで終わりました。続きは明日の朝から再開できます。` : `終わりました。説明や題名を入れた${CARE.log.filter(x => x.ok).length}件・取得できなかった${CARE.log.filter(x => !x.ok).length}件`}</p><ul class="care-log">${CARE.log.slice().reverse().map(x => `<li><span class="st ${x.ok ? 'ok' : 'ng'}">${x.ok ? '✓' : '×'}</span><span>${escapeHtml(x.name)}${x.msg ? `・${escapeHtml(x.msg)}` : ''}</span></li>`).join('')}</ul>` : ''}
    <p class="diff-note">外から読めないページ（Notion・Googleドキュメントなど）は、そのページを開いてブックマークレット「Quick Linksに追加」を押すと、表示中のタイトルと説明で更新できます。</p>`;
}
async function startCareRun() {
  if (CARE.running) return;
  if (!RF.queue.length || RF.pos >= RF.queue.length) {
    const c = careCandidates();
    if (!c.fetchable.length) return;
    RF.queue = c.fetchable.map(item => item.id);
    RF.pos = 0;
    RF.batch = [];
    CARE.log = [];
    saveRF();
  }
  CARE.running = true;
  renderCare();
  let changed = false;
  while (RF.pos < RF.queue.length) {
    if (refetchBlocked() || RF.used >= REFETCH_DAILY_LIMIT) break;
    const id = RF.queue[RF.pos];
    const item = find('link', id);
    RF.pos += 1;
    if (!item) { saveRF(); continue; }
    let r;
    try { r = await fetchPageMetadata(item.url, { bulk: true }); }
    catch { r = { ok: false, reason: 'network' }; }
    if (!r.ok) {
      markFetchFailed(id);
      CARE.log.push({ ok: false, name: view(item).title.slice(0, 30), msg: r.reason === 'rate' ? '今日の取得枠が終わりました' : '取得できませんでした' });
      saveRF();
      renderCare();
      if (r.reason === 'rate') break;
      continue;
    }
    const before = { id: item.id, title: item.title, description: item.description, descriptionSource: item.descriptionSource, descriptionUpdatedAt: item.descriptionUpdatedAt };
    let changedTitle = false, changedDescription = false;
    if (looksPlaceholder(item.title, item.url) && r.data.title) { item.title = r.data.title; changedTitle = true; }
    if (!item.description && r.data.description) {
      item.description = r.data.description;
      item.descriptionSource = String(r.data.source || r.data.provider || '');
      item.descriptionUpdatedAt = new Date().toISOString();
      changedDescription = true;
    }
    if (changedTitle || changedDescription) { RF.batch.push(before); changed = true; }
    CARE.log.push({ ok: changedTitle || changedDescription, name: view(item).title.slice(0, 30), msg: changedTitle || changedDescription ? [changedTitle && 'タイトル', changedDescription && '説明'].filter(Boolean).join('と') + 'を入れました' : '変更なし' });
    saveRF();
    renderCare();
  }
  CARE.running = false;
  if (RF.pos >= RF.queue.length) { RF.queue = []; RF.pos = 0; saveRF(); }
  if (changed) { save(); render(); } else renderCare();
}
function undoCare() {
  if (!RF.batch || !RF.batch.length) return;
  RF.batch.forEach(b => { const item = find('link', b.id); if (item) { item.title = b.title; item.description = b.description || ''; item.descriptionSource = b.descriptionSource || ''; item.descriptionUpdatedAt = b.descriptionUpdatedAt || null; item.updatedAt = new Date().toISOString(); } });
  RF.batch = [];
  saveRF();
  CARE.log = [];
  save(); render();
  toast('手入れの前に戻しました');
}

/* ============ ブックマークレット(#add=) ============ */
const BOOKMARKLET_TARGET = 'https://silovar-uk.github.io/quicklinks/';
function createDirectBookmarkletCode() {
  const target = JSON.stringify(BOOKMARKLET_TARGET);
  return `javascript:(()=>{const c=(v,n)=>String(v||'').replace(/\\s+/g,' ').trim().slice(0,n);const m=s=>document.querySelector(s)?.content||'';const u=location.href;if(!/^https?:/i.test(u)){alert('http / https のページだけ追加できます');return}const p={v:1,url:u,title:c(document.title,300),description:c(m('meta[name="description"]')||m('meta[property="og:description"]')||m('meta[name="twitter:description"]')||'',600)};location.href=${target}+'#add='+encodeURIComponent(JSON.stringify(p))})()`;
}
function decodeAddPayload() {
  if (!location.hash.startsWith('#add=')) return null;
  const raw = location.hash.slice('#add='.length);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw));
    const url = (() => { try { const u = new URL(String(parsed?.url || '')); return ['http:', 'https:'].includes(u.protocol) ? u.href : ''; } catch { return ''; } })();
    if (!url) return null;
    return { url, title: String(parsed?.title || '').slice(0, 300), description: String(parsed?.description || '').slice(0, 1000) };
  } catch { return null; }
}
function clearAddHash() {
  if (!location.hash.startsWith('#add=')) return;
  history.replaceState(null, '', location.pathname + location.search);
}
function handleAddHash() {
  const payload = decodeAddPayload();
  if (!location.hash.startsWith('#add=')) return;
  clearAddHash();
  if (!payload) { toast('ブックマークレットのデータを読み取れませんでした'); return; }
  openLinkSheet({ bm: payload });
}

// iPhoneの共有シート(ショートカット)から #save=URL で開かれたとき。読み取ったらすぐハッシュを消し、
// 保存は本人が押すまでしない(外から細工したリンクで勝手に保存されないように)
function decodeSaveHash() {
  if (!location.hash.startsWith('#save=')) return null;
  const raw = location.hash.slice('#save='.length);
  if (!raw) return null;
  let url = '';
  try { url = decodeURIComponent(raw); } catch { return null; }
  return /^https?:\/\//i.test(url) ? url : null;
}
function handleSaveHash() {
  if (!location.hash.startsWith('#save=')) return;
  const url = decodeSaveHash();
  history.replaceState(null, '', location.pathname + location.search);
  if (!url) { toast('共有されたURLを読み取れませんでした'); return; }
  openLinkSheet({ url });
}

/* ============ 知らせ(トースト) ============ */
toast = function (message, opt = {}) {
  const el = $('toast');
  clearTimeout(toast.t);
  el.innerHTML = `<span class="msg">${escapeHtml(message)}${opt.hint ? `<span class="hint">${escapeHtml(opt.hint)}</span>` : ''}</span>${opt.action ? `<button type="button">${escapeHtml(opt.action.label)}</button>` : ''}`;
  el.hidden = false;
  if (opt.action) el.querySelector('button').onclick = () => { el.hidden = true; opt.action.fn(); };
  toast.t = setTimeout(() => { el.hidden = true; }, opt.ms || 2200);
};

async function writeClip(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.append(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* 失敗はそのまま呼び出し側へ */ }
    ta.remove();
    return ok;
  }
}
function flashCopied(btn) {
  if (!btn) return;
  const old = btn.textContent;
  btn.classList.add('done');
  btn.textContent = '✓ コピー';
  setTimeout(() => { btn.classList.remove('done'); btn.textContent = old; }, 900);
}

/* ============ リンクを開く・手放す ============ */
function openLink(id) {
  const item = find('link', id);
  if (!item) return;
  const now = new Date().toISOString();
  item.clickCount = Number(item.clickCount || 0) + 1;
  item.lastClickedAt = now;
  item.clickHistory = [...(item.clickHistory || []), now].slice(-100);
  save();
  render();
}
// 束は組み直さず、その1枚だけを抜く(いま選んでいる引き出し・見る長さの束の位置を保つ)
function letGo(id) {
  const item = find('link', id);
  if (!item) return;
  const title = view(item).title.slice(0, 24);
  const deckKey = `${U.drawer}|${U.kind}`;
  const snapshot = letGoLink(id, deckKey);
  render();
  toast(`手放しました：${title}`, { action: { label: '元に戻す', fn: () => { restoreLetGo(snapshot); render(); toast('元に戻しました'); } }, ms: 5000 });
}

/* ============ 詳細シート ============ */
function currentDeckMem() { return deck(U.drawer, U.kind).mem || {}; }
function linkDetail(item) {
  const v = view(item), r = reasonOf(item, currentDeckMem()), c = Number(item.clickCount || 0);
  return `<div class="d"><div class="d-top"><span class="d-cat">${escapeHtml(v.src)}・${dot(item.projectName)}${escapeHtml(item.projectName || '未分類')}${isFavorite(item) ? '・★' : ''}</span><h2>${escapeHtml(v.title)}</h2>${v.by ? `<div class="d-facts"><span>${escapeHtml(v.by)}</span></div>` : ''}<div class="d-facts"><span>${escapeHtml(formatDate(item.addedAt))}に保存(${escapeHtml(r.text)})</span><span>${c ? `${c}回開いた` : 'まだ開いていない'}</span></div></div>
    <div class="d-actions"><a class="btn primary" href="${escapeHtml(item.url)}" target="_blank" rel="noopener" data-open>開く</a><button class="btn" type="button" data-act="copyurl">URLをコピー</button><button class="btn" type="button" data-act="edit">編集</button><button class="btn" type="button" data-act="refetch">ページ情報を取り直す</button><button class="btn quiet" type="button" data-act="letgo">手放す</button></div>
    <div class="d-sec"><h3>自分メモ</h3><p class="d-note ${item.note ? '' : 'none'}">${escapeHtml(item.note || '') || 'まだありません。編集から自分用のメモを残せます。'}</p></div>
    <div class="d-sec"><h3>ページの説明</h3><p class="d-note ${item.description ? '' : 'none'}">${escapeHtml(item.description || '') || 'まだ取得していません。「ページ情報を取り直す」で取得できます。'}</p></div>
    <div class="d-sec"><h3>URL</h3><div class="d-url">${escapeHtml(item.url)}</div></div></div>`;
}
function showSheet(el) { if (!el.open) el.showModal(); }
function closeSheet(el) { if (el && el.open) el.close(); }
function openDetail(kind, id) {
  const it = find(kind, id);
  if (!it) return;
  U.sel = { kind, id };
  $('detailSheetTitle').textContent = kind === 'link' ? view(it).src : 'プロンプト';
  $('detailSheetBody').innerHTML = kind === 'link' ? linkDetail(it) : promptDetail(it);
  showSheet($('detailSheet'));
}
// 束のカードの「説明がありません。ページ情報を取り直す」用。空いている所だけ静かに埋める(差分は出さない)
async function refetchQuiet(item) {
  let r;
  try { r = await fetchPageMetadata(item.url, {}); }
  catch { toast('取り直せませんでした'); return; }
  if (!r.ok) { if (r.reason !== 'login') markFetchFailed(item.id); toast(fetchFailureText(r.reason)); return; }
  let changed = false;
  if (!item.description && r.data.description) {
    item.description = r.data.description;
    item.descriptionSource = String(r.data.source || r.data.provider || '');
    item.descriptionUpdatedAt = new Date().toISOString();
    changed = true;
  }
  if (looksPlaceholder(item.title, item.url) && r.data.title) { item.title = r.data.title; changed = true; }
  if (changed) { item.updatedAt = new Date().toISOString(); save(); render(); toast('ページ情報を取り直しました'); }
  else toast('新しく入れる内容はありませんでした');
}
function detailAction(name, kind, id) {
  const it = find(kind, id);
  if (!it) return;
  if (name === 'copyurl') return writeClip(it.url).then(ok => toast(ok ? 'URLをコピーしました' : 'コピーできませんでした'));
  if (name === 'edit') return openLinkSheet({ mode: 'edit', id });
  if (name === 'refetch') { openLinkSheet({ mode: 'edit', id }); refetchInSheet(); return; }
  if (name === 'letgo') return letGo(id);
}

/* ============ 保存・編集シート ============ */
const F = { mode: 'add', id: null, cat: '', comboIdx: -1, bm: null, controller: null, seq: 0, lastUrl: '', descriptionSource: '', descriptionUpdatedAt: null };
function recentCats() {
  const seen = [];
  state.items.slice().sort((a, b) => timeValue(b.addedAt) - timeValue(a.addedAt)).forEach(i => { const n = i.projectName || '未分類'; if (!seen.includes(n)) seen.push(n); });
  return seen.slice(0, 6);
}
function saveLabel() {
  if (F.mode === 'edit') return '保存';
  if (F.bm && !F.cat) return '引き出しを選んでください';
  return F.cat ? `「${F.cat}」に保存` : '未分類で保存';
}
function setCat(name) {
  F.cat = String(name || '').trim();
  $('fCat').value = F.cat;
  $$('#fRecent button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.cat === F.cat)));
  $('fSave').textContent = saveLabel();
  $('fSave').disabled = !!(F.bm && !F.cat && F.mode !== 'edit');
  closeCombo();
}
function abortFetchController() { if (F.controller) { F.controller.abort(); F.controller = null; } }
function setStatus(kind, html) {
  const s = $('fStatus');
  s.hidden = false; s.className = 'status ' + kind; s.innerHTML = html; s.setAttribute('aria-busy', String(kind === 'busy'));
}
function setDescriptionField(value, source = '', updatedAt = null) {
  const text = String(value || '');
  $('fDescription').value = text;
  $('fDescriptionField').hidden = !text;
  F.descriptionSource = text ? String(source || '') : '';
  F.descriptionUpdatedAt = text ? (updatedAt || new Date().toISOString()) : null;
}
function checkDup() {
  const u = $('fUrl').value.trim();
  const dup = F.mode === 'add' ? findDuplicate(u) : null;
  const el = $('fDup');
  el.hidden = !dup;
  if (dup) el.innerHTML = `<span>保存済みです：${escapeHtml(view(dup).title.slice(0, 40))}（${escapeHtml(dup.projectName || '未分類')}）</span><div class="m-row"><button class="btn" type="button" data-dup-open="${escapeHtml(dup.id)}">そちらを開く</button><button class="btn" type="button" data-dup-edit="${escapeHtml(dup.id)}">そちらを編集</button></div>`;
  return dup;
}
async function startFetch() {
  const url = $('fUrl').value.trim();
  if (!/^https?:\/\//.test(url)) return;
  // テキスト欄からフォーカスが外れると、値が変わっていなくてもブラウザがchangeを再送ることがある。
  // 同じURLでの取り直しはここで止める(取得中に二重で始めない)
  if (url === F.lastUrl) return;
  F.lastUrl = url;
  abortFetchController();
  F.controller = new AbortController();
  const seq = ++F.seq;
  setStatus('busy', `<span class="spin" aria-hidden="true"></span><span class="grow">ページ情報を取得しています…（待たずに保存できます）</span>`);
  let r;
  try { r = await fetchPageMetadata(url, { signal: F.controller.signal }); }
  catch { return; } // 中止された(シートを閉じた・開き直した)
  if (seq !== F.seq || !$('linkSheet').open) return;
  if (!r.ok) {
    if (r.reason === 'login') { if (!$('fTitle').value) $('fTitle').value = hostOf(url); setStatus('warn', `<span class="grow">${fetchFailureText('login')}</span>`); return; }
    setStatus('bad', `<span class="grow">${fetchFailureText(r.reason)}</span><button class="btn" type="button" id="fRetry">もう一度取得</button>`);
    return;
  }
  if (!$('fTitle').value) $('fTitle').value = r.data.title;
  if (!$('fDescription').value && r.data.description) setDescriptionField(r.data.description, r.data.source || r.data.provider || '');
  setStatus('ok', `<span class="grow">タイトルとページの説明を取得しました。自分メモは別に残せます。</span>`);
}
// 編集シート・詳細シートの「ページ情報を取り直す」。結果は差分で出し、フォームに反映してから保存で確定する
async function refetchInSheet() {
  const url = $('fUrl').value.trim();
  if (!/^https?:\/\//.test(url)) return;
  abortFetchController();
  F.controller = new AbortController();
  const seq = ++F.seq;
  $('fDiff').hidden = true;
  setStatus('busy', `<span class="spin" aria-hidden="true"></span><span class="grow">ページ情報を取り直しています…</span>`);
  let r;
  try { r = await fetchPageMetadata(url, { signal: F.controller.signal }); }
  catch { return; }
  if (seq !== F.seq || !$('linkSheet').open) return;
  if (!r.ok) {
    if (r.reason === 'login') { setStatus('warn', `<span class="grow">${fetchFailureText('login')}いまの内容はそのまま残します。</span>`); return; }
    if (F.id) markFetchFailed(F.id);
    setStatus('bad', `<span class="grow">${fetchFailureText(r.reason)}</span><button class="btn" type="button" id="fRetry">もう一度</button>`);
    return;
  }
  $('fStatus').hidden = true;
  const cur = { title: $('fTitle').value, description: $('fDescription').value };
  F.got = r.data;
  showDiff({ heading: '取り直したページ情報', cur, got: r.data, titleDefault: looksPlaceholder(cur.title, url) });
}
function showDiff({ heading, cur, got, titleDefault }) {
  const d = $('fDiff');
  d.hidden = false;
  d.innerHTML = diffHtml(cur, got, { heading, titleDefault });
}
function diffHtml(cur, got, { heading, titleDefault }) {
  const t = got.title && got.title !== cur.title;
  const d = got.description && got.description !== cur.description;
  if (!t && !d) return `<h3>${escapeHtml(heading)}</h3><p class="diff-note">いまの内容と同じでした。</p>`;
  return `<h3>${escapeHtml(heading)}</h3>` +
    (t ? `<div class="diff-item"><label><input type="checkbox" id="dTitle" ${titleDefault ? 'checked' : ''}><span><b>タイトル</b>を「${escapeHtml(got.title)}」にする</span></label><span class="was">いま：<s>${escapeHtml(cur.title || '(空)')}</s></span></div>` : '') +
    (d ? `<div class="diff-item"><label><input type="checkbox" id="dDescription" checked><span><b>ページの説明</b>を更新する</span></label><span class="was">取得：${escapeHtml(got.description)}</span>${cur.description ? `<span class="was">いま：<s>${escapeHtml(cur.description)}</s></span>` : ''}</div>` : '') +
    `<div class="m-row"><button class="btn primary" type="button" id="dApply">フォームに反映</button><span class="diff-note">自分メモは変更しません。保存するまで確定しません</span></div>`;
}
function applyDiff() {
  const g = F.got;
  if (!g) return;
  if ($('dTitle')?.checked) $('fTitle').value = g.title;
  if ($('dDescription')?.checked) setDescriptionField(g.description, g.source || g.provider || '');
  $('fDiff').hidden = true;
  toast('フォームに反映しました。自分メモはそのままです');
}
function handleBookmarklet(bm) {
  const dup = state.items.find(i => canonicalUrl(i.url) === canonicalUrl(bm.url));
  if (!dup) {
    $('fTitle').value = bm.title;
    setDescriptionField(bm.description, 'bookmarklet');
    setStatus('ok', '<span class="grow">表示中のページからタイトルと説明を受け取りました。自分メモは別に残せます。</span>');
    return;
  }
  F.mode = 'edit'; F.id = dup.id; $('fFav').checked = isFavorite(dup); setCat(dup.projectName);
  $('fTitle').value = dup.title; $('fNote').value = dup.note;
  setDescriptionField(dup.description, dup.descriptionSource, dup.descriptionUpdatedAt);
  setStatus('warn', `<span class="grow">保存済みのリンクです（${escapeHtml(dup.projectName || '未分類')}）。表示中のページ情報だけ更新できます。自分メモは変更しません。</span>`);
  F.got = { title: bm.title, description: bm.description, source: 'bookmarklet' };
  showDiff({ heading: 'このページの内容で更新', cur: { title: dup.title, description: dup.description || '' }, got: F.got, titleDefault: looksPlaceholder(dup.title, dup.url) });
}
function openLinkSheet({ mode = 'add', id = null, url = '', bm = null } = {}) {
  Object.assign(F, { mode, id, bm, seq: F.seq + 1, lastUrl: '' });
  abortFetchController();
  const it = id ? find('link', id) : null;
  $('linkSheetTitle').textContent = mode === 'edit' ? 'リンクを編集' : bm ? 'このページを保存' : 'リンクを保存';
  $('fUrl').value = it ? it.url : (bm ? bm.url : url);
  $('fTitle').value = it ? it.title : '';
  $('fNote').value = it ? it.note : '';
  setDescriptionField(it ? it.description : '', it ? it.descriptionSource : '', it ? it.descriptionUpdatedAt : null);
  $('fFav').checked = it ? isFavorite(it) : false;
  $('fRefetch').hidden = mode !== 'edit';
  $('fDiff').hidden = true; $('fDup').hidden = true; $('fStatus').hidden = true;
  $('fPaste').hidden = mode === 'edit';
  $('fRecent').innerHTML = recentCats().map(c => `<button type="button" data-cat="${escapeHtml(c)}" aria-pressed="false">${dot(c)}${escapeHtml(c)}</button>`).join('');
  setCat(it ? it.projectName : (!['ALL', 'UNOPENED', 'FAV'].includes(U.drawer) ? U.drawer : ''));
  $('fPage').hidden = !bm;
  if (bm) $('fPage').innerHTML = `<b>${escapeHtml(bm.title || bm.url)}</b><span>${escapeHtml(bm.url)}</span>`;
  showSheet($('linkSheet'));
  if (bm) handleBookmarklet(bm);
  else if (url) { checkDup(); startFetch(); }
  if (mode === 'add' && !url && !bm) $('fUrl').focus(); else $('fCat').focus();
}
async function enrichSavedLink(id) {
  const item = find('link', id);
  if (!item || item.archived) return;
  if (!looksPlaceholder(item.title, item.url) && item.description) return;

  let r;
  try { r = await fetchPageMetadata(item.url); }
  catch { return; }
  if (!r.ok) return;

  const latest = find('link', id);
  if (!latest || latest.archived || latest.url !== item.url) return;

  let changed = false;
  if (looksPlaceholder(latest.title, latest.url) && r.data.title && !looksSuspicious(r.data)) {
    latest.title = r.data.title;
    changed = true;
  }
  if (!latest.description && r.data.description) {
    latest.description = r.data.description;
    latest.descriptionSource = String(r.data.source || r.data.provider || '');
    latest.descriptionUpdatedAt = new Date().toISOString();
    changed = true;
  }
  if (!changed) return;

  latest.updatedAt = new Date().toISOString();
  save();
  render();
}

function saveLink() {
  const url = $('fUrl').value.trim();
  if (!/^https?:\/\//.test(url)) { setStatus('bad', '<span class="grow">http:// か https:// で始まるURLを入れてください。</span>'); $('fUrl').focus(); return; }
  if (F.bm && !F.cat && F.mode !== 'edit') return;
  const title = $('fTitle').value.trim() || hostOf(url);
  const projectName = F.cat || '未分類';
  let item;
  if (F.mode === 'edit') {
    item = find('link', F.id);
    Object.assign(item, { url, title, projectName, description: $('fDescription').value, descriptionSource: F.descriptionSource, descriptionUpdatedAt: F.descriptionUpdatedAt, note: $('fNote').value, isFavorite: $('fFav').checked, favoriteType: $('fFav').checked ? 'normal' : 'none', updatedAt: new Date().toISOString() });
  } else {
    item = { id: uid('link'), title, url, projectName, description: $('fDescription').value, descriptionSource: F.descriptionSource, descriptionUpdatedAt: F.descriptionUpdatedAt, note: $('fNote').value, isFavorite: $('fFav').checked, favoriteType: $('fFav').checked ? 'normal' : 'none', favoriteExpiry: null, addedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastClickedAt: null, clickCount: 0, clickHistory: [], archived: false };
    state.items.unshift(item);
  }
  state.projects = normalizeProjects(state.projects, state.items);
  abortFetchController();
  closeSheet($('linkSheet'));
  U.query = ''; $('searchInput').value = '';
  U.view = 'links';
  if (F.mode !== 'edit') { U.drawer = 'ALL'; U.kind = 'all'; }
  save(); render();
  if (F.mode !== 'edit' && (looksPlaceholder(item.title, item.url) || !item.description)) {
    setTimeout(() => enrichSavedLink(item.id), 0);
  }
  const el = $('item-' + item.id);
  if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); }
  toast(F.mode === 'edit' ? '保存しました' : `保存しました：${projectName}`);
}
function comboOptions() {
  const q = fold($('fCat').value.trim());
  const all = moodCounts().filter(([n]) => !q || fold(n).includes(q));
  const exact = moodCounts().some(([n]) => fold(n) === q);
  return { all, create: q && !exact ? $('fCat').value.trim() : '' };
}
function renderCombo() {
  const { all, create } = comboOptions();
  const box = $('fCatList');
  box.innerHTML = all.map(([n, c], i) => `<div class="opt" role="option" id="opt-${i}" data-cat="${escapeHtml(n)}" aria-selected="false">${dot(n)}${escapeHtml(n)}<span class="n">${c}件</span></div>`).join('') + (create ? `<div class="opt new" role="option" id="opt-new" data-cat="${escapeHtml(create)}" aria-selected="false">＋ 新しい引き出し「${escapeHtml(create)}」を作る</div>` : '');
  box.hidden = !box.children.length;
  $('fCat').setAttribute('aria-expanded', String(!box.hidden));
  F.comboIdx = -1;
}
function closeCombo() { $('fCatList').hidden = true; $('fCat').setAttribute('aria-expanded', 'false'); }
function moveCombo(d) {
  const opts = $$('#fCatList .opt');
  if (!opts.length) return;
  F.comboIdx = (F.comboIdx + d + opts.length) % opts.length;
  opts.forEach((o, i) => o.setAttribute('aria-selected', String(i === F.comboIdx)));
  opts[F.comboIdx].scrollIntoView({ block: 'nearest' });
}

/* ============ プロンプトの保存シート ============ */
const P = { mode: 'add', id: null };
function recentPromptCats() {
  const seen = [];
  state.promptMemos.slice().sort((a, b) => timeValue(b.updatedAt) - timeValue(a.updatedAt)).forEach(p => { const n = p.categoryName || '未分類'; if (!seen.includes(n)) seen.push(n); });
  return seen.slice(0, 6);
}
function renderPromptCombo() {
  const q = fold($('pCat').value.trim());
  const names = [...new Set((state.promptCategories || []).map(v => v))].filter(n => !q || fold(n).includes(q));
  const exact = names.some(n => fold(n) === q);
  const box = $('pCatList');
  box.innerHTML = names.map((n, i) => `<div class="opt" role="option" id="popt-${i}" data-cat="${escapeHtml(n)}" aria-selected="false">${dot(n)}${escapeHtml(n)}</div>`).join('') + (q && !exact ? `<div class="opt new" role="option" data-cat="${escapeHtml($('pCat').value.trim())}">＋ 新しいカテゴリ「${escapeHtml($('pCat').value.trim())}」を作る</div>` : '');
  box.hidden = !box.children.length;
}
function openPromptSheet({ mode = 'add', id = null } = {}) {
  Object.assign(P, { mode, id });
  const p = id ? find('prompt', id) : null;
  $('promptSheetTitle').textContent = mode === 'edit' ? 'プロンプトを編集' : 'プロンプトを保存';
  $('pCat').value = p ? p.categoryName : (!['ALL'].includes(U.drawer) && U.view === 'prompts' ? '' : '');
  $('pTitle').value = p ? p.title : '';
  $('pBody').value = p ? p.body : '';
  $('pDelete').hidden = mode !== 'edit';
  $('pRecent').innerHTML = recentPromptCats().map(c => `<button type="button" data-pcat="${escapeHtml(c)}">${dot(c)}${escapeHtml(c)}</button>`).join('');
  showSheet($('promptSheet'));
  $('pTitle').focus();
}
function savePrompt() {
  const title = $('pTitle').value.trim() || '無題のプロンプト';
  const categoryName = $('pCat').value.trim() || '未分類';
  const body = $('pBody').value;
  if (P.mode === 'edit') {
    const p = find('prompt', P.id);
    Object.assign(p, { title, categoryName, body, updatedAt: new Date().toISOString() });
  } else {
    state.promptMemos.unshift({ id: uid('prompt'), title, categoryName, body, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), copyCount: 0, lastCopiedAt: null });
  }
  state.promptCategories = normalizePromptCategories(state.promptCategories, state.promptMemos);
  closeSheet($('promptSheet'));
  save(); render();
  toast('保存しました');
}
function deletePromptNow(id) {
  const p = find('prompt', id);
  if (!p || !confirm(`プロンプト「${p.title || '無題'}」を削除しますか？`)) return;
  state.promptMemos = state.promptMemos.filter(m => m.id !== id);
  state.promptCategories = normalizePromptCategories(state.promptCategories, state.promptMemos);
  closeSheet($('promptSheet'));
  closeSheet($('detailSheet'));
  save(); render();
  toast('削除しました');
}
// コピーの次へ:4秒以内にもう一度Enterで、よく使うAIツールを開く(スマホでは案内しない)
const NEXT = { id: null, until: 0 };
async function copyPrompt(id, btn) {
  const p = find('prompt', id);
  if (!p) return;
  const ok = await writeClip(p.body);
  if (!ok) { toast('コピーできませんでした。本文を選んでコピーしてください'); return; }
  p.copyCount = Number(p.copyCount || 0) + 1;
  p.lastCopiedAt = new Date().toISOString();
  save(); render();
  flashCopied(btn);
  const ai = !hand() ? bestAiLink() : null;
  if (ai) {
    NEXT.id = ai.id; NEXT.until = Date.now() + 4000;
    const aiTitle = view(ai).title.slice(0, 20);
    toast(`コピーしました：${p.title}`, { hint: `もう一度 Enter で ${aiTitle} を開きます`, action: { label: `${aiTitle}を開く`, fn: () => openLink(ai.id) }, ms: 4000 });
  } else {
    toast(`コピーしました：${p.title}`);
  }
}

/* ============ 引き出しの整理(画面) ============ */
let orgUndo = null, orgUndoTimer = null;
function openMergeDialog(kind, fromName, preferredTarget) {
  const label = kind === 'links' ? '引き出し' : 'カテゴリ';
  const targets = organizerConfig[kind].names().filter(n => n !== fromName);
  if (!targets.length) { toast(`統合先にできる${label}がありません`); return; }
  const selected = targets.includes(preferredTarget) ? preferredTarget : targets[0];
  const fromCount = organizerConfig[kind].count(fromName);
  $('actionTitle').textContent = `${label}を統合`;
  $('actionMenu').innerHTML = `<div style="padding:10px 6px;display:grid;gap:10px">
    <div>移動元 <b>${escapeHtml(fromName)}</b>（${fromCount.toLocaleString()}件）</div>
    <select id="mergeTargetSelect" class="select inp">${targets.map(n => `<option value="${escapeHtml(n)}" ${n === selected ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('')}</select>
    <div id="mergePreview" class="diff-note"></div>
    <button class="btn primary" type="button" id="mergeConfirmBtn"></button>
  </div>`;
  const sel = $('mergeTargetSelect'), preview = $('mergePreview'), confirmBtn = $('mergeConfirmBtn');
  function updatePreview() {
    const toName = sel.value, toCount = organizerConfig[kind].count(toName);
    preview.textContent = `${toName} ${toCount.toLocaleString()}件 → ${(toCount + fromCount).toLocaleString()}件／${fromName} ${fromCount.toLocaleString()}件 → 統合後に消えます`;
    confirmBtn.textContent = `${fromCount.toLocaleString()}件を「${toName}」へ統合`;
  }
  sel.addEventListener('change', updatePreview);
  confirmBtn.addEventListener('click', () => {
    const toName = sel.value;
    const snapshot = performMerge(kind, fromName, toName);
    closeSheet($('actionSheet'));
    render();
    if (snapshot) {
      clearTimeout(orgUndoTimer);
      orgUndo = snapshot;
      orgUndoTimer = setTimeout(() => { orgUndo = null; }, 8000);
      toast(`${snapshot.affectedIds.length.toLocaleString()}件を「${toName}」へ統合しました`, { action: { label: '元に戻す', fn: () => { undoMerge(orgUndo); orgUndo = null; render(); toast('元に戻しました'); } }, ms: 8000 });
    }
  });
  updatePreview();
  showSheet($('actionSheet'));
}
function openOrganizerActions(kind, name) {
  const label = kind === 'links' ? '引き出し' : 'カテゴリ';
  const count = organizerConfig[kind].count(name);
  const canMerge = organizerConfig[kind].names().some(n => n !== name);
  $('actionTitle').textContent = name;
  $('actionMenu').innerHTML = `
    <button type="button" data-org-action="rename">名前を変更</button>
    <button type="button" data-org-action="merge" ${canMerge ? '' : 'disabled'}>別の${label}に統合</button>
    ${count === 0 ? `<button type="button" class="danger" data-org-action="delete">この${label}を削除</button>` : ''}
    <button type="button" data-org-action="cancel">閉じる</button>`;
  showSheet($('actionSheet'));
  $('actionMenu').querySelector('[data-org-action="rename"]').onclick = () => {
    const newName = prompt(`${label}名を変更`, name);
    if (newName == null) return;
    const trimmed = String(newName).trim() || '未分類';
    if (trimmed === name) { closeSheet($('actionSheet')); return; }
    if (organizerConfig[kind].names().includes(trimmed)) { closeSheet($('actionSheet')); openMergeDialog(kind, name, trimmed); return; }
    performRename(kind, name, trimmed);
    closeSheet($('actionSheet'));
    render();
    toast(`「${name}」を「${trimmed}」へ変更しました`);
  };
  $('actionMenu').querySelector('[data-org-action="merge"]').onclick = () => { closeSheet($('actionSheet')); openMergeDialog(kind, name, ''); };
  $('actionMenu').querySelector('[data-org-action="delete"]')?.addEventListener('click', () => { deleteEmptyCategory(kind, name); closeSheet($('actionSheet')); render(); toast(`「${name}」を削除しました`); });
  $('actionMenu').querySelector('[data-org-action="cancel"]').onclick = () => closeSheet($('actionSheet'));
}
function bindOrganizerDrag(root, kind) {
  let dragging = null;
  root.querySelectorAll('.org-drag').forEach(handle => {
    handle.addEventListener('dragstart', e => {
      const row = handle.closest('[data-org]');
      dragging = row?.dataset.org || null;
      row?.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragging || '');
    });
    handle.addEventListener('dragend', () => { root.querySelectorAll('.is-dragging,.is-drop-target').forEach(n => n.classList.remove('is-dragging', 'is-drop-target')); dragging = null; });
  });
  root.querySelectorAll('[data-org]').forEach(row => {
    row.addEventListener('dragover', e => {
      if (!dragging || dragging === row.dataset.org) return;
      e.preventDefault();
      root.querySelectorAll('.is-drop-target').forEach(n => n.classList.remove('is-drop-target'));
      row.classList.add('is-drop-target');
    });
    row.addEventListener('drop', e => {
      if (!dragging) return;
      e.preventDefault();
      const toName = row.dataset.org;
      const fromName = dragging;
      row.classList.remove('is-drop-target');
      dragging = null;
      if (toName && fromName && toName !== fromName) openMergeDialog(kind, fromName, toName);
    });
  });
}

/* ============ 検索(スマホの探すシート) ============ */
function renderMobileResults() {
  const q = $('mSearchInput').value.trim();
  if (!q) {
    const mk = deck(U.drawer, U.kind);
    const ids = mk.order.slice(mk.pos, mk.pos + 5);
    $('mResults').innerHTML = ids.length ? `<div class="group-head">めくる束のつづき</div><div class="grid">${ids.map(id => itemHtml(find('link', id))).join('')}</div>` : '';
    return;
  }
  const links = searchLinks(q), prompts = searchPrompts(q);
  $('mResults').innerHTML = (links.length ? `<div class="group-head">リンク <span class="n">${links.length}件</span></div><div class="grid">${links.slice(0, 20).map(l => itemHtml(l, q)).join('')}</div>` : '') +
    (prompts.length ? `<div class="group-head">プロンプト <span class="n">${prompts.length}件</span></div>${prompts.slice(0, 20).map(p => rowHtml(p, q)).join('')}` : '') ||
    `<div class="empty"><b>見つかりませんでした</b>ひらがなでも探せます。</div>`;
}

/* ============ 画面の切り替え(スクロール位置を保つ) ============ */
function switchView(next) {
  U.scroll[U.view] = $('center').scrollTop;
  U.view = next;
  render();
  $('center').scrollTop = U.scroll[next] || 0;
}

/* ============ 描画のとりまとめ ============ */
render = function () {
  const focused = focusLocator(document.activeElement);
  $('desk').dataset.view = U.view;
  renderRail();
  renderChips();
  renderDeck();
  renderLib();
  renderPrompts();
  $('manage').hidden = U.view !== 'manage' || !!U.query.trim();
  if (!$('manage').hidden) renderManage();
  $('searchClear').hidden = !U.query;
  $('searchKeys').hidden = !!U.query;
  if ($('searchInput').value !== U.query) $('searchInput').value = U.query;
  restoreFocus(focused);
};

/* ============ イベント ============ */
document.addEventListener('click', e => {
  const t = e.target;
  const closeBtn = t.closest('[data-close]');
  if (closeBtn) { closeSheet(closeBtn.closest('dialog')); return; }

  if (t.closest('[data-org-done]')) { U.organize = false; closeSheet($('catSheet')); render(); return; }
  const orgMore = t.closest('[data-org-more]');
  if (orgMore) { openOrganizerActions(orgMore.dataset.orgKind || 'links', orgMore.dataset.orgMore); return; }
  if (t.closest('[data-org-open]')) { U.organize = true; $('catSheetTitle').textContent = '引き出しを整理'; $('catMenu').innerHTML = orgHtml('links'); bindOrganizerDrag($('catMenu'), 'links'); return; }
  if (t.closest('#promptOrganizeButton')) { $('catSheetTitle').textContent = 'カテゴリを整理'; $('catMenu').innerHTML = orgHtml('prompts'); bindOrganizerDrag($('catMenu'), 'prompts'); showSheet($('catSheet')); return; }

  const rail = t.closest('[data-rail]');
  if (rail) {
    const k = rail.dataset.rail;
    if (k === 'organize') { U.organize = true; render(); return; }
    U.query = ''; U.active = -1;
    if (k === 'all') Object.assign(U, { view: 'links', drawer: 'ALL' });
    else if (k === 'unopened') Object.assign(U, { view: 'links', drawer: 'UNOPENED' });
    else if (k === 'fav') Object.assign(U, { view: 'links', drawer: 'FAV' });
    else if (k === 'prompts') U.view = 'prompts';
    else if (k === 'manage') U.view = 'manage';
    else Object.assign(U, { view: 'links', drawer: k.slice(4) });
    render();
    $('center').scrollTop = 0;
    return;
  }

  const seg = t.closest('[data-seg]');
  if (seg) { switchView(seg.dataset.seg === 'prompts' ? 'prompts' : 'links'); return; }

  const chip = t.closest('#chips [data-drawer]');
  if (chip) {
    if (chip.dataset.drawer === '…') {
      const sorts = [['recent', '新しい順'], ['oldest', '寝かせた順(古い順)'], ['unopened', 'まだ開いていない順'], ['title', '名前順']];
      $('catSheetTitle').textContent = '引き出しと並び順';
      $('catMenu').innerHTML = '<button type="button" data-org-open>引き出しを整理</button>' +
        sorts.map(([v, x]) => `<button type="button" data-sort="${v}">${state.linkSort === v ? '✓ ' : ''}${escapeHtml(x)}</button>`).join('') +
        moodCounts().map(([n, c]) => `<button type="button" data-pick="${escapeHtml(n)}">${dot(n)}${escapeHtml(n)}<span style="margin-left:auto;color:var(--muted)">${c}</span></button>`).join('') +
        '<button type="button" data-close>閉じる</button>';
      showSheet($('catSheet'));
      return;
    }
    U.drawer = chip.dataset.drawer; render(); return;
  }
  const so = t.closest('[data-sort]');
  if (so) { state.linkSort = so.dataset.sort; save(); closeSheet($('catSheet')); render(); return; }
  const pickEl = t.closest('[data-pick]');
  if (pickEl) { U.drawer = pickEl.dataset.pick; U.view = 'links'; closeSheet($('catSheet')); render(); return; }
  const kindBtn = t.closest('.kinds [data-kind]');
  if (kindBtn) { U.kind = kindBtn.dataset.kind; render(); return; }

  const card = t.closest('#deckTrack .card');
  if (card) {
    const id = card.dataset.id, idx = Number(card.dataset.index);
    if (t.closest('[data-open]')) { setPos(idx); return; }
    if (t.closest('[data-letgo]')) { letGo(id); return; }
    if (t.closest('[data-refetch]')) { const item = find('link', id); if (item) refetchQuiet(item); return; }
    if (t.closest('[data-more]')) { openDetail('link', id); return; }
    const mk = deck(U.drawer, U.kind);
    if (mk.pos !== idx) setPos(idx);
    return;
  }

  const item = t.closest('.item');
  if (item) {
    const id = item.dataset.id;
    if (t.closest('.item-more')) { openDetail('link', id); return; }
    if (t.closest('.item-main')) { if (item.closest('#mResults')) closeSheet($('searchSheet')); openLink(id); return; }
  }

  const row = t.closest('.row[data-kind="prompt"]');
  if (row) {
    const id = row.dataset.id;
    if (t.closest('.row-copy')) { copyPrompt(id, t.closest('.row-copy')); return; }
    if (t.closest('.row-main')) {
      if (row.closest('#mResults')) closeSheet($('searchSheet'));
      U.sel = { kind: 'prompt', id };
      if (hand() || U.query.trim()) openDetail('prompt', id); else renderPrompts();
      return;
    }
  }
  const cp = t.closest('[data-copy]'); if (cp) { copyPrompt(cp.dataset.copy, cp); return; }
  const pc = t.closest('[data-pcopy]'); if (pc) { copyPrompt(pc.dataset.pcopy, pc); return; }
  const pe = t.closest('[data-pedit]'); if (pe) { closeSheet($('detailSheet')); openPromptSheet({ mode: 'edit', id: pe.dataset.pedit }); return; }

  const openA = t.closest('#detailSheet [data-open]');
  if (openA && U.sel) { closeSheet($('detailSheet')); openLink(U.sel.id); return; }
  const actBtn = t.closest('[data-act]');
  if (actBtn && U.sel) { closeSheet(actBtn.closest('dialog')); detailAction(actBtn.dataset.act, U.sel.kind, U.sel.id); return; }

  const rc = t.closest('#fRecent [data-cat]'); if (rc) { setCat(rc.dataset.cat); return; }
  const opt = t.closest('#fCatList .opt'); if (opt) { setCat(opt.dataset.cat); return; }
  if (t.closest('#fRetry')) { F.lastUrl = ''; F.mode === 'edit' ? refetchInSheet() : startFetch(); return; }
  if (t.closest('#fRefetch')) { refetchInSheet(); return; }
  if (t.closest('#dApply')) { applyDiff(); return; }
  const dupOpen = t.closest('[data-dup-open]'); if (dupOpen) { closeSheet($('linkSheet')); openLink(dupOpen.dataset.dupOpen); return; }
  const dupEdit = t.closest('[data-dup-edit]'); if (dupEdit) { closeSheet($('linkSheet')); openLinkSheet({ mode: 'edit', id: dupEdit.dataset.dupEdit }); return; }
  if (t.closest('#careRun')) { startCareRun(); return; }
  if (t.closest('#careUndo')) { undoCare(); return; }

  const pRecent = t.closest('#pRecent [data-pcat]'); if (pRecent) { $('pCat').value = pRecent.dataset.pcat; return; }
  const pOpt = t.closest('#pCatList .opt'); if (pOpt) { $('pCat').value = pOpt.dataset.cat; $('pCatList').hidden = true; return; }
  if (t.closest('#pDelete')) { if (P.id) deletePromptNow(P.id); return; }
  if (t.closest('#promptAddButton')) { openPromptSheet({ mode: 'add' }); return; }
});

document.addEventListener('auxclick', e => {
  const a = e.target.closest('#deckTrack [data-open], .item-main');
  if (a && e.button === 1) { const row = a.closest('[data-id]'); if (row) openLink(row.dataset.id); }
});

let deckScrollTimer = null;
$('deckTrack').addEventListener('scroll', () => {
  clearTimeout(deckScrollTimer);
  deckScrollTimer = setTimeout(() => {
    const track = $('deckTrack'), cards = $$('#deckTrack .card');
    if (!cards.length) return;
    let best = 0, dist = Infinity;
    cards.forEach((c, i) => { const d = Math.abs(c.offsetLeft - 16 - track.scrollLeft); if (d < dist) { dist = d; best = i; } });
    const mk = deck(U.drawer, U.kind);
    if (mk.pos !== best) markCurrent(best);
  }, 120);
});
$('deckPrev').addEventListener('click', () => { const mk = deck(U.drawer, U.kind); setPos(mk.pos - 1); });
$('deckNext').addEventListener('click', () => { const mk = deck(U.drawer, U.kind); setPos(mk.pos + 1); });
$('sortSelect').addEventListener('change', e => { state.linkSort = e.target.value; save(); render(); });
$('searchInput').addEventListener('input', e => { U.query = e.target.value; U.active = U.query.trim() ? 0 : -1; render(); });
$('searchInput').addEventListener('keydown', e => {
  if (e.isComposing) return;
  if (e.key === 'Escape') { e.preventDefault(); if (U.query) { U.query = ''; e.target.value = ''; U.active = -1; render(); } else e.target.blur(); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const { combined } = searchResultList();
    if (!combined.length) return;
    U.active = Math.max(0, Math.min(combined.length - 1, U.active + (e.key === 'ArrowDown' ? 1 : -1)));
    renderLib();
    const r = combined[U.active];
    $(`${r.kind === 'link' ? 'item' : 'row'}-${r.item.id}`)?.scrollIntoView({ block: 'nearest' });
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    const { combined } = searchResultList();
    const r = combined[Math.max(0, U.active)];
    if (!r) return;
    if (r.kind === 'link') { if (e.shiftKey) writeClip(r.item.url).then(ok => toast(ok ? 'URLをコピーしました' : 'コピーできませんでした')); else openLink(r.item.id); }
    else copyPrompt(r.item.id);
  }
});
$('searchClear').addEventListener('click', () => { U.query = ''; $('searchInput').value = ''; U.active = -1; render(); $('searchInput').focus(); });
$('addButton').addEventListener('click', () => openLinkSheet());
$('bottomAdd').addEventListener('click', () => openLinkSheet());
$('manageButton').addEventListener('click', () => switchView(U.view === 'manage' ? 'links' : 'manage'));
$('searchOpen').addEventListener('click', () => { showSheet($('searchSheet')); const i = $('mSearchInput'); i.value = ''; i.focus(); renderMobileResults(); });
$('mSearchInput').addEventListener('input', renderMobileResults);

$('fUrl').addEventListener('change', () => { checkDup(); if (F.mode === 'add') startFetch(); });
$('fUrl').addEventListener('paste', () => setTimeout(() => { checkDup(); if (F.mode === 'add') startFetch(); }, 0));
$('fPaste').addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    const m = extractFirstUrl(text);
    if (m) { $('fUrl').value = m; checkDup(); startFetch(); } else toast('クリップボードにURLがありませんでした');
  } catch { toast('ここでは読み取れません。URL欄に貼り付けてください'); }
});
$('fCat').addEventListener('click', renderCombo);
$('fCat').addEventListener('input', () => { F.cat = $('fCat').value.trim(); $('fSave').textContent = saveLabel(); $('fSave').disabled = !!(F.bm && !F.cat && F.mode !== 'edit'); renderCombo(); });
$('fCat').addEventListener('keydown', e => {
  if (e.isComposing) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if ($('fCatList').hidden) renderCombo(); moveCombo(e.key === 'ArrowDown' ? 1 : -1); }
  else if (e.key === 'Enter') { e.preventDefault(); const o = $$('#fCatList .opt')[F.comboIdx]; setCat(o ? o.dataset.cat : $('fCat').value); $('fTitle').focus(); }
  else if (e.key === 'Escape' && !$('fCatList').hidden) { e.preventDefault(); e.stopPropagation(); closeCombo(); }
});
$('fCat').addEventListener('blur', () => setTimeout(closeCombo, 150));
$('fSave').addEventListener('click', saveLink);
$('linkForm').addEventListener('submit', e => e.preventDefault());
// closeイベントは非同期に届く。開き直した後に前の回のcloseが届いても、新しい回の取得は止めない
$('linkSheet').addEventListener('close', () => { abortFetchController(); });

$('pCat').addEventListener('click', renderPromptCombo);
$('pCat').addEventListener('input', renderPromptCombo);
$('pCat').addEventListener('blur', () => setTimeout(() => { $('pCatList').hidden = true; }, 150));
$('pSave').addEventListener('click', savePrompt);
$('promptForm').addEventListener('submit', e => e.preventDefault());

$$('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) closeSheet(d); }));

/* ============ キー操作(PC。計画書4.9) ============ */
document.addEventListener('keydown', e => {
  if (e.defaultPrevented || $$('dialog[open]').length) return;
  if (e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
  if (hand()) return; // スマホでは効かせない
  const k = e.key;
  if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'k' || k === '/') { e.preventDefault(); $('searchInput').focus(); $('searchInput').select(); return; }
  if (k === 'Enter' && NEXT.id && Date.now() < NEXT.until && !e.target.closest('a')) { e.preventDefault(); const id = NEXT.id; NEXT.id = null; $('toast').hidden = true; openLink(id); return; }
  if (U.view === 'links' && !U.query.trim() && (k === 'ArrowRight' || k === 'ArrowLeft')) {
    e.preventDefault();
    const mk = deck(U.drawer, U.kind);
    setPos(mk.pos + (k === 'ArrowRight' ? 1 : -1));
    return;
  }
  if (U.view === 'links' && !U.query.trim() && k === 'Enter' && !e.target.closest('a, button')) {
    e.preventDefault();
    const mk = deck(U.drawer, U.kind);
    const id = mk.order[mk.pos];
    if (id) openLink(id);
    return;
  }
  if (U.view === 'prompts' && k === 'Enter' && e.target.closest('.row-main')) {
    e.preventDefault();
    const row = e.target.closest('.row');
    copyPrompt(row.dataset.id, row.querySelector('.row-copy'));
    return;
  }
  // 文字キー(入力欄の外)で検索に入る。preventDefaultはしない(この文字を検索欄へ入れるため)
  if (!e.ctrlKey && !e.metaKey && !e.altKey && (k.length === 1 || k === 'Process')) $('searchInput').focus();
});

/* ============ どこでも貼り付け・落とす(計画書4.9) ============ */
document.addEventListener('paste', e => {
  if (e.target.closest('input, textarea') || $$('dialog[open]').length) return;
  const text = (e.clipboardData || window.clipboardData)?.getData('text') || '';
  const url = extractFirstUrl(text);
  if (url) { e.preventDefault(); openLinkSheet({ url }); }
  else if (text.trim().length >= 20) { e.preventDefault(); openPromptSheet({ mode: 'add' }); $('pBody').value = text.trim(); }
});
let dragDepth = 0;
const dragOk = e => [...(e.dataTransfer?.types || [])].some(x => x === 'text/uri-list' || x === 'text/plain');
function ensureDropZone() {
  let el = $('dropZone');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'dropZone';
  el.hidden = true;
  el.textContent = 'ここに落とすとリンクを保存します';
  document.body.appendChild(el);
  return el;
}
window.addEventListener('dragenter', e => { if (!dragOk(e)) return; dragDepth++; ensureDropZone().hidden = false; });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; const el = $('dropZone'); if (el) el.hidden = true; } });
window.addEventListener('dragover', e => { if (dragOk(e)) e.preventDefault(); });
window.addEventListener('drop', e => {
  dragDepth = 0;
  const el = $('dropZone'); if (el) el.hidden = true;
  if (!dragOk(e)) return;
  e.preventDefault();
  const uri = (e.dataTransfer.getData('text/uri-list') || '').split(/\r?\n/).find(x => x && !x.startsWith('#')) || e.dataTransfer.getData('text/plain');
  const url = extractFirstUrl(uri);
  if (url) openLinkSheet({ url });
});

/* ============ スマホの外枠(mobile-app-shell.js の考え方をここへ) ============ */
const rootEl = document.documentElement;
function shellMetrics() {
  const vv = window.visualViewport;
  const h = Math.round(vv ? vv.height : innerHeight);
  rootEl.style.setProperty('--shell-h', h + 'px');
  rootEl.style.setProperty('--vv-top', Math.round(vv ? vv.offsetTop : 0) + 'px');
  const bar = $('bottomBar');
  if (bar && bar.offsetParent) rootEl.style.setProperty('--bar-h', Math.ceil(bar.getBoundingClientRect().height) + 'px');
  const editing = !!document.activeElement?.matches?.('input, textarea, select');
  if (!editing) shellMetrics.base = Math.max(shellMetrics.base || 0, h);
  rootEl.classList.toggle('keyboard-open', editing && h < (shellMetrics.base || h) * 0.78);
}
let shellFrame = 0;
function scheduleShell() { if (!shellFrame) shellFrame = requestAnimationFrame(() => { shellFrame = 0; shellMetrics(); }); }
window.visualViewport?.addEventListener('resize', scheduleShell);
window.visualViewport?.addEventListener('scroll', scheduleShell);
addEventListener('resize', scheduleShell);
addEventListener('orientationchange', () => { shellMetrics.base = 0; scheduleShell(); });
document.addEventListener('focusin', scheduleShell);
document.addEventListener('focusout', () => setTimeout(scheduleShell, 0));

/* ============ 初期化 ============ */
render();
shellMetrics();
handleAddHash();
handleSaveHash();
addEventListener('hashchange', () => { handleAddHash(); handleSaveHash(); });
