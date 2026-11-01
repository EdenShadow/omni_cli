import {explicitSeatCapacity, evenlySpacedSeats} from './seat-capacity.mjs';
import {defaultPropTrigger} from './prop-triggers.mjs';
import {resolveProjectScene} from './project-scene.mjs';
import {planPropKick} from './prop-motion.mjs';

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
  if(required.trigger&&!result.behavior)result.trigger={...defaultPropTrigger(required.trigger),...result.trigger,effect:required.trigger};
  if(/不能触发|不可触发|不放烟花|不发光|no trigger|not interactive/i.test(prompt))delete result.trigger;
  return result;
}
export function kickedPropPosition(input,module,actor,devices=[]) {
  validatePropPhysics(module.physics);
  const point=planPropKick(resolveProjectScene(input),module,actor,devices).frames.at(-1);
  return {x:point.x,y:point.y};
}
