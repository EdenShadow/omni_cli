import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {loadState,lock} from '../src/state.mjs';
import {createChat,botCommandId} from '../src/chat.mjs';
import {chatStore} from '../src/chat-store.mjs';
import {createRoomKey,seal,open,wrapRoomKey} from '../lib/shared/chat-crypto.mjs';
const exec=promisify(execFile);
function stateFor(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'omni-chat-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const state=loadState(dir);Object.assign(state.store,{endpoint:'https://test.invalid',userId:randomUUID(),token:'test-only'});state.save();return state;
}
async function fixture(t){
  const state=stateFor(t),project=randomUUID(),messages=[],bodies=[],clients=new Map(),events=[];let key=await createRoomKey(),loseReply=false,rotation=false;
  const request=async(p,method='GET',body)=>{
    const u=new URL(p,'https://test.invalid');
    if(u.pathname.endsWith('/chat-keys/clients')){clients.set(body.id,body);return {};}
    if(u.pathname.endsWith('/chat-keys'))return {active:key.id,epoch:'1',clients:[...clients.values()],missing:[],envelopes:[{keyId:key.id,wrapped:await wrapRoomKey(key,clients.get(u.searchParams.get('clientId')))}]};
    if(method==='POST'){
      bodies.push(structuredClone(body));
      if(rotation){rotation=false;key=await createRoomKey();throw Object.assign(Error('CHAT_KEY_EPOCH_CHANGED'),{status:409});}
      const old=messages.find(m=>m.clientId===body.id);if(old)return old;
      const m={id:randomUUID(),seq:messages.length+1,projectId:project,clientId:body.id,senderId:state.store.userId,userId:state.store.userId,secure:body.secure,replyTo:body.replyTo,attachments:[]};messages.push(m);
      if(loseReply){loseReply=false;throw Error('Lost acknowledgement');}return m;
    }
    if(u.searchParams.has('around'))return {messages,hasMore:false};
    if(u.searchParams.get('tasks')==='1')return {messages:messages.filter(m=>m.botTask)};
    if(u.searchParams.has('recallsAfter'))return {messages:[],recallCursor:0,hasMore:false};
    const limit=Number(u.searchParams.get('limit')||100),after=u.searchParams.get('after'),before=u.searchParams.get('before');
    const rows=after!==null?messages.filter(m=>m.seq>Number(after)):messages.filter(m=>before===null||m.seq<Number(before));
    return {messages:after!==null?rows.slice(0,limit):rows.slice(-limit),hasMore:rows.length>limit,retentionDays:7};
  };
  const storage=chatStore(state,request),chat=createChat({request,storage,userId:state.store.userId,emit:e=>events.push(e),sleep:async()=>{throw Error('Unexpected sleep');}});
  return {state,project,messages,bodies,events,request,storage,chat,get key(){return key;},loseReply(){loseReply=true;},rotate(){rotation=true;}};
}

test('encrypted @Bot send, stable retry, key rotation and private on-disk state',async t=>{
  const f=await fixture(t),id=randomUUID(),input={id,text:'@Bot 帮我整理一个 PRIVATE_TEST_ONLY'};
  f.loseReply();await assert.rejects(f.chat.send(f.project,input),/Lost acknowledgement/);
  const result=await f.chat.send(f.project,input);assert.equal(f.messages.length,1);assert.equal(result.id,f.messages[0].id);assert.notEqual(result.id,id);
  assert.deepEqual(f.bodies[0],f.bodies[1]);assert.equal(f.bodies[0].text,undefined);assert.equal(f.bodies[0].botRequest,true);
  const display=await open(f.key,[f.project,f.state.store.userId,id],f.bodies[0].secure);
  assert.equal(display.text,input.text);assert.equal(display.mentions[0].kind,'bot');
  assert.deepEqual(await open(f.key,[f.project,f.state.store.userId,id],f.bodies[0].secureExecution),display);
  await assert.rejects(f.chat.send(f.project,{...input,text:'different'}),/different content/);
  assert.equal(f.bodies.length,2);
  const disk=fs.readFileSync(path.join(f.storage.directory,`request-${f.project}-${id}.json`),'utf8');assert.ok(!disk.includes('PRIVATE_TEST_ONLY'));
  if(process.platform!=='win32')assert.equal(fs.statSync(path.join(f.storage.directory,'keys.json')).mode&0o777,0o600);
  f.rotate();const second=await f.chat.send(f.project,{text:'普通消息'});assert.equal(second.botRequested,false);assert.equal(f.messages.length,2);
  assert.equal((await f.chat.list(f.project)).messages[1].text,'普通消息');
});

