import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

test('packaged welcome entry uses locale messages, local fonts, responsive themes and preferences action', async () => {
  const bundle = await build({ entryPoints: ['src/ui/welcome.tsx'], bundle: true, format: 'iife', platform: 'browser', write: false, outdir: '/welcome-test', external: ['/fonts/*'], define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' } });
  const assets = new Map(bundle.outputFiles.map(file => [basename(file.path), file.text]));
  const original = await readFile(new URL('../welcome.html', import.meta.url), 'utf8');
  const html = original.replace('</head>', '<link rel="stylesheet" href="/welcome.css"></head>')
    .replace('<script type="module" src="/src/ui/welcome.tsx"></script>', '<script src="/welcome.js"></script>');
  const browser = await chromium.launch({ headless: true }); const errors = []; const remote = [];
  try {
    for (const locale of ['en', 'ar']) {
      const context = await browser.newContext({ viewport: { width: 720, height: 1000 } });
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== 'https://welcome.test') { remote.push(url.href); return route.abort(); }
        const name = url.pathname.slice(1);
        if (assets.has(name)) return route.fulfill({ contentType: name.endsWith('.css') ? 'text/css' : 'application/javascript', body: assets.get(name) });
        if (/^fonts\/[\w.-]+\.woff2$/.test(name)) return route.fulfill({ contentType: 'font/woff2', body: await readFile(new URL(`../public/${name}`, import.meta.url)) });
        return route.fulfill({ contentType: 'text/html', body: html });
      });
      await context.addInitScript(({ locale }) => {
        globalThis.preferencesOpened = 0;
        globalThis.chrome = {
          i18n: { getUILanguage: () => locale, getMessage: key => key === 'welcomeTitle' ? (locale === 'ar' ? 'مرحبًا بك في AI Translator' : 'Welcome to AI Translator') : '' },
          runtime: { id: 'welcome-fixture', async openOptionsPage() { globalThis.preferencesOpened++; } },
        };
      }, { locale });
      const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
      await page.goto('https://welcome.test/welcome.html');
      await page.getByRole('heading', { name: locale === 'ar' ? 'مرحبًا بك في AI Translator' : 'Welcome to AI Translator', exact: true }).waitFor();
      assert.equal(await page.locator('html').getAttribute('dir'), locale === 'ar' ? 'rtl' : 'ltr');
      assert.equal(await page.locator('.welcome-steps li').count(), 3);
      assert.match(await page.locator('.welcome-allowance').textContent(), /100,000.*4,000.*2,000,000.*50,000.*4\.99.*39\.99/);
      const privacy = page.getByRole('link', { name: 'Read the privacy policy' });
      assert.equal(await privacy.getAttribute('href'), 'https://ai-translator-ext.web.app/privacy');
      await page.getByRole('button', { name: 'Open preferences', exact: true }).click();
      assert.equal(await page.evaluate(() => globalThis.preferencesOpened), 1);
      for (const colorScheme of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
        await page.waitForFunction(expected => document.documentElement.dataset.theme === expected, colorScheme);
        for (const width of [320, 720, 1200]) {
          await page.setViewportSize({ width, height: 1000 });
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${locale}/${colorScheme}/${width}: welcome has no horizontal overflow`);
        }
      }
      await context.close();
    }
    assert.deepEqual(errors, []); assert.deepEqual(remote, [], 'Welcome must not load remote scripts, fonts or tracking');
  } finally { await browser.close(); }
});
