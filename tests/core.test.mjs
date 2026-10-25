import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import http from 'node:http';
import {WebSocketServer} from 'ws';
import {RuntimeBridge} from '../lib/desktop/bridge.mjs';
import {SkillUpdateBarrier} from '../lib/desktop/skills/update-barrier.mjs';
import {fileAccessPolicy} from '../lib/desktop/file-access.mjs';
import {installSkills} from '../lib/desktop/runtimes.mjs';
import {skillsRoot,importAll} from '../src/client.mjs';
import {createRequest,endpoint} from '../src/api.mjs';
import {loadState,lock} from '../src/state.mjs';
const temporary=t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'omni-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;};

test('API separates account/device credentials and refuses redirects or insecure origins',async()=>{
  const calls=[],store={endpoint:'https://example.com',token:'user-test',deviceToken:'device-test'};
  const request=createRequest(store,async(url,options)=>{calls.push({url,options});return new Response('{"ok":true}',{status:200});});
  await request('/api/me');await request('/api/bridge/events','POST',{events:[]},true);
  assert.equal(calls[0].options.headers.Authorization,'Bearer user-test');
  assert.equal(calls[1].options.headers.Authorization,'Bearer device-test');
  assert.equal(calls[1].options.redirect,'error');
  for(const value of ['http://example.com','https://user:secret@example.com','https://example.com/path'])assert.throws(()=>endpoint(value));
  await assert.rejects(request('//evil.example/api'));
});

test('private atomic state, exclusive process lock and corrupt-state protection',t=>{
  const dir=temporary(t),state=loadState(dir);state.store.token='test-token';state.save();
  assert.equal(loadState(dir).store.token,'test-token');
  if(process.platform!=='win32')assert.equal(fs.statSync(path.join(dir,'state.json')).mode&0o777,0o600);
  const release=lock(dir);assert.throws(()=>lock(dir),/already running/);release();lock(dir)();
  fs.writeFileSync(path.join(dir,'state.json'),'{broken');assert.throws(()=>loadState(dir),/damaged/);
});

test('all five default skills install into each selected runtime and preserve local edits',t=>{
  const dir=temporary(t),keys=['CODEX_HOME','CLAUDE_CONFIG_DIR','DSH_HOME'];
  for(const key of keys){const prior=process.env[key];process.env[key]=path.join(dir,key);t.after(()=>prior===undefined?delete process.env[key]:process.env[key]=prior);}
  for(const [i,provider] of ['codex','claude','dsh'].entries()){
    const result=installSkills(skillsRoot,provider);assert.equal(result.length,5);assert.ok(result.every(s=>s.state==='installed'));
    const file=path.join(process.env[keys[i]],'skills','wanwu-skills-sync','SKILL.md');fs.appendFileSync(file,'\nLocal edit');
    installSkills(skillsRoot,provider);assert.match(fs.readFileSync(file,'utf8'),/Local edit$/);
  }
});

test('team folder policy rejects nonimported paths and symlink escapes',t=>{
  const dir=temporary(t),allowed=path.join(dir,'allowed'),other=path.join(dir,'other');fs.mkdirSync(allowed);fs.mkdirSync(other);
  const policy=fileAccessPolicy({userId:'owner'},{userId:'teammate',deviceOwnerId:'owner',importedRoots:[allowed]});
  assert.equal(policy.resolve(allowed),fs.realpathSync(allowed));assert.throws(()=>policy.resolve(other));
  const linked=path.join(allowed,'escape');fs.symlinkSync(other,linked,process.platform==='win32'?'junction':'dir');assert.throws(()=>policy.resolve(linked));
});

function fixture(t){
  const dir=temporary(t),calls=[];
  const store={endpoint:'https://example.com',userId:randomUUID(),device:{id:randomUUID(),runtimes:['codex']},deviceToken:'test',mappings:{}};
  const b=new RuntimeBridge({store,save:()=>{},notify:()=>{},skillsRoot,dataDir:dir,documentsPath:dir,request:async(p,method='GET',body)=>{calls.push({p,method,body});return {};}});
  t.after(()=>b.stop());return {b,calls,dir,store};
}
test('shared session/public IM turn forwards streaming reply, attachments catalog and finish',async t=>{
  const {b,calls,dir,store}=fixture(t),session=randomUUID(),command=randomUUID(),project=randomUUID(),local=randomUUID();
  const m={provider:'codex',localId:local,cwd:dir};b.mappings[session]=m;b.busy.set(command,m);
  b.skillUpdates.verified=true;b.skillUpdates.pending=false;
  b.adapter=()=>({run:async(id,prompt,emit,options)=>{assert.equal(id,local);assert.match(prompt,/hello/);emit({kind:'message',id:'answer',role:'assistant',text:'Team reply',phase:'final_answer'});return {};},metadata:async()=>({}),close(){}});
  b.skillExchange.context=async()=>null;
  b.localOutputs.record=()=>{};b.localOutputs.list=async()=>[];
  b.chatEncryption.event=async (_session,_id,payload)=>payload;
  b.pump=async()=>{};
  const c={id:command,session_id:session,project_id:project,user_id:store.userId,prompt:'hello',options:{groupChat:{sessionTarget:{sessionId:session,deviceId:store.device.id},deviceOwnerId:store.userId,importedRoots:[dir]}}};
  await b.execute(c,m);
  const finish=calls.find(r=>r.p.endsWith('/finish'));assert.equal(finish?.body.status,'done',JSON.stringify(calls));
  const events=calls.filter(r=>r.p==='/api/bridge/events').flatMap(r=>r.body.events);assert.ok(events.some(e=>e.payload.text==='Team reply'));
  assert.equal(b.busy.size,0);
});

