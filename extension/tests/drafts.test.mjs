import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

test('text drafts and pending requests are isolated by UID and environment without reading legacy shared values',async()=>{
 const values={textDraft:{input:'legacy private',output:'legacy output'},pendingText:{segments:[{id:'text',text:'legacy pending'}]}};
 const old=globalThis.chrome;
 globalThis.chrome={storage:{session:{async get(keys){return Object.fromEntries(keys.map(key=>[key,values[key]]))},async set(next){Object.assign(values,next)},async remove(key){delete values[key]}}}};
 try{
  const code=await build({stdin:{contents:'export * from "./src/shared/drafts";',resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'iife',globalName:'drafts',write:false});
  const drafts=new Function(code.outputFiles[0].text+';return drafts')();
  const pending={sourceLanguage:'auto',targetLanguage:'Ukrainian',segments:[{id:'text',text:'privateA'}],idempotencyKey:'a'};
  await drafts.savePendingText('live','userA',pending);
  await drafts.saveTextDraft('live','userA',{input:'privateA',output:'resultA'});
  assert.deepEqual(await drafts.readTextSession('live','userB'),{draft:undefined,pending:undefined});
  assert.deepEqual(await drafts.readTextSession('test','userA'),{draft:undefined,pending:undefined});
  assert.deepEqual((await drafts.readTextSession('live','userA')).pending,pending);
  await drafts.removePendingText('live','userB');
  assert.deepEqual((await drafts.readTextSession('live','userA')).draft,{input:'privateA',output:'resultA'});
  await drafts.removePendingText('live','userA');
  assert.equal((await drafts.readTextSession('live','userA')).pending,undefined);
 }finally{globalThis.chrome=old;}
});