test('separate chat processes serialize keys without locking or rewriting the device state',async t=>{
  const f=await fixture(t),before=fs.readFileSync(path.join(f.state.directory,'state.json'),'utf8'),release=lock(f.state.directory);t.after(release);
  const other=createChat({request:f.request,storage:chatStore(f.state,f.request),userId:f.state.store.userId});
  await Promise.all([f.chat.send(f.project,{text:'one'}),other.send(f.project,{text:'two'})]);
  assert.equal(f.messages.length,2);assert.equal(fs.readFileSync(path.join(f.state.directory,'state.json'),'utf8'),before);
  const keys=JSON.parse(fs.readFileSync(path.join(f.storage.directory,'keys.json')));assert.equal(Object.keys(keys.keys[f.project]).length,1);
});

test('history decrypts legacy and encrypted messages; rejects tampering and never outputs file keys',async t=>{
  const f=await fixture(t);await f.chat.send(f.project,{text:'加密消息'});
  f.messages.push({id:randomUUID(),seq:2,text:'legacy',kind:'text',attachments:[]});
  const page=await f.chat.list(f.project,{limit:1});assert.equal(page.messages[0].text,'legacy');assert.equal(page.hasMore,true);
  assert.equal((await f.chat.list(f.project,{before:2})).messages[0].text,'加密消息');
  const m=f.messages[0],encrypted=m.secure;
  m.replyTo=randomUUID();await assert.rejects(f.chat.list(f.project),/reply reference|payload/);delete m.replyTo;
  m.secure={...encrypted,data:encrypted.data.slice(0,10)+(encrypted.data[10]==='A'?'B':'A')+encrypted.data.slice(11)};
  await assert.rejects(f.chat.list(f.project));m.secure=encrypted;
  const file={v:1,id:randomUUID(),name:'photo.png',mime:'image/png',size:20,key:'DO_NOT_OUTPUT',prefix:'DO_NOT_OUTPUT'};
  m.attachments=[{id:randomUUID(),size:36}];m.secure=await seal(f.key,[f.project,m.senderId,m.clientId],{kind:'text',text:'file',files:[file]});
  const output=JSON.stringify(await f.chat.list(f.project));assert.ok(output.includes('photo.png'));assert.ok(!output.includes('DO_NOT_OUTPUT'));assert.ok(!output.includes('secure'));
  m.recalledAt=1;assert.equal((await f.chat.list(f.project,{before:2})).messages[0].text,'');
});

test('wait drains paginated interleaved replies and observes same-seq terminal status',async t=>{
  const f=await fixture(t),receipt=await f.chat.send(f.project,{text:'@Bot test'}),original=f.messages[0];original.botTask={status:'running'};
  for(let i=0;i<220;i++)f.messages.push({id:randomUUID(),seq:i+2,kind:'text',text:'reply'+i,replyTo:i%40===0?original.id:randomUUID(),attachments:[]});
  f.messages.push({id:randomUUID(),seq:222,kind:'text',text:'old server result',bot:{commandId:botCommandId(original.id,3)},attachments:[]});
  let sleeps=0;
  const chat=createChat({request:f.request,storage:f.storage,userId:f.state.store.userId,emit:e=>f.events.push(e),sleep:async()=>{sleeps++;original.botTask={status:'done'};f.messages.push({id:randomUUID(),seq:223,text:'final',kind:'text',replyTo:original.id,attachments:[]});}});
  assert.equal(await chat.wait(f.project,receipt.id),'done');assert.equal(sleeps,1);
  const replies=f.events.filter(e=>e.type==='message');assert.equal(replies.length,8);assert.equal(replies.at(-1).message.text,'final');
  assert.equal(new Set(replies.map(e=>e.message.id)).size,8);assert.equal(f.events.at(-1).status,'done');
});

test('wait reports failure and recall, not successful completion',async t=>{
  const f=await fixture(t),r=await f.chat.send(f.project,{text:'@Bot test'});f.messages[0].botTask={status:'unavailable'};
  assert.equal(await f.chat.wait(f.project,r.id),'unavailable');f.messages[0].recalledAt=1;
  assert.equal(await f.chat.wait(f.project,r.id),'recalled');
});

