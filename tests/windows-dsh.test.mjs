import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {findDesktopDsh,desktopDshLaunch,registeredDshCandidates} from '../lib/desktop/dsh-desktop.mjs';
import {runtimeLaunch,resolveRuntimeExecutable} from '../lib/desktop/runtime-launch.mjs';

test('desktop DSH uses the official Electron CLI without shell expansion or an inherited Electron flag',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'万物 DSH '));
  try{
    const root=path.join(dir,'Programs/DeepSeek Harness'),exe=path.join(root,'DeepSeek Harness.exe');
    for(const f of [exe,path.join(root,'resources/app.asar'),path.join(root,'resources/runtime/cli/bin/dsh.cmd')]){fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,'fixture');}
    assert.equal(findDesktopDsh({env:{LOCALAPPDATA:dir},platform:'win32'}),exe);
    assert.equal(findDesktopDsh({env:{LOCALAPPDATA:dir},platform:'darwin'}),null);
    const desktop=desktopDshLaunch(exe,{platform:'win32'});
    const args=[...desktop.args,'web','--patch',path.join(dir,'中文 & %PATH%.json')];
    const launch=runtimeLaunch(exe,args,{platform:'win32',electronNode:true,env:{}});
    assert.deepEqual(launch.args,args);assert.equal(launch.command,exe);assert.equal(launch.env.ELECTRON_RUN_AS_NODE,'1');
    assert.equal(runtimeLaunch(exe,args,{env:{ELECTRON_RUN_AS_NODE:'1'}}).env.ELECTRON_RUN_AS_NODE,undefined);
    fs.unlinkSync(path.join(root,'resources/app.asar'));assert.equal(findDesktopDsh({env:{LOCALAPPDATA:dir},platform:'win32',readRegistry:()=>[]}),null);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('Windows detects a custom desktop installation before its first launch and resolves its official CMD entry',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'DSH 自定义 & '));
  try{
    const exe=path.join(dir,'DeepSeek Harness.exe'),launcher=path.join(dir,'resources/runtime/cli/bin/dsh.cmd');
    // No DSH profile, sessions, running process or first-run marker is present.
    for(const file of [exe,launcher,path.join(dir,'resources/app.asar')]){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'never execute this fixture');}
    const options={env:{},platform:'win32'};
    const row={DisplayName:'DeepSeek Harness 0.2.1-rc.3',InstallLocation:dir};
    assert.equal(findDesktopDsh({...options,readRegistry:()=>[row]}),exe);
    assert.equal(findDesktopDsh({...options,readRegistry:()=>({...row,InstallLocation:'',DisplayIcon:`"${exe}",0`})}),exe);
    assert.equal(resolveRuntimeExecutable('dsh',launcher,{platform:'win32'}),exe);
    assert.equal(resolveRuntimeExecutable('claude',launcher,{platform:'win32'}),null);
    const arbitrary=path.join(dir,'dsh.cmd');fs.writeFileSync(arbitrary,'echo unsafe');
    assert.equal(resolveRuntimeExecutable('dsh',arbitrary,{platform:'win32'}),null);
    assert.equal(findDesktopDsh({...options,readRegistry:()=>[{...row,DisplayName:'Another App'}]}),null);
    assert.equal(findDesktopDsh({...options,readRegistry:()=>{throw Error('Registry unavailable');}}),null);
    assert.deepEqual(registeredDshCandidates(null),[]);
    fs.unlinkSync(path.join(dir,'resources/app.asar'));
    assert.equal(findDesktopDsh({...options,readRegistry:()=>[row]}),null);
    assert.equal(resolveRuntimeExecutable('dsh',launcher,{platform:'win32'}),null);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('Windows checks alternate Program Files roots without querying registry when found',()=>{
  for(const key of ['ProgramFiles','ProgramW6432','ProgramFiles(x86)']){
    const root=path.resolve('fixture-program-files'),exe=path.join(root,'DeepSeek Harness/DeepSeek Harness.exe');
    const files=new Set([exe,path.join(root,'DeepSeek Harness/resources/app.asar'),path.join(root,'DeepSeek Harness/resources/runtime/cli/bin/dsh.cmd')]);
    assert.equal(findDesktopDsh({env:{[key]:root},platform:'win32',exists:file=>files.has(file),readRegistry:()=>{assert.fail('Unnecessary registry query');}}),exe);
  }
  assert.equal(findDesktopDsh({env:{},platform:'linux',readRegistry:()=>{assert.fail('Windows-only registry');}}),null);
});

