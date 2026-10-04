'use strict';
/*
 * core.js — 状態・保存・正規化・マージ・入出力・検索・表示の整え・束の並べ方・
 * ページ情報の取得・引き出しの整理のデータ操作。DOMは触らない。
 * 旧 app.html のscript・precision-data.js・search-shift.js・now-ui.js(RANDOMの袋の考え方)・
 * quick-add.js・quick-loading.js・category-organizer.js の中身をここへ移した。
 */

const STORAGE_KEY = 'quick-links-mobile-localstorage-v1';
const MK_KEY = 'quick-links-mekuru-v1';
const DAY = 24 * 60 * 60 * 1000;

const $ = (id) => document.getElementById(id);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function uid(prefix = 'id') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function normalizeString(value) {
  return String(value || '').normalize('NFKC').toLowerCase().trim();
}

function normalizeSpaces(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeBody(value) {
  return String(value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
}

function formatShortDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const monthDay = `${date.getMonth() + 1}/${date.getDate()}`;
  return date.getFullYear() === new Date().getFullYear() ? monthDay : `${date.getFullYear()}/${monthDay}`;
}

// ひらがな・カタカナを同じ文字とみなし、NFKC・小文字にそろえる(検索・強調・表示の整えで使う)
function fold(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ぁ-ゖ]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60));
}

/* ============ 状態 ============ */

const DEFAULT_COLORS = {
  '未分類': { bg: '#f8fafc', text: '#475569', border: '#e2e8f0' }
};

const state = {
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
  items: [],
  projects: ['未分類'],
  projectColors: {},
  promptMemos: [],
  promptCategories: ['未分類']
};

function save() {
  const payload = {
    activeTab: state.activeTab,
    query: state.query,
    currentProject: state.currentProject,
    currentPromptCategory: state.currentPromptCategory,
    onlyFavorites: state.onlyFavorites,
    linkSort: state.linkSort,
    promptSort: state.promptSort,
    viewMode: state.viewMode,
    linkPage: state.linkPage,
    promptPage: state.promptPage,
    linkPerPage: state.linkPerPage,
    promptPerPage: state.promptPerPage,
    items: state.items,
    projects: state.projects,
    projectColors: state.projectColors,
    promptMemos: state.promptMemos,
    promptCategories: state.promptCategories
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    Object.assign(state, {
      ...data,
      items: normalizeLinkItems(data.items || []),
      projects: normalizeProjects(data.projects || [], data.items || []),
      projectColors: data.projectColors || {},
      promptMemos: normalizePromptItems(data.promptMemos || []),
      promptCategories: normalizePromptCategories(data.promptCategories || [], data.promptMemos || [])
    });
  } catch (error) {
    console.warn(error);
  }
}

function cleanName(value, fallback = '未分類') {
  return String(value || '').trim() || fallback;
}

function unionNames(stored, derived) {
  const result = [];
  [...(Array.isArray(stored) ? stored : []), ...(Array.isArray(derived) ? derived : [])].forEach(value => {
    const name = cleanName(value);
    if (!result.includes(name)) result.push(name);
  });
  if (!result.length) result.push('未分類');
  return result;
}

// precision-data.js の union版(既存の並びを保ちつつ、実データにある名前も足す)を正とする
function normalizeProjects(projects, items = state.items) {
  const derived = (Array.isArray(items) ? items : [])
    .filter(item => !item?.archived)
    .map(item => cleanName(item?.projectName));
  return unionNames(projects, derived);
}

function normalizePromptCategories(categories, memos = state.promptMemos) {
  const derived = (Array.isArray(memos) ? memos : [])
    .map(memo => cleanName(memo?.categoryName || memo?.projectName));
  return unionNames(categories, derived);
}

function normalizeLinkItems(list) {
  const now = new Date().toISOString();
  return (Array.isArray(list) ? list : [])
    .filter(item => item && item.title && item.url && !item.archived)
    .map(item => {
      const favoriteType = item.favoriteType || (item.isFavorite ? 'normal' : 'none');
      return {
        id: String(item.id || uid('link')),
        title: String(item.title || '無題'),
        url: String(item.url || ''),
        projectName: String(item.projectName || '未分類').trim() || '未分類',
        description: String(item.description || ''),
        descriptionSource: String(item.descriptionSource || ''),
        descriptionUpdatedAt: item.descriptionUpdatedAt || null,
        note: String(item.note || ''),
        addedAt: item.addedAt || now,
        updatedAt: item.updatedAt || item.addedAt || now,
        lastClickedAt: item.lastClickedAt || null,
        clickCount: Number(item.clickCount || 0),
        clickHistory: Array.isArray(item.clickHistory) ? item.clickHistory : [],
        archived: false,
        isFavorite: favoriteType !== 'none' || !!item.isFavorite,
        favoriteType,
        favoriteExpiry: item.favoriteExpiry || null
      };
    });
}

function normalizePromptItems(list) {
  const now = new Date().toISOString();
  return (Array.isArray(list) ? list : [])
    .filter(memo => memo && (String(memo.title || '').trim() || String(memo.body || '').trim()))
    .map(memo => ({
      id: String(memo.id || uid('prompt')),
      title: String(memo.title || '無題のプロンプト'),
      categoryName: String(memo.categoryName || memo.projectName || '未分類').trim() || '未分類',
      body: String(memo.body || ''),
      createdAt: memo.createdAt || memo.addedAt || now,
      updatedAt: memo.updatedAt || memo.createdAt || now,
      copyCount: Number(memo.copyCount || 0),
      lastCopiedAt: memo.lastCopiedAt || null
    }));
}

function getLinkKey(item) {
  return [
    String(item.url || '').trim(),
    normalizeSpaces(item.title),
    normalizeSpaces(item.projectName || '未分類'),
    normalizeSpaces(item.description),
    normalizeSpaces(item.note),
    item.archived ? 'archived' : 'active'
  ].join('\u001f');
}

function getPromptKey(memo) {
  return [
    normalizeSpaces(memo.title || '無題のプロンプト'),
    normalizeBody(memo.body),
    normalizeSpaces(memo.categoryName || memo.projectName || '未分類')
  ].join('\u001f');
}

