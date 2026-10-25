import path from 'node:path';
import {mkdir,writeFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {workspacePath} from './scene.mjs';

export async function referenceCommand(request,action,options){
 if(!(await request({action:'context'})).capabilities?.sceneReferences)throw Error('请更新万物 AI 服务以获取成员与办公室参考 / Update the server for project image references');
 if(action==='scene-members')return request({action,query:options.query||'',cursor:options.cursor,limit:options.limit===undefined?50:Number(options.limit)});
 if(options.office!==undefined&&!['true','false'].includes(options.office))throw Error('--office 必须是 true 或 false');
 const root=await workspacePath(options.workspace,options.context);
 try{await lstat(root);throw Error('参考目录已存在，请选择新的目录 / Reference workspace already exists');}catch(e){if(e.code!=='ENOENT')throw e;}
 const result=await request({action,members:options.members||[],office:options.office==='true',props:options.props||[]});
 if(result.status!=='ready')return result;
 const paths=new Set();let total=0;
 const files=result.files.map(f=>{
  if(typeof f.path!=='string'||! /^(?:members\/[a-zA-Z0-9-]+|office|props\/[0-9]+)\/[a-zA-Z0-9-]+\.(?:json|svg|png)$/.test(f.path)||paths.has(f.path))throw Error('参考文件路径无效 / Invalid reference file path');
  paths.add(f.path);const bytes=Buffer.from(f.data,'base64');total+=bytes.length;
  if(bytes.length!==f.size||bytes.length>16*1024*1024||total>32*1024*1024||createHash('sha256').update(bytes).digest('hex')!==f.sha256)throw Error('参考文件完整性校验失败 / Reference integrity check failed');
  return {...f,bytes};
 });
 await mkdir(root,{mode:0o700});
 for(const f of files){const target=path.join(root,f.path);await mkdir(path.dirname(target),{recursive:true,mode:0o700});await writeFile(target,f.bytes,{mode:0o600,flag:'wx'});}
 const manifest={...result,files:result.files.map(({data,...f})=>f)};
 await writeFile(path.join(root,'REFERENCES.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600,flag:'wx'});
 const absolute=files=>Object.fromEntries(Object.entries(files).map(([k,p])=>[k,path.join(root,p)]));
 return {status:'ready',project:result.project,actorId:result.actorId,workspace:root,manifest:path.join(root,'REFERENCES.json'),members:result.members.map(m=>({...m,files:absolute(m.files),...(m.activeAction?{activeAction:{...m.activeAction,files:absolute(m.activeAction.files)}}:{})})),office:result.office?{...result.office,files:absolute(result.office.files)}:null,props:result.props.map(p=>({...p,files:absolute(p.files)})),warnings:result.warnings};
}
