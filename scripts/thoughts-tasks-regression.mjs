import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';

const URL = process.env.LOCAL_URL || 'http://127.0.0.1:4173/';
const NOTES = 'quicklinks-thoughts-v1';

async function run(name, engine) {
  const browser = await engine.launch({headless:true});
  const context = await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(URL, {waitUntil:'domcontentloaded'});
    await page.evaluate(() => {
      localStorage.removeItem('quicklinks-thoughts-v1');
      localStorage.removeItem('quick-links-mobile-localstorage-v1');
      localStorage.removeItem('quick-links-sync-v1');
    });
    await page.reload({waitUntil:'domcontentloaded'});
    await page.locator('#ql-add-thought').click();
    await page.locator('#ql-thought-input').fill('イベント運営のマニュアルを作りたい');
    await page.locator('#ql-thought-task-flag').check();
    await page.locator('#ql-save').click();

    const getNotes = () => page.evaluate(key => JSON.parse(localStorage.getItem(key) || '[]'), NOTES);
    let notes = await getNotes();
    assert.equal(notes.length,1,name+': one thought created');
    assert.equal(notes[0].task.status,'open',name+': task conversion on capture');
    assert.equal(notes[0].body,'イベント運営のマニュアルを作りたい');
    assert.equal(await page.locator('#ql-now .ql-now-item').count(),1,name+': Now strip visible');

    await page.locator('#ql-now [data-thought-action="task-edit"]').click();
    await page.locator('#ql-task-title').fill('運営マニュアル作成');
    await page.locator('#ql-task-due').fill('2030-12-31');
    await page.locator('#ql-task-remind').fill('2030-12-30T18:30');
    await page.locator('#ql-task-save').click();
    notes=await getNotes();
    assert.equal(notes[0].task.title,'運営マニュアル作成');
    assert.equal(notes[0].task.dueOn,'2030-12-31');
    assert.ok(notes[0].task.remindAt,name+': reminder persisted');

    await page.reload({waitUntil:'domcontentloaded'});
    notes=await getNotes();
    assert.equal(notes[0].task.dueOn,'2030-12-31',name+': reload persisted');
    await page.locator('#ql-now [data-thought-action="task-toggle"]').click();
    notes=await getNotes();
    assert.equal(notes[0].task.status,'done',name+': completion');
    assert.ok(notes[0].task.completedAt,name+': completion time');
    assert.equal(await page.locator('#ql-now .ql-now-item').count(),0,name+': completed removed from Now');
    await page.locator('[data-ql-list="tasks"]').click();
    await page.locator('#lib .ql-thought-item [data-thought-action="task-toggle"]').first().click();
    notes=await getNotes();
    assert.equal(notes[0].task.status,'open',name+': reopened');

    await page.locator('#ql-add-thought').click();
    await page.locator('#ql-thought-input').fill('必要なことを思いついた');
    await page.locator('#ql-save').click();
    notes=await getNotes();
    assert.equal(notes.length,2);
    const item=page.locator('#lib .ql-thought-item').filter({hasText:'必要なことを思いついた'});
    // When task list is selected, return to all notes before converting the second note.
    await page.locator('[data-ql-list="all"]').click();
    const untasked=page.locator('#lib .ql-thought-item').filter({hasText:'必要なことを思いついた'});
    await untasked.locator('[data-thought-action="taskify"]').click();
    notes=await getNotes();
    assert.equal(notes.filter(n=>n.task).length,2,name+': one-click conversion of existing thought');

    // Legacy review status is not a task completion.
    await page.evaluate(() => window.QLThoughts.importNotes([
      {id:'legacy-review',body:'古い思いつき',done:true,history:[],created:'2026-01-01T00:00:00Z'}
    ],'merge'));
    notes=await getNotes();
    assert.equal(notes.find(n=>n.id==='legacy-review').task,undefined,name+': no legacy task inference');

    const pending=page.waitForEvent('download');
    await page.evaluate(() => exportData());
    const download=await pending;
    const backup=JSON.parse(await readFile(await download.path(),'utf8'));
    assert.equal(backup.thoughts.items.length,3,name+': backup includes thoughts and tasks');
    await page.evaluate(text => {
      window.QLThoughts.importNotes([], 'replace');
      importFromText(text, 'replace');
    },JSON.stringify(backup));
    notes=await getNotes();
    assert.equal(notes.length,3,name+': restored backup');
    assert.equal(notes.filter(n=>n.task).length,2,name+': tasks restored');

    assert.deepEqual(errors,[],name+': no page errors');
  } finally {
    await context.close();
    await browser.close();
  }
}

for (const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]) await run(name,engine);
console.log('Thoughts-to-tasks regression: PASS (Chromium, WebKit)');
