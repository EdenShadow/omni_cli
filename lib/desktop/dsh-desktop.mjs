import path from 'node:path';
import {existsSync} from 'node:fs';
import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {parseDocument} from 'yaml';

// Use the desktop application's own CLI bootstrap so its ASAR/native-module
// hooks stay intact. Never evaluate a .cmd file or pass prompts through a shell.
export function desktopDshLaunch(executable,{platform=process.platform,exists=existsSync}={}){
  if(!executable||!['win32','darwin'].includes(platform))return null;
  const paths=platform==='darwin'?path.posix:path;
  if(paths.basename(executable).toLowerCase()!==(platform==='win32'?'deepseek harness.exe':'deepseek harness'))return null;
  const root=paths.dirname(executable),resources=platform==='darwin'?paths.join(root,'../Resources'):paths.join(root,'resources');
  if(![executable,paths.join(resources,'app.asar'),paths.join(resources,'runtime/cli/bin',platform==='win32'?'dsh.cmd':'dsh')].every(exists))return null;
  return {command:executable,args:['--expose-internals',paths.join(resources,'app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js')]};
}
export function findDesktopDsh({env=process.env,platform=process.platform,exists=existsSync}={}){
  const candidates=platform==='darwin'?['/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness',path.posix.join(env.HOME||homedir(),'Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness')]:platform==='win32'?[env.LOCALAPPDATA&&path.join(env.LOCALAPPDATA,'Programs/DeepSeek Harness/DeepSeek Harness.exe'),env.ProgramFiles&&path.join(env.ProgramFiles,'DeepSeek Harness/DeepSeek Harness.exe')]:[];
  return candidates
    .find(file=>desktopDshLaunch(file,{platform,exists}))||null;
}

// The active web profile is loaded by DSH itself. Import only model providers
// from its sibling profiles, never their UI/plugins or executable YAML tags.
export function dshModelProfiles(home){
  return ['desktop','tui'].map(source=>{
    let providers={},disabled=false;
    const visit=rows=>{if(!Array.isArray(rows))return;for(const row of rows){
      if(row?.id==='llm-pi-ai'){
        if(Object.hasOwn(row,'disabled'))disabled=row.disabled!==false;
        if(Object.hasOwn(row,'config'))providers=row.config?.providers||{};
      }
      if(row?.group)visit(row.config);
      if(row?.insert)visit(row.insert);
    }};
    for(const name of ['cordis.yml','cordis.patch.yml']){
      const file=path.join(home,'profiles',source,name);
      try{
        const document=parseDocument(readFileSync(file,'utf8'),{customTags:[{tag:'tag:yaml.org,2002:js',resolve:()=>null}]});
        if(document.errors.length)throw Error('Invalid profile');
        visit(document.toJS({maxAliasCount:100}));
      }catch(error){if(error.code!=='ENOENT')throw Error(`无法读取 DeepSeek ${source} 的模型配置，请检查配置文件`);}
    }
    return {source,providers:disabled?{}:providers};
  });
}
