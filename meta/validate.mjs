import { readFile, readdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const meta = import.meta.dirname;
const json = async file => JSON.parse(await readFile(path.join(meta, file), 'utf8'));
const checks=[];
const verify = (name, fn) => { fn(); checks.push({name,passed:true}); };
const names=await json('data/names.json');
verify('Five names and five short descriptions within Store limits',()=>{
 assert.equal(names.names.length,5);assert.equal(names.shortDescriptions.length,5);
 for(const option of names.names) assert.ok([...option.text].length<=75);
 for(const option of names.shortDescriptions) assert.ok([...option.text].length<=132);
 assert.ok(names.names[names.recommended.name]);assert.ok(names.shortDescriptions[names.recommended.short]);
});
const description=await readFile(path.join(meta,'descriptions/en.txt'),'utf8');
const wordCount=description.trim().split(/\s+/).length;
verify('Full English copy is plain text, 250–600 words, and uses primary at most four times',()=>{
 assert.ok(wordCount>=250&&wordCount<=600,`${wordCount} words`);
 assert.ok(!/(\*\*|__|^#{1,6} |^```)/m.test(description));
 const count=description.toLowerCase().split(names.primaryKeyword.toLowerCase()).length-1;
 assert.ok(count>=1&&count<=4,`${count} keyword repetitions`);
});
const manifest=JSON.parse(await readFile(path.join(root,'extension/dist/manifest.json'),'utf8'));
const form=await json('data/dashboard.json');
verify('Store form covers every permission and host pattern',()=>{
 for(const name of [...manifest.permissions,...manifest.host_permissions]) assert.ok(form.permissions.some(p=>p.permission===name),`Missing ${name}`);
});
const expected=[['promo/small-440x280.png',440,280],['promo/small-440x280-b.png',440,280],['promo/small-440x280-c.png',440,280],['promo/marquee-1400x560.png',1400,560],...Array.from({length:5},(_,i)=>[`screenshots/${i+1}.png`,1280,800])];
const imageFacts=[];
for(const [file,width,height] of expected){
 const bytes=await readFile(path.join(meta,file));
 const actual=[bytes.readUInt32BE(16),bytes.readUInt32BE(20)];
 verify(`${file} dimensions`,()=>{assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.deepEqual(actual,[width,height]);});
 imageFacts.push({file,width,height,bytes:bytes.length});
}
for(let i=1;i<=5;i++)await readFile(path.join(meta,`screenshots/prompts/${i}.md`),'utf8');
for(const file of ['promo/prompts/small-440x280.md','promo/prompts/marquee-1400x560.md','icon/prompt.md'])await readFile(path.join(meta,file),'utf8');
checks.push({name:'Image prompts present',passed:true});
const recommendations=await json('data/recommendations.json');
verify('Missing review/welcome features have adapted code drafts',()=>{
 for(const feature of ['review','welcome'])assert.ok(recommendations.some(r=>r.title.toLowerCase().includes(feature)&&r.code));
});
const descriptionFiles=(await readdir(path.join(meta,'descriptions'))).filter(name=>name.endsWith('.txt'));
verify('English locale draft is present; 55-locale translation not falsely claimed',()=>{
 assert.ok(description);assert.equal(descriptionFiles.length,1);
});
const baseline=await json('data/workspace-baseline.json');
const diff=execFileSync('git',['diff','--binary','--','.',':(exclude)meta/**'],{cwd:root});
const status=execFileSync('git',['status','--porcelain=v1'],{cwd:root,encoding:'utf8'}).split('\n').filter(line=>line&& !line.slice(3).startsWith('meta/')).join('\n');
verify('All existing changes outside meta preserved exactly',()=>{
 assert.equal(createHash('sha256').update(diff).digest('hex'),baseline.nonMetaTrackedDiffSha256);
 assert.equal(status,baseline.nonMetaGitStatus);
});
const report={checkedAt:new Date().toISOString(),success:true,wordCount,checks,images:imageFacts};
await writeFile(path.join(meta,'data/validation.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({success:true,checks:checks.length,wordCount,images:imageFacts.length}));