function timeValue(value) {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function pickEarlier(a, b) {
  const at = timeValue(a), bt = timeValue(b);
  if (!at) return b || a || null;
  if (!bt) return a || b || null;
  return at <= bt ? a : b;
}

function pickLater(a, b) {
  const at = timeValue(a), bt = timeValue(b);
  if (!at) return b || a || null;
  if (!bt) return a || b || null;
  return at >= bt ? a : b;
}

function pickFavoriteType(a, b) {
  const priority = { none: 0, normal: 1, temporary: 2, permanent: 3 };
  const av = String(a || 'none');
  const bv = String(b || 'none');
  return (priority[bv] || 0) > (priority[av] || 0) ? bv : av;
}

function mergeLink(base, incoming) {
  if (!base) return incoming;
  const favoriteType = pickFavoriteType(base.favoriteType, incoming.favoriteType);
  return {
    ...base,
    addedAt: pickEarlier(base.addedAt, incoming.addedAt),
    updatedAt: pickLater(base.updatedAt, incoming.updatedAt),
    lastClickedAt: pickLater(base.lastClickedAt, incoming.lastClickedAt),
    clickCount: Math.max(Number(base.clickCount || 0), Number(incoming.clickCount || 0)),
    clickHistory: [...new Set([...(base.clickHistory || []), ...(incoming.clickHistory || [])])].sort((a, b) => timeValue(a) - timeValue(b)),
    isFavorite: favoriteType !== 'none' || !!base.isFavorite || !!incoming.isFavorite,
    favoriteType,
    favoriteExpiry: pickLater(base.favoriteExpiry, incoming.favoriteExpiry)
  };
}

function mergePrompt(base, incoming) {
  if (!base) return incoming;
  return {
    ...base,
    createdAt: pickEarlier(base.createdAt, incoming.createdAt),
    updatedAt: pickLater(base.updatedAt, incoming.updatedAt),
    lastCopiedAt: pickLater(base.lastCopiedAt, incoming.lastCopiedAt),
    copyCount: Math.max(Number(base.copyCount || 0), Number(incoming.copyCount || 0))
  };
}

function isFavorite(item) {
  const type = item.favoriteType || (item.isFavorite ? 'normal' : 'none');
  if (type === 'none') return false;
  if (type === 'temporary' && item.favoriteExpiry && timeValue(item.favoriteExpiry) < Date.now()) return false;
  return true;
}

function getProjectColor(name) {
  const key = name || '未分類';
  if (state.projectColors[key]) return state.projectColors[key];
  if (DEFAULT_COLORS[key]) return DEFAULT_COLORS[key];
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = key.charCodeAt(i) + ((hash << 5) - hash);
  const h = Math.abs(hash) % 360;
  return { bg: `hsl(${h}, 85%, 94%)`, text: `hsl(${h}, 70%, 30%)`, border: `hsl(${h}, 60%, 84%)` };
}

/* ============ 検索・強調(ひらがな→カタカナを同じ文字とみなす) ============ */

function matchesSearch(values, q = state.query) {
  const terms = fold(q).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const haystacks = values.map(fold);
  return terms.every(term => haystacks.some(value => value.includes(term)));
}

function highlight(value, q = state.query) {
  const raw = String(value || '');
  const terms = fold(q).split(/\s+/).filter(Boolean);
  if (!terms.length) return escapeHtml(raw);
  const f = fold(raw);
  if (f.length !== raw.length) return escapeHtml(raw); // 長さが変わる整形(NFKC等)では強調をあきらめ、安全側に倒す
  const marks = new Array(raw.length).fill(false);
  for (const t of terms) {
    let i = f.indexOf(t);
    while (i >= 0) { for (let k = i; k < i + t.length; k++) marks[k] = true; i = f.indexOf(t, i + t.length); }
  }
  let out = '', open = false;
  for (let i = 0; i < raw.length; i++) {
    if (marks[i] && !open) { out += '<mark>'; open = true; }
    if (!marks[i] && open) { out += '</mark>'; open = false; }
    out += escapeHtml(raw[i]);
  }
  return out + (open ? '</mark>' : '');
}

function relevanceScore(values, q) {
  const [title = '', secondary = '', detail = ''] = values.map(v => fold(v));
  const terms = fold(q).split(/\s+/).filter(Boolean);
  let score = 0;
  for (const term of terms) {
    if (title === term) score += 120;
    else if (title.startsWith(term)) score += 90;
    else if (title.includes(term)) score += 65;
    if (secondary === term) score += 45;
    else if (secondary.includes(term)) score += 30;
    if (detail.includes(term)) score += 15;
  }
  return score;
}

function searchLinks(q) {
  if (!fold(q).trim()) return [];
  return state.items
    .filter(item => !item.archived)
    .filter(item => { const v = view(item); return matchesSearch([v.title, v.by, v.desc, item.title, item.description, item.note, item.url, item.projectName, v.src], q); })
    .map(item => ({ item, score: relevanceScore([view(item).title, item.projectName, `${item.url} ${item.description || ''} ${item.note}`], q), recent: timeValue(item.lastClickedAt || item.updatedAt || item.addedAt) }))
    .sort((a, b) => b.score - a.score || b.recent - a.recent)
    .map(entry => entry.item);
}

function searchPrompts(q) {
  if (!fold(q).trim()) return [];
  return state.promptMemos
    .filter(memo => matchesSearch([memo.title, memo.body, memo.categoryName], q))
    .map(memo => ({ memo, score: relevanceScore([memo.title, memo.categoryName, memo.body], q), recent: timeValue(memo.lastCopiedAt || memo.updatedAt || memo.createdAt) }))
    .sort((a, b) => b.score - a.score || b.recent - a.recent)
    .map(entry => entry.memo);
}

/* ============ 表示の整え(保存データは変えない。計画書6章) ============ */

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^(www|m)\./, ''); } catch { return ''; }
}

const LOGIN_HOSTS = ['worksmobile.com', 'docs.google.com', 'drive.google.com', 'notion.so', 'chatgpt.com', 'aistudio.google.com'];
function isLoginHost(url) {
  const h = hostOf(url);
  return LOGIN_HOSTS.some(x => h === x || h.endsWith('.' + x));
}

// タイトルがURLのまま(=まだ情報を取得していない)かどうか
function looksPlaceholder(title, url) {
  const t = String(title || '').trim();
  return !t || t === hostOf(url) || /^https?:\/\//i.test(t) || /^(ログイン|Sign in|Log in)$/i.test(t);
}
// 取得結果がログイン画面・エラー画面らしいか(差分に出さず失敗として扱う)
const SUSPICIOUS_TITLE_RE = /^(ログイン|Sign in|Log in|Just a moment\.\.\.|403 Forbidden|404 Not Found|Access Denied|Attention Required)/i;
function looksSuspicious(data) {
  return SUSPICIOUS_TITLE_RE.test(String(data?.title || '').trim());
}

const AI_HOSTS = ['chatgpt.com', 'chat.openai.com', 'claude.ai', 'gemini.google.com', 'aistudio.google.com', 'notebooklm.google.com', 'perplexity.ai'];
// コピーの次へ:保存済みリンクのうち、AI系ホストで最も多く開いた1件
function bestAiLink() {
  return state.items
    .filter(item => !item.archived && AI_HOSTS.includes(hostOf(item.url)))
    .sort((a, b) => Number(b.clickCount || 0) - Number(a.clickCount || 0))[0] || null;
}

const GENERIC_DESC = [/^作成した動画を友だち、家族、世界中の人たちと共有/, /^Enjoy the videos and music you love/i, /^Discover and share/i];

