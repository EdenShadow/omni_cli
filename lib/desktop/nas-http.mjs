import {serveTransfer,processTransfer} from './nas-transfers.mjs';
import http from 'node:http';
import dgram from 'node:dgram';
import {lookup} from 'node:dns/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {pipeline} from 'node:stream/promises';
import {DEFAULT_NAS_HTTP_PORT,privateLanIp,lanUrl} from '../shared/nas-lan-address.mjs';

const mime=name=>({mp4:'video/mp4',webm:'video/webm',mov:'video/quicktime',mp3:'audio/mpeg',wav:'audio/wav',m4a:'audio/mp4',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',gif:'image/gif',webp:'image/webp',avif:'image/avif',pdf:'application/pdf',txt:'text/plain; charset=utf-8',json:'application/json'}[path.extname(name).slice(1).toLowerCase()]||'application/octet-stream');
export function byteRange(header,size){
 if(!header)return {start:0,end:size-1,status:200};
 const match=/^bytes=(\d*)-(\d*)$/.exec(header);
 if(!match||(!match[1]&&!match[2])||!size)return null;
 const start=match[1]?Number(match[1]):Math.max(0,size-Number(match[2]));
 const end=match[1]&&match[2]?Math.min(size-1,Number(match[2])):size-1;
 return Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start>=0&&start<=end&&start<size?{start,end,status:206}:null;
}
async function addresses(host){
 const {address}=await lookup(host,{family:4});
 if(!privateLanIp(address))throw Error('NAS must have a private IPv4 address');
 const socket=dgram.createSocket('udp4');
 try{
  await new Promise((resolve,reject)=>{socket.once('error',reject);socket.connect(445,address,resolve);});
  const local=socket.address().address;
  if(!privateLanIp(local))throw Error('No private LAN interface for this NAS');
  return {address,local};
 }finally{socket.close();}
}
function encoded(target){return target.split('/').filter(Boolean).map(encodeURIComponent).join('/');}
// A management homepage or an open port is not evidence of an HTTP file service.
// Compare a byte range with the same SMB file, never transmit SMB credentials over HTTP.
async function matchesFile(client,target,url){
 try{
  const {size,isFile}=await client.stat(target);
  if(!isFile||!size)return false;
  const length=Math.min(size,128);
  const response=await fetch(url,{headers:{Range:'bytes=0-'+(length-1),'Accept-Encoding':'identity'},redirect:'error',signal:AbortSignal.timeout(1800)});
  try{
   if(!(response.status===206&&response.headers.get('content-range')==='bytes 0-'+(length-1)+'/'+size||response.status===200&&Number(response.headers.get('content-length'))===size))return false;
   const reader=response.body.getReader();const chunks=[];let count=0;
   try{while(count<length){const {done,value}=await reader.read();if(done)break;chunks.push(value.subarray(0,length-count));count+=value.length;}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
   const actual=[];for await(const chunk of client.createReadStream(target,{end:BigInt(length-1)}))actual.push(chunk);
   return Buffer.concat(chunks).equals(Buffer.concat(actual));
  }finally{await response.body?.cancel().catch(()=>{});}
 }catch{return false;}
}
async function existingWeb(client,tools,config,ip,entries,webRoot){
 let folder=config.base,items=entries;
 // Find a representative file without crawling the share.
 for(let depth=0;depth<3;depth++){
  const file=items.find(e=>!e.directory);
  if(file){
   const target=tools.nasTarget(folder,[file.name]);
   const relative=config.base?target.slice(config.base.length+1):target;
   const bases=[...new Set(['/'+(config.base?encoded(config.base)+'/':''),'/'])];
   const supplied=webRoot&&lanUrl(webRoot);
   const candidates=[...(supplied?.hostname===ip?[supplied.href.replace(/\/?$/,'/')]:[]),...['https://'+ip,'http://'+ip,'http://'+ip+':8080','https://'+ip+':8443'].flatMap(origin=>bases.map(base=>origin+base))];
   const checked=await Promise.all(candidates.map(base=>matchesFile(client,target,base+encoded(relative))));
   return candidates.find((_,index)=>checked[index])||null;
  }
  const dir=items.find(e=>e.directory);if(!dir)break;
  folder=tools.nasTarget(folder,[dir.name]);
  try{items=await tools.listNas(client,folder);}catch{return null;}
 }
 return null;
}
export class NasHttpHost {
 constructor(bridge){this.bridge=bridge;this.entries=new Map();this.failures=new Map();this.listeners=new Map();this.active=0;this.nextSync=0;this.generation=0;}
 call(action,body={}){return this.bridge.request('/api/bridge/nas/'+action,'POST',body,true);}
 async tools(){
  const scripts=path.join(this.bridge.skillsRoot,'wanwu-skills-sync/scripts');
  return this.modules??=Promise.all(['nas.mjs','vendor/smb3-client.mjs'].map(file=>import(pathToFileURL(path.join(scripts,file)).href))).then(([tools,{Client}])=>({...tools,Client}));
 }
 async withClient(entry,fn){
  const tools=await this.tools(),config=tools.nasConfig(await this.call('configure',{entry:entry.id,revision:entry.revision}));
  const addr=await addresses(config.host);
  const client=new tools.Client({...config,host:addr.address});
  try{await tools.connectNas(client);return await fn(client,tools,config,addr);}finally{await client.close().catch(()=>{});}
 }
 async listen(local,port=DEFAULT_NAS_HTTP_PORT){
  const origin='http://'+local+':'+port;
  let item=this.listeners.get(origin);if(item)return item.ready;
  const server=http.createServer((req,res)=>{void this.serve(req,res).catch(()=>{if(!res.headersSent)res.writeHead(403);res.end();});});
  const ready=new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,local,()=>resolve(origin));});
  item={server,ready};this.listeners.set(origin,item);
  try{return await ready;}catch(e){this.listeners.delete(origin);throw e;}
 }
 tick(force=false){
  if(this.job){if(force)this.refreshPending=true;return this.job;}
  if(!this.bridge.store.deviceToken||!force&&Date.now()<this.nextSync)return;
  this.nextSync=Date.now()+25000;
  const generation=this.generation;
  this.job=this.sync(generation).finally(()=>{this.job=null;if(this.refreshPending&&generation===this.generation){this.refreshPending=false;void this.tick(true)?.catch(()=>{});}});return this.job;
 }
 async sync(generation){
  const {entries}=await this.call('plan');
  if(this.generation!==generation)return;
  if(!entries.length)this.nextSync=Date.now()+300000;
  for(const id of this.failures.keys())if(!entries.some(e=>e.id===id))this.failures.delete(id);
  for(const id of this.entries.keys())if(!entries.some(e=>e.id===id))this.entries.delete(id);
  for(const plan of entries){
   const failure=this.failures.get(plan.id);
   if(failure?.revision===plan.revision&&failure.retryAt>Date.now())continue;
   let entry=this.entries.get(plan.id);
   try{
    if(!entry||entry.revision!==plan.revision||Date.now()-entry.checked>300000){
     entry=await this.withClient(plan,async(client,tools,config,addr)=>{
      const entries=await tools.listNas(client,config.base);
      const web=await existingWeb(client,tools,config,addr.address,entries,plan.webRoot);
      return {...plan,...addr,web,checked:Date.now()};
     });
     if(this.generation!==generation)return;
     if(!entry.web)entry.origin=await this.listen(entry.local,entry.httpPort);
     if(this.generation!==generation)return;
     this.entries.set(plan.id,entry);
    }
    if(this.generation!==generation)return;
    await this.call('report',{entry:entry.id,revision:entry.revision,state:entry.web?'existing':'ready',transferOrigin:entry.origin,origin:entry.web ? new URL(entry.web).origin : entry.origin});
    this.failures.delete(plan.id);
   }catch(error){
    if(this.generation!==generation)return;
    this.entries.delete(plan.id);
    const denied=error?.name==='SmbAuthError'||error?.statusName==='STATUS_LOGON_FAILURE';
    this.failures.set(plan.id,{revision:plan.revision,retryAt:denied?Infinity:Date.now()+60000});
    await this.call('report',{entry:plan.id,revision:plan.revision,state:error?.code==='EADDRINUSE'?'port-in-use':denied?'denied':'unreachable'}).catch(()=>{});
   }
  }
  for(const [origin,item] of this.listeners)if(![...this.entries.values()].some(e=>e.origin===origin)){item.server.close();this.listeners.delete(origin);}
 }
 async serve(req,res){
  const ticket=/^\/nas\/([a-f0-9]{64})$/.exec(req.url)?.[1];
  res.setHeader('Cache-Control','private, no-store');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"sandbox; default-src 'none'");res.setHeader('X-Content-Type-Options','nosniff');
  const transfer=/^\/transfer\/([a-f0-9]{64})\/(0|[1-9]\d{0,3})$/.exec(req.url);
  if(transfer&&privateLanIp(req.socket.remoteAddress)){
   if(this.active>=24){res.writeHead(429).end();return;}
   this.active++;try{await serveTransfer(this,req,res,transfer[1],Number(transfer[2]));}finally{this.active--;}return;
  }
  if(!ticket||!privateLanIp(req.socket.remoteAddress)){res.writeHead(404).end();return;}
  res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Expose-Headers','Accept-Ranges,Content-Range,Content-Length');
  if(req.method==='OPTIONS'){
   res.writeHead(204,{'Access-Control-Allow-Private-Network':'true','Access-Control-Allow-Headers':'Range','Access-Control-Allow-Methods':'GET,HEAD,OPTIONS'}).end();return;
  }
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
  if(this.active>=24){res.writeHead(429).end();return;}
  this.active++;
  try{
   const grant=await this.call('authorize',{ticket}),entry=this.entries.get(grant.entry);
   if(!entry||entry.revision!==grant.revision||entry.origin!=='http://'+req.socket.localAddress+':'+req.socket.localPort)throw Error('NAS unavailable');
   await this.withClient(entry,async(client,tools,config)=>{
    const target=tools.nasTarget(config.base,grant.path?tools.relativeParts(grant.path):[]);
    if(grant.operation==='list'){
     const entries=await tools.listNas(client,target);
     res.writeHead(200,{'Content-Type':'application/json'}).end(req.method==='HEAD'?undefined:JSON.stringify({entries}));return;
    }
    const stat=await client.stat(target);if(!stat.isFile){res.writeHead(404).end();return;}
    const range=byteRange(req.headers.range,stat.size);
    if(!range){res.writeHead(416,{'Content-Range':'bytes */'+stat.size}).end();return;}
    const {start,end,status}=range;
    res.writeHead(status,{'Content-Type':mime(target),'Content-Length':end-start+1,'Accept-Ranges':'bytes',...(status===206?{'Content-Range':'bytes '+start+'-'+end+'/'+stat.size}:{})});
    if(req.method==='HEAD'||!stat.size){res.end();return;}
    await pipeline(client.createReadStream(target,{start:BigInt(start),end:BigInt(end)}),res);
   });
  }finally{this.active--;}
 }
 async enableTransfers(message){
  const entry=this.entries.get(message.entry);
  if(!entry||entry.revision!==message.revision)return;
  try{entry.origin=await this.listen(entry.local,entry.httpPort);
   await this.call('report',{entry:entry.id,revision:entry.revision,state:entry.web?'existing':'ready',origin:entry.web?new URL(entry.web).origin:entry.origin,transferOrigin:entry.origin});
  }catch{/* A busy port leaves the normal attachment transport available. */}
 }
 transferJob(message){return processTransfer(this,message);}
 async resolveExisting(message){
  try{
   const grant=await this.call('authorize',{ticket:message.ticket}),entry=this.entries.get(grant.entry);
   if(!entry?.web||entry.revision!==grant.revision)throw Error('NAS changed');
   const generation=this.generation;
   const result=await this.withClient(entry,async(client,tools,config)=>{
    const parts=grant.path?tools.relativeParts(grant.path):[],target=tools.nasTarget(config.base,parts);
    if(grant.operation==='file'){
     const url=new URL(encoded(parts.join('/')),entry.web).href;
     if(await matchesFile(client,target,url))return {url};
    }
    // A static file service may not expose directory listings or this file.
    // Provide that operation over the LAN too; do not relay directory data.

    if(this.generation!==generation||this.entries.get(entry.id)!==entry)throw Error('NAS changed');
    entry.origin=await this.listen(entry.local,entry.httpPort);
    return {url:entry.origin+'/nas/'+message.ticket};
   });
   await this.call('reply',{requestId:message.requestId,...result});
  }catch{await this.call('reply',{requestId:message.requestId,error:true}).catch(()=>{});}
 }
 stop(){this.generation++;this.refreshPending=false;this.nextSync=0;this.entries.clear();this.failures.clear();for(const {server} of this.listeners.values()){server.closeAllConnections();server.close();}this.listeners.clear();}
}
