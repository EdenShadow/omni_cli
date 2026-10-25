import {furnishOfficeScene} from './office-furnishing.mjs';
import {floorPlanObstacles,roomDoorPoint,toPercent,validateOfficeCirculation,workstationRect} from './floor-plan.mjs';
const number=value=>{if(/^\d+$/.test(value))return Number(value);const d={零:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};if(value.includes('十')){const [a,b]=value.split('十');return (a?d[a]:1)*10+(b?d[b]:0);}return d[value];};
const digits='[0-9一二两三四五六七八九十]+';
function countRooms(text,names){
 const match=text.match(new RegExp(`(${digits})\\s*(?:个|间)?\\s*(?:大|小|独立的?)?\\s*(?:${names})`,'i'));
 if(match)return number(match[1]);
 const after=text.match(new RegExp(`(?:${names})\\s*(${digits})\\s*(?:个|间)?`,'i'));
 return after?number(after[1]):new RegExp(names,'i').test(text)?1:undefined;
}
export function officeBrief(prompt=''){
 const meeting=countRooms(prompt,'会议室|meeting rooms?'),office=countRooms(prompt,'老板(?:办公室|办公区|帮公司|房间)?|独立办公室|经理办公室|executive offices?');
 const cap=prompt.match(new RegExp(`(?:容纳|容貌|支持|可供|适合|for|capacity)\\s*(${digits})\\s*(?:个?人|people|members)`,'i'))||prompt.match(new RegExp(`(${digits})\\s*人(?:的)?(?:团队|公司|办公室|办公空间)`));
 const capacity=cap?number(cap[1]):undefined;
 const shape=/纵向|纵深|竖长|比较高|高一点|往下延伸|tall|deep/i.test(prompt)?'deep':/横向|长条|横长|比较长|长一点|宽一点|wide|long/i.test(prompt)?'wide':undefined;
 const material=/木(?:头|质)?(?:的)?(?:墙|隔断)|wood(?:en)? walls?/i.test(prompt)?'wood':/玻璃(?:的)?(?:墙|隔断)|glass walls?/i.test(prompt)?'glass':undefined;
 const doorMaterial=/玻璃门|glass doors?/i.test(prompt)?'glass':/木(?:头|质)?门|wood(?:en)? doors?/i.test(prompt)?'wood':undefined;
 const largerOffice=/(?:其中|有|留|让).*(?:一|1)个.*(?:办公室|老板).*(?:大|宽敞)|(?:一个|1个)(?:比较|更|较)?大的?(?:老板)?办公室|one.*office.*larger/i.test(prompt);
 return {meeting,office,capacity,shape,material,doorMaterial,largerOffice,wallHeight:/挑高|高墙|high ceiling/i.test(prompt)?2:1.15,requested:meeting!==undefined||office!==undefined||capacity!==undefined||shape!==undefined||material!==undefined||doorMaterial!==undefined||/户型|房间布局|floor plan/i.test(prompt)};
}
const overlaps=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
export function prepareOfficeScene(base,prompt,{reflow=false,minCapacity=1}={}){
 const brief=officeBrief(prompt);if(!brief.requested&&!reflow)return structuredClone(base);
 const capacity=Math.max(minCapacity,brief.capacity??base.floorPlan?.capacity??8),meeting=brief.meeting??base.floorPlan?.rooms.filter(r=>r.kind==='meeting').length??0,office=brief.office??base.floorPlan?.rooms.filter(r=>r.kind==='office').length??0;
 if(capacity<1||capacity>100||meeting+office>12)throw Error('当前支持 1–100 个预留工位、最多 12 个房间，请调整人数或房间数');
 const rooms=[];
 for(let i=0;i<office;i++)rooms.push({id:`office-${i+1}`,name:brief.largerOffice&&i===0?'老板办公室 · 大':'老板办公室 '+(i+1),kind:'office',width:brief.largerOffice&&i===0?18:14,height:brief.largerOffice&&i===0?14:10});
 for(let i=0;i<meeting;i++)rooms.push({id:`meeting-${i+1}`,name:'会议室 '+(i+1),kind:'meeting',width:16,height:11});
 const shape=brief.shape??'balanced',rightBand=rooms.length?Math.max(...rooms.map(r=>r.width))+5:2;
 const minRows=Math.max(32,12+rooms.reduce((n,r)=>n+r.height+2,0));
 const target=shape==='wide'?2.1:shape==='deep'?.68:1.35;
 const candidates=[];
 const widths=[base.columns,...Array.from({length:25},(_,i)=>32+i*4).filter(n=>n!==base.columns)];
 for(const columns of widths)for(let rows=Math.ceil(minRows/4)*4;rows<=128;rows+=4){
   if(shape==='wide'&&columns/rows<1.7||shape==='deep'&&rows/columns<1.3)continue;
   if(base.modules.some(m=>m.width>columns-rightBand-5))continue;
   const xs=[];for(let x=6;x<=columns-rightBand-4;x+=8)xs.push(x);
   const ys=[];for(let y=15;y<=rows-4;y+=8)ys.push(y);
   if(xs.length*ys.length<capacity)continue;
   candidates.push({columns,rows,xs,ys,score:columns*rows*(1+Math.abs(Math.log(columns/rows/target))*.65)});
 }
 if(!candidates.length)throw Error('这组人数和房间需要更大地图，请减少房间或人数');
 // Unless explicitly asked for a wide map, exhaust vertical space at the
 // existing width first. Only grow sideways when capacity makes it necessary.
 const widthCost=c=>c.columns===base.columns?0:c.columns>base.columns?c.columns-base.columns:128+base.columns-c.columns;
 let lastError;
 for(const {columns,rows,xs,ys} of candidates.sort((a,b)=>(brief.shape==='wide'?0:widthCost(a)-widthCost(b))||a.score-b.score)){
 const scene=structuredClone(base);
 scene.columns=columns;scene.rows=rows;scene.width=columns*40;scene.height=rows*40;
 scene.walkable={x:1/columns*100,y:10/rows*100,width:(columns-2)/columns*100,height:(rows-11)/rows*100};
 scene.boards=Object.fromEntries(Object.entries(base.boards).map(([key,b])=>[key,{x:b.x,width:b.width,y:1.5/rows*100,height:6.5/rows*100}]));
 let y=12;
 scene.floorPlan={version:1,capacity,shape,wallRows:9,wallHeight:brief.wallHeight,entry:{x:columns-rightBand-1,y:rows-3},rooms:rooms.map(room=>{const r={...room,x:columns-room.width,y,material:brief.material??(brief.doorMaterial==='glass'?'glass':'wood'),doors:[{side:'left',offset:(room.height-4)/2,width:4,material:brief.doorMaterial??brief.material??'glass'}]};y+=room.height+2;return r;})};
 try{
   furnishOfficeScene(scene,base,ys.flatMap(y=>xs.map(x=>toPercent(scene,{x,y}))));
   validateOfficeCirculation(scene);
   return scene;
 }catch(error){lastError=error;}
 }
 throw lastError||Error('请为已有家具和工位增加空间');
}

