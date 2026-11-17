import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';

const URL = process.env.LOCAL_URL || 'http://127.0.0.1:4173/';
const STORAGE = 'quicklinks-thoughts-v1';

async function scenario(name, engine, width) {
  const browser = await engine.launch({headless:true});
  const context = await browser.newContext({viewport:{width,height:844}});
  const page = await context.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(String(error)));
  const readNotes=()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)||'[]'),STORAGE);
  try {
    await page.goto(URL,{waitUntil:'domcontentloaded'});
    await page.evaluate(()=>{
      localStorage.removeItem('quicklinks-thoughts-v1');
      localStorage.removeItem('quick-links-mobile-localstorage-v1');
      localStorage.removeItem('quick-links-sync-v1');
    });
    await page.reload({waitUntil:'domcontentloaded'});

    await page.locator('#ql-add-thought').click();
    assert.equal(await page.locator('#ql-tag-picker').isHidden(),true,name+': optional tags initially collapsed');
    await page.locator('#ql-thought-input').fill('スライドを構造から考える');

    await page.locator('#ql-tag-toggle').click();
    assert.equal(await page.locator('#ql-tag-picker').isVisible(),true,name+': picker opens');
    await page.locator('#ql-tag-input').fill('仕事');
    await page.locator('#ql-tag-add').click();
    assert.equal(await page.locator('#ql-tag-selected [data-remove-tag="仕事"]').count(),1,name+': first tag selected');

    // A shortcut to dismiss suggestions must not accidentally close the note dialog.
    await page.locator('#ql-tag-input').press('Escape');
    assert.equal(await page.locator('#ql-tag-picker').isHidden(),true,name+': Escape dismisses suggestions');
    assert.equal(await page.locator('#ql-thought-dialog').isVisible(),true,name+': note stays open');

    await page.locator('#ql-tag-toggle').click();
    await page.locator('#ql-tag-input').fill('スライド');
    await page.locator('#ql-tag-input').press('Enter');
    assert.equal(await page.locator('#ql-tag-selected button').count(),2,name+': second tag selected');
    await page.locator('#ql-save').click();
    let notes=await readNotes();
    assert.equal(notes.length,1,name+': note saved');
    assert.deepEqual(notes[0].tags,['仕事','スライド'],name+': tags saved');

    await page.locator('[data-ql-list="thoughts"]').click();
    await page.locator('#ql-tag-filter-select').selectOption('仕事');
    assert.equal(await page.locator('#lib .ql-thought-item').count(),1,name+': list filter finds tagged note');

    // An untagged note remains available and should not be forced into a category.
    await page.locator('#ql-add-thought').click();
    await page.locator('#ql-thought-input').fill('タグなしのメモ');
    await page.locator('#ql-save').click();
    notes=await readNotes();
    assert.equal(notes.length,2,name+': untagged note added');
    assert.deepEqual(notes.find(n=>n.body==='タグなしのメモ').tags,[],name+': no tag required');

    await page.locator('#ql-tag-filter-select').selectOption('');
    assert.equal(await page.locator('#lib .ql-thought-item').count(),2,name+': clear filter shows all notes');

    const tagged=page.locator('#lib .ql-thought-item').filter({hasText:'スライドを構造から考える'});
    await tagged.locator('[data-thought-action="edit"]').click();
    await page.locator('#ql-tag-selected [data-remove-tag="仕事"]').click();
    await page.locator('#ql-save').click();
    notes=await readNotes();
    assert.deepEqual(notes.find(n=>n.body==='スライドを構造から考える').tags,['スライド'],
      name+': editing tags preserves content');

    if(width<900){
      await page.locator('#searchOpen').click();
      await page.locator('#mSearchInput').fill('#スライド');
      assert.equal(await page.locator('#mResults .ql-thought-item').count(),1,name+': mobile tag search');
      await page.locator('#searchSheet [data-close]').first().click();
    } else {
      await page.locator('#searchInput').fill('#スライド');
      assert.equal(await page.locator('#lib .ql-thought-item').count(),1,name+': desktop tag search');
    }

    assert.deepEqual(errors,[],name+': no runtime errors');
    await page.screenshot({path:'visual-qa/thought-tags-'+name+'-'+width+'.png',fullPage:true});
    console.log('Thought tags UI: PASS '+name+' '+width);
  } finally {
    await context.close();
    await browser.close();
  }
}
await scenario('chromium',chromium,390);
await scenario('chromium',chromium,1366);
await scenario('webkit',webkit,390);
console.log('Thought tags browser acceptance: PASS (mobile Chromium/WebKit, desktop Chromium)');
