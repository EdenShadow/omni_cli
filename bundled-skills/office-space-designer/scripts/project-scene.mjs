import {validateFloorPlan, floorPlanObstacles, floorPlanLayers} from './floor-plan.mjs';
import {furnitureObstacles} from './scene-geometry.mjs';
import {validatePropTrigger} from './prop-triggers.mjs';
import {validatePropPhysics} from './prop-interactions.mjs';
import {validatePropAnimations} from './prop-animation.mjs';
// Project scenes are editable tile data. SVG is a deterministic preview, never a generated photo.
import {validatePropArt, fitPropArt, validatePropSeats, propSeats} from './prop-art.mjs';
export const moduleKinds = ['rug', 'sofa', 'table', 'plant', 'bookshelf', 'arcade', 'window', 'wall', 'lamp', 'custom'];
// Keep seat 0 at the old center anchor so a live occupant retains their place.
const standardSofaCenter={x:(16/100*40-3)/7*100,y:68};
const standardSofaSeats=[standardSofaCenter,{x:20,y:68},{x:80,y:68}];
export const defaultProjectScene = {
  schemaVersion: 2, renderMode: 'pixel-grid', name: '灵感花园', background: 'background.svg',
  columns: 40, rows: 26, width: 1600, height: 1040,
  palette: { wall: '#dbe8dc', floor: '#f2ecdd', tile: '#e5dcc7', accent: '#8573b2', wood: '#bb8e64', leaf: '#719b74' },
  walkable: { x: 4, y: 34, width: 92, height: 60 },
  boards: {
    announcement: { x: 4, y: 5.5, width: 27, height: 24.5 },
    canvas: { x: 35, y: 5.5, width: 30, height: 24.5 },
    skills: { x: 69, y: 5.5, width: 27, height: 24.5 },
  },
  deviceZones: [{x:39,y:53},{x:60,y:53},{x:78,y:53},{x:39,y:78},{x:60,y:78},{x:81,y:78}],
  seats: [], props: [],
  modules: [
    {id:'lounge-rug',kind:'rug',x:2,y:17,width:10,height:7},
    {id:'sofa',kind:'sofa',x:3,y:18,width:7,height:3,seats:standardSofaSeats},
    {id:'tea-table',kind:'table',x:5,y:22,width:4,height:2},
    {id:'garden',kind:'plant',x:3,y:12,width:2,height:3},
    {id:'books',kind:'bookshelf',x:32,y:22,width:5,height:3},
    {id:'arcade',kind:'arcade',x:36,y:12,width:2,height:3},
    {id:'fern',kind:'plant',x:33,y:12,width:2,height:3},
    {id:'small-plant',kind:'plant',x:10,y:21,width:2,height:3},
  ],
};
const clone = x => JSON.parse(JSON.stringify(x));
const escape = x => String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const hex = (v, fallback) => /^#[\da-f]{6}$/i.test(v || '') ? v : fallback;
const shade = (color, delta) => '#'+[1,3,5].map(i=>Math.max(0,Math.min(255,parseInt(color.slice(i,i+2),16)+delta)).toString(16).padStart(2,'0')).join('');
const rect = (x,y,w,h,color,stroke='') => `<rect x="${x}" y="${y}" width="${Math.max(0,w)}" height="${Math.max(0,h)}" fill="${color}"${stroke?` stroke="${stroke}" stroke-width="4"`:''}/>`;
function upgradeStandardSofa(scene){
  const removed=new Set();
  const modules=scene.modules.map(m=>{
    if(m.kind!=='sofa')return m;
    const attached=scene.seats.filter(p=>p.x>=m.x/scene.columns*100&&p.x<=(m.x+m.width)/scene.columns*100&&p.y>=m.y/scene.rows*100&&p.y<=(m.y+m.height)/scene.rows*100+8);
    const seats=m.seats??attached.map(p=>({x:(p.x/100*scene.columns-m.x)/m.width*100,y:68}));
    // Match the old automatic seat exactly; respect explicitly designed capacities.
    if(seats.length!==1||Math.abs(seats[0].x-standardSofaCenter.x)>1e-7||Math.abs(seats[0].y-68)>1e-7)return m;
    attached.forEach(p=>removed.add(p));
    return {...m,seats:clone(standardSofaSeats)};
  });
  return {...scene,modules,seats:scene.seats.filter(p=>!removed.has(p))};
}
export function resolveProjectScene(input) {
  // Legacy painted assets remain saved; their live presentation uses a tile scene.
  const base = clone(defaultProjectScene);
  if (input?.renderMode !== 'pixel-grid' || input?.schemaVersion !== 2) return base;
  try { validateProjectScene(input); } catch { return base; }
  const scene=upgradeStandardSofa({...base,...input,palette:{...base.palette,...input.palette}});
  // Upgrade only the old standard wall layout, without rewriting saved player maps.
  if(Object.entries(scene.boards).every(([key,b])=>b.x===base.boards[key]?.x&&b.width===base.boards[key]?.width&&b.y===10&&b.height===20)){
    const taller={...scene,boards:base.boards};
    try{validateProjectScene(taller);return taller;}catch{/* Keep custom furniture unobstructed. */}
  }
  return scene;
}
export function validateProjectScene(scene) {
  if(scene?.schemaVersion!==2||scene?.renderMode!=='pixel-grid')throw Error('项目场景须使用 schemaVersion 2 / pixel-grid 格子模块，不支持整张生图背景');
  if(scene.background!=='background.svg')throw Error('项目预览必须为 background.svg，由格子模块渲染');
  for(const [key,min,max] of [['columns',32,128],['rows',24,128]])if(!Number.isInteger(scene[key])||scene[key]<min||scene[key]>max)throw Error(`格子 ${key} 必须为 ${min}–${max} 的整数`);
  if(!scene.palette||Object.values(scene.palette).some(c=>!/^#[\da-f]{6}$/i.test(c)))throw Error('项目配色须使用六位十六进制颜色');
  const point = p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x>=0 && p.x<=100 && p.y>=0 && p.y<=100;
  const region = r => point(r) && Number.isFinite(r.width) && Number.isFinite(r.height) && r.width>0 && r.height>0 && r.x+r.width<=100 && r.y+r.height<=100;
  if(!region(scene.walkable)||scene.walkable.y<(scene.floorPlan?9/scene.rows*100:32))throw Error('可行走地面必须位于看板下方且在地图内');
  if(!Array.isArray(scene.deviceZones)||!scene.deviceZones.length||scene.deviceZones.some(p=>!point(p)))throw Error('项目需要有效的设备区域');
  for(const p of [...(scene.seats||[]),...(scene.props||[])])if(!point(p)||(p.destination&&!point(p.destination)))throw Error('交互位置必须位于地图内');
  if((scene.obstacles||[]).some(r=>!region(r)))throw Error('障碍区域必须位于地图内');
  if(!Array.isArray(scene.modules)||scene.modules.length>160)throw Error('项目模块列表无效');
  const ids=new Set();
  for(const m of scene.modules){
    if(typeof m.id!=='string'||!m.id||ids.has(m.id)||!moduleKinds.includes(m.kind))throw Error('模块需要唯一 ID 和受支持的 kind'); ids.add(m.id);
    if(!['x','y'].every(k=>Number.isFinite(m[k]))||!['width','height'].every(k=>Number.isInteger(m[k]))||m.x<0||m.y<0||m.width<1||m.height<1||m.x+m.width>scene.columns||m.y+m.height>scene.rows)throw Error('模块尺寸须使用格子且位于地图内');
    if(m.color&&!/^#[\da-f]{6}$/i.test(m.color))throw Error('模块颜色无效');
    if(m.kind==='custom') validatePropArt(m.svg);
    validatePropAnimations(m.animations,m.svg);
    if(m.seats!==undefined)validatePropSeats(m.seats);
    validatePropPhysics(m.physics);
    validatePropTrigger(m.trigger);
    if(m.name!==undefined&&(typeof m.name!=='string'||m.name.length>80))throw Error('道具名称最多 80 字');
  }
  const boards=[];
  for(const key of ['announcement','canvas','skills']){
    const b=scene.boards?.[key];
    if(!b||!['x','y','width','height'].every(k=>Number.isFinite(b[k]))||b.x<0||b.y<0||b.width<18||b.height<(scene.floorPlan?6/scene.rows*100:16)||b.x+b.width>100||b.y+b.height>(scene.floorPlan?9/scene.rows*100:32)||b.rotation||b.skew)throw Error(`${key} 看板须正对屏幕，宽至少 18%、高度须留足内容，户型看板高至少 6 格并在顶部 9 行内，普通场景高至少 16% 并在顶部 32% 内`);
    if(boards.some(a=>b.x<a.x+a.width&&b.x+b.width>a.x&&b.y<a.y+a.height&&b.y+b.height>a.y))throw Error('项目看板不能互相重叠');
    boards.push(b);
  }
  for(const m of scene.modules){
    const r={x:m.x/scene.columns*100,y:m.y/scene.rows*100,width:m.width/scene.columns*100,height:m.height/scene.rows*100};
    if(boards.some(b=>r.x<b.x+b.width&&r.x+r.width>b.x&&r.y<b.y+b.height&&r.y+r.height>b.y))throw Error('家具模块不能遮住正面看板');
  }
  validateFloorPlan(scene);
  return true;
}
export function sceneSeats(input) {
  const s=resolveProjectScene(input), attached=new Map();
  const legacy=s.seats.flatMap((p,i)=>{
    const sofa=s.modules.find(m=>m.kind==='sofa'&&p.x>=m.x/s.columns*100&&p.x<=(m.x+m.width)/s.columns*100&&p.y>=m.y/s.rows*100&&p.y<=(m.y+m.height)/s.rows*100+8);
    if(!sofa)return [{...p,name:'',moduleId:'legacy-seat',seatIndex:i}];
    if(sofa.seats===undefined){
      const seats=attached.get(sofa.id)||[];
      seats.push({x:Math.max(5,Math.min(95,(p.x/100*s.columns-sofa.x)/sofa.width*100)),y:68});attached.set(sofa.id,seats);
    }
    return [];
  });
  return [...legacy,...s.modules.flatMap(m=>(m.kind==='custom'?propSeats(m):(m.seats??attached.get(m.id)??[])).map((p,i)=>({
    x:(m.x+m.width*p.x/100)/s.columns*100,y:(m.y+m.height*p.y/100)/s.rows*100,name:m.name||(m.kind==='sofa'?'沙发':'道具'),moduleId:m.id,seatIndex:i,
  })))];
}
export function sceneObstacles(input) {
  const s=resolveProjectScene(input);
  return [...furnitureObstacles(s),...floorPlanObstacles(s)];
}
function moduleArt(m,p){
  const w=m.width*40,h=m.height*40, ink='#525266', c=hex(m.color,p.accent), wood=p.wood, leaf=p.leaf;
  if(m.kind==='custom') return fitPropArt(m.svg,w,h,m.animations);
  const r=(x,y,a,b,c,s)=>rect(x,y,a,b,c,s);
  const poly=(points,color)=>`<polygon points="${points}" fill="${color}"/>`;
  let out='';
  if(m.kind==='rug'){
    out=r(0,0,w,h,c)+r(8,8,w-16,h-16,'#d9d0e6')+r(16,16,w-32,h-32,c);
    for(let x=24;x<w-20;x+=24)out+=r(x,12,8,4,'#eee5f3')+r(x,h-16,8,4,'#eee5f3');
  }else if(m.kind==='sofa'){
    out=r(10,h-12,w-10,12,'#433d5628')+r(12,10,w-20,h-22,shade(c,-32));
    out+=poly(`12,10 22,0 ${w-20},0 ${w-10},10`,shade(c,32))+r(16,10,w-36,h*.48,c)+r(24,16,w-52,5,shade(c,24));
    out+=poly(`24,${h*.5} ${w-28},${h*.5} ${w-16},${h*.73} 12,${h*.73}`,shade(c,34));
    out+=r(12,h*.73,w-28,h*.17,shade(c,-10))+r(12,h*.88,w-28,5,shade(c,-40));
    for(let x=w/3;x<w-25;x+=w/3)out+=r(x,20,3,h*.31,shade(c,-22))+r(x,h*.54,3,h*.15,shade(c,8));
    for(const x of [0,w-28])out+=poly(`${x},40 ${x+8},30 ${x+28},30 ${x+28},40`,shade(c,45))+r(x,40,28,h-55,c)+r(x+22,40,6,h-55,shade(c,-28));
    out+=r(32,27,36,28,'#e6e7b9')+r(36,31,28,4,'#f9f4d4')+r(w-74,27,36,28,'#f3d8bd')+r(w-70,31,28,4,'#ffedd8')+r(24,h-12,16,9,ink)+r(w-46,h-12,16,9,ink);
  }else if(m.kind==='table'){
    const top=h*.52;
    out=r(10,h-6,w-10,6,'#433d5628')+r(14,top,10,h-top-6,shade(wood,-30))+r(w-26,top,10,h-top-6,shade(wood,-45));
    out+=poly(`0,12 12,0 ${w-12},0 ${w},12 ${w},${top} 0,${top}`,shade(wood,32))+r(0,top,w,10,wood)+r(w-8,12,8,top+10,shade(wood,-25))+r(12,5,w-28,4,shade(wood,55));
    out+=r(18,top*.33,32,14,c)+r(18,top*.33+14,32,4,shade(c,-25))+r(w-40,top*.3,18,15,'#fff6db')+r(w-24,top*.3+4,7,6,shade(wood,-10));
  }else if(m.kind==='plant'){
    out=r(w*.2,h-8,w*.7,8,'#433d5628')+r(w*.46,h*.22,8,h*.6,wood)+r(w*.2,h*.68,w*.6,h*.27,'#ce9775')+r(w*.65,h*.7,w*.15,h*.25,'#a8735f')+r(w*.25,h*.73,w*.08,h*.17,'#e8b795');
    out+=poly(`${w*.16},${h*.68} ${w*.25},${h*.6} ${w*.74},${h*.6} ${w*.84},${h*.68}`,'#efd0aa')+r(w*.16,h*.68,w*.68,9,'#e0b28a');
    for(const [x,y,a,b] of [[.16,.08,.35,.3],[.5,.02,.3,.26],[.1,.37,.4,.22],[.5,.29,.37,.3]])out+=r(w*x+5,h*y+5,w*a,h*b,shade(leaf,-26))+r(w*x,h*y,w*a,h*b,leaf)+r(w*x+6,h*y+5,w*a*.45,6,shade(leaf,37));
  }else if(m.kind==='bookshelf'){
    out=r(8,h-6,w-8,6,'#433d5628')+r(0,10,w-12,h-16,wood,shade(wood,-35))+poly(`0,10 10,0 ${w},0 ${w-12},10`,shade(wood,35))+poly(`${w-12},10 ${w},0 ${w},${h-16} ${w-12},${h-6}`,shade(wood,-32))+r(8,18,w-28,h-32,shade(wood,-48));
    for(let y=23;y<h-28;y+=40){for(let x=14;x<w-38;x+=18)out+=r(x+2,y+3,12,24,'#403b5528')+r(x,y,12,24,['#a9bf9b','#cec1df','#eed49d','#e3a891'][Math.floor(x/18)%4])+r(x+2,y+5,7,3,'#faf3df')+r(x+9,y,3,24,'#55495828');out+=r(6,y+24,w-26,5,shade(wood,24))+r(6,y+29,w-26,4,shade(wood,-16));}
  }else if(m.kind==='arcade'){
    out=r(10,h-8,w-10,8,'#433d5628')+r(4,8,w-16,h-16,c,ink)+poly(`4,8 14,0 ${w},0 ${w-12},8`,shade(c,35))+poly(`${w-12},8 ${w},0 ${w},${h-16} ${w-12},${h-8}`,shade(c,-30))+r(10,15,w-28,14,'#e7d7b5')+r(10,35,w-28,h*.29,'#353f53')+r(17,42,12,12,'#afd59e')+r(w-37,58,8,8,'#dacbec')+poly(`6,${h*.62} ${w-15},${h*.62} ${w-5},${h*.73} 0,${h*.73}`,shade(c,30))+r(0,h*.73,w-5,7,shade(c,-12))+r(14,h*.63-8,5,12,ink)+r(w-32,h*.67,7,7,'#e5b574')+r(w*.3,h-22,w*.3,5,ink);
  }else if(m.kind==='window'){
    out=r(8,8,w-8,h-8,shade(wood,-35))+r(0,0,w-10,h-18,'#c2dfe4',wood)+r(8,8,w*.4,h*.42,'#e5f0e8')+r(w*.48,0,8,h-18,'#f9f3e1')+r(0,h*.48,w-10,8,'#f9f3e1')+poly(`0,${h-22} ${w-10},${h-22} ${w},${h-12} 0,${h-12}`,shade(wood,30))+r(0,h-12,w,8,wood);
  }else if(m.kind==='wall'){
    out=r(0,0,w,h,p.wall,ink)+r(0,h-12,w,12,wood);
    for(let y=16;y<h-16;y+=20)out+=r(8,y,w-16,2,'#a9bfad');
  }else{
    out=r(w*.48,16,5,h-16,ink)+r(w*.2,0,w*.6,24,'#e7c97f',ink)+r(w*.3,h-8,w*.4,8,ink);
  }
  return out;
}
export function sceneModuleLayers(input){
  const s=resolveProjectScene(input),p=Object.fromEntries(Object.entries(defaultProjectScene.palette).map(([k,v])=>[k,hex(s.palette[k],v)]));
  return [...floorPlanLayers(s),...s.modules.map(m=>({id:m.id,x:m.x/s.columns*100,y:m.y/s.rows*100,width:m.width/s.columns*100,height:m.height/s.rows*100,depth:m.kind==='rug'||m.walkThrough?1:Math.round((m.y+m.height)/s.rows*1000),svg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${m.width*40} ${m.height*40}" shape-rendering="crispEdges">${moduleArt(m,p)}</svg>`}))];
}
export function renderProjectWall(input){
  const s=resolveProjectScene(input),p=Object.fromEntries(Object.entries(defaultProjectScene.palette).map(([k,v])=>[k,hex(s.palette[k],v)]));
  const w=1600,h=320;
  let art=rect(0,0,w,h,p.wall)+rect(0,0,w,20,'#a7baa9')+rect(0,h-16,w,16,p.wood);
  for(let x=0;x<w;x+=80)art+=rect(x,24,2,h-45,'#c4d5c6');
  for(const x of [w*.17,w*.5,w*.83])art+=rect(x-20,28,40,8,'#797583')+rect(x-28,36,56,12,'#f9edcc')+rect(x-20,48,40,4,'#c8b581');
  art+=rect(0,20,16,h-20,shade(p.wall,-28))+rect(16,20,8,h-20,shade(p.wall,9))+rect(w-20,20,20,h-20,shade(p.wall,-38));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" shape-rendering="crispEdges">${art}</svg>`;
}
export function renderProjectScene(input, {modules=true,boards=true,guides=false}={}){
  const s=resolveProjectScene(input),w=s.columns*40,h=s.rows*40,wallHeight=s.floorPlan?s.floorPlan.wallRows*40:Math.round(h*.32/40)*40;
  const p=Object.fromEntries(Object.entries(defaultProjectScene.palette).map(([k,v])=>[k,hex(s.palette[k],v)]));
  let art=rect(0,0,w,h,p.floor)+rect(0,0,w,wallHeight,p.wall)+rect(0,0,w,20,'#a7baa9')+rect(0,wallHeight-16,w,16,p.wood)+rect(0,wallHeight,w,8,'#8b7866');
  for(let y=wallHeight+8;y<h;y+=40)for(let x=0;x<w;x+=40){const tile=(x/40+Math.floor(y/40))%2?p.floor:p.tile;art+=rect(x,y,40,40,tile)+rect(x+2,y+2,36,2,shade(tile,10))+rect(x+2,y+2,2,36,shade(tile,10))+rect(x,y+38,40,2,shade(tile,-15))+rect(x+38,y,2,40,shade(tile,-15));}
  // Wall thickness, skirting and stepped contact shadows make a small cutaway diorama.
  art+=rect(0,wallHeight+8,w,8,'#62534622')+rect(0,wallHeight+16,w,6,'#62534610');
  art+=rect(0,20,16,h-20,shade(p.wall,-28))+rect(16,20,8,h-20,shade(p.wall,9))+rect(w-20,20,20,h-20,shade(p.wall,-38));
  art+=rect(0,h-16,w,16,shade(p.wood,-25))+rect(24,h-20,w-44,4,shade(p.wood,24));
  for(let x=0;x<w;x+=80)art+=rect(x,24,2,wallHeight-45,'#c4d5c6');
  for(const x of [w*.17,w*.5,w*.83])art+=rect(x-20,28,40,8,'#797583')+rect(x-28,36,56,12,'#f9edcc')+rect(x-20,48,40,4,'#c8b581');
  if(boards)for(const [key,b] of Object.entries(s.boards)){
    const x=b.x*w/100,y=b.y*h/100,bw=b.width*w/100,bh=b.height*h/100;
    art+=rect(x+10,y+12,bw,bh,'#433d5625')+rect(x+5,y+5,bw,bh,shade(p.wood,-30))+rect(x,y,bw,bh,p.wood)+rect(x+4,y+4,bw-8,4,shade(p.wood,35))+rect(x+8,y+8,bw-16,bh-16,key==='announcement'?'#f3ddb7':'#fffcf4');
    art+=`<text x="${x+22}" y="${y+40}" fill="#525266" font-family="sans-serif" font-size="20" font-weight="700">${escape({announcement:'NOTICE',canvas:'WHITEBOARD',skills:'SKILLS'}[key]||key)}</text>`;
    for(let i=0;i<3;i++)art+=rect(x+22,y+62+i*28,bw*.7-i*12,6,'#c9c2b7');
  }
  if(modules){
    for(const m of sceneModuleLayers(s).sort((a,b)=>a.depth-b.depth))art+=`<svg x="${m.x*w/100}" y="${m.y*h/100}" width="${m.width*w/100}" height="${m.height*h/100}">${m.svg}</svg>`;
    if(guides&&s.floorPlan)for(const [i,d]of s.deviceZones.entries()){
      const x=d.x*w/100-136,y=d.y*h/100-132;
      art+=`<rect x="${x}" y="${y}" width="272" height="220" rx="14" fill="#f8faf240" stroke="#8caa9888" stroke-width="3" stroke-dasharray="10 8"/><text x="${x+136}" y="${y+115}" text-anchor="middle" fill="#778f80" font-family="sans-serif" font-size="20">预留工位 ${i+1}</text>`;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges"><title>${escape(s.name)}</title>${art}</svg>`;
}
export const sceneDataUrl = input => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderProjectScene(input))}`;
