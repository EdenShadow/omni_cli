import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {deviceService,serviceArgs} from '../shared/device-service.mjs';
const digest=s=>createHash('sha256').update(s).digest('hex');
const uuid=z.string().uuid();
function execute(file,input){
 return new Promise((resolve,reject)=>{
  const env=Object.fromEntries(['PATH','HOME','USERPROFILE','SystemRoot','TMPDIR','TEMP','LANG'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
  const child=execFile(process.execPath,[file],{cwd:path.dirname(file),env:{...env,ELECTRON_RUN_AS_NODE:'1'},timeout:30000,killSignal:'SIGKILL',maxBuffer:65536,windowsHide:true},(error,stdout)=>{
   if(error)return reject(Error('适配器执行失败或超时，请在设备检查服务'));
   try{resolve(z.record(z.string(),z.unknown()).parse(JSON.parse(stdout)));}catch{reject(Error('适配器未返回 JSON 对象'));}
  });
  child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(input));
 });
}
export class DeviceServices {
 constructor(bridge){this.b=bridge;this.running=false;}
 get installed(){return this.b.store.canvasDeviceServices??={};}
 get scope(){return JSON.stringify([this.b.store.endpoint,this.b.store.device?.id]);}
 async configure(exchange,scope,body){
  const b=this.b,scopeKey=this.scope,request=input=>b.request('/api/bridge/skill-assistant/'+scope.commandId,'POST',input,true);
  const {script,source,requestId,action,...fields}=body;
  const id=uuid.parse(requestId),manifest=action==='service-install'?deviceService.parse(fields):null;
  const {canvasId,name}=fields;
  const target=await request({action:'service-authorize',canvasId});
  if(action==='service-revoke'){
   const result=await request({action,canvasId,name});
   for(const [key,v] of Object.entries(this.installed))if(v.scope===scopeKey&&v.canvasId===canvasId&&v.name===name)delete this.installed[key];
   b.save();return result;
  }
  const code=z.string().min(1).max(128000).parse(source),hash=digest(code);
  const fingerprint=digest(JSON.stringify([manifest,hash,target.revision,scopeKey]));
  const previous=this.installed[id];if(previous&&previous.fingerprint!==fingerprint)throw Error('操作编号已用于其他配置');
  if(!previous){
   const description=manifest.actions.map(a=>(a.mode==='write'?'修改':'读取')+' · '+a.title+' ('+a.name+')').join('\n');
   const answer=await exchange.questions.ask(scope,{action:'question',id,questions:[{id:'install',header:'设备服务',question:'允许画布「'+target.title+'」使用本机服务「'+manifest.title+'」？\n'+description+'\n允许使用：设备主人'+(manifest.members.length?'及 '+manifest.members.join('、'):'')+'。\n将以本机账号运行脚本 '+String(script||'adapter.mjs').slice(-180)+'，指纹 '+hash.slice(0,12)+'。',options:[{label:'允许安装'},{label:'取消'}]}]});
   if(answer.status!=='answered'||answer.answers?.install?.[0]!=='允许安装')throw Error('设备主人未授权');
  }
  if(scopeKey!==this.scope||!exchange.isActive(scope))throw Error('设备或任务已改变');
  const dir=path.join(b.dataDir,'service-adapters');await fs.mkdir(dir,{recursive:true,mode:0o700});
  const file=path.join(dir,hash+'.mjs');await fs.writeFile(file,code,{flag:'wx',mode:0o600}).catch(e=>{if(e.code!=='EEXIST')throw e;});
  if(digest(await fs.readFile(file))!==hash)throw Error('本机适配器校验失败');
  this.installed[id]={...manifest,owner:target.userId,revision:target.revision,projectId:target.projectId,scope:scopeKey,fingerprint,hash};b.save();
  const result=await request({action:'service-register',id,canvasId,name,revision:target.revision,manifest});
  for(const [key,v] of Object.entries(this.installed))if(key!==id&&v.scope===scopeKey&&v.canvasId===canvasId&&v.name===name)delete this.installed[key];
  b.save();return result;
 }
 async pump(){
  const b=this.b,scope=this.scope;
  if(this.running||b.stopped||!b.store.deviceToken||!Object.values(this.installed).some(v=>v.scope===scope))return;
  this.running=true;
  try{
   const reports=b.store.deviceServiceReports??={};
   const report=async(id,result)=>{
    await b.request('/api/bridge/device-services/'+id,'POST',result,true);
    delete reports[id];b.save();
   };
   for(const [id,pending] of Object.entries(reports)){
    if(pending.scope!==scope)continue;
    try{await report(id,pending.result);}catch(e){if(e.status!==404)throw e;delete reports[id];b.save();}
   }
   const job=await b.request('/api/bridge/device-services/claim','POST',{},true);
   if(!job.id||scope!==this.scope||b.stopped)return;
   const s=this.installed[job.serviceId],action=s?.actions.find(a=>a.name===job.action);
   let result;
   try{
    if(!action||s.scope!==scope||s.canvasId!==job.canvasId||s.projectId!==job.projectId||s.revision!==job.revision||(s.owner!==job.actor&&!s.members.includes(job.actor)))throw Error('设备服务已解除绑定');
    const file=path.join(b.dataDir,'service-adapters',s.hash+'.mjs');
    if(digest(await fs.readFile(file))!==s.hash)throw Error('适配器文件已改变，请重新绑定');
    const input={requestId:job.id,action:action.name,args:serviceArgs(action,job.args)};
    let state=await execute(file,{...input,phase:'execute'});
    if(action.mode==='write'){
     const readback=await execute(file,{...input,phase:'verify'});
     if(readback.verified!==true||!Object.hasOwn(readback,'state'))throw Error('配置尚未通过回读验证');
     state=readback.state;
    }
    result={status:'succeeded',state};
   }catch(e){result={status:action?.mode==='write'?'needs_review':'failed',error:e.message};}
   if(!b.stopped&&scope===this.scope){
    reports[job.id]={scope,result};b.save();
    await report(job.id,result);
   }
  }finally{this.running=false;}
 }
}