test('watch emits task changes without new seq, recalls and resumable cursors',async t=>{
  const f=await fixture(t),r=await f.chat.send(f.project,{text:'@Bot test'});f.messages[0].botTask={status:'queued'};
  const abort=new AbortController();let ticks=0;
  const request=async(p,...args)=>p.includes('recallsAfter')?{messages:ticks?[{id:r.id,recalledAt:1}]:[],recallCursor:ticks?1:0,hasMore:false}:f.request(p,...args);
  const chat=createChat({request,storage:f.storage,userId:f.state.store.userId,signal:abort.signal,emit:e=>f.events.push(e),sleep:async()=>{if(++ticks===2)abort.abort();else f.messages[0].botTask={status:'running'};}});
  await assert.rejects(chat.watch(f.project,{after:0}),{name:'AbortError'});
  assert.deepEqual(f.events.filter(e=>e.type==='task').map(e=>e.task.status),['queued','running']);
  assert.equal(f.events.filter(e=>e.type==='message').length,1);assert.ok(f.events.some(e=>e.type==='recall'));assert.ok(f.events.some(e=>e.type==='cursor'&&e.cursor===1));
});

test('CLI list runs alongside daemon lock and never accepts plaintext-send options',async t=>{
  const state=stateFor(t),project=randomUUID(),release=lock(state.directory);t.after(release);
  const server=http.createServer((req,res)=>{assert.equal(req.headers.authorization,'Bearer test-only');res.setHeader('Content-Type','application/json');res.end(JSON.stringify({messages:[{id:randomUUID(),seq:7,kind:'text',text:'old plaintext'}],hasMore:false}));});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  state.store.endpoint=`http://127.0.0.1:${server.address().port}`;state.save();
  const env={...process.env,OMNI_HOME:state.directory};
  const {stdout}=await exec(process.execPath,['bin/omni.mjs','chat','list',project],{env,cwd:path.resolve('.')});assert.equal(JSON.parse(stdout).cursor,7);
  await assert.rejects(exec(process.execPath,['bin/omni.mjs','chat','send',project,'--text','hello','--plaintext'],{env}),e=>/Unknown option/.test(e.stderr));
});

test('project membership join works without a bound device while daemon is running',async t=>{
  const state=stateFor(t),project=randomUUID(),release=lock(state.directory);t.after(release);let received;
  const server=http.createServer(async(req,res)=>{
    assert.equal(req.url,'/api/projects/join');assert.equal(req.method,'POST');assert.equal(req.headers.authorization,'Bearer test-only');
    let body='';for await(const chunk of req)body+=chunk;received=JSON.parse(body);
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({id:project,name:'Fixture team',invite:'DO_NOT_OUTPUT'}));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  state.store.endpoint=`http://127.0.0.1:${server.address().port}`;state.save();
  const {stdout}=await exec(process.execPath,['bin/omni.mjs','projects','join','TESTCODE'],{env:{...process.env,OMNI_HOME:state.directory}});
  assert.deepEqual(received,{code:'TESTCODE'});assert.deepEqual(JSON.parse(stdout),{id:project,name:'Fixture team'});
});

test('wait timeout exits with code 2 without cancelling or sending anything',async t=>{
  const state=stateFor(t),project=randomUUID(),id=randomUUID(),methods=[];
  const server=http.createServer((req,res)=>{
    methods.push(req.method);res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({messages:req.url.includes('around=')?[{id,seq:1,botTask:{status:'running'}}]:[],hasMore:false}));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  state.store.endpoint=`http://127.0.0.1:${server.address().port}`;state.save();
  await assert.rejects(exec(process.execPath,['bin/omni.mjs','chat','wait',project,id,'--timeout','1'],{env:{...process.env,OMNI_HOME:state.directory}}),e=>e.code===2&&e.stdout.includes('"type":"timeout"'));
  assert.ok(methods.length>0);assert.ok(methods.every(m=>m==='GET'));
});

test('watch stops when the local account changes instead of continuing with stale credentials',async t=>{
  const state=stateFor(t),project=randomUUID();let requests=0;
  const server=http.createServer((req,res)=>{
    requests++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({messages:[],hasMore:false}));
    state.store.token='changed-test-token';state.save();
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  state.store.endpoint=`http://127.0.0.1:${server.address().port}`;state.save();
  await assert.rejects(exec(process.execPath,['bin/omni.mjs','chat','watch',project,'--timeout','5'],{env:{...process.env,OMNI_HOME:state.directory}}),e=>e.code===1&&/Login changed/.test(e.stderr));
  assert.equal(requests,1);
});

test('missing keys never downgrade to plaintext or publish an incomplete message',async()=>{
  let posts=0;
  const ring={encrypt:async()=>{throw Object.assign(Error('Waiting for team keys'),{code:'CHAT_KEY_PENDING'});}};
  const chat=createChat({userId:randomUUID(),request:async()=>{posts++;},storage:{exclusive:fn=>fn({read:()=>undefined,ring})}});
  await assert.rejects(chat.send(randomUUID(),{text:'@Bot private'}),{code:'CHAT_KEY_PENDING'});assert.equal(posts,0);
});
