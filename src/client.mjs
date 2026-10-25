import fs from 'node:fs';
import path from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {RuntimeBridge} from '../lib/desktop/bridge.mjs';
import {detectRuntimes,installSkills} from '../lib/desktop/runtimes.mjs';
import {createRequest} from './api.mjs';
import {privateDirectory} from './state.mjs';
export {detectRuntimes};
export const skillsRoot=fileURLToPath(new URL('../bundled-skills',import.meta.url));
export function client(state,notify=()=>{}){
  const {store,directory:dataDir,save}=state;
  const documentsPath=store.workspace||path.join(dataDir,'projects');
  fs.mkdirSync(documentsPath,{recursive:true,mode:0o700});
  const runtimeDirectory=privateDirectory(process.env.WANWU_RUNTIME_DIR||path.join(homedir(),'.wanwu','runtime'));
  const request=createRequest(store);
  const bridge=new RuntimeBridge({store,save,request,notify,skillsRoot,dataDir,publicDir:skillsRoot,documentsPath,runtimeDirectory});
  bridge.recoverBinding=async(force=false)=>{
    if(!force)return;
    const r=await request('/api/devices/bind','POST',{installation:store.installation,machineKey:store.machineKey,name:store.deviceName||store.device.name,platform:process.platform,runtimes:store.device.runtimes});
    store.device=r.device;store.deviceToken=r.deviceToken;save();
  };
  return bridge;
}
export function bootstrap(providers){
  return providers.flatMap(provider=>installSkills(skillsRoot,provider).map(s=>({provider,...s})));
}
export async function importAll(bridge,projectId,providers){
  let count=0;const errors=[];
  for(const provider of providers){
    let cursor;const seen=new Set();
    do{
      const page=await bridge.list({provider,cursor});
      const usable=page.sessions.filter(s=>{try{return path.isAbsolute(s.cwd)&&fs.statSync(s.cwd).isDirectory();}catch{return false;}});
      for(let i=0;i<usable.length;i+=500){
        try{const imported=await bridge.importSessions({projectId,sessions:usable.slice(i,i+500)});count+=imported.length;}
        catch(error){errors.push({provider,error:error.message});}
      }
      cursor=page.cursor;
      if(cursor&&seen.has(cursor))throw Error('Runtime repeated its history cursor');
      seen.add(cursor);
    }while(cursor);
  }
  return {count,errors};
}
