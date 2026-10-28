// Localize editorial copy around the unchanged authentic English UI captures.
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const meta = import.meta.dirname;
const locales = 'am ar bg bn ca cs da de el en en_AU en_GB en_US es es_419 et fa fi fil fr gu he hi hr hu id it ja kn ko lt lv ml mr ms nl no pl pt_BR pt_PT ro ru sk sl sr sv sw ta te th tr uk vi zh_CN zh_TW'.split(' ');
const checkOnly = process.argv.includes('--check');
const selected = process.argv.slice(2).filter(value => !value.startsWith('--'));
const targets = selected.length ? locales.filter(locale => selected.includes(locale)) : locales;
const originals = JSON.parse(await readFile(path.join(meta, 'screenshots/jobs.json'), 'utf8'));
const browser = await chromium.launch({ headless: true });
const evidence = [];
const jobs = [];
try {
  let cursor = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    page.setDefaultTimeout(10000);
    while (cursor < targets.length) {
      const locale = targets[cursor++];
      const captions = JSON.parse(await readFile(path.join(meta, 'screenshots/captions', `${locale}.json`), 'utf8'));
      assert.equal(captions.length, 5, `${locale}: five captions required`);
      const directory = path.join(meta, 'screenshots', locale);
      await mkdir(path.join(directory, 'prompts'), { recursive: true });
      for (let index = 0; index < 5; index++) {
        const original = new URL(originals[index].url, pathToFileURL(path.dirname(meta) + '/'));
        const url = new URL(pathToFileURL(path.join(meta, 'screenshots/frame.html')));
        url.search = original.search;
        url.searchParams.set('cap', captions[index].cap);
        url.searchParams.set('desc', captions[index].desc);
        url.searchParams.set('lang', locale.replace('_', '-'));
        url.searchParams.set('dir', ['ar', 'fa', 'he'].includes(locale) ? 'rtl' : 'ltr');
        const out = path.join(directory, `${index + 1}.png`);
        await page.goto(url.href);
        await page.evaluate(async () => {
          await window.__renderReady;
          await Promise.all([...document.images].map(image => image.decode()));
        });
        const bounds = await page.evaluate(() => {
          const heading = document.querySelector('h1');
          const description = document.querySelector('.description');
          return {
            error: window.__renderError || null,
            caption: heading.textContent, description: description.textContent,
            captionLines: Math.round(heading.offsetHeight / parseFloat(getComputedStyle(heading).lineHeight)),
            direction: document.documentElement.dir,
            missingImages: [...document.images].filter(image => !image.naturalWidth).length,
          };
        });
        if (checkOnly) { evidence.push({ locale, shot: index + 1, ...bounds }); continue; }
        assert.equal(bounds.error, null, `${locale}/${index + 1}: ${bounds.error}`);
        assert.equal(bounds.missingImages, 0);
        await page.screenshot({ path: out });
        const relative = file => path.relative(path.dirname(meta), file).split(path.sep).join('/');
        jobs.push({ url: relative(path.join(meta, 'screenshots/frame.html')) + url.search, out: relative(out), width: 1280, height: 800 });
        evidence.push({ locale, shot: index + 1, ...bounds, width: 1280, height: 800, uiLanguage: 'en', translatedLayer: 'marketing caption and benefit only' });
        const prompt = `# ${locale} screenshot ${index + 1}\n\nUse the unchanged authentic English interface capture from ../../raw/. Localize only the surrounding editorial text.\n\nCaption: ${JSON.stringify(captions[index].cap)}\n\nBenefit: ${JSON.stringify(captions[index].desc)}\n\nRender exactly 1280×800 with the existing Soft Flat frame, local fonts and original brand icon. Preserve UI text, controls, proportions and colors. Direction: ${bounds.direction}. No invented UI or claims.\n`;
        await writeFile(path.join(directory, 'prompts', `${index + 1}.md`), prompt);
      }
      console.log(`Rendered ${locale}: 5 localized screenshots.`);
    }
    await page.close();
  }));
} finally { await browser.close(); }
if (checkOnly) {
  const errors = evidence.filter(item => item.error);
  console.log(JSON.stringify({ checked: evidence.length, errors }, null, 2));
  assert.equal(errors.length, 0, 'Localized screenshot caption preflight');
  process.exit(0);
}
await writeFile(path.join(meta, 'screenshots/localized-jobs.json'), JSON.stringify(jobs, null, 2) + '\n');
await writeFile(path.join(meta, 'data/localized-screenshots-validation.json'), JSON.stringify({ checkedAt: new Date().toISOString(), success: true, locales: targets.length, images: evidence.length, captures: evidence }, null, 2) + '\n');
