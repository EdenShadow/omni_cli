import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
let fixture,until;
if(process.env.OMNI_WANWU_SOURCE)({fixture,until}=await import('./helpers/bridge-fixture.mjs'));
const integration=(name,fn)=>test(name,{skip:!process.env.OMNI_WANWU_SOURCE,timeout:30000},fn);
import {ChatKeyring} from '../lib/shared/chat-crypto.mjs';
import {DeviceScheduler} from '../lib/desktop/device-scheduler.mjs';
import {ENCRYPTED_SCHEDULE_PROMPT,scheduleContext,scheduledCommand} from '../lib/shared/encrypted-schedule.mjs';

const rule={kind:'interval',every:1,unit:'minutes',overlap:'wait'};
async function setup({protect=true}={}){
 const f=await fixture({requireEncryptedChat:true}),d=f.devices[0],p=f.project.id;
 for(const device of f.devices)device.b.scheduler.tick=async()=>{};
 let state;const ring=new ChatKeyring({load:async()=>state,save:async value=>{state=structuredClone(value);},request:(p,m,b)=>f.call(p,f.owner.token,m,b)});
 await until(async()=>{const r=await ring.sync(p);for(const device of f.devices)await device.b.chatEncryption.sync();return r.ready;});
 await until(async()=>{await ring.sync(p);try{for(const device of f.devices)await device.b.chatEncryption.ring().key(p);return true;}catch{return false;}});
 d.b.adapter().run=async(id,prompt,emit,options)=>{d.runs.push({id,prompt,options});return {};};
 if(protect)f.app.db.prepare('INSERT OR IGNORE INTO encrypted_chat_sessions VALUES(?)').run(d.session.id);
 let now=1000000;const scheduler=new DeviceScheduler(d.b,{now:()=>now});
 const list=()=>f.call(`/projects/${p}/schedules`,f.owner.token);
 const save=async(prompt='PRIVATE_SCHEDULE_每天更新账单',revision=0,options={access:'full',mode:'code',model:'test-model',effort:'high',serviceTier:'fast'},scheduleRule=rule)=>{
  const requestId=randomUUID(),secureSchedule=await ring.encrypt(p,scheduleContext({sessionId:d.session.id,userId:f.owner.user.id,requestId}),{prompt});
  return f.call(`/sessions/${d.session.id}/schedule`,f.owner.token,'PUT',{requestId,prompt:ENCRYPTED_SCHEDULE_PROMPT,secureSchedule,rule:scheduleRule,revision,options});
 };
 const waitRun=async count=>{await until(()=>d.runs.length===count&&d.b.busy.size===0);await until(()=>!f.app.db.prepare("SELECT 1 FROM commands WHERE session_id=? AND status NOT IN ('done','failed','cancelled')").get(d.session.id));};
 const noPlain=secrets=>{for(const {name} of f.app.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()){const data=JSON.stringify(f.app.db.prepare(`SELECT * FROM "${name}"`).all());for(const secret of secrets)assert(!data.includes(secret),`Plaintext leaked into ${name}`);}};
 return {...f,d,p,ring,scheduler,save,list,waitRun,noPlain,advance:ms=>now+=ms};
}

