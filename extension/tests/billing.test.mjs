import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { buildConfig, selectedEnvironment } from '../scripts/build-config.mjs';

const code = (await build({
  entryPoints: ['src/shared/billing.ts'], bundle: true, format: 'esm', platform: 'browser', write: false,
  define: { 'import.meta.env': JSON.stringify({ VITE_BILLING_BASE_URL: 'https://balubenko-stripe.web.app' }) },
})).outputFiles[0].text;
const { billingPage, billingAvailability, fetchCentralBillingConfig } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const live = { environment: 'live', apiBase: 'https://ai-translator-api-1060412514800.europe-west1.run.app', billingBase: 'https://balubenko-stripe.web.app', authProjectId: 'ai-translator-ext' };
const account = { billing: { environment: 'live', purchasesEnabled: true } };
const central = { environment: 'live', authProjectId: 'ai-translator-ext', firebaseConfig: { projectId: 'ai-translator-ext' } };

test('purchase and history links use a fixed product without credentials or redirects', () => {
  assert.equal(billingPage('pay'), 'https://balubenko-stripe.web.app/pay?product=ai-translator-extension');
  assert.equal(billingPage('account'), 'https://balubenko-stripe.web.app/account?product=ai-translator-extension');
  assert.equal(billingPage('pay', 'https://balubenko-stripe-test.web.app'), 'https://balubenko-stripe-test.web.app/pay?product=ai-translator-extension');
  for (const value of ['http://example.com', 'javascript:alert(1)', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com?token=private', 'https://example.com#private']) {
    assert.throws(() => billingPage('pay', value));
  }
});

test('purchases require matching build, API, identity and billing configuration', () => {
  assert.deepEqual(billingAvailability(account, central, live), { environment: 'live', canPurchase: true, canViewPurchases: true, reason: 'ready' });
  assert.equal(billingAvailability({}, central, live).canPurchase, false, 'legacy API has no purchase authority');
  assert.equal(billingAvailability(account, undefined, live).canPurchase, false, 'network/config failure disables purchases');
  assert.deepEqual(billingAvailability({ billing: { environment: 'live', purchasesEnabled: false } }, central, live), { environment: 'live', canPurchase: false, canViewPurchases: true, reason: 'disabled' });
  for (const [a, c, b] of [
    [{ billing: { environment: 'test', purchasesEnabled: true } }, central, live],
    [account, { ...central, environment: 'test' }, live],
    [account, { ...central, authProjectId: 'foreign' }, live],
    [account, { ...central, firebaseConfig: { projectId: 'foreign' } }, live],
    [account, central, { ...live, apiBase: 'https://ai-translator-api-test-1060412514800.europe-west1.run.app' }],
    [account, central, { ...live, billingBase: 'https://balubenko-stripe-test.web.app' }],
  ]) {
    const state = billingAvailability(a, c, b);
    assert.equal(state.canPurchase, false); assert.equal(state.canViewPurchases, false);
    assert.equal(state.reason, 'environment-mismatch');
  }
  const testing = { ...live, environment: 'test', apiBase: 'https://ai-translator-api-test-1060412514800.europe-west1.run.app', billingBase: 'https://balubenko-stripe-test.web.app' };
  assert.equal(billingAvailability({ billing: { environment: 'test', purchasesEnabled: true } }, { ...central, environment: 'test' }, testing).canPurchase, true);
});

test('live and test build targets cannot be accidentally crossed', () => {
  const auth = { VITE_FIREBASE_API_KEY: 'public-test', VITE_FIREBASE_AUTH_DOMAIN: 'ai-translator-ext.firebaseapp.com', VITE_FIREBASE_PROJECT_ID: 'ai-translator-ext', VITE_FIREBASE_APP_ID: 'public-app', VITE_GOOGLE_CLIENT_ID: 'public-client' };
  const release = buildConfig('live', auth), testing = buildConfig('test', auth);
  assert.equal(selectedEnvironment([]), 'live');
  assert.equal(selectedEnvironment(['--environment', 'test']), 'test');
  assert.throws(() => selectedEnvironment(['test']));
  assert.throws(() => selectedEnvironment(['--environment', 'production']));
  assert.notEqual(release.VITE_API_BASE_URL, testing.VITE_API_BASE_URL);
  assert.notEqual(release.VITE_BILLING_BASE_URL, testing.VITE_BILLING_BASE_URL);
  assert.equal(release.VITE_FIREBASE_APP_ID, testing.VITE_FIREBASE_APP_ID, 'keep the existing account identity');
  assert.throws(() => buildConfig('test', auth, { VITE_API_BASE_URL: release.VITE_API_BASE_URL }));
  assert.throws(() => buildConfig('live', auth, { VITE_BILLING_BASE_URL: testing.VITE_BILLING_BASE_URL }));
  assert.throws(() => buildConfig('live', { ...auth, VITE_FIREBASE_PROJECT_ID: 'foreign' }));
  assert.throws(() => buildConfig('live', {}));
  assert.equal(buildConfig('test', { ...auth, API_ACCESS_TOKEN: 'private', VITE_PRIVATE_TOKEN: 'private' }).API_ACCESS_TOKEN, undefined);
});

test('public config recovers from an aborted first attempt without sending credentials', async () => {
  const calls = [];
  const result = await fetchCentralBillingConfig(live.billingBase, async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The request did not time out.')), 100);
      options.signal.addEventListener('abort', () => { clearTimeout(timer); reject(options.signal.reason); }, { once: true });
    });
    return Response.json({ data: central });
  }, 1);
  assert.deepEqual(result, central);
  assert.equal(calls.length, 2);
  assert.notEqual(calls[0].options.signal, calls[1].options.signal, 'each attempt has its own deadline');
  for (const { url, options } of calls) {
    assert.equal(url, 'https://balubenko-stripe.web.app/api/config?productId=ai-translator-extension');
    assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store'); assert.equal(options.referrerPolicy, 'no-referrer');
    assert.equal(options.headers, undefined); assert.equal(options.body, undefined);
  }
});

