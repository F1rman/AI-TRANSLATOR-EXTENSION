import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const jobs = JSON.parse(await readFile(path.join(import.meta.dirname, 'render-jobs.json'), 'utf8'));
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  const results = await Promise.all(jobs.map(async job => {
    const page = await browser.newPage({ viewport: { width: job.width, height: job.height } });
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(new URL(job.url, pathToFileURL(`${root}/`)).href);
    await page.evaluate(() => document.fonts.ready);
    const result = await page.evaluate(() => {
      const title = document.querySelector('h1');
      const rect = title?.getBoundingClientRect();
      const css = title && getComputedStyle(title);
      return {
        title: title?.textContent,
        fontSize: css && parseFloat(css.fontSize),
        lines: css && Math.round(rect.height / parseFloat(css.lineHeight)),
        titleWithinCanvas: !rect || (rect.x >= 0 && rect.right <= innerWidth && rect.y >= 0 && rect.bottom <= innerHeight),
        missingImages: [...document.images].filter(img => !img.complete || img.naturalWidth === 0).map(img => img.src),
      };
    });
    assert.equal(result.missingImages.length, 0, job.out);
    assert.ok(result.titleWithinCanvas, job.out);
    if (job.out.includes('/promo/')) assert.ok(result.fontSize >= 40, job.out);
    if (job.out.includes('/screenshots/')) {
      const words = result.title.trim().split(/\s+/).length;
      assert.ok(words >= 3 && words <= 6, `${job.out}: ${words} words`);
      assert.ok(result.lines <= 2, job.out);
    }
    await page.close();
    return { file: job.out, ...result };
  }));
  assert.equal(errors.length, 0);
  await writeFile(path.join(import.meta.dirname, 'data/layout-validation.json'), JSON.stringify({ checkedAt: new Date().toISOString(), success: true, results, errors }, null, 2) + '\n');
  console.log(JSON.stringify({ success: true, layouts: results.length, errors }));
} finally {
  await browser.close();
}
