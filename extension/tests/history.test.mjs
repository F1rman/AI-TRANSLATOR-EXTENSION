import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';

test('IndexedDB history is scoped, deduplicated, bounded, and retained on downgrade',async()=>{
 const built=await build({stdin:{contents:'export * from "./src/shared/history";',resolveDir:process.cwd(),loader:'ts'},bundle:true,format:'iife',globalName:'historyStore',write:false});
 const browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext();const page=await context.newPage();await page.route('https://extension-history.test/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'}));await page.goto('https://extension-history.test/');await page.addScriptTag({content:built.outputFiles[0].text});
  const first=await page.evaluate(async()=>{
   const store=globalThis.historyStore;
   const entry=id=>({id,createdAt:Number(id)||1,sourceLanguage:'English',targetLanguage:'Ukrainian',source:'Hello',translation:'Привіт',mode:'text',tone:'neutral'});
   for(let i=1;i<=25;i++)await store.saveHistory('live:user1',entry(String(i)));
   await store.saveHistory('live:user1',entry('25'));
   await store.saveHistory('test:user1',entry('test'));
   await store.saveHistory('live:user2',entry('other'));
   const free=await store.listHistory('live:user1',20);const pro=await store.listHistory('live:user1',1000);
   await store.setHistoryRecording('live:user1',false);await store.saveHistory('live:user1',entry('26'));const disabled=await store.listHistory('live:user1',20);
   await store.setHistoryRecording('live:user1',true);await store.deleteHistory('live:user1','25');
   return {free,pro,disabled,deleted:await store.listHistory('live:user1',1000),other:await store.listHistory('live:user2',20),test:await store.listHistory('test:user1',20)};
  });
  assert.equal(first.free.entries.length,20);assert.equal(first.free.total,25);assert.equal(first.pro.entries.length,25);assert.equal(first.free.entries[0].id,'25');assert.equal(first.disabled.total,25);assert.equal(first.disabled.recording,false);assert.equal(first.deleted.total,24);assert.equal(first.other.total,1);assert.equal(first.test.total,1);
  const bounded=await page.evaluate(async()=>{
   const store=globalThis.historyStore;const base={sourceLanguage:'en',targetLanguage:'uk',source:'a',translation:'b',mode:'text',tone:'neutral'};
   for(let i=0;i<1005;i++)await store.saveHistory('live:count',{...base,id:String(i),createdAt:i});
   const count=await store.listHistory('live:count',1000);
   const source='x'.repeat(1100000);
   for(let i=0;i<26;i++)await store.saveHistory('live:size',{...base,id:String(i),createdAt:i,source});
   const size=await store.listHistory('live:size',1000);
   await store.deleteHistory('live:user1');
   return {count:count.total,newest:count.entries[0].id,oldest:count.entries.at(-1).id,size:size.total,sizeNewest:size.entries[0].id,cleared:(await store.listHistory('live:user1',20)).total,untouched:(await store.listHistory('live:user2',20)).total};
  });
  assert.equal(bounded.count,1000);assert.equal(bounded.newest,'1004');assert.equal(bounded.oldest,'5');assert.ok(bounded.size<=23);assert.equal(bounded.sizeNewest,'25');assert.equal(bounded.cleared,0);assert.equal(bounded.untouched,1);
  await context.close();
 }finally{await browser.close();}
});

test('page context reads only visible surrounding text and caps Unicode codepoints',async()=>{
 const built=await build({stdin:{contents:'export {visiblePageContext} from "./src/content/context";',resolveDir:process.cwd(),loader:'ts'},bundle:true,format:'iife',globalName:'contextReader',write:false});const browser=await chromium.launch({headless:true});
 try{const page=await browser.newPage({viewport:{width:500,height:500}});await page.setContent('<main><p>Visible public text</p><input value="PASSWORD_SECRET"><textarea>TEXTAREA_SECRET</textarea><div contenteditable="true">EDITABLE_SECRET</div><p hidden>HIDDEN_SECRET</p><p style="opacity:0">OPACITY_HIDDEN_SECRET</p><div style="opacity:0"><p>ANCESTOR_OPACITY_SECRET</p></div><div style="height:10px;overflow:hidden"><p style="margin-top:40px">CLIPPED_SECRET</p></div><div style="width:10px;overflow:hidden;white-space:nowrap"><p style="margin-left:80px">XCLIP_SECRET</p></div><p style="display:none">DISPLAY_SECRET</p><p style="position:absolute;top:3000px">OFFSCREEN_SECRET</p><div data-ai-translator-ui>EXTENSION_SECRET</div><p id="long"></p></main>');await page.locator('#long').evaluate(element=>element.textContent='😀'.repeat(3000));await page.addScriptTag({content:built.outputFiles[0].text});const text=await page.evaluate(()=>globalThis.contextReader.visiblePageContext(document));assert.match(text,/Visible public text/);assert.doesNotMatch(text,/SECRET/);assert.ok(Array.from(text).length<=2000);await page.setViewportSize({width:5000,height:5000});const expanded=await page.evaluate(()=>globalThis.contextReader.visiblePageContext(document));assert.equal(Array.from(expanded).length,2000);
 }finally{await browser.close();}
});
