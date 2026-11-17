'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const thoughtCode = fs.readFileSync(path.join(root, 'thoughts.js'), 'utf8');
const syncCode = fs.readFileSync(path.join(root, 'sync.js'), 'utf8');

function makeHarness(initialNotes = []) {
  const marker = '  window.QLThoughts={isMixed';
  assert.ok(thoughtCode.includes(marker), 'test hook insertion point must exist');
  const source = thoughtCode.replace(marker,
    '  window.__thoughtTest={openEditor,saveEditor,addEditorTag,applyTagFilter,taskify,normalizeTags};\n' + marker);
  const nodes = {}, listeners = {};
  function element(id = '') {
    return {
      id, value: '', textContent: '', innerHTML: '', hidden: false, open: false,
      checked: false, selectedIndex: 0, options: [{textContent:'リンク＋思ったこと'}],
      dataset: {}, classList: {add(){},remove(){}},
      setAttribute(){}, getAttribute(){return null}, focus(){}, before(){}, after(){},
      showModal(){this.open = true}, close(){this.open = false},
      replaceChildren(){this.innerHTML = ''}, scrollIntoView(){},
      append(child){this.innerHTML += child.innerHTML || ''},
      addEventListener(type, fn){this.listeners ||= {}; this.listeners[type] = fn},
      querySelector(selector){return id === 'deck' && selector === '.deck-head' ? nodes.head : null},
      querySelectorAll(){return []},
      parentNode: {insertBefore(){}}
    };
  }
  const ids = [
    'deck','head','sortSelect','libHead','lib','libTitle','libCount','mResults',
    'searchInput','searchSheet','ql-add-link','ql-add-thought','ql-list-toggle',
    'ql-filter-summary','ql-ratio-label','ql-ratio-value','ql-discovery-mode',
    'ql-discovery-period','ql-ratio','ql-thought-title','ql-tag-input',
    'ql-tag-edit','ql-tag-selected','ql-tag-options','ql-tag-count',
    'ql-thought-input','ql-thought-task-wrap','ql-thought-task-flag',
    'ql-tag-picker','ql-tag-toggle','ql-tag-add','ql-cancel','ql-save',
    'ql-task-title','ql-task-due','ql-task-remind','ql-task-cancel',
    'ql-task-remove','ql-task-save'
  ];
  ids.forEach(id => {nodes[id] = element(id)});
  const document = {
    readyState: 'loading',
    getElementById(id){return nodes[id] || null},
    createElement(){return element()},
    addEventListener(type, fn){listeners[type] = fn},
    body: {append(node){nodes[node.id] = node}}
  };
  const storage = new Map([['quicklinks-thoughts-v1', JSON.stringify(initialNotes)]]);
  const localStorage = {
    getItem(key){return storage.has(key) ? storage.get(key) : null},
    setItem(key, value){storage.set(key, value)}
  };
  const window = {dispatchEvent(){}, addEventListener(){}};
  const U = {view:'links',drawer:'ALL',kind:'all',query:'',active:-1};
  vm.runInNewContext(source, {
    window, document, localStorage, U, render(){}, setInterval(){}, CustomEvent: function(){}
  }, {filename:'thoughts.js',timeout:2000});
  assert.equal(typeof listeners.DOMContentLoaded, 'function');
  listeners.DOMContentLoaded();
  return {nodes, U, storage, test:window.__thoughtTest, api:window.QLThoughts};
}

function triggerKey(node, key, extra = {}) {
  const event = {
    key, target:node, isComposing:false, keyCode:0, ctrlKey:false, metaKey:false,
    prevented:false, stopped:false,
    preventDefault(){this.prevented = true},
    stopPropagation(){this.stopped = true},
    ...extra
  };
  node.listeners.keydown(event);
  return event;
}

function asArray(value){return Array.from(value)}

test('No-tag capture remains one-step and saves an empty tag set', () => {
  const h=makeHarness();
  h.test.openEditor();
  assert.equal(h.nodes['ql-tag-picker'].hidden, true);
  h.nodes['ql-thought-input'].value = '短いメモ';
  h.test.saveEditor();
  assert.deepEqual(asArray(h.api.exportNotes()[0].tags), []);
});

test('Tags can be added with Japanese IME-safe Enter and preserve normalized names', () => {
  const h=makeHarness();
  h.test.openEditor();
  h.nodes['ql-tag-toggle'].onclick();
  assert.equal(h.nodes['ql-tag-picker'].hidden, false);
  h.nodes['ql-tag-input'].value = ' ＃スライド';
  const composing = triggerKey(h.nodes['ql-tag-input'],'Enter',{isComposing:true,keyCode:229});
  assert.equal(composing.prevented, false);
  assert.equal(h.nodes['ql-tag-input'].value, ' ＃スライド');
  triggerKey(h.nodes['ql-tag-input'],'Enter');
  h.nodes['ql-thought-input'].value='スライドは構造から';
  h.test.saveEditor();
  assert.deepEqual(asArray(h.api.exportNotes()[0].tags), ['スライド']);
});

test('Escape dismisses tag picker, not the thought dialog', () => {
  const h=makeHarness();
  h.test.openEditor();
  h.nodes['ql-tag-toggle'].onclick();
  h.nodes['ql-tag-input'].value='未確定';
  const result=triggerKey(h.nodes['ql-tag-input'],'Escape');
  assert.equal(result.prevented, true);
  assert.equal(h.nodes['ql-tag-picker'].hidden, true);
  assert.equal(h.nodes['ql-thought-dialog'].open, true);
  h.nodes['ql-thought-input'].value='本文';
  h.test.saveEditor();
  assert.deepEqual(asArray(h.api.exportNotes()[0].tags), []);
});

