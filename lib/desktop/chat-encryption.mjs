import {sessionTargetFromMentions} from '../shared/session-mentions.mjs';
import {ChatKeyring,b64} from '../shared/chat-crypto.mjs';
import {fileSecret,encryptFileRecord,decryptFileRecord,encryptedFileSize,CHAT_FILE_PLAIN,CHAT_FILE_RECORD} from '../shared/chat-file-crypto.mjs';
import {mkdir,open,rename,rm} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import {nativeVideoPoster} from './video-poster.mjs';
import {chatFileName} from '../shared/chat-attachments.mjs';
import {maskedSubmissionPreview} from '../shared/conversation-privacy.mjs';

export class NativeChatEncryption {
 constructor(bridge){this.bridge=bridge;this.rings=new Map();}
 ring(){
  const b=this.bridge,scope=JSON.stringify([b.store.endpoint,b.store.userId,b.store.device?.id]);let ring=this.rings.get(scope);
  if(!ring){ring=new ChatKeyring({load:async()=>b.store.chatKeyrings?.[scope],save:async state=>{b.store.chatKeyrings||={};b.store.chatKeyrings[scope]=state;b.save();},request:(p,m,body)=>{if(b.stopped||scope!==JSON.stringify([b.store.endpoint,b.store.userId,b.store.device?.id]))throw Error('Chat identity changed');return b.request('/api'+p.replace(/^\/projects\/([^/]+)\/chat-keys/,'/bridge/chat-keys/$1'),m,body,true);}});this.rings.set(scope,ring);}return ring;
 }
 async sync(){
  const b=this.bridge;if(this.syncing||b.stopped||!b.store.deviceToken)return;this.syncing=true;
  try{const me=await b.request('/api/bridge/chat-projects','GET',undefined,true);for(const p of me.projects||[])try{await this.ring().sync(p.id);}catch{/* Removed projects cannot obtain or distribute keys. */}}finally{this.syncing=false;}
 }
 async decode(message){for(let attempt=0;;attempt++){try{return await this.ring().decrypt(message.projectId,[message.senderId,message.clientId],message.secure);}catch(e){if(e.code!=='CHAT_KEY_PENDING'||attempt>=15||this.bridge.stopped)throw e;await new Promise(r=>setTimeout(r,1000));}}}
 async receipt(result){if(!result.message?.secure)return result;const message=result.message,payload=await this.decode(message);return {...result,message:{...message,kind:payload.kind,text:payload.text,duration:payload.duration,mime:payload.kind==='voice'?payload.files[0]?.mime:undefined,attachments:(message.attachments||[]).map((f,i)=>({...f,name:payload.files[i].name,mime:payload.files[i].mime,size:payload.files[i].size,sha256:undefined}))}};}
 async prepare(c){
  const message=c.options.groupChat.encryptedMessage,payload=await this.decode(message);
  if(payload.botRequest!==true||payload.kind!=='text'||typeof payload.text!=='string'||payload.text.length>4000||payload.files?.length!==(message.attachments||[]).length)throw Error('Invalid encrypted IM command');
  const target=c.options.groupChat.sessionTarget;
  if(target||payload.sessionTarget){
   const signed=payload.sessionTarget,mention=sessionTargetFromMentions(payload.text,payload.mentions||[],payload.files.map(f=>f.name));
   if(!target||!signed||!mention||['sessionId','deviceId','alias'].some(k=>target[k]!==signed[k]||target[k]!==mention[k])||target.sessionId!==c.session_id||target.deviceId!==this.bridge.store.device?.id)throw Error('Encrypted session target changed');
  }
  const dir=path.join(this.bridge.dataDir,'session-attachments',c.id);await mkdir(dir,{recursive:true,mode:0o700});const attachments=[];
  for(let index=0;index<payload.files.length;index++){
   const meta=payload.files[index],remote=message.attachments[index],size=encryptedFileSize(meta.size);
   if(remote.size!==size)throw Error('Encrypted attachment metadata changed');
   const target=path.join(dir,remote.id+'-'+chatFileName(meta.name)),part=target+'.part',out=await open(part,'w',0o600);
   try{
    for(let offset=0,record=0;offset<size;record++){
     const result=await this.bridge.request(`/api/bridge/chat-file/${message.projectId}/${message.id}/${remote.id}?offset=${offset}`,'GET',undefined,true);
     const cipher=Buffer.from(result.data,'base64');if(cipher.length!==Math.min(CHAT_FILE_RECORD,size-offset))throw Error('Encrypted file record missing');
     await out.writeFile(await decryptFileRecord(meta,record,cipher));offset+=cipher.length;
    }
    await out.close();await rename(part,target);attachments.push({id:remote.id,name:meta.name,mime:meta.mime,size:meta.size,path:target});
   }finally{await out.close().catch(()=>{});await rm(part,{force:true});}
  }
  return {prompt:payload.text,attachments};
 }
 async uploadFiles(request,handles,state){
  const files=[];
  for(let i=0;i<handles.length;i++){
   const file=handles[i];let saved=state.uploads[i];
   if(saved&&saved.stamp!==file.stamp)throw Error('File changed; use a new send ID');
   if(!saved){saved={stamp:file.stamp,meta:{...fileSecret({name:file.name,mime:file.mime,size:file.size}),poster:await nativeVideoPoster(file)}};state.uploads[i]=saved;}
   let upload;if(saved.id)try{upload=await request({action:'chat-upload',method:'GET',uploadId:saved.id});}catch(e){if(e.status!==404)throw e;}
   if(!upload){upload=await request({action:'chat-upload',method:'POST',body:{name:saved.meta.id+'.bin',mime:'application/octet-stream',size:encryptedFileSize(file.size),purpose:saved.meta.folder?'encrypted-folder':'encrypted-chat'}});saved.id=upload.id;}
   let failures=0,cached;
   while(!upload.ready){
    const offset=upload.received;if(offset%CHAT_FILE_RECORD)throw Error('Invalid encrypted upload offset');const index=offset/CHAT_FILE_RECORD,wanted=Math.min(CHAT_FILE_PLAIN,file.size-index*CHAT_FILE_PLAIN),plain=Buffer.alloc(wanted);let read=0;
    while(read<wanted){const {bytesRead}=await file.file.read(plain,read,wanted-read,index*CHAT_FILE_PLAIN+read);if(!bytesRead)throw Error('File changed while encrypting');read+=bytesRead;}
    // Reuse the exact ciphertext after a lost acknowledgement, even if a
    // local process edits the source file while this upload is retrying.
    const data=cached?.offset===offset?cached.data:b64(await encryptFileRecord(saved.meta,index,plain));cached={offset,data};
    try{upload=await request({action:'chat-upload',method:'PUT',uploadId:saved.id,body:{offset,data}});failures=0;}catch(e){if(++failures>3)throw e;upload=await request({action:'chat-upload',method:'GET',uploadId:saved.id});if(upload.received===offset)continue;if(upload.received!==offset+plain.length+16)throw Error('Invalid encrypted upload progress');}
    if(upload.received<=offset)throw Error('Invalid upload progress');
   }
   const stat=await file.file.stat();if(file.stamp!==[stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs].join(':'))throw Error('File changed while encrypting');files.push(saved.meta);
  }
  return files;
 }
 async send(request,context,input,handles,state){
  const projectId=context.project.id,senderId=context.session.userId;if(!senderId)throw Error('Update the server for encrypted IM');
  const files=await this.uploadFiles(request,handles,state);
  const payload={kind:input.action==='voice'?'voice':'text',text:input.text||'',mentions:[],files,...(input.duration?{duration:input.duration}:{})};
  const secure=await this.ring().encrypt(projectId,[senderId,input.id],payload);
  return this.receipt(await request({action:'chat-send',id:input.id,secure,attachments:state.uploads.map(s=>({uploadId:s.id})),...(input.autoplay?{autoplay:true}:{})}));
 }
 async final(c,text){
  const projectId=c.project_id,replyTo=c.options.groupChat?.sessionTarget?c.options.groupChat.messageId:undefined;
  for(let offset=0;offset<text.length;offset+=3800){
   // Stable receipt IDs across retries and app restarts.
   const digest=createHash('sha256').update(c.id+':encrypted-final:'+offset).digest('hex'),id=`${digest.slice(0,8)}-${digest.slice(8,12)}-4${digest.slice(13,16)}-a${digest.slice(17,20)}-${digest.slice(20,32)}`;
   const request=body=>this.bridge.request(`/api/bridge/skill-assistant/${c.id}`,'POST',body,true);
   const old=await request({action:'chat-status',id});if(old.status==='sent')continue;
   const secure=await this.ring().encrypt(projectId,[c.user_id,id],{...(replyTo?{replyTo}:{}),kind:'text',text:text.slice(offset,offset+3800),mentions:[],files:[]});
   await request({action:'chat-send',id,secure,attachments:[],...(replyTo?{replyTo}:{})});
  }
 }

