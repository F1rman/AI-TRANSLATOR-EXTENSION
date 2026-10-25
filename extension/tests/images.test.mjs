import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const source = (path) => fileURLToPath(new URL(`../src/${path}`, import.meta.url));
const authPlugin = {
  name: 'image-test-auth',
  setup(builder) {
    builder.onResolve({ filter: /^\.\/auth$/ }, () => ({ path: 'auth', namespace: 'image-test' }));
    builder.onLoad({ filter: /.*/, namespace: 'image-test' }, () => ({
      contents: 'export async function getIdToken(refresh){globalThis.__imageTestTokenCalls.push(refresh);return "test-token"} export async function getAuthState(){return {user:{uid:"alice"},configured:true}} export const login=getAuthState; export async function logout(){return {user:null,configured:true}}',
      loader: 'js',
    }));
  },
};
async function bundle(path) {
  return (await build({
    entryPoints: [source(path)], bundle: true, format: 'esm', platform: 'browser',
    target: 'chrome120', write: false, logLevel: 'silent', plugins: [authPlugin],
    define: { 'import.meta.env': JSON.stringify({ VITE_API_BASE_URL: 'https://api.example.test' }) },
  })).outputFiles[0].text;
}
const controllerCode = await bundle('images.ts');
const workerCode = await bundle('background.ts');
let sequence = 0;
const load = (code) => import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}#image-test-${++sequence}`);
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const prefs = { sourceLanguage: 'auto', targetLanguage: 'Ukrainian', selectionMode: 'icon', uiLanguage: 'en', theme: 'system' };
const assertCode = (promise, code) => assert.rejects(promise, (error) => error.code === code);

