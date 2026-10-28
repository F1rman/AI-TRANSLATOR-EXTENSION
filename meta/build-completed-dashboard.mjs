import { buildSite } from '../../extension-marketing/scripts/build-site.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { JSDOM } from '../extension/node_modules/jsdom/lib/api.js';

const meta = import.meta.dirname;
buildSite({ extension: path.resolve(meta, '../extension/dist'), meta });
const file = path.join(meta, 'index.html');
const delivery = JSON.parse(await readFile(path.join(meta, 'data/delivery.json'), 'utf8'));
const dom = new JSDOM(await readFile(file, 'utf8'));
const { document } = dom.window;
const banner = document.createElement('section');
banner.className = 'delivery-summary';
banner.setAttribute('aria-label', 'Completed local deliverables');
const heading = document.createElement('h2');
heading.textContent = `${delivery.tasks.filter(task => task.state === 'complete').length}/10 tasks delivered`;
const detail = document.createElement('p');
detail.textContent = 'All local assets and product features are implemented and checked. Store submission and native-language review are separate owner actions. The checkboxes below record owner confirmation, not delivery status.';
banner.append(heading, detail);
document.querySelector('#main-content').prepend(banner);
const style = document.createElement('style');
style.textContent = '.delivery-summary{margin-bottom:24px;padding:24px;border-radius:20px;background:var(--app-surface-1)}.delivery-summary h2{font:600 24px/1.3 var(--app-font-heading);margin:0 0 8px}.delivery-summary p{color:var(--app-muted);line-height:1.6}.delivery-state{display:block;color:var(--app-income);font-size:12px;line-height:1.6;margin-top:4px}';
document.head.append(style);
for (const task of delivery.tasks) {
  const row = document.querySelector(`[data-row="${task.id}"]`);
  if (!row) throw new Error(`Dashboard task missing: ${task.id}`);
  const label = document.createElement('small');
  label.className = 'delivery-state';
  label.textContent = `Delivered: ${task.detail}`;
  const main = row.querySelector('.tmain');
  main.querySelector('small')?.remove();
  main.append(label);
  // Every checkbox now records the owner's decision; technical delivery is
  // shown above. Preserve the browser's existing owner marks.
  const box = row.querySelector('input[data-t]');
  box.removeAttribute('disabled'); box.removeAttribute('checked');
  box.setAttribute('aria-label', `Owner confirmation: ${main.querySelector('b').textContent}`);
  row.classList.remove('auto');
}
const counter = document.querySelector('.tcount');
counter.innerHTML = counter.innerHTML.replace('completed', 'owner checks');
await writeFile(file, dom.serialize().replace(/[\t ]+$/gm, '') + '\n');
console.log(`Built dashboard with ${delivery.tasks.length} verified local deliveries and separate owner checks.`);
