import path from 'node:path';
import {homedir} from 'node:os';
import {existsSync,readFileSync,statSync} from 'node:fs';
import {spawn} from 'node:child_process';

const packages={codex:'@openai/codex',claude:'@anthropic-ai/claude-code',dsh:'@deepseek-ai/dsh'};
const isFile=file=>{try{return statSync(file).isFile();}catch{return false;}};
export function runtimeSearchPath({platform=process.platform,env=process.env,home=homedir()}={}) {
  const p=platform==='win32'?path.win32:path;
  const inherited=env.PATH||env.Path||'';
  const extra=platform==='win32'?[p.join(home,'.local','bin'),env.APPDATA&&p.join(env.APPDATA,'npm'),env.NVM_SYMLINK,env.ProgramFiles&&p.join(env.ProgramFiles,'nodejs')]:[p.join(home,'.local','bin'),'/opt/homebrew/bin','/usr/local/bin'];
  return [...new Set([...extra.filter(Boolean),...inherited.split(p.delimiter).filter(Boolean)])].join(p.delimiter);
}
// npm's Windows launchers cannot be passed directly to spawn(). Resolve only
// known package bin entries; never run a .cmd shell with user-supplied arguments.
export function resolveRuntimeExecutable(provider,file,{platform=process.platform}={}) {
  if(!file||!isFile(file))return null;
  if(platform!=='win32')return file;
  if(/\.(exe|[cm]?js)$/i.test(file))return file;
  if(!packages[provider])return null;
  const base=path.dirname(file);
  for(const root of [path.join(base,'node_modules',packages[provider]),path.resolve(base,'..',packages[provider])]){
    try{
      const pkg=JSON.parse(readFileSync(path.join(root,'package.json'),'utf8'));
      const bin=typeof pkg.bin==='string'?pkg.bin:pkg.bin?.[provider];
      if(typeof bin!=='string')continue;
      const entry=path.resolve(root,bin),relative=path.relative(root,entry);
      if(relative.startsWith('..')||path.isAbsolute(relative)||!isFile(entry))continue;
      if(/\.(exe|[cm]?js)$/i.test(entry))return entry;
    }catch{}
  }
  return null;
}
export function runtimeLaunch(executable,args,{env=process.env,platform=process.platform,nodeExecutable,electronNode=false}={}) {
  const next={...env};delete next.ELECTRON_RUN_AS_NODE;
  if(electronNode)next.ELECTRON_RUN_AS_NODE='1';
  if(/\.(?:cmd|bat|ps1)$/i.test(executable))throw Error('请选择 Runtime 的 .exe 或 JavaScript 入口 / Select the runtime .exe or JavaScript entry');
  if(/\.[cm]?js$/i.test(executable)){
    const dirs=(env.PATH||env.Path||'').split(platform==='win32'?';':path.delimiter);
    const node=nodeExecutable||dirs.map(dir=>path.join(dir,platform==='win32'?'node.exe':'node')).find(isFile);
    if(!node)throw Error('请安装 Node.js 24 并重启万物 / Install Node.js 24 and restart Omni AI');
    return {command:node,args:[executable,...args],env:next};
  }
  return {command:executable,args,env:next};
}
export function spawnRuntime(executable,args,options={}){
  const launch=runtimeLaunch(executable,args,options);
  return spawn(launch.command,launch.args,{...options,env:launch.env,shell:false,windowsHide:true});
}
