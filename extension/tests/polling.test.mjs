import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const code = (await build({
  entryPoints: [fileURLToPath(new URL('../src/shared/polling.ts', import.meta.url))],
  bundle: true, format: 'esm', platform: 'browser', target: 'chrome120', write: false,
})).outputFiles[0].text;
const { pollingDelay, pollTranslationJob, pause } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const short = [{ id: 'text', text: 'Hello world' }];
const queued = { id: 'job-one', status: 'queued' };
const error = (code) => Object.assign(new Error(code), { code });
function fakeClock() {
  let value = 0;
  const delays = [];
  return { now: () => value, delays, sleep: async (ms) => { assert.ok(ms >= 0); delays.push(ms); value += ms; } };
}

test('single short segments use fast polling, Unicode codepoint limits and a slower interval after ten seconds', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 10].map((attempt) => pollingDelay(short, attempt, 0)), [250, 500, 750, 1000, 1000, 1000]);
  assert.equal(pollingDelay(short, 0, 9999), 250);
  assert.equal(pollingDelay(short, 0, 10_000), 1500);
  assert.equal(pollingDelay([{ id: 'one', text: '😀'.repeat(500) }], 0, 0), 250);
  assert.equal(pollingDelay([{ id: 'one', text: '😀'.repeat(501) }], 0, 0), 1400);
  assert.equal(pollingDelay([...short, { id: 'other', text: 'Hi' }], 0, 0), 1400);
});

test('popup and selection polling return the same completed durable job without resubmitting it', async () => {
  const clock = fakeClock(), seen = [];
  const responses = [{ ...queued, status: 'running' }, { ...queued, status: 'running' }, { ...queued, status: 'completed', translations: [{ id: 'text', text: 'Привіт' }] }];
  const result = await pollTranslationJob(queued, async (id) => { seen.push(id); return responses.shift(); }, { segments: short, deadline: 30_000, ...clock });
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.translations, [{ id: 'text', text: 'Привіт' }]);
  assert.deepEqual(seen, ['job-one', 'job-one', 'job-one']);
  assert.deepEqual(clock.delays, [250, 500, 750]);
});

test('already terminal jobs return immediately without another network call or delay', async () => {
  for (const status of ['completed', 'failed', 'cancelled']) {
    const initial = { ...queued, status };
    assert.equal(await pollTranslationJob(initial, () => assert.fail('No GET for a terminal job'), {
      segments: short, deadline: 0, now: () => 0, sleep: () => assert.fail('No sleep for a terminal job'),
    }), initial);
  }
});

test('temporary network loss retries the same job and recovers without losing its result', async () => {
  const clock = fakeClock(); let calls = 0;
  const result = await pollTranslationJob(queued, async (id) => {
    assert.equal(id, 'job-one');
    if (++calls < 3) throw error(calls === 1 ? 'NETWORK_ERROR' : 'HTTP_503');
    return { ...queued, status: 'completed' };
  }, { segments: short, deadline: 60_000, ...clock });
  assert.equal(result.status, 'completed');
  assert.equal(calls, 3);
  assert.ok(clock.delays.some((ms) => ms >= 1000), 'transient errors back off');
});

test('authentication and quota failures return immediately without retrying', async () => {
  for (const code of ['AUTH_REQUIRED', 'QUOTA_EXCEEDED', 'JOB_NOT_FOUND']) {
    const clock = fakeClock(); let calls = 0;
    await assert.rejects(pollTranslationJob(queued, async () => { calls++; throw error(code); }, {
      segments: short, deadline: 60_000, ...clock,
    }), (reason) => reason.code === code);
    assert.equal(calls, 1);
  }
});

test('repeated transient errors have a bounded retry count', async () => {
  const clock = fakeClock(); let calls = 0;
  await assert.rejects(pollTranslationJob(queued, async () => { calls++; throw error('NETWORK_ERROR'); }, {
    segments: short, deadline: 300_000, ...clock,
  }), (reason) => reason.code === 'NETWORK_ERROR');
  assert.equal(calls, 5);
});

test('a pending translation eventually reaches its deadline', async () => {
  const clock = fakeClock(); let calls = 0;
  await assert.rejects(pollTranslationJob(queued, async () => { calls++; return { ...queued, status: 'running' }; }, {
    segments: short, deadline: 500, ...clock,
  }), (reason) => reason.code === 'UPSTREAM_TIMEOUT');
  assert.ok(calls <= 2);
  assert.equal(clock.now(), 500);
});

test('cancellation before polling or during a GET discards stale completed results', async () => {
  const before = new AbortController(); before.abort();
  await assert.rejects(pollTranslationJob(queued, () => assert.fail('Cancelled polling must not GET'), {
    segments: short, deadline: Date.now() + 1000, signal: before.signal,
  }), { name: 'AbortError' });
  const during = new AbortController(), clock = fakeClock();
  await assert.rejects(pollTranslationJob(queued, async () => {
    during.abort(); return { ...queued, status: 'completed' };
  }, { segments: short, deadline: 1000, signal: during.signal, ...clock }), { name: 'AbortError' });
});

test('pause responds to cancellation rather than waiting for its timeout', async () => {
  const controller = new AbortController();
  const pending = pause(60_000, controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});
