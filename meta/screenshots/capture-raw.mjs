import { chromium } from 'playwright';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
const raw=path.join(root,'meta/screenshots/raw');
const fixtureDir=path.join(root,'meta/screenshots/fixtures');
await mkdir(raw,{recursive:true});
const profile=await mkdtemp(path.join(tmpdir(),'ai-translator-marketing-'));
const ctx=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:[`--disable-extensions-except=${root}/extension/dist`,`--load-extension=${root}/extension/dist`],viewport:{width:1280,height:900},deviceScaleFactor:2});
const logs=[];
try {
 const worker=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker');
 const settings={sourceLanguage:'French',targetLanguage:'English',selectionMode:'icon',uiLanguage:'en',theme:'light'};
 const draft={input:'Chaque nouvelle langue ouvre une fenêtre sur le monde.',output:'Every new language opens a window to the world.'};
 await worker.evaluate(async({settings,draft})=>{await chrome.storage.local.set({settings});await chrome.storage.session.set({textDraft:draft});},{settings,draft});
 const id=new URL(worker.url()).host;
 const popup=await ctx.newPage();popup.on('pageerror',e=>logs.push(e.message));
 await popup.goto(`chrome-extension://${id}/popup.html`);
 await popup.locator('.result-card.has-result').waitFor();
 await popup.getByText('Detect language',{exact:true}).count();
 // Scrolling the real popup brings its existing input and result into the same visible region.
 await popup.locator('.popup').evaluate(el=>el.scrollTop=document.querySelector('.mode-switch').offsetTop-16);
 await popup.screenshot({path:path.join(raw,'text-result.png'),clip:{x:0,y:80,width:420,height:500}});
 const options=await ctx.newPage();options.on('pageerror',e=>logs.push(e.message));
 await options.setViewportSize({width:1120,height:1020});
 await options.goto(`chrome-extension://${id}/options.html`);
 await options.getByRole('heading',{name:'Translation languages',exact:true}).waitFor();
 const first=await options.locator('.settings-card').nth(0).boundingBox();
 const second=await options.locator('.settings-card').nth(1).boundingBox();
 await options.screenshot({path:path.join(raw,'languages-options.png'),clip:{x:first.x,y:first.y,width:first.width,height:second.y+second.height-first.y}});
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1100,height:690},deviceScaleFactor:2});
  page.on('pageerror',e=>logs.push(e.message));
  const fixture=await readFile(path.join(fixtureDir,'garden.html'),'utf8');
  await page.route('https://field-notes.example/**',r=>r.fulfill({contentType:'text/html',body:fixture}));
  await page.goto('https://field-notes.example/garden');
  await page.evaluate(({settings})=>{
   const listeners=[]; const jobs={};const reports=[];let count=0;
   const dictionary={
    'FIELD NOTES':'FIELD NOTES','Le jardin après la pluie':'The garden after the rain',
    'Petites découvertes, chaque jour.':'Small discoveries, every day.',
    'JARDIN · NOTE 04':'GARDEN · NOTE 04','Lire le monde autrement':'A different way to read the world',
    'Après la pluie, le jardin devient un autre endroit. Les feuilles brillent et la terre garde une odeur douce.':'After the rain, the garden becomes a different place. The leaves shine and the earth holds a gentle scent.',
    'Prendre le temps de regarder change notre façon de voir.':'Taking time to look changes the way we see.',
    'Un banc, un carnet et quelques minutes suffisent pour remarquer quelque chose de nouveau.':'A bench, a notebook and a few minutes are enough to notice something new.',
    'À retenir':'A small reminder','Regardez les détails.':'Look at the details.','Laissez de la place à la curiosité.':'Leave room for curiosity.','Revenez demain.':'Come back tomorrow.',
    'NOUVELLE NOTE':'NEW NOTE','Demain, les ateliers commencent à dix heures.':'Tomorrow, the workshops start at ten.',
   };
   const reverse=Object.fromEntries(Object.entries(dictionary).map(([fr,en])=>[en,fr]));
   window.chrome={runtime:{id:'marketing-fixture',onMessage:{addListener:fn=>listeners.push(fn)},sendMessage:async request=>{
    if(request.type==='settings:get')return{ok:true,data:settings};
    if(request.type==='page:report'){reports.push(request.payload);return{ok:true,data:request.payload};}
    if(request.type==='translation:submit'){
     const id=`demo-${++count}`;
     const translations=request.payload.segments.map(s=>({id:s.id,text:request.payload.targetLanguage==='English'?(dictionary[s.text]||s.text):(reverse[s.text]||s.text)}));
     jobs[id]={id,status:'completed',translations};return{ok:true,data:{id,status:'queued'}};
    }
    if(request.type==='translation:get')return{ok:true,data:jobs[request.payload.id]};
    if(request.type==='translation:cancel')return{ok:true,data:{id:request.payload.id,status:'cancelled'}};
    if(request.type==='page:restore'){await window.marketingFixture.command('restore');return{ok:true,data:null};}
    return{ok:true,data:null};
   }},storage:{onChanged:{addListener(fn){window.marketingSettingsChanged=fn;}}}};
   window.marketingFixture={reports,settings,submitted:()=>count,command:action=>Promise.all(listeners.map(fn=>new Promise(resolve=>{if(!fn({type:'page:command',payload:{action,sessionId:'marketing-session',sourceLanguage:'French',targetLanguage:'English'}},{id:'marketing-fixture'},resolve))resolve(null);}))),selection:text=>Promise.all(listeners.map(fn=>new Promise(resolve=>{if(!fn({type:'selection:translate',payload:{text}},{id:'marketing-fixture'},resolve))resolve(null);}))),setDark(){document.documentElement.dataset.theme='dark';settings.theme='dark';window.marketingSettingsChanged({settings:{newValue:settings}},'local');}};
  },{settings});
  const content=await readFile(path.join(root,'extension/dist/content.js'),'utf8');
  await page.addScriptTag({content});
  await page.evaluate(()=>{const range=document.createRange();range.selectNodeContents(document.querySelector('#quote'));window.getSelection().removeAllRanges();window.getSelection().addRange(range);return window.marketingFixture.selection(document.querySelector('#quote').textContent);});
  await page.waitForTimeout(1700);
  await page.screenshot({path:path.join(raw,'selection-translation.png')});
  await page.keyboard.press('Escape');
  await page.evaluate(()=>{window.getSelection().removeAllRanges();return window.marketingFixture.command('start');});
  await page.waitForFunction(()=>document.querySelector('h1').textContent==='The garden after the rain');
  await page.evaluate(()=>{const div=document.createElement('div');div.id='live-note';div.className='live-note';div.innerHTML='<span>NOUVELLE NOTE</span><p>Demain, les ateliers commencent à dix heures.</p>';document.querySelector('article').append(div);});
  await page.waitForFunction(()=>document.querySelector('#live-note p').textContent==='Tomorrow, the workshops start at ten.');
  await page.waitForTimeout(400);
  await page.screenshot({path:path.join(raw,'page-translated.png')});
  await page.evaluate(()=>window.marketingFixture.command('restore'));
  await page.waitForFunction(()=>document.querySelector('h1').textContent==='Le jardin après la pluie');
  await page.screenshot({path:path.join(raw,'page-restored.png')});
  await page.evaluate(()=>{window.marketingFixture.setDark();const range=document.createRange();range.selectNodeContents(document.querySelector('#quote'));window.getSelection().removeAllRanges();window.getSelection().addRange(range);return window.marketingFixture.selection(document.querySelector('#quote').textContent);});
  await page.waitForTimeout(1700);
  await page.screenshot({path:path.join(raw,'selection-dark.png')});
  const state=await page.evaluate(()=>({reports:window.marketingFixture.reports,submitted:window.marketingFixture.submitted(),restoredTitle:document.querySelector('h1').textContent}));
  await writeFile(path.join(raw,'fixture-verification.json'),JSON.stringify({extensionId:id,authenticated:false,liveGoogleLoginTested:false,liveAiRequest:false,uiLanguage:'en',fixture:state,errors:logs},null,2));
 }finally{await browser.close();}
 console.log(JSON.stringify({captures:6,extensionId:id,errors:logs}));
}finally{await ctx.close();await rm(profile,{recursive:true,force:true});}
