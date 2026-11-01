// A bounded, declarative interaction contract. Generated assets never execute code.
export const triggerEffects = ['fireworks','confetti','glow'];
export function defaultPropTrigger(effect='fireworks') {
  return {event:'click',effect,radius:3,cooldown:8000,duration:4000,colors:['#efba55','#b491e1','#72bca6']};
}
export function validatePropTrigger(trigger) {
  if(trigger===undefined)return;
  if(!trigger||trigger.event!=='click'||!triggerEffects.includes(trigger.effect)||Object.keys(trigger).some(k=>!['event','effect','radius','cooldown','duration','colors'].includes(k)))throw Error('触发道具只支持点击烟花、彩纸或发光效果');
  if(!Number.isFinite(trigger.radius)||trigger.radius<1||trigger.radius>5)throw Error('触发范围须为 1–5 格');
  if(!Number.isInteger(trigger.duration)||trigger.duration<1000||trigger.duration>6000||!Number.isInteger(trigger.cooldown)||trigger.cooldown<trigger.duration||trigger.cooldown>60000)throw Error('效果持续 1–6 秒，冷却须不少于效果时间且不超过 60 秒');
  if(!Array.isArray(trigger.colors)||trigger.colors.length<1||trigger.colors.length>4||trigger.colors.some(c=>!/^#[\da-f]{6}$/i.test(c)))throw Error('触发效果需要 1–4 个六位十六进制颜色');
}
export function canReachProp(scene,module,actor) {
  if(!actor||/^(walk|run)/.test(actor.state||''))return false;
  // Measure from the object's edge, so large objects remain usable from the floor.
  const x=actor.x/100*scene.columns,y=actor.y/100*scene.rows;
  return Math.hypot(Math.max(module.x-x,0,x-module.x-module.width),Math.max(module.y-y,0,y-module.y-module.height))<=module.trigger.radius;
}
export function createPropActivation(scene,module,{id,userId,requestId,startedAt,seed}) {
  validatePropTrigger(module.trigger);
  return {id,moduleId:module.id,userId,requestId,effect:module.trigger.effect,colors:module.trigger.colors,
    x:(module.x+module.width/2)/scene.columns*100,y:(module.y+module.height*.35)/scene.rows*100,
    startedAt,endsAt:startedAt+module.trigger.duration,cooldownUntil:startedAt+module.trigger.cooldown,seed};
}
// Identical particles for all viewers. At most 36 particles per activation.
export function propEffectParticles(seed,effect) {
  let s=seed>>>0;const rand=()=>((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296);
  return Array.from({length:effect==='glow'?12:36},(_,i)=>{const angle=(i%12)/12*Math.PI*2,spread=45+rand()*48;
    return {x:Math.cos(angle)*spread+(Math.floor(i/12)-1)*50,y:Math.sin(angle)*spread-110-rand()*40,delay:effect==='fireworks'?Math.floor(i/12)*.15:rand()*.15,rotation:rand()*540,size:3+rand()*4};});
}
