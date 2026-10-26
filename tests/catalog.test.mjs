import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createCatalog} from '../src/catalog.mjs';
const project=randomUUID(),id=randomUUID(),deviceId=randomUUID();
function fixture(){
  let s={id,projectId:project,deviceId,provider:'codex',title:'Original',note:'@助手',mentionAlias:'助手',noteDetails:'整理账单',noteRevision:1},preference={model:'test-model',effort:'high',serviceTier:'priority'};
  const calls=[];let conflict=false;
  const request=async(p,m='GET',b)=>{
    calls.push({p,m,b});
    if(p.endsWith('/snapshot'))return {devices:[{id:deviceId,name:'CLI device',online:true}],sessions:[s],skills:[],canvases:[]};
    if(p.endsWith('/open'))return structuredClone(s);
    if(p.endsWith('/work-notes')){if(conflict||b.expectedRevision!==s.noteRevision)throw Object.assign(Error('Note changed'),{status:409});Object.assign(s,{note:b.summary,mentionAlias:b.mentionAlias,noteDetails:b.details,noteRevision:s.noteRevision+1});return s;}
    if(p.endsWith('/model-preference')){if(m==='PUT')preference=b;return {preference};}
    if(p.endsWith('/workbench'))return {id:b.id};
    if(p.includes('/workbench/requests/'))return {status:'done',models:[{id:'test-model',name:'Test',efforts:['low','high']},{id:'other-model',name:'Other',efforts:['medium']}]};
    throw Error('Unexpected '+p);
  };
  return {c:createCatalog({request}),request,calls,get session(){return s;},set conflict(v){conflict=v;}};
}
test('fresh discovery includes full notes and reflects other-client renames, revoked aliases and removed devices',async()=>{
  const f=fixture();assert.equal((await f.c.list(project,{agents:true}))[0].notes,'整理账单');
  Object.assign(f.session,{mentionAlias:'小智',noteDetails:'画布协作',noteRevision:2});
  assert.equal((await f.c.list(project,{query:'协作'}))[0].token,'@小智');
  Object.assign(f.session,{mentionAlias:'',note:'普通会话'});assert.equal((await f.c.list(project,{agents:true})).length,0);
  assert.equal((await f.c.list(project))[0].name,'普通会话');f.session.deviceId=randomUUID();assert.equal((await f.c.list(project)).length,0);
});
test('watch emits current and changed catalogs, including removal, without duplicate unchanged events',async()=>{
  const f=fixture(),events=[];let n=0;
  const c=createCatalog({request:f.request,sleep:async()=>{n++;if(n===2)f.session.noteDetails='手机更新';if(n===3)f.session.archivedAt=1;if(n===4)throw Error('end');}});
  await assert.rejects(c.watch(project,{agents:true},e=>events.push(e)),/end/);
  assert.equal(events.length,3);assert.equal(events[1].items[0].notes,'手机更新');assert.deepEqual(events[2].items,[]);
});
test('updates preserve untouched latest fields, remove alias for ordinary name, reject stale revisions',async()=>{
  const f=fixture();Object.assign(f.session,{noteDetails:'other client note',noteRevision:2});
  let result=await f.c.update(project,id,{name:'@小智'});assert.equal(result.notes,'other client note');assert.equal(result.alias,'小智');
  result=await f.c.update(project,id,{notes:'new details'});assert.equal(result.name,'@小智');
  result=await f.c.update(project,id,{name:'普通会话'});assert.equal(result.token,null);
  await assert.rejects(f.c.update(project,id,{notes:'overwrite',revision:1}),{status:409});
  f.conflict=true;await assert.rejects(f.c.update(project,id,{name:'late'}),{status:409});
  await assert.rejects(f.c.update(project,id,{name:'@Bot'}),/Invalid/);
});
test('models and efforts validate actual runtime catalog; account preference preserves fast tier and default reset',async()=>{
  const f=fixture();assert.equal((await f.c.model(project,id)).model,'test-model');
  assert.deepEqual(await f.c.model(project,id,{effort:'low'}),{model:'test-model',effort:'low',serviceTier:'priority'});
  await assert.rejects(f.c.model(project,id,{model:'invented'}),/not available/);
  await assert.rejects(f.c.model(project,id,{effort:'ultra'}),/not supported/);
  assert.deepEqual(await f.c.model(project,id,{model:'other-model'}),{model:'other-model',effort:'',serviceTier:'default'});
  assert.deepEqual(await f.c.model(project,id,{model:''}),{model:'',effort:'',serviceTier:'default'});
  await assert.rejects(f.c.model(project,id,{effort:'high'}),/explicit/);
});