 async prepareTask(c){
  const dispatch=c.options.taskDispatch,payload=await this.ring().decrypt(c.project_id,c.options.secureCommand?['command',c.session_id,c.id]:['task',dispatch.batchId,dispatch.key],c.options.secureCommand||dispatch.secureTask),remotes=c.options.attachments||[];
  if(typeof payload.prompt!=='string'||payload.prompt.length>30000||!Array.isArray(payload.files)||payload.files.length!==remotes.length)throw Error('Invalid encrypted task');
  const dir=path.join(this.bridge.dataDir,'session-attachments',c.id);await mkdir(dir,{recursive:true,mode:0o700});const attachments=[];
  for(let i=0;i<remotes.length;i++){
   const remote=remotes[i],meta=payload.files[i];if(remote.size!==encryptedFileSize(meta.size))throw Error('Encrypted task attachment changed');
   const target=path.join(dir,remote.id+'-'+chatFileName(meta.name)),part=target+'.part',out=await open(part,'w',0o600);
   try{for(let offset=0,record=0;offset<remote.size;record++){
    if(this.bridge.cancelledCommands?.has(c.id))throw Object.assign(Error('Task cancelled'),{code:'WANWU_CANCELLED'});
    const r=await this.bridge.request(`/api/commands/${c.id}/attachment?id=${remote.id}&offset=${offset}`,'GET',undefined,true),cipher=Buffer.from(r.data,'base64');
    if(r.offset!==offset||cipher.length!==Math.min(CHAT_FILE_RECORD,remote.size-offset))throw Error('Encrypted attachment incomplete');
    await out.writeFile(await decryptFileRecord(meta,record,cipher));offset+=cipher.length;
   }await out.close();await rename(part,target);}finally{await out.close().catch(()=>{});await rm(part,{force:true});}
   let location=target;if(meta.folder){const {unpackFolder}=await import('./folder-archive.mjs');location=path.join(dir,remote.id+'-folder');await unpackFolder(target,location,()=>{if(this.bridge.cancelledCommands?.has(c.id))throw Error('Cancelled');});await rm(target,{force:true});}
   attachments.push({id:remote.id,name:meta.name,mime:meta.mime,size:meta.size,path:location,...(meta.folder?{kind:'folder'}:{})});
  }
  return {prompt:payload.prompt,attachments};
 }
 async commandDisplay(c){
  if(c.options.secureDisplay)return;
  const opt=c.options,task=opt.taskDispatch;
  const source=opt.groupChat?.encryptedMessage&&!opt.secureCommand?await this.decode(opt.groupChat.encryptedMessage):await this.ring().decrypt(c.project_id,opt.secureCommand?['command',c.session_id,c.id]:['task',task.batchId,task.key],opt.secureCommand||task.secureTask);
  const prompt=this.bridge.privacyFor(c.session_id).view(c.prompt);
  const secureDisplay=await this.ring().encrypt(c.project_id,['command-display',c.session_id,c.id],{prompt,...(prompt!==c.prompt?{maskedPreview:maskedSubmissionPreview(source.prompt??source.text??c.prompt)}:{}),files:source.files||[]});
  // The public command endpoint never returns the executable envelope.
  await this.bridge.request(`/api/bridge/commands/${c.id}/display`,'POST',{secureDisplay},true);
 }
 async event(sessionId,id,payload){const m=this.bridge.mappings[sessionId];if(!m?.encryptedChat)return payload;const projectId=m.groupChat.projectId;return {kind:'encrypted-chat-event',commandId:payload.commandId,...(payload.kind==='fragment'?{fragment:{group:payload.group,index:payload.index,total:payload.total}}:{}),projectId,sessionId,id,secureEvent:await this.ring().encrypt(projectId,['event',sessionId,id],payload)};}
 async history(request,page){const m=this.bridge.mappings[request.sessionId];if(!m?.encryptedChat)return page;return {...page,outputs:[],items:await Promise.all(page.items.map(item=>this.event(request.sessionId,randomUUID(),item)))};}
}
