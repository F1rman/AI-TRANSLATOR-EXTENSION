import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { basename, join } from 'node:path';
import { mkdir } from 'node:fs/promises';

// Deterministic transport: these tests exercise the actual React pages, not Google or AI.
test('image UI gates uploads, resumes jobs, downloads PNG and recovers from polling loss', async () => {
  const result = await build({ entryPoints: ['src/ui/main.tsx', 'src/ui/image-main.tsx'], bundle: true, platform: 'browser', format: 'iife', write: false, outdir: '/ui-test-output', define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': JSON.stringify({ VITE_BILLING_BASE_URL: 'https://balubenko-stripe.web.app', VITE_BILLING_ENVIRONMENT: 'live', VITE_API_BASE_URL: 'https://ai-translator-api-1060412514800.europe-west1.run.app', VITE_FIREBASE_PROJECT_ID: 'ai-translator-ext' }) } });
  const files = new Map(result.outputFiles.map((file) => [basename(file.path), file.text]));
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const screenshotDirectory = process.env.UI_QA_SCREENSHOTS;
  if (screenshotDirectory) await mkdir(screenshotDirectory, { recursive: true });
  async function open(mode, pageName = 'image') {
    const context = await browser.newContext({ viewport: { width: pageName === 'popup' ? 420 : 1200, height: pageName === 'popup' ? 600 : 900 }, acceptDownloads: true });
    await context.route('https://ui.test/**', (route) => {
      const name = new URL(route.request().url()).pathname.slice(1);
      if (files.has(name)) return route.fulfill({ contentType: name.endsWith('.css') ? 'text/css' : 'application/javascript', body: files.get(name) });
      const entry = pageName === 'image' ? 'image-main' : 'main';
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><link rel="stylesheet" href="/${entry}.css"></head><body><div id="root"></div><script src="/${entry}.js"></script></body></html>` });
    });
    await context.addInitScript((mode) => {
      const picture = (text) => { const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 480; const ctx = canvas.getContext('2d'); ctx.fillStyle = '#e4ebda'; ctx.fillRect(0, 0, 800, 480); ctx.fillStyle = '#263027'; ctx.font = '600 54px system-ui'; ctx.fillText(text, 64, 200); ctx.font = '28px system-ui'; ctx.fillText('AI Translator · UI test fixture', 64, 260); return canvas.toDataURL('image/png'); };
      const png = picture('Hello, world!'); const translatedPng = picture('Привіт, світе!');
      const user = { uid: 'test-user', email: 'test@example.com', name: 'Test', picture: null };
      const free = mode.startsWith('free');
      const monthlyWords = free ? 10000 : 200000;
      const quota = { monthlyWords, usedWords: (mode === 'words-exhausted' || mode.includes('prepaid')) ? monthlyWords : 1234, reservedWords: 23, remainingWords: (mode === 'words-exhausted' || mode.includes('prepaid')) ? 0 : monthlyWords - 1257, resetsAt: '2026-11-01T00:00:00Z' };
      const imageQuota = { monthlyImages: free ? 5 : mode === 'custom-quota' ? 17 : 150, usedImages: (mode === 'images-exhausted' || mode.includes('prepaid')) ? 150 : 0, reservedImages: 0, remainingImages: (mode === 'images-exhausted' || mode.includes('prepaid')) ? 0 : free ? 5 : mode === 'custom-quota' ? 17 : 150, resetsAt: quota.resetsAt };
      let loggedIn = mode !== 'signedout'; let settings = { sourceLanguage: 'auto', targetLanguage: 'Ukrainian', uiLanguage: mode === 'pro-dark' ? 'uk' : 'en', theme: mode === 'pro-dark' ? 'dark' : 'light', selectionMode: 'icon' };
      let submitted = false; let getCount = 0; let cancelled = false;
      globalThis.uiRequests = [];
      globalThis.chrome = { runtime: { id: 'test-extension', openOptionsPage() {}, async sendMessage(request) {
        globalThis.uiRequests.push(request);
        let data;
        switch (request.type) {
          case 'settings:get': data = settings; break;
          case 'settings:set': settings = { ...settings, ...request.payload }; data = settings; break;
          case 'auth:get': data = { user: loggedIn ? user : null, configured: true }; break;
          case 'auth:login': loggedIn = true; data = { user, configured: true }; break;
          case 'auth:logout': loggedIn = false; data = { user: null, configured: true }; break;
          case 'account:get': data = { user, quota, imageQuota, billing: mode === 'legacy' ? undefined : { environment: 'live', purchasesEnabled: mode !== 'purchases-disabled' }, billingAvailability: { environment: 'live', canPurchase: !['legacy', 'purchases-disabled', 'mismatched'].includes(mode), canViewPurchases: !['legacy', 'mismatched'].includes(mode), reason: mode === 'mismatched' ? 'environment-mismatch' : mode === 'legacy' ? 'unavailable' : mode === 'purchases-disabled' ? 'disabled' : 'ready' }, prepaid: { words: mode.includes('prepaid') ? 2500 : 0, images: mode.includes('prepaid') ? 2 : 0, reservedWords: 0, reservedImages: 0 }, plan: free ? 'free' : 'pro', features: { imageTranslation: !mode.endsWith('disabled') }, limits: {} }; break;
          case 'billing:open': data = { opened: true }; break;
          case 'image:intent': data = { id: 'intent', srcUrl: 'https://fixture.test/image.png', sourceLanguage: 'auto', targetLanguage: 'Ukrainian', idempotencyKey: 'key', createdAt: Date.now(), ...(mode === 'resume' ? { jobId: 'existing-job' } : {}) }; break;
          case 'image:prepare': data = { dataUrl: png }; break;
          case 'image:asset': data = { dataUrl: request.payload.variant === 'translated' ? translatedPng : png }; break;
          case 'image:submit':
            if (mode === 'quota-error') return { ok: false, error: { code: 'IMAGE_QUOTA_EXCEEDED', message: 'Limit reached' } };
            submitted = true; cancelled = false; getCount = 0; data = { id: 'new-job', kind: 'image', status: 'queued' }; break;
          case 'image:get':
            getCount++;
            if (mode === 'network' && getCount === 1) return { ok: false, error: { code: 'NETWORK_ERROR', message: 'Offline' } };
            data = { id: submitted ? 'new-job' : 'existing-job', kind: 'image', status: cancelled ? 'cancelled' : mode === 'cancel' ? 'running' : 'completed' }; break;
          case 'image:cancel': cancelled = true; data = { id: 'new-job', kind: 'image', status: 'cancelled' }; break;
          case 'page:status': data = { sessionId: '', status: 'idle', total: 0, completed: 0, failed: 0 }; break;
          default: throw new Error(`Unmocked ${request.type}`);
        }
        return { ok: true, data };
      } }, storage: { session: { async get() { return {}; }, async set() {}, async remove() {} } }, tabs: { async query() { return []; } } };
    }, mode);
    const page = await context.newPage(); page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`https://ui.test/${pageName}.html?intent=intent`);
    return { context, page, requests: () => page.evaluate(() => globalThis.uiRequests) };
  }
  try {
    for (const mode of ['free-disabled', 'pro-disabled', 'signedout']) {
      const { context, page, requests } = await open(mode);
      await page.getByRole('heading', { name: mode.endsWith('disabled') ? 'Image translation unavailable' : 'Continue with Google', exact: true }).waitFor();
      assert.equal((await requests()).filter((request) => ['image:prepare', 'image:submit', 'image:asset'].includes(request.type)).length, 0, `${mode} must never fetch/upload image bytes`);
      if (mode.endsWith('disabled')) assert.equal(await page.locator('.plan-summary .plan-badge').textContent(), mode.startsWith('free') ? 'Free' : 'PRO', 'disabled feature does not change the actual plan badge');
      await context.close();
    }
    const freeImage = await open('free'); await freeImage.page.getByRole('button', { name: 'Download PNG' }).waitFor();
    assert.equal(await freeImage.page.locator('.plan-summary .plan-badge').textContent(), 'Free');
    assert.equal(await freeImage.page.locator('.plan-summary .plan-quota-count').textContent(), '5 / 5');
    assert.equal((await freeImage.requests()).filter((request) => request.type === 'image:submit').length, 1, 'Free image translation is enabled by the server feature flag');
    await freeImage.context.close();
    const freePopup = await open('free', 'popup'); await freePopup.page.getByText('Words this month', { exact: true }).waitFor();
    assert.equal(await freePopup.page.locator('.quota-block strong').textContent(), '1,234 / 10,000');
    assert.equal(await freePopup.page.locator('.plan-summary .plan-quota-count').textContent(), '5 / 5'); await freePopup.context.close();
    for (const mode of ['images-exhausted', 'quota-error']) {
      const { context, page, requests } = await open(mode);
      const monthlyMessage = 'Your monthly image allowance and purchased balance are used up. Buy a package or wait for the monthly reset at 00:00 UTC on the first day.';
      await page.getByText(monthlyMessage, { exact: true }).waitFor();
      if ((mode === 'images-exhausted' || mode.includes('prepaid'))) {
        assert.equal(await page.getByRole('button', { name: 'Translate', exact: true }).isDisabled(), true);
        assert.equal((await requests()).filter((request) => request.type === 'image:prepare' || request.type === 'image:submit').length, 0, 'exhausted monthly quota does not start work');
      }
      await context.close();
    }
    const custom = await open('custom-quota'); await custom.page.getByRole('button', { name: 'Download PNG' }).waitFor();
    assert.equal(await custom.page.locator('.plan-summary .plan-quota-count').textContent(), '17 / 17', 'image quota uses server values without a hardcoded daily/monthly limit'); await custom.context.close();
    const words = await open('words-exhausted', 'popup');
    await words.page.getByRole('textbox', { name: 'Type or paste your text…' }).fill('Hello');
    assert.equal(await words.page.locator('.translate-button').isDisabled(), true, 'monthly word exhaustion disables new translations');
    await words.page.getByText('Words this month', { exact: true }).waitFor();
    assert.equal(await words.page.locator('.quota-block strong').textContent(), '200,000 / 200,000');
    assert.match(await words.page.locator('.quota-reset').textContent(), /Nov.*1.*2026.*00:00.*UTC/);
    assert.equal(await words.page.locator('.text-card-bottom>span').textContent(), '5 / 4,000', 'batch input limit still counts characters');
    await words.context.close();
    const prepaidPopup = await open('free-prepaid', 'popup');
    await prepaidPopup.page.getByRole('textbox', { name: 'Type or paste your text…' }).fill('Hello');
    assert.equal(await prepaidPopup.page.locator('.translate-button').isDisabled(), false, 'prepaid words enable translation after the monthly allowance is exhausted');
    assert.match(await prepaidPopup.page.locator('.purchased-balance').textContent(), /2,500/);
    assert.equal(await prepaidPopup.page.locator('.plan-summary .plan-badge').textContent(), 'Free', 'buying a package does not grant Pro');
    assert.match(await prepaidPopup.page.locator('.available-total').textContent(), /2,500.*2/);
    await prepaidPopup.page.getByRole('button', { name: 'Buy a package', exact: true }).click();
    await prepaidPopup.page.getByRole('button', { name: 'My purchases', exact: true }).click();
    assert.deepEqual((await prepaidPopup.requests()).filter(request => request.type === 'billing:open').map(request => request.payload.page), ['pay', 'account']);
    const readsBefore = (await prepaidPopup.requests()).filter(request => request.type === 'account:get').length;
    await prepaidPopup.page.getByRole('button', { name: 'Refresh balance' }).click();
    assert.ok((await prepaidPopup.requests()).filter(request => request.type === 'account:get').length > readsBefore);
    await prepaidPopup.page.waitForTimeout(1600);
    const readsOnReturn = (await prepaidPopup.requests()).filter(request => request.type === 'account:get').length;
    await prepaidPopup.page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await prepaidPopup.page.waitForFunction(before => globalThis.uiRequests.filter(request => request.type === 'account:get').length > before, readsOnReturn);
    if (screenshotDirectory) await prepaidPopup.page.screenshot({ path: join(screenshotDirectory, 'popup-prepaid-en.png'), fullPage: true });
    await prepaidPopup.context.close();
    const prepaidImage = await open('free-prepaid');
    await prepaidImage.page.getByRole('button', { name: 'Download PNG' }).waitFor();
    assert.equal((await prepaidImage.requests()).filter(request => request.type === 'image:submit').length, 1, 'prepaid images enable work after monthly exhaustion');
    await prepaidImage.context.close();
    for (const mode of ['legacy', 'purchases-disabled', 'mismatched']) {
      const gated = await open(mode, 'popup');
      await gated.page.getByRole('button', { name: 'Buy a package', exact: true }).waitFor();
      assert.equal(await gated.page.getByRole('button', { name: 'Buy a package', exact: true }).isDisabled(), true, `${mode} cannot start a purchase`);
      assert.equal(await gated.page.getByRole('button', { name: 'My purchases', exact: true }).isDisabled(), mode !== 'purchases-disabled');
      await gated.page.getByRole('textbox', { name: 'Type or paste your text…' }).fill('Hello');
      assert.equal(await gated.page.locator('.translate-button').isDisabled(), false, 'translation remains available while billing is disabled');
      await gated.context.close();
    }
    const options = await open('pro', 'options'); await options.page.locator('#account .quota-block').waitFor();
    assert.equal(await options.page.locator('#account .quota-block strong').textContent(), '1,234 / 200,000');
    assert.equal(await options.page.locator('#account .plan-summary .plan-quota-count').textContent(), '150 / 150');
    await options.context.close();
    const { context, page, requests } = await open('pro');
    await page.getByRole('button', { name: 'Download PNG' }).waitFor();
    assert.equal(await page.locator('.image-panel img').count(), 2);
    assert.equal(await page.locator('.plan-summary .plan-quota-count').textContent(), '150 / 150');
    assert.match(await page.locator('.plan-summary').textContent(), /this month/);
    await page.waitForFunction(() => [...document.querySelectorAll('.image-panel img')].every((image) => image.complete && image.naturalWidth > 0));
    if (screenshotDirectory) await page.screenshot({ path: join(screenshotDirectory, 'image-en-light.png'), fullPage: true });
    assert.equal((await requests()).filter((request) => request.type === 'image:submit').length, 1);
    const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download PNG' }).click();
    assert.match((await download).suggestedFilename(), /\.png$/);
    await page.locator('.language-trigger').last().click(); await page.getByRole('combobox').fill('ja'); await page.getByRole('option', { name: /Japanese/ }).click();
    await page.getByRole('button', { name: 'Translate again', exact: true }).click();
    await page.getByRole('button', { name: 'Download PNG' }).waitFor();
    const submit = (await requests()).filter((request) => request.type === 'image:submit');
    assert.equal(submit.length, 2); assert.equal(submit.at(-1).payload.restart, true); assert.equal(submit.at(-1).payload.targetLanguage, 'Japanese');
    await context.close();
    for (const mode of ['resume', 'network', 'cancel']) {
      const { context, page, requests } = await open(mode);
      if (mode === 'network') { await page.getByRole('alert').waitFor(); await page.getByRole('button', { name: 'Refresh status', exact: true }).first().click(); }
      if (mode === 'cancel') { await page.getByRole('button', { name: 'Cancel translation', exact: true }).click(); await page.getByRole('status').filter({ hasText: 'Translation cancelled' }).waitFor(); }
      else await page.getByRole('button', { name: 'Download PNG' }).waitFor();
      assert.equal((await requests()).filter((request) => request.type === 'image:submit').length, mode === 'resume' ? 0 : 1, `${mode} does not resubmit existing work`);
      await context.close();
    }
    const dark = await open('pro-dark'); await dark.page.getByRole('button', { name: 'Завантажити PNG' }).waitFor(); assert.equal(await dark.page.locator('html').getAttribute('data-theme'), 'dark'); if (screenshotDirectory) await dark.page.screenshot({ path: join(screenshotDirectory, 'image-uk-dark.png'), fullPage: true }); await dark.context.close();
    const popup = await open('pro', 'popup');
    await popup.page.getByText('Words this month', { exact: true }).waitFor();
    assert.equal(await popup.page.locator('.quota-block strong').textContent(), '1,234 / 200,000');
    await popup.page.locator('.language-trigger').last().click();
    const bounds = await popup.page.locator('.language-menu').boundingBox();
    if (screenshotDirectory) await popup.page.screenshot({ path: join(screenshotDirectory, 'language-menu-en.png') });
    assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 420 && bounds.y + bounds.height <= 600, 'language menu fits Chrome popup viewport');
    await popup.page.getByRole('combobox').fill('Deutsch'); await popup.page.getByRole('combobox').press('Enter');
    await popup.page.waitForFunction(() => globalThis.uiRequests.some((request) => request.type === 'settings:set' && request.payload.targetLanguage === 'German'));
    await popup.context.close();
    assert.deepEqual(errors, [], 'actual UI bundles must not raise browser errors');
  } finally { await browser.close(); }
});