function sourceOf(url) {
  const h = hostOf(url), u = String(url);
  if (h === 'x.com' || h === 'twitter.com') return { src: 'X', kind: 'quick' };
  if (/youtu\.?be/.test(h)) return u.includes('/shorts/') ? { src: 'ショート', kind: 'quick' } : { src: '動画', kind: 'deep' };
  if (h === 'note.com') return { src: 'note', kind: 'deep' };
  if (h === 'speakerdeck.com') return { src: 'スライド', kind: 'deep' };
  if (isLoginHost(url) || /github\.com$|^tools\./.test(h)) return { src: 'ツール', kind: 'tool' };
  return { src: '記事', kind: 'deep' };
}

// 保存データはそのまま。表示するときだけ、Xの自動タイトルなどを整える
function view(item) {
  let title = String(item.title || '').trim(), by = '', desc = String(item.note || item.description || '').trim(), m;
  const s = sourceOf(item.url);
  if (s.src === 'X') {
    if ((m = title.match(/^X(?:ユーザー)?の(.+?)さん(?:[:：]\s*「([\s\S]*?)」?)?(?:\s*\/\s*X)?\s*$/))) { by = m[1]; title = m[2] || ''; }
    else if ((m = title.match(/^(.+?)\s*\(@([A-Za-z0-9_]+)\)\s*on X(?::\s*"([\s\S]*?)"?)?(?:\s*\/\s*X)?\s*$/))) { by = `${m[1]}(@${m[2]})`; title = m[3] || ''; }
    if (!title && desc) { title = desc; desc = ''; }
  } else if (s.src === '動画' || s.src === 'ショート') {
    title = title.replace(/\s*-\s*YouTube\s*$/, '');
  } else if (s.src === 'note' && (m = title.match(/^(.+)[|｜]([^|｜]+)$/))) { title = m[1]; by = m[2]; }
  else if (s.src === 'スライド') title = title.replace(/\s*-\s*Speaker Deck\s*$/, '');
  if (GENERIC_DESC.some(re => re.test(desc))) desc = '';
  const ft = fold(title).replace(/\s/g, ''), fd = fold(desc).replace(/\s/g, '');
  if (fd && ft && (fd === ft || fd.startsWith(ft.slice(0, 24)) || ft.startsWith(fd.slice(0, 24)))) desc = fd.length > ft.length + 12 ? desc : '';
  return { title: title || hostOf(item.url), by, desc, ...s };
}

function agoText(days) {
  if (days < 1) return '今日';
  if (days < 2) return '昨日';
  if (days < 60) return `${days}日前`;
  if (days < 365) return `${Math.floor(days / 30)}か月前`;
  return `${Math.floor(days / 365)}年前`;
}

function ageDays(item) { return Math.max(0, Math.floor((Date.now() - timeValue(item.addedAt)) / DAY)); }

// memは束のmem対応表({id: 何か月前か})。渡されなければ「ちょうど◯か月前の今日」は出さない
function reasonOf(item, mem) {
  const k = mem && mem[item.id];
  if (k) return { text: k === 12 ? 'ちょうど1年前の今日に保存' : `ちょうど${k}か月前の今日に保存`, hot: true };
  const c = Number(item.clickCount || 0);
  return { text: `${agoText(ageDays(item))}に保存・${c ? `${c}回開いた` : 'まだ開いていない'}`, hot: false };
}

/* ============ めくる束(計画書5章) ============ */

