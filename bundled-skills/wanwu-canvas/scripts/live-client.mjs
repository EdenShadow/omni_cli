import {createCollaborationClient} from './collaboration-client.mjs';
import {randomUUID} from 'node:crypto';
import {resolveContext} from './runtime.mjs';

// Reuse one scoped runtime connection for an agent loop. No account token is
// exported or embedded in a canvas. Every request rechecks the running session.
export async function connectCanvas(canvasId,options={}){
 if(!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(canvasId||''))throw Error('Use a complete canvas ID');
 const resolved=await resolveContext(options);if(resolved.selection)throw Error(JSON.stringify(resolved.selection));
 const url=new URL(resolved.context.url);if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.pathname!=='/skills'||url.username||url.password||url.search||url.hash)throw Error('Invalid runtime endpoint');
 const request=async body=>{
  const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+resolved.context.token},body:JSON.stringify(body),signal:AbortSignal.timeout(30000),redirect:'error'});
  const result=await r.json();if(!r.ok)throw Object.assign(Error(result.error||'Canvas request failed'),{status:r.status});return result;
 };
 const context=await request({action:'context',detail:'summary'});
 if(options.project&&![context.project.id,context.project.name].includes(options.project))throw Error('Project does not match this session');
 if(!context.capabilities?.canvasUpdates)throw Error('请更新服务端 / Update the server for atomic canvas updates');
 return {
  sessionId:context.session.id,projectId:context.project.id,
  prepare:operations=>({requestId:randomUUID(),sentAt:Date.now(),operations}),
  async commit(batch,{retries=3}={}){
   for(let attempt=0;;attempt++)try{return await request({...batch,action:'canvas-state-update',canvasId});}
   catch(e){if(attempt>=Math.min(5,retries)||e.status&&e.status!==429&&e.status<500)throw e;await new Promise(r=>setTimeout(r,Math.min(5000,300*2**attempt)));}
  },
  get:(key='main')=>request({action:'canvas-state',canvasId,key}),
  list:()=>request({action:'canvas-state-list',canvasId}),
  async collaborate({document='main',onEvent=()=>{}}={}){
   if(!context.capabilities?.canvasCollaboration)throw Error('Update the server for canvas collaboration');
   const connection=createCollaborationClient({ticket:async body=>{const lease=await request({action:'canvas-collab-ticket',canvasId,...body});if(!lease.url)throw Object.assign(Error('请更新万物桌面客户端 / Update the desktop runtime for collaboration'),{status:400});return lease;},emit:onEvent});
   try{const initial=await connection.join(document);return {...initial,prepare:operations=>({requestId:randomUUID(),sentAt:Date.now(),operations}),commit:batch=>connection.commit(batch),awareness:data=>connection.transient('awareness','self',data),preview:(key,data)=>connection.transient('preview',key,data),close:()=>connection.close()};}
   catch(e){connection.close();throw e;}
  },
  snapshot:({document='main',cursor=''}={})=>request({action:'canvas-collab-snapshot',canvasId,document,cursor}),
  commitObjects:(batch,{document='main'}={})=>request({action:'canvas-collab-commit',canvasId,document,batch}),
  signal:(topic,data)=>request({action:'canvas-broadcast',canvasId,topic,data,requestId:randomUUID()})
 };
}
