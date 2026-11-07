import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {link,lstat,open,rm} from 'node:fs/promises';
import {pipeline} from 'node:stream/promises';
import {Readable,Transform} from 'node:stream';
import {setTimeout as delay} from 'node:timers/promises';
import {openFiles,closeFiles} from './transport.mjs';
import {runNasInWanwu} from './nas-mac-runtime.mjs';

const skill='wanwu-skills-sync',dependency='nas-smb';

export function relativeParts(value) {
 if(typeof value!=='string'||!value||value.length>2048)throw Error('请提供共享目录内的相对路径');
 const parts=value.split(/[\\/]/);
 if(parts.some(p=>!p||/[\x00-\x1f<>:"|?*]/.test(p)||/[ .]$/.test(p)||/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(p)))
  throw Error('NAS 路径无效，请使用共享目录内的相对路径');
 return parts;
}

export function parseShare(value){
 const unc=typeof value==='string'&&value.startsWith('\\\\');
 const match=(unc?value.slice(2).replaceAll('\\','/'):String(value).replace(/^smb:\/\//i,'')).match(/^([^/]+)(?:\/(.+?))?\/?$/);
 if(!match||(!unc&&!/^smb:\/\//i.test(value))||/[\s@?#%\\]/.test(match[1])||(!unc&&/[?#\\]/.test(match[2])))throw Error('请填写 smb://主机，可包含共享名和子目录。用户名和密码请分开填写');
 let u,base;
 try{
  u=new URL('smb://'+match[1]);
  const segments=(match[2]||'').split('/').map(s=>unc?s:decodeURIComponent(s));
  if(segments.some(s=>s.includes('/')||s.includes('\\')))throw Error();
  base=match[2]?relativeParts(segments.join('/')).join('/'):'';
 }catch{throw Error('SMB 地址或共享目录无效');}
 if(!u.hostname||u.port==='0'||base.split('/')[0].toUpperCase()==='IPC$')throw Error('请填写有效的 SMB 文件共享');
 return {host:u.hostname.replace(/^\[|\]$/g,''),port:Number(u.port||445),base};
}

async function contents(readable){
 const hash=createHash('sha256');let size=0;
 for await(const chunk of readable){size+=chunk.length;hash.update(chunk);}
 return {size,sha256:hash.digest('hex')};
}

async function save(client,base,parts,item){
 let parent=base;
 for(const folder of parts.slice(0,-1)){
  parent+='/'+folder;
  try{
   if(!(await client.stat(parent)).isDirectory)throw Error('NAS 路径中包含同名文件');
  }catch(e){
   if(e.code!=='ENOENT')throw e;
   try{await client.mkdir(parent);}
   catch(race){if(race.code!=='EEXIST'||!(await client.stat(parent)).isDirectory)throw race;}
  }
 }
 const target=parent+'/'+parts.at(-1),temp=parent+'/.wanwu-part-'+randomUUID();
 const hash=createHash('sha256');
 async function* chunks(){
  for(let offset=0;offset<item.size;){
   const buffer=Buffer.allocUnsafe(Math.min(65536,item.size-offset));
   const {bytesRead}=await item.file.read(buffer,0,buffer.length,offset);
   if(!bytesRead)throw Error('本地源文件已改变');
   offset+=bytesRead;const bytes=buffer.subarray(0,bytesRead);hash.update(bytes);yield bytes;
  }
 }
 try{
  await pipeline(Readable.from(chunks()),client.createWriteStream(temp));
  const stat=await item.file.stat();
  if([stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs].join(':')!==item.stamp)throw Error('本地源文件已改变');
  const sha256=hash.digest('hex'),verify=await contents(client.createReadStream(temp));
  if(verify.size!==item.size||verify.sha256!==sha256)throw Error('NAS 写入校验失败');
  try{await client.rename(temp,target);}catch(e){
   if(e.code!=='EEXIST')throw e;
   const existing=await contents(client.createReadStream(target));
   if(existing.size!==item.size||existing.sha256!==sha256)throw Error('NAS 已有不同内容的同名文件，请换一个文件名');
  }
  return {status:'stored',storage:'nas',path:parts.join('/'),size:item.size,sha256};
 }finally{await client.rm(temp).catch(()=>{});}
}

async function retrieve(client,remote,relative,output){
 if(!output||!path.isAbsolute(output))throw Error('请用 --output 指定新的本地绝对路径');
 const temp=path.join(path.dirname(output),'.wanwu-part-'+randomUUID());
 if(await lstat(output).catch(error=>{if(error.code!=='ENOENT')throw error;return null;}))
  throw Error('EEXIST: 本地已有同名文件，请用新的输出路径');
 const info=await client.stat(remote);
 if(!info.isFile)throw Error('请选择 NAS 中的文件');
 const hash=createHash('sha256');let size=0;
 const meter=new Transform({transform(chunk,encoding,done){size+=chunk.length;hash.update(chunk);done(null,chunk);}});
 const local=await open(temp,'wx',0o600);
 try{
  await pipeline(client.createReadStream(remote),meter,local.createWriteStream());
  const after=await client.stat(remote);
  if(size!==info.size||size!==after.size||Number(after.changeTime)!==Number(info.changeTime))throw Error('NAS 源文件已改变，请重试');
  await link(temp,output); // Only publish a complete file; never replace an existing local path.
  return {status:'downloaded',storage:'nas',path:relative,output,size,sha256:hash.digest('hex')};
 }finally{await local.close();await rm(temp,{force:true});}
}

// Only the scoped key lookup uses the Wanwu API. File data stays on the execution device and share.
export async function resolveNas(request,destination){
 if(!['auto','nas'].includes(destination))throw Error('Invalid NAS destination');
 const key=await request({action:'credentials-resolve',skill,dependency});
 if(key.status!=='ready'){
  if(destination==='auto'&&key.status==='setup-required'){
   if(key.configured===false)return null;
   // Older servers omit configured. Distinguish an empty selection from incomplete credentials.
   if(key.configured===undefined){
    const catalog=await request({action:'credentials-status'});
    const d=catalog.items.find(s=>s.name===skill)?.dependencies.find(d=>d.id===dependency);
    if(d?.selectionMode==='automatic'&&d.entries.length===0)return null;
   }
  }
  throw Error('请在万物同步助手的钥匙串中配置或重新选择可用的 NAS');
 }
 return nasConfig(key.values);
}

export function nasConfig({share,username,password,domain}){
 if(typeof username!=='string'||!username||typeof password!=='string'||!password)throw Error('请在钥匙串中补全 NAS 账号和密码');
 const {host,port,base}=parseShare(share);
 return {host,port,base,username,password,domain:domain||'',signing:'required',connectTimeout:10000};
}

export async function connectNas(client) {
 // macOS can reject the first TCP connection while resolving the app's local-network permission.
 const retryDelays = [350, 1200];
 for (let attempt = 0; ; attempt++) {
  try {
   await client.connect();
   return;
  } catch (error) {
   if (process.platform !== 'darwin' || error.code !== 'EHOSTUNREACH' || error.syscall !== 'connect') throw error;
   if (attempt === retryDelays.length) {
    throw new Error('SMB 连接未建立（EHOSTUNREACH），尚未验证账号。请在执行任务的 Mac 上检查「隐私与安全 → 本地网络」中万物 AI 的授权，以及共享盘的内网或 VPN 连接。', {cause:error});
   }
   await delay(retryDelays[attempt]);
  }
 }
}

export async function listNas(client, target) {
 if (target) return (await client.readdir(target,{withFileTypes:true})).map(e=>({name:e.name,directory:e.isDirectory()}));
 const shares = await client.listShares();
 const entries = [];
 for (const share of shares) {
  if (share.type !== 'disk' || !share.name || share.name.toUpperCase() === 'IPC$') continue;
  try { await client.readdir(share.name,{withFileTypes:true}); }
  catch (error) { if (['EACCES','EPERM','ENOENT'].includes(error.code) || error.status === 0xc0000022) continue; throw error; }
  entries.push({name:share.name,directory:true});
 }
 return entries;
}

export function nasTarget(base, parts) {
 if (!base && parts[0]?.toUpperCase() === 'IPC$') throw Error('请选择文件共享');
 return [base,...parts].filter(Boolean).join('/');
}

export async function nasTransfer(configOrResolve,{operation,remote='',file,output,contextFile}){
 if(!['put','get','list'].includes(operation))throw Error('Invalid NAS operation');
 const parts=operation==='list'&&!remote?[]:relativeParts(remote);
 const args = ['nas-' + operation];
 if (remote) args.push('--path', remote);
 if (operation === 'put') args.push('--file', file);
 if (operation === 'get' && output) args.push('--output', output);
 const result = await runNasInWanwu(contextFile, args);
 if (result !== undefined) return result;
 const config = typeof configOrResolve === 'function' ? await configOrResolve() : configOrResolve;
 const {base}=config;
 const {Client}=await import('./vendor/smb3-client.mjs');
 const client=new Client(config);
 const handles=operation==='put'?await openFiles([file],contextFile,Number.MAX_SAFE_INTEGER):[];
 try{
  await connectNas(client);
  const target=nasTarget(base,parts),relative=parts.join('/');
  if(!base && operation!=='list' && parts.length<2)throw Error('请指定共享名和文件相对路径 / Include a share name and file path');
  if(operation==='put'){
   const result=await save(client,base||parts[0],base?parts:parts.slice(1),handles[0]);
   return {...result,path:relative};
  }
  if(operation==='get')return await retrieve(client,target,relative,output);
  return {status:'listed',storage:'nas',path:relative,entries:await listNas(client,target)};
 }finally{await closeFiles(handles);await client.close().catch(()=>{});}
}
