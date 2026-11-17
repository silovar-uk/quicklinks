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
  const tagKey = v => String(v || '').normalize('NFKC').toLocaleLowerCase('ja').trim();
  const cleanTag = v => String(v || '').normalize('NFKC').replace(/^#+/, '').trim().replace(/\s+/g, ' ').slice(0,24);
  const normalizeTags = values => {
    const out = [], seen = new Set();
    for (const v of Array.isArray(values) ? values : []) {
      const tag = cleanTag(v), key = tagKey(tag);
      if (key && !seen.has(key)) {out.push(tag);seen.add(key)}
      if (out.length >= 8) break;
    }
    return out;
  };
  const thoughtTags = n => normalizeTags(n?.tags);
  const hasTag = (n, tag) => thoughtTags(n).some(t=>tagKey(t)===tagKey(tag));
  const matchesThought = (n, query) => tagKey([n.body,taskTitle(n),...(n.history||[]).map(x=>x.text),...thoughtTags(n)].join(' ')).includes(tagKey(query));
  const availableTags = () => {
    const count = new Map();
    for (const n of notes) for (const tag of thoughtTags(n)) {
      const k=tagKey(tag), old=count.get(k);
      count.set(k,{tag:old?.tag||tag,count:(old?.count||0)+1});
    }
    return [...count.values()].sort((a,b)=>b.count-a.count || a.tag.localeCompare(b.tag,'ja'));
  };
  const tagButtons = n => thoughtTags(n).length ?
    '<div class="ql-thought-tags" aria-label="タグ">' +
    thoughtTags(n).slice(0,2).map(t=>'<button class="ql-thought-tag" type="button" data-thought-action="filter-tag" data-tag="'+h(t)+'" aria-label="タグ '+h(t)+' で絞り込む">#'+h(t)+'</button>').join('') +
    (thoughtTags(n).length>2?'<span class="ql-tag-more">+'+(thoughtTags(n).length-2)+'</span>':'') + '</div>' : '';
  let notes = read(NOTE_KEY, []);
  if (!Array.isArray(notes)) notes = [];
  let settings = {mode:'mixed', ratio:30, period:'all', ...read(SETTINGS_KEY, {})};
  if (!validModes.includes(settings.mode)) settings.mode = 'mixed';
  if (!validPeriods.includes(settings.period)) settings.period = 'all';
  settings.ratio = Math.max(0, Math.min(100, Number(settings.ratio) || 0));
  let listMode = 'all', editId = null, appending = false, taskEditId = null;
  let editTags = [], showTagOptions = false, selectedTag = '';
  let nowSection = null;
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
  const day = date => {
    const d = date || new Date();
    return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
  };
  const validDay = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
    const d = new Date(value + 'T12:00:00');
    return Number.isFinite(d.getTime()) && day(d) === value;
  };
  const task = n => n && n.task && typeof n.task === 'object' ? n.task : null;
  const taskTitle = n => (task(n)?.title || n.body.split('\n').find(Boolean) || 'やること').trim();
  const dueText = n => {
    const d = task(n)?.dueOn;
    if (!validDay(d)) return '';
    return d < day() ? '期限超過 ' + d.slice(5).replace('-','/') : d === day() ? '今日が締切' : '締切 ' + d.slice(5).replace('-','/');
  };
  const reminderDue = n => {
    const t = task(n);
    return t?.status !== 'done' && !!t?.remindAt && stamp(t.remindAt) > 0 && stamp(t.remindAt) <= Date.now();
  };
  const taskSort = (a,b) => {
    const ad = task(a)?.status === 'done', bd = task(b)?.status === 'done';
    if (ad !== bd) return ad ? 1 : -1;
    const ar = reminderDue(a), br = reminderDue(b);
    if (ar !== br) return ar ? -1 : 1;
    const aa = validDay(task(a)?.dueOn) ? task(a).dueOn : '9999-12-31';
    const bb = validDay(task(b)?.dueOn) ? task(b).dueOn : '9999-12-31';
    return aa.localeCompare(bb) || stamp(b.created)-stamp(a.created);
  };
  const taskify = id => update(id, n => n.task ? n : ({
    ...n, task:{title:taskTitle(n), status:'open', dueOn:null, remindAt:null, completedAt:null},
    updated:new Date().toISOString()
  }));
  const toggleTask = id => {
    const n = findNote(id); if (!task(n)) return;
    const previous = n.task.status === 'done';
    update(id, old => ({...old, task:{...old.task,status:previous?'open':'done',
      completedAt:previous?null:new Date().toISOString()},updated:new Date().toISOString()}));
    if (!previous && typeof toast === 'function') toast('完了しました', {
      action:{label:'元に戻す',fn:()=>toggleTask(id)},ms:5000
    });
  };
  function renderNow() {
    if (!nowSection) return;
    const pending = notes.filter(n => task(n)?.status === 'open').sort(taskSort);
    nowSection.hidden = byId('deck')?.hidden || !pending.length;
    if (nowSection.hidden) { nowSection.replaceChildren(); return; }
    const top = pending.slice(0,3);
    nowSection.innerHTML = '<div class="ql-now-heading"><b>今、気にすること <span class="n">' + pending.length +
      '</span></b><button class="btn quiet" type="button" data-ql-show-tasks>全部見る</button></div>' +
      '<div class="ql-now-items">' + top.map(n => '<div class="ql-now-item" data-thought-id="' + h(n.id) +
      '"><button type="button" class="ql-task-check" data-thought-action="task-toggle" aria-label="完了にする">□</button>' +
      '<button type="button" class="ql-now-main" data-thought-action="task-edit"><span>' + h(taskTitle(n)) +
      '</span>' + (reminderDue(n) ? '<small class="ql-task-alert">思い出す時刻です</small>' : dueText(n) ?
      '<small class="ql-task-date">' + h(dueText(n)) + '</small>' : '') +
      '</button></div>').join('') + '</div>';
  }
  function openTaskEditor(id) {
    const n=findNote(id); if (!task(n)) return;
    taskEditId=id;
    byId('ql-task-title').value=taskTitle(n);
    byId('ql-task-due').value=validDay(n.task.dueOn)?n.task.dueOn:'';
    const dt=n.task.remindAt && stamp(n.task.remindAt) ? new Date(n.task.remindAt) : null;
    const local=dt ? day(dt)+'T'+String(dt.getHours()).padStart(2,'0')+':'+String(dt.getMinutes()).padStart(2,'0') : '';
    byId('ql-task-remind').value=local;
    byId('ql-task-dialog').showModal();
  }
  function removeTask() {
    const id=taskEditId, n=findNote(id);
    if(!task(n)) return;
    const saved={...n.task};
    update(id,old=>({...old,task:null,updated:new Date().toISOString()}));
    byId('ql-task-dialog').close();taskEditId=null;
    if(typeof toast==='function') toast('やることから外しました', {
      action:{label:'元に戻す',fn:()=>update(id,old=>({...old,task:saved,updated:new Date().toISOString()}))},ms:5000
    });
  }
  function saveTaskEditor() {
    const n=findNote(taskEditId); if(!task(n))return;
    const title=byId('ql-task-title').value.trim(), due=byId('ql-task-due').value;
    const input=byId('ql-task-remind').value;
    if(!title) {byId('ql-task-title').focus();return}
    if(due && !validDay(due)){byId('ql-task-due').focus();return}
    const reminder=input ? new Date(input) : null;
    if(input && (!reminder || !Number.isFinite(reminder.getTime()))) {byId('ql-task-remind').focus();return}
    update(taskEditId,old=>({...old,task:{...old.task,title,dueOn:due||null,
      remindAt:reminder?reminder.toISOString():null},updated:new Date().toISOString()}));
    byId('ql-task-dialog').close(); taskEditId=null;
  }
  function importNotes(imported,mode='merge') {
    if (!Array.isArray(imported)) return;
    if (mode==='replace') notes=imported.map(x=>({...x}));
    else {
      const m=new Map(notes.map(n=>[n.id,n]));
      imported.forEach(n=>{
        if(!n || typeof n.id!=='string'||!n.id)return;
        const old=m.get(n.id);
        if (!old || stamp(n.updated||n.created)>stamp(old.updated||old.created)) m.set(n.id,{...n});
      });
      notes=[...m.values()];
    }
    persistNotes();refresh();
  }
  const activeNotes = () => notes.filter(n => !n.done && task(n)?.status !== 'done' && (!n.snooze || stamp(n.snooze) <= Date.now()));
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
      && (settings.mode === 'thoughts' || settings.period !== 'all'
        || (settings.mode === 'mixed' && activeNotes().some(n => withinPeriod(n.created))));
  }
  function thoughtDeckHtml(n, i, cur) {
    const latest = Array.isArray(n.history) ? n.history[n.history.length-1] : null;
    const t = task(n);
    return '<article class="card ql-thought-card' + (i===cur?' is-current':'') +
      '" data-id="' + h(n.id) + '" data-index="' + i + '" aria-label="' + (i+1) + '枚目、思ったこと">' +
      '<div class="card-meta"><span class="src">思ったこと</span><span class="mood">' + (t?'タスクあり':'自分の記録') +
      '</span></div><span class="card-reason">' + h(ago(n.created)) + 'に残した</span>' +
      '<h3 class="card-title text clamp6">' + h(n.body) + '</h3>' +
      (latest?'<p class="card-desc clamp3">追記：'+h(latest.text)+'</p>':'') +
      (t ? '<p class="ql-task-subtitle">' + h(taskTitle(n)) + (dueText(n)?' · '+h(dueText(n)):'')+'</p>':'') +
      '<div class="card-actions">' +
      (t?'<button class="btn primary" type="button" data-thought-action="task-toggle">' +
      (t.status==='done'?'再開':'タスク完了')+'</button><button class="btn" type="button" data-thought-action="task-edit">期限・通知</button>' :
      '<button class="btn primary" type="button" data-thought-action="taskify">＋ やることにする</button>') +
      '<button class="btn quiet" type="button" data-thought-action="later">あとで</button>' +
      '<button class="btn quiet" type="button" data-thought-action="append">追記</button></div></article>';
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
      if (action === 'taskify') taskify(id);
      if (action === 'task-toggle') toggleTask(id);
      if (action === 'task-edit') openTaskEditor(id);
      if (action === 'later') update(id, n => ({...n,snooze:new Date(Date.now()+14*86400000).toISOString()}));
      if (action === 'append') openEditor(id,true);
    } else setPosition(Number(card.dataset.index));
    return true;
  }

  function thoughtItemHtml(n) {
    const latest=Array.isArray(n.history)?n.history[n.history.length-1]:null;
    const t=task(n);
    return '<article class="item ql-thought-item" data-thought-id="' + h(n.id) + '">' +
      '<button type="button" class="item-main ql-thought-open" data-thought-action="edit">' +
      '<span class="item-meta"><span class="src">思ったこと</span><span>' + h(ago(n.created)) +
      '</span>' + (n.done?'<span>見返し終了</span>':'') + '</span>' +
      '<span class="item-title clamp2">' + h(n.body) + '</span>' +
      (latest?'<span class="item-desc clamp3">追記：'+h(latest.text)+'</span>':'') +
      '</button>' +
      (t?'<div class="ql-task-line"><button type="button" class="ql-task-check" data-thought-action="task-toggle" aria-label="' +
      (t.status==='done'?'タスクを再開':'タスクを完了')+'">' + (t.status==='done'?'☑':'□') +
      '</button><span class="' + (t.status==='done'?'ql-task-done':'') + '">' + h(taskTitle(n)) + '</span>' +
      (dueText(n)?'<span class="ql-task-date">'+h(dueText(n))+'</span>':'') +
      (reminderDue(n)?'<span class="ql-task-alert">リマインド</span>':'') + '</div>':'') +
      '<div class="item-foot ql-thought-foot"><span class="by">' + h(dateLabel(n.created)) + '</span>' +
      (t?'<button class="btn quiet" type="button" data-thought-action="task-edit">期限・通知</button>':
      '<button class="btn quiet" type="button" data-thought-action="taskify">＋ やることにする</button>') +
      '<button class="btn quiet" type="button" data-thought-action="append">追記</button>' +
      (!t?'<button class="btn quiet" type="button" data-thought-action="toggle">' +
      (n.done?'再表示':'見返し終了')+'</button>':'') +
      '<button class="btn quiet" type="button" data-thought-action="delete" aria-label="削除">削除</button>' +
      '</div></article>';
  }

