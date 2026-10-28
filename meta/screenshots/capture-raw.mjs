// Marketing-only capture harness. The built product files stay read-only.
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const root=path.resolve(import.meta.dirname,'../..');
const raw=path.join(root,'meta/screenshots/raw');
const dist=path.join(root,'extension/dist');
await mkdir(raw,{recursive:true});
const errors=[];const evidence=[];
const browser=await chromium.launch({headless:true});
const source='Chaque nouvelle langue ouvre une fenêtre sur le monde.';
const translated='Every new language opens a window to the world.';
const settings={sourceLanguage:'French',targetLanguage:'English',selectionMode:'icon',uiLanguage:'en',theme:'light',tone:'neutral',usePageContext:false};
function installTransport({plan,theme}) {
 const pro=plan==='pro';const user={uid:'marketing-demo',name:'Demo account',email:'demo@example.com',picture:null};
 let prefs={sourceLanguage:'French',targetLanguage:'English',selectionMode:'icon',uiLanguage:'en',theme,tone:pro?'formal':'neutral',usePageContext:pro};
 const monthly=pro?2000000:100000;
 const quota={monthlyCharacters:monthly,usedCharacters:1432,reservedCharacters:0,remainingCharacters:monthly-1432,periodStart:'2026-10-01T00:00:00Z',resetsAt:'2026-11-01T00:00:00Z'};
 let entries=[{id:'demo-1',createdAt:1793106000000,sourceLanguage:'French',targetLanguage:'English',source:'Chaque nouvelle langue ouvre une fenêtre sur le monde.',translation:'Every new language opens a window to the world.',tone:'neutral',mode:'text'},{id:'demo-2',createdAt:1793105000000,sourceLanguage:'French',targetLanguage:'English',source:'Prendre le temps de regarder change notre façon de voir.',translation:'Taking time to look changes the way we see.',tone:'neutral',mode:'selection'}];
 const session={};let recording=true;
 globalThis.marketingRequests=[];
 globalThis.chrome={runtime:{id:'marketing-demo-extension',openOptionsPage(){},async sendMessage(request){
  globalThis.marketingRequests.push(request);let data;
  switch(request.type){
   case 'settings:get':data=prefs;break;
   case 'settings:set':prefs={...prefs,...request.payload};data=prefs;break;
   case 'auth:get':case 'auth:login':data={user,configured:true};break;
   case 'account:get':data={user,plan,characterQuota:quota,features:{pageTranslation:pro,pageContext:pro,tones:pro?['neutral','formal','friendly','technical']:['neutral'],historyLimit:pro?1000:20,priority:pro,imageTranslation:false},limits:{maxCharactersPerJob:pro?50000:4000,maxSegments:24,maxConcurrentJobs:2},billing:{environment:'live',purchasesEnabled:true},billingAvailability:{environment:'live',canPurchase:true,canViewPurchases:true,reason:'ready'}};break;
   case 'translation:submit':data={id:'marketing-text-job',status:'completed',translations:request.payload.segments.map(segment=>({id:segment.id,text:'Every new language opens a window to the world.'})),characterQuota:quota};break;
   case 'translation:displayed':data=null;break;
   case 'page:status':data={sessionId:'',status:'idle',total:0,completed:0,failed:0};break;
   case 'history:list':data={entries,total:entries.length,recording,limit:pro?1000:20};break;
   case 'history:delete':entries=entries.filter(entry=>entry.id!==request.payload.id);data={ok:true};break;
   case 'history:recording':recording=request.payload.enabled;data={ok:true};break;
   case 'billing:open':data={opened:true};break;
   case 'review:status':data={eligible:false};break;
   default:throw new Error('Unsupported marketing fixture request: '+request.type);
  }
  return{ok:true,data};
 }},storage:{session:{async get(keys){return Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(key=>[key,session[key]]));},async set(values){Object.assign(session,values);},async remove(keys){for(const key of Array.isArray(keys)?keys:[keys])delete session[key];}}},tabs:{async query(){return[];}}};
}
async function uiPage(plan='free',pageName='popup',theme='light'){
 const context=await browser.newContext({viewport:{width:pageName==='popup'?420:1120,height:pageName==='popup'?600:1000},deviceScaleFactor:2});
 await context.route('https://product-demo.example/**',async route=>{
  const file=path.join(dist,new URL(route.request().url()).pathname);
  try{const body=await readFile(file);const extension=path.extname(file);const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.woff2':'font/woff2','.png':'image/png'};await route.fulfill({contentType:types[extension]||'application/octet-stream',body});}catch{await route.abort();}
 });
 await context.addInitScript(installTransport,{plan,theme});
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`https://product-demo.example/${pageName}.html`);await page.locator('.quota-block').waitFor();await page.evaluate(()=>document.fonts.ready);
 return{context,page};
}
try{
 const text=await uiPage();await text.page.getByRole('textbox',{name:'Type or paste your text…'}).fill(source);await text.page.locator('.translate-button').click();await text.page.locator('.result-card.has-result').waitFor();
 await text.page.locator('.popup').evaluate(element=>{element.scrollTop=document.querySelector('.mode-switch').offsetTop-12;});
 await text.page.locator('.popup').screenshot({path:path.join(raw,'text-result.png')});
 evidence.push({capture:'text-result.png',plan:'free',actualBuiltUi:true,requests:await text.page.evaluate(()=>globalThis.marketingRequests.filter(request=>request.type==='translation:submit'))});await text.context.close();
 const options=await uiPage('pro','options');
 await options.page.getByLabel('Translation tone').selectOption('formal');
 await options.page.getByLabel('Use visible page context',{exact:false}).check();
 await options.page.locator('#preferences').screenshot({path:path.join(raw,'pro-context-options.png')});
 evidence.push({capture:'pro-context-options.png',plan:'pro',actualBuiltUi:true});await options.context.close();
 const history=await uiPage('pro','popup','dark');await history.page.getByRole('button',{name:'History',exact:true}).click();await history.page.locator('.history-entry').first().waitFor();await history.page.locator('.history-entry summary').first().click();
 await history.page.locator('.popup').evaluate(element=>{element.scrollTop=document.querySelector('.mode-switch').offsetTop-12;});
 await history.page.locator('.popup').screenshot({path:path.join(raw,'local-history-dark.png')});evidence.push({capture:'local-history-dark.png',plan:'pro',actualBuiltUi:true});await history.context.close();
 const page=await browser.newPage({viewport:{width:1100,height:690},deviceScaleFactor:2});page.on('pageerror',error=>errors.push(error.message));
 const fixture=await readFile(path.join(root,'meta/screenshots/fixtures/garden.html'),'utf8');await page.route('https://field-notes.example/**',route=>route.fulfill({contentType:'text/html',body:fixture}));await page.goto('https://field-notes.example/garden');
 await page.evaluate(({settings})=>{
  const listeners=[];const jobs={};const reports=[];let count=0;
  const dictionary={'FIELD NOTES':'FIELD NOTES','Le jardin après la pluie':'The garden after the rain','Petites découvertes, chaque jour.':'Small discoveries, every day.','JARDIN · NOTE 04':'GARDEN · NOTE 04','Lire le monde autrement':'A different way to read the world','Après la pluie, le jardin devient un autre endroit. Les feuilles brillent et la terre garde une odeur douce.':'After the rain, the garden becomes a different place. The leaves shine and the earth holds a gentle scent.','Prendre le temps de regarder change notre façon de voir.':'Taking time to look changes the way we see.','Un banc, un carnet et quelques minutes suffisent pour remarquer quelque chose de nouveau.':'A bench, a notebook and a few minutes are enough to notice something new.','À retenir':'A small reminder','Regardez les détails.':'Look at the details.','Laissez de la place à la curiosité.':'Leave room for curiosity.','Revenez demain.':'Come back tomorrow.','NOUVELLE NOTE':'NEW NOTE','Demain, les ateliers commencent à dix heures.':'Tomorrow, the workshops start at ten.'};
  window.chrome={runtime:{id:'marketing-fixture',onMessage:{addListener:fn=>listeners.push(fn)},sendMessage:async request=>{
   if(request.type==='settings:get')return{ok:true,data:settings};
   if(request.type==='account:get')return{ok:true,data:{plan:'pro',features:{pageTranslation:true,pageContext:true,tones:['neutral','formal','friendly','technical']},limits:{maxCharactersPerJob:50000,maxSegments:24}}};
   if(request.type==='page:report'){reports.push(request.payload);return{ok:true,data:request.payload};}
   if(request.type==='translation:submit'){const id=`demo-${++count}`;jobs[id]={id,status:'completed',translations:request.payload.segments.map(segment=>({id:segment.id,text:dictionary[segment.text]||segment.text}))};return{ok:true,data:{id,status:'queued'}};}
   if(request.type==='translation:get')return{ok:true,data:jobs[request.payload.id]};
   if(request.type==='translation:cancel')return{ok:true,data:{id:request.payload.id,status:'cancelled'}};
   if(request.type==='translation:displayed')return{ok:true,data:null};
   if(request.type==='page:restore'){await window.marketingFixture.command('restore');return{ok:true,data:null};}
   return{ok:true,data:null};
  }},storage:{onChanged:{addListener(){}}}};
  window.marketingFixture={reports,submitted:()=>count,command:action=>Promise.all(listeners.map(fn=>new Promise(resolve=>{if(!fn({type:'page:command',payload:{action,sessionId:'marketing-session',sourceLanguage:'French',targetLanguage:'English',maxCharactersPerJob:50000,maxSegments:24,tone:'neutral',usePageContext:false}},{id:'marketing-fixture'},resolve))resolve(null);}))),selection:text=>Promise.all(listeners.map(fn=>new Promise(resolve=>{if(!fn({type:'selection:translate',payload:{text}},{id:'marketing-fixture'},resolve))resolve(null);})))};
 },{settings});
 const content=await readFile(path.join(dist,'content.js'),'utf8');await page.addScriptTag({content});
 await page.evaluate(()=>{const range=document.createRange();range.selectNodeContents(document.querySelector('#quote'));window.getSelection().removeAllRanges();window.getSelection().addRange(range);return window.marketingFixture.selection(document.querySelector('#quote').textContent);});await page.waitForTimeout(1300);await page.screenshot({path:path.join(raw,'selection-translation.png')});
 await page.keyboard.press('Escape');await page.evaluate(()=>{window.getSelection().removeAllRanges();return window.marketingFixture.command('start');});await page.waitForFunction(()=>document.querySelector('h1').textContent==='The garden after the rain');
 await page.evaluate(()=>{const note=document.createElement('div');note.id='live-note';note.className='live-note';note.innerHTML='<span>NOUVELLE NOTE</span><p>Demain, les ateliers commencent à dix heures.</p>';document.querySelector('article').append(note);});await page.waitForFunction(()=>document.querySelector('#live-note p').textContent==='Tomorrow, the workshops start at ten.');await page.waitForTimeout(400);await page.screenshot({path:path.join(raw,'page-translated.png')});
 await page.evaluate(()=>window.marketingFixture.command('restore'));await page.waitForFunction(()=>document.querySelector('h1').textContent==='Le jardin après la pluie');await page.screenshot({path:path.join(raw,'page-restored.png')});
 evidence.push({capture:'selection-translation.png',actualBuiltContent:true,plan:'pro'},{capture:'page-translated.png',actualBuiltContent:true,plan:'pro',state:await page.evaluate(()=>({reports:window.marketingFixture.reports,submitted:window.marketingFixture.submitted(),restoredTitle:document.querySelector('h1').textContent}))});
 const manifest=JSON.parse(await readFile(path.join(dist,'manifest.json'),'utf8'));
 const hashes=Object.fromEntries(await Promise.all(['manifest.json','content.js','background.js'].map(async file=>[file,createHash('sha256').update(await readFile(path.join(dist,file))).digest('hex')])));
 await writeFile(path.join(raw,'fixture-verification.json'),JSON.stringify({date:new Date().toISOString().slice(0,10),version:manifest.version,extensionId:'aieamemimbcbbnmakifejomadhegogge',sourceHashes:hashes,actualBuiltUi:true,deterministicDemoTransport:true,liveGoogleLoginTested:false,liveAiRequest:false,demoAccountAndQuotas:true,uiLanguage:'en',evidence,errors},null,2));
 if(errors.length)throw new Error(errors.join('\n'));
 console.log(JSON.stringify({captures:6,version:manifest.version,errors}));
}finally{await browser.close();}
