import test from 'node:test';
import assert from 'node:assert/strict';
import {DesktopSkills} from '../lib/desktop/skills/service.mjs';

test('official apps use the project release while ordinary GitHub skills still check their source',async()=>{
 const catalog={items:[
  {name:'official-fixture',officialApp:{publisher:'fixture'},autoUpdate:true,canEdit:true,source:{repo:'official'},activeVersion:'1.0.0',versions:[{version:'1.0.0',sha256:'official-hash'}]},
  {name:'ordinary-fixture',autoUpdate:true,canEdit:true,source:{repo:'ordinary'},activeVersion:'1.0.0',versions:[{version:'1.0.0',sha256:'ordinary-hash'}]}
 ]},updates=[],installed=[];
 const bridge={store:{},notify(){},request:async()=>catalog};
 const service=new DesktopSkills(bridge,{detect:()=>[{provider:'codex',available:true}],github:{beginCheck(){},update:async source=>{updates.push(source.repo);return null;}}});
 service.install=async input=>{installed.push(input);return {state:'current'};};
 const result=await service.runSync('project',true);
 assert.deepEqual(updates,['ordinary']);assert.deepEqual(installed.map(i=>[i.name,i.expectedSha]),[['official-fixture','official-hash'],['ordinary-fixture','ordinary-hash']]);assert.deepEqual(result.errors,[]);
 service.stop();
});