integration('encrypted schedules create, pause, resume, edit and repeatedly run on the target after the author logs out',async()=>{
 const f=await setup();try{
  let s=await f.save();assert.equal(s.encryptedChat,true);assert.equal(s.prompt,ENCRYPTED_SCHEDULE_PROMPT);
  assert.equal((await f.ring.decrypt(f.p,scheduleContext(s),s.secureSchedule)).prompt,'PRIVATE_SCHEDULE_每天更新账单');
  assert.deepEqual(await f.call(`/projects/${f.p}/schedules`,f.other.token),[]);
  await f.scheduler.tick();assert.equal((await f.list())[0].applied,true);
  s=await f.call(`/sessions/${f.d.session.id}/schedule`,f.owner.token,'PATCH',{enabled:false,revision:s.revision});await f.scheduler.tick();f.advance(61000);await f.scheduler.tick();assert.equal(f.d.runs.length,0);
  s=await f.call(`/sessions/${f.d.session.id}/schedule`,f.owner.token,'PATCH',{enabled:true,revision:s.revision});await f.scheduler.tick();
  s=await f.save('PRIVATE_EDITED_更新画布并同步',s.revision);await f.scheduler.tick();
  const stale=await scheduledCommand(f.ring,s,randomUUID());await assert.rejects(f.call(`/bridge/schedules/${s.id}/run`,f.d.bound.deviceToken,'POST',{id:randomUUID(),at:1000,revision:s.revision-1,...stale}),{status:409});
  // Recurrences use the target credential; the sender's login is no longer valid.
  f.app.db.prepare('DELETE FROM tokens WHERE user_id=? AND device_id IS NULL').run(f.owner.user.id);
  for(let count=1;count<=2;count++){f.advance(61000);await f.scheduler.tick();await f.waitRun(count);assert(f.d.runs[count-1].prompt.includes('PRIVATE_EDITED_更新画布并同步'));}
  const commands=f.app.db.prepare('SELECT * FROM commands WHERE session_id=?').all(f.d.session.id);assert.equal(commands.length,2);
  assert(commands.every(c=>c.user_id===f.owner.user.id&&c.prompt===ENCRYPTED_SCHEDULE_PROMPT));
  const opts=commands.map(c=>JSON.parse(f.app.db.prepare('SELECT doc FROM command_options WHERE command_id=?').get(c.id).doc));
  for(const opt of opts){assert.equal(opt.model,'test-model');assert.equal(opt.effort,'high');assert.equal(opt.serviceTier,'fast');assert(opt.secureCommand&&opt.secureDisplay);}
  assert.notEqual(opts[0].secureCommand.data,opts[1].secureCommand.data);
  assert(!JSON.stringify(f.d.b.store.deviceSchedules).includes('PRIVATE_EDITED_'));
  f.noPlain(['PRIVATE_SCHEDULE_每天更新账单','PRIVATE_EDITED_更新画布并同步']);
 }finally{await f.close();}
});

integration('encrypted schedule lost responses, restart and a reserved occurrence ID produce one command',async()=>{
 const f=await setup();try{
  const s=await f.save();await f.scheduler.tick();f.advance(61000);
  const local=()=>f.d.b.store.deviceSchedules.find(r=>r.id===s.id),reserved=randomUUID();
  f.app.db.prepare('INSERT INTO schedule_occurrences VALUES(?,?,?,?)').run(reserved,s.id,s.revision,local().nextAt);
  await f.scheduler.tick();assert.equal(local().pending.id,reserved);assert.equal(f.d.runs.length,0);
  const request=f.d.b.request;let lost=true;f.d.b.request=async(p,m,b,device)=>{const result=await request(p,m,b,device);if(lost&&p.endsWith('/run')){lost=false;throw Error('response lost');}return result;};
  await f.scheduler.tick();await f.waitRun(1);assert.equal(local().pending.id,reserved);
  const restarted=new DeviceScheduler(f.d.b,{now:()=>1062000});await restarted.tick();assert.equal(f.d.b.store.deviceSchedules.find(r=>r.id===s.id).pending,null);
  assert.equal(f.app.db.prepare('SELECT count(*) n FROM commands WHERE session_id=?').get(f.d.session.id).n,1);
  const command=JSON.parse(f.app.db.prepare('SELECT doc FROM command_options WHERE command_id=?').get(reserved).doc);
  assert.equal((await f.ring.decrypt(f.p,['command',f.d.session.id,reserved],command.secureCommand)).prompt,'PRIVATE_SCHEDULE_每天更新账单');
  await assert.rejects(f.ring.decrypt(f.p,['command',f.d.session.id,randomUUID()],command.secureCommand));
 }finally{await f.close();}
});