test('failed event upload remains durable and retries without rerunning AI',async t=>{
  const {b,store}=fixture(t);let fail=true,count=0;
  b.request=async()=>{count++;if(fail)throw Error('offline');return {};};b.chatEncryption.event=async (_session,_id,payload)=>payload;
  b.outbox=[{id:randomUUID(),sessionId:randomUUID(),payload:{kind:'message',text:'saved'}}];b.persist();
  await assert.rejects(b.flush(),/offline/);assert.equal(store.outbox.length,1);fail=false;await b.flush();assert.equal(store.outbox.length,0);assert.equal(count,2);
});

test('skill update waits for active task and syncs before accepting another task',async()=>{
  let synced=0,pumped=0;
  const plan={revision:'v2',state:{status:'pending'},runtimes:['codex'],projects:[{id:'p',name:'Team',skills:[{name:'test-skill',sha256:'a'}]}]};
  const b={notify(){},store:{deviceToken:'test'},busy:new Map([['task',{}]]),generationJobs:new Map(),skills:{jobs:new Map(),verifyPlan:async()=>false,syncAll:async()=>{synced++;return {runtimes:['codex'],errors:[]};}},announcements:{jobs:new Map()},adapters:{},request:async()=>plan,pump:async()=>{pumped++;}};
  const barrier=new SkillUpdateBarrier(b);await barrier.tick();assert.equal(synced,0);assert.equal(barrier.available,false);
  b.busy.clear();await barrier.tick();assert.equal(synced,1);assert.equal(barrier.available,true);await Promise.resolve();assert.equal(pumped,1);
});

test('import-all walks every page and skips inaccessible old working folders',async t=>{
  const dir=temporary(t),pages=[];
  const b={list:async({cursor})=>({sessions:[{cwd:dir,localId:cursor||'first'},{cwd:path.join(dir,'missing')}],cursor:cursor?null:'second'}),importSessions:async({sessions})=>{pages.push(sessions);return sessions;}};
  assert.deepEqual(await importAll(b,'project',['codex']),{count:2,errors:[]});assert.equal(pages.length,2);
});

test('bundled skill resolves native runtime context, selects project and rejects unbound providers',async t=>{
  const {b,dir,store}=fixture(t);b.runtimeDirectory=path.join(dir,'runtime');
  const project=randomUUID(),local=randomUUID(),command=randomUUID();let selected=false;
  b.request=async(p,_method,body)=>{
    if(p==='/api/bridge/skill-assistant-context')return selected?{status:'ready',id:command,expires:Date.now()+60000}:{status:'select-project',projects:[{id:project,name:'Test team'}]};
    if(p===`/api/bridge/skill-assistant/${command}`&&body.action==='context')return {project:{id:project,name:'Test team'},capabilities:{},session:{id:local}};
    throw Error('Unexpected API');
  };
  await b.skillExchange.start();
  const invoke=async(provider='codex')=>JSON.parse((await promisify(execFile)(process.execPath,[path.join(skillsRoot,'wanwu-skills-sync','scripts','sync.mjs'),'--provider',provider,'--native-session',local,'context'],{env:{...process.env,WANWU_CONTEXT_FILE:'',WANWU_RUNTIME_DIR:b.runtimeDirectory},windowsHide:true})).stdout);
  assert.equal((await invoke()).status,'select-project');selected=true;
  assert.equal((await invoke()).project.id,project);
  await assert.rejects(invoke('claude'),/Native session identity unavailable/);
  assert.equal(store.outbox,undefined);
});

test('online device advertises collaboration capabilities without remote control',async t=>{
  const {b,store}=fixture(t),server=http.createServer(),ws=new WebSocketServer({server});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>{for(const socket of ws.clients)socket.terminate();ws.close();server.close();});
  store.endpoint=`http://127.0.0.1:${server.address().port}`;
  const received=new Promise(resolve=>ws.on('connection',socket=>socket.on('message',data=>{const event=JSON.parse(data);if(event.type==='bridge-ready')resolve(event);} )));
  b.request=async p=>p==='/api/ws-ticket'?{ticket:'test'}:p==='/api/bridge/skills-sync'?{revision:'empty',state:{status:'ready'},projects:[],runtimes:['codex']}:[];
  b.skills.verifyPlan=async()=>true;b.pump=async()=>{};b.workbench.pump=async()=>{};b.scheduler.tick=async()=>{};
  await b.start();
  const event=await received;assert.ok(event.capabilities.includes('session-mentions-v1'));assert.ok(event.capabilities.includes('skills-sync-v1'));assert.ok(event.capabilities.includes('group-chat-v1'));assert.ok(!event.capabilities.includes('remote-desktop-v1'));
  assert.equal(b.remoteDesktop,undefined);assert.equal(b.builtinRuntime,undefined);
});
