import path from 'node:path';
import {botProviderOrder} from './bot-provider-order.mjs';
import {homedir} from 'node:os';
import {accessSync,constants,existsSync,mkdirSync,realpathSync,statSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {fileAccessMode,fileAccessPolicy} from './file-access.mjs';

export function groupChatState(b){
 let documents=b.documentsPath||path.join(homedir(),'Documents'),writable=false;
 try{documents=realpathSync(documents);accessSync(documents,constants.R_OK|constants.W_OK);writable=statSync(documents).isDirectory();}catch{}
 return {documents, writable, botProviderOrder:botProviderOrder(b.store),fileAccess:fileAccessMode(b.store),busy:!!(b.busy.size||b.generationJobs.size||b.skills.jobs.size||b.announcements?.jobs?.size||Object.keys(b.store.pendingFinish||{}).length)};
}
export function groupChatDirectory(b,r,create=false){
 const policy=fileAccessPolicy(b.store,r),documents=b.documentsPath||path.join(homedir(),'Documents');
 if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(r.folderName||''))throw Error('Invalid group chat folder');
 const target=path.join(documents,r.folderName);
 if(!existsSync(target)){
  const parent=policy.resolve(documents);accessSync(parent,constants.W_OK);
  if(!create)return target;
  mkdirSync(target,{mode:0o700});
 }
 const cwd=policy.resolve(target);
 // Do not let a replaced folder/symlink redirect a group chat outside Documents.
 const relative=path.relative(realpathSync(documents),cwd);
 if(relative.startsWith('..'+path.sep)||relative==='..'||path.isAbsolute(relative)||!statSync(cwd).isDirectory())throw Error('Group chat folder is outside Documents');
 accessSync(cwd,constants.R_OK|constants.W_OK);return cwd;
}
export async function ensureGroupChat(b,r){
 const cwd=groupChatDirectory(b,r,true),existing=b.mappings[r.sessionId];
 if(existing){
  if(existing.provider!==r.provider||existing.cwd!==cwd)throw Error('Group chat session mapping changed');
  if(r.encrypted){existing.encryptedChat=true;b.persist();}
  return {localId:existing.localId,path:cwd,title:r.name};
 }
 b.skillUpdates?.assertAvailable();
 const adapter=b.adapter(r.provider),localId=r.provider==='codex'?'pending-'+randomUUID():await adapter.create(cwd);
 b.mappings[r.sessionId]={provider:r.provider,localId,cwd,fresh:true,imported:true,autoTitle:false,encryptedChat:!!r.encrypted,groupChat:{projectId:r.projectId,userId:r.userId,folderName:r.folderName}};
 b.persist();return {localId,path:cwd,title:r.name};
}
