import path from 'node:path';
import {homedir} from 'node:os';
import {constants,readdirSync,lstatSync,openSync,fstatSync,readFileSync,closeSync} from 'node:fs';
function privateJson(file){
 const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const s=fstatSync(fd);if(!s.isFile()||s.size>16384||process.platform!=='win32'&&(s.uid!==process.getuid()||(s.mode&0o077)))throw Error('运行时文件权限无效');return JSON.parse(readFileSync(fd,'utf8'));}finally{closeSync(fd);}
}
function endpoint(value,pathname){const u=new URL(value);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||!u.port||u.pathname!==pathname||u.username||u.password||u.search||u.hash)throw Error('无效的本机运行时地址');return u;}
const call=async(info,body,timeout=15000)=>{
 const response=await fetch(endpoint(info.url,'/runtime'),{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+info.token},body:JSON.stringify(body),signal:AbortSignal.timeout(timeout),redirect:'error'});
 const data=await response.json();if(!response.ok)throw Object.assign(Error(data.error||'运行时不可用'),{status:response.status});return data;
};
export async function resolveContext(options){
 const explicit=options.context||process.env.WANWU_CONTEXT_FILE;
 if(explicit)return {file:explicit,context:privateJson(explicit)}; // Never fall back from an expired explicit scope.
 const root=process.env.WANWU_RUNTIME_DIR||path.join(homedir(),'.wanwu','runtime');
 let names;try{const s=lstatSync(root);if(!s.isDirectory()||s.isSymbolicLink()||process.platform!=='win32'&&(s.uid!==process.getuid()||(s.mode&0o077)))throw Error('运行时目录权限无效');names=readdirSync(root).filter(n=>/^[a-f0-9]{20}\.json$/.test(n)).slice(0,32);}catch(e){if(e.code==='ENOENT')throw Error('请先打开并登录新版万物 AI；不需要粘贴上下文或账号凭据。');throw e;}
 const probes=names.map(async name=>{
  let info;try{info=privateJson(path.join(root,name));endpoint(info.url,'/runtime');if(info.version!==1||typeof info.token!=='string'||!info.token||info.id+'.json'!==name)return null;}catch{return null;}
  if(options.runtime&&info.id!==options.runtime)return null;
  try{const live=await call(info,{action:'ping'},1500);return {...info,label:live.deviceName||info.id};}catch{return null;}
 });
 const descriptors=(await Promise.all(probes)).filter(Boolean);
 if(!descriptors.length)throw Error('万物运行时未响应，请打开并登录新版万物 AI；不能复用旧任务令牌。');
 if(descriptors.length>1)return {selection:{status:'select-runtime',runtimes:descriptors.map(d=>({id:d.id,name:d.label})),message:'有多个万物运行时，请用 --runtime 指定目标。'}};
 const nativeId=options['native-session']||process.env.CODEX_THREAD_ID||process.env.CLAUDE_SESSION_ID||process.env.DSH_SESSION_ID;
 const result=await call(descriptors[0],{scope:options.scope,project:options.project,provider:options.provider||(process.env.DSH_SESSION_ID?(process.env.WANWU_AI_RUNTIME_PROVIDER||'dsh'):process.env.CODEX_THREAD_ID?'codex':'claude'),localId:nativeId});
 if(result.status!=='ready')return {selection:result};
 if(typeof result.contextFile!=='string'||!path.isAbsolute(result.contextFile))throw Error('运行时没有返回有效授权');
 return {file:result.contextFile,context:privateJson(result.contextFile)};
}
