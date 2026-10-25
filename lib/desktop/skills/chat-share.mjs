import {parseBuffer} from 'music-metadata';
import path from 'node:path';
import {constants} from 'node:fs';
import {open,realpath} from 'node:fs/promises';
import {z} from 'zod';
import {MAX_CHAT_FILES,MAX_CHAT_FILE_BYTES,ATTACHMENT_CHUNK_BYTES,attachmentMime,audioAttachmentMime} from '../../shared/chat-attachments.mjs';

const schema=z.object({action:z.enum(['chat','voice','audio']).default('chat'),id:z.string().uuid(),autoplay:z.boolean().optional(),text:z.string().max(4000).default(''),files:z.array(z.string().max(4096)).max(MAX_CHAT_FILES).default([])});
const stamp=s=>[s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs].join(':');
// A command-local cache shares concurrent retries. The server is the durable receipt.
export class ChatShare {
 constructor(bridge){this.bridge=bridge;this.requests=new Map();}
 release(commandId){for(const [key] of this.requests)if(key.startsWith(commandId+':'))this.requests.delete(key);}
 send(scope,body){
  const input=schema.parse(body);if(!input.text.trim()&&!input.files.length)throw Error('请输入消息或选择附件 / Add a message or file');
  if(input.action==='voice'&&input.files.length!==1)throw Error('语音需要一个音频文件 / Select one audio file');
  if(input.autoplay&&input.action==='voice')throw Error('自动音乐播放请使用 audio 或 chat / Use audio or chat for music autoplay');
  const key=scope.commandId+':'+input.id,signature=JSON.stringify(input),prior=this.requests.get(key);
  if(prior&&prior.signature!==signature)throw Error('此发送标识已用于其他内容 / Use a new request ID for different content');
  if(prior?.pending)return prior.pending;
  const state=prior||{signature,uploads:[]};this.requests.set(key,state);
  state.pending=this.perform(scope,input,state).finally(()=>{state.pending=null;});return state.pending;
 }
 async perform(scope,input,state){
  const bridge=this.bridge;
  const request=body=>{if(!bridge.skillExchange.isActive(scope))throw Error('会话已结束 / Session ended');return bridge.request(`/api/bridge/skill-assistant/${scope.commandId}`,'POST',body,true);};
  const context=await request({action:'context',detail:'summary'});
  if(!context.capabilities?.chat||(input.action==='voice'&&!context.capabilities?.voice))throw Error('请更新万物 AI 服务 / Update the Omni AI server');
  if(input.autoplay&&!context.capabilities?.audioAutoplay)throw Error('请更新万物 AI 服务以自动播放音乐 / Update the server for music autoplay');
  const receipt=await request({action:'chat-status',id:input.id});if(receipt.status==='sent')return {...await bridge.chatEncryption.receipt(receipt),projectName:context.project.name};
  const handles=[],runtimeRoot=await realpath(bridge.runtimeDirectory||path.join(bridge.dataDir,'runtime')).catch(()=>null);
  try{
   // Validate every selected file before starting any upload; never follow a final symlink.
   for(const selected of input.files){
    if(!path.isAbsolute(selected))throw Error('附件需要绝对路径 / Use an absolute file path');
    const canonical=await realpath(selected),privateRoot=await realpath(bridge.dataDir);
    if(canonical===privateRoot||canonical.startsWith(privateRoot+path.sep)||runtimeRoot&&(canonical===runtimeRoot||canonical.startsWith(runtimeRoot+path.sep)))throw Error('不能发送万物应用的私有数据 / App-private files cannot be shared');
    const file=await open(selected,constants.O_RDONLY|constants.O_NOFOLLOW);handles.push({file});
    const stat=await file.stat();if(!stat.isFile())throw Error('请选择文件；文件夹请先压缩 / Select a file; zip folders first');
    if(stat.size>MAX_CHAT_FILE_BYTES)throw Error('单个附件最多 500 MB / Each file can be up to 500 MB');
    Object.assign(handles.at(-1),{name:path.basename(selected),size:stat.size,stamp:stamp(stat)});
   }
   if(context.capabilities.encryptedChat){
    for(const item of handles)item.mime=input.action==='audio'?audioAttachmentMime(item.name):attachmentMime(item.name);
    if(input.autoplay&&!handles.some(h=>h.mime.startsWith('audio/')))throw Error('Autoplay requires an audio attachment');
    if(input.action==='voice'){
     const item=handles[0];if(item.size>32*1024*1024)throw Error('语音最多 32 MB / Voice limit is 32 MB');
     const bytes=Buffer.alloc(item.size);let offset=0;while(offset<bytes.length){const r=await item.file.read(bytes,offset,bytes.length-offset,offset);if(!r.bytesRead)throw Error('Voice file changed');offset+=r.bytesRead;}
     let metadata;try{metadata=await parseBuffer(bytes,{mimeType:audioAttachmentMime(item.name),size:item.size},{duration:true});}catch{throw Error('无法读取音频 / Cannot read audio');}input.duration=Math.round((metadata.format.duration||0)*1000);
     if(input.duration<500||input.duration>30*60*1000)throw Error('语音时长需在 0.5 秒到 30 分钟之间 / Voice duration out of range');item.mime=audioAttachmentMime(item.name);
    }
    const result=await bridge.chatEncryption.send(request,context,input,handles,state);return {...result,projectName:context.project.name};
   }
   throw Error('请升级服务器后发送加密消息 / Update the server before sending encrypted chat');
  }finally{await Promise.allSettled(handles.map(h=>h.file.close()));}
 }
}
