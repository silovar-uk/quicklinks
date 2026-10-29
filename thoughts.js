/* Quick Links — capture thoughts separately; browse links and thoughts together. */
(() => {
  'use strict';

  const NOTE_KEY = 'quicklinks-thoughts-v1';
  const SETTINGS_KEY = 'quicklinks-discovery-v1';
  const read = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  };
  const saveLocal = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const byId = id => document.getElementById(id);
  const h = value => String(value ?? '').replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  const stamp = value => {
    const ms = new Date(value || 0).getTime();
    return Number.isFinite(ms) ? ms : 0;
  };
  const dateLabel = value => value ? new Date(value).toLocaleDateString('ja-JP') : '日付不明';
  const age = value => Math.max(0, Math.floor((Date.now() - stamp(value)) / 86400000));
  const ago = value => {
    const n = age(value);
    return n === 0 ? '今日' : n === 1 ? '昨日' : n < 60 ? n + '日前' : n < 365 ? Math.floor(n / 30) + 'か月前' : Math.floor(n / 365) + '年前';
  };
  const validModes = ['mixed', 'links', 'thoughts'];
  const validPeriods = ['all', 'month', 'quarter', 'year'];
  let notes = read(NOTE_KEY, []);
  if (!Array.isArray(notes)) notes = [];
  let settings = {mode:'mixed', ratio:30, period:'all', ...read(SETTINGS_KEY, {})};
  if (!validModes.includes(settings.mode)) settings.mode = 'mixed';
  if (!validPeriods.includes(settings.period)) settings.period = 'all';
  settings.ratio = Math.max(0, Math.min(100, Number(settings.ratio) || 0));
  let listMode = 'all', editId = null, appending = false;
  let order = [], position = 0, orderKey = '', dirty = true;

  const persistNotes = () => {
    saveLocal(NOTE_KEY, notes);
    dirty = true;
    window.dispatchEvent(new CustomEvent('quicklinks:thoughts-updated'));
  };
  const update = (id, fn) => {
    notes = notes.map(n => n.id === id ? fn(n) : n);
    persistNotes();
    refresh();
  };
  const refresh = () => {
    if (typeof render === 'function') render();
  };
  const findNote = id => notes.find(n => n.id === id);
  const activeNotes = () => notes.filter(n => !n.done && (!n.snooze || stamp(n.snooze) <= Date.now()));
  function withinPeriod(value) {
    if (settings.period === 'all') return true;
    if (!stamp(value)) return false;
    const d = age(value);
    return settings.period === 'month' ? d >= 23 && d <= 37
      : settings.period === 'quarter' ? d >= 76 && d <= 104
      : d >= 335 && d <= 395;
  }

  function seededRandom(seed) {
    let x = seed >>> 0;
    return () => {
      x += 0x6D2B79F5;
      let t = x;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function hash(text) {
    let out = 2166136261;
    for (const c of text) { out ^= c.charCodeAt(0); out = Math.imul(out, 16777619); }
    return out >>> 0;
  }
  function shuffle(items, random) {
    const a = [...items];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function mixedOrder(linkIds, thoughtIds, ratio, random) {
    const links = [...linkIds].map(id => ({kind:'link', id}));
    const thoughts = shuffle(thoughtIds, random).map(id => ({kind:'thought', id}));
    const result = [];
    while (links.length || thoughts.length) {
      const n = Math.min(10, links.length + thoughts.length);
      let thoughtCount = Math.min(thoughts.length, Math.round(n * ratio / 100));
      const linkCount = Math.min(links.length, n - thoughtCount);
      thoughtCount = Math.min(thoughts.length, n - linkCount);
      result.push(...shuffle([...links.splice(0, linkCount), ...thoughts.splice(0, thoughtCount)], random));
    }
    return result;
  }
  function isMixed(U) {
    return U?.view === 'links' && U?.drawer === 'ALL' && U?.kind === 'all'
      && (settings.mode !== 'links' || settings.period !== 'all');
  }
  function thoughtDeckHtml(n, i, cur) {
    const latest = Array.isArray(n.history) ? n.history[n.history.length - 1] : null;
    return `<article class="card ql-thought-card${i === cur ? ' is-current' : ''}" data-id="${h(n.id)}" data-index="${i}" aria-label="${i+1}枚目、思ったこと">
      <div class="card-meta"><span class="src">思ったこと</span><span class="mood">自分の記録</span></div>
      <span class="card-reason">${h(ago(n.created))}に残した</span>
      <h3 class="card-title text clamp6">${h(n.body)}</h3>
      ${latest ? `<p class="card-desc clamp3">追記：${h(latest.text)}</p>` : ''}
      <div class="card-actions">
        <button class="btn primary" type="button" data-thought-action="done">完了</button>
        <button class="btn quiet" type="button" data-thought-action="later">あとで</button>
        <button class="btn quiet" type="button" data-thought-action="append">追記</button>
      </div></article>`;
  }
  function renderMixedDeck({U, mk, cardHtml, findLink, markShown}) {
    if (!isMixed(U)) return false;
    const links = settings.mode === 'thoughts' ? [] : mk.order.filter(id => {
      const item = findLink(id);
      return item && !item.archived && withinPeriod(item.addedAt);
    });
    const thoughts = settings.mode === 'links' ? [] :
      activeNotes().filter(n => withinPeriod(n.created)).map(n => n.id);
    const key = [settings.mode,settings.period,settings.ratio,
      mk.order.length,mk.order[0],mk.order[mk.order.length-1],
      thoughts.join(','),new Date().toDateString()].join('|');
    if (dirty || key !== orderKey) {
      const random = seededRandom(hash(key));
      order = settings.mode === 'links' ? links.map(id => ({kind:'link',id}))
        : settings.mode === 'thoughts' ? shuffle(thoughts,random).map(id => ({kind:'thought',id}))
        : mixedOrder(links,thoughts,settings.ratio,random);
      position = Math.min(position,Math.max(0,order.length - 1));
      orderKey = key; dirty = false;
    }
    const track = byId('deckTrack');
    byId('deckCount').textContent = order.length ? `今日の束 ${position+1} / ${order.length}` : '';
    const body = order.map((e,i) => e.kind === 'thought'
      ? thoughtDeckHtml(findNote(e.id),i,position)
      : cardHtml(findLink(e.id),i,position,mk.mem)).join('');
    track.innerHTML = body + (order.length
      ? '<div class="card-end">今日の束はここまで。<br>また違う順番で出会えます。</div>'
      : '<div class="card-end">この条件の束はありません。</div>');
    const current = track.children[position];
    if (current) track.scrollLeft = current.offsetLeft - 16;
    if (order[position]?.kind === 'link') markShown(order[position].id);
    byId('deckPrev').disabled = position <= 0;
    byId('deckNext').disabled = !order.length || position >= order.length-1;
    document.querySelectorAll('.kinds [data-kind]').forEach(b =>
      b.setAttribute('aria-pressed',String(b.dataset.kind === U.kind)));
    return true;
  }
  function markCurrent(index) {
    position = Math.min(Math.max(0,index),Math.max(0,order.length - 1));
    byId('deckTrack').querySelectorAll('.card').forEach((c,i) =>
      c.classList.toggle('is-current',i === position));
    byId('deckCount').textContent = order.length ? `今日の束 ${position+1} / ${order.length}` : '';
    byId('deckPrev').disabled = position <= 0;
    byId('deckNext').disabled = !order.length || position >= order.length-1;
    if (order[position]?.kind === 'link' && typeof markShown === 'function') markShown(order[position].id);
    return position;
  }
  function setPos(index,smooth=true) {
    const pos = markCurrent(index);
    const track = byId('deckTrack'), card = track.children[pos];
    if (card) track.scrollTo({left:card.offsetLeft-16,
      behavior:smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto'});
  }
  function handleDeckCard(event,card,setPosition) {
    if (!card.classList.contains('ql-thought-card')) return false;
    const id = card.dataset.id, action = event.target.closest('[data-thought-action]')?.dataset.thoughtAction;
    if (action) {
      event.preventDefault();
      if (action === 'done') update(id, n => ({...n,done:true,updated:new Date().toISOString()}));
      if (action === 'later') update(id, n => ({...n,snooze:new Date(Date.now()+14*86400000).toISOString()}));
      if (action === 'append') openEditor(id,true);
    } else setPosition(Number(card.dataset.index));
    return true;
  }

  function thoughtItemHtml(n) {
    const latest = Array.isArray(n.history) ? n.history[n.history.length-1] : null;
    return `<article class="item ql-thought-item" data-thought-id="${h(n.id)}">
       <button type="button" class="item-main ql-thought-open" data-thought-action="edit">
         <span class="item-meta"><span class="src">思ったこと</span>
           <span>${h(ago(n.created))}</span>${n.done ? '<span>完了済み</span>' : ''}
         </span>
         <span class="item-title clamp2">${h(n.body)}</span>
         ${latest ? `<span class="item-desc clamp3">追記：${h(latest.text)}</span>` : ''}
       </button>
       <div class="item-foot ql-thought-foot">
         <span class="by">${h(dateLabel(n.created))}</span>
         <button class="btn quiet" type="button" data-thought-action="append">追記</button>
         <button class="btn quiet" type="button" data-thought-action="toggle">${n.done ? '再開' : '完了'}</button>
         <button class="btn quiet" type="button" data-thought-action="delete" aria-label="削除">削除</button>
       </div>
     </article>`;
  }
  function renderLibrary({U,state,itemHtml}) {
    const root = byId('lib'), head = byId('libHead');
    if (!root || !head) return;
    const normal = U.view === 'links' && U.drawer === 'ALL' && U.kind === 'all' && !U.query.trim();
    const toolbar = byId('ql-list-toggle');
    if (toolbar) toolbar.hidden = !normal;
    if (U.query.trim()) {
      const query = U.query.trim().toLocaleLowerCase();
      if (/^https?:\/\//i.test(query)) return;
      const matches = notes.filter(n => (n.body + ' ' + (n.history||[]).map(x=>x.text).join(' ')).toLocaleLowerCase().includes(query));
      if (!matches.length) return;
      const block = document.createElement('div');
      block.innerHTML = `<div class="group-head">思ったこと <span class="n">${matches.length}件</span></div>
        <div class="grid">${matches.map(thoughtItemHtml).join('')}</div>`;
      root.append(block);return;
    }
    if (!normal) return;
    const links = state.items.filter(x => !x.archived);
    const includeLinks = listMode !== 'thoughts', includeThoughts = listMode !== 'links';
    if (listMode === 'links') {
      byId('libTitle').textContent = 'リンク';
      byId('libCount').textContent = links.length + '件';
      return;
    }
    const records = [
      ...(includeLinks ? links.map(item => ({kind:'link',date:stamp(item.addedAt),item})) : []),
      ...(includeThoughts ? notes.map(item => ({kind:'thought',date:stamp(item.created),item})) : [])
    ];
    let sort = state.linkSort;
    if (!['recent','oldest','title'].includes(sort)) sort='recent';
    records.sort((a,b) => sort === 'title'
      ? String(a.kind==='link' ? a.item.title||'' : a.item.body||'').localeCompare(String(b.kind==='link' ? b.item.title||'' : b.item.body||''),'ja')
      : sort === 'oldest' ? a.date-b.date : b.date-a.date);
    byId('libTitle').textContent = listMode === 'thoughts' ? '思ったこと' : 'ぜんぶ';
    byId('libCount').textContent = records.length + '件';
    const select = byId('sortSelect');
    select.innerHTML = [['recent','新しい順'],['oldest','古い順'],['title','名前順']]
      .map(([v,t])=>`<option value="${v}"${v===sort?' selected':''}>${t}</option>`).join('');
    if (!records.length) {root.innerHTML='<div class="empty"><b>まだありません</b>上の保存ボタンから追加できます。</div>';return}
    if (sort === 'recent' || sort === 'oldest') {
      const groups = new Map();
      for (const e of records) {
        const d = e.date ? new Date(e.date) : null;
        const label = d ? `${d.getFullYear()}年${d.getMonth()+1}月` : '日付不明';
        if (!groups.has(label)) groups.set(label,[]);
        groups.get(label).push(e);
      }
      root.innerHTML = [...groups.entries()].map(([date,items])=>
        `<div class="month">${h(date)}に保存 <span class="n">${items.length}件</span></div>
        <div class="grid">${items.map(e=>e.kind==='link'?itemHtml(e.item):thoughtItemHtml(e.item)).join('')}</div>`).join('');
    } else root.innerHTML = `<div class="grid" style="margin-top:12px">${records.map(e=>e.kind==='link'?itemHtml(e.item):thoughtItemHtml(e.item)).join('')}</div>`;
  }

  function openEditor(id=null,append=false) {
    editId=id;appending=append;
    const n=findNote(id);
    byId('ql-thought-title').textContent=append?'追記する':id?'思ったことを編集':'思ったことを残す';
    byId('ql-thought-input').value=append?'':n?.body||'';
    byId('ql-thought-input').placeholder=append?'その後、どう思った？':'未来の自分に残したいこと';
    byId('ql-thought-dialog').showModal();
    byId('ql-thought-input').focus();
  }
  function saveEditor() {
    const value=byId('ql-thought-input').value.trim();
    if (!value) return;
    if (editId && findNote(editId)) {
      notes=notes.map(n=>n.id!==editId?n:appending
        ? {...n,history:[...(n.history||[]),{text:value,created:new Date().toISOString()}]}
        : {...n,body:value,updated:new Date().toISOString()});
    } else notes.push({id:'thought-'+Date.now()+'-'+Math.random().toString(36).slice(2),
      body:value,created:new Date().toISOString(),history:[],done:false});
    persistNotes();byId('ql-thought-dialog').close();refresh();
  }
  function onListClick(e) {
    const target=e.target.closest('.ql-thought-item');
    if (!target)return;
    e.stopPropagation();
    const id=target.dataset.thoughtId;
    const action=e.target.closest('[data-thought-action]')?.dataset.thoughtAction||'edit';
    if(action==='edit')openEditor(id);
    else if(action==='append')openEditor(id,true);
    else if(action==='toggle')update(id,n=>({...n,done:!n.done,updated:new Date().toISOString()}));
    else if(action==='delete' && confirm('この記録を削除しますか？')){
      notes=notes.filter(n=>n.id!==id);persistNotes();refresh();
    }
  }

  function init() {
    const deck=byId('deck'),head=deck?.querySelector('.deck-head');
    if(!deck||!head)return;
    // Capture remains separate: neither editor offers a link/notes type switch.
    const entry=document.createElement('div');entry.className='ql-save-entry';
    entry.innerHTML='<button type="button" class="btn" id="ql-add-link">＋ リンクを保存</button><button type="button" class="btn primary" id="ql-add-thought">＋ 思ったことを残す</button>';
    deck.parentNode.insertBefore(entry,deck);
    byId('ql-add-link').onclick=()=>byId('addButton')?.click();
    byId('ql-add-thought').onclick=()=>openEditor();

    // One original card carousel. Filters are tucked away in a small disclosure.
    const filter=document.createElement('details');filter.className='ql-filter-panel';
    filter.innerHTML=`<summary>表示：<span id="ql-filter-summary">リンク＋思ったこと</span> <span class="ql-filter-hint">調整</span></summary>
      <div class="ql-discovery-tools">
        <label>表示対象<select id="ql-discovery-mode"><option value="mixed">リンク＋思ったこと</option><option value="links">リンクだけ</option><option value="thoughts">思ったことだけ</option></select></label>
        <label>保存した時期<select id="ql-discovery-period"><option value="all">すべて</option><option value="month">1か月前</option><option value="quarter">3か月前</option><option value="year">1年前</option></select></label>
        <label id="ql-ratio-label">思ったことの割合 <output id="ql-ratio-value"></output><input type="range" min="0" max="100" step="10" id="ql-ratio"></label>
      </div><p class="ql-filter-caption">「さっと」「じっくり」や個別の引き出しでは、従来どおりリンクだけを表示します。</p>`;
    head.after(filter);
    const mode=byId('ql-discovery-mode'),period=byId('ql-discovery-period'),ratio=byId('ql-ratio');
    mode.value=settings.mode;period.value=settings.period;ratio.value=settings.ratio;
    const changed=()=>{
      settings={mode:mode.value,period:period.value,ratio:Number(ratio.value)};
      saveLocal(SETTINGS_KEY,settings);dirty=true;position=0;
      byId('ql-filter-summary').textContent=mode.options[mode.selectedIndex].textContent;
      byId('ql-ratio-value').textContent=settings.ratio+'%';
      byId('ql-ratio-label').hidden=mode.value!=='mixed';
      refresh();
    };
    mode.onchange=changed;period.onchange=changed;ratio.onchange=changed;
    byId('ql-filter-summary').textContent=mode.options[mode.selectedIndex].textContent;
    byId('ql-ratio-value').textContent=settings.ratio+'%';
    byId('ql-ratio-label').hidden=mode.value!=='mixed';

    const listToggle=document.createElement('div');
    listToggle.id='ql-list-toggle';listToggle.className='ql-list-toggle';
    listToggle.setAttribute('role','group');listToggle.setAttribute('aria-label','一覧の表示対象');
    listToggle.innerHTML='<button type="button" data-ql-list="all">すべて</button><button type="button" data-ql-list="links">リンク</button><button type="button" data-ql-list="thoughts">思ったこと</button>';
    byId('sortSelect').before(listToggle);
    listToggle.addEventListener('click',e=>{
      const button=e.target.closest('[data-ql-list]');if(!button)return;
      listMode=button.dataset.qlList;renderListButtons();refresh();
    });
    byId('lib').addEventListener('click',onListClick);
    function renderListButtons() {
      listToggle.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.qlList===listMode)));
    }
    renderListButtons();

    const dialog=document.createElement('dialog');
    dialog.id='ql-thought-dialog';dialog.className='ql-thought-dialog';
    dialog.innerHTML='<form method="dialog" class="ql-thought-form"><h2 id="ql-thought-title">思ったことを残す</h2><textarea id="ql-thought-input" rows="5" required placeholder="未来の自分に残したいこと"></textarea><div class="ql-form-actions"><button type="button" class="btn" id="ql-cancel">やめる</button><button type="button" class="btn primary" id="ql-save">保存</button></div></form>';
    document.body.append(dialog);
    byId('ql-cancel').onclick=()=>dialog.close();
    byId('ql-save').onclick=saveEditor;
    byId('ql-thought-input').addEventListener('keydown',e=>{
      if ((e.ctrlKey||e.metaKey)&&e.key==='Enter') {e.preventDefault();saveEditor()}
    });
    const observer=new MutationObserver(()=>{
      entry.hidden=deck.hidden;
      filter.hidden=deck.hidden;
    });
    observer.observe(deck,{attributes:true,attributeFilter:['hidden']});
    entry.hidden=deck.hidden;filter.hidden=deck.hidden;
    window.addEventListener('storage',e=>{
      if(e.key===NOTE_KEY){const updated=read(NOTE_KEY,[]);notes=Array.isArray(updated)?updated:[];dirty=true;refresh()}
    });
    refresh();
  }

  window.QLThoughts={isMixed,renderMixedDeck,renderLibrary,markCurrent,setPos,
    currentPos:()=>position,handleDeckCard};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
  else init();
})();
