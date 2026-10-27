import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const bundle = async (file, format = 'esm') => (await build({
  entryPoints: [fileURLToPath(new URL(file, import.meta.url))], bundle: true,
  format, platform: 'browser', target: 'chrome120', write: false, logLevel: 'silent',
})).outputFiles[0].text;
const domModule = await import(`data:text/javascript;base64,${Buffer.from(await bundle('./dom.ts')).toString('base64')}`);
const contentCode = await bundle('./index.ts', 'iife');
const { TextDocument, splitText, MAX_JOB_CHARACTERS, MAX_JOB_SEGMENTS } = domModule;
const sleep = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function fixture(html = '') {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { url: 'https://example.test/article', runScripts: 'outside-only' });
  const { window } = dom;
  const descriptors = new Map();
  for (const name of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'Text', 'Document', 'ShadowRoot', 'NodeFilter', 'MutationObserver', 'getComputedStyle']) {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value: name === 'getComputedStyle' ? window.getComputedStyle.bind(window) : window[name], writable: true, configurable: true });
  }
  const bounds = new window.DOMRect(20, 20, 400, 24);
  window.Element.prototype.getClientRects = function () { return [bounds]; };
  return {
    window, document: window.document,
    close() {
      window.close();
      for (const [name, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
    },
  };
}

test('collects visible text and open shadow roots while excluding controls, hidden content and code', () => {
  const f = fixture('<p>Hello <a href="/next">world</a>.</p><form>Private form<input value="secret"></form><pre>code</pre><div contenteditable>editable</div><p hidden>hidden</p><p style="display:none">invisible</p><div translate="no">verbatim</div><div id="shadow"></div>');
  try {
    const shadow = f.document.querySelector('#shadow').attachShadow({ mode: 'open' });
    shadow.innerHTML = '<p>Shadow words</p><code>shadow code</code>';
    shadow.append(f.document.createTextNode('Direct shadow text'));
    const document = new TextDocument(f.document);
    assert.deepEqual(document.collect().map((record) => record.source), ['Hello ', 'world', 'Shadow words', 'Direct shadow text']);
    assert.equal(document.roots.size, 2);
  } finally { f.close(); }
});

test('only text changes: links, elements, whitespace and event listeners survive translation and restore', () => {
  const f = fixture('<p>  Hello <a href="/next">world</a>  </p>');
  try {
    const link = f.document.querySelector('a');
    let clicked = false;
    link.addEventListener('custom-click', () => { clicked = true; });
    const document = new TextDocument(f.document);
    const batches = document.batches(document.collect());
    for (const part of batches.flat()) document.apply(part, `<b>${part.text.toUpperCase()}</b>`);
    assert.equal(f.document.querySelector('a'), link);
    assert.equal(link.querySelector('b'), null, 'model output must be plain text');
    assert.equal(f.document.querySelector('p').textContent, '  <b>HELLO</b> <b>WORLD</b>  ');
    link.dispatchEvent(new f.window.Event('custom-click'));
    assert.equal(clicked, true);
    document.restore();
    assert.equal(f.document.querySelector('p').textContent, '  Hello world  ');
    assert.equal(f.document.querySelector('a'), link);
  } finally { f.close(); }
});

test('long multilingual nodes split losslessly and stay within both API bounds', () => {
  const original = `  ${'Hello world. Привіт! 日本語。مرحبا بالعالم؟ 😀 '.repeat(400)}  `;
  const pieces = splitText(original);
  assert.equal(pieces.map(({ prefix, text, suffix }) => prefix + text + suffix).join(''), original);
  assert.ok(pieces.every(({ text }) => text.length <= 1_800));
  assert.ok(pieces.every(({ text }) => !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u.test(text)));
  const f = fixture('<p></p>');
  try {
    const text = f.document.createTextNode(original);
    f.document.querySelector('p').append(text);
    const document = new TextDocument(f.document);
    const batches = document.batches(document.collect());
    assert.ok(batches.length > 1);
    for (const batch of batches) {
      assert.ok(batch.length <= MAX_JOB_SEGMENTS);
      assert.ok(batch.reduce((n, { text }) => n + text.length, 0) <= MAX_JOB_CHARACTERS);
    }
    const parts = batches.flat();
    parts.slice(0, -1).forEach((part) => document.apply(part, part.text.toUpperCase()));
    assert.equal(text.data, original, 'do not partially rewrite a long node');
    document.apply(parts.at(-1), parts.at(-1).text.toUpperCase());
    assert.notEqual(text.data, original);
    document.restore();
    assert.equal(text.data, original);
  } finally { f.close(); }
});

test('stale responses and restore never overwrite later site edits', () => {
  const f = fixture('<p>Hello</p><p>World</p>');
  try {
    const document = new TextDocument(f.document);
    const parts = document.batches(document.collect()).flat();
    const first = parts[0];
    first.record.node.data = 'Site changed this';
    assert.equal(document.apply(first, 'Привіт'), false);
    assert.equal(first.record.node.data, 'Site changed this');
    assert.equal(first.record.revision, 1);
    assert.equal(document.apply(parts[1], 'Світ'), true);
    parts[1].record.node.data = 'A newer site update';
    document.restore();
    assert.equal(f.document.querySelectorAll('p')[0].textContent, 'Site changed this');
    assert.equal(f.document.querySelectorAll('p')[1].textContent, 'A newer site update');
  } finally { f.close(); }
});

test('resuming a long node reuses completed chunks without submitting or charging them again', () => {
  const f = fixture('<p></p>');
  try {
    const source = 'A long sentence with meaningful words. '.repeat(160);
    const text = f.document.createTextNode(source);
    f.document.querySelector('p').append(text);
    const document = new TextDocument(f.document);
    const batches = document.batches(document.collect());
    assert.ok(batches.length > 1);
    batches[0].forEach((part) => document.apply(part, part.text.toUpperCase()));
    assert.equal(text.data, source);
    document.prepareResume();
    const remaining = document.batches(document.collect()).flat();
    assert.equal(remaining.length, batches.flat().length - batches[0].length);
    remaining.forEach((part) => document.apply(part, part.text.toUpperCase()));
    assert.equal(text.data, source.toUpperCase());
    document.restore();
    assert.equal(text.data, source);
  } finally { f.close(); }
});

test('own MutationObserver writes do not schedule retranslations; external text changes invalidate the revision', async () => {
  const f = fixture('<p>Hello</p>');
  try {
    const document = new TextDocument(f.document);
    const [part] = document.batches(document.collect()).flat();
    const changes = [];
    const observer = new f.window.MutationObserver((mutations) => {
      mutations.forEach((mutation) => changes.push(document.changed(mutation.target)));
    });
    observer.observe(f.document.body, { subtree: true, characterData: true });
    document.apply(part, 'Привіт');
    await sleep();
    assert.deepEqual(changes, [false]);
    assert.equal(document.collect().length, 0);
    part.record.node.data = 'Fresh page text';
    await sleep();
    assert.deepEqual(changes, [false, true]);
    assert.equal(document.collect().length, 1);
    assert.equal(part.record.revision, 1);
    assert.equal(document.apply(part, 'Old answer'), false);
    observer.disconnect();
  } finally { f.close(); }
});

function contentFixture({ defer = false, submit } = {}) {
  const f = fixture('<p id="article">Hello world</p>');
  const listeners = [];
  const messages = [];
  const pending = [];
  let nextId = 0;
  f.window.chrome = {
    runtime: {
      id: 'content-unit-test', onMessage: { addListener(listener) { listeners.push(listener); } },
      async sendMessage(message) {
        messages.push(message);
        if (message.type === 'settings:get') return { ok: true, data: { sourceLanguage: 'auto', targetLanguage: 'Ukrainian', selectionMode: 'icon', uiLanguage: 'en', theme: 'light' } };
        if (message.type === 'translation:submit') {
          if (submit) return submit(message.payload);
          const job = { id: `job-${++nextId}`, status: 'completed', translations: message.payload.segments.map((part) => ({ id: part.id, text: part.text.toUpperCase() })) };
          if (defer) return await new Promise((resolve) => { pending.push(() => resolve({ ok: true, data: job })); });
          return { ok: true, data: job };
        }
        return { ok: true, data: null };
      },
    },
    storage: { onChanged: { addListener() {} } },
  };
  f.window.eval(contentCode);
  async function command(action, sessionId = 'test-session') {
    return await new Promise((resolve) => listeners[0]({ type: 'page:command', payload: { action, sessionId, sourceLanguage: 'auto', targetLanguage: 'Ukrainian' } }, { id: 'content-unit-test' }, resolve));
  }
  return { ...f, command, messages, pending, listeners };
}

test('integrated content script translates once, observes additions, and restores originals', async () => {
  const f = contentFixture();
  try {
    await f.command('start');
    await sleep(300);
    assert.equal(f.document.querySelector('#article').textContent, 'HELLO WORLD');
    assert.equal(f.messages.filter(({ type }) => type === 'translation:submit').length, 1, 'own changes must not loop');
    const paragraph = f.document.createElement('p');
    paragraph.textContent = 'A new paragraph';
    f.document.body.append(paragraph);
    await sleep(300);
    assert.equal(paragraph.textContent, 'A NEW PARAGRAPH');
    await f.command('restore');
    assert.equal(f.document.querySelector('#article').textContent, 'Hello world');
    assert.equal(paragraph.textContent, 'A new paragraph');
    assert.equal(f.messages.filter(({ type }) => type === 'translation:submit').length, 2);
  } finally { f.close(); }
});

test('integrated stop and generation change discard delayed results and cancel backend jobs', async () => {
  const f = contentFixture({ defer: true });
  try {
    await f.command('start');
    assert.equal(f.pending.length, 1);
    await f.command('stop');
    f.pending.shift()();
    await sleep();
    assert.equal(f.document.querySelector('#article').textContent, 'Hello world');
    assert.ok(f.messages.some(({ type }) => type === 'translation:cancel'));
    await f.command('start', 'second-session');
    await f.command('restore', 'second-session');
    f.pending.shift()();
    await sleep();
    assert.equal(f.document.querySelector('#article').textContent, 'Hello world');
    assert.equal(f.document.querySelectorAll('[data-ai-translator-ui]').length, 1);
    // Reinjection for a previously open tab must preserve the one listener and one host.
    f.window.eval(contentCode);
    assert.equal(f.listeners.length, 1);
    assert.equal(f.document.querySelectorAll('[data-ai-translator-ui]').length, 1);
  } finally { f.close(); }
});

test('integrated in-flight site edits remain unchanged by stale model output', async () => {
  const f = contentFixture({ defer: true });
  try {
    await f.command('start');
    f.document.querySelector('#article').firstChild.data = 'An update from the site';
    f.pending.shift()();
    await sleep();
    await f.command('stop');
    assert.equal(f.document.querySelector('#article').textContent, 'An update from the site');
    await f.command('restore');
    assert.equal(f.document.querySelector('#article').textContent, 'An update from the site');
  } finally { f.close(); }
});

test('authentication and quota failures pause the page with recoverable localized status', async () => {
  for (const [code, expected] of [['AUTH_REQUIRED', /Sign in with Google/], ['QUOTA_EXCEEDED', /monthly character allowance/]]) {
    const f = contentFixture({ submit: () => ({ ok: false, error: { code, message: 'Technical server detail' } }) });
    try {
      await f.command('start');
      await sleep();
      const { data } = await f.command('status');
      assert.equal(data.status, 'error');
      assert.match(data.message, expected);
      assert.equal(data.failed, 1);
      assert.equal(f.document.querySelector('#article').textContent, 'Hello world');
      assert.equal(f.messages.filter(({ type }) => type === 'translation:submit').length, 1);
    } finally { f.close(); }
  }
});

test('malformed completed jobs cannot alter the document', async () => {
  const f = contentFixture({ submit: () => ({ ok: true, data: { id: 'broken-job', status: 'completed', translations: [{ id: 'invented-id', text: 'Wrong result' }] } }) });
  try {
    await f.command('start');
    await sleep();
    assert.equal(f.document.querySelector('#article').textContent, 'Hello world');
    const { data } = await f.command('status');
    assert.equal(data.status, 'error');
    assert.match(data.message, /incomplete translation/);
  } finally { f.close(); }
});
