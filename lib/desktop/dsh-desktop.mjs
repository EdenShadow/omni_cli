import path from 'node:path';
import {existsSync} from 'node:fs';
import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {execFileSync} from 'node:child_process';
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
let registryCache;
function readWindowsDshRegistry(){
  if(process.platform!=='win32')return [];
  if(registryCache&&Date.now()-registryCache.time<30_000)return registryCache.rows;
  let rows=[];
  try{
    const command="$ErrorActionPreference='SilentlyContinue'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); @(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' | Where-Object { $_.DisplayName -match '^DeepSeek Harness(?:$|\\s+\\d)' } | Select-Object DisplayName,InstallLocation,DisplayIcon) | ConvertTo-Json -Compress";
    const shell=path.join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
    rows=JSON.parse(execFileSync(shell,['-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',windowsHide:true,timeout:5000,maxBuffer:1024*1024}));
  }catch{}
  registryCache={time:Date.now(),rows};
  return rows;
}
export function registeredDshCandidates(rows){
  return (Array.isArray(rows)?rows:rows?[rows]:[]).flatMap(row=>{
    if(!/^DeepSeek Harness(?:$|\s+\d)/i.test(row?.DisplayName||''))return [];
    const location=typeof row.InstallLocation==='string'?row.InstallLocation.trim().replace(/^"(.*)"$/,'$1'):'';
    const icon=typeof row.DisplayIcon==='string'?row.DisplayIcon.trim().replace(/,\s*-?\d+$/,'').replace(/^"(.*)"$/,'$1'):'';
    return [location&&path.join(location,'DeepSeek Harness.exe'),icon].filter(Boolean);
  });
}
export function desktopDshFromLauncher(file,{platform=process.platform,exists=existsSync}={}){
  if(platform!=='win32'||!/[\\/]resources[\\/]runtime[\\/]cli[\\/]bin[\\/]dsh\.cmd$/i.test(file||''))return null;
  const executable=path.resolve(path.dirname(file),'../../../..','DeepSeek Harness.exe');
  return desktopDshLaunch(executable,{platform,exists})?executable:null;
}
export function findDesktopDsh({env=process.env,platform=process.platform,exists=existsSync,readRegistry=readWindowsDshRegistry}={}){
  const candidates=platform==='darwin'?['/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness',path.posix.join(env.HOME||homedir(),'Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness')]:platform==='win32'?[
    env.LOCALAPPDATA&&path.join(env.LOCALAPPDATA,'Programs/DeepSeek Harness/DeepSeek Harness.exe'),
    ...[env.ProgramFiles,env.ProgramW6432,env['ProgramFiles(x86)']].filter(Boolean).map(root=>path.join(root,'DeepSeek Harness/DeepSeek Harness.exe')),
  ]:[];
  const installed=candidates.find(file=>desktopDshLaunch(file,{platform,exists}));
  if(installed)return installed;
  if(platform==='win32'){
    try{return registeredDshCandidates(readRegistry()).find(file=>desktopDshLaunch(file,{platform,exists}))||null;}catch{}
  }
  return null;
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
