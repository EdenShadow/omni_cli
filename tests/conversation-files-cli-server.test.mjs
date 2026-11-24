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

integration('scoped security reports travel from the included skill through the CLI device',async()=>{
  const f=await fixture();
  try{
    const d=f.devices[0];
    const id=await enqueue(f,d,'Security integration fixture',f.other.token);
    const scope=await until(()=>[...d.b.skillExchange.tokens.values()].find(s=>s.commandId===id));
    const script=fileURLToPath(new URL('../bundled-skills/wanwu-skills-sync/scripts/sync.mjs',import.meta.url));
    await promisify(execFile)(process.execPath,[script,'--context',scope.file,'--scope',id,'security-report','--reason','private-file-read'],{windowsHide:true});
    assert.equal(f.app.db.prepare('SELECT count(*) n FROM command_security_incidents').get().n,1);
    assert.equal(f.app.db.prepare('SELECT status FROM commands WHERE id=?').get(id).status,'done');
  }finally{await f.close();}
});

integration('the full client restores a previously bound installation without creating a second device',async()=>{
  const {client}=await import('../src/client.mjs');
  const f=await fixture();const installation=randomUUID();
  const runtimeDirectory=process.env.WANWU_RUNTIME_DIR;
  try{
    const bound=await f.call('/devices/bind',f.owner.token,'POST',{installation,name:'CLI restore fixture',platform:'test',runtimes:['codex']});
    const store={token:f.owner.token,userId:f.owner.user.id,device:bound.device,deviceToken:'expired-fixture',installation,endpoint:f.devices[0].b.store.endpoint};
    process.env.WANWU_RUNTIME_DIR=path.join(f.dir,'runtime');
    const bridge=client({store,directory:f.dir,save(){}});
    try{
      await Promise.all([bridge.recoverBinding(true),bridge.recoverBinding(true)]);
      assert.equal(store.device.id,bound.device.id);assert.ok(store.deviceToken&&store.deviceToken!=='expired-fixture');
      assert.deepEqual(await f.call('/bridge/commands',store.deviceToken),[]);
    }finally{bridge.stop();}
  }finally{
    if(runtimeDirectory===undefined)delete process.env.WANWU_RUNTIME_DIR;else process.env.WANWU_RUNTIME_DIR=runtimeDirectory;
    await f.close();
  }
});
