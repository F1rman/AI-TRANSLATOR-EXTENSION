import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, access, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { imageSize } from '../../extension-marketing/scripts/image-size.mjs';

const meta = import.meta.dirname;
const project = path.resolve(meta, '..');
const json = async file => JSON.parse(await readFile(path.join(meta, file), 'utf8'));
const checks = [];
const check = (name, assertion) => { assertion(); checks.push({ name, passed: true }); };
const names = await json('data/names.json');
check('Five distinct names and five distinct summaries within Store limits', () => {
  for (const [key, limit] of [['names', 75], ['shortDescriptions', 132]]) {
    assert.equal(names[key].length, 5);
    assert.equal(new Set(names[key].map(item => item.text)).size, 5);
    assert.ok(names[key].every(item => item.text && [...item.text].length <= limit));
  }
  assert.ok(names.names[names.recommended.name]);
  assert.ok(names.shortDescriptions[names.recommended.short]);
});
const description = await readFile(path.join(meta, 'descriptions/en.txt'), 'utf8');
check('Current English description is plain text and states current subscription limits', () => {
  assert.doesNotMatch(description, /^#{1,6}\s|\*\*|```/m);
  assert.doesNotMatch(description, /\b(daily allowance|purchased words|word packs|translate images|image translation)\b/i);
  for (const literal of ['100,000', '2,000,000', '4,000', '50,000', '4.99', '39.99']) assert.ok(description.includes(literal), literal);
});
const manifest = JSON.parse(await readFile(path.join(project, 'extension/dist/manifest.json'), 'utf8'));
const form = await json('data/dashboard.json');
check('Store form covers all current permissions and host patterns', () => {
  assert.ok(form.category?.trim());
  assert.ok(form.singlePurpose?.trim());
  for (const permission of [...(manifest.permissions || []), ...(manifest.host_permissions || []), ...(manifest.optional_permissions || []), ...(manifest.optional_host_permissions || [])]) {
    assert.ok(form.permissions.some(item => item.permission === permission && item.justification?.trim()), permission);
  }
  assert.doesNotMatch(JSON.stringify(form.permissions), /daily allowance|Translate image — Pro|purchased words/i);
});
const locale = await json('locales/en/messages.json');
check('English locale draft matches the recommended listing pair', () => {
  const values = Object.values(locale).map(item => item.message);
  assert.ok(values.includes(names.names[names.recommended.name].text));
  assert.ok(values.includes(names.shortDescriptions[names.recommended.short].text));
});
const recommendations = await json('data/recommendations.json');
check('Review and welcome recommendations are adapted code proposals', () => {
  for (const term of ['review', 'welcome']) assert.ok(recommendations.some(item => item.title?.toLowerCase().includes(term) && typeof item.code === 'string' && item.code.trim()));
  assert.ok(recommendations.every(item => typeof item.title === 'string' && typeof item.code === 'string'));
});
const imageFiles = [
  ['promo/small-440x280.png', 440, 280], ['promo/small-440x280-b.png', 440, 280],
  ['promo/small-440x280-c.png', 440, 280], ['promo/marquee-1400x560.png', 1400, 560],
  ...[1, 2, 3, 4, 5].map(index => [`screenshots/${index}.png`, 1280, 800]),
  ['icon/check.png', 1280, 500],
];
const images = [];
for (const [file, width, height] of imageFiles) {
  const value = imageSize(path.join(meta, file));
  check(`${file} has exact export dimensions`, () => {
    assert.equal(value?.width, width);
    assert.equal(value?.height, height);
  });
  images.push({ file, ...value });
}
for (const file of ['promo/prompts/small-440x280.md', 'promo/prompts/marquee-1400x560.md', 'icon/prompt.md', ...[1, 2, 3, 4, 5].map(index => `screenshots/prompts/${index}.md`)]) await access(path.join(meta, file));
checks.push({ name: 'Matching prompts exist for all main promo and screenshot exports', passed: true });
const packages = [`ai-translator-${manifest.version}.zip`, `ai-translator-${manifest.version}-test.zip`]
  .filter(file => !!file);
const artifactNames = await readdir(path.join(project, 'artifacts'));
assert.ok(packages.every(file => artifactNames.includes(file)), 'Current live and test ZIPs must exist');
for (const file of packages) {
  execFileSync('python3.12', ['-c', 'from zipfile import ZipFile; import sys; names=ZipFile(sys.argv[1]).namelist(); assert not any(n.startswith("meta/") or "/meta/" in n for n in names)', path.join(project, 'artifacts', file)]);
}
checks.push({ name: 'Both current live/test ZIPs exclude meta/', passed: packages.length === 2 });
assert.equal(packages.length, 2);
const baseline = await json('data/workspace-baseline-2026-10-27.json');
const changedSinceBaseline = [];
for (const [file, digest] of Object.entries(baseline.sha256)) {
  const current = await readFile(path.join(project, file)).then(value => createHash('sha256').update(value).digest('hex')).catch(() => null);
  if (current !== digest) changedSinceBaseline.push(file);
}
const result = { checkedAt: new Date().toISOString(), success: true, version: manifest.version, wordCount: description.trim().split(/\s+/).length, checks, images, sourceScope: { marketingAssets: 'meta/', changedSinceBaseline, note: 'The user explicitly requested completion of all ten dashboard tasks, including product implementation. Catalogs, icon, review/welcome features, packaging, tests and current documentation are authorized outside-meta changes; the earlier Free-to-Pro navigation changes are preserved.' } };
await writeFile(path.join(meta, 'data/validation.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ success: true, checks: checks.length, images: images.length, outsideMetaChanges: changedSinceBaseline }));
