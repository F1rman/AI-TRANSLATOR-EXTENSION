import { chromium } from 'playwright';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const meta = import.meta.dirname;
const selected = process.argv.slice(2);
const locales = (await readdir(path.join(meta, 'screenshots/captions'))).filter(name => name.endsWith('.json')).map(name => name.slice(0, -5)).filter(locale => !selected.length || selected.includes(locale)).sort();
const browser = await chromium.launch({ headless: true });
try {
  const inspection = path.join(meta, 'screenshots/inspection');
  await mkdir(inspection, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1296 }, deviceScaleFactor: 1 });
  for (const locale of locales) {
    const cards = [1, 2, 3, 4, 5].map(index => `<article><div>${locale} · ${index}</div><img src="../${locale}/${index}.png" alt="Localized screenshot ${index}"></article>`).join('');
    const source = `<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;display:grid;grid-template-columns:640px 640px;background:#edf1f5;font:14px system-ui;color:#171a1d}article{margin:0;width:640px;height:432px}article div{height:32px;padding:6px 12px}img{display:block;width:640px;height:400px}</style></head><body>${cards}</body></html>`;
    await writeFile(path.join(inspection, `${locale}.html`), source);
    await page.goto(pathToFileURL(path.join(inspection, `${locale}.html`)).href);
    await page.evaluate(() => Promise.all([...document.images].map(image => image.decode())));
    await page.screenshot({ path: path.join(inspection, `${locale}.png`) });
  }
  console.log(`Rendered ${locales.length} half-size inspection sheets (five screenshots per sheet).`);
} finally { await browser.close(); }
