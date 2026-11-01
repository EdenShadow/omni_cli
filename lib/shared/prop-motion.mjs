import {sceneObstacles} from './project-scene.mjs';

// All gameplay distances use tiles, independent of screen size and map zoom.
export const KICK_REACH=.6;
const tile=(scene,p)=>({x:p.x*scene.columns/100,y:p.y*scene.rows/100});
const gap=(m,p)=>Math.hypot(Math.max(m.x-p.x,0,p.x-m.x-m.width),Math.max(m.y-p.y,0,p.y-m.y-m.height));
export function canKickProp(scene,module,actor){
  return !!actor&&actor.state!=='sitting'&&Number.isFinite(actor.x)&&Number.isFinite(actor.y)&&gap(module,tile(scene,actor))<=KICK_REACH;
}
// Sweep the feet between frames so low FPS cannot skip a small ball.
export function propContact(scene,module,from,to){
  const a=tile(scene,from),b=tile(scene,to),dx=b.x-a.x,dy=b.y-a.y;
  if(dx*(module.x+module.width/2-a.x)+dy*(module.y+module.height/2-a.y)<=0)return;
  const steps=Math.max(1,Math.ceil(Math.hypot(dx,dy)/.12));
  for(let i=0;i<=steps;i++){
    const p={x:a.x+dx*i/steps,y:a.y+dy*i/steps};
    if(gap(module,p)<=KICK_REACH)return {x:p.x/scene.columns*100,y:p.y/scene.rows*100};
  }
}
export function samplePropMotion(motion,elapsed){
  const frames=motion.frames;
  if(elapsed<=0)return frames[0];
  if(elapsed>=motion.duration)return frames.at(-1);
  let lo=0,hi=frames.length-1;
  while(hi-lo>1){const mid=(lo+hi)>>1;if(frames[mid].t<=elapsed)lo=mid;else hi=mid;}
  const a=frames[lo],b=frames[hi],f=(elapsed-a.t)/(b.t-a.t||1);
  return {t:elapsed,x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f,angle:a.angle+(b.angle-a.angle)*f};
}
export function sceneAtPropTime(scene,motions,time){
  const active=new Map(motions.filter(m=>m.startedAt+m.duration>time).map(m=>[m.moduleId,m]));
  return {...scene,modules:scene.modules.map(m=>{const motion=active.get(m.id);if(!motion)return m;const p=samplePropMotion(motion,time-motion.startedAt);return {...m,x:p.x,y:p.y};})};
}
export function planPropKick(scene,module,actor,devices=[]){
  if(!module.physics)throw Error('这个道具还没有可踢属性');
  if(!canKickProp(scene,module,actor))throw Error('请先走到道具附近');
  const a=tile(scene,actor),cx=module.x+module.width/2,cy=module.y+module.height/2;
  let dx=cx-a.x,dy=cy-a.y,length=Math.hypot(dx,dy);
  if(length<.001){dx=actor.state==='walk-left'?-1:1;dy=0;length=1;}
  const duration=module.physics.duration,speed=2*module.physics.distance/(duration/1000),deceleration=speed/(duration/1000);
  let vx=dx/length*speed,vy=dy/length*speed,x=module.x,y=module.y,angle=0;
  const obstacles=sceneObstacles({...scene,modules:scene.modules.filter(m=>m.id!==module.id)}).map(r=>({x:r.x*scene.columns/100,y:r.y*scene.rows/100,width:r.width*scene.columns/100,height:r.height*scene.rows/100}));
  for(const d of devices)obstacles.push({x:d.x*scene.columns/100-2.55,y:d.y*scene.rows/100-1.2,width:5.1,height:2.8});
  const edge={x:Math.max(module.x,Math.min(module.x+module.width,a.x)),y:Math.max(module.y,Math.min(module.y+module.height,a.y))};
  for(let f=.1;f<1;f+=.1){
    const p={x:a.x+(edge.x-a.x)*f,y:a.y+(edge.y-a.y)*f};
    if(obstacles.some(o=>p.x>o.x&&p.x<o.x+o.width&&p.y>o.y&&p.y<o.y+o.height))throw Error('请先走到道具附近，不能隔着障碍踢动');
  }
  const floor={x:scene.walkable.x*scene.columns/100,y:scene.walkable.y*scene.rows/100,right:(scene.walkable.x+scene.walkable.width)*scene.columns/100,bottom:(scene.walkable.y+scene.walkable.height)*scene.rows/100};
  const overlaps=(px,py,o)=>px<o.x+o.width-1e-7&&px+module.width>o.x+1e-7&&py<o.y+o.height-1e-7&&py+module.height>o.y+1e-7;
  // An edited layout may start overlapped. Let the prop escape those objects,
  // making them solid again immediately after separation.
  const covering=new Set(obstacles.filter(o=>overlaps(x,y,o)));
  const blocked=(px,py)=>px<floor.x||py<floor.y||px+module.width>floor.right||py+module.height>floor.bottom||obstacles.some(o=>!covering.has(o)&&overlaps(px,py,o));
  const frames=[{t:0,x,y,angle}];
  let collisions=0;
  for(let time=0;time<duration;){
    const end=Math.min(duration,time+1000/60),delta=(end-time)/1000;
    const steps=Math.max(1,Math.ceil(Math.hypot(vx,vy)*delta/.06)),dt=delta/steps;
    for(let i=0;i<steps;i++){
      const oldX=x,oldY=y,v=Math.hypot(vx,vy),nextV=Math.max(0,v-deceleration*dt),ratio=v?nextV/v:0;
      const moveX=vx*dt*(1+ratio)/2,moveY=vy*dt*(1+ratio)/2;
      if(blocked(x+moveX,y)){vx=-vx*.65;collisions++;}else x+=moveX;
      if(blocked(x,y+moveY)){vy=-vy*.65;collisions++;}else y+=moveY;
      vx*=ratio;vy*=ratio;
      angle+=Math.hypot(x-oldX,y-oldY)*180/(Math.PI*Math.max(.3,module.width/2))*(vx<0?-1:1);
      for(const o of covering)if(!overlaps(x,y,o))covering.delete(o);
    }
    time=end;frames.push({t:time,x,y,angle});
    if(Math.hypot(vx,vy)<.01)break;
  }
  return {duration:frames.at(-1).t,frames,collisions};
}
