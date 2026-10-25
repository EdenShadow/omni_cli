import {fileSecret} from '../../shared/chat-file-crypto.mjs';
import path from 'node:path';
import {constants} from 'node:fs';
import {realpath,lstat,open,mkdir,rm} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {fileAccessPolicy} from '../file-access.mjs';
import {packFolder} from '../folder-archive.mjs';
import {dispatchPlan} from '../../shared/work-dispatch.mjs';
const stamp=s=>[s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs].join(':');
const contains=(root,file)=>file===root||file.startsWith(root+path.sep);
const sensitive=name=>/^(?:\.git|\.ssh|\.aws|\.codex|\.claude|\.dsh|\.wanwu|skill-contexts|node_modules|\.env(?:\..*)?|auth\.json|credentials(?:\.json)?|.*\.(?:pem|key))$/i.test(name);
export class WorkDispatch{
 constructor(bridge){this.bridge=bridge;this.requests=new Map();}
 async send(scope,body){
  const plan=body.plan;if(!plan||!Array.isArray(plan.tasks))throw Error('Invalid task plan');
  const signature=createHash('sha256').update(JSON.stringify(plan)).digest('hex'),key=scope.commandId+':'+plan.id,previous=this.requests.get(key);
  if(previous){if(previous.signature!==signature)throw Error('批次 ID 不能用于不同计划 / Batch ID cannot be reused for a different plan');return previous.promise;}
  // Validate everything except local file selections before any uploads.
  dispatchPlan.parse({...plan,tasks:plan.tasks.map(({files,folders,...t})=>t)});
  const request=b=>this.bridge.request(`/api/bridge/skill-assistant/${scope.commandId}`,'POST',b,true);
  const promise=this.run(scope,plan,request,signature);this.requests.set(key,{signature,promise});try{return await promise;}catch(e){this.requests.delete(key);throw e;}
 }
 async run(scope,plan,request,signature){
  const receipt=await request({action:'work-status',id:plan.id});if(receipt.status!=='missing'){if(receipt.sourceSignature!==signature)throw Error('Batch ID already used for a different plan');return receipt;}
  const context=await request({action:'work-context'}),policy=fileAccessPolicy(this.bridge.store,context.source),privateRoot=await realpath(this.bridge.dataDir);
  const allowed=(scope.attachments||[]).map(f=>({path:f.path,folder:f.kind==='folder'}));
  const checked=async selected=>{
   if(typeof selected!=='string'||!path.isAbsolute(selected))throw Error('请提供所选附件的绝对路径 / Use an absolute attachment path');
   const info=await lstat(selected);if(info.isSymbolicLink())throw Error('不能转发符号链接 / Cannot forward symbolic links');const canonical=await realpath(selected);
   const input=allowed.some(a=>canonical===a.path||a.folder&&contains(a.path,canonical));
   if(contains(privateRoot,canonical)&&!input)throw Error('不能转发应用私有数据 / Cannot forward app-private data');
   if(!input)policy.resolve(canonical);
   if(canonical.split(path.sep).some(sensitive))throw Error('不能转发凭据或工具配置目录 / Cannot forward credentials or tool configuration');
   return {canonical,info};
  };
  const encrypted=!!this.bridge.busy.get(scope.parentCommandId)?.encryptedChat,secrets=new Map();
  const uploaded=[],temporary=path.join(this.bridge.dataDir,'dispatch-transfers',randomUUID()),omitted=[];await mkdir(temporary,{recursive:true,mode:0o700});
  const transfer=async(file,name,purpose,expected)=>{
   const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
   try{
    const stat=await handle.stat();if(expected&&stamp(stat)!==stamp(expected))throw Error('Attachment changed before upload');if(!stat.isFile())throw Error('Not a regular file');const initial=stamp(stat),hash=createHash('sha256'),buffer=Buffer.alloc(192*1024);
    if(encrypted){
     const meta={...fileSecret({name,mime:purpose==='folder'?'application/zip':'application/octet-stream',size:stat.size}),...(purpose==='folder'?{folder:true}:{})},state={uploads:[{stamp:initial,meta}]};
     await this.bridge.chatEncryption.uploadFiles(b=>request({...b,action:'work-upload'}),[{file:handle,name,mime:meta.mime,size:stat.size,stamp:initial}],state);
     const id=state.uploads[0].id;uploaded.push(id);secrets.set(id,meta);return id;
    }
    let progress=await request({action:'work-upload',method:'POST',body:{name,mime:purpose==='folder'?'application/zip':'application/octet-stream',size:stat.size,purpose}});uploaded.push(progress.id);
    let failures=0,offset=0;while(offset<stat.size){const wanted=Math.min(buffer.length,stat.size-offset);let n=0;while(n<wanted){const r=await handle.read(buffer,n,wanted-n,offset+n);if(!r.bytesRead)throw Error('File changed during transfer');n+=r.bytesRead;}
     try{progress=await request({action:'work-upload',method:'PUT',uploadId:progress.id,body:{offset,data:buffer.subarray(0,n).toString('base64')}});failures=0;}catch(e){if(++failures>3)throw e;const status=await request({action:'work-upload',method:'GET',uploadId:progress.id});if(status.received===offset)continue;if(status.received!==offset+n)throw Error('Upload offset changed');progress=status;}
     hash.update(buffer.subarray(0,n));offset+=n;
    }
    if(progress.sha256!==hash.digest('hex')||stamp(await handle.stat())!==initial)throw Error('Attachment changed during upload');return progress.id;
   }finally{await handle.close();}
  };
  try{
   const tasks=[];
   for(const task of plan.tasks){const {files=[],folders=[],...t}=task;if(!Array.isArray(files)||!Array.isArray(folders)||files.length+folders.length+(t.attachments?.length||0)>5)throw Error('每项任务最多 5 个附件 / Up to 5 attachments per task');const attachments=[...(t.attachments||[])];if(encrypted&&attachments.length)throw Error('Encrypted tasks require local attachment files');
    for(const selected of files){const {canonical,info}=await checked(selected);if(!info.isFile())throw Error('Use folders for directories');attachments.push({uploadId:await transfer(canonical,path.basename(canonical),'file',info)});}
    for(const selected of folders){const {canonical,info}=await checked(selected);if(!info.isDirectory())throw Error('Select a folder');const archive=path.join(temporary,randomUUID()+'.zip');await packFolder(canonical,archive,()=>{},relative=>{const blocked=relative.split('/').some(sensitive)||contains(privateRoot,path.join(canonical,relative))&&!allowed.some(a=>a.folder&&contains(a.path,path.join(canonical,relative)));if(blocked)omitted.push({task:t.key,path:relative});return !blocked;});const uploadId=await transfer(archive,path.basename(canonical)+'.zip','folder');if(encrypted)attachments.push({uploadId});else{const result=await request({action:'work-folder-upload',uploadId,name:path.basename(canonical)});attachments.push({folderArchiveId:result.id});}}
    if(encrypted){const secureTask=await this.bridge.chatEncryption.ring().encrypt(context.projectId,['task',plan.id,t.key],{prompt:t.prompt,title:t.title,files:attachments.map(a=>secrets.get(a.uploadId))});tasks.push({...t,prompt:'[加密团队任务 / Encrypted team task]',title:'团队任务 / Team task',secureTask,attachments});}else tasks.push({...t,attachments});
   }
   const result=await request({action:'work-dispatch',plan:{...plan,tasks},sourceSignature:signature});return {...result,...(omitted.length?{omitted}:{} )};
  }finally{await rm(temporary,{recursive:true,force:true});await Promise.allSettled(uploaded.map(uploadId=>request({action:'work-upload',method:'DELETE',uploadId})));}
 }
 release(commandId){for(const key of this.requests.keys())if(key.startsWith(commandId+':'))this.requests.delete(key);}
}
