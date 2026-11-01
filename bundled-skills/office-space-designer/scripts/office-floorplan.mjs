import {packOfficeRooms} from './office-reflow.mjs';
import {furnishOfficeScene,officeFurnitureGroups} from './office-furnishing.mjs';
import {floorPlanObstacles,roomDoorPoint,toPercent,validateOfficeCirculation,workstationRect,roomWorkstations} from './floor-plan.mjs';
const number=value=>{if(/^\d+$/.test(value))return Number(value);const d={零:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};if(value.includes('十')){const [a,b]=value.split('十');return (a?d[a]:1)*10+(b?d[b]:0);}return d[value];};
const digits='[0-9一二两三四五六七八九十]+';
function countRooms(text,names,implied=true){
 const match=text.match(new RegExp(`(${digits})\\s*(?:个|间)?\\s*(?:大|小|独立的?)?\\s*(?:${names})`,'i'));
 if(match)return number(match[1]);
 const after=text.match(new RegExp(`(?:${names})\\s*(${digits})\\s*(?:个|间)?`,'i'));
 return after?number(after[1]):implied&&new RegExp(names,'i').test(text)?1:undefined;
}
export function officeBrief(prompt=''){
 const meeting=countRooms(prompt,'会议室|meeting rooms?'),office=countRooms(prompt,'老板(?:办公室|办公区|帮公司|房间)?|独立办公室|经理办公室|executive offices?');
 const cap=prompt.match(new RegExp(`(?:容纳|容貌|支持|可供|适合|for|capacity)\\s*(${digits})\\s*(?:个?人|people|members)`,'i'))||prompt.match(new RegExp(`(${digits})\\s*人(?:的)?(?:团队|公司|办公室|办公空间)`));
 const capacity=cap?number(cap[1]):undefined;
 const genericRooms=countRooms(prompt,'房间|工作室|rooms?',false);
 const each=prompt.match(new RegExp(`(?:每(?:个|间)?(?:房间|屋|室)|each room)[^，。;；\n]{0,24}?(${digits})\\s*(?:台|个工位|张桌|workstations?|computers?)`,'i'));
 const roomWorkstations=each?number(each[1]):undefined;
 const roomNames=[...prompt.matchAll(/["“「]([^"”」\n]{1,40})["”」]/g)].map(m=>m[1]).filter(n=>/室|房|room|studio/i.test(n));
 const keepScale=/(?:保留|保持|保存|不改|不变).{0,8}(?:缩放|比例|大小)|keep.{0,12}(?:scale|size)/i.test(prompt);
 const scaling=prompt.match(/(?:缩小|reduce|shrink)\s*(到|至|to)?\s*(\d+(?:\.\d+)?)\s*[%％]/i);
 const upperOnly=/墙面|顶部|看板|面板|上方|boards?|panels?/i.test(prompt)&&!/下半|下方|地板|地面|人物|设备|房间|办公室|数据室|floor|characters/i.test(prompt);
 const wholeFloor=!upperOnly&&/人物|角色|办公室|下半|下方|场景|设备.{0,8}家具|office|floor|scene|characters/i.test(prompt);
 const scaleRatio=!keepScale&&wholeFloor&&scaling?(scaling[1]?Number(scaling[2])/100:1-Number(scaling[2])/100):undefined;
 const fillWidth=!upperOnly&&(scaleRatio!==undefined||/铺满|铺平|满宽|两侧.{0,10}(?:空白|留白|边距)|露出.{0,12}(?:办公室|室)|full.width|fill.{0,10}width/i.test(prompt));
 const compact=/紧凑|太空|空旷|利用率|compact|wasted space/i.test(prompt);
 const rebalance=!keepScale&&/太小|太大|智能.{0,8}(?:大小|比例)|合适.{0,8}(?:大小|比例)|too (?:small|large)|rebalance/i.test(prompt);
 const shape=/纵向|纵深|竖长|比较高|高一点|往下延伸|tall|deep/i.test(prompt)?'deep':/横向|长条|横长|比较长|长一点|宽一点|wide|long/i.test(prompt)?'wide':undefined;
 const material=/木(?:头|质)?(?:的)?(?:墙|隔断)|wood(?:en)? walls?/i.test(prompt)?'wood':/玻璃(?:的)?(?:墙|隔断)|glass walls?/i.test(prompt)?'glass':undefined;
 const doorMaterial=/玻璃门|glass doors?/i.test(prompt)?'glass':/木(?:头|质)?门|wood(?:en)? doors?/i.test(prompt)?'wood':undefined;
 const largerOffice=/(?:其中|有|留|让).*(?:一|1)个.*(?:办公室|老板).*(?:大|宽敞)|(?:一个|1个)(?:比较|更|较)?大的?(?:老板)?办公室|one.*office.*larger/i.test(prompt);
 return {meeting,office,genericRooms,roomWorkstations,roomNames,keepScale,scaleRatio,fillWidth,compact,rebalance,capacity,shape,material,doorMaterial,largerOffice,wallHeight:/挑高|高墙|high ceiling/i.test(prompt)?2:1.15,requested:fillWidth||genericRooms!==undefined||roomWorkstations!==undefined||compact||rebalance||meeting!==undefined||office!==undefined||capacity!==undefined||shape!==undefined||material!==undefined||doorMaterial!==undefined||/户型|房间布局|floor plan/i.test(prompt)};
}
const overlaps=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
export function prepareOfficeScene(base,prompt,{reflow=false,minCapacity=1}={}){
 const brief=officeBrief(prompt);if(!brief.requested&&!reflow)return structuredClone(base);
 let capacity=Math.max(minCapacity,brief.capacity??base.floorPlan?.capacity??8);const meeting=brief.meeting??base.floorPlan?.rooms.filter(r=>r.kind==='meeting').length??0,office=brief.office??(brief.genericRooms!==undefined?Math.max(0,brief.genericRooms-meeting):base.floorPlan?.rooms.filter(r=>r.kind==='office').length??0);
 if(capacity<1||capacity>100||meeting+office>12)throw Error('当前支持 1–100 个预留工位、最多 12 个房间，请调整人数或房间数');
 const rooms=[];
 for(let i=0;i<office;i++)rooms.push({id:`office-${i+1}`,name:brief.largerOffice&&i===0?'老板办公室 · 大':'老板办公室 '+(i+1),kind:'office',width:brief.largerOffice&&i===0?18:14,height:brief.largerOffice&&i===0?14:10});
 for(let i=0;i<meeting;i++)rooms.push({id:`meeting-${i+1}`,name:'会议室 '+(i+1),kind:'meeting',width:16,height:11});
 // Keep existing room identities and use each room's actual desk requirement.
 const reused=new Set();
 for(const [i,room] of rooms.entries()){
  const old=base.floorPlan?.rooms.find(r=>r.kind===room.kind&&!reused.has(r.id));
  if(old)reused.add(old.id);
  room.id=old?.id||room.id;room.name=brief.roomNames[i]||old?.name||room.name;
  const count=brief.roomWorkstations??old?.workstations;
  if(count!==undefined){room.workstations=count;room.width=Math.max(room.width,count>1?20:14);room.height=Math.max(room.height,Math.ceil(count/2)*8+6);}
  if(old?.workstations&&brief.roomWorkstations===undefined&&!brief.largerOffice){room.width=old.width;room.height=old.height;}
 }
 const roomCapacity=rooms.reduce((n,r)=>n+(r.workstations||0),0);
 if(brief.roomWorkstations!==undefined&&brief.capacity===undefined&&!base.floorPlan)capacity=Math.max(minCapacity,roomCapacity);
 else capacity=Math.max(capacity,roomCapacity);
 if(capacity>100)throw Error('房内和公共工位合计不能超过 100');
 const shape=brief.shape??'balanced',rightBand=rooms.length?Math.max(...rooms.map(r=>r.width))+5:2;
 const publicGroups=officeFurnitureGroups({...base,modules:base.modules.filter(m=>!base.floorPlan?.rooms.some(r=>m.x>=r.x&&m.y>=r.y&&m.x+m.width<=r.x+r.width&&m.y+m.height<=r.y+r.height))});
 const publicWidth=Math.max(20,...publicGroups.map(g=>g.width+4));
 const target=shape==='wide'?2.1:shape==='deep'?.68:1.35;
 const candidates=[];
 // Replanning an older 40-column office adopts the compact floor scale too.
 // Palette-only edits return above and never resize a hand-arranged scene.
 if(brief.scaleRatio!==undefined&&(!(brief.scaleRatio>0&&brief.scaleRatio<=1)||Math.round(base.columns/brief.scaleRatio)>128))throw Error('该缩小比例超过场景范围，请选择较小幅度并重新布局');
 const preferredColumns=brief.scaleRatio!==undefined?Math.round(base.columns/brief.scaleRatio):brief.keepScale?base.columns:brief.rebalance?Math.max(50,Math.min(64,base.columns)):Math.max(50,base.columns);
 const widths=brief.keepScale||brief.scaleRatio!==undefined?[preferredColumns]:[preferredColumns,...Array.from({length:20},(_,i)=>52+i*4).filter(n=>n!==preferredColumns)];
 for(const columns of widths){
 const packed=packOfficeRooms(rooms,columns,{fillWidth:brief.fillWidth,publicWidth,top:9+brief.wallHeight});
 const minRows=Math.max(32,...packed.map(r=>r.y+r.height+1.5));
 for(let rows=Math.ceil(minRows/2)*2;rows<=128;rows+=2){
   if(shape==='wide'&&columns/rows<1.7||shape==='deep'&&rows/columns<1.3)continue;
   if(base.modules.some(m=>m.width>Math.max(columns-rightBand,...rooms.map(r=>r.width-3))))continue;
   const xs=[];for(let x=6;x<=columns-(brief.fillWidth?4:rightBand+4);x+=8)xs.push(x);
   const ys=[];for(let y=15;y<=rows-4;y+=8)ys.push(y);
   if(xs.length*ys.length<capacity)continue;
   candidates.push({columns,rows,xs,ys,packed,score:brief.fillWidth?rows:columns*rows*(1+Math.abs(Math.log(columns/rows/target))*.65)});
 }
 }
 if(!candidates.length)throw Error('这组人数和房间需要更大地图，请减少房间或人数');
 // Unless explicitly asked for a wide map, exhaust vertical space at the
 // compact baseline width first. Only grow sideways when capacity needs it.
 const widthCost=c=>c.columns===preferredColumns?0:c.columns>preferredColumns?c.columns-preferredColumns:128+preferredColumns-c.columns;
 let lastError;
 for(const {columns,rows,xs,ys,packed} of candidates.sort((a,b)=>(brief.shape==='wide'?0:widthCost(a)-widthCost(b))||a.score-b.score)){
 const scene=structuredClone(base);
 scene.columns=columns;scene.rows=rows;scene.width=columns*40;scene.height=rows*40;
 scene.walkable={x:1/columns*100,y:10/rows*100,width:(columns-2)/columns*100,height:(rows-11)/rows*100};
 scene.boards=Object.fromEntries(Object.entries(base.boards).map(([key,b])=>[key,{x:b.x,width:b.width,y:1.5/rows*100,height:6.5/rows*100}]));
 scene.floorPlan={version:1,capacity,shape,wallRows:9,wallHeight:brief.wallHeight,entry:{x:Math.max(3,Math.min(...packed.map(r=>r.x),columns)-4),y:12},rooms:packed.map(({column,...room})=>{
  const old=base.floorPlan?.rooms.find(r=>r.id===room.id),preserve=old?.workstations&&old.width===room.width&&old.height===room.height&&brief.roomWorkstations===undefined;
  const r={...room,material:brief.material??old?.material??(brief.doorMaterial==='glass'?'glass':'wood'),doors:brief.fillWidth&&column>0?[{side:'bottom',offset:1,width:5,material:brief.doorMaterial??old?.doors[0]?.material??'glass'}]:preserve?old.doors.map(d=>({...d,material:brief.doorMaterial??d.material})):[{side:'left',offset:room.workstations?room.height-5:(room.height-4)/2,width:4,material:brief.doorMaterial??brief.material??old?.doors[0]?.material??'glass'}]};return r;
 })};
 try{
   furnishOfficeScene(scene,base,ys.flatMap(y=>xs.map(x=>toPercent(scene,{x,y}))),{compact:brief.compact||brief.fillWidth,fillWidth:brief.fillWidth});
   validateOfficeCirculation(scene);
   return scene;
 }catch(error){lastError=error;}
 }
 throw lastError||Error('请为已有家具和工位增加空间');
}

export function assertOfficeBrief(scene,prompt,{base}={}){
 const brief=officeBrief(prompt);if(!brief.requested)return;
 if(!scene.floorPlan)throw Error('提示词要求户型、人数或空间比例，请输出 floorPlan 房间与入口数据');
 if(brief.fillWidth){
  const left=scene.walkable.x/100*scene.columns,right=(100-scene.walkable.x-scene.walkable.width)/100*scene.columns;
  if(left>2.01||right>2.01)throw Error('缩小后需要满宽重排，不能把原办公室居中留下两侧空白');
 }
 if(base&&brief.scaleRatio!==undefined&&scene.columns!==Math.round(base.columns/brief.scaleRatio))throw Error('请按要求调整物件比例，并同时重排布局；不能只更改视图缩放');
 const f=scene.floorPlan;
 for(const [kind,count]of [['meeting',brief.meeting],['office',brief.office]])if(count!==undefined&&f.rooms.filter(r=>r.kind===kind).length!==count)throw Error(`提示词要求 ${count} 个 ${kind==='meeting'?'会议室':'老板办公室'}，请补齐户型`);
 if(brief.genericRooms!==undefined&&f.rooms.length!==brief.genericRooms)throw Error(`需要 ${brief.genericRooms} 个房间`);
 if(brief.roomWorkstations!==undefined&&f.rooms.some(r=>roomWorkstations(scene,r).length<brief.roomWorkstations))throw Error(`每个房间需要 ${brief.roomWorkstations} 个房内工位及通道`);
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