test('Ctrl+Enter never saves during Japanese composition', () => {
  const h=makeHarness();
  h.test.openEditor();
  h.nodes['ql-thought-input'].value='変換中の文章';
  triggerKey(h.nodes['ql-thought-input'],'Enter',{ctrlKey:true,isComposing:true,keyCode:229});
  assert.equal(h.api.exportNotes().length,0);
  triggerKey(h.nodes['ql-thought-input'],'Enter',{ctrlKey:true});
  assert.equal(h.api.exportNotes().length,1);
});

test('Later editing, append and task conversion retain tags', () => {
  const h=makeHarness();
  h.test.openEditor();
  h.nodes['ql-thought-input'].value='最初のメモ';
  h.test.addEditorTag('仕事');
  h.test.saveEditor();
  const id=h.api.exportNotes()[0].id;
  h.test.openEditor(id);
  h.test.addEditorTag('スライド');
  h.nodes['ql-thought-input'].value='改訂版';
  h.test.saveEditor();
  h.test.openEditor(id,true);
  h.nodes['ql-thought-input'].value='追加の考え';
  h.test.saveEditor();
  h.test.taskify(id);
  const record=h.api.exportNotes()[0];
  assert.deepEqual(asArray(record.tags),['仕事','スライド']);
  assert.equal(record.history.length,1);
  assert.equal(record.body,'改訂版');
  assert.equal(record.task.status,'open');
});

test('Tag search and filter do not hide legacy untagged notes from normal search', () => {
  const now='2026-11-17T00:00:00Z';
  const h=makeHarness([
    {id:'a',body:'仕事の相談',tags:['仕事'],created:now,history:[],done:false},
    {id:'b',body:'昔のメモ',created:now,history:[],done:false}
  ]);
  h.api.renderMobileSearch('#仕事');
  assert.match(h.nodes.mResults.innerHTML,/仕事の相談/);
  assert.doesNotMatch(h.nodes.mResults.innerHTML,/昔のメモ/);
  h.nodes.mResults.innerHTML='';
  h.api.renderMobileSearch('昔のメモ');
  assert.match(h.nodes.mResults.innerHTML,/昔のメモ/);
  h.test.applyTagFilter('仕事');
  h.api.renderLibrary({U:h.U,state:{items:[],linkSort:'recent'},itemHtml(){return ''}});
  assert.match(h.nodes.lib.innerHTML,/仕事の相談/);
  assert.doesNotMatch(h.nodes.lib.innerHTML,/昔のメモ/);
  h.test.applyTagFilter('');
  h.api.renderLibrary({U:h.U,state:{items:[],linkSort:'recent'},itemHtml(){return ''}});
  assert.match(h.nodes.lib.innerHTML,/昔のメモ/);
});

test('Tags normalize fullwidth hash and spaces and are limited to eight', () => {
  const h=makeHarness();
  const normalized=h.test.normalizeTags([' ＃仕事 ','仕事','#スライド','スライド']);
  assert.deepEqual(asArray(normalized),['仕事','スライド']);
  const capped=h.test.normalizeTags(['1','2','3','4','5','6','7','8','9']);
  assert.equal(capped.length,8);
});

function syncHelpers() {
  function extract(start,end) {
    const a=syncCode.indexOf(start);
    const b=syncCode.indexOf(end,a+start.length);
    assert.ok(a>=0 && b>a,'sync source anchors exist: ' + start);
    return syncCode.slice(a,b);
  }
  const script =
    extract('  function normalizeThoughtTags(values) {','  function thoughtItem(x) {') +
    extract('  function mergeField(base, local, remote, path, conflicts) {','  function canonicalUrl(v) {') +
    extract('  function mergeRecord(kind, base, local, remote, conflicts) {','  function mergeCollection(kind, base, local, remote, tomb, conflicts) {') +
    '\nreturn {normalizeThoughtTags,mergeRecord,mergeSets};';
  const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const same = (a,b) => JSON.stringify(a)===JSON.stringify(b);
  const uniq = arr => [...new Set(arr)];
  const earlier = (a,b) => a || b || null;
  const later = (a,b) => b || a || null;
  return new Function('clone','same','uniq','earlier','later',script)(clone,same,uniq,earlier,later);
}

test('Sync three-way merge preserves independent tag additions and removals', () => {
  const {mergeRecord}=syncHelpers();
  const base={id:'a',body:'メモ',tags:['仕事'],history:[]};
  const local={...base,tags:['仕事','学び']};
  const remote={...base,tags:['仕事','スライド']};
  const merged=mergeRecord('thoughts',base,local,remote,[]);
  assert.deepEqual(asArray(merged.tags),['仕事','学び','スライド']);
});

test('Missing tags from legacy sync clients are not treated as deletion', () => {
  const {mergeRecord}=syncHelpers();
  const base={id:'a',body:'メモ',tags:['仕事'],history:[]};
  const local={...base};
  const remote={id:'a',body:'メモ',history:[]};
  assert.deepEqual(asArray(mergeRecord('thoughts',base,local,remote,[]).tags),['仕事']);
  const cleared={...base,tags:[]};
  assert.deepEqual(asArray(mergeRecord('thoughts',base,local,cleared,[]).tags),[]);
});

test('Cache-busted assets are referenced from index.html', () => {
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  assert.match(html,/thoughts[.]js[?]v=/);
  assert.match(html,/thoughts[.]css[?]v=/);
  assert.match(html,/sync[.]js[?]v=/);
});
