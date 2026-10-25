import path from 'node:path';
import {readdirSync,statSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

const fileInfo=file=>{try{const stat=statSync(file);return stat.isFile()?stat:null;}catch{return null;}};
let packageCache;
function registeredPackages(env){
  const systemRoot=env.SystemRoot||env.WINDIR||'C:\\Windows';
  if(packageCache?.systemRoot===systemRoot&&Date.now()-packageCache.time<60000)return packageCache.roots;
  let roots=[];
  try{
    // Query the current user's registered package, including non-C: installs.
    // Do not enumerate the protected WindowsApps directory or launch the GUI exe.
    const script="$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); ConvertTo-Json -Compress -InputObject @(Get-AppxPackage -Name OpenAI.Codex | Sort-Object Version -Descending | ForEach-Object { $_.InstallLocation })";
    const result=JSON.parse(execFileSync(path.join(systemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',windowsHide:true,timeout:5000,stdio:['ignore','pipe','ignore']}).replace(/^\uFEFF/,''));
    roots=(Array.isArray(result)?result:[result]).filter(root=>typeof root==='string'&&path.isAbsolute(root));
  }catch{/* Desktop exports and explicit CLI installs still work without AppX. */}
  packageCache={systemRoot,time:Date.now(),roots};return roots;
}

export function findDesktopCodex({platform=process.platform,env=process.env,packageRoots=()=>registeredPackages(env)}={}){
  if(platform!=='win32')return null;
  if(env.LOCALAPPDATA){
    const bin=path.join(env.LOCALAPPDATA,'OpenAI/Codex/bin');
    let versions=[];
    try{versions=readdirSync(bin,{withFileTypes:true}).filter(entry=>entry.isDirectory()).map(entry=>path.join(bin,entry.name,'codex.exe'));}catch{}
    // Desktop updates export into hash-named directories; hashes cannot be sorted
    // as versions. Ignore directories containing only helpers such as rg.exe.
    const candidates=[path.join(bin,'codex.exe'),...versions].map(file=>({file,stat:fileInfo(file)}))
      .filter(entry=>entry.stat).sort((a,b)=>b.stat.mtimeMs-a.stat.mtimeMs||a.file.localeCompare(b.file));
    if(candidates.length)return candidates[0].file;
  }
  try{
    for(const root of packageRoots()){
      const file=path.join(root,'app/resources/codex.exe');
      if(fileInfo(file))return file;
    }
  }catch{}
  return null;
}
