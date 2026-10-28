import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['src/shared/review.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { createReviewStore, REVIEW_DELAY_MS } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const storage = () => {
  const values = {};
  return { values, async get(key) { return { [key]: structuredClone(values[key]) }; }, async set(next) { Object.assign(values, structuredClone(next)); } };
};
const job = (id, status = 'completed') => ({ id, status, translations: [{ id: 'text', text: 'PRIVATE_TRANSLATION' }] });

test('review counts confirmed unique jobs once under concurrent POST and polling retries', async () => {
  const local = storage(); const store = createReviewStore(local, 'live');
  for (const status of ['queued', 'running', 'failed', 'cancelled']) await store.recordSuccess(job(status, status));
  await store.recordSuccess({ id: 'empty', status: 'completed', translations: [] });
  await store.recordSuccess({ id: 'missing', status: 'completed' });
  assert.equal((await store.status()).eligible, false);
  await Promise.all(Array.from({ length: 40 }, (_, index) => store.recordSuccess(job(`job-${index % 4}`))));
  assert.equal((await store.status()).eligible, false, 'four completed jobs are not enough');
  await Promise.all(Array.from({ length: 10 }, () => store.recordSuccess(job('job-five'))));
  assert.equal((await store.status()).eligible, true);
  const stored = local.values['translationReviewV1:live'];
  assert.equal(stored.successes, 5); assert.equal(stored.completedJobIds.length, 5);
  assert.doesNotMatch(JSON.stringify(local.values), /PRIVATE_TRANSLATION/);
  await store.recordSuccess(job('six'));
  assert.equal(local.values['translationReviewV1:live'].completedJobIds.length, 5, 'storage stops growing at the threshold');
  assert.equal((await createReviewStore(local, 'live').status()).eligible, true, 'worker restarts preserve eligibility');
  assert.equal((await createReviewStore(local, 'test').status()).eligible, false, 'test usage does not make live review eligible');
});

test('first dismissal delays exactly fourteen days; second dismissal is permanent', async () => {
  let time = 1000; const local = storage(); const store = createReviewStore(local, 'live', () => time);
  for (let i = 0; i < 5; i++) await store.recordSuccess(job(String(i)));
  await store.dismiss(); assert.equal((await store.status()).eligible, false);
  time += REVIEW_DELAY_MS - 1; assert.equal((await store.status()).eligible, false);
  time++; assert.equal((await store.status()).eligible, true);
  await store.dismiss(); time += REVIEW_DELAY_MS * 100;
  await store.recordSuccess(job('later-success'));
  assert.equal((await store.status()).eligible, false);
  assert.equal(local.values['translationReviewV1:live'].state, 'done');
});

test('rating finishes review prompts and a storage error does not poison later operations', async () => {
  const local = storage(); let fail = true;
  const store = createReviewStore({ ...local, async set(next) { if (fail) { fail = false; throw new Error('Unavailable storage'); } await local.set(next); } }, 'live');
  await assert.rejects(store.recordSuccess(job('first')), /Unavailable storage/);
  for (let i = 0; i < 5; i++) await store.recordSuccess(job(String(i)));
  assert.equal((await store.status()).eligible, true);
  await store.done(); await store.recordSuccess(job('more'));
  assert.equal((await createReviewStore(local, 'live').status()).eligible, false);
});
