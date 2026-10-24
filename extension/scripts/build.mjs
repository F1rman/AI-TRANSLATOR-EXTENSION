import { build, loadEnv } from 'vite';
import { build as bundle } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
const env = { ...loadEnv('production', process.cwd(), ''), ...process.env };
const packageInfo = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const publicKey = (env.EXTENSION_PUBLIC_KEY || await readFile(new URL('../store-public-key.txt', import.meta.url), 'utf8')).trim();
await build();
await bundle({ entryPoints: ['src/content/index.ts'], bundle: true, outfile: 'dist/content.js', format: 'iife', target: 'chrome120', minify: true });
const manifest = {
  manifest_version: 3, name: 'AI Translator', version: packageInfo.version, minimum_chrome_version: '120',
  description: 'Translate selected text and whole webpages with AI. Restore originals in one click.',
  homepage_url: 'https://ai-translator-ext.web.app',
  permissions: ['activeTab', 'contextMenus', 'storage', 'scripting', 'identity', 'webNavigation'],
  host_permissions: ['http://*/*', 'https://*/*'],
  background: { service_worker: 'background.js', type: 'module' },
  action: { default_popup: 'popup.html', default_title: 'AI Translator', default_icon: { 16: 'icons/16.png', 32: 'icons/32.png' } },
  options_ui: { page: 'options.html', open_in_tab: true },
  icons: { 16: 'icons/16.png', 32: 'icons/32.png', 48: 'icons/48.png', 128: 'icons/128.png' },
  content_scripts: [{ matches: ['http://*/*', 'https://*/*'], js: ['content.js'], all_frames: true, run_at: 'document_idle', match_about_blank: false }],
  content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'" },
  ...(env.VITE_GOOGLE_CLIENT_ID ? { oauth2: { client_id: env.VITE_GOOGLE_CLIENT_ID, scopes: ['openid', 'email', 'profile'] } } : {}),
  ...(publicKey ? { key: publicKey } : {}),
};
await writeFile('dist/manifest.json', JSON.stringify(manifest, null, 2));
const crcTable = Array.from({ length: 256 }, (_, value) => { for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1; return value >>> 0; });
function chunk(type, bytes) { const data = Buffer.concat([Buffer.from(type), bytes]); let crc = 0xffffffff; for (const byte of data) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8); const len = Buffer.alloc(4), sum = Buffer.alloc(4); len.writeUInt32BE(bytes.length); sum.writeUInt32BE((crc ^ 0xffffffff) >>> 0); return Buffer.concat([len, data, sum]); }
await mkdir('dist/icons', { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const rows = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let red = 0, green = 0, blue = 0, alpha = 0;
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
      const px = (x + (sx + .5) / 4) / size * 32, py = (y + (sy + .5) / 4) / size * 32;
      const qx = Math.max(Math.abs(px - 16) - 9, 0), qy = Math.max(Math.abs(py - 16) - 9, 0);
      if (qx * qx + qy * qy > 49) continue;
      const sparkle = Math.sqrt(Math.abs(px - 16) / 10.7) + Math.sqrt(Math.abs(py - 16) / 10.7) < 1 || (px - 25) ** 2 + (py - 6.5) ** 2 < 2;
      const color = sparkle ? [233, 186, 99] : [38, 48, 39]; red += color[0]; green += color[1]; blue += color[2]; alpha++;
    }
    const index = y * (size * 4 + 1) + 1 + x * 4;
    rows[index] = alpha ? red / alpha : 0; rows[index + 1] = alpha ? green / alpha : 0; rows[index + 2] = alpha ? blue / alpha : 0; rows[index + 3] = alpha / 16 * 255;
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  await writeFile(`dist/icons/${size}.png`, Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]));
}
console.log('Built extension/dist (load unpacked or package for Chrome Web Store).');
