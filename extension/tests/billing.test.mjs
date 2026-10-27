import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { buildConfig, selectedEnvironment } from '../scripts/build-config.mjs';

const code = (await build({
  entryPoints: ['src/shared/billing.ts'], bundle: true, format: 'esm', platform: 'browser', write: false,
  define: { 'import.meta.env': JSON.stringify({ VITE_BILLING_BASE_URL: 'https://balubenko-stripe.web.app' }) },
})).outputFiles[0].text;
const { billingPage, billingAvailability } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
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
