import {roomDoorPoint,workstationRect,floorPlanObstacles} from './floor-plan.mjs';
import {commonOfficeRegions} from './office-reflow.mjs';

const overlaps=(a,b,gap=0)=>a.x<b.x+b.width+gap&&a.x+a.width+gap>b.x&&a.y<b.y+b.height+gap&&a.y+a.height+gap>b.y;
const contains=(a,b)=>b.x>=a.x&&b.y>=a.y&&b.x+b.width<=a.x+a.width&&b.y+b.height<=a.y+a.height;
const bounds=items=>{const x=Math.min(...items.map(m=>m.x)),y=Math.min(...items.map(m=>m.y));return {x,y,width:Math.max(...items.map(m=>m.x+m.width))-x,height:Math.max(...items.map(m=>m.y+m.height))-y};};
const seating=m=>m.kind==='sofa'||m.seats?.length>0;
const publicProp=m=>m.trigger||m.physics||m.kind==='arcade'||/泳池|喷泉|pool|fountain/i.test(m.name||'');
const displayProp=m=>m.kind==='custom'&&!m.seats?.length&&!m.physics&&/展示|陈列|展台|display|exhibit/i.test(m.name||'');

// Preserve furniture ensembles instead of unrolling a rug, sofa and coffee
// table into separate objects along the last row of the new map.
export function officeFurnitureGroups(base){
 const modules=structuredClone(base.modules),claimed=new Set(),groups=[];
 for(const m of modules)if(m.kind==='sofa'&&m.seats===undefined){
  const attached=(base.seats||[]).filter(s=>s.x>=m.x/base.columns*100&&s.x<=(m.x+m.width)/base.columns*100&&s.y>=m.y/base.rows*100&&s.y<=(m.y+m.height)/base.rows*100+8);
  m.seats=attached.length?attached.map(s=>({x:Math.max(5,Math.min(95,(s.x/100*base.columns-m.x)/m.width*100)),y:68})):[{x:50,y:68}];
 }
 const add=items=>{items.forEach(m=>claimed.add(m.id));const b=bounds(items);groups.push({...b,items:items.map(m=>({...m,x:m.x-b.x,y:m.y-b.y})),lounge:items.some(m=>m.kind==='rug')&&items.some(seating),display:items.some(displayProp)});};
 // Authored functional groups survive future replans, including bespoke props.
 for(const group of new Set(modules.map(m=>m.layoutGroup).filter(Boolean))){
  const members=modules.filter(m=>m.layoutGroup===group),rugs=members.filter(m=>m.kind==='rug');
  // A newly placed sign or exhibit sitting on an existing group rug belongs
  // with that display even before its author adds a layoutGroup explicitly.
  add([...members,...modules.filter(m=>!m.layoutGroup&&!claimed.has(m.id)&&rugs.some(r=>contains(r,m)))]);
 }
 for(const rug of modules.filter(m=>m.kind==='rug').sort((a,b)=>b.width*b.height-a.width*a.height)){
  if(claimed.has(rug.id))continue;
  const items=modules.filter(m=>!claimed.has(m.id)&&m.kind!=='wall'&&contains(rug,m));
  // Keep only actual ensembles. Overlapping rugs must not duplicate members.
  add(items);
 }
 for(const sofa of modules.filter(m=>seating(m)&&!claimed.has(m.id))){
  const table=modules.filter(m=>m.kind==='table'&&!claimed.has(m.id)&&((m.y>=sofa.y+sofa.height&&m.y<=sofa.y+sofa.height+3&&Math.abs(m.x+m.width/2-sofa.x-sofa.width/2)<3)||(Math.abs(m.y-sofa.y)<2&&Math.abs(m.x-sofa.x-sofa.width)<3))).sort((a,b)=>a.y-b.y)[0];
  add(table?[sofa,table]:[sofa]);
 }
 // A collection is an exhibit, not isolated pedestals spread over the map.
 const displays=modules.filter(m=>!claimed.has(m.id)&&displayProp(m));
 if(displays.length>1){
  const columns=Math.min(3,Math.ceil(Math.sqrt(displays.length))),w=Math.max(...displays.map(m=>m.width))+1.5,h=Math.max(...displays.map(m=>m.height))+2;
  add(displays.map((m,i)=>({...m,x:i%columns*w,y:Math.floor(i/columns)*h})));
 }
 for(const m of modules)if(!claimed.has(m.id))add([m]);
 return groups.sort((a,b)=>Number(b.lounge)-Number(a.lounge)||b.width*b.height-a.width*a.height);
}