async function fixture(t, plan = 'pro') {
  const globalNames = ['chrome', 'fetch', 'createImageBitmap', '__imageTestTokenCalls'];
  const previous = new Map(globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const callbacks = {}, values = {}, tabs = [], calls = [], posts = [], deleted = [], jobs = new Map(), byKey = new Map();
  const state = { plan, imageTranslation: true, loseNextResponse: false, sourceResponse: null, beforePost: null, bitmap: { width: 20, height: 12 } };
  const events = (name) => ({ addListener(handler) { callbacks[name] = handler; } });
  const storage = {
    async get(key) { return { [key]: structuredClone(values[key]) }; },
    async set(next) { Object.assign(values, structuredClone(next)); },
  };
  globalThis.__imageTestTokenCalls = [];
  globalThis.chrome = {
    runtime: {
      id: 'test-extension', getURL: (path) => `chrome-extension://test-extension/${path}`,
      onMessage: events('message'), onInstalled: events('installed'), onStartup: events('startup'),
      async openOptionsPage() {},
    },
    storage: { session: storage, local: storage },
    tabs: { async create(next) { tabs.push(next); }, onRemoved: events('removed') },
    contextMenus: { onClicked: events('context'), async removeAll() {}, create() {} },
    webNavigation: {
      onCommitted: events('committed'), onDOMContentLoaded: events('loaded'),
      onHistoryStateUpdated: events('history'), onReferenceFragmentUpdated: events('fragment'),
    },
  };
  globalThis.createImageBitmap = async () => ({ ...state.bitmap, close() {} });
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    calls.push({ url: href, init });
    if (href.startsWith('https://images.example.test/')) {
      return state.sourceResponse ? state.sourceResponse() : new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'Content-Type': 'image/png' } });
    }
    if (href === 'https://api.example.test/v1/image-translation-jobs' && init.method === 'POST') {
      const key = init.body.get('idempotencyKey');
      posts.push({ key, body: init.body, headers: init.headers });
      if (!byKey.has(key)) {
        const job = { id: `image-job-${byKey.size + 1}`, kind: 'image', status: 'queued' };
        byKey.set(key, job); jobs.set(job.id, job);
      }
      if (state.beforePost) await state.beforePost();
      if (state.loseNextResponse) { state.loseNextResponse = false; throw new TypeError('Simulated connection lost after server commit'); }
      return new Response(JSON.stringify(byKey.get(key)), { status: 202, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`Unexpected fetch: ${href}`);
  };
  const api = async (path, method = 'GET') => {
    if (path === '/me') return { plan: state.plan, features: { imageTranslation: state.imageTranslation } };
    const identifier = decodeURIComponent(path.split('/').at(-1));
    const job = jobs.get(identifier);
    assert.ok(job, `Expected known job ${identifier}`);
    if (method === 'DELETE') { deleted.push(identifier); if (job.status === 'queued' || job.status === 'running') job.status = 'cancelled'; }
    return structuredClone(job);
  };
  const { createImageController } = await load(controllerCode);
  const controller = createImageController(api, async () => ({ ...prefs }));
  const open = async (url = 'https://images.example.test/photo.png') => {
    await controller.open(url);
    return new URL(tabs.at(-1).url).searchParams.get('intent');
  };
  const submit = (intentId, extra = {}) => controller.handle({ type: 'image:submit', payload: { intentId, sourceLanguage: 'auto', targetLanguage: 'Ukrainian', ...extra } });
  t.after(() => {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  return { controller, open, submit, state, values, calls, posts, jobs, byKey, deleted, callbacks, api };
}

test('server-disabled image access blocks fetch, decode and upload regardless of the plan', async (t) => {
  for (const plan of ['free', 'pro']) await t.test(plan, async (t) => {
    const f = await fixture(t, plan); f.state.imageTranslation = false;
    const id = await f.open();
    await assertCode(f.controller.handle({ type: 'image:prepare', payload: { intentId: id } }), 'FEATURE_DISABLED');
    await assertCode(f.submit(id), 'FEATURE_DISABLED');
    assert.equal(f.calls.length, 0);
    assert.equal(f.byKey.size, 0);
  });
});

test('Free accounts with server-enabled image access can prepare and submit an image', async (t) => {
  const f = await fixture(t, 'free'); const id = await f.open();
  const original = await f.controller.handle({ type: 'image:prepare', payload: { intentId: id } });
  assert.match(original.dataUrl, /^data:image\/png;base64,/);
  const job = await f.submit(id);
  assert.equal(job.status, 'queued'); assert.equal(f.posts.length, 1);
  assert.equal(f.calls.filter(({ url }) => url.startsWith('https://images.example.test/')).length, 1);
});

test('unsupported inline images and URL credentials never enter session storage', async (t) => {
  const f = await fixture(t);
  for (const source of ['data:image/png;base64,private-image-bytes', 'blob:https://images.example.test/private-image', 'https://user:private-password@images.example.test/photo.png']) {
    const id = await f.open(source);
    assert.equal(f.values.imageIntents[id].srcUrl, 'unsupported:');
    await assertCode(f.submit(id), 'UNSUPPORTED_IMAGE');
  }
  const stored = JSON.stringify(f.values);
  assert.ok(!stored.includes('private-image'));
  assert.ok(!stored.includes('private-password'));
  assert.equal(f.calls.length, 0);
});

test('parallel submits deduplicate a job and persist metadata without storing image bytes or credentials', async (t) => {
  const f = await fixture(t);
  const id = await f.open();
  const [first, duplicate] = await Promise.all([f.submit(id), f.submit(id)]);
  assert.deepEqual(first, duplicate);
  assert.equal(f.posts.length, 1);
  assert.equal(f.calls.filter(({ url }) => url.startsWith('https://images.example.test/')).length, 1);
  assert.equal(f.calls.find(({ url }) => url.startsWith('https://images.example.test/')).init.credentials, 'omit');
  assert.equal(f.posts[0].headers.Authorization, 'Bearer test-token');
  assert.equal(f.posts[0].headers['Content-Type'], undefined, 'browser generates the multipart boundary');
  assert.equal(f.values.imageIntents[id].jobId, first.id);
  assert.ok(!JSON.stringify(f.values).includes('test-token'));
  assert.ok(!JSON.stringify(f.values).includes('data:image/'));
  assert.equal((await f.submit(id)).id, first.id, 'a known active job is resumed rather than uploaded again');
  assert.equal(f.posts.length, 1);
});

test('a lost initial POST response is recovered using the persistent request key after worker restart', async (t) => {
  const f = await fixture(t);
  const id = await f.open(); const key = f.values.imageIntents[id].idempotencyKey;
  f.state.loseNextResponse = true;
  await assertCode(f.submit(id), 'NETWORK_ERROR');
  assert.equal(f.values.imageIntents[id].jobId, undefined);
  const { createImageController } = await load(controllerCode);
  const restarted = createImageController(f.api, async () => ({ ...prefs }));
  const result = await restarted.handle({ type: 'image:submit', payload: { intentId: id, sourceLanguage: 'auto', targetLanguage: 'Ukrainian' } });
  assert.equal(f.posts[1].key, key);
  assert.equal(f.byKey.size, 1);
  assert.equal(result.id, f.byKey.get(key).id);
});

test('retrying Translate again after a lost POST reuses its key even with restart=true', async (t) => {
  const f = await fixture(t);
  const id = await f.open();
  const first = await f.submit(id);
  f.jobs.get(first.id).status = 'completed';
  f.state.loseNextResponse = true;
  await assertCode(f.submit(id, { restart: true }), 'NETWORK_ERROR');
  const retryKey = f.values.imageIntents[id].idempotencyKey;
  assert.notEqual(retryKey, f.posts[0].key, 'an explicit new translation receives a new key');
  const recovered = await f.submit(id, { restart: true });
  assert.equal(f.posts.at(-1).key, retryKey, 'a pending upload keeps its key despite the stale restart flag');
  assert.equal(f.byKey.size, 2, 'only the original job and one requested new translation exist');
  assert.notEqual(recovered.id, first.id);
});

test('language changes are blocked for an active image and receive a fresh request key after completion', async (t) => {
  const f = await fixture(t);
  const id = await f.open(); const first = await f.submit(id);
  await assertCode(f.submit(id, { targetLanguage: 'English' }), 'CONCURRENCY_LIMIT');
  f.jobs.get(first.id).status = 'completed';
  const next = await f.submit(id, { targetLanguage: 'English' });
  assert.notEqual(next.id, first.id);
  assert.equal(f.posts.at(-1).body.get('targetLanguage'), 'English');
  assert.notEqual(f.posts.at(-1).key, f.posts[0].key);
});

test('oversized image downloads are rejected by declared length and bounded streaming', async (t) => {
  const f = await fixture(t);
  const id = await f.open();
  f.state.sourceResponse = () => new Response('tiny', { headers: { 'Content-Type': 'image/png', 'Content-Length': String(10 * 1024 * 1024 + 1) } });
  await assertCode(f.controller.handle({ type: 'image:prepare', payload: { intentId: id } }), 'IMAGE_TOO_LARGE');
  let streamCancelled = false;
  f.state.sourceResponse = () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(10 * 1024 * 1024)); controller.enqueue(new Uint8Array(1)); },
    cancel() { streamCancelled = true; },
  }), { headers: { 'Content-Type': 'image/png' } });
  await assertCode(f.controller.handle({ type: 'image:prepare', payload: { intentId: id } }), 'IMAGE_TOO_LARGE');
  assert.equal(streamCancelled, true);
  assert.equal(f.posts.length, 0);
});

