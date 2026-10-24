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
  await page.locator('header nav a[href="#tasks"]').click();
  // Click the visible label, as an owner would; its decorative span covers the input.
  await page.locator('[data-row="description"] label.tick').click();
  assert.equal(await page.locator('input[data-t="description"]').isChecked(), true);
  await page.reload();
  assert.equal(await page.locator('input[data-t="description"]').isChecked(), true);
  await page.locator('[data-row="description"] label.tick').click();
  assert.equal(await page.locator('input[data-t="description"]').isChecked(), false);
  assert.equal(errors.length, 0);
  const result = {
    checkedAt: new Date().toISOString(), success: true, tasks: expected.length,
    tabs, localImages: imageUrls.length, copyPayloadChecked: true,
    clipboardTransport: 'stubbed in disposable QA browser', englishDescriptionChecked: true,
    manualTaskPersistenceChecked: true, errors,
  };
  await writeFile(path.join(meta, 'data/dashboard-validation.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ success: true, tasks: expected.length, tabs: tabs.length, localImages: imageUrls.length, errors }));
} finally {
  await browser.close();
}
