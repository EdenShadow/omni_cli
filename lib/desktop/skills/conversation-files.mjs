import {constants} from 'node:fs';
import {open,lstat,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileAccessPolicy} from '../file-access.mjs';
import {z} from 'zod';
import {MAX_CHAT_FILE_BYTES,attachmentMime} from '../../shared/chat-attachments.mjs';
const schema=z.object({action:z.literal('conversation-files'),id:z.string().uuid(),text:z.string().max(4000).default(''),files:z.array(z.string().min(1).max(4096)).min(1).max(30)}).strict();
const stamp=s=>[s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs].join(':');
export class ConversationFiles{
 constructor(exchange){this.exchange=exchange;this.requests=new Map();}
 async send(scope,body){
  const input=schema.parse(body),bridge=this.exchange.bridge,request=b=>{if(!this.exchange.isActive(scope))throw Error('会话已结束');return bridge.request(`/api/bridge/skill-assistant/${scope.commandId}`,'POST',b,true);};
  const context=await request({action:'conversation-context'}),policy=fileAccessPolicy(bridge.store,context.source),key=scope.commandId+':'+input.id,signature=JSON.stringify(input),old=this.requests.get(key);if(old&&old.signature!==signature)throw Error('请为不同附件使用新的交付标识');if(old?.promise)return old.promise;
  const stored=bridge.store.conversationFileUploads?.[key];if(stored&&stored.signature!==signature)throw Error('交付标识已用于不同内容');const state=old||stored||{signature,uploads:[]};this.requests.set(key,state);
  state.promise=(async()=>{if(state.result)return state.result;const handles=[];
   try{const privateRoot=await realpath(bridge.dataDir),runtimeRoot=bridge.runtimeDirectory&&await realpath(bridge.runtimeDirectory).catch(()=>null);
    for(const selected of input.files){if(!path.isAbsolute(selected))throw Error('附件需要绝对路径');policy.resolve(selected);const initial=await lstat(selected),canonical=await realpath(selected);policy.resolve(canonical);if(canonical.split(path.sep).some(name=>/^(?:\.git|\.ssh|\.aws|\.codex|\.claude|\.dsh|\.wanwu|skill-contexts|node_modules|\.env(?:\..*)?|auth\.json|credentials(?:\.json)?|.*\.(?:pem|key))$/i.test(name)))throw Error('不能交付凭据或工具配置文件');if(initial.isSymbolicLink()||[privateRoot,runtimeRoot].filter(Boolean).some(root=>canonical===root||canonical.startsWith(root+path.sep)))throw Error('不能交付应用私有数据或符号链接');const file=await open(selected,constants.O_RDONLY|constants.O_NOFOLLOW);handles.push({file});const info=await file.stat();if(!info.isFile()||stamp(initial)!==stamp(info)||stamp(await lstat(selected))!==stamp(info)||info.size>MAX_CHAT_FILE_BYTES)throw Error('文件不可用、已改变或超过 1 GB');Object.assign(handles.at(-1),{name:path.basename(selected),mime:attachmentMime(selected),size:info.size,stamp:stamp(info)});}
    const existing=await request({action:'conversation-status',id:input.id});for(const saved of state.uploads)saved.committed=existing.files.some(f=>f.id===saved.meta.id);
    const metadata=await bridge.chatEncryption.uploadFiles(b=>request({...b,action:'conversation-upload'}),handles,state);
    bridge.store.conversationFileUploads={...bridge.store.conversationFileUploads,[key]:{signature,uploads:state.uploads}};bridge.save();
    const receipt=await request({action:'conversation-commit',id:input.id,files:state.uploads.map(f=>({id:f.meta.id,uploadId:f.id}))});
    const files=metadata.map((secret,i)=>({secret,endpoint:receipt.files[i].endpoint}));
    bridge.enqueue(context.session.id,{id:'conversation-files-'+input.id,kind:'tool',role:'assistant',activity:'fileDelivery',label:'会话附件',status:'completed',text:input.text||'附件已交付到当前会话',conversationFiles:files,...(!scope.native?{commandId:scope.commandId}:{})});
    await bridge.flush();await request({action:'conversation-context'});state.result={status:'delivered',sessionId:context.session.id,files:metadata.map(({id,name,mime,size})=>({id,name,mime,size})),destination:'conversation'};return state.result;
   }finally{await Promise.allSettled(handles.map(f=>f.file.close()));}
  })();try{return await state.promise;}finally{state.promise=null;}
 }
 release(id){for(const key of this.requests.keys())if(key.startsWith(id+':')){this.requests.delete(key);if(this.exchange.bridge.store.conversationFileUploads)delete this.exchange.bridge.store.conversationFileUploads[key];}}
}
