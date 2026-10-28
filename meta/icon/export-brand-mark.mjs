// Exact procedural mark from extension/scripts/build.mjs, exported larger for
// marketing only. Geometry, colors and sampling are unchanged; no redesign.
import { readFile, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
const source=await readFile(new URL('../../extension/scripts/build.mjs',import.meta.url),'utf8');
const start=source.indexOf('const crcTable =');const end=source.indexOf('console.log(`Built extension/',start);
if(start<0||end<0)throw new Error('Packaged icon generator not found');
let code=source.slice(start,end).replace('await mkdir(`${outDir}/icons`, { recursive: true });','').replace('for (const size of [16, 32, 48, 128])','for (const size of [1024])').replace('`${outDir}/icons/${size}.png`','new URL(`brand-mark-${size}.png`, import.meta.url)');
code=code.replaceAll('import.meta.url',JSON.stringify(import.meta.url));
await (new Function('writeFile','deflateSync',`return (async()=>{${code}})()`))(writeFile,deflateSync);
console.log('Exported unchanged procedural brand mark at 1024px for crisp marketing promos.');
