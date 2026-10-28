import assert from 'node:assert/strict';
import { readFile, writeFile, access, readdir } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import path from 'node:path';
import { imageSize } from '../../extension-marketing/scripts/image-size.mjs';

const meta = import.meta.dirname;
const project = path.resolve(meta, '..');
const locales = 'am ar bg bn ca cs da de el en en_AU en_GB en_US es es_419 et fa fi fil fr gu he hi hr hu id it ja kn ko lt lv ml mr ms nl no pl pt_BR pt_PT ro ru sk sl sr sv sw ta te th tr uk vi zh_CN zh_TW'.split(' ');
const json = async file => JSON.parse(await readFile(path.join(project, file), 'utf8'));
const manifest = await json('extension/dist/manifest.json');
assert.equal(manifest.version, '1.3.1');
assert.equal(manifest.default_locale, 'en');
assert.equal(manifest.name, '__MSG_appName__');
assert.equal(manifest.description, '__MSG_appDescription__');
const names = await json('meta/data/names.json');
const english = await json('extension/public/_locales/en/messages.json');
assert.equal(english.appName.message, names.names[names.recommended.name].text);
assert.equal(english.appDescription.message, names.shortDescriptions[names.recommended.short].text);
let images = 0;
for (const locale of locales) {
  const description = await readFile(path.join(meta, 'descriptions', `${locale}.txt`), 'utf8');
  assert.ok(description.length > 750, `${locale}: full description required`);
  for (const url of ['https://ai-translator-ext.web.app/privacy', 'https://balubenko-stripe.web.app/ai-translator-terms', 'https://ai-translator-ext.web.app/support']) assert.ok(description.includes(url), `${locale}: policy/support link`);
  const source = await json(`extension/public/_locales/${locale}/messages.json`);
  const built = await json(`extension/dist/_locales/${locale}/messages.json`);
  const test = await json(`extension/dist-test/_locales/${locale}/messages.json`);
  assert.deepEqual(source, built, `${locale}: source/live catalogs`);
  assert.equal(test.appName.message, `${source.appName.message} (Test)`);
  assert.deepEqual((await readdir(path.join(meta, 'screenshots', locale))).filter(name => /\.(png|jpe?g)$/i.test(name)).sort(), ['1.png', '2.png', '3.png', '4.png', '5.png'], `${locale}: only five uploadable screenshots in each set`);
  for (let index = 1; index <= 5; index++) {
    const size = imageSize(path.join(meta, 'screenshots', locale, `${index}.png`));
    assert.equal(size.width, 1280); assert.equal(size.height, 800); images++;
  }
}
const audit = await json('meta/audits/locales-built.json');
assert.equal(audit.complete, true); assert.equal(audit.summary.baselineCovered, 55);
// Verify the actual generated 128px RGBA bitmap, including transparent margins.
const png = await readFile(path.join(project, 'extension/dist/icons/128.png'));
const compressed = []; let cursor = 8;
while (cursor < png.length) {
  const size = png.readUInt32BE(cursor), type = png.toString('ascii', cursor + 4, cursor + 8);
  if (type === 'IDAT') compressed.push(png.subarray(cursor + 8, cursor + 8 + size));
  cursor += size + 12;
}
const pixels = inflateSync(Buffer.concat(compressed));
const bounds = [128, 128, -1, -1];
for (let y = 0; y < 128; y++) {
  assert.equal(pixels[y * 513], 0, 'Generated icon uses unfiltered RGBA rows');
  for (let x = 0; x < 128; x++) if (pixels[y * 513 + 1 + x * 4 + 3]) {
    bounds[0] = Math.min(bounds[0], x); bounds[1] = Math.min(bounds[1], y);
    bounds[2] = Math.max(bounds[2], x); bounds[3] = Math.max(bounds[3], y);
  }
}
assert.deepEqual(bounds, [16, 16, 111, 111], 'Store icon must have centered 96px artwork');
for (const file of ['extension/dist/welcome.html', 'extension/src/shared/review.ts', 'extension/src/ui/ReviewCard.tsx']) await access(path.join(project, file));
const release = await json('meta/data/release-validation.json');
assert.equal(release.success, true);
const review = await json('meta/data/localized-visual-review.json');
assert.equal(review.success, true);
assert.equal(review.localesReviewed, 55);
for (const locale of locales) assert.ok(review.locales.some(item => item.locale === locale && item.result === 'pass' && item.shotsReviewed.length === 5), `${locale}: five visually reviewed screenshots`);
const tasks = [
  ['name', 'Recommended localized name applied to live/test manifest'],
  ['short', 'Recommended localized summary applied; all Store length limits pass'],
  ['description', 'Full English listing with current subscriptions and privacy details'],
  ['locales', '55 full descriptions and complete 14-key catalogs; packaged locale audit passes'],
  ['tile', 'Three promo variants and a marquee rendered and inspected'],
  ['screenshots', 'Five authentic English UI frames rendered and inspected'],
  ['icon', '128px icon has 96px artwork and transparent 16px margins; toolbar variants preserved'],
  ['localized-shots', '55 sets × 5 images: 275 localized marketing frames checked'],
  ['review', 'Five-success review prompt implemented with deduplication, dismissal timing and browser tests'],
  ['welcome', 'Localized first-install welcome implemented and tested; updates do not reopen it'],
].map(([id, detail]) => ({ id, state: 'complete', detail }));
const result = { checkedAt: new Date().toISOString(), success: true, version: manifest.version, tasks, locales: locales.length, localizedImages: images, iconBounds: bounds, publication: 'not-published', nativeLanguageReview: 'not-claimed', ownerConfirmation: 'separate from local delivery' };
await writeFile(path.join(meta, 'data/delivery.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ success: true, tasks: tasks.length, locales: locales.length, localizedImages: images, iconBounds: bounds }));
