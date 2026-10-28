import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

test('all packaged locales preserve complete keys, Store lengths and literal price dollars', async () => {
  const base = new URL('../public/_locales/', import.meta.url);
  const locales = await readdir(base);
  assert.equal(locales.length, 55);
  const english = JSON.parse(await readFile(new URL('en/messages.json', base), 'utf8'));
  for (const locale of locales) {
    const catalog = JSON.parse(await readFile(new URL(`${locale}/messages.json`, base), 'utf8'));
    assert.deepEqual(Object.keys(catalog).sort(), Object.keys(english).sort(), `${locale}: complete catalog`);
    assert.ok([...catalog.appName.message].length <= 68, `${locale}: test name suffix must fit`);
    assert.ok([...catalog.appDescription.message].length <= 132, `${locale}: summary length`);
    for (const [key, value] of Object.entries(catalog)) {
      assert.ok(value.message.trim(), `${locale}/${key}: nonempty`);
      // Chrome consumes raw $1...$9 as substitutions, including the $4 in $4.99.
      assert.doesNotMatch(value.message.replace(/\$\$/g, ''), /\$\d/, `${locale}/${key}: escape literal dollars`);
    }
  }
  assert.match(english.welcomeAllowance.message, /\$\$4\.99/);
  assert.match(english.welcomeAllowance.message, /\$\$39\.99/);
});
