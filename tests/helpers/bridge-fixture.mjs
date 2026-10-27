// Local Wanwu server with the packaged CLI bridge, temporary accounts and fake AI.
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const {createWanwuServer}=await import(pathToFileURL(path.join(process.env.OMNI_WANWU_SOURCE,'server/index.mjs')));
import {RuntimeBridge} from '../../lib/desktop/bridge.mjs';
import {SkillExchange} from '../../lib/desktop/skills/exchange.mjs';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<600;i++){const result=await fn();if(result)return result;await delay(15);}throw Error('Condition timed out');}
async function fixture({outputStorage,folderStorage,requireEncryptedChat=false}={}){
 const dir=mkdtempSync(path.join(tmpdir(),'wanwu-skill-assistant-')),objects=new Map(),storage={info:{configured:true},put:async(k,v)=>objects.set(k,v),get:async k=>objects.get(k),remove:async k=>objects.delete(k)};
 const serverOptions={dataDir:path.join(dir,'server'),test:true,requireEncryptedChat,outputStorage,folderStorage,skillStorage:storage,chatStorage:storage};let app=createWanwuServer(serverOptions);await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const port=app.server.address().port,base=`http://127.0.0.1:${port}`;
 const call=async(route,token,method='GET',body)=>{const r=await fetch(base+'/api'+route,{method,headers:{'Content-Type':'application/json','X-Wanwu-Desktop':'1',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)}),data=await r.json();if(!r.ok)throw Object.assign(Error(data.error),{status:r.status});return data;};
 const owner=await call('/auth/register',null,'POST',{username:'skill_test_owner',password:'test-password-only'}),other=await call('/auth/register',null,'POST',{username:'skill_test_other',password:'test-password-only'});
 const project=(await call('/me',owner.token)).projects[0];await call('/projects/join',other.token,'POST',{code:project.invite});
 const devices=[];
 for(let i=0;i<2;i++){
  const bound=await call('/devices/bind',owner.token,'POST',{installation:randomUUID(),name:'Test device '+i,platform:'test',runtimes:['codex','claude']});await call(`/projects/${project.id}/devices`,owner.token,'POST',{deviceId:bound.device.id});
  const dataDir=path.join(dir,'device-'+i);mkdirSync(dataDir);const events=[],runs=[],pending=new Map();
  const b=new RuntimeBridge({dataDir,store:{endpoint:base,token:owner.token,device:bound.device,deviceToken:bound.deviceToken,userId:owner.user.id},save(){},notify:e=>events.push(e),request:(p,m,body,device)=>call(p.slice(4),device?bound.deviceToken:owner.token,m,body)});
  const rootFor=provider=>path.join(dataDir,provider,'skills');b.skills.detect=()=>['codex','claude'].map(provider=>({provider,available:true}));b.skills.rootFor=rootFor;b.skills.bundled=()=>[];b.skillExchange=new SkillExchange(b,{rootFor});
  const adapter={fresh:new Set(),dirs:new Map(),create:async()=>{const id=randomUUID();adapter.fresh.add(id);return id;},run:(id,prompt,emit,options)=>{runs.push({id,prompt,options});return new Promise(resolve=>pending.set(id,resolve));},metadata:async()=>({}),close(){},cancel:async id=>{pending.get(id)?.({cancelled:true});}};b.adapter=()=>adapter;
  await b.start();await until(()=>b.skillUpdates.available);const session=await b.createSession({projectId:project.id,provider:'codex',cwd:dataDir,title:'Skills test'});
  devices.push({b,bound,dataDir,rootFor,events,runs,pending,session,finish(){for(const resolve of pending.values())resolve({});pending.clear();}});
 }
 return {dir,get app(){return app;},objects,owner,other,project,devices,call,async restart(){await app.close();await until(()=>devices.every(d=>d.b.ws?.readyState>=2));await delay(25);app=createWanwuServer(serverOptions);await new Promise(r=>app.server.listen(port,'127.0.0.1',r));for(const d of devices)await d.b.connect();await until(()=>devices.every(d=>d.b.ws?.readyState===1));},async close(){for(const d of devices){d.finish();d.b.stop();}await delay(25);await app.close();rmSync(dir,{recursive:true,force:true});}};
}
async function enqueue(f,d,prompt,token=f.owner.token){const id=randomUUID();await f.call(`/sessions/${d.session.id}/commands`,token,'POST',{id,prompt});return id;}
export {fixture,enqueue,until};
