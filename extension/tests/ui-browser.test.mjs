import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { basename, join } from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';

// Real React bundles with deterministic extension transport; no cloud or AI calls.
test('subscription UI shows character quotas, Pro controls, local history and retired image guard', async () => {
  const bundle = await build({ entryPoints: ['src/ui/main.tsx', 'src/ui/image-main.tsx'], bundle: true, platform: 'browser', format: 'iife', write: false, outdir: '/ui-test-output', external: ['/fonts/*'], define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': JSON.stringify({ VITE_BILLING_ENVIRONMENT: 'live' }) } });
  const files = new Map(bundle.outputFiles.map(file => [basename(file.path), file.text]));
  const popupHtml = (await readFile(new URL('../popup.html', import.meta.url), 'utf8'))
    .replace('</head>', '<link rel="stylesheet" href="/main.css"></head>')
    .replace('<script type="module" src="/src/ui/main.tsx"></script>', '<script src="/main.js"></script>');
  const browser = await chromium.launch({ headless: true }); const errors = [];
  const screenshots = process.env.UI_QA_SCREENSHOTS; if (screenshots) await mkdir(screenshots, {recursive:true});
  async function open(mode = 'free', pageName = 'popup', width = 420, locale = 'en') {
    const context = await browser.newContext({ viewport: {width, height: pageName === 'popup' ? 600 : 950} });
    await context.route('https://ui.test/**', async route => {
      const name = new URL(route.request().url()).pathname.slice(1);
      if (files.has(name)) return route.fulfill({contentType:name.endsWith('.css')?'text/css':'application/javascript',body:files.get(name)});
      if (/^fonts\/[\w.-]+\.woff2$/.test(name)) return route.fulfill({contentType:'font/woff2',body:await readFile(new URL(`../public/${name}`,import.meta.url))});
      if (pageName === 'popup') return route.fulfill({contentType:'text/html',body:popupHtml});
      const entry = pageName === 'image' ? 'image-main':'main';
      return route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><link rel="stylesheet" href="/${entry}.css"></head><body><div id="root"></div><script src="/${entry}.js"></script></body></html>`});
    });
    await context.addInitScript(({mode,locale}) => {
      const pro=mode.startsWith('pro'); let user={uid:'user-one',name:'Test',email:'test@example.com',picture:null};
      let settings={sourceLanguage:'auto',targetLanguage:'Ukrainian',uiLanguage:locale,theme:mode.includes('dark')?'dark':'light',selectionMode:'icon',tone:'neutral',usePageContext:false};
      let recording=true; let entries=[{id:'saved',createdAt:1793120000000,sourceLanguage:'English',targetLanguage:'Ukrainian',source:'Saved source',translation:'Збережений переклад',tone:'neutral',mode:'text'}];
      const monthly=pro?2000000:100000;
      const quota={monthlyCharacters:monthly,usedCharacters:mode==='exhausted'?monthly:1234,reservedCharacters:23,remainingCharacters:mode==='exhausted'?0:monthly-1257,periodStart:pro?'2026-10-15T10:00:00Z':'2026-10-01T00:00:00Z',resetsAt:pro?'2026-11-15T10:00:00Z':'2026-11-01T00:00:00Z'};
      const sessionValues = {};
      const key = (prefix, uid) => `${prefix}:${JSON.stringify(['live', uid])}`;
      if (mode === 'accountswitch') sessionValues[key('textDraft', 'user-one')] = { input: 'PRIVATE_USER_A_SOURCE', output: 'PRIVATE_USER_A_OUTPUT' };
      globalThis.switchFixtureUser = uid => {
        const pending = {sourceLanguage:'auto',targetLanguage:'Ukrainian',segments:[{id:'text',text:'PRIVATE_PENDING_A'}],idempotencyKey:'a-pending'};
        sessionValues[key('pendingText','user-one')] = pending;
        sessionValues.textDraft = {input:'UNSCOPED_LEGACY_SECRET',output:'UNSCOPED_LEGACY_OUTPUT'};
        sessionValues.pendingText = pending;
        user = {...user, uid};
      };
      globalThis.uiRequests=[];
      globalThis.chrome={runtime:{id:'fixture-extension',openOptionsPage(){},async sendMessage(request){
        globalThis.uiRequests.push(request);let data;
        switch(request.type){
          case 'settings:get':data=settings;break;
          case 'settings:set':settings={...settings,...request.payload};data=settings;break;
          case 'auth:get':data={user:mode==='signedout'?null:user,configured:true};break;
          case 'auth:login':data={user,configured:true};break;
          case 'auth:logout':data={user:null,configured:true};break;
          case 'account:get':if(mode==='outdated')return {ok:false,error:{code:'UPDATE_REQUIRED',message:'Old server'}};
            data={user,plan:pro?'pro':'free',characterQuota:quota,features:{pageTranslation:pro,pageContext:pro,tones:pro?['neutral','formal','friendly','technical']:['neutral'],historyLimit:pro?1000:20,priority:pro,imageTranslation:false},limits:{maxCharactersPerJob:pro?50000:4000,maxSegments:24,maxConcurrentJobs:2},billing:{environment:'live',purchasesEnabled:mode!=='paused'},billingAvailability:{environment:'live',canPurchase:mode!=='paused',canViewPurchases:true,reason:mode==='paused'?'disabled':'ready'}};break;
          case 'history:list':data={entries,total:entries.length,recording,limit:pro?1000:20};break;
          case 'history:clear':entries=[];data={ok:true};break;
          case 'history:delete':entries=entries.filter(entry=>entry.id!==request.payload.id);data={ok:true};break;
          case 'history:recording':recording=request.payload.enabled;data={ok:true};break;
          case 'translation:submit':data={id:'job-one',status:'completed',translations:request.payload.segments.map(segment=>({id:segment.id,text:'Переклад'})),characterQuota:quota};break;
          case 'translation:displayed':data=null;break;
          case 'page:status':data={sessionId:'',status:'idle',total:0,completed:0,failed:0};break;
          case 'page:start':data={sessionId:'page-one',status:'translating',total:4,completed:1,failed:0};break;
          case 'billing:open':data={opened:true};break;
          default:throw new Error('Unexpected fixture request: '+request.type);
        }
        return {ok:true,data};
      }},storage:{session:{async get(keys){return Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(key=>[key,sessionValues[key]]))},async set(values){Object.assign(sessionValues,values)},async remove(keys){for(const key of Array.isArray(keys)?keys:[keys])delete sessionValues[key]}}},tabs:{async query(){return[]}}};
    },{mode,locale});
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`https://ui.test/${pageName}.html`);
    return {context,page,requests:()=>page.evaluate(()=>globalThis.uiRequests)};
  }
  try {
    const free=await open();await free.page.getByText('Characters this month',{exact:true}).waitFor();
    assert.equal(await free.page.locator('.quota-block strong').textContent(),'1,234 / 100,000');
    assert.equal(await free.page.locator('.translation-options option[value=formal]').evaluate(element => element.disabled),true);
    assert.equal(await free.page.getByLabel('Use visible page context',{exact:false}).isDisabled(),true);
    const input=free.page.getByRole('textbox',{name:'Type or paste your text…'});
    await input.fill('😀'.repeat(4001));assert.equal(Array.from(await input.inputValue()).length,4000);
    await free.page.getByRole('button',{name:'Upgrade to Pro',exact:true}).first().click();
    await free.page.getByRole('button',{name:'Manage subscription',exact:true}).click();
    assert.deepEqual((await free.requests()).filter(request=>request.type==='billing:open').map(request=>request.payload.page),['pay','account']);
    assert.equal(await free.page.locator('.purchased-balance,.available-total,.image-account').count(),0);
    await free.page.getByRole('button',{name:'Webpage',exact:true}).click();
    await free.page.locator('.page-card').getByRole('button',{name:'Upgrade to Pro'}).click();
    assert.equal((await free.requests()).filter(request=>request.type==='page:start').length,0);
    await free.page.getByRole('button',{name:'History',exact:true}).click();
    await free.page.locator('summary').filter({hasText:'Saved source'}).waitFor();
    await free.page.getByLabel('Save completed translations').uncheck();
    await free.page.getByRole('button',{name:'Delete translation'}).click();
    await free.page.getByText('No saved translations yet.').waitFor();await free.context.close();
    const pro=await open('pro');await pro.page.locator('.quota-block').waitFor();
    assert.equal(await pro.page.locator('.quota-block strong').textContent(),'1,234 / 2,000,000');
    assert.match(await pro.page.locator('.quota-reset').textContent(),/Nov.*15.*10:00.*UTC/);
    await pro.page.locator('.translation-options summary').click();
    await pro.page.getByLabel('Translation tone').selectOption('technical');
    await pro.page.getByLabel('Use visible page context',{exact:false}).check();
    await pro.page.getByRole('textbox',{name:'Type or paste your text…'}).fill('😀'.repeat(50000));
    assert.equal(await pro.page.locator('.text-card-bottom>span').textContent(),'50,000 / 50,000');
    await pro.page.locator('.translate-button').click();
    await pro.page.locator('.result-card p').filter({hasText:'Переклад'}).waitFor();
    const submitted=(await pro.requests()).find(request=>request.type==='translation:submit');
    assert.equal(Array.from(submitted.payload.segments[0].text).length,50000);assert.equal(submitted.payload.tone,'technical');
    await pro.page.getByRole('button',{name:'Webpage',exact:true}).click();await pro.page.getByRole('button',{name:'Translate this page',exact:true}).click();
    assert.equal((await pro.requests()).filter(request=>request.type==='page:start').length,1);await pro.context.close();
    for(const mode of ['signedout','free','pro-dark'])for(const width of [320,420,1200]){
      const fixture=await open(mode,'popup',width);await fixture.page.locator('.popup-header').waitFor();
      const widths=await fixture.page.evaluate(()=>['html','body','#root','.popup'].map(selector=>document.querySelector(selector).getBoundingClientRect().width));
      assert.deepEqual(widths,[420,420,420,420],`${mode}/${width}: popup document and content stay exactly 420px`);
      assert.equal(await fixture.page.locator('.popup').evaluate(element=>element.scrollWidth<=element.clientWidth),true,`${mode}/${width}: no horizontal content overflow`);
      await fixture.context.close();
    }
    for(const mode of ['free','pro-dark'])for(const pageName of ['popup','options'])for(const width of pageName==='popup'?[420,1200]:[320,360,390,430,1200]){
      const fixture=await open(mode,pageName,width,mode==='pro-dark'?'uk':'en');await fixture.page.locator('.quota-block').waitFor();await fixture.page.evaluate(()=>document.fonts.ready);
      assert.equal(await fixture.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${mode}/${pageName}/${width}: no overflow`);
      const target=fixture.page.locator('.language-trigger').last();await target.click();
      const menu=await fixture.page.locator('.language-menu').boundingBox();assert.ok(menu.x>=0&&menu.x+menu.width<=width);
      await fixture.page.locator('.language-search input').press('Escape');assert.equal(await target.evaluate(element=>element===document.activeElement),true);
      if(screenshots&&width===(pageName==='popup'?420:390))await fixture.page.screenshot({path:join(screenshots,`subscription-${pageName}-${mode}.png`),fullPage:true});
      await fixture.context.close();
    }
    const switched=await open('accountswitch');
    await switched.page.getByRole('textbox',{name:'Type or paste your text…'}).waitFor();
    await switched.page.waitForFunction(()=>document.querySelector('textarea')?.value==='PRIVATE_USER_A_SOURCE');
    await switched.page.evaluate(()=>{globalThis.switchFixtureUser('user-two');window.dispatchEvent(new Event('focus'));});
    await switched.page.waitForFunction(()=>document.querySelector('textarea')?.value==='');
    assert.doesNotMatch(await switched.page.locator('.result-card').textContent(),/PRIVATE_USER_A_OUTPUT/);
    assert.equal((await switched.requests()).filter(request=>request.type==='translation:submit').length,0,'Account B must not auto-submit A pending text');
    await switched.context.close();
    const outdated=await open('outdated');await outdated.page.getByRole('alert').filter({hasText:'Update AI Translator'}).waitFor();await outdated.context.close();
    const image=await open('free','image');await image.page.getByRole('heading',{name:'Image translation is unavailable'}).waitFor();assert.equal((await image.requests()).length,0);await image.context.close();
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});
