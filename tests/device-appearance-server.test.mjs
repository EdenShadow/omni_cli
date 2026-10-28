import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {RuntimeBridge} from '../lib/desktop/bridge.mjs';
import {SkillExchange} from '../lib/desktop/skills/exchange.mjs';
const sync=fileURLToPath(new URL('../bundled-skills/wanwu-skills-sync/scripts/sync.mjs',import.meta.url));
test('headless CLI ordinary session redesigns a separate device and shares it with desktop/web', {skip:!process.env.OMNI_WANWU_SOURCE,timeout:60000}, async()=>{
 const {fixture,enqueue,until}=await import(pathToFileURL(path.join(process.env.OMNI_WANWU_SOURCE,'tests/helpers/scene-assistant-fixture.mjs')));
 const f=await fixture({Bridge:RuntimeBridge,Exchange:SkillExchange});
 try{
  const d=f.devices[0],target=f.devices[1].bound.device.id,command=await enqueue(f,d,'重新设计另一台电脑的外观');await until(()=>d.runs.length);
  const file=path.join(d.dataDir,'skill-contexts',command+'.json'),cli=async(...args)=>JSON.parse((await promisify(execFile)(process.execPath,[sync,'--context',file,...args])).stdout);
  assert.equal((await cli('context')).capabilities.sceneDevices,true);
  const before=await f.call(`/projects/${f.project.id}/snapshot`,f.owner.token);
  const id=randomUUID(),workspace=path.join(f.dir,id),args=['--request',id,'--workspace',workspace];
  const prepared=await cli('scene-prepare',...args,'--kind','device','--device',target,'--text','保留完整静态外观，修改为浮空电脑');
  assert.equal(prepared.targetDevice.id,target);
  assert.equal(JSON.parse(readFileSync(path.join(workspace,'SCENE_CONTEXT.json'),'utf8')).targetDevice.id,target);
  await cli('scene-preview',...args);const result=await cli('scene-apply',...args);assert.equal(result.status,'applied');assert.equal(result.deviceId,target);
  assert.equal((await cli('scene-apply',...args)).assetId,result.assetId);
  const desktop=await f.call(`/projects/${f.project.id}/snapshot`,f.owner.token),web=await f.call(`/projects/${f.project.id}/snapshot`,f.other.token);
  for(const s of [desktop,web])assert.equal(s.devices.find(d=>d.id===target).appearance.assetId,result.assetId);
  assert.deepEqual(desktop.sessions,before.sessions);assert.deepEqual(desktop.project,before.project);
  assert.equal((await cli('scene-context')).devices.find(d=>d.id===target).appearanceAssetId,result.assetId);
 }finally{await f.close();}
});