integration('plain saves and runs cannot bypass encryption; corrupt or cross-session ciphertext never starts a model',async()=>{
 const f=await setup();try{
  await assert.rejects(f.call(`/sessions/${f.d.session.id}/schedule`,f.owner.token,'PUT',{requestId:randomUUID(),prompt:'PRIVATE_PLAIN',rule}),{status:426});
  const s=await f.save();await f.scheduler.tick();f.advance(61000);
  await assert.rejects(f.call(`/bridge/schedules/${s.id}/run`,f.d.bound.deviceToken,'POST',{id:randomUUID(),revision:s.revision,at:1060000}),{status:426});
  const local=f.d.b.store.deviceSchedules.find(r=>r.id===s.id);local.secureSchedule={...local.secureSchedule,iv:Buffer.alloc(12,7).toString('base64')};
  await f.scheduler.tick();assert(f.d.b.store.deviceSchedules.find(r=>r.id===s.id).pending);assert(f.d.b.store.deviceSchedules.find(r=>r.id===s.id).error);assert.equal(f.d.runs.length,0);
  await assert.rejects(scheduledCommand(f.ring,{...s,sessionId:f.devices[1].session.id},randomUUID()));
  await assert.rejects(scheduledCommand(f.ring,{...s,userId:f.other.user.id},randomUUID()));
  await assert.rejects(scheduledCommand(f.ring,{...s,requestId:randomUUID()},randomUUID()));
  f.noPlain(['PRIVATE_PLAIN','PRIVATE_SCHEDULE_每天更新账单']);
 }finally{await f.close();}
});

integration('encrypted schedules retain device and author authorization when permissions change',async()=>{
 const f=await setup();try{
  const s=await f.save(),id=randomUUID(),body={id,revision:s.revision,at:1060000,...await scheduledCommand(f.ring,s,id)};
  await assert.rejects(f.call(`/bridge/schedules/${s.id}/run`,f.devices[1].bound.deviceToken,'POST',body),{status:404});
  await assert.rejects(f.call(`/bridge/schedules/${s.id}/run`,f.owner.token,'POST',body),{status:403});
  f.app.db.prepare('DELETE FROM members WHERE project_id=? AND user_id=?').run(f.p,f.owner.user.id);
  await assert.rejects(f.call(`/bridge/schedules/${s.id}/run`,f.d.bound.deviceToken,'POST',body),{status:403});assert.equal(f.d.runs.length,0);
 }finally{await f.close();}
});

integration('a legacy schedule still executes safely if its session later becomes encrypted',async()=>{
 const f=await setup({protect:false});try{
  const s=await f.call(`/sessions/${f.d.session.id}/schedule`,f.owner.token,'PUT',{requestId:randomUUID(),prompt:'Legacy scheduled work',rule,options:{access:'full'}});await f.scheduler.tick();
  f.app.db.prepare('INSERT INTO encrypted_chat_sessions VALUES(?)').run(f.d.session.id);f.advance(61000);await f.scheduler.tick();
  await f.waitRun(1);
  assert(f.d.runs[0].prompt.includes('Legacy scheduled work'));
  const c=f.app.db.prepare('SELECT * FROM commands WHERE session_id=?').get(f.d.session.id);assert.equal(c.prompt,ENCRYPTED_SCHEDULE_PROMPT);
  assert(JSON.parse(f.app.db.prepare('SELECT doc FROM command_options WHERE command_id=?').get(c.id).doc).secureCommand);
  const protectedSave=await f.save('PRIVATE_UPGRADED',s.revision);
  assert(protectedSave.secureSchedule);assert(!f.app.db.prepare('SELECT doc FROM device_schedules WHERE id=?').get(s.id).doc.includes('Legacy scheduled work'));
 }finally{await f.close();}
});

integration('encrypted skipped occurrences stay skipped after a lost response without a catch-up duplicate',async()=>{
 const f=await setup();try{
  const s=await f.save('PRIVATE_SKIP',0,undefined,{...rule,overlap:'skip'});await f.scheduler.tick();f.advance(61000);
  const request=f.d.b.request;let lose=true;
  f.d.b.request=async(p,m,b,device)=>{
   if(lose&&p.endsWith('/run')){lose=false;f.app.db.prepare("UPDATE sessions SET status='working' WHERE id=?").run(f.d.session.id);const result=await request(p,m,b,device);assert.equal(result.status,'skipped');throw Error('response lost');}
   return request(p,m,b,device);
  };
  await f.scheduler.tick();assert(f.d.b.store.deviceSchedules.find(r=>r.id===s.id).pending);
  f.app.db.prepare("UPDATE sessions SET status='idle' WHERE id=?").run(f.d.session.id);await f.scheduler.tick();assert.equal(f.d.runs.length,0);
  assert.equal(f.d.b.store.deviceSchedules.find(r=>r.id===s.id).pending,null);
  f.advance(61000);await f.scheduler.tick();await f.waitRun(1);f.noPlain(['PRIVATE_SKIP']);
 }finally{await f.close();}
});
