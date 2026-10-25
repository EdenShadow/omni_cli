import path from 'node:path';
import {homedir} from 'node:os';
import {constants} from 'node:fs';
import {open,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const CHUNK=32*1024; // Base64 plus JSON stays below old clients' 64 KiB local limit.
const stamp=s=>[s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs].join(':');
export async function openFiles(paths,contextFile,maxBytes){
 const contextPath=await realpath(contextFile),privateRoot=path.dirname(path.dirname(contextPath)),handles=[];
 try{
  for(const selected of paths){
   if(!path.isAbsolute(selected))throw Error('请使用文件的绝对路径 / Use an absolute file path');
   const canonical=await realpath(selected),runtimeRoot=await realpath(process.env.WANWU_RUNTIME_DIR||path.join(homedir(),'.wanwu','runtime')).catch(()=>null);
   if(runtimeRoot&&(canonical===runtimeRoot||canonical.startsWith(runtimeRoot+path.sep)))throw Error('不能发送运行时授权文件 / Runtime credentials cannot be shared');
   if(canonical===contextPath||(path.basename(path.dirname(contextPath))==='skill-contexts'&&(canonical===privateRoot||canonical.startsWith(privateRoot+path.sep))))throw Error('不能发送万物应用的私有数据 / App-private files cannot be shared');
   const file=await open(selected,constants.O_RDONLY|constants.O_NOFOLLOW);handles.push({file});
   const stat=await file.stat();if(!stat.isFile())throw Error('请选择文件；文件夹请先压缩 / Select a file; zip folders first');
   if(stat.size>maxBytes)throw Error(`文件过大，最多 ${maxBytes/1024/1024} MB / File is too large`);
   Object.assign(handles.at(-1),{name:path.basename(selected),size:stat.size,stamp:stamp(stat)});
  }
  return handles;
 }catch(e){await closeFiles(handles);throw e;}
}
export const closeFiles=handles=>Promise.allSettled(handles.map(h=>h.file.close()));
export async function upload(request,action,item,onCreated){
 const hash=createHash('sha256'),buffer=Buffer.alloc(CHUNK);
 let offset=0;
 while(offset<item.size){const {bytesRead}=await item.file.read(buffer,0,Math.min(buffer.length,item.size-offset),offset);if(!bytesRead)throw Error('文件在读取时已改变 / File changed while reading');hash.update(buffer.subarray(0,bytesRead));offset+=bytesRead;}
 const sha=hash.digest('hex');if(stamp(await item.file.stat())!==item.stamp)throw Error('文件已改变，请重试 / File changed; retry');
 let progress=await request({action,method:'POST',body:{name:item.name,mime:item.mime||(['board-upload','scene-upload'].includes(action)?'application/json':'application/octet-stream'),size:item.size,purpose:'file'}});
 const id=progress.id;onCreated(id);let failures=0;
 while(progress.received<item.size){
  offset=progress.received;const wanted=Math.min(buffer.length,item.size-offset);let read=0;
  while(read<wanted){const {bytesRead}=await item.file.read(buffer,read,wanted-read,offset+read);if(!bytesRead)throw Error('文件已改变 / File changed');read+=bytesRead;}
  try{progress=await request({action,method:'PUT',uploadId:id,body:{offset,data:buffer.subarray(0,wanted).toString('base64')}});failures=0;}
  catch(e){if(++failures>3||[403,404,413].includes(e.status))throw e;progress=await request({action,method:'GET',uploadId:id});}
 }
 if(progress.sha256!==sha||stamp(await item.file.stat())!==item.stamp)throw Error('文件校验失败 / File verification failed');
 return id;
}
export async function portableChat(request,body,contextFile){
 const context=await request({action:'context'}),receipt=await request({action:'chat-status',id:body.id});
 if(receipt.status==='sent')return {...receipt,projectName:context.project.name};
 const handles=await openFiles(body.files,contextFile,500*1024*1024),ids=[];
 try{
  for(const h of handles){if(body.action==='audio')h.mime=({mp3:'audio/mpeg',wav:'audio/wav',m4a:'audio/mp4',mp4:'audio/mp4',m4v:'audio/mp4',aac:'audio/aac',ogg:'audio/ogg',opus:'audio/ogg',flac:'audio/flac',webm:'audio/webm'})[path.extname(h.name).slice(1).toLowerCase()];await upload(request,'chat-upload',h,id=>ids.push(id));}
  const result=await request({id:body.id,text:body.text,autoplay:body.autoplay,...(body.action==='voice'?{action:'voice-send',voiceUploadId:ids[0]}:{action:'chat-send',attachments:ids.map(uploadId=>({uploadId}))})});
  return {...result,projectName:context.project.name};
 }finally{await closeFiles(handles);await Promise.allSettled(ids.map(uploadId=>request({action:'chat-upload',method:'DELETE',uploadId})));}
}
