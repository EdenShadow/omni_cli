import {explicitSeatCapacity, evenlySpacedSeats} from './seat-capacity.mjs';
import {defaultPropTrigger} from './prop-triggers.mjs';
import {sceneObstacles, resolveProjectScene} from './project-scene.mjs';

export function validatePropPhysics(physics) {
  if(physics===undefined)return;
  if(!physics||physics.kind!=='kick'||!Number.isFinite(physics.distance)||physics.distance<1||physics.distance>8||!Number.isInteger(physics.duration)||physics.duration<200||physics.duration>1800||Object.keys(physics).some(k=>!['kind','distance','duration'].includes(k)))throw Error('可踢道具需要 kick 类型、1–8 格距离与 200–1800 毫秒滚动时间');
}
export function requestedPropCapabilities(prompt) {
  const deniedSeat=/不能坐|不可坐|无法坐|not sit|not seat/i.test(prompt);
  const sit=!deniedSeat&&/可以坐|可坐|能坐|坐[下人]|沙发|长椅|座椅|sofa|couch|bench|seatable|sit on/i.test(prompt);
  const n=explicitSeatCapacity(prompt) || 1;
  const kick=!/不能踢|不可踢|无法踢|not kick/i.test(prompt)&&/可以踢|可踢|能踢|踢动|踢的|足球|kickable|kick(?:ing)? (?:a |the )?ball/i.test(prompt);
  const effect=/烟花|焰火|firework/i.test(prompt)?'fireworks':/彩纸|礼花|confetti/i.test(prompt)?'confetti':/发光|亮灯|glow|light up/i.test(prompt)?'glow':undefined;
  const trigger=!/不能触发|不可触发|不放烟花|不发光|no trigger|not interactive/i.test(prompt)?effect:undefined;
  return {seats:sit?n:0,kick,trigger};
}
export function fulfillPropCapabilities(manifest,prompt) {
  const required=requestedPropCapabilities(prompt),result=structuredClone(manifest);
  if(required.seats&&(!result.seats?.length||(explicitSeatCapacity(prompt)&&result.seats.length!==required.seats)))result.seats=evenlySpacedSeats(required.seats,result.seats?.[0]?.y??68);
  if(/不能坐|不可坐|无法坐|not sit|not seat/i.test(prompt))result.seats=[];
  if(/不能踢|不可踢|无法踢|not kick/i.test(prompt))delete result.physics;
  if(required.kick&&!result.physics)result.physics={kind:'kick',distance:4,duration:700};
  if(required.trigger)result.trigger={...defaultPropTrigger(required.trigger),...result.trigger,effect:required.trigger};
  if(/不能触发|不可触发|不放烟花|不发光|no trigger|not interactive/i.test(prompt))delete result.trigger;
  return result;
}
export function kickedPropPosition(input,module,actor,devices=[]) {
  const scene=resolveProjectScene(input),physics=module.physics;validatePropPhysics(physics);
  if(!physics)throw Error('这个道具还没有可踢属性');
  const cx=module.x+module.width/2,cy=module.y+module.height/2;
  let dx=cx-actor.x/100*scene.columns,dy=cy-actor.y/100*scene.rows;
  const length=Math.hypot(dx,dy);if(length>8)throw Error('请先走到道具附近');
  if(length<.05){dx=1;dy=0;}else{dx/=length;dy/=length;}
  const obstacles=sceneObstacles({...scene,modules:scene.modules.filter(m=>m.id!==module.id)}).map(r=>({x:r.x/100*scene.columns,y:r.y/100*scene.rows,width:r.width/100*scene.columns,height:r.height/100*scene.rows}));
  // Desks keep a stable footprint in scene units, independent of the viewer's zoom.
  for(const d of devices)obstacles.push({x:d.x/100*scene.columns-2.55,y:d.y/100*scene.rows-1.2,width:5.1,height:2.8});
  const floor={x:scene.walkable.x/100*scene.columns,y:scene.walkable.y/100*scene.rows,right:(scene.walkable.x+scene.walkable.width)/100*scene.columns,bottom:(scene.walkable.y+scene.walkable.height)/100*scene.rows};
  const overlaps=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
  let point={x:module.x,y:module.y};
  for(let distance=.08;distance<=physics.distance+.001;distance+=.08){const next={x:module.x+dx*distance,y:module.y+dy*distance,width:module.width,height:module.height};
    if(next.x<floor.x||next.y<floor.y||next.x+next.width>floor.right||next.y+next.height>floor.bottom||obstacles.some(o=>overlaps(next,o)))break;
    point={x:Math.round(next.x*1000)/1000,y:Math.round(next.y*1000)/1000};
  }
  return point;
}
