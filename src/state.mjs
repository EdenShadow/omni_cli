import fs from 'node:fs';
import path from 'node:path';
import {homedir} from 'node:os';
import {randomUUID,randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';

export function privateDirectory(directory){
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const st=fs.lstatSync(directory);
  if(st.isSymbolicLink()||!st.isDirectory())throw Error('State directory must be a real directory');
  if(process.platform==='win32'){
    const who=execFileSync('whoami.exe',['/user','/fo','csv','/nh'],{encoding:'utf8',windowsHide:true});
    const sid=who.match(/S-1-5-[\d-]+/)?.[0];if(!sid)throw Error('Cannot identify Windows account');
    execFileSync('icacls.exe',[directory,'/reset'],{stdio:'pipe',windowsHide:true});
    execFileSync('icacls.exe',[directory,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F'],{stdio:'pipe',windowsHide:true});
  }else{
    if(st.uid!==process.getuid())throw Error('State directory belongs to another user');
    fs.chmodSync(directory,0o700);
  }
  return directory;
}
export function loadState(directory=process.env.OMNI_HOME||path.join(homedir(),'.omni-cli')){
  directory=privateDirectory(path.resolve(directory));
  const file=path.join(directory,'state.json');
  let store={installation:randomUUID(),machineKey:randomBytes(32).toString('hex')};
  if(fs.existsSync(file)){
    if(fs.lstatSync(file).isSymbolicLink())throw Error('State file must not be a link');
    try{store=JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw Error('State file is damaged; restore a backup instead of replacing the device identity');}
  }
  const save=()=>{
    const temp=path.join(directory,`state-${randomUUID()}.tmp`);
    try{fs.writeFileSync(temp,JSON.stringify(store),{mode:0o600,flag:'wx'});fs.renameSync(temp,file);}
    finally{fs.rmSync(temp,{force:true});}
  };
  return {store,save,directory};
}
export function lock(directory){
  const file=path.join(directory,'agent.lock');
  const nonce=randomUUID();
  for(let attempt=0;attempt<2;attempt++){
    try{fs.writeFileSync(file,JSON.stringify({pid:process.pid,nonce}),{flag:'wx',mode:0o600});break;}
    catch(e){
      if(e.code!=='EEXIST')throw e;
      let pid;try{pid=JSON.parse(fs.readFileSync(file,'utf8')).pid;}catch{throw Error('Invalid agent lock. Check running processes before removing agent.lock.');}
      let alive=true;try{process.kill(pid,0);}catch(error){if(error.code==='ESRCH')alive=false;}
      if(alive||attempt)throw Error('Omni CLI is already running. Stop it before changing login or binding.');
      fs.rmSync(file);
    }
  }
  return ()=>{try{if(JSON.parse(fs.readFileSync(file)).nonce===nonce)fs.rmSync(file);}catch{}};
}
