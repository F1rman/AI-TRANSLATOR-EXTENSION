// Explicitly apply the reviewed marketing catalogs to packaged source assets.
// Builds consume extension/public, never the local marketing workspace.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const locales = 'am ar bg bn ca cs da de el en en_AU en_GB en_US es es_419 et fa fi fil fr gu he hi hr hu id it ja kn ko lt lv ml mr ms nl no pl pt_BR pt_PT ro ru sk sl sr sv sw ta te th tr uk vi zh_CN zh_TW'.split(' ');
const source = path.join(root, 'meta/locales');
const english = JSON.parse(await readFile(path.join(source, 'en/messages.json'), 'utf8'));
const required = Object.keys(english).sort();
const catalogs = await Promise.all(locales.map(async locale => {
  const catalog = JSON.parse(await readFile(path.join(source, locale, 'messages.json'), 'utf8'));
  for (const entry of Object.values(catalog)) {
    // Prices are literal dollars, not Chrome's $1...$9 substitutions. Existing
    // escaped dollars and named placeholders remain intact on repeated runs.
    entry.message = entry.message.replace(/\$\$|\$[A-Za-z_][A-Za-z0-9_@]*\$|\$/g, token => token.length > 1 ? token : '$$');
  }
  assert.deepEqual(Object.keys(catalog).sort(), required, `${locale}: catalog keys`);
  for (const [key, value] of Object.entries(catalog)) assert.ok(typeof value.message === 'string' && value.message.trim(), `${locale}/${key}: empty translation`);
  assert.ok([...catalog.appName.message].length <= 68, `${locale}: leave room for the test build suffix`);
  assert.ok([...catalog.appDescription.message].length <= 132, `${locale}: summary exceeds Store limit`);
  return { locale, catalog };
}));
for (const { locale, catalog } of catalogs) {
  await writeFile(path.join(source, locale, 'messages.json'), JSON.stringify(catalog, null, 2) + '\n');
  const target = path.join(root, 'extension/public/_locales', locale);
  await mkdir(target, { recursive: true });
  await writeFile(path.join(target, 'messages.json'), JSON.stringify(catalog, null, 2) + '\n');
}
console.log(`Applied ${catalogs.length} complete listing, review and welcome catalogs to extension source.`);
