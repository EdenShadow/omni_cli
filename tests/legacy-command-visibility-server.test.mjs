import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const integration=(name,fn)=>test(name,{skip:!process.env.OMNI_WANWU_SOURCE,timeout:60000},fn);
let fixture,until;if(process.env.OMNI_WANWU_SOURCE)({fixture,until}=await import('./helpers/bridge-fixture.mjs'));
import {ChatKeyring} from '../lib/shared/chat-crypto.mjs';

async function setup(f){
 let saved;
 const ring=new ChatKeyring({load:async()=>saved,save:async s=>{saved=structuredClone(s);},request:(p,m,b)=>f.call(p,f.owner.token,m,b)});
 await until(async()=>{for(const d of f.devices)await d.b.chatEncryption.sync();return (await ring.sync(f.project.id)).ready;});
 for(const d of f.devices){await d.b.chatEncryption.sync();d.b.pump=async()=>{};}
 const d=f.devices[0],sid=d.session.id,p=f.project.id;
 const submit=async(prompt,extra={},display)=>{
  const id=randomUUID();
  await f.call(`/sessions/${sid}/commands`,f.owner.token,'POST',{id,prompt:'[加密会话消息 / Encrypted session message]',secureCommand:await ring.encrypt(p,['command',sid,id],{prompt,files:[]}),...(display?{secureDisplay:await ring.encrypt(p,['command-display',sid,id],display)}:{}),...extra});return id;
 };
 const read=async id=>(await f.call(`/sessions/${sid}/commands`,f.other.token)).find(c=>c.id===id);
 return {d,sid,p,ring,submit,read};
}

integration('first encrypted sends respect explicit choice; legacy queue visibility resolves before any runtime starts',async()=>{
 const f=await fixture({requireEncryptedChat:true});try{
  const {d,submit,read}=await setup(f);
  const ordinary=await submit('Please summarize the document'),privateId=await submit('Please summarize the document',{messagePrivate:true}),publicId=await submit('key was discussed intentionally',{messagePrivate:false});
  assert.equal((await read(publicId)).messagePrivate,false);
  assert.equal((await read(privateId)).messagePrivate,true);
  assert.equal((await read(ordinary)).messagePrivate,true,'unknown legacy content must not leak before classification');
  const commands=await f.call('/bridge/commands',d.bound.deviceToken);
  d.b.chatEncryption.resolveQueuedVisibility(commands);
  await until(async()=>(await read(ordinary)).messagePrivate===false);
  assert.equal(d.runs.length,0,'classification must not wait for execution');
  assert.equal((await read(privateId)).messagePrivate,true);
  await f.restart();
  assert.equal((await read(ordinary)).messagePrivate,false);
  assert.equal((await read(privateId)).messagePrivate,true);
 }finally{await f.close();}
});

integration('legacy history uses original source, preserves secrets/manual choices and only assigned device can classify',async()=>{
 const f=await fixture({requireEncryptedChat:true});try{
  const {d,sid,p,submit,read}=await setup(f);
  const ordinary=await submit('Hello there'),secret=await submit('password: fixture-only-secret'),masked=await submit('Previously hidden submission',{}, {prompt:'***',maskedPreview:'hidden',files:[]}),locked=await submit('Hello again');
  await f.call(`/commands/${locked}/visibility`,f.owner.token,'PATCH',{messagePrivate:true});
  for(const token of [f.owner.token,f.other.token])await assert.rejects(f.call(`/bridge/commands/${ordinary}/display`,token),{status:403});
  await assert.rejects(f.call(`/bridge/commands/${ordinary}/display`,f.devices[1].bound.deviceToken),{status:404});
  const m=d.b.mappings[sid];m.encryptedChat=true;m.groupChat={...m.groupChat,projectId:p};
  const page={items:[{id:'one',commandId:ordinary,role:'user',text:'Hello there\nInjected skill API key instructions'},{id:'two',commandId:secret,role:'user',text:'***'},{id:'three',commandId:masked,role:'user',text:'***'},{id:'four',commandId:locked,role:'user',text:'Hello again'}]};
  await d.b.chatEncryption.history({sessionId:sid},page);
  assert.equal((await read(ordinary)).messagePrivate,false,'injected runtime text cannot make a normal message private');
  for(const id of [secret,masked,locked])assert.equal((await read(id)).messagePrivate,true,'masked history must not publish secrets or manual locks');
  assert.deepEqual(await f.call(`/bridge/commands/${secret}/display`,d.bound.deviceToken),{resolved:true});
  const request=d.b.request;d.b.request=(path,...args)=>{assert.ok(!path.endsWith('/display'),'Resolved history must use the cache');return request(path,...args);};
  await d.b.chatEncryption.history({sessionId:sid},page);d.b.request=request;
  const stale=await submit('Original draft'),opt=JSON.parse(f.app.db.prepare('SELECT doc FROM command_options WHERE command_id=?').get(stale).doc);
  f.app.db.prepare('UPDATE command_options SET doc=? WHERE command_id=?').run(JSON.stringify({...opt,queueRevision:randomUUID()}),stale);
  await assert.rejects(f.call(`/bridge/commands/${stale}/display`,d.bound.deviceToken,'POST',{messagePrivate:false,queueRevision:null}),{status:409});
  assert.equal((await read(stale)).messagePrivate,true);
 }finally{await f.close();}
});
