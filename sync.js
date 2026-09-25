(() => {
  'use strict';

  const META_KEY = 'quick-links-sync-v1';
  const DEFAULT_ENDPOINT = 'https://quicklinks-sync.silovar-uk.workers.dev';
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function now() { return new Date().toISOString(); }
  function b64u(bytes) {
    let s = '';
    const a = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }
  function unb64u(v) {
    let s = String(v || '').replace(/-/g, '+').replace(/_/g, '/');
    s += '='.repeat((4 - s.length % 4) % 4);
    const bin = atob(s), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function rand(n) { return b64u(crypto.getRandomValues(new Uint8Array(n))); }
  function stable(v) {
    if (Array.isArray(v)) return v.map(stable);
    if (v && typeof v === 'object') {
      const o = {};
      Object.keys(v).sort().forEach(k => { o[k] = stable(v[k]); });
      return o;
    }
    return v;
  }
  function same(a, b) { return JSON.stringify(stable(a)) === JSON.stringify(stable(b)); }
  function later(a, b) {
    const x = a ? new Date(a).getTime() : 0, y = b ? new Date(b).getTime() : 0;
    return x >= y ? (a || b || null) : (b || a || null);
  }
  function earlier(a, b) {
    const x = a ? new Date(a).getTime() : 0, y = b ? new Date(b).getTime() : 0;
    if (!x) return b || a || null;
    if (!y) return a || b || null;
    return x <= y ? a : b;
  }
  function uniq(v) { return [...new Set((v || []).filter(Boolean).map(String))].sort((a,b) => a.localeCompare(b, 'ja')); }

  function defaultMeta() {
    return {
      enabled: false,
      endpoint: DEFAULT_ENDPOINT,
      vaultId: '',
      secret: '',
      deviceId: '',
      dirty: false,
      syncing: false,
      lastSyncedAt: '',
      lastError: '',
      etag: '',
      tombstones: { links: {}, prompts: {} },
      base: null,
      observed: null
    };
  }
  function loadMeta() {
    try {
      const x = JSON.parse(localStorage.getItem(META_KEY) || 'null') || {};
      const d = defaultMeta();
      return {
        ...d, ...x,
        endpoint: String(x.endpoint || d.endpoint).replace(/\/$/, ''),
        tombstones: {
          links: { ...(x.tombstones?.links || {}) },
          prompts: { ...(x.tombstones?.prompts || {}) }
        }
      };
    } catch (_) { return defaultMeta(); }
  }
  let meta = loadMeta();
  function saveMeta() {
    localStorage.setItem(META_KEY, JSON.stringify(meta));
    window.dispatchEvent(new CustomEvent('quicklinks-sync-meta'));
  }
  function publicMeta() {
    const x = clone(meta);
    delete x.secret;
    return x;
  }

  function linkItem(x) {
    return {
      id: String(x.id || ''),
      title: String(x.title || '無題'),
      url: String(x.url || ''),
      projectName: String(x.projectName || '未分類'),
      note: String(x.note || ''),
      addedAt: x.addedAt || null,
      updatedAt: x.updatedAt || x.addedAt || null,
      lastClickedAt: x.lastClickedAt || null,
      clickCount: Number(x.clickCount || 0),
      clickHistory: uniq(x.clickHistory || []),
      favoriteType: x.favoriteType || (x.isFavorite ? 'normal' : 'none'),
      favoriteExpiry: x.favoriteExpiry || null
    };
  }
  function promptItem(x) {
    return {
      id: String(x.id || ''),
      title: String(x.title || '無題のプロンプト'),
      categoryName: String(x.categoryName || x.projectName || '未分類'),
      body: String(x.body || ''),
      createdAt: x.createdAt || x.addedAt || null,
      updatedAt: x.updatedAt || x.createdAt || null,
      copyCount: Number(x.copyCount || 0),
      lastCopiedAt: x.lastCopiedAt || null
    };
  }
  function payload() {
    const links = (state.items || []).filter(x => !x.archived).map(linkItem).sort((a,b) => a.id.localeCompare(b.id));
    const prompts = (state.promptMemos || []).map(promptItem).sort((a,b) => a.id.localeCompare(b.id));
    return {
      schemaVersion: 'quick-links-sync-v1',
      links,
      prompts,
      projects: uniq([...(state.projects || []), ...links.map(x => x.projectName)]),
      promptCategories: uniq([...(state.promptCategories || []), ...prompts.map(x => x.categoryName)]),
      projectColors: clone(state.projectColors || {}),
      tombstones: clone(meta.tombstones)
    };
  }
  function ids(list) { return new Map((list || []).map(x => [String(x.id), x])); }

  function observe() {
    if (!meta.enabled || meta.syncing) return;
    const next = payload();
    const prev = meta.observed || next;
    const a = ids(prev.links), b = ids(next.links), c = ids(prev.prompts), d = ids(next.prompts);
    const t = now();
    a.forEach((_, id) => { if (!b.has(id)) meta.tombstones.links[id] = t; });
    c.forEach((_, id) => { if (!d.has(id)) meta.tombstones.prompts[id] = t; });
    b.forEach((_, id) => { if (!a.has(id) && meta.tombstones.links[id]) delete meta.tombstones.links[id]; });
    d.forEach((_, id) => { if (!c.has(id) && meta.tombstones.prompts[id]) delete meta.tombstones.prompts[id]; });
    next.tombstones = clone(meta.tombstones);
    if (!same(prev, next)) meta.dirty = true;
    meta.observed = clone(next);
    saveMeta();
  }

  function mergeField(base, local, remote, path, conflicts) {
    if (same(local, remote)) return clone(local);
    if (same(local, base)) return clone(remote);
    if (same(remote, base)) return clone(local);
    conflicts.push({ path, local: clone(local), remote: clone(remote) });
    return clone(local);
  }
  function mergeSets(base, local, remote) {
    const B = new Set(base || []), L = new Set(local || []), R = new Set(remote || []);
    const out = [];
    new Set([...B, ...L, ...R]).forEach(v => {
      const b = B.has(v), l = L.has(v), r = R.has(v);
      if (l === r ? l : l === b ? r : r === b ? l : (l || r)) out.push(v);
    });
    return uniq(out);
  }
  function canonicalUrl(v) {
    try {
      const u = new URL(String(v || ''));
      u.hash = '';
      u.hostname = u.hostname.toLowerCase();
      if (u.pathname !== '/') u.pathname = u.pathname.replace(/\/+$/, '');
      return u.toString();
    } catch (_) { return String(v || '').replace(/#.*$/, '').replace(/\/+$/, ''); }
  }
  function bootstrap(local, remote) {
    const out = clone(local);
    const rid = new Set((remote.links || []).map(x => x.id));
    const byUrl = new Map();
    (remote.links || []).forEach(x => {
      const k = canonicalUrl(x.url), list = byUrl.get(k) || [];
      list.push(x); byUrl.set(k, list);
    });
    out.links = (out.links || []).map(x => {
      if (rid.has(x.id)) return x;
      const m = byUrl.get(canonicalUrl(x.url)) || [];
      return m.length === 1 ? { ...x, id: m[0].id } : x;
    });
    const rpid = new Set((remote.prompts || []).map(x => x.id));
    const exact = new Map();
    (remote.prompts || []).forEach(x => {
      const k = JSON.stringify([x.title || '', x.body || '', x.categoryName || '未分類']), list = exact.get(k) || [];
      list.push(x); exact.set(k, list);
    });
    out.prompts = (out.prompts || []).map(x => {
      if (rpid.has(x.id)) return x;
      const m = exact.get(JSON.stringify([x.title || '', x.body || '', x.categoryName || '未分類'])) || [];
      return m.length === 1 ? { ...x, id: m[0].id } : x;
    });
    return out;
  }
  function mergeTombstones(a, b) {
    const out = { links: {}, prompts: {} };
    ['links','prompts'].forEach(kind => {
      new Set([...Object.keys(a?.[kind] || {}), ...Object.keys(b?.[kind] || {})]).forEach(id => {
        out[kind][id] = later(a?.[kind]?.[id], b?.[kind]?.[id]) || now();
      });
    });
    return out;
  }
  function mergeRecord(kind, base, local, remote, conflicts) {
    if (!base && !local) return clone(remote);
    if (!base && !remote) return clone(local);
    const id = local?.id || remote?.id || base?.id;
    const out = { id };
    const fields = kind === 'links'
      ? ['title','url','projectName','note','favoriteType','favoriteExpiry']
      : ['title','categoryName','body'];
    fields.forEach(f => { out[f] = mergeField(base?.[f], local?.[f], remote?.[f], kind + '.' + id + '.' + f, conflicts); });
    if (kind === 'links') {
      out.addedAt = earlier(local?.addedAt, remote?.addedAt) || base?.addedAt || null;
      out.updatedAt = later(local?.updatedAt, remote?.updatedAt) || base?.updatedAt || null;
      out.lastClickedAt = later(local?.lastClickedAt, remote?.lastClickedAt) || base?.lastClickedAt || null;
      out.clickHistory = uniq([...(base?.clickHistory || []), ...(local?.clickHistory || []), ...(remote?.clickHistory || [])]);
      out.clickCount = Math.max(Number(base?.clickCount || 0), Number(local?.clickCount || 0), Number(remote?.clickCount || 0));
    } else {
      out.createdAt = earlier(local?.createdAt, remote?.createdAt) || base?.createdAt || null;
      out.updatedAt = later(local?.updatedAt, remote?.updatedAt) || base?.updatedAt || null;
      out.lastCopiedAt = later(local?.lastCopiedAt, remote?.lastCopiedAt) || base?.lastCopiedAt || null;
      out.copyCount = Math.max(Number(base?.copyCount || 0), Number(local?.copyCount || 0), Number(remote?.copyCount || 0));
    }
    return out;
  }
  function mergeCollection(kind, base, local, remote, tomb, conflicts) {
    const B = ids(base), L = ids(local), R = ids(remote), out = [];
    new Set([...B.keys(), ...L.keys(), ...R.keys(), ...Object.keys(tomb || {})]).forEach(id => {
      if (tomb?.[id]) return;
      const x = mergeRecord(kind, B.get(id), L.get(id), R.get(id), conflicts);
      if (x) out.push(x);
    });
    return out.sort((a,b) => a.id.localeCompare(b.id));
  }
  function mergePayload(base, local, remote) {
    const empty = { links:[], prompts:[], projects:[], promptCategories:[], projectColors:{}, tombstones:{links:{},prompts:{}} };
    const B = base || empty, R = remote || empty;
    let L = local || empty;
    if (!base && local && remote) L = bootstrap(L, R);
    const conflicts = [];
    const tomb = mergeTombstones(L.tombstones, R.tombstones);
    const merged = {
      schemaVersion: 'quick-links-sync-v1',
      links: mergeCollection('links', B.links, L.links, R.links, tomb.links, conflicts),
      prompts: mergeCollection('prompts', B.prompts, L.prompts, R.prompts, tomb.prompts, conflicts),
      projects: mergeSets(B.projects, L.projects, R.projects),
      promptCategories: mergeSets(B.promptCategories, L.promptCategories, R.promptCategories),
      projectColors: { ...(R.projectColors || {}), ...(L.projectColors || {}) },
      tombstones: tomb
    };
    merged.projects = uniq([...merged.projects, ...merged.links.map(x => x.projectName)]);
    merged.promptCategories = uniq([...merged.promptCategories, ...merged.prompts.map(x => x.categoryName)]);
    return { merged, conflicts };
  }
  function resolveConflicts(merged, conflicts, choices) {
    const out = clone(merged);
    conflicts.forEach((c, i) => {
      const parts = c.path.split('.'), kind = parts[0], id = parts[1], field = parts[2];
      const item = (out[kind] || []).find(x => x.id === id);
      if (item) item[field] = clone((choices?.[i] || 'local') === 'remote' ? c.remote : c.local);
    });
    return out;
  }

  async function masterKey() {
    return crypto.subtle.importKey('raw', unb64u(meta.secret), 'HKDF', false, ['deriveKey','deriveBits']);
  }
  function hkdf(info) {
    return { name:'HKDF', hash:'SHA-256', salt:enc.encode('quicklinks:' + meta.vaultId), info:enc.encode(info) };
  }
  async function aesKey() {
    return crypto.subtle.deriveKey(hkdf('quicklinks-encryption-v1'), await masterKey(), { name:'AES-GCM', length:256 }, false, ['encrypt','decrypt']);
  }
  async function authToken() {
    return b64u(await crypto.subtle.deriveBits(hkdf('quicklinks-auth-v1'), await masterKey(), 256));
  }
  async function encrypt(data) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt(
      { name:'AES-GCM', iv, additionalData:enc.encode('quicklinks:' + meta.vaultId + ':v1') },
      await aesKey(),
      enc.encode(JSON.stringify(data))
    );
    return { schemaVersion:'quick-links-cipher-v1', iv:b64u(iv), ciphertext:b64u(cipher) };
  }
  async function decrypt(env) {
    const plain = await crypto.subtle.decrypt(
      { name:'AES-GCM', iv:unb64u(env.iv), additionalData:enc.encode('quicklinks:' + meta.vaultId + ':v1') },
      await aesKey(),
      unb64u(env.ciphertext)
    );
    return JSON.parse(dec.decode(plain));
  }
  async function headers(extra) {
    return { Authorization:'Bearer ' + await authToken(), ...(extra || {}) };
  }
  async function getRemote() {
    const r = await fetch(meta.endpoint + '/v1/vault/' + encodeURIComponent(meta.vaultId), {
      method:'GET', headers:await headers({ Accept:'application/json' }), cache:'no-store'
    });
    if (r.status === 404) return { exists:false, data:null, etag:'' };
    if (r.status === 401) throw new Error('同期キーが一致しません');
    if (!r.ok) throw new Error('同期データを取得できませんでした (' + r.status + ')');
    let env;
    try { env = await r.json(); } catch (_) { throw new Error('同期データを読み取れませんでした'); }
    let data;
    try { data = await decrypt(env); } catch (_) { throw new Error('同期データを復号できませんでした'); }
    return { exists:true, data, etag:r.headers.get('ETag') || '' };
  }
  async function putRemote(data, etag, createOnly) {
    const h = await headers({ 'Content-Type':'application/json' });
    if (createOnly) h['If-None-Match'] = '*';
    else if (etag) h['If-Match'] = etag;
    const r = await fetch(meta.endpoint + '/v1/vault/' + encodeURIComponent(meta.vaultId), {
      method:'PUT', headers:h, body:JSON.stringify(await encrypt(data)), cache:'no-store'
    });
    if (r.status === 409 || r.status === 412) return { conflict:true };
    if (r.status === 401) throw new Error('同期キーが一致しません');
    if (!r.ok) throw new Error('同期データを保存できませんでした (' + r.status + ')');
    return { conflict:false, etag:r.headers.get('ETag') || '' };
  }

  function apply(data, etag) {
    localStorage.setItem('quick-links-sync-last-good-v1', JSON.stringify({ savedAt:now(), data:payload() }));
    state.items = (data.links || []).map(x => ({ ...x, archived:false, isFavorite:x.favoriteType !== 'none' }));
    state.promptMemos = (data.prompts || []).map(x => ({ ...x }));
    state.projects = uniq([...(data.projects || []), ...state.items.map(x => x.projectName)]);
    state.promptCategories = uniq([...(data.promptCategories || []), ...state.promptMemos.map(x => x.categoryName)]);
    state.projectColors = clone(data.projectColors || {});
    meta.tombstones = clone(data.tombstones || { links:{}, prompts:{} });
    meta.base = clone(data);
    meta.observed = clone(data);
    meta.dirty = false;
    meta.syncing = false;
    meta.lastError = '';
    meta.lastSyncedAt = now();
    meta.etag = etag || '';
    saveMeta();
    rawSave();
    render();
  }
  function diff(before, after) {
    function one(a, b) {
      const A = ids(a), B = ids(b); let added=0, updated=0, deleted=0;
      B.forEach((v,id) => { if (!A.has(id)) added++; else if (!same(A.get(id),v)) updated++; });
      A.forEach((_,id) => { if (!B.has(id)) deleted++; });
      return { added, updated, deleted };
    }
    return { links:one(before?.links || [], after?.links || []), prompts:one(before?.prompts || [], after?.prompts || []) };
  }

  async function syncNow(choices) {
    if (!meta.enabled) throw new Error('端末間同期が設定されていません');
    meta.syncing = true; meta.lastError = ''; saveMeta();
    const local = payload();
    try {
      for (let attempt=0; attempt<3; attempt++) {
        const remote = await getRemote();
        if (!remote.exists) {
          const w = await putRemote(local, '', true);
          if (w.conflict) continue;
          const result = { localToShared:diff({links:[],prompts:[]}, local), sharedToLocal:diff(local, local) };
          apply(local, w.etag);
          return { result };
        }
        const x = mergePayload(meta.base, local, remote.data);
        if (x.conflicts.length && !choices) {
          const e = new Error('同期内容に競合があります');
          e.code = 'SYNC_CONFLICT'; e.conflicts = x.conflicts; throw e;
        }
        const merged = x.conflicts.length ? resolveConflicts(x.merged, x.conflicts, choices) : x.merged;
        const w = await putRemote(merged, remote.etag, false);
        if (w.conflict) continue;
        const result = { localToShared:diff(remote.data, merged), sharedToLocal:diff(local, merged) };
        apply(merged, w.etag);
        return { result };
      }
      throw new Error('別端末と更新が重なりました。もう一度同期してください');
    } catch (e) {
      meta.syncing = false; meta.lastError = e.message || '同期できませんでした'; saveMeta(); throw e;
    }
  }

  function enableNew() {
    meta.enabled = true;
    meta.vaultId = rand(18);
    meta.secret = rand(32);
    meta.deviceId = rand(12);
    meta.dirty = true;
    meta.base = null;
    meta.observed = payload();
    meta.lastError = '';
    saveMeta();
  }
  function pairToken() {
    return b64u(enc.encode(JSON.stringify({ v:1, endpoint:meta.endpoint, vaultId:meta.vaultId, secret:meta.secret })));
  }
  function pairUrl() {
    const u = new URL(location.href);
    u.search = '';
    u.hash = 'pair=' + pairToken();
    return u.toString();
  }
  function consumePair() {
    const p = new URLSearchParams(location.hash.replace(/^#/, ''));
    const token = p.get('pair');
    if (!token) return false;
    const x = JSON.parse(dec.decode(unb64u(token)));
    if (x.v !== 1 || !x.vaultId || !x.secret || !x.endpoint) throw new Error('連携リンクが正しくありません');
    meta.enabled = true;
    meta.endpoint = String(x.endpoint).replace(/\/$/, '');
    meta.vaultId = String(x.vaultId);
    meta.secret = String(x.secret);
    meta.deviceId = rand(12);
    meta.base = null;
    meta.observed = payload();
    meta.dirty = !!((state.items || []).length || (state.promptMemos || []).length);
    meta.lastError = '';
    history.replaceState(null, '', location.pathname + location.search);
    saveMeta();
    return true;
  }
  function disconnect() {
    meta = defaultMeta();
    meta.observed = payload();
    saveMeta();
  }

  const rawSave = save;
  save = function(...args) {
    const r = rawSave.apply(this, args);
    try { observe(); } catch (e) { console.warn('sync observe failed', e); }
    return r;
  };

  function esc(v) {
    return String(v ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  }
  function addUi() {
    const actions = document.querySelector('.top-actions');
    if (actions && !document.getElementById('syncTopBtn')) {
      const b = document.createElement('button');
      b.id = 'syncTopBtn'; b.className = 'icon-btn quick-sync-top'; b.type = 'button'; b.textContent = '↻'; b.title = '端末間同期';
      actions.insertBefore(b, actions.firstChild);
      b.addEventListener('click', () => runSync());
    }
    const panel = document.getElementById('settingsPanel');
    if (panel && !document.getElementById('syncCard')) {
      const c = document.createElement('div'); c.id = 'syncCard'; c.className = 'settings-card quick-sync-card';
      panel.insertBefore(c, panel.firstChild);
    }
    if (!document.getElementById('syncModal')) {
      const m = document.createElement('div'); m.id='syncModal'; m.className='modal'; m.setAttribute('aria-hidden','true');
      m.innerHTML = '<div class="modal-sheet quick-sync-sheet"><div class="modal-head"><h2 class="modal-title" id="syncModalTitle">端末間同期</h2><button class="modal-close" id="syncModalClose">×</button></div><div id="syncModalBody"></div></div>';
      document.body.appendChild(m);
      document.getElementById('syncModalClose').addEventListener('click', closeSyncModal);
    }
  }
  function openSyncModal(title, html) {
    document.getElementById('syncModalTitle').textContent = title;
    document.getElementById('syncModalBody').innerHTML = html;
    const m = document.getElementById('syncModal'); m.classList.add('open'); m.setAttribute('aria-hidden','false');
  }
  function closeSyncModal() {
    const m = document.getElementById('syncModal'); m.classList.remove('open'); m.setAttribute('aria-hidden','true');
  }
  function fmt(v) {
    if (!v) return 'まだ同期していません';
    const d = new Date(v); return d.toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
  }
  function renderSyncUi() {
    addUi();
    const b = document.getElementById('syncTopBtn');
    if (b) {
      b.hidden = !meta.enabled;
      b.disabled = meta.syncing;
      b.classList.toggle('is-dirty', !!meta.dirty);
      b.classList.toggle('is-error', !!meta.lastError);
      b.classList.toggle('is-syncing', !!meta.syncing);
    }
    const c = document.getElementById('syncCard');
    if (!c) return;
    if (!meta.enabled) {
      c.innerHTML = '<div class="quick-sync-head"><div><h2 class="settings-title">端末間同期</h2><p class="settings-lead">普段はこの端末だけに保存。必要なときだけ、別端末と全件を同期します。</p></div><span class="quick-sync-badge">端末保存</span></div><button class="btn primary quick-sync-main" id="syncStartBtn">同期をはじめる</button><div class="quick-sync-note">ログイン不要。同期ボタンを押したときだけ通信します。</div>';
      document.getElementById('syncStartBtn').addEventListener('click', async () => {
        const setupBackup = clone(meta);
        enableNew(); renderSyncUi();
        try {
          const r = await syncNow();
          showResult(r.result);
          toast('端末間同期を設定しました');
        } catch (e) {
          meta = setupBackup;
          saveMeta();
          handleError(e);
        }
        renderSyncUi();
      });
      return;
    }
    const status = meta.lastError ? '同期できませんでした' : meta.dirty ? '未同期の変更あり' : '同期済み';
    c.innerHTML = '<div class="quick-sync-head"><div><h2 class="settings-title">端末間同期</h2><p class="settings-lead">' + esc(status) + ' · 最終同期 ' + esc(fmt(meta.lastSyncedAt)) + '</p></div><span class="quick-sync-badge ' + (meta.lastError ? 'bad' : meta.dirty ? 'dirty' : 'ok') + '">' + (meta.lastError ? '!' : meta.dirty ? '●' : '✓') + '</span></div>' + (meta.lastError ? '<div class="quick-sync-error">' + esc(meta.lastError) + '</div>' : '') + '<button class="btn primary quick-sync-main" id="syncNowBtn">' + (meta.syncing ? '同期中…' : '今すぐ同期') + '</button><div class="settings-grid quick-sync-actions"><button class="btn ghost" id="syncPairBtn">別の端末を追加</button><button class="btn ghost" id="syncDisconnectBtn">この端末の連携を解除</button></div>';
    document.getElementById('syncNowBtn').disabled = meta.syncing;
    document.getElementById('syncNowBtn').addEventListener('click', () => runSync());
    document.getElementById('syncPairBtn').addEventListener('click', showPair);
    document.getElementById('syncDisconnectBtn').addEventListener('click', () => {
      if (!confirm('この端末の同期設定だけを解除しますか？\nリンクとプロンプトは端末に残ります。')) return;
      disconnect(); toast('この端末の連携を解除しました'); renderSyncUi();
    });
  }
  function showPair() {
    openSyncModal('別の端末を追加',
      '<p class="settings-lead">この連携リンクには同期キーが含まれます。自分の端末へだけ送ってください。</p><textarea id="syncPairText" class="textarea quick-sync-pair" readonly></textarea><div class="settings-grid"><button class="btn primary" id="syncPairCopy">連携リンクをコピー</button><button class="btn ghost" id="syncPairShare">共有する</button></div><div class="quick-sync-note">リンクを開いた端末では、確認後にURLから同期キーを消します。</div>'
    );
    document.getElementById('syncPairText').value = pairUrl();
    document.getElementById('syncPairCopy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(pairUrl()); toast('連携リンクをコピーしました'); } catch (_) { toast('コピーできませんでした'); }
    });
    const sh = document.getElementById('syncPairShare');
    sh.hidden = !navigator.share;
    sh.addEventListener('click', async () => { try { await navigator.share({ title:'Quick Links 端末連携', url:pairUrl() }); } catch (_) {} });
  }
  function showConflicts(conflicts) {
    let html = '<p class="settings-lead">同じ項目が両方の端末で変更されています。残す内容を選んでください。</p><div class="quick-sync-conflicts">';
    conflicts.forEach((c,i) => {
      const f = esc(c.path.split('.').pop());
      html += '<div class="quick-sync-conflict" data-i="' + i + '"><strong>' + f + '</strong><label><input type="radio" name="sc' + i + '" value="local" checked> この端末：' + esc(String(c.local ?? '')) + '</label><label><input type="radio" name="sc' + i + '" value="remote"> 共有側：' + esc(String(c.remote ?? '')) + '</label></div>';
    });
    html += '</div><button class="btn primary quick-sync-main" id="syncResolveBtn">選択して同期</button>';
    openSyncModal('同期する内容を確認', html);
    document.getElementById('syncResolveBtn').addEventListener('click', async () => {
      const choices = {};
      document.querySelectorAll('.quick-sync-conflict[data-i]').forEach(row => { choices[row.dataset.i] = row.querySelector('input:checked').value; });
      closeSyncModal(); await runSync(choices);
    });
  }
  function resultText(group) {
    const a = group.links || {}, b = group.prompts || {}, p = [];
    if (a.added) p.push('リンク＋' + a.added);
    if (a.updated) p.push('リンク更新' + a.updated);
    if (a.deleted) p.push('リンク−' + a.deleted);
    if (b.added) p.push('プロンプト＋' + b.added);
    if (b.updated) p.push('プロンプト更新' + b.updated);
    if (b.deleted) p.push('プロンプト−' + b.deleted);
    return p.join(' / ') || '変更なし';
  }
  function showResult(r) {
    let n = document.getElementById('syncResult');
    if (!n) { n=document.createElement('div'); n.id='syncResult'; n.className='quick-sync-result'; document.body.appendChild(n); }
    n.innerHTML = '<strong>✓ 同期完了</strong><span>この端末 → 共有　' + esc(resultText(r.localToShared)) + '</span><span>共有 → この端末　' + esc(resultText(r.sharedToLocal)) + '</span>';
    n.classList.add('show'); clearTimeout(n._t); n._t=setTimeout(() => n.classList.remove('show'), 3500);
  }
  function handleError(e) {
    if (e.code === 'SYNC_CONFLICT') showConflicts(e.conflicts || []);
    else toast(e.message || '同期できませんでした');
  }
  async function runSync(choices) {
    if (meta.syncing) return;
    try { const r=await syncNow(choices); showResult(r.result); }
    catch (e) { handleError(e); }
    renderSyncUi();
  }

  window.addEventListener('quicklinks-sync-meta', renderSyncUi);
  addUi();
  if (meta.enabled && !meta.observed) { meta.observed = payload(); saveMeta(); }
  try {
    if (location.hash.includes('pair=')) {
      const pairBackup = clone(meta);
      if (consumePair()) {
        openSyncModal('この端末を連携',
          '<p class="settings-lead">この端末のQuick Linksと共有データを統合します。同期が成功するまで現在のデータは変更しません。</p><div class="modal-actions"><button class="btn ghost" id="syncJoinCancel">やめる</button><button class="btn primary" id="syncJoinConfirm">連携して同期</button></div>'
        );
        document.getElementById('syncJoinCancel').addEventListener('click', () => {
          meta = pairBackup;
          saveMeta();
          closeSyncModal();
          renderSyncUi();
        });
        document.getElementById('syncJoinConfirm').addEventListener('click', async () => { closeSyncModal(); await runSync(); });
      }
    }
  } catch (e) {
    history.replaceState(null, '', location.pathname + location.search);
    toast(e.message || '連携リンクを読み取れませんでした');
  }
  renderSyncUi();

  window.QuickLinksSync = { syncNow, pairUrl, getMeta:publicMeta, disconnect };
})();