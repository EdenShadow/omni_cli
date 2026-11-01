import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {planPropRoaming,inspectPropRoaming,roamingGeometry,samplePropRoaming} from './prop-roaming.mjs';
import {validateProp} from './prop-art.mjs';

// Read-only simulation against actual geometry. No project writes or paid calls.
export function checkPropPlacement(context,{moduleId,manifest,art,x,y}){
 const navigation=context.navigation||context,scene=structuredClone(navigation.scene);
 if(!scene?.columns||!scene?.walkable)throw Error('缺少实际场景几何，请提供 SCENE_CONTEXT.json 或 scene-context 快照');
 let module=scene.modules.find(m=>m.id===moduleId);
 if(manifest){
  validateProp(manifest,art);
  if(!Number.isFinite(x)||!Number.isFinite(y))throw Error('新道具检查需要 --x / --y 停靠点（格）');
  module={...manifest,id:moduleId||'placement-preview',x,y};
  scene.modules=[...scene.modules.filter(m=>m.id!==module.id),module];
 }
 if(!module?.behavior)throw Error('找不到自主道具 behavior');
 const devices=navigation.devices||navigation.projectComputers||[],plan=planPropRoaming(scene,module,devices),geometry=roamingGeometry(scene,module,devices);
 const result=inspectPropRoaming(plan,module);
 // Check every frame and regular samples including the return journey.
 const points=[...plan.frames];for(let t=0;t<=plan.duration;t+=100)points.push(samplePropRoaming(plan,t));
 const collisionFree=points.every(p=>geometry.valid(p));
 return {moduleId:module.id,...result,collisionFree,valid:!result.issues.length&&collisionFree,
  reactions:['onTouch','onTimer'].filter(key=>module.behavior.trail?.[key]).map(trigger=>({trigger,emotion:module.behavior.trail[trigger].emotion||null,duration:module.behavior.trail[trigger].duration})),
  verification:'geometry-simulation-only'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
  const context=JSON.parse(readFileSync(args[0]||'SCENE_CONTEXT.json','utf8')),file=option('--prop');
  const result=checkPropPlacement(context,{moduleId:option('--module'),manifest:file?JSON.parse(readFileSync(file,'utf8')):undefined,
   art:file?readFileSync(path.join(path.dirname(file),'prop.svg'),'utf8'):undefined,x:option('--x')===undefined?undefined:Number(option('--x')),y:option('--y')===undefined?undefined:Number(option('--y'))});
  console.log(JSON.stringify(result,null,2));if(!result.valid)process.exitCode=1;
 }catch(error){console.error(error.message);process.exitCode=1;}
}
