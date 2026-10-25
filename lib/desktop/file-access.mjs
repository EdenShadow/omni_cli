import path from 'node:path';
import {realpathSync,statSync} from 'node:fs';
export const IMPORTED_ROOT='wanwu:imported';
export const fileAccessMode=store=>store.fileAccessByUser?.[store.userId]==='all'?'all':'imported';
const denied=()=>{throw Error('仅可访问本项目已导入的文件夹。请让设备主人导入所需文件夹，或在那台电脑的个人设置中开放全部文件访问。 / Only imported project folders are shared. Ask the device owner to import a folder or allow all files in personal settings.');};
const inside=(root,target)=>{const relative=path.relative(root,target);return relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));};
function normalizeLocation(target){
 let normalized=path.resolve(target);
 if(process.platform==='darwin')for(const alias of ['/var','/tmp','/etc'])if(inside(alias,normalized)){normalized=path.join(realpathSync(alias),path.relative(alias,normalized));break;}
 return normalized;
}
export function fileAccessPolicy(store,request){
 // These identities and roots are supplied by the authenticated server, never
 // by the requesting browser. Missing scope metadata fails closed.
 const own=!!request.userId&&request.userId===request.deviceOwnerId;
 const unrestricted=own||fileAccessMode(store)==='all';
 const roots=[...new Set(unrestricted?[]:request.importedRoots||[])].filter(p=>typeof p==='string'&&path.isAbsolute(p)).flatMap(p=>{
   try{const canonical=realpathSync(p);return path.relative(canonical,normalizeLocation(p))===''&&statSync(canonical).isDirectory()?[{name:path.basename(canonical)||canonical,path:canonical}]:[];}catch{return [];}
 });
 function resolve(target){
  if(unrestricted)return target?realpathSync(target):undefined;
  if(!target||!path.isAbsolute(target))return denied();
  // Reject lexical escapes before touching an unrelated protected directory.
  const normalized=normalizeLocation(target);
  if(!roots.some(r=>inside(r.path,normalized)))return denied();
  const canonical=realpathSync(normalized);if(!roots.some(r=>inside(r.path,canonical)))return denied();return canonical;
 }
 return {unrestricted,roots,resolve,contains:target=>{try{resolve(target);return true;}catch{return false;}}};
}
export function createFileAccessSettings({getStore,save,permissions}){
 return async function settings(input={}){
  const store=getStore(),userId=store.userId;if(!userId)throw Error('请先登录 / Sign in first');
  let systemAccess='not-checked';
  if(input.mode!==undefined){
   if(!['all','imported'].includes(input.mode))throw Error('Invalid file access mode');
   if(input.mode==='all'&&fileAccessMode(store)!=='all'){
    const result=await permissions.run(true);systemAccess=result.systemAccess;
    if(!result.enabled)return {mode:fileAccessMode(store),systemAccess};
   }
   if(getStore()!==store||getStore().userId!==userId)throw Error('账号已改变，请重新设置 / Account changed');
   const previous=fileAccessMode(store);store.fileAccessByUser={...store.fileAccessByUser,[userId]:input.mode};
   try{save();}catch(error){store.fileAccessByUser[userId]=input.mode==='all'?previous:'imported';throw error;}
  }
  return {mode:fileAccessMode(store),systemAccess};
 };
}
