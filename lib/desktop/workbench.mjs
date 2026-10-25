import {DefaultWorkspaces} from './default-workspaces.mjs';
import {readCdn} from './cdn-download.mjs';
import {inspectTools} from './work-capabilities.mjs';
import {groupChatDirectory,ensureGroupChat} from './group-chat.mjs';
import {fileAccessPolicy,IMPORTED_ROOT} from './file-access.mjs';
import {MAX_FOLDER_ARCHIVE_BYTES} from '../shared/folder-transfer.mjs';
import {unpackFolder} from './folder-archive.mjs';
import {resolveLocalFolder} from './folder-attachments.mjs';
import {open} from 'node:fs/promises';
import {materialReference} from '../shared/input-materials.mjs';
import {homedir} from 'node:os';
import path from 'node:path';
import {readdirSync,realpathSync,statSync,mkdirSync,existsSync,writeFileSync,readFileSync,renameSync,rmSync,createReadStream} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {chatFileName,MAX_CHAT_FILE_BYTES,MAX_INLINE_FILE_BYTES,ATTACHMENT_CHUNK_BYTES} from '../shared/chat-attachments.mjs';

export function browseDirectory(requested){
  const current=realpathSync(requested||homedir());if(!statSync(current).isDirectory())throw Error('请选择文件夹 / Choose a folder');
  const directories=readdirSync(current,{withFileTypes:true}).filter(e=>!e.name.startsWith('.')&&e.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name)).slice(0,2000).map(e=>({name:e.name,path:path.join(current,e.name)}));
  const roots=[{name:'Home',path:homedir()}];
  if(process.platform==='win32'){for(const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ')if(existsSync(`${letter}:\\`))roots.push({name:letter+':',path:`${letter}:\\`});}
  else roots.push({name:'/',path:'/'});
  return {path:current,parent:path.dirname(current)===current?null:path.dirname(current),directories,roots};
}
export class DeviceWorkbench{
  constructor(bridge){this.bridge=bridge;this.running=false;this.metadataSent=false;this.defaultWorkspaces=new DefaultWorkspaces(bridge);}
  async pump(){
    const b=this.bridge;if(this.running||b.stopped||!b.store.deviceToken)return;this.running=true;
    void this.defaultWorkspaces.sync();
    try{
      if(!this.metadataSent){const rows=Object.entries(b.mappings).filter(([,m])=>m.cwd).map(([sessionId,m])=>({sessionId,cwd:m.cwd}));for(let i=0;i<rows.length;i+=500)await b.request('/api/bridge/workbench-metadata','POST',{sessions:rows.slice(i,i+500)},true);this.metadataSent=true;}
      const requests=await b.request('/api/bridge/workbench','GET',undefined,true);
      for(const request of requests){
        // A periodic skills check is transient, not a failed folder creation.
        // Existing mappings can be reused; new ones stay pending until ready.
        if(request.action==='group-chat-session'&&!b.mappings[request.sessionId]&&b.skillUpdates&&!b.skillUpdates.available)continue;
        b.store.workbenchResults||={};let result=b.store.workbenchResults[request.id]?.result;
        if(result){try{this.authorize(request);}catch(e){result={error:String(e.message).slice(0,2000)};}}
        if(!result||['browse','models','inspect-work'].includes(request.action)){try{result=await this.perform(request);}catch(e){result={error:String(e.message).slice(0,2000)};}
          b.store.workbenchResults[request.id]={result,created:Date.now()};
          for(const [id,v] of Object.entries(b.store.workbenchResults))if(Date.now()-v.created>86400000)delete b.store.workbenchResults[id];b.save();}
        await b.request(`/api/bridge/workbench/${request.id}`,'POST',result,true);
      }
    }finally{this.running=false;}
  }
  authorize(r){
    if(r.action==='group-chat-session'){groupChatDirectory(this.bridge,r);return fileAccessPolicy(this.bridge.store,r);}
    const policy=fileAccessPolicy(this.bridge.store,r);
    if(r.action==='browse'&&(!r.path||r.path===IMPORTED_ROOT))return policy;
    if(['models','inspect-work'].includes(r.action)&&!r.path)return policy;
    policy.resolve(r.path);return policy;
  }
  async perform(r){
    const b=this.bridge;if(r.action==='group-chat-session')return ensureGroupChat(b,r);
    const policy=this.authorize(r);
    if(r.path&&r.path!==IMPORTED_ROOT)r={...r,path:policy.resolve(r.path)};

    if(r.action==='browse'){
      try{
        if(!policy.unrestricted&&(!r.path||r.path===IMPORTED_ROOT))return {path:IMPORTED_ROOT,parent:null,directories:policy.roots,roots:policy.roots,restricted:true,virtual:true};
        const listing=browseDirectory(policy.resolve(r.path));
        if(!policy.unrestricted){listing.roots=policy.roots;listing.restricted=true;listing.directories=listing.directories.filter(d=>policy.contains(d.path));if(!listing.parent||!policy.contains(listing.parent))listing.parent=IMPORTED_ROOT;}
        return listing;
      }catch(error){
        if(['EACCES','EPERM'].includes(error.code))throw Error('目标电脑无法访问此文件夹。请让设备主人在那台电脑上检查系统文件权限；需要开放全部文件夹时，可在个人设置 → 文件访问权限中开启。 / The target computer cannot access this folder. Ask the owner to check OS permissions on that computer. All-folder sharing can be enabled in personal settings → File access.');
        throw error;
      }
    }
    if(r.action==='inspect-work')return {tools:inspectTools(r.tools||[]),checkedAt:Date.now(),allowed:true};
    if(r.action==='models')return {models:await b.adapter(r.provider).models(r.path)};
    if(r.action==='use-folder'){
      const cwd=realpathSync(r.path);if(!statSync(cwd).isDirectory())throw Error('请选择文件夹 / Choose a folder');
      return {path:cwd};
    }
    if(r.action==='create-folder'){
      if(!r.name||r.name==='.'||r.name==='..'||/[\\/\u0000-\u001f]/.test(r.name))throw Error('文件夹名称不能包含路径 / Enter a folder name, not a path');
      const parent=realpathSync(r.path);if(!statSync(parent).isDirectory())throw Error('父路径不是文件夹');
      const target=path.join(parent,r.name);if(!existsSync(target))mkdirSync(target,{mode:0o700});const cwd=policy.resolve(target);if(cwd!==target||!statSync(cwd).isDirectory())throw Error('Folder path is not a regular directory');return {path:cwd};
    }
    if(r.action==='create-session'){
      const cwd=realpathSync(r.path);if(!statSync(cwd).isDirectory())throw Error('工作目录不存在 / Working folder is missing');
      const existing=b.mappings[r.sessionId];if(existing)return {localId:existing.localId,title:r.name||(r.locale==='en'?'New session':'新会话')};
      const adapter=b.adapter(r.provider),localId=r.provider==='codex'?'pending-'+randomUUID():await adapter.create(cwd);
      b.mappings[r.sessionId]={provider:r.provider,localId,cwd,fresh:true,imported:true,autoTitle:!r.name};b.persist();return {localId,title:r.name||(r.locale==='en'?'New session':'新会话')};
    }
    if(r.action==='fork-session'){
      b.skillUpdates?.assertAvailable();
      const source=b.mappings[r.sourceSessionId];
      if(!source||source.localId!==r.sourceLocalId)throw Error('原会话不可用 / Source session unavailable');
      if([...b.busy.values()].some(v=>v.localId===source.localId))throw Error('会话正在工作 / Session is active');
      if(b.mappings[r.sessionId])return {localId:b.mappings[r.sessionId].localId,title:r.name};
      const cwd=policy.resolve(source.cwd||r.path),adapter=b.adapter(source.provider);
      const blank=source.fresh||source.localId.startsWith('pending-');
      const localId=blank?(source.provider==='codex'?'pending-'+randomUUID():await adapter.create(cwd)):await adapter.fork(source.localId,cwd,r.name);
      b.mappings[r.sessionId]={provider:source.provider,localId,cwd,fresh:blank,imported:true,autoTitle:false,...(r.encryptedChat||source.encryptedChat?{encryptedChat:true,groupChat:{projectId:r.projectId}}:{})};b.persist();
      return {localId,title:r.name};
    }
    throw Error('不支持这个设备操作 / Unsupported device action');
  }
}
export function authorizeDispatchedCommand(bridge,c,m){const opt=c.options||{};if(opt.taskDispatch){fileAccessPolicy(bridge.store,opt.taskDispatch).resolve(m.cwd);const missing=inspectTools(opt.taskDispatch.tools||[]).filter(t=>!t.available);if(missing.length)throw Error('缺少任务需要的工具 / Missing tools: '+missing.map(t=>t.name).join(', '));}}
export async function prepareCommand(bridge,c,m){
  const opt=c.options||{},attachments=[];
  if(opt.groupChat?.encryptedMessage&&!opt.secureCommand){m.encryptedChat=true;m.groupChat={...m.groupChat,projectId:c.project_id};bridge.persist();const decoded=await bridge.chatEncryption.prepare(c);c.prompt=decoded.prompt;attachments.push(...decoded.attachments);}
  authorizeDispatchedCommand(bridge,c,m);
  if(opt.groupChat){const request={...opt.groupChat,userId:c.user_id,projectId:c.project_id};if(opt.groupChat.sessionTarget){if(opt.groupChat.sessionTarget.sessionId!==c.session_id||opt.groupChat.sessionTarget.deviceId!==bridge.store.device?.id)throw Error('Session target changed');fileAccessPolicy(bridge.store,request).resolve(m.cwd);}else{const cwd=groupChatDirectory(bridge,request);if(cwd!==m.cwd)throw Error('Group chat working folder changed');}}
  if(opt.taskDispatch?.secureTask||opt.secureCommand){m.encryptedChat=true;m.groupChat={...m.groupChat,projectId:c.project_id};bridge.persist();const decoded=await bridge.chatEncryption.prepareTask(c);c.prompt=decoded.prompt;attachments.push(...decoded.attachments);}
  bridge.privacyFor?.(c.session_id).learn({prompt:c.prompt});
  if(m.encryptedChat && bridge.chatEncryption.commandDisplay)await bridge.chatEncryption.commandDisplay(c);
  if(opt.attachments?.length&&!opt.taskDispatch?.secureTask&&!opt.secureCommand){
    const dir=path.join(bridge.dataDir,'session-attachments',c.id);
    const hasTransfer=opt.attachments.some(file=>!(file.kind==='folder'&&file.transport==='local'));
    if(hasTransfer)mkdirSync(dir,{recursive:true,mode:0o700});
    const cancelled=()=>{if(bridge.cancelledCommands?.has(c.id))throw Object.assign(Error('附件接收已取消 / Attachment transfer cancelled'),{code:'WANWU_CANCELLED'});};
    const report=(status,text)=>bridge.enqueue?.(c.session_id,{kind:'tool',id:'attachment-transfer:'+c.id,commandId:c.id,role:'system',activity:'transfer',label:status==='completed'?'attachments-ready':'attachment-transfer',status,text});
    try{
      for(const file of opt.attachments){
        cancelled();if(!/^[a-f0-9-]{36}$/.test(file.id)||!Number.isSafeInteger(file.size)||file.size<0||file.size>(file.kind==='folder'?MAX_FOLDER_ARCHIVE_BYTES:MAX_CHAT_FILE_BYTES))throw Error('附件信息无效 / Invalid attachment metadata');
        if(file.kind==='folder'&&file.transport==='local'){attachments.push({...file,path:await resolveLocalFolder(bridge,c,file)});continue;}
        report('inProgress',`${attachments.length} / ${opt.attachments.length} · ${file.name}`);void bridge.flush?.().catch(()=>{});
        const target=path.join(dir,file.id+'-'+chatFileName(file.name)),part=target+'.part';
        const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
        const valid=bytes=>bytes.length===file.size&&(!file.sha256||hash(bytes)===file.sha256);
        const extracted=path.join(dir,file.id+'-folder'),ready=extracted+'.ready';
        if(file.kind==='folder'&&existsSync(extracted)&&existsSync(ready)&&readFileSync(ready,'utf8')===file.sha256){attachments.push({...file,path:extracted});continue;}
        let cached=false;if(existsSync(target)&&file.sha256){const hash=createHash('sha256');let size=0;for await(const bytes of createReadStream(target)){cancelled();size+=bytes.length;hash.update(bytes);}cached=size===file.size&&hash.digest('hex')===file.sha256;}
        if(!cached){
          const result=await bridge.request(`/api/commands/${c.id}/attachment?id=${encodeURIComponent(file.id)}&cdn=1&offset=0`,'GET',undefined,true);cancelled();
          if(result.download){
            const handle=await open(part,'w',0o600);
            try{await readCdn(result.download,{maxBytes:file.size,size:file.size,sha256:file.sha256,cancelled,write:async bytes=>{await handle.writeFile(bytes);}});await handle.close();renameSync(part,target);cached=true;}
            finally{await handle.close().catch(()=>{});rmSync(part,{force:true});}
          }
        }
        if(!cached&&(file.size>MAX_INLINE_FILE_BYTES||file.kind==='folder')){
          const handle=await open(part,'w',0o600),hash=createHash('sha256');let offset=0,shown=-1;
          try{
            while(offset<file.size){cancelled();const received=await bridge.request(`/api/commands/${c.id}/attachment?id=${encodeURIComponent(file.id)}&offset=${offset}`,'GET',undefined,true);cancelled();
              const bytes=Buffer.from(received.data,'base64');if(received.offset!==offset||received.size!==file.size||!bytes.length||bytes.length>ATTACHMENT_CHUNK_BYTES||offset+bytes.length>file.size||bytes.toString('base64')!==received.data)throw Error(`附件分块无效 / Invalid attachment chunk: ${file.name}`);
              let written=0;while(written<bytes.length){const result=await handle.write(bytes,written,bytes.length-written,offset+written);written+=result.bytesWritten;}hash.update(bytes);offset+=bytes.length;
              const progress=Math.floor(offset/file.size*10);if(progress!==shown){shown=progress;report('inProgress',`${attachments.length} / ${opt.attachments.length} · ${file.name} · ${Math.round(offset/file.size*100)}%`);void bridge.flush?.().catch(()=>{});}
            }
            cancelled();if(file.sha256&&hash.digest('hex')!==file.sha256)throw Error(`附件完整性校验失败 / Attachment integrity check failed: ${file.name}`);await handle.close();renameSync(part,target);
          }finally{await handle.close().catch(()=>{});rmSync(part,{force:true});}
        }else if(!cached){
          const received=await bridge.request(`/api/commands/${c.id}/attachment?id=${encodeURIComponent(file.id)}`,'GET',undefined,true);cancelled();
          const bytes=Buffer.from(received.data,'base64');if(!valid(bytes)||bytes.toString('base64')!==received.data)throw Error(`附件完整性校验失败 / Attachment integrity check failed: ${file.name}`);
          try{writeFileSync(part,bytes,{mode:0o600});renameSync(part,target);}finally{rmSync(part,{force:true});}
        }
        if(file.kind==='folder'){
          report('inProgress',`正在解压 / Extracting · ${file.name}`);void bridge.flush?.().catch(()=>{});
          try{await unpackFolder(target,extracted,cancelled);writeFileSync(ready,file.sha256,{mode:0o600});attachments.push({...file,path:extracted});}
          finally{rmSync(target,{force:true});}
        }else attachments.push({...file,path:target});
      }
      cancelled();if(hasTransfer)report('completed',`${attachments.length} / ${attachments.length}`);
    }catch(error){report('failed',error.message);throw error;}
  }
  const skillContext=bridge.skillExchange?await bridge.skillExchange.context(c,{localId:m.localId,provider:m.provider}):null;
  if(skillContext)for(const scope of bridge.skillExchange.tokens.values())if(scope.commandId===c.id){scope.attachments=attachments;scope.metadata={author:opt.author,groupChat:opt.groupChat?{autoReply:true,locale:opt.groupChat.locale}:undefined,taskDispatch:opt.taskDispatch?{batchId:opt.taskDispatch.batchId,key:opt.taskDispatch.key,returnToChat:!!opt.taskDispatch.returnToChat}:undefined};}
  // Ordinary input stays verbatim. This opaque reference is resolved only when
  // the sync skill is used; no workflow, project roster or credential is injected.
  const meta=skillContext?'\n\n<wanwu scope="'+c.id+'"'+(opt.author?' from='+JSON.stringify(opt.author.name):'')+' />':'';
  const group=opt.groupChat?'\n群聊 @'+(opt.groupChat.sessionTarget?.alias||'Bot')+' 请求：用'+(opt.groupChat.locale==='en'?'英文':'中文')+'回复。最终回答由宿主自动回群，不重复发文字；用户要求的结果附件用 $wanwu-skills-sync 发送。需要用户做选择时必须调用结构化提问工具；若运行时没有该工具，使用万物同步助手 question 接口等待回答，不能只在最终回复列选项。':'';
  const dispatch=opt.taskDispatch?'\n派工子任务 '+opt.taskDispatch.key+'：仅完成本项，不重复派发父计划。'+(opt.taskDispatch.returnToChat?'最终回答自动回群，结果附件按需发送。':'结果留在本会话。'):'';
  const suffix=attachments.length?'\n\n本次附件（本机已就绪，按需读取）：\n'+attachments.map(f=>JSON.stringify({reference:materialReference(f.name),name:f.name,mime:f.mime,size:f.size,kind:f.kind||'file',path:f.path})).join('\n'):'';
  return {prompt:c.prompt+meta+group+dispatch+suffix,options:{fresh:m.fresh,...opt,initialTitle:m.fresh&&m.autoTitle?(c.prompt||attachments[0]?.name):undefined,attachments,images:attachments.filter(f=>['image/png','image/jpeg','image/webp','image/gif'].includes(f.mime)).map(f=>f.path),commandId:c.id}};
}
