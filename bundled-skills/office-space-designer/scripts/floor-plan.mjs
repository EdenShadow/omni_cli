import {furnitureObstacles} from './scene-geometry.mjs';
const sides=['top','bottom','left','right'];
const materials=['glass','wood','solid'];
const rectOverlap=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
export const toPercent=(s,p)=>({x:p.x/s.columns*100,y:p.y/s.rows*100});
export function roomDoorPoint(room,door,offset=0){
  const at=door.offset+door.width/2;
  return door.side==='left'?{x:room.x-offset,y:room.y+at}:door.side==='right'?{x:room.x+room.width+offset,y:room.y+at}:door.side==='top'?{x:room.x+at,y:room.y-offset}:{x:room.x+at,y:room.y+room.height+offset};
}
export function roomWallSegments(room){
  return sides.flatMap(side=>{
    const horizontal=side==='top'||side==='bottom',length=horizontal?room.width:room.height;
    const doors=room.doors.filter(d=>d.side===side).sort((a,b)=>a.offset-b.offset),spans=[];let start=0;
    for(const door of doors){if(door.offset>start)spans.push([start,door.offset]);start=door.offset+door.width;}
    if(start<length)spans.push([start,length]);
    return spans.map(([a,b],i)=>({id:`${room.id}-${side}-${i}`,side,material:room.material,
      x:room.x+(horizontal?a:side==='right'?room.width:0),y:room.y+(horizontal?(side==='bottom'?room.height:0):a),
      width:horizontal?b-a:.3,height:horizontal?.3:b-a}));
  });
}
export function floorPlanObstacles(s){
  return (s.floorPlan?.rooms||[]).flatMap(room=>roomWallSegments(room).map(r=>({x:(r.x-.15)/s.columns*100,y:(r.y-.15)/s.rows*100,width:r.width/s.columns*100,height:r.height/s.rows*100})));
}
export function validateFloorPlan(s){
  const f=s.floorPlan;if(f===undefined)return;
  if(!f||f.version!==1||!Number.isInteger(f.capacity)||f.capacity<1||f.capacity>100||!['wide','deep','balanced'].includes(f.shape)||!Number.isFinite(f.wallHeight)||f.wallHeight<.5||f.wallHeight>3)throw Error('户型需要 version:1、1–100 个预留工位、wide/deep/balanced 和 0.5–3 格墙高');
  if(!Array.isArray(f.rooms)||f.rooms.length>12||f.wallRows!==9)throw Error('户型最多 12 个房间，顶部看板墙占 9 行');
  const floor={x:s.walkable.x/100*s.columns,y:s.walkable.y/100*s.rows,width:s.walkable.width/100*s.columns,height:s.walkable.height/100*s.rows};
  const inside=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=floor.x&&p.y>=floor.y&&p.x<=floor.x+floor.width&&p.y<=floor.y+floor.height;
  if(!inside(f.entry))throw Error('项目入口必须位于公共通道的可行走地面内');
  const ids=new Set();
  for(const room of f.rooms){
    if(!room||typeof room.id!=='string'||!room.id||ids.has(room.id)||typeof room.name!=='string'||!room.name.trim()||room.name.length>40||!['meeting','office','lounge'].includes(room.kind)||!materials.includes(room.material))throw Error('房间需要独立 ID、名称、用途与 glass/wood/solid 墙体');ids.add(room.id);
    // Walls may meet the scene perimeter. Walking still uses the inset floor;
    // circulation validation separately checks both sides of every doorway.
    if(!['x','y','width','height'].every(k=>Number.isFinite(room[k]))||room.width<9||room.height<9||room.x<0||room.y<f.wallRows||room.x+room.width>s.columns||room.y+room.height>s.rows)throw Error(`${room.name} 太小或超出地面，请留出至少 9×9 格，墙体可贴场景边缘`);
    if(f.rooms.some(other=>other!==room&&rectOverlap(room,other)))throw Error('房间不能重叠，请为公共走廊留空');
    if(!Array.isArray(room.doors)||!room.doors.length||room.doors.length>4)throw Error(`${room.name} 必须留门，不能封死`);
    for(const door of room.doors){
      const length=['top','bottom'].includes(door.side)?room.width:room.height;
      if(!sides.includes(door.side)||!materials.includes(door.material)||!Number.isFinite(door.offset)||!Number.isFinite(door.width)||door.width<4||door.offset<1||door.offset+door.width>length-1)throw Error(`${room.name} 的门洞至少宽 4 格，门边距离墙角至少 1 格`);
      if(room.doors.some(d=>d!==door&&d.side===door.side&&door.offset<d.offset+d.width&&door.offset+door.width>d.offset))throw Error(`${room.name} 的门洞不能重叠`);
    }
  }
  if(s.deviceZones.length<f.capacity)throw Error(`需要为 ${f.capacity} 人预留足够工位，目前只有 ${s.deviceZones.length} 个`);
}
export function workstationRect(s,p){return {x:p.x/100*s.columns-3.4,y:p.y/100*s.rows-3.3,width:6.8,height:5.5};}
export function validateOfficeCirculation(s,devices){
  if(!s.floorPlan)return true;validateFloorPlan(s);
  const walls=floorPlanObstacles(s),obstacles=[...furnitureObstacles(s),...walls];
  const floor=s.walkable,entry=toPercent(s,s.floorPlan.entry);
  const blocked=(x,y)=>x<floor.x||y<floor.y||x>floor.x+floor.width||y>floor.y+floor.height||obstacles.some(o=>x>o.x-1&&x<o.x+o.width+1&&y>o.y-1&&y<o.y+o.height+1);
  if(blocked(entry.x,entry.y))throw Error('项目入口被挡住了，请保留公共通道');
  // Flood the same normalized one-percent grid used by character navigation.
  const open=new Uint8Array(10201),seen=new Uint8Array(10201),key=(x,y)=>y*101+x;
  for(let y=0;y<=100;y++)for(let x=0;x<=100;x++)if(!blocked(x,y))open[key(x,y)]=1;
  const line=(a,b)=>{const n=Math.max(1,Math.ceil(Math.hypot(a.x-b.x,a.y-b.y)*3));for(let i=0;i<=n;i++)if(blocked(a.x+(b.x-a.x)*i/n,a.y+(b.y-a.y)*i/n))return false;return true;};
  const q=[];
  for(let y=Math.floor(entry.y)-1;y<=Math.ceil(entry.y)+1;y++)for(let x=Math.floor(entry.x)-1;x<=Math.ceil(entry.x)+1;x++)if(x>=0&&y>=0&&x<=100&&y<=100&&open[key(x,y)]&&line(entry,{x,y})){q.push({x,y});seen[key(x,y)]=1;}
  for(let i=0;i<q.length;i++)for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){const x=q[i].x+dx,y=q[i].y+dy,k=key(x,y);if(x<0||y<0||x>100||y>100||!open[k]||seen[k])continue;seen[k]=1;q.push({x,y});}
  const reachable=p=>{if(blocked(p.x,p.y))return false;for(let y=Math.floor(p.y)-1;y<=Math.ceil(p.y)+1;y++)for(let x=Math.floor(p.x)-1;x<=Math.ceil(p.x)+1;x++)if(x>=0&&y>=0&&x<=100&&y<=100&&seen[key(x,y)]&&line(p,{x,y}))return true;return false;};
  const doorClearances=[];
  for(const room of s.floorPlan.rooms)for(const door of room.doors){
    for(const offset of [-2,0,2])if(!reachable(toPercent(s,roomDoorPoint(room,door,offset))))throw Error(`${room.name} 的门或走廊无法到达，请移开家具或调整门洞`);
    const p=roomDoorPoint(room,door);doorClearances.push({x:p.x-2.3,y:p.y-2.3,width:4.6,height:4.6});
  }
  const zones=devices||s.deviceZones,rects=[];
  const solid=[...s.modules.filter(m=>!m.walkThrough&&!['rug','window','lamp'].includes(m.kind)),...walls.map(r=>({x:r.x/100*s.columns,y:r.y/100*s.rows,width:r.width/100*s.columns,height:r.height/100*s.rows})),...doorClearances];
  for(const p of zones){
    const r=workstationRect(s,p),f={x:floor.x/100*s.columns,y:floor.y/100*s.rows,width:floor.width/100*s.columns,height:floor.height/100*s.rows};
    if(r.x<f.x||r.y<f.y||r.x+r.width>f.x+f.width||r.y+r.height>f.y+f.height||solid.some(o=>rectOverlap(r,o))||rects.some(o=>rectOverlap(r,o)))throw Error('工位不能挤在一起、穿墙或挡住门，请增加面积或调整位置');
    rects.push(r);
    if(!reachable({x:p.x,y:p.y+3.2/s.rows*100}))throw Error('有工位无法从入口走到，请留出通道');
  }
  return true;
}
const rect=(x,y,w,h,fill)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
export function floorPlanLayers(s){
  if(!s.floorPlan)return [];
  const layers=[];
  for(const room of s.floorPlan.rooms){
    layers.push({id:`room-floor-${room.id}`,x:room.x/s.columns*100,y:room.y/s.rows*100,width:room.width/s.columns*100,height:room.height/s.rows*100,depth:0,svg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${room.width*40} ${room.height*40}">${rect(0,0,room.width*40,room.height*40,room.material==='wood'?'#d9bd9255':'#c4ddd74a')}</svg>`});
    for(const w of roomWallSegments(room)){
      const horizontal=['top','bottom'].includes(w.side),rise=s.floorPlan.wallHeight*40;
      const width=horizontal?w.width*40:22,height=horizontal?rise+12:w.height*40+rise;
      const color=w.material==='wood'?'#b38862':w.material==='glass'?'#a6c7c9aa':'#c4c6b5',edge=w.material==='wood'?'#79644e':'#7d9697';
      let art=rect(5,rise+3,width-5,height-rise-3,'#4f514529')+rect(0,0,width-4,height-8,color)+rect(0,0,width-4,5,'#f2eee3')+rect(width-8,5,4,height-13,edge)+rect(0,height-12,width-4,6,edge);
      if(horizontal){for(let x=0;x<width-8;x+=w.material==='wood'?24:100)art+=rect(x,5,w.material==='wood'?2:4,height-17,edge);if(w.material==='glass')for(let x=18;x<width-24;x+=100)art+=`<path d="M${x},${height-22}l24,-24m-14,25l24,-24" stroke="#f5ffffaa" stroke-width="3"/>`;}
      else art+=rect(4,10,3,height-26,'#ffffff66');
      layers.push({id:w.id,x:(w.x-(horizontal?0:.25))/s.columns*100,y:(w.y-rise/40)/s.rows*100,width:width/40/s.columns*100,height:height/40/s.rows*100,depth:Math.round((w.y+(horizontal?0:w.height))/s.rows*1000),svg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${art}</svg>`});
    }
    for(const [i,d]of room.doors.entries()){
      const p=roomDoorPoint(room,d),horizontal=['top','bottom'].includes(d.side),w=horizontal?d.width:2,h=horizontal?2:d.width;
      const art=`<path d="M8,${h*40-8} Q${w*40-8},${h*40-8} ${w*40-8},8" fill="none" stroke="#899d9777" stroke-dasharray="6 6" stroke-width="2"/>`+rect(3,3,horizontal?8:w*40-6,horizontal?h*40-6:8,d.material==='wood'?'#b18866':'#a8cfd5aa')+rect(3,3,6,6,'#778f87');
      layers.push({id:`door-${room.id}-${i}`,x:(p.x-w/2)/s.columns*100,y:(p.y-h/2)/s.rows*100,width:w/s.columns*100,height:h/s.rows*100,depth:1,svg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w*40} ${h*40}">${art}</svg>`});
    }
  }
  return layers;
}