// Furnish rooms and common areas first, then reserve the desks in the remaining
// area. This is a generation helper; manual layout edits never call it.
export function furnishOfficeScene(scene,base,deskCandidates,{compact=false,fillWidth=false}={}){
 const rooms=scene.floorPlan.rooms,floor={x:1,y:10,width:scene.columns-2,height:scene.rows-11};
 const publicRight=rooms.length?Math.min(...rooms.map(r=>r.x))-3:scene.columns-5;
 const common={id:'common',kind:'common',x:2,y:11,width:publicRight-2,height:scene.rows-13};
 const roomRegions=rooms.map(r=>({id:r.id,kind:r.kind,x:r.x+1.5,y:r.y+1.5,width:r.width-3,height:r.height-3}));
 const regions=[...(fillWidth?commonOfficeRegions(scene):[common]),...roomRegions];
 const clear=rooms.flatMap(r=>r.doors.map(d=>{const p=roomDoorPoint(r,d);return {x:p.x-2.6,y:p.y-2.6,width:5.2,height:5.2};}));
 const deskRects=deskCandidates.map(p=>({...workstationRect(scene,p),height:7.2}));
 const reserved=[],fixed=[];
 for(const room of rooms){
  const old=base.floorPlan?.rooms.find(r=>r.id===room.id&&r.workstations&&r.workstations===room.workstations&&r.width===room.width&&r.height===room.height);
  const oldDesks=old?base.deviceZones.filter(p=>contains(old,workstationRect(base,p))):[];
  // A furnished workroom is already a coherent unit. Tightening public space
  // should translate its contents, not spill them into the common gallery.
  if(old&&oldDesks.length>=room.workstations){
   const dx=room.x-old.x,dy=room.y-old.y;
   reserved.push(...oldDesks.slice(0,room.workstations).map(p=>({x:(p.x/100*base.columns+dx)/scene.columns*100,y:(p.y/100*base.rows+dy)/scene.rows*100})));
   fixed.push(...base.modules.filter(m=>contains(old,m)).map(m=>({...structuredClone(m),x:m.x+dx,y:m.y+dy})));
   continue;
  }
  let count=0;
  for(let y=room.y+5;y+3.9<=room.y+room.height-.5&&count<(room.workstations||0);y+=8)for(let x=room.x+6.2;x+3.4<=room.x+room.width-.5&&count<room.workstations;x+=8){
   const p={x:x/scene.columns*100,y:y/scene.rows*100},rect={...workstationRect(scene,p),height:7.2};
   if(!clear.some(o=>overlaps(rect,o))){reserved.push(p);count++;}
  }
  if(count<(room.workstations||0))throw Error(`${room.name} 需要扩大以容纳 ${room.workstations} 个工位及通道`);
 }
 const reservedRects=reserved.map(p=>({...workstationRect(scene,p),height:7.2}));
 const used=fixed.map(m=>({...m})),loads=new Map(),placed=[...fixed];
 // Generated walls are replaced by real partitions; all furniture survives.
 const groups=officeFurnitureGroups({...base,modules:base.modules.filter(m=>!fixed.some(n=>n.id===m.id))}).filter(g=>!(rooms.length&&g.items.every(m=>m.kind==='wall')));
 if(fillWidth)groups.sort((a,b)=>Number(b.items.every(m=>m.kind==='window'))-Number(a.items.every(m=>m.kind==='window'))||Number(b.display)-Number(a.display)||b.width*b.height-a.width*a.height);
 // Seat approach distance is normalized by the host. Keep enough floor in
 // front on long maps too, including between a sofa and its coffee table.
 const seatGap=Math.max(2.2,scene.rows*.027);
 for(const group of groups){
  for(const seat of group.items.filter(seating))for(const item of group.items){
   if(item.kind==='rug'||seating(item)||item.y<seat.y+seat.height||item.x>=seat.x+seat.width||item.x+item.width<=seat.x)continue;
   item.y=Math.max(item.y,seat.y+seat.height+seatGap);
  }
  for(const rug of group.items.filter(m=>m.kind==='rug'&&!m.svg&&!m.assetId))rug.height=Math.max(rug.height,Math.ceil(Math.max(...group.items.map(m=>m.y+m.height))-rug.y));
  group.height=Math.max(...group.items.map(m=>m.y+m.height));
 }
 const commons=groups.filter(g=>g.lounge||g.display||g.items.some(publicProp)||g.width>Math.max(0,...roomRegions.map(r=>r.width))||g.height>Math.max(0,...roomRegions.map(r=>r.height)));
 function locate(group,index,preferredRoom){
  const isSeat=group.items.some(seating),isTable=group.items.some(m=>m.kind==='table'),isPlant=group.items.every(m=>['plant','lamp'].includes(m.kind));
  const publicOnly=group.lounge||group.display||group.items.some(publicProp),ci=commons.indexOf(group),isWindow=group.items.every(m=>m.kind==='window');
  const footprintHeight=Math.max(group.height,...group.items.filter(seating).map(m=>m.y+m.height+seatGap));
  const ratio=ci>=0?.08+.65*ci/Math.max(1,commons.length-1):.12+.6*index/Math.max(1,groups.length-1);
  const candidates=[];
  for(const region of regions){
   if(publicOnly&&region.kind!=='common'||preferredRoom&&region.id!==preferredRoom)continue;
   for(let y=Math.ceil(region.y);y+footprintHeight<=region.y+region.height;y++)for(let x=Math.ceil(region.x);x+group.width<=region.x+region.width;x++){
    const rect={x,y,width:group.width,height:footprintHeight};
    if(clear.some(o=>overlaps(rect,o))||reservedRects.some(o=>overlaps(rect,o,.6))||used.some(o=>overlaps(rect,o,1)))continue;
    const inRoom=region.kind!=='common';
    const affinity=inRoom?(isSeat?(region.kind==='office'||region.kind==='lounge'?0:10):isTable?(region.kind==='meeting'?0:10):0):18;
    const targetY=common.y+(common.height-group.height)*ratio;
    const edge=Math.min(x-region.x,region.x+region.width-x-group.width);
    const anchorDistance=isPlant&&used.length?Math.min(...used.map(o=>Math.hypot(x+group.width/2-o.x-o.width/2,y+group.height/2-o.y-o.height/2))):0;
    const position=fillWidth&&!inRoom?(y-11)*3+(isWindow?edge*.2:Math.abs(x+group.width/2-(region.x+region.width/2))*.25)+(isPlant?anchorDistance:0):isWindow?(y-region.y)*4+edge*.2:inRoom?(isPlant?edge*2+anchorDistance:Math.abs(x+group.width/2-(region.x+region.width*.65))*.5)+(y-region.y)*.35:(compact?(y-common.y)*1.4:Math.abs(y-targetY)*1.4)+Math.abs(x+group.width/2-(common.x+common.width*.45))*.5+(isPlant?anchorDistance*2:0);
    const desks=inRoom?0:deskRects.filter(d=>overlaps(rect,d,1)).length;
    const score=affinity+position+desks*2+(loads.get(region.id)||0)*(inRoom?8:0);
    candidates.push({rect,region,score});
   }
  }
  const best=candidates.sort((a,b)=>a.score-b.score)[0];
  if(!best)throw Error(`需要为已有道具“${group.items[0].name||group.items[0].id}”留出更多空间`);
  used.push(best.rect);loads.set(best.region.id,(loads.get(best.region.id)||0)+1);
  placed.push(...group.items.map(m=>({...m,x:best.rect.x+m.x,y:best.rect.y+m.y})));
 }
 // Reserve each room's functional furniture before filling its corners with
 // storage and plants. Reuse an existing seating/table group where it fits.
 const assigned=new Set();
 for(const room of rooms){
  if(room.workstations)continue; // Working rooms reserve desks before decorative seating.
  const kind=room.kind==='meeting'?'table':'sofa',id=`${room.id}-${kind}`;
  const existing=groups.filter(g=>!assigned.has(g)&&!g.lounge&&!g.items.some(publicProp)&&g.width<=room.width-6&&Math.max(g.height,...g.items.filter(seating).map(m=>m.y+m.height+seatGap))<=room.height-3.5&&g.items.some(m=>kind==='table'?m.kind==='table':seating(m))).sort((a,b)=>Number(b.items.some(m=>m.id===id))-Number(a.items.some(m=>m.id===id)))[0];
  if(existing){locate(existing,groups.indexOf(existing),room.id);assigned.add(existing);continue;}
  const m={id,kind,name:room.name+(kind==='table'?' · 会议桌':' · 会客沙发'),x:0,y:0,width:5,height:3,...(kind==='sofa'?{seats:[{x:30,y:68},{x:70,y:68}]}:{}),color:kind==='table'?'#9bada2':'#a399b2'};
  if(groups.some(g=>g.items.some(item=>item.id===id)))m.id=id+'-new';
  locate({width:m.width,height:m.height,items:[m]},groups.length,room.id);
 }
 groups.forEach((g,i)=>{if(!assigned.has(g))locate(g,i);});
 scene.modules=placed;
 const walls=floorPlanObstacles(scene).map(r=>({x:r.x/100*scene.columns,y:r.y/100*scene.rows,width:r.width/100*scene.columns,height:r.height/100*scene.rows}));
 // Full visual bounds plus a clear approach are kept free by generation.
 scene.deviceZones=[...reserved,...deskCandidates.filter(p=>{
  const rect={...workstationRect(scene,p),height:7.2};
  return contains(floor,rect)&&!reservedRects.some(o=>overlaps(rect,o,.6))&&!used.some(o=>overlaps(rect,o,.6))&&!clear.some(o=>overlaps(rect,o))&&!walls.some(o=>overlaps(rect,o));
 }).slice(0,scene.floorPlan.capacity-reserved.length)];
 if(scene.deviceZones.length<scene.floorPlan.capacity)throw Error('已有家具需要更多空间，同时为全部成员保留工位');
 scene.seats=[];
 // Legacy interactive points follow their relative floor position; never stack
 // every trigger at the new bottom edge.
 const migrate=p=>({...p,y:(10+Math.max(0,Math.min(1,(p.y-base.walkable.y)/base.walkable.height))*(scene.rows-11))/scene.rows*100});
 scene.props=(base.props||[]).map(p=>({...migrate(p),...(p.destination?{destination:migrate(p.destination)}:{})}));
 return scene;
}

export function assertOfficeInventory(scene,base){
 const stable=v=>JSON.stringify(v,(_,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(k=>[k,value[k]])):value);
 for(const old of base.modules.filter(m=>m.kind==='custom'||m.svg!==undefined)){
  const next=scene.modules.find(m=>m.id===old.id);
  if(!next)throw Error(`请在新办公室中布置已有道具“${old.name||old.id}”，不要删除或只放回背包`);
  for(const key of ['kind','width','height','svg','name','assetId','seats','physics','trigger','animations','behavior','walkThrough','canvasId']){
   // Original built-in furniture art can be redesigned in place. Separately
   // owned prop assets remain protected by their original artwork contract.
   if(key==='svg'&&old.kind!=='custom'&&!old.assetId&&next.svg!==undefined)continue;
   if(stable(next[key])!==stable(old[key]))throw Error(`已有道具“${old.name||old.id}”的 ${key} 必须保留；请只调整摆放位置`);
  }
 }
}