test('public config retries transient HTTP failures once and bounds repeated network failure', async () => {
  for (const status of [408, 429, 500, 503, 599]) {
    let calls = 0;
    const result = await fetchCentralBillingConfig(live.billingBase, async () => {
      calls++;
      return calls === 1 ? new Response('', { status }) : Response.json({ data: central });
    });
    assert.deepEqual(result, central); assert.equal(calls, 2, String(status));
  }
  let calls = 0;
  const result = await fetchCentralBillingConfig(live.billingBase, async () => {
    calls++; throw new TypeError('Failed to fetch');
  });
  assert.equal(result, undefined); assert.equal(calls, 2);
  assert.equal(billingAvailability(account, result, live).reason, 'unavailable');
});

test('public config does not retry nontransient responses or valid environment mismatches', async () => {
  const mismatch = { ...central, environment: 'test' };
  for (const [response, expected] of [[new Response('', { status: 400 }), undefined],
    [new Response('', { status: 401 }), undefined], [new Response('', { status: 404 }), undefined],
    [new Response('{invalid'), undefined], [Response.json({ data: {} }), undefined],
    [Response.json({ data: null }), undefined], [Response.json({ data: mismatch }), mismatch]]) {
    let calls = 0;
    const result = await fetchCentralBillingConfig(live.billingBase, async () => { calls++; return response; });
    assert.equal(calls, 1);
    assert.deepEqual(result, expected);
    if (result) assert.equal(billingAvailability(account, result, live).reason, 'environment-mismatch');
  }
  let calls = 0;
  assert.equal(await fetchCentralBillingConfig('https://example.com?token=private', async () => { calls++; return Response.json({ data: central }); }), undefined);
  assert.equal(calls, 0, 'invalid origins cannot put credentials in a public request URL');
});
