import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const integration=(name,fn)=>test(name,{skip:!process.env.OMNI_WANWU_SOURCE,timeout:60000},fn);
let fixture,enqueue,until;if(process.env.OMNI_WANWU_SOURCE)({fixture,enqueue,until}=await import('./helpers/bridge-fixture.mjs'));
integration('bundled conversation-files command delivers through the CLI bridge without public chat or duplicate files',async()=>{
 const objects=new Map(),storage={info:{configured:true},putFile:async(k,f)=>objects.set(k,readFileSync(f)),get:async k=>objects.get(k),remove:async k=>objects.delete(k)};
 const f=await fixture({outputStorage:storage});
 try{
  const d=f.devices[0],commandId=await enqueue(f,d,'Deliver the requested attachment here');
  await until(()=>d.runs.length);
  const scope=await until(()=>[...d.b.skillExchange.tokens.values()].find(s=>s.commandId===commandId));
  const selected=path.join(f.dir,'delivery-fixture.zip');writeFileSync(selected,'public attachment fixture');
  const requestId=randomUUID(),script=fileURLToPath(new URL('../bundled-skills/wanwu-skills-sync/scripts/sync.mjs',import.meta.url));
  const invoke=async()=>JSON.parse((await promisify(execFile)(process.execPath,[script,'--context',scope.file,'conversation-files','--request',requestId,'--file',selected,'--text','文件在这里'],{windowsHide:true})).stdout);
  const result=await invoke();assert.equal(result.destination,'conversation');assert.equal(result.sessionId,d.session.id);assert.equal(result.files[0].name,'delivery-fixture.zip');
  const again=await invoke();assert.deepEqual(again,result);assert.equal(objects.size,1);assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM conversation_files').get().n,1);assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM team_chat').get().n,0);
  d.finish();await until(()=>d.b.busy.size===0);
  await assert.rejects(invoke());assert.equal(f.app.db.prepare('SELECT COUNT(*) n FROM team_chat').get().n,0);
 }finally{await f.close();}
});
