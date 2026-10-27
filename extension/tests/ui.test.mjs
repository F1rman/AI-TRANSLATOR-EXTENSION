import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

test('language dropdown searches native names and codes without committing drafts', async () => {
  const dom = new JSDOM('<!doctype html><html><body><main id="root"></main></body></html>', { url: 'https://extension.test/popup.html', pretendToBeVisual: true });
  const keys = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'KeyboardEvent', 'IS_REACT_ACT_ENVIRONMENT'];
  const old = Object.fromEntries(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of keys.slice(0, -1)) Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const directory = await mkdtemp(join(tmpdir(), 'translator-ui-'));
  let root; const initialHandles = new Set(process._getActiveHandles());
  try {
    const bundle = await build({ stdin: { contents: 'export { createElement, act } from "react"; export { createRoot } from "react-dom/client"; export { LanguageField } from "./src/ui/LanguageField"; export { DEFAULT_SETTINGS } from "./src/shared/protocol"; export { errorText } from "./src/content/ui"; export { languages, findLanguages } from "./src/ui/languages";', resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, platform: 'node', format: 'esm', write: false });
    const file = join(directory, 'ui.mjs'); await writeFile(file, bundle.outputFiles[0].text);
    const { createElement, act, createRoot, LanguageField, DEFAULT_SETTINGS, languages, findLanguages, errorText } = await import(pathToFileURL(file).href);
    assert.equal(languages.length, 34);
    assert.match(errorText({ code: 'QUOTA_EXCEEDED', message: 'limit' }, 'en'), /monthly character allowance/);
    assert.match(errorText({ code: 'QUOTA_EXCEEDED', message: 'limit' }, 'uk'), /Місячний ліміт символів/);
    for (const query of ['Українська', 'uk', 'Français', 'francais', '日本語', 'ja', 'العربية', 'ar', 'zh-cn']) assert.ok(findLanguages(query).length > 0, `search supports ${query}`);
    const changes = [];
    root = createRoot(document.getElementById('root'));
    const render = (extra = {}) => act(() => root.render(createElement(LanguageField, { label: 'Translate to', value: 'Ukrainian', settings: { ...DEFAULT_SETTINGS, uiLanguage: 'en' }, onChange: (value) => changes.push(value), ...extra })));
    const click = (element) => act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const key = (element, value) => act(() => element.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true })));
    const type = (value) => act(() => { const input = document.querySelector('.language-search input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
    await render();
    await click(document.querySelector('.language-trigger'));
    assert.equal(document.activeElement, document.querySelector('.language-search input'));
    assert.equal(document.querySelectorAll('[role="option"]').length, 34);
    assert.ok(document.querySelector('.language-group').textContent.includes('Popular'));
    assert.equal(document.querySelector('[aria-selected="true"]').textContent, 'UkrainianУкраїнська');
    await type('日本語');
    assert.equal(changes.length, 0, 'searching does not modify saved language');
    assert.equal(document.querySelectorAll('[role="option"]').length, 1);
    await key(document.activeElement, 'Enter');
    assert.deepEqual(changes, ['Japanese'], 'native search commits the existing canonical English language value');
    assert.equal(document.querySelector('.language-menu'), null);
    assert.equal(document.activeElement, document.querySelector('.language-trigger'));
    await key(document.activeElement, 'ArrowDown');
    await type('Klingon');
    await key(document.activeElement, 'Enter');
    assert.deepEqual(changes, ['Japanese', 'Klingon'], 'custom names require an explicit selection');
    await click(document.querySelector('.language-trigger'));
    await type('Arabic'); await key(document.activeElement, 'Escape');
    assert.equal(changes.length, 2);
    assert.equal(document.querySelector('.language-menu'), null);
    await click(document.querySelector('.language-trigger'));
    await act(() => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    assert.equal(document.querySelector('.language-menu'), null, 'outside click closes the portal');
    await render({ automatic: true }); await click(document.querySelector('.language-trigger'));
    assert.equal(document.querySelector('[role="option"]').textContent, 'Detect language');
    await key(document.activeElement, 'Enter'); assert.equal(changes.at(-1), 'auto');
    await render({ disabled: true });
    assert.equal(document.querySelector('.language-trigger').disabled, true);
    await render({ value: 'Klingon', automatic: false }); await click(document.querySelector('.language-trigger'));
    assert.equal(document.querySelector('[aria-selected="true"]').textContent, 'Klingon', 'old custom settings remain selectable');
    assert.ok(![...document.querySelectorAll('[role="option"]')].some((option) => option.textContent === 'Detect language'), 'target selector excludes auto-detection');
    await type('auto'); assert.equal(document.querySelectorAll('[role="option"]').length, 0, 'auto cannot be submitted as a custom target language');
    await act(() => root.unmount()); root = null;
  } finally {
    if (root) root.unmount();
    dom.window.close(); await rm(directory, { recursive: true, force: true });
    // The bundled browser scheduler owns a MessagePort when imported into jsdom.
    for (const handle of process._getActiveHandles()) if (!initialHandles.has(handle) && handle.constructor.name === 'MessagePort') handle.unref();
    for (const [key, descriptor] of Object.entries(old)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  }
});
