import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

test('worker routes durable jobs and isolates document generations', async () => {
  const callbacks = {};
  const event = (name) => ({ addListener(callback) { callbacks[name] = callback; } });
  const storage = () => {
    const values = {};
    return { async get(key) { return key === null ? structuredClone(values) : { [key]: structuredClone(values[key]) }; }, async set(next) { Object.assign(values, structuredClone(next)); } };
  };
  let frames = [
    { frameId: 0, documentId: 'top', url: 'https://example.com' },
    { frameId: 1, documentId: 'child-old', url: 'https://child.example.com' },
  ];
  const requests = [];
  const openedTabs = [];
  let purchasesEnabled = true;
  let centralEnvironment = 'live';
  const tabMessages = [];
  let activeTab = 9;
  globalThis.chrome = {
    runtime: { id: 'test-extension', onMessage: event('message'), onInstalled: event('installed'), onStartup: event('startup'), async openOptionsPage() {} },
    storage: { local: storage(), session: storage() },
    tabs: { async create(options) { openedTabs.push(options); }, async query() { return [{ id: activeTab }]; }, async get(id) { return { id, url: 'https://example.com' }; }, async sendMessage(tabId, message) { tabMessages.push({ tabId, message }); return { ok: true, data: null }; }, onRemoved: event('removed') },
    contextMenus: { async removeAll() {}, create() {}, onClicked: event('context') },
    scripting: { async executeScript() {} },
    webNavigation: { async getAllFrames() { return frames; }, onCommitted: event('committed'), onDOMContentLoaded: event('dom'), onHistoryStateUpdated: event('history'), onReferenceFragmentUpdated: event('fragment') },
  };
  globalThis.fetch = async (url, init) => {
    requests.push({ url, method: init.method, body: init.body && JSON.parse(init.body), headers: init.headers, credentials: init.credentials });
    if (String(url).includes('/api/config?')) return new Response(JSON.stringify({ data: { environment: centralEnvironment, authProjectId: 'ai-translator-ext', firebaseConfig: { projectId: 'ai-translator-ext' } } }));
    if (String(url).endsWith('/v1/me')) return new Response(JSON.stringify({ billing: { environment: 'live', purchasesEnabled } }));
    const body = init.method === 'POST' ? { id: 'job-one', status: 'queued' } : { id: 'job-one', status: init.method === 'DELETE' ? 'cancelled' : 'completed', translations: [{ id: 'part', text: 'Переклад' }] };
    return new Response(JSON.stringify(body), { status: init.method === 'POST' ? 202 : 200 });
  };
  const directory = await mkdtemp(join(tmpdir(), 'translator-worker-'));
  const bundled = await build({
    entryPoints: ['src/background.ts'], bundle: true, format: 'esm', platform: 'node', write: false,
    define: { 'import.meta.env': JSON.stringify({ VITE_API_BASE_URL: 'https://ai-translator-api-1060412514800.europe-west1.run.app', VITE_BILLING_BASE_URL: 'https://balubenko-stripe.web.app', VITE_BILLING_ENVIRONMENT: 'live', VITE_FIREBASE_PROJECT_ID: 'ai-translator-ext' }) },
    plugins: [{ name: 'test-auth', setup(builder) {
      builder.onResolve({ filter: /^\.\/auth$/ }, () => ({ path: 'auth', namespace: 'test' }));
      builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export async function getIdToken(){return "test-token"} export async function getAuthState(){return {user:{uid:"user"},configured:true}} export const login=getAuthState;export const logout=getAuthState;', loader: 'js' }));
    } }],
  });
  const file = join(directory, 'worker.mjs');
  await writeFile(file, bundled.outputFiles[0].text);
  await import(pathToFileURL(file).href);
  const ui = { id: 'test-extension', url: 'chrome-extension://test-extension/popup.html' };
  const child = { id: 'test-extension', tab: { id: 9 }, frameId: 1, documentId: 'child-old' };
  const request = (message, sender = ui) => new Promise((resolve) => { callbacks.message(message, sender, resolve); });
  try {
    assert.equal((await request({ type: 'account:get' })).data.billingAvailability.canPurchase, true);
    assert.equal((await request({ type: 'billing:open', payload: { page: 'pay' } })).ok, true);
    assert.equal(openedTabs[0].url, 'https://balubenko-stripe.web.app/pay?product=ai-translator-extension');
    const publicCalls = requests.filter(entry => String(entry.url).includes('/api/config?'));
    assert.ok(publicCalls.every(entry => !entry.headers && entry.credentials === 'omit'), 'public config gets no Firebase token or cookies');
    purchasesEnabled = false;
    assert.equal((await request({ type: 'billing:open', payload: { page: 'pay' } })).error.code, 'BILLING_UNAVAILABLE', 'click rechecks server after the prior UI check');
    assert.equal(openedTabs.length, 1);
    assert.equal((await request({ type: 'billing:open', payload: { page: 'account' } })).ok, true, 'existing purchase history stays accessible while new purchases are disabled');
    purchasesEnabled = true; centralEnvironment = 'test';
    assert.equal((await request({ type: 'billing:open', payload: { page: 'pay' } })).error.code, 'BILLING_ENVIRONMENT_MISMATCH');
    assert.equal(openedTabs.length, 2);
    assert.equal((await request({ type: 'billing:open', payload: { page: 'pay' } }, child)).error.code, 'INVALID_REQUEST', 'a webpage cannot open billing through the content script');
    centralEnvironment = 'live';
    const started = await request({ type: 'page:start' });
    assert.equal(started.ok, true);
    const sessionId = started.data.sessionId;
    const report = { type: 'page:report', payload: { sessionId, status: 'translating', total: 2, completed: 1, failed: 0 } };
    assert.equal((await request(report, child)).data.total, 2);

    const create = { type: 'translation:submit', payload: { sourceLanguage: 'auto', targetLanguage: 'Ukrainian', segments: [{ id: 'part', text: '😀'.repeat(4000) }], idempotencyKey: 'request-one' } };
    assert.equal((await request(create, child)).ok, true, 'the limit counts Unicode codepoints');
    create.payload.segments[0].text += 'a';
    const tooLong = await request(create, child);
    assert.equal(tooLong.ok, false);
    assert.equal(tooLong.error.code, 'INVALID_REQUEST');
    assert.equal((await request({ type: 'translation:get', payload: { id: 'job-one' } }, child)).data.status, 'completed');
    assert.equal((await request({ type: 'translation:get', payload: { id: 'job-one' } }, child)).data.status, 'completed', 'a lost terminal response can be safely retrieved again');
    assert.equal((await request({ type: 'translation:get', payload: { id: 'job-one' } }, { ...child, documentId: 'other-document' })).error.code, 'JOB_NOT_FOUND');

    callbacks.committed({ tabId: 9, frameId: 1, documentId: 'child-new' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal((await request(report, child)).data, null, 'departed document cannot publish stale progress');
    assert.equal((await request({ type: 'page:status' })).data.total, 0, 'departed frame progress is removed');
    assert.ok(requests.some((entry) => entry.method === 'DELETE'), 'departed frame jobs are cancelled');
    assert.equal((await request(report, { ...child, documentId: 'child-new' })).data.total, 2, 'new document joins the active session');

    callbacks.history({ tabId: 9, frameId: 0 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal((await request({ type: 'page:status' })).data.status, 'idle', 'SPA navigation restores and invalidates session');
    await request({ type: 'page:start' });
    tabMessages.length = 0;
    await request({ type: 'page:start' });
    assert.ok(tabMessages.some(({ message }) => message.payload.action === 'stop'), 'same-language resume pauses inflight work');
    assert.ok(!tabMessages.some(({ message }) => message.payload.action === 'restore'), 'same-language resume preserves completed translations');
    tabMessages.length = 0;
    await request({ type: 'page:start', payload: { targetLanguage: 'English' } });
    assert.ok(tabMessages.some(({ message }) => message.payload.action === 'restore'), 'changing language restores original text first');
    activeTab = 99;
    assert.equal((await request({ type: 'page:status' }, child)).data.tabId, 9, 'content requests target their sender tab after a tab switch');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