test('oversized dimensions and unsupported URLs fail before an API upload', async (t) => {
  const f = await fixture(t);
  f.state.bitmap = { width: 5001, height: 4000 };
  await assertCode(f.submit(await f.open()), 'IMAGE_TOO_LARGE');
  const count = f.calls.length;
  await assertCode(f.submit(await f.open('file:///private/photo.png')), 'UNSUPPORTED_IMAGE');
  await assertCode(f.submit(await f.open('https://user:password@images.example.test/photo.png')), 'UNSUPPORTED_IMAGE');
  assert.equal(f.calls.length, count);
  assert.equal(f.posts.length, 0);
});

test('logout drains an in-flight upload and cancels the created job before clearing session metadata', async (t) => {
  const f = await fixture(t);
  const id = await f.open(); const entered = deferred(), release = deferred();
  f.state.beforePost = async () => { entered.resolve(); await release.promise; };
  const pending = f.submit(id);
  const outcome = pending.then((job) => ({ job }), (error) => ({ error }));
  await entered.promise;
  let signedOut = false;
  const logout = f.controller.logout().then(() => { signedOut = true; });
  await Promise.resolve();
  assert.equal(signedOut, false, 'logout waits until the pending upload can be cancelled');
  await assertCode(f.submit(id), 'AUTH_REQUIRED');
  release.resolve();
  const result = await outcome; await logout;
  assert.equal(result.error?.code, 'IMAGE_CANCELLED');
  assert.equal(f.deleted.length, 1);
  assert.equal(f.jobs.get(f.deleted[0]).status, 'cancelled');
  assert.deepEqual(f.values.imageIntents, {});
  assert.equal(signedOut, true);
});

test('worker accepts image commands only from its own image page', async (t) => {
  const f = await fixture(t);
  const id = await f.open();
  await load(workerCode);
  const command = { type: 'image:intent', payload: { intentId: id } };
  const request = (sender) => new Promise((resolve) => { f.callbacks.message(command, sender, resolve); });
  for (const url of [
    'https://example.test/article',
    'chrome-extension://test-extension/popup.html',
    'chrome-extension://another-extension/image.html',
  ]) {
    const response = await request({ id: 'test-extension', url, tab: { id: 1 } });
    assert.equal(response.ok, false);
    assert.equal(response.error.code, 'INVALID_REQUEST');
  }
  const response = await request({ id: 'test-extension', url: `chrome-extension://test-extension/image.html?intent=${id}` });
  assert.equal(response.ok, true);
  assert.equal(response.data.id, id);
  assert.equal(f.calls.length, 0);
});
