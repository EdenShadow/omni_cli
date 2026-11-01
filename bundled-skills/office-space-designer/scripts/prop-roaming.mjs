import {floorPlanObstacles,workstationRect} from './floor-plan.mjs';
import {behaviorFingerprint} from './prop-behavior.mjs';
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const overlaps=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
const rect=(s,r)=>({x:r.x*s.columns/100,y:r.y*s.rows/100,width:r.width*s.columns/100,height:r.height*s.rows/100});
export function roamingGeometry(scene,module,devices=[]){
 const floor=rect(scene,scene.walkable),home={x:module.x,y:module.y},m=module.behavior.movement;
 const obstacles=[...(scene.obstacles||[]).map(r=>rect(scene,r)),...floorPlanObstacles(scene).map(r=>rect(scene,r)),...scene.modules.filter(o=>o.id!==module.id&&!o.walkThrough&&!['rug','window','lamp'].includes(o.kind)).map(o=>({x:o.x,y:o.y,width:o.width,height:o.height})),...devices.filter(d=>Number.isFinite(d.x)&&Number.isFinite(d.y)).map(d=>workstationRect(scene,d))];
 obstacles.sort((a,b)=>a.x-b.x||a.y-b.y||a.width-b.width||a.height-b.height);
 const valid=p=>p.x>=floor.x-1e-8&&p.y>=floor.y-1e-8&&p.x+module.width<=floor.x+floor.width+1e-8&&p.y+module.height<=floor.y+floor.height+1e-8&&distance(p,home)<=m.radius+.001&&(m.mode==='air'||!obstacles.some(o=>overlaps({...p,width:module.width,height:module.height},o)));
 // Sweep the complete footprint, rather than sampling hundreds of points per edge.
 // The floor rectangle and activity disk are convex; valid endpoints stay inside.
 const segment=(a,b)=>valid(a)&&valid(b)&&(m.mode==='air'||!obstacles.some(o=>{
  let lo=0,hi=1;
  for(const axis of ['x','y']){
   const size=axis==='x'?'width':'height',min=o[axis]-module[size]+1e-8,max=o[axis]+o[size]-1e-8,delta=b[axis]-a[axis];
   if(Math.abs(delta)<1e-9){if(a[axis]<min||a[axis]>max)return false;}
   else{const t1=(min-a[axis])/delta,t2=(max-a[axis])/delta;lo=Math.max(lo,Math.min(t1,t2));hi=Math.min(hi,Math.max(t1,t2));}
  }
  return lo<=hi;
 }));
 return {valid,segment,obstacles};
}
// Breadth-first search in half-tile increments, then line-of-sight smoothing.
// Every edge checks the complete prop footprint, including partial endpoints.
function path(start,end,geometry){
 if(!geometry.valid(start)||!geometry.valid(end))return [];
 if(geometry.segment(start,end))return [end];
 const key=p=>`${p.x},${p.y}`,queue=[start],previous=new Map([[key(start),null]]);let target;
 for(let i=0;i<queue.length&&i<12000;i++){
  const p=queue[i];if(distance(p,end)<=.8&&geometry.segment(p,end)){target=p;break;}
  for(const [dx,dy] of [[.5,0],[0,.5],[-.5,0],[0,-.5]]){
   const n={x:Math.round((p.x+dx)*1e6)/1e6,y:Math.round((p.y+dy)*1e6)/1e6},k=key(n);if(previous.has(k)||!geometry.segment(p,n))continue;
   previous.set(k,p);queue.push(n);
  }
 }
 if(!target)return [];
 const points=[end];for(let p=target;p&&key(p)!==key(start);p=previous.get(key(p)))points.unshift(p);
 const smooth=[];let from=start;
 for(let i=0;i<points.length;){let last=i;for(let j=i+1;j<points.length;j++){if(!geometry.segment(from,points[j]))break;last=j;}smooth.push(points[last]);from=points[last];i=last+1;}
 return smooth;
}
const length=(start,points)=>points.reduce((sum,p,i)=>sum+distance(i?points[i-1]:start,p),0);
// Only navigation data participates in the cache key. New messages, artwork,
// device names/status and server snapshots must not reset a moving prop.
export function propNavigationKey(scene,module,devices=[]){
 return JSON.stringify([2,scene.columns,scene.rows,scene.walkable,scene.obstacles,
  (scene.floorPlan?.rooms||[]).map(r=>[r.x,r.y,r.width,r.height,r.doors]),
  scene.modules.filter(o=>o.id!==module.id&&!o.walkThrough&&!['rug','window','lamp'].includes(o.kind)).map(o=>[o.x,o.y,o.width,o.height]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]||a[2]-b[2]||a[3]-b[3]),
  devices.filter(d=>Number.isFinite(d.x)&&Number.isFinite(d.y)).map(d=>[d.x,d.y]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]),
  module.id,module.x,module.y,module.width,module.height,module.behavior]);
}
// Discover reachable space once. Sampling only distant random targets can miss
// every exit from a corner, or end a two-minute patrol after a six-second walk.
function reachablePoints(home,geometry){
 const queue=[home],seen=new Set(['0,0']);
 for(let i=0;i<queue.length&&i<12000;i++){
  const p=queue[i];
  for(const [dx,dy] of [[.5,0],[0,.5],[-.5,0],[0,-.5]]){
   const ix=Math.round((p.x-home.x+dx)*2),iy=Math.round((p.y-home.y+dy)*2),key=`${ix},${iy}`;
   if(seen.has(key))continue;seen.add(key);
   const n={x:home.x+ix/2,y:home.y+iy/2};if(geometry.segment(p,n))queue.push(n);
  }
 }
 return queue.slice(1);
}
// Round corners only when the complete curved footprint is clear. Tight ground
// passages retain their safe polyline; flights can make wider, continuous turns.
function rounded(points,geometry){
 const result=[points[0]];
 for(let i=1;i<points.length-1;i++){
  const a=points[i-1],b=points[i],c=points[i+1],ab=distance(a,b),bc=distance(b,c),trim=Math.min(.65,ab*.25,bc*.25);
  const enter={x:b.x+(a.x-b.x)*trim/ab,y:b.y+(a.y-b.y)*trim/ab},leave={x:b.x+(c.x-b.x)*trim/bc,y:b.y+(c.y-b.y)*trim/bc};
  const curve=[enter];for(let j=1;j<=8;j++){const t=j/8,u=1-t;curve.push({x:u*u*enter.x+2*u*t*b.x+t*t*leave.x,y:u*u*enter.y+2*u*t*b.y+t*t*leave.y});}
  if([result.at(-1),...curve,c].every((p,j,all)=>!j||geometry.segment(all[j-1],p)))result.push(...curve);else result.push(b);
 }
 if(points.length>1)result.push(points.at(-1));return result;
}
export function planPropRoaming(scene,module,devices=[]){
 const movement=module.behavior.movement,home={x:module.x,y:module.y},geometry=roamingGeometry(scene,module,devices);
 const fingerprint=behaviorFingerprint(propNavigationKey(scene,module,devices));
 let points=[home],budget=movement.travelSeconds*movement.speed*.9,used=0,point=home,back=[];
 let seed=parseInt(fingerprint,36)>>>0;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
 const append=route=>{for(const p of route){const d=distance(point,p);if(d<.001)continue;used+=d;points.push(p);point=p;}};
 const tryTarget=candidate=>{
  if(distance(point,candidate)<.5||used+distance(point,candidate)+distance(candidate,home)>budget)return false;
  const outbound=path(point,candidate,geometry);if(!outbound.length)return false;
  const returning=path(candidate,home,geometry);if(!returning.length||used+length(point,outbound)+length(candidate,returning)>budget)return false;
  append(outbound);back=returning;return true;
 };
 if(geometry.valid(home)){
  if(movement.pattern==='route'){
   for(const p of movement.waypoints)tryTarget({x:home.x+p.x,y:home.y+p.y});
  }else{
   const pool=reachablePoints(home,geometry);
   // Prefer sustained exploration, then smaller nearby trips when the remaining
   // battery is low. Reuse reachable space instead of immediately going home.
   for(let leg=0;leg<240&&pool.length;leg++){
    let moved=false;
    for(let attempt=0;attempt<24;attempt++)if(tryTarget(pool[Math.floor(random()*pool.length)])){moved=true;break;}
    if(!moved)break;
   }
  }
 }
 // Smooth outbound and return separately to preserve the exact turnaround and
 // return reserve. Removing corner detours can only shorten the total distance.
 const outbound=rounded(points,geometry),returning=rounded([point,...back],geometry);
 const frames=[{...home,t:0}];used=0;point=home;let direction=1;
 const frameRoute=route=>{for(const p of route.slice(1)){const dx=p.x-point.x,d=distance(point,p);if(d<1e-8)continue;if(Math.abs(dx)>.001)direction=dx<0?-1:1;used+=d;frames.push({...p,t:used/movement.speed*1000,direction});point=p;}};
 frameRoute(outbound);const returnAt=frames.at(-1).t;frameRoute(returning);
 const duration=frames.at(-1).t,chargeMs=movement.chargeSeconds*1000,period=duration+chargeMs;
 return {fingerprint,home,frames,returnAt,duration,period,obstacles:geometry.obstacles,travelMs:movement.travelSeconds*1000,chargeMs,blockedReason:!geometry.valid(home)?'home-blocked':!duration?'no-route':null};
}
export function samplePropRoaming(plan,time){
 const cycle=Math.floor(time/plan.period),elapsed=((time%plan.period)+plan.period)%plan.period;
 let point=plan.home,direction=plan.frames.at(-1).direction||1;
 if(elapsed<plan.duration){let lo=1,hi=plan.frames.length-1;while(lo<hi){const mid=(lo+hi)>>1;if(plan.frames[mid].t<elapsed)lo=mid+1;else hi=mid;}const b=plan.frames[lo],a=plan.frames[lo-1],r=(elapsed-a.t)/(b.t-a.t||1);point={x:a.x+(b.x-a.x)*r,y:a.y+(b.y-a.y)*r};direction=b.direction||1;}
 const state=!plan.duration?'docked':elapsed<plan.returnAt?'roaming':elapsed<plan.duration?'returning':'charging';
 const battery=elapsed<plan.duration?1-elapsed/plan.travelMs:1-plan.duration/plan.travelMs*(1-Math.min(1,(elapsed-plan.duration)/plan.chargeMs));
 return {...point,cycle,elapsed,state,battery,direction};
}
// Rendering uses a monotonic clock. Snapshot/RTT jitter adjusts playback speed
// gently instead of jumping backwards; resuming a hidden tab catches up once.
export function createPropClock(serverTime,monotonicTime){
 let time=serverTime,last=monotonicTime,target=serverTime,targetAt=monotonicTime;
 return {
  sync(value,at){target=value;targetAt=at;},
  sample(at){const dt=Math.max(0,at-last);last=at;const desired=target+at-targetAt;
   if(dt>1000)time=desired;else{time+=dt;const error=desired-time;if(Math.abs(error)>40)time+=Math.max(-dt*.1,Math.min(dt*.1,error));}
   return time;
  }
 };
}
export function propTrailItems(plan,module,time){
 const trail=module.behavior?.trail;if(!trail||!plan.duration)return [];
 const items=[],interval=trail.everySeconds*1000,lifetime=trail.lifetimeSeconds*1000;
 for(let cycle=Math.floor((time-lifetime)/plan.period);cycle<=Math.floor(time/plan.period);cycle++){
  for(let index=1;index*interval<plan.returnAt;index++){
   const born=cycle*plan.period+index*interval;if(born>time||born+lifetime<=time)continue;
   const point=samplePropRoaming(plan,born);
   const landing={x:point.x+module.width/2,y:point.y+module.height*.8};
   if(plan.obstacles.some(o=>landing.x>=o.x&&landing.x<=o.x+o.width&&landing.y>=o.y&&landing.y<=o.y+o.height))continue;
   items.push({id:`${plan.fingerprint}:${cycle}:${index}`,moduleId:module.id,x:point.x+module.width/2,y:point.y+module.height*.8,born,expiresAt:born+lifetime});
  }
 }
 return items.slice(-trail.maxItems);
}
// Shared by the layout inspector and generation tooling. These are placement
// diagnostics, not schema errors: users may still save a temporarily blocked dock.
export function inspectPropRoaming(plan,module){
 const issues=plan.blockedReason?[plan.blockedReason]:[],trail=module.behavior.trail;
 const drops=new Map();
 if(trail)for(let t=trail.everySeconds*1000;t<plan.returnAt;t+=trail.everySeconds*1000){
  for(const item of propTrailItems(plan,module,t))if(item.born>=0&&item.born<plan.period)drops.set(item.id,item);
 }
 if(trail&&!plan.blockedReason&&!drops.size)issues.push('no-drop');
 return {issues,outboundSeconds:plan.returnAt/1000,returnSeconds:(plan.duration-plan.returnAt)/1000,
  restSeconds:plan.chargeMs/1000,cycleSeconds:plan.period/1000,dropsPerCycle:drops.size,
  firstDropSeconds:drops.size?Math.min(...[...drops.values()].map(i=>i.born))/1000:null};
}
export function touchesTrailItem(scene,item,actor,radius,obstacles=[]){
 if(!actor)return false;
 const point={x:actor.x/100*scene.columns,y:actor.y/100*scene.rows},d=distance(item,point);
 if(d>radius)return false;
 // A nearby pickup on the other side of a thin partition is not reachable.
 for(const o of obstacles){
  let lo=0,hi=1;
  for(const axis of ['x','y']){
   const delta=item[axis]-point[axis],min=o[axis],max=min+o[axis==='x'?'width':'height'];
   if(Math.abs(delta)<1e-9){if(point[axis]<min||point[axis]>max){lo=1;hi=0;break;}}
   else {const a=(min-point[axis])/delta,b=(max-point[axis])/delta;lo=Math.max(lo,Math.min(a,b));hi=Math.min(hi,Math.max(a,b));}
  }
  if(lo<=hi)return false;
 }
 return true;
}
