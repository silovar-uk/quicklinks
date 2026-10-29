/* Quick Links: independent thoughts capture + shared discovery. */
(() => {
'use strict';
const KEY='quicklinks-thoughts-v1', SETTINGS='quicklinks-discovery-v1';
const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback}catch{return fallback}};
let notes=read(KEY,[]), settings=read(SETTINGS,{mode:'mixed',ratio:30,period:'all'}), queue=[],position=0,editId=null;
const $=id=>document.getElementById(id);
const el=(tag,attrs={},txt)=>{const n=document.createElement(tag);for(const [k,v] of Object.entries(attrs)){if(k==='class')n.className=v;else n.setAttribute(k,v)}if(txt!==undefined)n.textContent=txt;return n};
const persist=()=>{localStorage.setItem(KEY,JSON.stringify(notes));window.dispatchEvent(new Event('quicklinks:thoughts-updated'))};
const days=t=>Math.floor((Date.now()-new Date(t).getTime())/86400000);
function candidates(){
 const links=(typeof state!=='undefined'&&Array.isArray(state.items)?state.items:[]).filter(x=>x.url).map(x=>({type:'link',id:x.id,title:x.title||x.url,url:x.url,created:x.createdAt||x.addedAt||x.created_at||null}));
 const thoughts=notes.filter(x=>!x.done&&(!x.snooze||Date.parse(x.snooze)<Date.now())).map(x=>({type:'thought',...x}));
 const within=x=>{if(settings.period==='all')return true;const d=days(x.created);if(!Number.isFinite(d))return false;return settings.period==='month'?d>=23&&d<=37:settings.period==='quarter'?d>=76&&d<=104:d>=335&&d<=395};
 return {links:links.filter(within),thoughts:thoughts.filter(within)};
}
const shuffle=a=>{a=[...a];for(let i=a.length-1;i>0;i--){let j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a};
function rebuild(){
 const {links,thoughts}=candidates(),m=settings.mode;
 if(m==='links')queue=shuffle(links);
 else if(m==='thoughts')queue=shuffle(thoughts);
 else{
  let a=shuffle(links),b=shuffle(thoughts),ratio=Number(settings.ratio);
  queue=[];
  while(a.length||b.length){
   const batch=[];let n=Math.min(10,a.length+b.length),target=Math.round(n*ratio/100);
   let nb=Math.min(target,b.length),na=Math.min(n-nb,a.length);
   nb=Math.min(n-na,b.length);
   batch.push(...a.splice(0,na),...b.splice(0,nb));queue.push(...shuffle(batch));
  }
 }
 position=0;renderCard();
}
function renderCard(){
 const box=$('ql-discovery-card');if(!box)return;box.replaceChildren();
 const item=queue[position];
 if(!item){box.append(el('p',{class:'ql-empty'},'この条件の記録はまだありません。期間や種類を変えてみてください。'));return}
 const head=el('div',{class:'ql-card-head'});head.append(el('span',{},item.type==='link'?'リンク':'思ったこと'),el('small',{},item.created?days(item.created)+'日前':'保存済み'));box.append(head);
 const title=el('div',{class:'ql-card-title'},item.title||item.body||'（無題）');box.append(title);
 if(item.type==='link'){const a=el('a',{href:item.url,target:'_blank',rel:'noopener noreferrer',class:'ql-open'},'リンクを開く ↗');box.append(a)}
 else{
  if(item.history?.length)box.append(el('p',{class:'ql-card-sub'},item.history[item.history.length-1].text));
  const actions=el('div',{class:'ql-card-actions'});
  const act=(label,fn)=>{const b=el('button',{type:'button',class:'btn'},label);b.addEventListener('click',fn);actions.append(b)};
  act('完了',()=>{update(item.id,x=>({...x,done:true}));rebuild()});
  act('あとで',()=>{update(item.id,x=>({...x,snooze:new Date(Date.now()+14*86400000).toISOString()}));rebuild()});
  act('追記',()=>openEditor(item.id,true));box.append(actions);
 }
 $('ql-discovery-prev').disabled=position===0;
 $('ql-discovery-next').disabled=position>=queue.length-1;
 $('ql-discovery-count').textContent=queue.length?(position+1)+' / '+queue.length:'0';
}
function update(id,fn){notes=notes.map(x=>x.id===id?fn(x):x);persist();renderList()}
function openEditor(id=null,append=false){
 editId=id;const n=notes.find(x=>x.id===id);$('ql-thought-title').textContent=append?'追記する':id?'思ったことを編集':'思ったことを残す';
 $('ql-thought-input').value=append?'':n?.body||'';$('ql-thought-input').placeholder=append?'新しく気づいたことを追記':'未来の自分に残したいこと';
 $('ql-thought-dialog').showModal();$('ql-thought-input').focus();$('ql-thought-dialog').dataset.append=String(append);
}
function renderList(){
 const list=$('ql-thought-list');list.replaceChildren();
 for(const n of [...notes].reverse()){
  const item=el('div',{class:'ql-list-item'}),text=el('div',{},n.body),meta=el('small',{},(n.done?'完了 · ':'')+new Date(n.created).toLocaleDateString('ja-JP'));
  const actions=el('div',{class:'ql-list-actions'});
  const edit=el('button',{type:'button',class:'btn'},'編集'),del=el('button',{type:'button',class:'btn'},'削除');
  edit.onclick=()=>openEditor(n.id);del.onclick=()=>{if(confirm('この記録を削除しますか？')){notes=notes.filter(x=>x.id!==n.id);persist();renderList();rebuild()}};
  actions.append(edit,del);item.append(text,meta,actions);list.append(item);
 }
 if(!notes.length)list.append(el('p',{},'まだ記録はありません。'));
}
function init(){
 const deck=$('deck'),head=deck?.querySelector('.deck-head');if(!deck||!head)return;
 const launch=el('div',{class:'ql-save-entry'});
 const linkBtn=el('button',{type:'button',class:'btn'},'＋ リンクを保存'),thoughtBtn=el('button',{type:'button',class:'btn primary'},'＋ 思ったことを残す');
 linkBtn.onclick=()=>{const b=$('addButton');b?.click()};thoughtBtn.onclick=()=>openEditor();launch.append(linkBtn,thoughtBtn);deck.parentNode.insertBefore(launch,deck);
 const tools=el('div',{class:'ql-discovery-tools'});
 tools.innerHTML='<label>表示対象 <select id="ql-discovery-mode"><option value="mixed">リンク＋思ったこと</option><option value="links">リンクだけ</option><option value="thoughts">思ったことだけ</option></select></label><label>時期 <select id="ql-discovery-period"><option value="all">すべて</option><option value="month">1か月前</option><option value="quarter">3か月前</option><option value="year">1年前</option></select></label><label id="ql-ratio-label">思ったこと <output id="ql-ratio-value">30%</output><input type="range" min="0" max="100" step="10" id="ql-ratio"></label>';
 const wrap=el('div',{class:'ql-discovery'}),card=el('div',{id:'ql-discovery-card',class:'ql-discovery-card'}),nav=el('div',{class:'ql-discovery-nav'});
 const prev=el('button',{id:'ql-discovery-prev',type:'button',class:'btn'},'← 戻す'),count=el('span',{id:'ql-discovery-count'}),next=el('button',{id:'ql-discovery-next',type:'button',class:'btn'},'次へ →');
 prev.onclick=()=>{position=Math.max(0,position-1);renderCard()};next.onclick=()=>{position=Math.min(queue.length-1,position+1);renderCard()};
 nav.append(prev,count,next);wrap.append(tools,card,nav);
 const disclosure=el('details',{class:'ql-discovery-disclosure'});
 const summary=el('summary',{},'思ったことも一緒にめくる · 表示バランスを調整');
 disclosure.append(summary,wrap);
 deck.after(disclosure);
 const listPanel=el('section',{class:'ql-thoughts-panel'});listPanel.innerHTML='<div class="ql-list-head"><h2>思ったこと</h2><button type="button" class="btn" id="ql-new-thought">＋ 残す</button></div><div id="ql-thought-list"></div>';
 deck.after(listPanel);$('ql-new-thought').onclick=()=>openEditor();
 const dialog=el('dialog',{id:'ql-thought-dialog',class:'ql-thought-dialog'});
 dialog.innerHTML='<form method="dialog" class="ql-thought-form"><h2 id="ql-thought-title">思ったことを残す</h2><textarea id="ql-thought-input" rows="5" required placeholder="未来の自分に残したいこと"></textarea><div class="ql-form-actions"><button type="button" class="btn" id="ql-cancel">やめる</button><button type="button" class="btn primary" id="ql-save">保存</button></div></form>';
 document.body.append(dialog);$('ql-cancel').onclick=()=>dialog.close();
 $('ql-save').onclick=()=>{
  const value=$('ql-thought-input').value.trim();if(!value)return;
  if(editId){update(editId,x=>dialog.dataset.append==='true'?{...x,history:[...(x.history||[]),{text:value,created:new Date().toISOString()}]}:{...x,body:value,updated:new Date().toISOString()})}
  else{notes.push({id:'thought-'+Date.now()+'-'+Math.random().toString(36).slice(2),body:value,created:new Date().toISOString(),history:[],done:false});persist()}
  dialog.close();renderList();rebuild();
 };
 const mode=$('ql-discovery-mode'),period=$('ql-discovery-period'),ratio=$('ql-ratio');
 mode.value=settings.mode;period.value=settings.period;ratio.value=settings.ratio;
 const changed=()=>{settings={mode:mode.value,period:period.value,ratio:Number(ratio.value)};localStorage.setItem(SETTINGS,JSON.stringify(settings));$('ql-ratio-value').textContent=settings.ratio+'%';$('ql-ratio-label').hidden=settings.mode!=='mixed';rebuild()};
 mode.onchange=changed;period.onchange=changed;ratio.oninput=changed;
 changed();renderList();
 const observer=new MutationObserver(()=>{const visible=!deck.hidden;launch.hidden=!visible;listPanel.hidden=!visible});
 observer.observe(deck,{attributes:true,attributeFilter:['hidden']});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();