export function assertOfficeBrief(scene,prompt){
 const brief=officeBrief(prompt);if(!brief.requested)return;
 if(!scene.floorPlan)throw Error('提示词要求户型、人数或空间比例，请输出 floorPlan 房间与入口数据');
 const f=scene.floorPlan;
 for(const [kind,count]of [['meeting',brief.meeting],['office',brief.office]])if(count!==undefined&&f.rooms.filter(r=>r.kind===kind).length!==count)throw Error(`提示词要求 ${count} 个 ${kind==='meeting'?'会议室':'老板办公室'}，请补齐户型`);
 if(brief.capacity&&f.capacity<brief.capacity)throw Error(`请保留至少 ${brief.capacity} 人的工位容量`);
 if(brief.shape==='wide'&&scene.columns/scene.rows<1.7||brief.shape==='deep'&&scene.rows/scene.columns<1.3)throw Error('地图长宽比例不符合提示词，请调整 columns 和 rows');
 if(brief.material&&f.rooms.some(r=>r.material!==brief.material))throw Error('房间隔墙材质与提示词不符');
 if(brief.doorMaterial&&f.rooms.some(r=>r.doors.some(d=>d.material!==brief.doorMaterial)))throw Error('房间门的材质与提示词不符');
 if(brief.largerOffice){const offices=f.rooms.filter(r=>r.kind==='office').map(r=>r.width*r.height);if(offices.length>1&&Math.max(...offices)<Math.min(...offices)*1.3)throw Error('其中一个老板办公室需要明显更大，请至少增加 30% 面积');}
 validateOfficeCirculation(scene);
}
export function freePlannedDevicePosition(occupied,scene){
 const used=occupied.map(p=>workstationRect(scene,p));
 const walls=floorPlanObstacles(scene).map(r=>({x:r.x/100*scene.columns,y:r.y/100*scene.rows,width:r.width/100*scene.columns,height:r.height/100*scene.rows}));
 const doors=scene.floorPlan.rooms.flatMap(r=>r.doors.map(d=>{const p=roomDoorPoint(r,d);return {x:p.x-2.3,y:p.y-2.3,width:4.6,height:4.6};}));
 const furniture=scene.modules.filter(m=>!m.walkThrough&&!['rug','window','lamp'].includes(m.kind));
 const solid=[...used,...walls,...doors,...furniture],floor={x:scene.walkable.x/100*scene.columns,y:scene.walkable.y/100*scene.rows,width:scene.walkable.width/100*scene.columns,height:scene.walkable.height/100*scene.rows};
 // Consider only the new desk. Existing user-arranged overlaps must never
 // prevent adding another device somewhere else in the office.
 const available=p=>{
  const r=workstationRect(scene,p),front={x:p.x/100*scene.columns-.5,y:p.y/100*scene.rows+2.8,width:1,height:.8};
  return r.x>=floor.x&&r.y>=floor.y&&r.x+r.width<=floor.x+floor.width&&front.y+front.height<=floor.y+floor.height&&!solid.some(o=>overlaps(r,o)||overlaps(front,o));
 };
 const candidate=scene.deviceZones.find(available);
 if(candidate)return {x:candidate.x,y:candidate.y};
 for(let y=15;y<scene.rows-4;y+=2)for(let x=5;x<scene.columns-4;x+=2){const p=toPercent(scene,{x,y});if(available(p))return p;}
 // A full room still accepts devices; their owner can move the new desk.
 const point=scene.deviceZones[occupied.length%scene.deviceZones.length];
 return toPercent(scene,{x:Math.max(floor.x+3.4,Math.min(floor.x+floor.width-3.4,point.x/100*scene.columns)),y:Math.max(floor.y+3.3,Math.min(floor.y+floor.height-3.6,point.y/100*scene.rows))});
}
