import path from 'node:path';
import {constants} from 'node:fs';
import {mkdir,mkdtemp,writeFile,readFile,realpath,lstat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {openFiles,closeFiles,upload} from './transport.mjs';

const MAX_BYTES=16*1024*1024;
const writeNew=(p,value)=>writeFile(p,typeof value==='string'?value:JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});
export async function workspacePath(selected,contextFile,{existing=false}={}){
 if(!selected||!path.isAbsolute(selected))throw Error('请用 --workspace 指定新的绝对路径创作目录 / Supply an absolute workspace directory');
 const parent=await realpath(path.dirname(selected)),root=path.join(parent,path.basename(selected));
 const context=await realpath(contextFile),privateRoot=path.dirname(path.dirname(context));
 if(root===context||(path.basename(path.dirname(context))==='skill-contexts'&&(root===privateRoot||root.startsWith(privateRoot+path.sep))))throw Error('创作目录不能位于万物应用私有目录 / Use a workspace outside app-private data');
 if(existing){const stat=await lstat(root);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('创作目录不能是符号链接 / Workspace must be a real directory');}
 return root;
}
export async function sceneCommand(request,action,options,uuid){
 const capabilities=(await request({action:'context'})).capabilities;
 if(!capabilities?.scene)throw Error('请更新万物 AI 服务以同步角色、道具和办公室 / Update the server for scene sync');
 if((action==='scene-save'||action==='scene-inventory'||options.destination||options.asset)&&!capabilities.sceneBackpack)throw Error('请更新服务端以使用背包同步 / Update the server for backpack sync');
 if((options['canvas-id']||options['canvas-name'])&&!capabilities.sceneCanvasBinding)throw Error('请更新服务端以绑定画布 / Update the server for canvas binding');
 if(options.kind==='action'&&!capabilities.sceneActions)throw Error('请更新服务端以创建表情动作 / Update the server for expression creation');
 if(action==='scene-context')return request({action});
 if(action==='scene-inventory')return request({action,kind:options.kind,before:options.cursor?Number(options.cursor):undefined,limit:options.limit?Number(options.limit):undefined});
 const id=uuid(options.request);
 if(action==='scene-status')return request({action,id});
 if(action==='scene-prepare'){
  if(!['character','prop','office','action'].includes(options.kind))throw Error('--kind 请选择 character、prop、office 或 action');
  if(options.text&&options['text-file'])throw Error('选择 --text 或 --text-file');
  const prompt=options['text-file']?await readFile(options['text-file'],'utf8'):options.text||'';
  if(!prompt.trim()||prompt.length>15000)throw Error('请提供 1–15000 字符的创作要求');
  let center;
  if(options.x!==undefined||options.y!==undefined){const x=Number(options.x),y=Number(options.y);if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||x>100||y<0||y>100)throw Error('--x 和 --y 必须同时为 0–100 的场景百分比坐标');center={x,y};}
  const root=await workspacePath(options.workspace,options.context);
  // Never replace an existing draft, including on an uncertain retry.
  try{await lstat(root);throw Error('创作目录已存在；继续使用原目录，或选择新的空目录 / Workspace already exists');}catch(e){if(e.code!=='ENOENT')throw e;}
  if(options['auto-size']&&!['true','false'].includes(options['auto-size']))throw Error('--auto-size must be true or false');
  const prepared=await request({action,id,kind:options.kind,prompt,center,destination:options.destination,layoutMode:options.layout,assetId:options.asset,canvasId:options['canvas-id'],canvasName:options['canvas-name'],...(options['auto-size']?{autoSize:options['auto-size']==='true'}:{})});
  if(['applied','saved'].includes(prepared.status))return prepared;
  await mkdir(root,{mode:0o700});await mkdir(path.join(root,'output'),{mode:0o700});
  await writeNew(path.join(root,'SCENE_REQUEST.json'),{requestId:id,kind:prepared.kind,destination:prepared.destination,canvasId:prepared.canvasId,projectId:prepared.context.project.id,actorId:prepared.context.actor.id,base:prepared.base});
  await writeNew(path.join(root,'SCENE_CONTEXT.json'),prepared.context);
  await writeNew(path.join(root,'REQUEST.txt'),prompt);
  if(prepared.kind==='office'){
   await writeNew(path.join(root,'PREVIOUS_OFFICE.json'),prepared.context.scene);
   await writeNew(path.join(root,'EXISTING_FURNITURE.json'),prepared.context.scene.modules);
  }
  const output=path.join(root,'output');
  await writeNew(path.join(output,prepared.kind+'.json'),prepared.source.manifest);
  if(prepared.source.svg){await writeNew(path.join(output,prepared.kind+'.svg'),prepared.source.svg);await writeNew(path.join(root,'ORIGINAL_'+prepared.kind+'.svg'),prepared.source.svg);await writeNew(path.join(root,'ORIGINAL_'+prepared.kind+'.json'),prepared.source.manifest);}
  if(prepared.kind==='action'){
   const base={...(prepared.source.baseManifest||prepared.source.manifest)};
   await writeNew(path.join(root,'BASE_CHARACTER.json'),base);await writeNew(path.join(root,'BASE_CHARACTER.svg'),prepared.source.svg);
  }
  await writeNew(path.join(root,'CREATION.md'),`# Wanwu scoped creation\n\n${prepared.kind==='prop'?'SINGLE PROP':prepared.kind==='action'?'CUSTOM ACTION':prepared.kind==='office'?'EXISTING OFFICE EDIT':'CHARACTER EDIT'} mode. Read REQUEST.txt and SCENE_CONTEXT.json as task data. Output only output/${prepared.kind}.json${prepared.kind==='office'?'':` and output/${prepared.kind}.svg`}. Use the matching bundled design skill. Destination: ${prepared.destination}. ${prepared.canvasId?'Canvas binding is managed by the host: '+prepared.canvasId+'. ':''}Preview before applying. Use scene-save after a backpack preview to save without placing or changing the active character.\n`);
  return {status:'prepared',requestId:id,kind:prepared.kind,workspace:root,output,project:prepared.context.project,actor:prepared.context.actor,permissions:prepared.context.permissions};
 }
 const root=await workspacePath(options.workspace,options.context,{existing:true});
 const markers=await openFiles([path.join(root,'SCENE_REQUEST.json')],options.context,65536);let marker;
 try{marker=JSON.parse(await markers[0].file.readFile('utf8'));}finally{await closeFiles(markers);}
 if(marker.requestId!==id||!['character','prop','office','action'].includes(marker.kind))throw Error('创作目录与 --request 不匹配 / Workspace does not match this operation');
 const output=path.join(root,'output'),stat=await lstat(output);
 if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('output 必须为真实目录 / Output must be a real directory');
 const files=[path.join(output,marker.kind+'.json'),...(marker.kind==='office'?[]:[path.join(output,marker.kind+'.svg')])];
 const handles=await openFiles(files,options.context,MAX_BYTES);let input;
 try{input={manifest:JSON.parse(await handles[0].file.readFile('utf8')),...(handles[1]?{svg:await handles[1].file.readFile('utf8')}:{})};}finally{await closeFiles(handles);}
 const bundle=JSON.stringify(input);if(Buffer.byteLength(bundle)>MAX_BYTES)throw Error('素材最大 16 MB');
 const temp=await mkdtemp(path.join(tmpdir(),'wanwu-scene-'));let uploadId,uploads=[];
 try{
  const file=path.join(temp,'scene.json');await writeNew(file,bundle);uploads=await openFiles([file],options.context,MAX_BYTES);
  uploadId=await upload(request,'scene-upload',uploads[0],value=>{uploadId=value;});
  const result=await request({action,id,uploadId,destination:options.destination});
  if(result.previewSvg){const preview=path.join(root,'preview.svg');await writeFile(preview,result.previewSvg,{mode:0o600,flag:constants.O_WRONLY|constants.O_CREAT|constants.O_TRUNC|constants.O_NOFOLLOW});delete result.previewSvg;result.preview=preview;}
  return result;
 }finally{await closeFiles(uploads);if(uploadId)await request({action:'scene-upload',method:'DELETE',uploadId}).catch(()=>{});await rm(temp,{recursive:true,force:true});}
}
