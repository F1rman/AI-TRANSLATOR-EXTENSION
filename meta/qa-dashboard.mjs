import { chromium } from 'playwright';
import { readFile, writeFile, access } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const meta = import.meta.dirname;
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.setDefaultTimeout(5000);
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: async text => { window.__copied = text; } },
  }));
  await page.goto(pathToFileURL(path.join(meta, 'index.html')).href + '#tasks');
  const expected = ['name', 'short', 'description', 'locales', 'tile', 'screenshots', 'icon', 'localized-shots', 'review', 'welcome'];
  assert.deepEqual(await page.locator('.trow').evaluateAll(rows => rows.map(r => r.dataset.row)), expected);
  const tabs = await page.locator('header nav a').evaluateAll(links => links.map(a => ({ hash: a.getAttribute('href'), text: a.textContent })));
  assert.equal(tabs.length, 7);
  for (const { hash } of tabs) {
    await page.locator(`header nav a[href="${hash}"]`).click();
    await page.locator(`section[data-tab="${hash.slice(1)}"].on`).waitFor({ state: 'visible' });
    assert.equal(await page.locator('section[data-tab].on').count(), 1);
  }
  const imageUrls = await page.locator('img').evaluateAll(imgs => [...new Set(imgs.map(img => img.src))]);
  for (const url of imageUrls) {
    assert.ok(url.startsWith('file:'));
    await access(fileURLToPath(url));
  }
  await page.locator('header nav a[href="#listing"]').click();
  await page.locator('#part-listing-name button.copy').first().click();
  const names = JSON.parse(await readFile(path.join(meta, 'data/names.json'), 'utf8'));
  assert.equal(await page.evaluate(() => window.__copied), names.names[names.recommended.name].text);
  const source = await readFile(path.join(meta, 'descriptions/en.txt'), 'utf8');
  assert.ok((await page.locator('[data-locale-view] pre').textContent()) === source, 'Description must exactly match source');
  await page.locator('[data-locale-filter]').fill('en');
  await page.locator('[data-locale-code="en"]').click();
  assert.equal(await page.locator('[data-locale-view] pre').textContent(), source, 'English locale selection retains exact description');
  await page.locator('[data-locale-filter]').fill('');
  await page.locator('header nav a[href="#images"]').click();
  const zoom = page.locator('section[data-tab="images"] a[data-zoom]').first();
  await zoom.click();
  await page.locator('dialog[open]').waitFor();
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => !!document.activeElement.closest('dialog')), true, 'Image preview traps keyboard focus');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('dialog[open]').count(), 0);
  assert.equal(await zoom.evaluate(element => element === document.activeElement), true, 'Closing image preview restores focus');
  await page.locator('header nav a[href="#tasks"]').click();
  // Click the visible label, as an owner would; its decorative span covers the input.
  await page.locator('[data-row="description"] label.tick').click();
  assert.equal(await page.locator('input[data-t="description"]').isChecked(), true);
  await page.reload();
  assert.equal(await page.locator('input[data-t="description"]').isChecked(), true);
  await page.locator('[data-row="description"] label.tick').click();
  assert.equal(await page.locator('input[data-t="description"]').isChecked(), false);
  const layouts = [];
  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    for (const width of [320, 390, 430, 1440]) {
      await page.setViewportSize({ width, height: 1100 });
      for (const { hash } of tabs) {
        await page.locator(`header nav a[href="${hash}"]`).click();
        await page.evaluate(async () => {
          await document.fonts.ready;
          await Promise.all([...document.images].filter(image => image.getClientRects().length).map(async image => {
            image.loading = 'eager';
            let timer;
            try { await Promise.race([image.decode(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Image decode timed out: ' + image.src)), 5000); })]); }
            finally { clearTimeout(timer); }
          }));
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        });
        const layout = await page.evaluate(() => ({
          overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > document.documentElement.clientWidth + 1,
          background: getComputedStyle(document.documentElement).getPropertyValue('--app-background').trim(),
          missingImages: [...document.images].filter(image => image.getClientRects().length && !image.naturalWidth).map(image => image.src),
          fonts: [...document.fonts].filter(font => /Manrope|Rubik/.test(font.family)).map(font => ({ family: font.family, status: font.status })),
        }));
        assert.equal(layout.overflow, false, `${colorScheme}/${width}/${hash}: no page overflow`);
        assert.deepEqual(layout.missingImages, []);
        assert.equal(layout.background, colorScheme === 'light' ? '#f3f6f9' : '#08141e');
        for (const family of ['Manrope', 'Rubik']) assert.ok(layout.fonts.some(font => font.family.includes(family) && font.status === 'loaded'), `${family} loaded`);
        layouts.push({ colorScheme, width, hash, ...layout });
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.locator('header nav a[href="#tasks"]').click();
  const currentData = await page.locator('#site-data').textContent().then(JSON.parse);
  assert.ok(currentData.projectId, 'Dashboard progress uses a stable project ID');
  const warnings = await page.locator('.data-warnings li').allTextContents();
  assert.ok(warnings.every(warning => warning.startsWith('Locale audit:')), `Only known package localization gaps remain: ${warnings.join('; ')}`);
  assert.equal(errors.length, 0);
  const result = {
    checkedAt: new Date().toISOString(), success: true, tasks: expected.length,
    tabs, localImages: imageUrls.length, copyPayloadChecked: true,
    clipboardTransport: 'stubbed in disposable QA browser', englishDescriptionChecked: true,
    manualTaskPersistenceChecked: true, localeSelectionChecked: true,
    imageDialogFocusAndEscapeChecked: true, responsiveLayoutsChecked: layouts.length,
    packageWarnings: warnings, projectId: currentData.projectId, errors,
  };
  await writeFile(path.join(meta, 'data/dashboard-validation.json'), JSON.stringify(result, null, 2) + '\n');
  await writeFile(path.join(meta, 'data/dashboard-responsive-validation.json'), JSON.stringify({ checkedAt: result.checkedAt, success: true, layouts }, null, 2) + '\n');
  console.log(JSON.stringify({ success: true, tasks: expected.length, tabs: tabs.length, localImages: imageUrls.length, responsiveLayouts: layouts.length, errors }));
} finally {
  await browser.close();
}
