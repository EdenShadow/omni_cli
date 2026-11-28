import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {RuntimeBridge} from '../lib/desktop/bridge.mjs';
import {SkillExchange} from '../lib/desktop/skills/exchange.mjs';

test('headless source reads an exact peer turn with the bundled skill and bridge', {skip:!process.env.OMNI_WANWU_SOURCE}, async()=>{
  const {fixture,enqueue,until}=await import(pathToFileURL(path.join(process.env.OMNI_WANWU_SOURCE,'tests/helpers/scene-assistant-fixture.mjs')));
  const f=await fixture({Bridge:RuntimeBridge,Exchange:SkillExchange});
  try{
    const [a,b]=f.devices,work=await enqueue(f,b,'Check the fixture');
    await until(()=>b.runs.length);
    b.b.enqueue(b.session.id,{commandId:work,id:randomUUID(),role:'assistant',kind:'message',phase:'final_answer',text:'headless result'});
    await b.b.flush();b.finish();await until(()=>!b.b.busy.size);
    const command=await enqueue(f,a,'Read that peer');await until(()=>a.runs.length);
    const {stdout}=await promisify(execFile)(process.execPath,['bundled-skills/wanwu-skills-sync/scripts/sync.mjs','--context',path.join(a.dataDir,'skill-contexts',command+'.json'),'work-read','--device',b.bound.device.id,'--session',b.session.id]);
    assert.equal(JSON.parse(stdout).results[0].turns[0].reply,'headless result');assert.equal(b.runs.length,1);
  }finally{await f.close();}
});
