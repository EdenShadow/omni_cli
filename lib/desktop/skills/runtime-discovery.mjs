import {PROVIDERS} from '../../shared/providers.mjs';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {mkdirSync,writeFileSync,renameSync,lstatSync,readFileSync,rmSync} from 'node:fs';
export class SkillRuntimeDiscovery{
 constructor(exchange){this.exchange=exchange;this.secret=randomBytes(32).toString('hex');}
 publish(port){
  const b=this.exchange.bridge,root=b.runtimeDirectory||path.join(b.dataDir,'runtime');
  mkdirSync(root,{recursive:true,mode:0o700});const stat=lstatSync(root);
  if(stat.isSymbolicLink()||!stat.isDirectory()||(process.platform!=='win32'&&(stat.uid!==process.getuid()||(stat.mode&0o077))))throw Error('Runtime discovery directory must be private');
  this.id=createHash('sha256').update(path.resolve(b.dataDir)).digest('hex').slice(0,20);this.file=path.join(root,this.id+'.json');
  const pending=this.file+'.'+randomBytes(8).toString('hex');
  writeFileSync(pending,JSON.stringify({version:1,id:this.id,url:`http://127.0.0.1:${port}/runtime`,token:this.secret}),{mode:0o600,flag:'wx'});renameSync(pending,this.file);
 }
 close(){try{if(JSON.parse(readFileSync(this.file,'utf8')).token===this.secret)rmSync(this.file,{force:true});}catch{}}
 async resolve(body){
  const x=this.exchange,b=x.bridge;
  if(x.closed||b.stopped||!b.store.deviceToken)throw Object.assign(Error('万物运行时未登录或已停止 / Runtime is not available'),{status:403});
  if(body.action==='ping')return {status:'ready',deviceName:b.store.device?.name};
  const valid=v=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
  if(body.scope){
   if(!valid(body.scope))throw Error('Invalid request scope');
   const scope=[...x.tokens.values()].find(s=>s.commandId===body.scope&&!s.native&&x.isActive(s));
   if(!scope)throw Object.assign(Error('本轮万物请求已结束；不能改用设备主人身份 / Omni AI request expired'),{status:403});
   return {status:'ready',contextFile:scope.file};
  }
  if(typeof body.localId!=='string'||!/^(?:session-)?[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(body.localId)||(!PROVIDERS.includes(body.provider)||!b.store.device.runtimes.includes(body.provider)))throw Error('未取得原生会话标识，请从已连接的 AI 会话中调用 / Native session identity unavailable');
  const active=[...x.tokens.values()].filter(s=>!s.native&&s.localId===body.localId&&s.provider===body.provider&&x.isActive(s));
  if(active.length>1)throw Object.assign(Error('此会话有多条万物请求，请使用本轮的 --scope / Supply this turn’s scope'),{status:409});
  if(active.length===1)return {status:'ready',contextFile:active[0].file};
  let result;try{result=await b.request('/api/bridge/skill-assistant-context','POST',{provider:body.provider,localId:body.localId,...(body.project?{project:body.project}:{})},true);}catch(e){if(e.status===404||/接口不存在/.test(e.message))throw Error('当前服务器尚未支持原生会话，请更新万物服务端至 1.2.240 或更高版本');throw e;}
  if(result.status!=='ready')return result;
  const file=await x.context({id:result.id},{native:true,expires:result.expires,localId:body.localId,provider:body.provider});
  return {status:'ready',contextFile:file};
 }
}
