import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {loadState,lock} from '../src/state.mjs';
import {readRuntimeOrder,writeRuntimeOrder,runtimeOrderCommand,installRuntimeOrderReporting} from '../src/runtime-order.mjs';

function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'omni-order-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const state=loadState(dir);
  Object.assign(state.store,{endpoint:'https://test.invalid',userId:'alice',token:'test-token',device:{runtimes:['codex','dsh']},pendingFinish:{task:{status:'complete'}}});
  state.save();return state;
}
test('CLI commands work alongside a locked daemon without overwriting its state',t=>{
  const state=fixture(t),original=fs.readFileSync(path.join(state.directory,'state.json'),'utf8');
  const unlock=lock(state.directory);t.after(unlock);
  const cli=(...args)=>JSON.parse(execFileSync(process.execPath,[fileURLToPath(new URL('../bin/omni.mjs',import.meta.url)),'runtimes','order',...args],{encoding:'utf8',env:{...process.env,OMNI_HOME:state.directory}}));
  assert.deepEqual(cli().order,['codex','claude','dsh']);
  assert.deepEqual(cli('set','claude,dsh,codex').order,['claude','dsh','codex']);
  assert.deepEqual(cli().boundOrder,['dsh','codex']);
  assert.deepEqual(cli('set','dsh','codex','claude').order,['dsh','codex','claude']);
  assert.deepEqual(cli('reset').order,['codex','claude','dsh']);
  assert.equal(fs.readFileSync(path.join(state.directory,'state.json'),'utf8'),original);
});
test('strict validation, account/server/device isolation and reset of damaged preferences',t=>{
  const state=fixture(t);
  writeRuntimeOrder(state,['claude','codex','dsh']);
  for(const args of [['set'],['set','claude','claude','dsh'],['set','codex','claude','wanwu'],['set','codex','claude'],['reset','extra'],['oops']]){
    assert.throws(()=>runtimeOrderCommand(state,args));
    assert.deepEqual(readRuntimeOrder(state),['claude','codex','dsh']);
  }
  for(const changed of [{userId:'bob'},{endpoint:'https://other.invalid'},{installation:'other-device'}]){
    assert.deepEqual(readRuntimeOrder({...state,store:{...state.store,...changed}}),['codex','claude','dsh']);
  }
  assert.throws(()=>runtimeOrderCommand({...state,store:{}},['reset']),/login/);
  const file=path.join(state.directory,fs.readdirSync(state.directory).find(f=>f.startsWith('runtime-order-')));
  if(process.platform!=='win32')assert.equal(fs.statSync(file).mode&0o777,0o600);
  fs.writeFileSync(file,'broken');
  assert.throws(()=>readRuntimeOrder(state));
  runtimeOrderCommand(state,['reset']);
  assert.deepEqual(readRuntimeOrder(state),['codex','claude','dsh']);
});
test('same running bridge reports changed order on next report and retains other capabilities',t=>{
  const state=fixture(t),messages=[];
  const bridge={store:state.store,documentsPath:state.directory,busy:new Map([['active',{}]]),generationJobs:new Map(),skills:{jobs:new Map()},ws:{readyState:1,send:text=>messages.push(JSON.parse(text))}};
  installRuntimeOrderReporting(bridge,state);
  bridge.reportGroupChat();
  assert.deepEqual(messages.at(-1).botProviderOrder,['codex','claude','dsh','wanwu']);
  writeRuntimeOrder(state,['dsh','claude','codex']);
  bridge.reportGroupChat();
  assert.deepEqual(messages.at(-1).botProviderOrder,['dsh','claude','codex','wanwu']);
  assert.equal(messages.at(-1).busy,true);
  assert.equal(messages.at(-1).writable,true);
  assert.equal(messages.at(-1).type,'group-chat-state');
  assert.equal(bridge.busy.size,1);
  const file=path.join(state.directory,fs.readdirSync(state.directory).find(f=>f.startsWith('runtime-order-')));
  fs.writeFileSync(file,'broken');
  const errors=[];t.mock.method(console,'error',message=>errors.push(message));
  bridge.reportGroupChat();bridge.reportGroupChat();
  assert.equal(errors.length,1);
  assert.deepEqual(messages.at(-1).botProviderOrder,['dsh','claude','codex','wanwu']);
  runtimeOrderCommand(state,['reset']);bridge.reportGroupChat();
  assert.deepEqual(messages.at(-1).botProviderOrder,['codex','claude','dsh','wanwu']);
  bridge.ws.readyState=3;bridge.reportGroupChat();assert.equal(messages.length,5);
});