function renderLibrary({U,state,itemHtml}) {
    const root = byId('lib'), head = byId('libHead');
    renderNow();
    if (!root || !head) return;
    const normal = U.view === 'links' && U.drawer === 'ALL' && U.kind === 'all' && !U.query.trim();
    const toolbar = byId('ql-list-toggle');
    if (toolbar) toolbar.hidden = !normal;
    if (U.query.trim()) {
      const query = U.query.trim().toLocaleLowerCase();
      if (/^https?:\/\//i.test(query)) return;
      const matches = notes.filter(n => (n.body+' '+taskTitle(n)+' '+(n.history||[]).map(x=>x.text).join(' ')).toLocaleLowerCase().includes(query));
      if (!matches.length) return;
      root.querySelector('.empty')?.remove();
      const count = parseInt(byId('libCount').textContent,10) || 0;
      byId('libCount').textContent = (count + matches.length) + '件';
      const block = document.createElement('div');
      block.innerHTML = `<div class="group-head">思ったこと <span class="n">${matches.length}件</span></div>
        <div class="grid">${matches.map(thoughtItemHtml).join('')}</div>`;
      root.append(block);return;
    }
    if (!normal) return;
    const links = state.items.filter(x => !x.archived);
    const includeLinks = listMode === 'all' || listMode === 'links', includeThoughts = listMode === 'all' || listMode === 'thoughts';
    if (listMode === 'links') {
      byId('libTitle').textContent = 'リンク';
      byId('libCount').textContent = links.length + '件';
      return;
    }
    const records = [
      ...(includeLinks ? links.map(item => ({kind:'link',date:stamp(item.addedAt),item})) : []),
      ...(includeThoughts ? notes.map(item => ({kind:'thought',date:stamp(item.created),item})) : []),
      ...(listMode === 'tasks' ? notes.filter(task).map(item => ({kind:'thought',date:stamp(item.created),item})) : [])
    ];
    let sort = state.linkSort;
    if (!['recent','oldest','title'].includes(sort)) sort='recent';
    records.sort((a,b) => listMode === 'tasks' ? taskSort(a.item,b.item) : sort === 'title'
      ? String(a.kind==='link' ? a.item.title||'' : a.item.body||'').localeCompare(String(b.kind==='link' ? b.item.title||'' : b.item.body||''),'ja')
      : sort === 'oldest' ? a.date-b.date : b.date-a.date);
    byId('libTitle').textContent = listMode === 'tasks' ? 'やること' : listMode === 'thoughts' ? '思ったこと' : 'ぜんぶ';
    byId('libCount').textContent = records.length + '件';
    const select = byId('sortSelect');
    select.hidden = listMode === 'tasks';
    select.innerHTML = [['recent','新しい順'],['oldest','古い順'],['title','名前順']]
      .map(([v,t])=>`<option value="${v}"${v===sort?' selected':''}>${t}</option>`).join('');
    if (!records.length) {root.innerHTML='<div class="empty"><b>まだありません</b>上の保存ボタンから追加できます。</div>';return}
    if (listMode === 'tasks') {
      root.innerHTML='<div class="grid ql-task-list">'+records.map(e=>thoughtItemHtml(e.item)).join('')+'</div>';
      return;
    }
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

  function renderMobileSearch(query) {
    const root = byId('mResults');
    if (!root || !query || /^https?:/i.test(query)) return;
    const needle = query.trim().toLocaleLowerCase();
    const matches = notes.filter(n => (n.body+' '+taskTitle(n)+' '+(n.history||[]).map(x=>x.text).join(' ')).toLocaleLowerCase().includes(needle));
    if (!matches.length) return;
    root.querySelector('.empty')?.remove();
    const group = document.createElement('div');
    group.innerHTML = `<div class="group-head">思ったこと <span class="n">${matches.length}件</span></div>
      <div class="grid">${matches.map(thoughtItemHtml).join('')}</div>`;
    root.append(group);
  }

  function renderTagEditor() {
    const selected=byId('ql-tag-selected'), options=byId('ql-tag-options'), input=byId('ql-tag-input');
    if (!selected || !options || !input) return;
    selected.innerHTML=editTags.map(t=>'<button class="ql-tag-selected" type="button" data-remove-tag="'+h(t)+'" aria-label="'+h(t)+'を外す">#'+h(t)+' <span aria-hidden="true">×</span></button>').join('');
    const q=tagKey(input.value), all=availableTags();
    const choices=all.filter(x=>!editTags.some(t=>tagKey(t)===tagKey(x.tag)) && (!q || tagKey(x.tag).includes(q))).slice(0,8);
    const candidate=cleanTag(input.value);
    const canCreate=!!candidate && !editTags.some(t=>tagKey(t)===tagKey(candidate)) && !all.some(x=>tagKey(x.tag)===tagKey(candidate));
    options.innerHTML=choices.map(x=>'<button type="button" data-add-tag="'+h(x.tag)+'">#'+h(x.tag)+'</button>').join('')+
      (canCreate&&editTags.length<8?'<button type="button" data-add-new>＋「'+h(candidate)+'」を作成</button>':'')+
      (!choices.length&&!canCreate?'<span class="ql-tag-empty">候補がありません</span>':'');
    options.hidden=!showTagOptions || editTags.length>=8;
    input.disabled=editTags.length>=8;
    input.setAttribute('aria-expanded',String(!options.hidden));
    byId('ql-tag-count').textContent=editTags.length+'/8';
  }
  function addEditorTag(value) {
    const tag=cleanTag(value);
    if (!tag || editTags.length>=8 || editTags.some(t=>tagKey(t)===tagKey(tag))) return;
    editTags=normalizeTags([...editTags,tag]);
    byId('ql-tag-input').value='';
    showTagOptions=false;
    renderTagEditor();
  }
  function applyTagFilter(value) {
    selectedTag=value||'';
    listMode='thoughts';
    if (typeof U !== 'undefined') {U.view='links';U.drawer='ALL';U.kind='all';U.query='';U.active=-1}
    const search=byId('searchInput');if(search) search.value='';
    const sheet=byId('searchSheet');if(sheet?.open) sheet.close();
    byId('ql-list-toggle')?.querySelectorAll('[data-ql-list]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.qlList==='thoughts')));
    refresh();
    byId('libHead')?.scrollIntoView({block:'start',behavior:'smooth'});
  }
  function openEditor(id=null,append=false) {
    editId=id;appending=append;
    const n=findNote(id);
    editTags=thoughtTags(n);showTagOptions=false;
    byId('ql-tag-input').value='';
    byId('ql-tag-edit').hidden=append;
    renderTagEditor();
    byId('ql-thought-title').textContent=append?'追記する':id?'思ったことを編集':'思ったことを残す';
    byId('ql-thought-input').value=append?'':n?.body||'';
    byId('ql-thought-input').placeholder=append?'その後、どう思った？':'未来の自分に残したいこと';
    byId('ql-thought-task-wrap').hidden=append||!!task(n);
    byId('ql-thought-task-flag').checked=false;
    byId('ql-thought-dialog').showModal();
    byId('ql-thought-input').focus();
  }
  function saveEditor() {
    const value=byId('ql-thought-input').value.trim();
    if (!value) return;
    const makeTask=!appending && byId('ql-thought-task-flag').checked;
    if (editId && findNote(editId)) {
      notes=notes.map(n=>n.id!==editId?n:appending
        ? {...n,history:[...(n.history||[]),{text:value,created:new Date().toISOString()}],updated:new Date().toISOString()}
        : {...n,body:value,tags:normalizeTags(editTags),task:makeTask && !n.task ? {title:value.split('\n').find(Boolean).slice(0,100),status:'open',dueOn:null,remindAt:null,completedAt:null} : n.task,updated:new Date().toISOString()});
    } else notes.push({id:'thought-'+Date.now()+'-'+Math.random().toString(36).slice(2),
      body:value,tags:normalizeTags(editTags),created:new Date().toISOString(),history:[],done:false,
      ...(makeTask ? {task:{title:value.split('\n').find(Boolean).slice(0,100),status:'open',dueOn:null,remindAt:null,completedAt:null}} : {})});
    persistNotes();byId('ql-thought-dialog').close();refresh();
  }
  function onListClick(e) {
    const target=e.target.closest('[data-thought-id]');
    if (!target)return;
    e.stopPropagation();
    const id=target.dataset.thoughtId;
    const action=e.target.closest('[data-thought-action]')?.dataset.thoughtAction||'edit';
    if(action==='edit')openEditor(id);
    else if(action==='taskify')taskify(id);
    else if(action==='task-toggle')toggleTask(id);
    else if(action==='task-edit')openTaskEditor(id);
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
    nowSection=document.createElement('section');nowSection.id='ql-now';nowSection.className='ql-now';
    nowSection.setAttribute('aria-label','今、気にすること');nowSection.hidden=true;entry.after(nowSection);
    nowSection.addEventListener('click',e=>{
      if(e.target.closest('[data-ql-show-tasks]')){listMode='tasks';renderListButtons();refresh();byId('libHead')?.scrollIntoView({block:'start',behavior:'smooth'});return}
      onListClick(e);
    });
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
    listToggle.innerHTML='<button type="button" data-ql-list="all">すべて</button><button type="button" data-ql-list="links">リンク</button><button type="button" data-ql-list="thoughts">思ったこと</button><button type="button" data-ql-list="tasks">やること</button>';
    byId('sortSelect').before(listToggle);
    listToggle.addEventListener('click',e=>{
      const button=e.target.closest('[data-ql-list]');if(!button)return;
      listMode=button.dataset.qlList;renderListButtons();refresh();
    });
    byId('lib').addEventListener('click',onListClick);
    byId('mResults').addEventListener('click',onListClick);
    function renderListButtons() {
      listToggle.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.qlList===listMode)));
    }
    renderListButtons();

    const dialog=document.createElement('dialog');
    dialog.id='ql-thought-dialog';dialog.className='ql-thought-dialog';
    dialog.innerHTML='<form method="dialog" class="ql-thought-form"><h2 id="ql-thought-title">思ったことを残す</h2><textarea id="ql-thought-input" rows="5" required placeholder="未来の自分に残したいこと"></textarea>' +
      '<div id="ql-tag-edit" class="ql-tag-edit"><div class="ql-tag-heading"><label for="ql-tag-input">タグ <small>任意・引き出しとは別</small></label><span id="ql-tag-count">0/8</span></div>' +
      '<div id="ql-tag-selected" class="ql-tag-selected-list"></div>' +
      '<div class="ql-tag-search"><input id="ql-tag-input" type="text" maxlength="24" autocomplete="off" placeholder="タグを探す・新しく作る" aria-controls="ql-tag-options" aria-expanded="false"><button type="button" class="btn quiet" id="ql-tag-add">追加</button></div>' +
      '<div id="ql-tag-options" class="ql-tag-options" hidden></div></div>' +
      '<label class="ql-task-capture" id="ql-thought-task-wrap"><input type="checkbox" id="ql-thought-task-flag"> やることにする <small>期限はあとから設定</small></label><div class="ql-form-actions"><button type="button" class="btn" id="ql-cancel">やめる</button><button type="button" class="btn primary" id="ql-save">保存</button></div></form>';
    document.body.append(dialog);
    byId('ql-tag-input').addEventListener('focus',()=>{showTagOptions=true;renderTagEditor()});
    byId('ql-tag-input').addEventListener('input',()=>{showTagOptions=true;renderTagEditor()});
    byId('ql-tag-input').addEventListener('keydown',e=>{
      if(e.isComposing||e.keyCode===229) return;
      if(e.key==='Enter'||e.key===','){e.preventDefault();addEditorTag(e.target.value)}
      if(e.key==='Escape'){e.stopPropagation();showTagOptions=false;renderTagEditor()}
    });
    byId('ql-tag-add').onclick=()=>addEditorTag(byId('ql-tag-input').value);
    byId('ql-tag-selected').addEventListener('click',e=>{
      const b=e.target.closest('[data-remove-tag]');if(!b)return;
      editTags=editTags.filter(t=>tagKey(t)!==tagKey(b.dataset.removeTag));renderTagEditor();
    });
    byId('ql-tag-options').addEventListener('click',e=>{
      const b=e.target.closest('[data-add-tag],[data-add-new]');if(!b)return;
      addEditorTag(b.hasAttribute('data-add-new')?byId('ql-tag-input').value:b.dataset.addTag);
    });
    byId('ql-cancel').onclick=()=>dialog.close();
    byId('ql-save').onclick=saveEditor;
    const taskDialog=document.createElement('dialog');
    taskDialog.id='ql-task-dialog';taskDialog.className='ql-thought-dialog ql-task-dialog';
    taskDialog.innerHTML='<form method="dialog" class="ql-thought-form">' +
      '<h2>やることを調整</h2><label>やることの名前<input class="ql-task-field" id="ql-task-title" required maxlength="250"></label>' +
      '<label>締切（任意）<input class="ql-task-field" id="ql-task-due" type="date"></label>' +
      '<label>アプリ内リマインド（任意）<input class="ql-task-field" id="ql-task-remind" type="datetime-local"></label>' +
      '<p class="ql-task-hint">指定日時を過ぎたら、アプリを開いたときに表示します。端末へのプッシュ通知ではありません。</p>' +
      '<div class="ql-form-actions"><button type="button" class="btn quiet" id="ql-task-remove">やることを外す</button><button type="button" class="btn" id="ql-task-cancel">やめる</button>' +
      '<button type="button" class="btn primary" id="ql-task-save">保存</button></div></form>';
    document.body.append(taskDialog);
    byId('ql-task-cancel').onclick=()=>taskDialog.close();
    byId('ql-task-remove').onclick=removeTask;
    byId('ql-task-save').onclick=saveTaskEditor;
    byId('ql-task-title').addEventListener('keydown',e=>{
      if(e.key==='Enter'){e.preventDefault();saveTaskEditor()}
    });
    byId('ql-thought-input').addEventListener('keydown',e=>{
      if ((e.ctrlKey||e.metaKey)&&e.key==='Enter') {e.preventDefault();saveEditor()}
    });
    // Keep visibility synchronous with renderDeck: an observer would shift mobile scroll after restoration.
    const syncVisibility=()=>{
      entry.hidden=deck.hidden;
      filter.hidden=deck.hidden;
      renderNow();
    };
    window.QLThoughts.syncVisibility=syncVisibility;
    syncVisibility();
    window.addEventListener('storage',e=>{
      if(e.key===NOTE_KEY){const updated=read(NOTE_KEY,[]);notes=Array.isArray(updated)?updated:[];dirty=true;refresh()}
    });
    window.addEventListener('quicklinks:thoughts-apply',e=>{
      if(!Array.isArray(e.detail?.notes))return;
      notes=e.detail.notes.map(n=>({...n}));saveLocal(NOTE_KEY,notes);dirty=true;refresh();
    });
    window.addEventListener('focus',renderNow);
    setInterval(()=>{if(!document.hidden)renderNow()},60000);
    refresh();
  }

  window.QLThoughts={isMixed,renderMixedDeck,renderLibrary,markCurrent,setPos,
    currentPos:()=>position,handleDeckCard,renderMobileSearch,
    exportNotes:()=>notes.map(n=>({...n})),importNotes};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
  else init();
})();
