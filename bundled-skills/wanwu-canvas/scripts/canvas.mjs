#!/usr/bin/env node
import path from 'node:path';
import {readFileSync,createWriteStream,existsSync,constants} from 'node:fs';
import {rm} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {resolveContext} from './runtime.mjs';
import {openFiles,closeFiles,upload} from './transport.mjs';

const args=process.argv.slice(2),options={};let action;
const uuid=v=>{if(!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v||''))throw Error('Use --request UUID; reuse it after a timeout');return v;};
const canvasUuid=v=>{if(!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v||''))throw Error('Use --canvas with the complete canvas ID copied from Canvas tools');return v.toLowerCase();};
async function main(){
try{
 while(args.length){const a=args.shift();if(a.startsWith('--')){if(!['scope','context','project','runtime','native-session','provider','include','canvas','request','input','revision','key','mode','file','file-id','output','cdn','entry','document','cursor'].includes(a.slice(2))||!args.length)throw Error('Invalid option '+a);options[a.slice(2)]=args.shift();}else if(!action)action=a;else throw Error('Unexpected argument');}
 if(!['context','list','get','live','publish','capture','cover','patch','attach','download','state','update','signal','state-list','share','delete','usage-summary','usage-requests','collab-snapshot','collab-commit'].includes(action))throw Error('Usage: canvas.mjs context|list|get|live|publish|capture|cover|patch|attach|download|state|update|signal|state-list|share|delete|usage-summary|usage-requests|collab-snapshot|collab-commit [options]');
 const needsCanvas=['get','live','capture','cover','patch','attach','download','state','update','signal','state-list','share','delete','collab-snapshot','collab-commit'].includes(action);
 const canvasId=options.canvas!==undefined||needsCanvas?canvasUuid(options.canvas):undefined;
 const resolved=await resolveContext(options);if(resolved.selection){process.stdout.write(JSON.stringify(resolved.selection,null,2)+'\n');return;}
 const u=new URL(resolved.context.url);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||u.pathname!=='/skills'||u.username||u.password||u.search)throw Error('Invalid runtime endpoint');
 const request=async body=>{const r=await fetch(u,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+resolved.context.token},body:JSON.stringify(body),signal:AbortSignal.timeout(120000),redirect:'error'});const result=await r.json();if(!r.ok)throw Object.assign(Error(result.error||'Canvas request failed'),{status:r.status});return result;};
 const context=await request({action:'context',detail:'summary',include:options.include?.split(',')||[]});if(options.project&&![context.project.id,context.project.name].includes(options.project))throw Error('Project does not match this request');
 if(action!=='context'&&!context.capabilities?.canvas)throw Error('请更新万物服务端与客户端以使用画布 / Update Wanwu server and app for canvas support');
 if(action.startsWith('collab-')&&!context.capabilities?.canvasCollaboration)throw Error('请更新万物服务端以使用多人协作 / Update the server for canvas collaboration');
 const input=()=>{if(!options.input||!path.isAbsolute(options.input))throw Error('Use --input /absolute/manifest.json');return JSON.parse(readFileSync(options.input,'utf8'));};
 const mutating=async(id,fn)=>{const old=await request({action:'canvas-result',requestId:id});return old.status==='complete'?old.result:fn();};
 let result;
 if(action==='context')result=context;
 else if(['usage-summary','usage-requests'].includes(action)){if(!context.capabilities?.aiUsage)throw Error('请更新服务端以读取 AI 用量');result=await request({action,filters:options.input?input():{}});}
 else if(action==='list')result=await request({action:'canvas-list'});
 else if(['get','live'].includes(action))result=await request({action:'canvas-'+action,canvasId});
 else if(action==='capture')result=await capture(canvasId,uuid(options.request),options.entry);
 else if(action==='cover'){const current=await request({action:'canvas-get',canvasId});result=await setImage(canvasId,uuid(options.request),options.file,current.contentRevision);}
 else if(action==='publish'){
  const requestId=uuid(options.request),manifest=input(),cover=manifest.cover||{mode:'screenshot'};
  if(manifest.id!==undefined)manifest.id=canvasUuid(manifest.id);
  if(canvasId&&manifest.id&&canvasId!==manifest.id)throw Error('--canvas and manifest.id must identify the same canvas');
  if(canvasId)manifest.id=canvasId;
  if(manifest.id&&(!Number.isSafeInteger(manifest.revision)||manifest.revision<1))throw Error('Read get --canvas ID first and include its revision when updating');
  if(!['screenshot','page','image','preserve'].includes(cover.mode))throw Error('Cover mode must be screenshot, page, image or preserve');
  if(cover.mode==='page'&&!(manifest.files||[]).some(f=>f.path===cover.entry&&f.path.endsWith('.html')))throw Error('Include cover.entry HTML in the files list');
  if(cover.mode==='image'&&(!cover.file||!path.isAbsolute(cover.file)))throw Error('Use cover.file with an absolute image path');
  result=await mutating(requestId,async()=>{
   const refs=manifest.files||[],handles=await openFiles(refs.map(f=>f.file),resolved.file,8*1024*1024),ids=[];
   try{
    for(let i=0;i<handles.length;i++){
     if(/(?:^|\/)(?:\.env(?:\.|$)|auth\.json$|credentials)/i.test(refs[i].path))throw Error('Do not publish credential files');
     if(/\.(html|js|mjs|json|txt)$/i.test(refs[i].path)){const text=await handles[i].file.readFile('utf8');if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:sk-[a-zA-Z0-9_-]{24,}|AKID[a-zA-Z0-9]{28,})\b/.test(text))throw Error('Remove credentials from '+refs[i].path);}
     await upload(request,'canvas-upload',handles[i],id=>ids.push(id));
    }
    const payload={...manifest,requestId,files:refs.map((f,i)=>({path:f.path,uploadId:ids[i]}))};delete payload.file;
    delete payload.cover;
    if(cover.mode==='image'){const images=await openFiles([cover.file],resolved.file,8*1024*1024);try{payload.coverUploadId=await upload(request,'canvas-upload',images[0],()=>{});}finally{await closeFiles(images);}}
    return request({action:'canvas-publish',...payload});
   }finally{await closeFiles(handles);}
  });
  if(result.canvas.kind==='owned'&&['screenshot','page'].includes(cover.mode))try{const image=await capture(result.canvas.id,coverRequestId(requestId),cover.mode==='page'?cover.entry:undefined,result.canvas.contentRevision);result={...result,coverStatus:'ready',cover:image};}catch(e){result={...result,coverStatus:'failed',coverError:e.message};}
  else if(cover.mode==='preserve')result={...result,coverStatus:result.canvas.coverId?'preserved':'missing'};
 }else if(action==='attach'){
  const requestId=uuid(options.request);result=await mutating(requestId,async()=>{const handles=await openFiles([options.file],resolved.file,2*1024*1024*1024);try{const h=handles[0];if(h.size>500*1024*1024){if(!h.name.endsWith('.zip'))throw Error('Files over 500 MB must be a project ZIP');h.mime='application/zip';h.purpose='folder';}let id;await upload(request,'canvas-upload',h,value=>id=value);return request({action:'canvas-attach',canvasId,requestId,uploadId:id,path:h.name});}finally{await closeFiles(handles);}});
 }else if(action==='download'){
  if(!options.output||!path.isAbsolute(options.output)||existsSync(options.output))throw Error('Use --output with a new absolute file path');
  const f=await request({action:'canvas-file',canvasId,fileId:uuid(options['file-id']),cdn:options.cdn==='1'});const target=options.cdn==='1'?(f.cdn?.url||f.url):f.url;if(!target)throw Error('This download transport is unavailable');const response=await fetch(target,{signal:AbortSignal.timeout(600000),redirect:'error'});if(!response.ok)throw Error('Download failed');
  let size=0;const hash=createHash('sha256');try{await pipeline(Readable.fromWeb(response.body),new Transform({transform(chunk,_,done){size+=chunk.length;if(size>f.file.size)return done(Error('Download exceeds expected size'));hash.update(chunk);done(null,chunk);}}),createWriteStream(options.output,{flags:constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,mode:0o600}));if(size!==f.file.size||hash.digest('hex')!==f.file.sha256)throw Error('Download verification failed');}catch(e){await rm(options.output,{force:true});throw e;}result={status:'downloaded',file:options.output,size};
 }else if(action==='state-list')result=await request({action:'canvas-state-list',canvasId});
 else if(action==='state')result=options.input?await request({...input(),action:'canvas-state',canvasId,method:'PUT',requestId:uuid(options.request)}):await request({action:'canvas-state',canvasId,key:options.key||'main'});
 else if(action==='collab-snapshot')result=await request({action:'canvas-collab-snapshot',canvasId,document:options.document||'main',cursor:options.cursor||''});
 else if(action==='collab-commit')result=await request({action:'canvas-collab-commit',canvasId,document:options.document||'main',batch:{...input(),requestId:uuid(options.request)}});
 else if(action==='update')result=await request({...input(),action:'canvas-state-update',canvasId,requestId:uuid(options.request)});
 else if(action==='signal')result=await request({...input(),action:'canvas-broadcast',canvasId,requestId:uuid(options.request)});
 else if(action==='patch')result=await request({...input(),action:'canvas-patch',canvasId,requestId:uuid(options.request)});
 else if(action==='share')result=await request({action:'canvas-share',canvasId,...(options.mode?{mode:options.mode,revision:Number(options.revision)}:{})});
 else if(action==='delete')result=await request({action:'canvas-delete',canvasId,revision:Number(options.revision),requestId:uuid(options.request)});
 function coverRequestId(id){const h=createHash('sha256').update(id+':cover').digest('hex');return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-a'+h.slice(17,20)+'-'+h.slice(20,32);}
 async function setImage(id,requestId,file,contentRevision){return mutating(requestId,async()=>{const handles=await openFiles([file],resolved.file,8*1024*1024);try{const uploadId=await upload(request,'canvas-upload',handles[0],()=>{});return request({action:'canvas-attach',canvasId:id,requestId,uploadId,role:'cover',contentRevision});}finally{await closeFiles(handles);}});}
 async function capture(id,requestId,entry,contentRevision){if(entry&&!context.capabilities?.canvasCoverPage)throw Error('请更新桌面客户端以截图专用封面页面 / Update desktop app for custom cover pages');if(!context.capabilities?.canvasCapture)throw Error('请更新桌面客户端以自动生成封面 / Update desktop app for cover capture');return request({action:'canvas-capture',canvasId:id,requestId,entry,contentRevision});}
 // Derive a stable app link even when the remote server predates openUri.
 if(result?.canvas?.id&&['publish'].includes(action))result.canvas.openUri=`wanwu://app/canvas/${canvasUuid(result.canvas.id)}?project=${canvasUuid(result.canvas.projectId||context.project.id)}`;
 if(['get','patch'].includes(action)&&result?.id)result.openUri=`wanwu://app/canvas/${canvasUuid(result.id)}?project=${canvasUuid(result.projectId||context.project.id)}`;
 process.stdout.write(JSON.stringify(result,null,2)+'\n');
}catch(e){process.stderr.write(e.message+'\n');process.exitCode=1;}

}
await main();
