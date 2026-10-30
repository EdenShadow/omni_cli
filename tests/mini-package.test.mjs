import {runNpm} from '../scripts/npm.mjs';
import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
test('standalone Mini installs offline with no AI dependencies and exposes only public chat controls',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'omni-mini-'));
 try{
  const output=JSON.parse(execFileSync(process.execPath,['scripts/package-mini.mjs',path.join(dir,'out')],{encoding:'utf8'}))[0];
  assert.equal(output.dependencies,0);assert.ok(output.unpackedSize<150000);
  const prefix=path.join(dir,'install');runNpm(['install','--offline','--ignore-scripts','--no-audit','--no-fund','--prefix',prefix,output.file],{stdio:'pipe'});
  const pkg=path.join(prefix,'node_modules/@edenshadow/omni-mini'),manifest=JSON.parse(fs.readFileSync(path.join(pkg,'package.json')));
  assert.equal(manifest.dependencies,undefined);assert.equal(fs.existsSync(path.join(pkg,'lib/desktop')),false);assert.equal(fs.existsSync(path.join(pkg,'bundled-skills')),false);
  const entry=path.join(pkg,'bin/omni-mini.mjs'),env={...process.env,OMNI_MINI_HOME:path.join(dir,'state')};
  const run=(...args)=>execFileSync(process.execPath,[entry,...args],{encoding:'utf8',env,stdio:['ignore','pipe','pipe']});
  assert.match(run('--help'),/Mini/);assert.match(run('chat','--help'),/--session/);assert.match(run('agents','--help'),/备注/);
  assert.throws(()=>run('start'),/Mini only/);assert.throws(()=>run('sessions','update'),/Mini only/);
  assert.throws(()=>run('chat','list','bad-id'),/UUID/);
  const status=JSON.parse(run('status'));assert.equal(status.mode,'mini');assert.equal(status.signedIn,false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