function dayKey(t = Date.now()) {
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function hashStr(s) {
  let h = 2166136261;
  for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// シード付きの疑似乱数(同じシードなら同じ値。カードごとの固定乱数に使う)
function rngFromSeed(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// 端末だけの束の位置・見せた時刻(同期しない。save()を経由しない)。
// decks[key] = { order:[id...], pos } の形で並びそのものを覚えるため、
// 保存のたびに束を組み直したり、再読み込みで今日の続きが崩れたりしない。
const MK = { day: dayKey(), decks: {}, shown: {} };
(function loadMK() {
  try {
    const saved = JSON.parse(localStorage.getItem(MK_KEY) || 'null');
    if (saved && saved.day === dayKey()) { MK.decks = saved.decks || {}; MK.shown = saved.shown || {}; }
  } catch { /* 壊れていれば無視して束を作り直す */ }
})();

function saveMK() {
  try {
    const cutoff = Date.now() - 30 * DAY;
    Object.keys(MK.shown).forEach(id => { if (MK.shown[id] < cutoff) delete MK.shown[id]; });
    localStorage.setItem(MK_KEY, JSON.stringify({ day: dayKey(), decks: MK.decks, shown: MK.shown }));
  } catch { /* 保存できなくても束は動く */ }
}

function deckLinkCount(item) { return Number(item.clickCount || 0); }

function passesDrawer(item, drawer, kind) {
  if (drawer === 'UNOPENED' && deckLinkCount(item) > 0) return false;
  if (drawer === 'FAV' && !isFavorite(item)) return false;
  if (!['ALL', 'UNOPENED', 'FAV'].includes(drawer) && (item.projectName || '未分類') !== drawer) return false;
  const k = sourceOf(item.url).kind;
  if (kind === 'quick' && k !== 'quick') return false;
  if (kind === 'deep' && k !== 'deep') return false;
  return true;
}

function deckWeight(item, t) {
  const age = (t - timeValue(item.addedAt)) / DAY;
  const opened = deckLinkCount(item) > 0;
  const tool = sourceOf(item.url).kind === 'tool';
  const shownAt = MK.shown[item.id];
  const shownRecently = shownAt && t - shownAt < 14 * DAY && dayKey(shownAt) !== dayKey(t);
  return (1 + Math.min(age, 180) / 45) * (opened ? 0.6 : 1.6) * (shownRecently ? 0.25 : 1) * (tool ? 0.3 : 1);
}

// 「ちょうど◯か月前の今日」:1・2・3・6・12か月前の同じ日付に保存したものを、各月1枚・合わせて3枚まで。
// 同じ日に複数あれば、日付から作った乱数で1枚選ぶ(束の並びとは別の固定シード)
function memoriesOf(pool, t) {
  const out = [];
  for (const k of [1, 2, 3, 6, 12]) {
    if (out.length >= 3) break;
    const d = new Date(t);
    d.setMonth(d.getMonth() - k);
    const dKey = dayKey(d.getTime());
    const hits = pool.filter(item => dayKey(timeValue(item.addedAt)) === dKey);
    if (hits.length) {
      const idx = Math.floor(rngFromSeed(hashStr(dayKey(t) + '|' + k))() * hits.length);
      out.push([hits[idx], k]);
    }
  }
  return out;
}

// 今日の束の並び・位置を返す。すでにあれば持っている並びをそのまま使い、
// 消えた項目(手放した・削除された)だけを間引く。今日新しく保存したものは、
// この並びに新規追加しない(=明日の束から入る)
function deck(drawer, kind) {
  const key = `${drawer}|${kind}`;
  const t = Date.now();
  const poolIds = new Set(state.items.filter(item => !item.archived && passesDrawer(item, drawer, kind)).map(item => item.id));
  let entry = MK.decks[key];
  if (entry) {
    const filtered = entry.order.filter(id => poolIds.has(id));
    if (filtered.length !== entry.order.length) {
      entry.order = filtered;
      entry.pos = Math.min(entry.pos, Math.max(0, filtered.length - 1));
      Object.keys(entry.mem || {}).forEach(id => { if (!poolIds.has(id)) delete entry.mem[id]; });
      saveMK();
    }
  } else {
    const pool = state.items.filter(item => poolIds.has(item.id));
    const mem = memoriesOf(pool, t);
    const memIds = new Set(mem.map(([item]) => item.id));
    const rest = pool.filter(item => !memIds.has(item.id))
      .map(item => ({ id: item.id, k: Math.pow(rngFromSeed(hashStr(dayKey(t) + '|' + key + '|' + item.id))(), 1 / deckWeight(item, t)) }))
      .sort((a, b) => b.k - a.k)
      .map(x => x.id);
    const order = [...mem.map(([item]) => item.id), ...rest];
    entry = { order, pos: 0, mem: Object.fromEntries(mem.map(([item, k]) => [item.id, k])) };
    MK.decks[key] = entry;
    saveMK();
  }
  return { key, order: entry.order, pos: entry.pos, mem: entry.mem || {} };
}

function deckSetPos(key, pos) {
  const entry = MK.decks[key];
  if (!entry) return;
  entry.pos = Math.max(0, Math.min(entry.order.length - 1, pos));
  saveMK();
}

function markShown(id) {
  if (!id) return;
  MK.shown[id] = Date.now();
  saveMK();
}

// 手放す:束は組み直さず、その1枚だけを抜く(位置を保つ)。deckKeyの束にidがあれば一緒に間引く
function letGoLink(id, deckKey) {
  const idx = state.items.findIndex(item => item.id === id);
  if (idx < 0) return null;
  const [item] = state.items.splice(idx, 1);
  state.projects = normalizeProjects(state.projects, state.items);
  let deckSnapshot = null;
  const entry = MK.decks[deckKey];
  if (entry) {
    const at = entry.order.indexOf(id);
    if (at >= 0) {
      entry.order.splice(at, 1);
      const prevPos = entry.pos;
      entry.pos = Math.min(entry.pos, Math.max(0, entry.order.length - 1));
      deckSnapshot = { deckKey, at, prevPos };
    }
  }
  save();
  saveMK();
  return { item, index: idx, deck: deckSnapshot };
}

// letGoLink()の巻き戻し。同じ場所・同じ束の位置へ戻す
function restoreLetGo(snapshot) {
  if (!snapshot) return;
  const index = Math.min(Math.max(snapshot.index, 0), state.items.length);
  state.items.splice(index, 0, snapshot.item);
  state.projects = normalizeProjects(state.projects, state.items);
  if (snapshot.deck) {
    const entry = MK.decks[snapshot.deck.deckKey];
    if (entry) {
      entry.order.splice(Math.min(snapshot.deck.at, entry.order.length), 0, snapshot.item.id);
      entry.pos = snapshot.deck.prevPos;
    }
  }
  save();
  saveMK();
}

/* ============ 保存(URL周り)。quick-add.js を移した ============ */

function extractFirstUrl(text) {
  const value = String(text || '').trim();
  if (!value) return '';
  const httpMatch = value.match(/https?:\/\/[^\s<>'"（）()\[\]{}]+/i);
  if (httpMatch) return httpMatch[0].replace(/[.,;:!?、。]+$/, '');
  const wwwMatch = value.match(/www\.[^\s<>'"（）()\[\]{}]+/i);
  if (wwwMatch) return `https://${wwwMatch[0].replace(/[.,;:!?、。]+$/, '')}`;
  return '';
}

function normalizeQuickUrl(value) {
  let raw = String(value || '').trim();
  if (!raw) throw new Error('URLを入力してください');
  raw = extractFirstUrl(raw) || raw;
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  const parsed = new URL(raw);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('http / https のURLを入力してください');
  return parsed.href;
}

function exactInputUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || /\s/.test(raw) || !/^(https?:\/\/|www\.)/i.test(raw)) return '';
  try { return normalizeQuickUrl(raw); }
  catch { return ''; }
}

function canonicalUrl(value) {
  try {
    const url = new URL(normalizeQuickUrl(value));
    url.hash = '';
    return url.href;
  } catch { return ''; }
}

function findDuplicate(url) {
  const key = canonicalUrl(url);
  if (!key) return null;
  return state.items.find(item => canonicalUrl(item.url) === key) || null;
}

function cleanText(value, max = 0) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return max > 0 && text.length > max ? `${text.slice(0, max)}…` : text;
}

function safeHttpUrl(value) {
  try { const url = new URL(String(value || '')); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; }
  catch { return ''; }
}

const DIRECT_FETCH_TIMEOUT = 6500;
const RESOLVER_TIMEOUT = 9000;
const MICROLINK_TIMEOUT = 9000;
const METADATA_RESOLVER_ENDPOINT = 'https://quicklinks-sync.silovar-uk.workers.dev/v1/metadata';
const MICROLINK_ENDPOINT = 'https://api.microlink.io/';

function meta(doc, selectors) {
  for (const selector of selectors) {
    const el = doc.querySelector(selector);
    const value = el?.getAttribute('content') || el?.textContent || '';
    if (String(value).trim()) return String(value).trim();
  }
  return '';
}

// 取得の中止は、呼び出し側(ui.js)が持つ AbortController の signal をそのまま渡す。window.fetch は差し替えない
async function withTimeoutSignal(ms, signal, run) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, ms);
  const onAbort = () => controller.abort();
  if (signal) { if (signal.aborted) controller.abort(); else signal.addEventListener('abort', onAbort); }
  try {
    return await run(controller.signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    if (!error.code) error.code = timedOut ? 'timeout' : 'network';
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

function normalizeFetchedDescription(url, value) {
  const description = cleanText(value, 1000);
  const source = sourceOf(url);
  if ((source.src === '動画' || source.src === 'ショート') && GENERIC_DESC.some(re => re.test(description))) return '';
  return description;
}

function mergeFetchedMetadata(base, incoming, fallbackUrl) {
  const nextUrl = safeHttpUrl(incoming?.url) || base?.url || fallbackUrl;
  const title = cleanText(incoming?.title, 240);
  const description = normalizeFetchedDescription(nextUrl, incoming?.description);
  let domain = incoming?.domain || '';
  try { if (!domain) domain = new URL(nextUrl).hostname.replace(/^www\./i, ''); } catch { domain = ''; }
  return {
    url: nextUrl,
    title: base?.title || title,
    domain: base?.domain || domain,
    description: base?.description || description,
    source: [base?.source, incoming?.source].filter(Boolean).join('+') || 'unknown',
    provider: incoming?.provider || base?.provider || '',
    descriptionSource: incoming?.descriptionSource || base?.descriptionSource || '',
    confidence: incoming?.confidence || base?.confidence || ''
  };
}

function hasMetadata(data) {
  return !!(String(data?.title || '').trim() || String(data?.description || '').trim());
}

function hasCompleteMetadata(data) {
  return !!(String(data?.title || '').trim() && String(data?.description || '').trim());
}

function youtubeVideoId(value) {
  try {
    const u = new URL(String(value || ''));
    const h = u.hostname.replace(/^www\./i, '').toLowerCase();
    let id = '';
    if (h === 'youtu.be') {
      id = u.pathname.split('/').filter(Boolean)[0] || '';
    } else if (h === 'youtube.com' || h.endsWith('.youtube.com')) {
      if (u.pathname === '/watch') id = u.searchParams.get('v') || '';
      else {
        const m = u.pathname.match(/^\/(?:shorts|live|embed)\/([^/?#]+)/i);
        id = m?.[1] || '';
      }
    }
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : '';
  } catch {
    return '';
  }
}

async function fetchYouTubeOEmbedMetadata(url, { signal } = {}) {
  const videoId = youtubeVideoId(url);
  if (!videoId) throw new Error('YouTube動画URLではありません');
  return withTimeoutSignal(5000, signal, async innerSignal => {
    const endpoint = new URL('https://www.youtube.com/oembed');
    endpoint.searchParams.set('url', `https://www.youtube.com/watch?v=${videoId}`);
    endpoint.searchParams.set('format', 'json');
    const response = await fetch(endpoint.href, {
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers: { Accept: 'application/json' },
      signal: innerSignal
    });
    if (!response.ok) throw new Error('YouTube oEmbed HTTP ' + response.status);
    const payload = await response.json();
    const title = cleanText(payload?.title, 240);
    if (!title) throw new Error('YouTubeタイトルを取得できませんでした');
    return {
      url,
      title,
      domain: 'youtube.com',
      description: '',
      source: 'youtube-oembed',
      provider: 'YouTube',
      author: cleanText(payload?.author_name, 160)
    };
  });
}

async function fetchResolverMetadata(url, { signal } = {}) {
  return withTimeoutSignal(RESOLVER_TIMEOUT, signal, async innerSignal => {
    const endpoint = new URL(METADATA_RESOLVER_ENDPOINT);
    endpoint.searchParams.set('url', url);
    const response = await fetch(endpoint.href, {
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers: { Accept: 'application/json' },
      signal: innerSignal
    });
    if (!response.ok) throw new Error('resolver HTTP ' + response.status);
    const payload = await response.json();
    if (payload?.status !== 'success' || !payload?.data) throw new Error(payload?.error || 'ページ情報を取得できませんでした');
    const data = payload.data;
    const finalUrl = safeHttpUrl(data.url) || url;
    let domain = '';
    try { domain = new URL(finalUrl).hostname.replace(/^www\./i, ''); } catch { domain = hostOf(url); }
    return {
      url: finalUrl,
      title: cleanText(data.title, 240) || domain,
      domain,
      description: normalizeFetchedDescription(finalUrl, data.description),
      source: 'resolver',
      provider: String(data.provider || ''),
      descriptionSource: String(data.descriptionSource || ''),
      confidence: String(data.confidence || '')
    };
  });
}

async function fetchDirectMetadata(url, { signal } = {}) {
  return withTimeoutSignal(DIRECT_FETCH_TIMEOUT, signal, async innerSignal => {
    const response = await fetch(url, { method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store', redirect: 'follow', referrerPolicy: 'no-referrer', signal: innerSignal });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const contentType = response.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) throw new Error('HTMLではありません');
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const finalUrl = response.url || url;
    const domain = new URL(finalUrl).hostname.replace(/^www\./i, '');
    return {
      url: finalUrl,
      title: cleanText(meta(doc, ['meta[property="og:title"]', 'meta[name="twitter:title"]', 'title']), 240) || domain,
      domain,
      description: normalizeFetchedDescription(finalUrl, meta(doc, ['meta[name="description"]', 'meta[property="og:description"]', 'meta[name="twitter:description"]'])),
      source: 'direct'
    };
  });
}

async function fetchMicrolinkMetadata(url, { signal } = {}) {
  return withTimeoutSignal(MICROLINK_TIMEOUT, signal, async innerSignal => {
    const endpoint = new URL(MICROLINK_ENDPOINT);
    endpoint.searchParams.set('url', url);
    endpoint.searchParams.set('meta.title', 'true');
    endpoint.searchParams.set('meta.description', 'true');
    // normalized description が空・定型文でも、同じ1リクエスト内で本文/microdataを保険として拾う。
    // YouTube は itemprop=description、一般記事は article/main の先頭段落を優先する。
    endpoint.searchParams.set('data.quickDescription.0.selector', 'meta[itemprop="description"]');
    endpoint.searchParams.set('data.quickDescription.0.attr', 'content');
    endpoint.searchParams.set('data.quickDescription.1.selector', '[itemprop="description"]');
    endpoint.searchParams.set('data.quickDescription.1.attr', 'text');
    endpoint.searchParams.set('data.quickDescription.2.selector', 'article p');
    endpoint.searchParams.set('data.quickDescription.2.attr', 'text');
    endpoint.searchParams.set('data.quickDescription.3.selector', 'main p');
    endpoint.searchParams.set('data.quickDescription.3.attr', 'text');
    endpoint.searchParams.set('filter', 'url,title,description,quickDescription');
    const response = await fetch(endpoint.href, { method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', headers: { Accept: 'application/json' }, signal: innerSignal });
    if (response.status === 429) {
      const resetHeader = response.headers.get('x-rate-limit-reset');
      let resetAt = null;
      if (resetHeader) {
        const n = Number(resetHeader);
        resetAt = Number.isFinite(n) ? (n > 1e12 ? n : n * 1000) : (Date.parse(resetHeader) || null);
      }
      const rateError = new Error('rate limited');
      rateError.code = 'rate'; rateError.resetAt = resetAt;
      throw rateError;
    }
    if (!response.ok) throw new Error('metadata HTTP ' + response.status);
    const payload = await response.json();
    if (payload?.status !== 'success' || !payload?.data) throw new Error(payload?.message || 'ページ情報を取得できませんでした');
    const data = payload.data;
    const finalUrl = safeHttpUrl(data.url) || url;
    const domain = new URL(finalUrl).hostname.replace(/^www\./i, '');
    const normalizedDescription = normalizeFetchedDescription(finalUrl, data.description);
    const extractedDescription = normalizeFetchedDescription(finalUrl, data.quickDescription);
    return {
      url: finalUrl,
      title: cleanText(data.title, 240) || domain,
      domain,
      description: normalizedDescription || extractedDescription,
      source: extractedDescription && !normalizedDescription ? 'microlink-extract' : 'microlink'
    };
  });
}

/* ---------- ページ情報の取り直しの枠(quick-links-refetch-v1。同期しない) ---------- */
const REFETCH_KEY = 'quick-links-refetch-v1';
const REFETCH_DAILY_LIMIT = 20; // まとめて取り直すときはここで止める(手で保存する5件を残すため)

function refetchDayKey(t = Date.now()) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function loadRefetchState() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(REFETCH_KEY) || 'null'); } catch { /* 壊れていれば作り直す */ }
  const failed = { ...(saved?.failed || {}) };
  const cutoff = Date.now() - 7 * DAY; // 失敗したリンクは7日間まとめての対象から外す
  Object.keys(failed).forEach(id => { if (timeValue(failed[id]) < cutoff) delete failed[id]; });
  const today = refetchDayKey();
  if (!saved || saved.day !== today) return { day: today, used: 0, blockedUntil: null, queue: [], pos: 0, batch: null, failed };
  return {
    day: saved.day,
    used: Number(saved.used || 0),
    blockedUntil: saved.blockedUntil || null,
    queue: Array.isArray(saved.queue) ? saved.queue : [],
    pos: Number(saved.pos || 0),
    batch: Array.isArray(saved.batch) ? saved.batch : null,
    failed
  };
}
const RF = loadRefetchState();
function saveRF() { try { localStorage.setItem(REFETCH_KEY, JSON.stringify(RF)); } catch { /* 保存できなくても手入れは動く */ } }
function refetchBlocked() { return !!(RF.blockedUntil && Date.now() < timeValue(RF.blockedUntil)); }
function markFetchFailed(id) { if (id) { RF.failed[id] = new Date().toISOString(); saveRF(); } }
function endOfTodayIso() { const d = new Date(); d.setHours(23, 59, 59, 999); return d.toISOString(); }

// { ok:true, data } か { ok:false, reason:'timeout'|'rate'|'network'|'login'|'suspicious' } を返す。
// signalがabortされたら例外をそのまま投げる(呼び出し側で無視させる)。bulk:trueはまとめて取り直すときの枠を守る
async function fetchPageMetadata(url, { signal, bulk = false } = {}) {
  if (isLoginHost(url)) return { ok: false, reason: 'login' };

  let best = { url, title: '', domain: hostOf(url), description: '', source: '' };
  let lastReason = 'network';
  const youtubeId = youtubeVideoId(url);

  if (youtubeId) {
    try {
      const youtube = await fetchYouTubeOEmbedMetadata(url, { signal });
      if (!looksSuspicious(youtube)) best = mergeFetchedMetadata(best, youtube, url);
    } catch (error) {
      if (signal?.aborted) throw error;
      lastReason = error?.code === 'timeout' ? 'timeout' : 'network';
    }
  }

  try {
    const resolver = await fetchResolverMetadata(url, { signal });
    if (!looksSuspicious(resolver)) {
      best = mergeFetchedMetadata(best, resolver, url);
      if (hasCompleteMetadata(best)) return { ok: true, data: best };
    }
  } catch (error) {
    if (signal?.aborted) throw error;
    lastReason = error?.code === 'timeout' ? 'timeout' : 'network';
  }

  // YouTube本体はブラウザからのHTML取得がCORS等で失敗しやすい。
  // oEmbedでタイトルを先に確保したYouTubeだけは、無駄な直fetchを飛ばしてresolver/Microlinkへ任せる。
  if (!youtubeId) {
    try {
      const direct = await fetchDirectMetadata(url, { signal });
      if (!looksSuspicious(direct)) {
        best = mergeFetchedMetadata(best, direct, url);
        if (hasCompleteMetadata(best)) return { ok: true, data: best };
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      lastReason = error?.code === 'timeout' ? 'timeout' : 'network';
    }
  }

  if (refetchBlocked() || (bulk && RF.used >= REFETCH_DAILY_LIMIT)) {
    return hasMetadata(best) ? { ok: true, data: best } : { ok: false, reason: 'rate' };
  }

  try {
    const microlink = await fetchMicrolinkMetadata(url, { signal });
    RF.used += 1; saveRF();
    if (!looksSuspicious(microlink)) best = mergeFetchedMetadata(best, microlink, url);
    return hasMetadata(best) ? { ok: true, data: best } : { ok: false, reason: lastReason };
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error?.code === 'rate') {
      RF.blockedUntil = error.resetAt ? new Date(error.resetAt).toISOString() : endOfTodayIso();
      saveRF();
      return hasMetadata(best) ? { ok: true, data: best } : { ok: false, reason: 'rate' };
    }
    return hasMetadata(best)
      ? { ok: true, data: best }
      : { ok: false, reason: error?.code === 'network' ? 'network' : 'timeout' };
  }
}

function careCandidates() {
  const cutoff = Date.now() - 7 * DAY;
  const excluded = new Set(Object.keys(RF.failed || {}).filter(id => timeValue(RF.failed[id]) >= cutoff));
  const active = state.items.filter(item => !item.archived);
  const need = active.filter(item => (!item.description || looksPlaceholder(item.title, item.url)) && !excluded.has(item.id));
  return {
    fetchable: need.filter(item => !isLoginHost(item.url)),
    login: need.filter(item => isLoginHost(item.url)),
    noDescription: active.filter(item => !item.description).length,
    placeholder: active.filter(item => looksPlaceholder(item.title, item.url)).length
  };
}

/* ============ プロンプトの「最近・久しぶり」(app.html を移した) ============ */

function shouldShowPromptReuse() {
  return !state.query.trim();
}

function getRecentPrompts() {
  if (!shouldShowPromptReuse()) return [];
  return state.promptMemos
    .filter(memo => timeValue(memo.lastCopiedAt) > 0)
    .sort((a, b) => timeValue(b.lastCopiedAt) - timeValue(a.lastCopiedAt))
    .slice(0, 3);
}

function getDormantPrompt(recent = []) {
  if (!shouldShowPromptReuse()) return null;
  const recentIds = new Set(recent.map(memo => memo.id));
  const minimumAge = 60 * DAY;
  const now = Date.now();
  const candidates = state.promptMemos
    .filter(memo => {
      const lastCopied = timeValue(memo.lastCopiedAt);
      return Number(memo.copyCount || 0) >= 2 && lastCopied > 0 && now - lastCopied >= minimumAge && !recentIds.has(memo.id);
    })
    .map(memo => {
      const daysSinceUse = Math.floor((now - timeValue(memo.lastCopiedAt)) / DAY);
      const score = daysSinceUse + Math.log2(Number(memo.copyCount || 0) + 1) * 45;
      return { memo, daysSinceUse, score };
    })
    .sort((a, b) => b.score - a.score || b.daysSinceUse - a.daysSinceUse || Number(b.memo.copyCount || 0) - Number(a.memo.copyCount || 0));
  const shortlist = candidates.slice(0, 3);
  if (!shortlist.length) return null;
  const dayIndex = Math.floor(now / DAY) % shortlist.length;
  return shortlist[dayIndex];
}

function formatTimeAway(days) {
  if (days >= 365) return `${Math.floor(days / 365)}年ぶり`;
  if (days >= 60) return `${Math.floor(days / 30)}か月ぶり`;
  return `${days}日ぶり`;
}

/* ============ 引き出しの整理(category-organizer.js のデータ操作を移した) ============ */

function notifyContentChanged(reason) {
  window.dispatchEvent(new CustomEvent('quicklinks-content-changed', { detail: { reason } }));
}

const organizerConfig = {
  links: {
    label: '引き出し',
    names: () => [...new Set((state.projects || []).map(v => cleanName(v)))],
    count: name => state.items.filter(item => !item.archived && (item.projectName || '未分類') === name).length
  },
  prompts: {
    label: 'カテゴリ',
    names: () => [...new Set((state.promptCategories || []).map(v => cleanName(v)))],
    count: name => state.promptMemos.filter(memo => (memo.categoryName || '未分類') === name).length
  }
};

function candidateKey(name) {
  return String(name || '').normalize('NFKC').toLowerCase().replace(/[\s　・･._\-_/\\]+/g, '').trim();
}

function similarPairs(kind) {
  const names = organizerConfig[kind].names();
  const groups = new Map();
  names.forEach(name => {
    const key = candidateKey(name);
    if (!key) return;
    const list = groups.get(key) || [];
    list.push(name);
    groups.set(key, list);
  });
  return [...groups.values()].filter(list => list.length > 1);
}

function replaceName(list, oldName, newName) {
  const out = [];
  (Array.isArray(list) ? list : []).forEach(value => { const name = value === oldName ? newName : value; if (!out.includes(name)) out.push(name); });
  if (!out.includes(newName)) out.push(newName);
  return out.length ? out : ['未分類'];
}

function mergeName(list, fromName, toName) {
  const out = [];
  (Array.isArray(list) ? list : []).forEach(value => { if (value === fromName) return; if (!out.includes(value)) out.push(value); });
  if (!out.includes(toName)) out.push(toName);
  return out.length ? out : ['未分類'];
}

function restoreName(list, name, index) {
  const out = [...new Set(Array.isArray(list) ? list : [])];
  if (out.includes(name)) return out;
  const at = Number.isInteger(index) && index >= 0 ? Math.min(index, out.length) : out.length;
  out.splice(at, 0, name);
  return out.length ? out : ['未分類'];
}

function performRename(kind, oldName, newName) {
  if (kind === 'links') {
    state.items.forEach(item => { if ((item.projectName || '未分類') === oldName) item.projectName = newName; });
    if (state.projectColors[oldName] && !state.projectColors[newName]) state.projectColors[newName] = state.projectColors[oldName];
    delete state.projectColors[oldName];
    if (state.currentProject === oldName) state.currentProject = newName;
    state.projects = replaceName(state.projects, oldName, newName);
  } else {
    state.promptMemos.forEach(memo => { if ((memo.categoryName || '未分類') === oldName) memo.categoryName = newName; });
    if (state.currentPromptCategory === oldName) state.currentPromptCategory = newName;
    state.promptCategories = replaceName(state.promptCategories, oldName, newName);
  }
  save();
  notifyContentChanged(kind === 'links' ? 'project-rename' : 'prompt-category-rename');
}

// 統合前の状態を返す。undoMerge にそのまま渡せば元に戻せる
function performMerge(kind, fromName, toName) {
  if (!fromName || !toName || fromName === toName) return null;
  const snapshot = {
    kind, fromName, toName, affectedIds: [],
    previousCurrent: kind === 'links' ? state.currentProject : state.currentPromptCategory,
    hadFromColor: false, fromColor: null,
    sourceIndex: kind === 'links' ? state.projects.indexOf(fromName) : state.promptCategories.indexOf(fromName)
  };
  if (kind === 'links') {
    snapshot.affectedIds = state.items.filter(item => !item.archived && (item.projectName || '未分類') === fromName).map(item => item.id);
    snapshot.hadFromColor = Object.prototype.hasOwnProperty.call(state.projectColors || {}, fromName);
    snapshot.fromColor = snapshot.hadFromColor ? JSON.parse(JSON.stringify(state.projectColors[fromName])) : null;
    const ids = new Set(snapshot.affectedIds);
    state.items.forEach(item => { if (ids.has(item.id)) item.projectName = toName; });
    delete state.projectColors[fromName];
    if (state.currentProject === fromName) state.currentProject = toName;
    state.projects = mergeName(state.projects, fromName, toName);
  } else {
    snapshot.affectedIds = state.promptMemos.filter(memo => (memo.categoryName || '未分類') === fromName).map(memo => memo.id);
    const ids = new Set(snapshot.affectedIds);
    state.promptMemos.forEach(memo => { if (ids.has(memo.id)) memo.categoryName = toName; });
    if (state.currentPromptCategory === fromName) state.currentPromptCategory = toName;
    state.promptCategories = mergeName(state.promptCategories, fromName, toName);
  }
  save();
  notifyContentChanged(kind === 'links' ? 'project-merge' : 'prompt-category-merge');
  return snapshot;
}

function undoMerge(snapshot) {
  if (!snapshot) return;
  const ids = new Set(snapshot.affectedIds || []);
  if (snapshot.kind === 'links') {
    state.items.forEach(item => { if (ids.has(item.id) && (item.projectName || '未分類') === snapshot.toName) item.projectName = snapshot.fromName; });
    if (snapshot.hadFromColor) state.projectColors[snapshot.fromName] = snapshot.fromColor; else delete state.projectColors[snapshot.fromName];
    if (snapshot.previousCurrent === snapshot.fromName && state.currentProject === snapshot.toName) state.currentProject = snapshot.fromName;
    state.projects = restoreName(state.projects, snapshot.fromName, snapshot.sourceIndex);
  } else {
    state.promptMemos.forEach(memo => { if (ids.has(memo.id) && (memo.categoryName || '未分類') === snapshot.toName) memo.categoryName = snapshot.fromName; });
    if (snapshot.previousCurrent === snapshot.fromName && state.currentPromptCategory === snapshot.toName) state.currentPromptCategory = snapshot.fromName;
    state.promptCategories = restoreName(state.promptCategories, snapshot.fromName, snapshot.sourceIndex);
  }
  save();
  notifyContentChanged(snapshot.kind === 'links' ? 'project-merge-undo' : 'prompt-category-merge-undo');
}

function deleteEmptyCategory(kind, name) {
  const c = organizerConfig[kind];
  if (c.count(name) !== 0) return false;
  if (kind === 'links') {
    state.projects = (state.projects || []).filter(v => v !== name);
    delete state.projectColors[name];
    if (!state.projects.length) state.projects = ['未分類'];
  } else {
    state.promptCategories = (state.promptCategories || []).filter(v => v !== name);
    if (!state.promptCategories.length) state.promptCategories = ['未分類'];
  }
  save();
  notifyContentChanged(kind === 'links' ? 'project-delete-empty' : 'prompt-category-delete-empty');
  return true;
}

/* ============ 入出力(app.html を移した) ============ */

function exportData() {
  const activeItems = state.items.filter(item => !item.archived).map(item => ({ ...item, archived: false }));
  const activeProjects = normalizeProjects(state.projects, activeItems);
  const activeProjectColors = Object.fromEntries(Object.entries(state.projectColors || {}).filter(([name]) => activeProjects.includes(name)));
  const activePromptCategories = normalizePromptCategories(state.promptCategories, state.promptMemos);
  const backup = {
    schemaVersion: 'quick-links-backup-v2',
    exportedAt: new Date().toISOString(),
    source: 'quick-links-mobile-localstorage-html',
    quickLinks: { items: activeItems, projects: activeProjects, projectColors: activeProjectColors, currentSortMode: state.linkSort, showArchived: false, floatingSearchEnabled: false },
    promptMemos: { items: state.promptMemos, categories: activePromptCategories }
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);
  a.href = url; a.download = `quick_links_mobile_backup_${date}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function normalizeImportedQuickLinks(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.quickLinks?.items)) return raw.quickLinks.items;
  if (Array.isArray(raw?.items)) return raw.items;
  return [];
}
function normalizeImportedPrompts(raw) {
  if (Array.isArray(raw?.promptMemos?.items)) return raw.promptMemos.items;
  if (Array.isArray(raw?.promptMemos)) return raw.promptMemos;
  return [];
}
function normalizeImportedProjects(raw, importedLinks) {
  if (Array.isArray(raw?.quickLinks?.projects)) return raw.quickLinks.projects;
  if (Array.isArray(raw?.projects)) return raw.projects;
  return (importedLinks || []).map(item => item.projectName || '未分類');
}
function normalizeImportedProjectColors(raw) { return raw?.quickLinks?.projectColors || raw?.projectColors || {}; }
function normalizeImportedPromptCategories(raw, importedPrompts) {
  if (Array.isArray(raw?.promptMemos?.categories)) return raw.promptMemos.categories;
  if (Array.isArray(raw?.promptCategories)) return raw.promptCategories;
  return (importedPrompts || []).map(memo => memo.categoryName || memo.projectName || '未分類');
}

function importFromText(text, mode = 'merge') {
  const raw = JSON.parse(text);
  const importedLinks = normalizeLinkItems(normalizeImportedQuickLinks(raw));
  const importedPrompts = normalizePromptItems(normalizeImportedPrompts(raw));
  const importedProjects = normalizeImportedProjects(raw, importedLinks);
  const importedColors = normalizeImportedProjectColors(raw);
  const importedPromptCategories = normalizeImportedPromptCategories(raw, importedPrompts);

  if (!importedLinks.length && !importedPrompts.length && !importedProjects.length && !importedPromptCategories.length) {
    return { linkAdd: 0, linkMerge: 0, promptAdd: 0, promptMerge: 0, empty: true };
  }

  if (mode === 'replace') {
    state.items = importedLinks;
    state.projects = normalizeProjects(importedProjects, importedLinks);
    state.projectColors = importedColors || {};
    state.promptMemos = importedPrompts;
    state.promptCategories = normalizePromptCategories(importedPromptCategories, importedPrompts);
    state.currentProject = 'ALL';
    state.currentPromptCategory = 'ALL';
    save();
    return { linkAdd: importedLinks.length, linkMerge: 0, promptAdd: importedPrompts.length, promptMerge: 0, replaced: true };
  }

  let linkAdd = 0, linkMerge = 0, promptAdd = 0, promptMerge = 0;
  const linkIndex = new Map();
  state.items.forEach((item, index) => linkIndex.set(getLinkKey(item), index));
  importedLinks.forEach(item => {
    const key = getLinkKey(item);
    if (linkIndex.has(key)) { const idx = linkIndex.get(key); state.items[idx] = mergeLink(state.items[idx], item); linkMerge++; }
    else { state.items.push(item); linkIndex.set(key, state.items.length - 1); linkAdd++; }
  });
  const promptIndex = new Map();
  state.promptMemos.forEach((memo, index) => promptIndex.set(getPromptKey(memo), index));
  importedPrompts.forEach(memo => {
    const key = getPromptKey(memo);
    if (promptIndex.has(key)) { const idx = promptIndex.get(key); state.promptMemos[idx] = mergePrompt(state.promptMemos[idx], memo); promptMerge++; }
    else { state.promptMemos.push(memo); promptIndex.set(key, state.promptMemos.length - 1); promptAdd++; }
  });
  state.projects = normalizeProjects([...state.projects, ...importedProjects], state.items);
  state.projectColors = { ...(state.projectColors || {}), ...(importedColors || {}) };
  state.promptCategories = normalizePromptCategories([...state.promptCategories, ...importedPromptCategories], state.promptMemos);
  save();
  return { linkAdd, linkMerge, promptAdd, promptMerge };
}

function dedupe() {
  const linkMap = new Map(); const newLinks = []; let removedLinks = 0;
  state.items.forEach(item => {
    const key = getLinkKey(item);
    if (linkMap.has(key)) { const idx = linkMap.get(key); newLinks[idx] = mergeLink(newLinks[idx], item); removedLinks++; }
    else { linkMap.set(key, newLinks.length); newLinks.push(item); }
  });
  const promptMap = new Map(); const newPrompts = []; let removedPrompts = 0;
  state.promptMemos.forEach(memo => {
    const key = getPromptKey(memo);
    if (promptMap.has(key)) { const idx = promptMap.get(key); newPrompts[idx] = mergePrompt(newPrompts[idx], memo); removedPrompts++; }
    else { promptMap.set(key, newPrompts.length); newPrompts.push(memo); }
  });
  if (!removedLinks && !removedPrompts) return { removedLinks: 0, removedPrompts: 0 };
  state.items = newLinks; state.promptMemos = newPrompts;
  state.projects = normalizeProjects(state.projects, state.items);
  state.promptCategories = normalizePromptCategories(state.promptCategories, state.promptMemos);
  save();
  return { removedLinks, removedPrompts };
}

function resetAll() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(MK_KEY);
  Object.assign(state, {
    activeTab: 'links', query: '', currentProject: 'ALL', currentPromptCategory: 'ALL', onlyFavorites: false,
    linkSort: 'recent', promptSort: 'popular', viewMode: 'rich', linkPage: 1, promptPage: 1, linkPerPage: '10', promptPerPage: '10',
    items: [], projects: ['未分類'], projectColors: {}, promptMemos: [], promptCategories: ['未分類']
  });
}

/* ============ render・toast・save の橋渡し ============ */
// 実際の描画・通知は ui.js が上書きする。ここでは同じ名前を function宣言 として先に確保するだけ
// (sync.js が save を包み直せるように const にはしない)
function render() { /* ui.js が上書きする */ }
function toast(_message, _options) { /* ui.js が上書きする */ }

load();
