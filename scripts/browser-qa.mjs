import { chromium } from 'playwright';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'extension/dist');
const manifest = JSON.parse(await readFile(path.join(dist, 'manifest.json'), 'utf8'));
const artifacts = path.join(root, 'artifacts/screenshots');
await mkdir(artifacts, { recursive: true });
const profile = await mkdtemp(path.join(tmpdir(), 'ai-translator-qa-'));
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium', headless: true,
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  viewport: { width: 1280, height: 900 },
});
const errors = [];
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  if (manifest.key) {
    const hash = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32);
    const expectedId = [...hash].map(nibble => String.fromCharCode(97 + Number.parseInt(nibble, 16))).join('');
    assert.equal(id, expectedId, 'Loaded Chrome extension must use the public-key-derived ID');
    const deployment = JSON.parse(await readFile(path.join(root, 'deployment.json'), 'utf8'));
    if (deployment.extensionId) assert.equal(id, deployment.extensionId, 'Unpacked extension ID must match the Store item');
  }
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`chrome-extension://${id}/popup.html`);
  await page.locator('.popup-header').waitFor();
  await page.waitForFunction(() => document.querySelector('.setup-note') || document.querySelector('.google-button'));
  const authState = await page.evaluate(async () => chrome.runtime.sendMessage({ type: 'auth:get' }));
  assert.equal(authState.ok, true, 'Firebase authentication must initialize successfully');
  assert.equal(authState.data.configured, Boolean(manifest.oauth2?.client_id));
  if (authState.data.configured) {
    assert.equal(await page.locator('.google-button').isEnabled(), true, 'Configured build must enable Google sign-in');
    assert.equal(await page.locator('.setup-note').count(), 0);
  }
  assert.match(await page.title(), /AI Translator/);
  await page.locator('.popup').screenshot({ path: path.join(artifacts, 'popup-signed-out.png') });
  await page.goto(`chrome-extension://${id}/options.html`);
  await page.locator('.settings-card').first().waitFor();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.getByRole('heading', { name: 'Your translation space' }).waitFor();
  await page.screenshot({ path: path.join(artifacts, 'options-light.png'), fullPage: true });
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.screenshot({ path: path.join(artifacts, 'options-dark.png'), fullPage: true });
  const settings = await worker.evaluate(async () => (await chrome.storage.local.get('settings')).settings);
  assert.equal(settings.uiLanguage, 'en');
  assert.equal(settings.theme, 'dark');
  const unauthorized = await page.evaluate(async () => chrome.runtime.sendMessage({ type: 'account:get' }));
  assert.equal(unauthorized.ok, false);
  assert.ok(['AUTH_REQUIRED', 'NOT_CONFIGURED'].includes(unauthorized.error.code), unauthorized.error.code);
  assert.deepEqual(errors, [], 'Extension page runtime errors');
  console.log(`PASS: packaged extension ${id} loads, persists settings, handles signed-out access; no runtime errors.`);

  // Exercise the actual built content bundle with a deterministic job transport.
  // This is browser integration testing, not a live AI quality test.
  const content = await readFile(path.join(dist, 'content.js'), 'utf8');
  const browser = await chromium.launch({ headless: true });
  try {
    const fixture = await browser.newPage();
    fixture.on('pageerror', error => errors.push(error.message));
    await fixture.route('https://fixture.test/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body style="font:18px system-ui;margin:80px;max-width:780px"><h1>Reading beyond language</h1><p id="p">Hello <a id="link" href="#good">world</a>.</p><button id="action">Keep working</button><input value="Private input"><pre>code stays unchanged</pre><p hidden>Hidden stays unchanged</p><div contenteditable="true">Editable stays unchanged</div><div id="shadow-host"></div></body></html>` }));
    await fixture.goto('https://fixture.test/');
    await fixture.evaluate(() => {
      const listeners = []; const jobs = {}; const reports = []; let submitted = 0;
      window.fixtureClicks = 0;
      document.querySelector('#action').addEventListener('click', () => window.fixtureClicks++);
      document.querySelector('#shadow-host').attachShadow({ mode: 'open' }).innerHTML = '<p>Shadow text</p>';
      const settings = { sourceLanguage: 'auto', targetLanguage: 'Ukrainian', selectionMode: 'icon', uiLanguage: 'en', theme: 'light' };
      window.chrome = {
        runtime: { id: 'fixture-extension', onMessage: { addListener: fn => listeners.push(fn) },
          sendMessage: async request => {
            if (request.type === 'settings:get') return { ok: true, data: settings };
            if (request.type === 'page:report') { reports.push(request.payload); return { ok: true, data: request.payload }; }
            if (request.type === 'translation:submit') {
              const id = `job-${++submitted}`;
              const translations = request.payload.segments.map(s => ({ id: s.id, text: `UA(${s.text})` }));
              jobs[id] = { id, status: 'completed', translations };
              return { ok: true, data: { id, status: 'queued' } };
            }
            if (request.type === 'translation:get') return { ok: true, data: jobs[request.payload.id] };
            if (request.type === 'translation:cancel') return { ok: true, data: { id: request.payload.id, status: 'cancelled' } };
            return { ok: true, data: null };
          } }, storage: { onChanged: { addListener() {} } },
      };
      window.fixture = {
        reports, submitted: () => submitted,
        command: action => Promise.all(listeners.map(listener => new Promise(resolve => {
          if (!listener({ type: 'page:command', payload: { action, sessionId: 'session-1', sourceLanguage: 'auto', targetLanguage: 'Ukrainian' } }, { id: 'fixture-extension' }, resolve)) resolve(null);
        }))),
      };
    });
    await fixture.addScriptTag({ content });
    await fixture.evaluate(() => window.fixture.command('start'));
    await fixture.waitForFunction(() => document.querySelector('#p').textContent.includes('UA(Hello'));
    assert.equal(await fixture.locator('#link').getAttribute('href'), '#good');
    assert.equal(await fixture.locator('input').inputValue(), 'Private input');
    assert.equal(await fixture.locator('pre').textContent(), 'code stays unchanged');
    assert.equal(await fixture.locator('[contenteditable]').textContent(), 'Editable stays unchanged');
    assert.match(await fixture.locator('#shadow-host').evaluate(el => el.shadowRoot.textContent), /UA\(Shadow text\)/);
    await fixture.locator('#action').click();
    assert.equal(await fixture.evaluate(() => window.fixtureClicks), 1);
    const before = await fixture.evaluate(() => window.fixture.submitted());
    await fixture.waitForTimeout(800);
    assert.equal(await fixture.evaluate(() => window.fixture.submitted()), before, 'Own DOM writes must not trigger translation loops');
    await fixture.evaluate(() => { const p=document.createElement('p'); p.id='dynamic'; p.textContent='New content'; document.body.append(p); });
    await fixture.waitForFunction(() => document.querySelector('#dynamic').textContent === 'UA(New content)');
    await fixture.evaluate(() => { document.querySelector('#link').firstChild.data = 'Website update'; return window.fixture.command('restore'); });
    assert.equal(await fixture.locator('#link').textContent(), 'Website update', 'Restore preserves website edits');
    assert.equal(await fixture.locator('#dynamic').textContent(), 'New content');
    assert.equal(await fixture.locator('#p').evaluate(el => el.firstChild.data), 'Hello ');
    assert.deepEqual(errors, [], 'Content bundle runtime errors');
    console.log('PASS: built content translates dynamic/open-shadow text, preserves events/forms/code/links, avoids loops and restores safely.');
  } finally { await browser.close(); }
  await writeFile(path.join(root, 'artifacts/browser-qa.json'), JSON.stringify({ passed: true, errors, testedAt: new Date().toISOString() }, null, 2));
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
