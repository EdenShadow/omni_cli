import '../office-characters/office-character.js';
import {createLayout,walkable,findPath,workPoint,cloneIdentity,tidyOfficeStore} from './layout.js';
import {renderWorld} from './world.js';
import {PROP_TYPES,propValid,canPlace,renderProps,reflowProps} from './props.js';

const $=s=>document.querySelector(s);
const scene=$('#scene'), content=$('#panel-content');
const actors=new Map(),moves=new Map(),positions=new Map(),seated=new Map();
const effects=new Map(),propBusy=new Map(),propCooldown=new Map(),propInside=new Map();let placement=null,selectedProp=null;
const motion=matchMedia('(prefers-reduced-motion: reduce)');
const stateNames={idle:'歇一会儿',working:'认真工作',done:'开心庆祝',sitting:'坐着玩耍',tired:'有点困了','walk-left':'走动中','walk-right':'走动中'};
let layout,artDocument,roleCatalog,activeMemberId,zoom=.85,depthFrame=0;
let config,store,key,selectedPanel='overview',selectedMember=null,paused=false,reduced=false,storageWarning=false;
const uid=()=>crypto.randomUUID();
const clamp=(n,a,b)=>Math.min(b,Math.max(a,Number(n)||0));
function el(tag,classes,text){const n=document.createElement(tag);if(classes)n.className=classes;if(text!==undefined)n.textContent=text;return n;}
function button(text,action,classes='small-button'){const n=el('button',classes,text);n.type='button';n.onclick=action;return n;}
function status(text){$('#save-status').textContent=text;}
function persist(snapshot=true){if(snapshot)for(const m of store.members){if(actors.has(m.id)){m.home=currentPoint(m.id);m.state=moves.get(m.id)?.state||actors.get(m.id).character.currentState||'idle';}}refreshBoardPreviews();try{localStorage.setItem(key,JSON.stringify(store));storageWarning=false;status('已保存到本机');}catch{storageWarning=true;status('浏览器未能保存，请导出办公室备份。');}}
function isRecord(v){return v&&typeof v==='object'&&!Array.isArray(v);}
function loadStore(){
 const initial={version:1,settings:{name:config.name,brief:config.brief,palette:{...config.palette}},announcements:structuredClone(config.announcements),notes:structuredClone(config.notes),skills:structuredClone(config.skills),devices:structuredClone(config.devices),members:structuredClone(config.members),assignments:Object.fromEntries(config.members.map((m,i)=>[m.id,{deviceId:config.devices[i%config.devices.length].id,slot:0}])),seats:{},presentationVersion:2,props:structuredClone(config.props||[]),propStorage:structuredClone(config.propStorage||[]),cleanLayoutVersion:1};
 const shift=createLayout(initial.devices).playY-600;initial.props.forEach(p=>{p.y+=shift;if(p.endY)p.endY+=shift;});
 try{
  const raw=localStorage.getItem(key);if(!raw)return initial;
  const saved=JSON.parse(raw);
  const valid=saved.version===1&&isRecord(saved.settings)&&typeof saved.settings.name==='string'&&typeof saved.settings.brief==='string'&&isRecord(saved.settings.palette)&&['wall','floor','accent'].every(k=>/^#[0-9a-f]{6}$/i.test(saved.settings.palette[k]))&&['announcements','notes','skills'].every(k=>Array.isArray(saved[k])&&saved[k].every(n=>isRecord(n)&&typeof n.id==='string'))&&saved.announcements.every(n=>['title','body','tag','date'].every(k=>typeof n[k]==='string'))&&saved.notes.every(n=>typeof n.text==='string'&&Number.isFinite(n.x)&&Number.isFinite(n.y)&&['green','yellow','pink'].includes(n.color))&&saved.skills.every(n=>['name','command','description','prompt'].every(k=>typeof n[k]==='string'));
  if(!valid)throw Error('Saved data schema mismatch');
  if(!Array.isArray(saved.devices)||!saved.devices.length||!saved.devices.every(d=>typeof d.id==='string'&&typeof d.name==='string'))saved.devices=initial.devices;
  if(!Array.isArray(saved.members)||!saved.members.length||!saved.members.every(m=>typeof m.id==='string'&&typeof m.name==='string'&&typeof m.src==='string'&&Number.isFinite(m.width)&&Number.isFinite(m.ratio)&&m.ratio>0&&Number.isFinite(m.anchor)))saved.members=initial.members;
  if(!isRecord(saved.assignments))saved.assignments={};if(!isRecord(saved.seats))saved.seats={};
  if(saved.presentationVersion!==2){saved.members.forEach(m=>m.width=Math.round(m.width*1.85));saved.presentationVersion=2;}
  if(!Array.isArray(saved.props)) {saved.props=structuredClone(config.props||[]);const shift=createLayout(saved.devices).playY-600;saved.props.forEach(p=>{p.y+=shift;if(p.endY)p.endY+=shift;});}
  saved.props=saved.props.filter(propValid);return tidyOfficeStore(saved);
 }catch{storageWarning=true;status('旧存档未能读取，原数据未删除；当前显示初始布置。');return initial;}
}
function applySettings(){
 $('#office-name').textContent=store.settings.name;document.title=store.settings.name+' · 小小同事';$('#office-brief').textContent=store.settings.brief;
 for(const [k,v] of Object.entries(store.settings.palette))if(/^#[0-9a-f]{6}$/i.test(v))scene.style.setProperty('--'+k,v);
 document.documentElement.style.setProperty('--accent',store.settings.palette.accent);
}
function stopMotion(){return paused||document.hidden;}
function syncPlayback(){for(const {character} of actors.values()){character.toggleAttribute('paused',stopMotion());character.toggleAttribute('reduced-motion',reduced);}for(const {animation} of moves.values())stopMotion()?animation.pause():animation.play();for(const list of effects.values())for(const a of list.animations)stopMotion()?a.pause():a.play();startDepthLoop();}
function updateDepth(id){const a=actors.get(id);if(a)a.node.style.zIndex=String(100+Math.round((seated.get(id)?.depth??a.node.offsetTop/scene.clientHeight*layout.height)*1000)+(config.members.findIndex(m=>m.id===id)%999)+1);}
function startDepthLoop(){if(depthFrame||!moves.size||stopMotion())return;depthFrame=requestAnimationFrame(()=>{depthFrame=0;for(const [id,r] of moves){updateDepth(id);if(r.ride){if(r.propNode)r.propNode.style.zIndex=actors.get(id).node.style.zIndex;continue;}if(checkProps(id))continue;const progress=Number(r.animation.currentTime||0)/r.duration;let i=r.frames.findIndex(f=>f.offset>progress)-1;if(i<0)i=0;i=Math.min(i,r.path.length-2);const dx=r.path[i+1][0]-r.path[i][0];if(Math.abs(dx)>1){const next=dx<0?'walk-left':'walk-right';const c=actors.get(id).character;if(c.currentState!==next)c.setState(next);}}startDepthLoop();});}
function settleMove(id,record){if(moves.get(id)!==record)return;const actor=actors.get(id);actor.node.style.left=record.point[0]/layout.width*100+'%';actor.node.style.top=record.point[1]/layout.height*100+'%';record.animation.onfinish=null;record.animation.cancel();moves.delete(id);positions.set(id,record.point);updateDepth(id);finishPose(id,record.state,record.seat);if(record.ride){stopEffects(id);propCooldown.set(id,performance.now()+1800);}else checkProps(id);persist();}
function currentPoint(id){const a=actors.get(id);return [a.node.offsetLeft/scene.clientWidth*layout.width,a.node.offsetTop/scene.clientHeight*layout.height];}
function safePoint(id){const p=currentPoint(id);if(walkable(p,layout))return p;for(let r=10;r<250;r+=10)for(let i=0;i<16;i++){const angle=i*Math.PI/8,point=[p[0]+Math.cos(angle)*r,p[1]+Math.sin(angle)*r];if(walkable(point,layout))return point;}return positions.get(id)||p;}
function stopMember(id){stopEffects(id);const old=moves.get(id);const current=old?.ride?safePoint(id):currentPoint(id);if(old){old.animation.onfinish=null;old.animation.cancel();moves.delete(id);}const n=actors.get(id).node;n.style.left=current[0]/layout.width*100+'%';n.style.top=current[1]/layout.height*100+'%';positions.set(id,current);updateDepth(id);return current;}
function moveMember(id,point,state,seat=null){
 const actor=actors.get(id);if(!actor)return false;const from=moves.get(id)?.ride?safePoint(id):currentPoint(id);const underfoot=store.props.find(p=>Math.hypot(from[0]-p.x,from[1]-p.y)<21);if(underfoot)propInside.set(id,underfoot.id);const path=findPath(from,point,layout);if(!path){status('这条路暂时走不通，请选择其他电脑或区域。');return false;}stopMember(id);undock(id);if(!seat){delete store.seats[id];refreshSeats();}
 if(reduced||motion.matches||Math.hypot(point[0]-from[0],point[1]-from[1])<8){actor.node.style.left=point[0]/layout.width*100+'%';actor.node.style.top=point[1]/layout.height*100+'%';positions.set(id,point);updateDepth(id);finishPose(id,state,seat);checkProps(id);return true;}
 const lengths=[0];for(let i=1;i<path.length;i++)lengths.push(lengths[i-1]+Math.hypot(path[i][0]-path[i-1][0],path[i][1]-path[i-1][1]));const total=lengths.at(-1);const frames=path.map((v,i)=>({left:v[0]/layout.width*100+'%',top:v[1]/layout.height*100+'%',offset:total?lengths[i]/total:1}));
 actor.character.setState(point[0]<from[0]?'walk-left':'walk-right');const duration=Math.max(450,Math.min(15000,total*7));const animation=actor.node.animate(frames,{duration,easing:'linear',fill:'forwards'});const record={animation,point,state,seat,path,frames,duration};moves.set(id,record);animation.onfinish=()=>settleMove(id,record);if(stopMotion())animation.pause();startDepthLoop();return true;
}
function undock(id){const m=config.members.find(m=>m.id===id);seated.delete(id);actors.get(id).node.style.setProperty('--anchor',(-m.anchor*100)+'%');actors.get(id).node.removeAttribute('data-seated');}
function finishPose(id,state,seat){const actor=actors.get(id);if(seat&&store.seats[id]===seat.id){const m=config.members.find(m=>m.id===id),hip=actor.character.data?.seating?.hipAnchor??m.anchor-.08;seated.set(id,seat);actor.node.dataset.seated=seat.id;actor.node.style.setProperty('--anchor',(-hip*100-(seat.approach[1]-seat.surface)/(m.width/m.ratio)*100)+'%');}updateDepth(id);actor.character.setState(state);}
function refreshSeats(){document.querySelectorAll('[data-seat]').forEach(n=>{const owner=Object.entries(store.seats).find(([,seat])=>seat===n.dataset.seat)?.[0];n.setAttribute('aria-pressed',String(owner===activeMemberId));n.classList.toggle('occupied',!!owner);n.querySelector('.seat-label').textContent=owner?config.members.find(m=>m.id===owner)?.name||'已有人':'坐这里';});}
function assignSeat(seatId,id=activeMemberId){const seat=layout.seats.find(s=>s.id===seatId);if(!seat||!id)return false;const owner=Object.entries(store.seats).find(([member,target])=>member!==id&&target===seatId);if(owner){status('这个座位已经有同事了，换一个空位吧。');return false;}const old=store.seats[id];store.seats[id]=seatId;if(!moveMember(id,seat.approach,'sitting',seat)){if(old)store.seats[id]=old;else delete store.seats[id];return false;}delete store.assignments[id];refreshOccupancy();refreshSeats();persist();$('#scene-summary').textContent=config.members.find(m=>m.id===id).name+'去'+seat.label+'坐下玩一会儿。';return true;}
function nearestSeat(id,kind){const from=currentPoint(id);return layout.seats.filter(s=>(!kind||s.kind===kind)&&!Object.entries(store.seats).some(([m,v])=>m!==id&&v===s.id)).sort((a,b)=>Math.hypot(a.approach[0]-from[0],a.approach[1]-from[1])-Math.hypot(b.approach[0]-from[0],b.approach[1]-from[1]))[0];}
function memberState(id,state){if(state==='sitting'){const seat=nearestSeat(id);if(seat)assignSeat(seat.id,id);else status('沙发暂时坐满了，可以去旁边的书架和街机休息。');return;}stopMember(id);undock(id);delete store.seats[id];updateDepth(id);refreshSeats();actors.get(id).character.setState(state);if(state!=='working')release(id);persist();}
function occupants(id){return Object.entries(store.assignments).filter(([member,a])=>actors.has(member)&&a.deviceId===id);}
function refreshOccupancy(){refreshSeats();document.querySelectorAll('[data-capacity]').forEach(n=>{const d=layout.computers.find(d=>d.id===n.dataset.capacity);n.textContent=occupants(d.id).length+' 人协作';});document.querySelectorAll('[data-device-entry]').forEach(n=>{const d=layout.computers.find(d=>d.id===n.dataset.deviceEntry);if(d)n.textContent=d.name+' · '+occupants(d.id).length+' 人 · 不限人数';});document.querySelectorAll('[data-device]').forEach(n=>n.setAttribute('aria-pressed',String(store.assignments[activeMemberId]?.deviceId===n.dataset.device)));}
function release(id){delete store.assignments[id];refreshOccupancy();}
function assignDevice(deviceId,id=activeMemberId){
 const d=layout.computers.find(d=>d.id===deviceId);if(!d||!id)return false;
 const old=store.assignments[id],busy=actors.get(id).character.currentState==='working'||moves.get(id)?.state==='working';
 const shouldClone=old&&old.deviceId!==deviceId&&busy;
 const slot=old?.deviceId===deviceId?old.slot:occupants(deviceId).length,point=workPoint(d,slot,layout);
 if(!point||!findPath(currentPoint(id),point,layout)){status('电脑附近暂时走不通，请移开挡路的道具。');return false;}
 if(shouldClone){const source=store.members.find(m=>m.id===id);const clone=cloneIdentity(source,store.members,uid());clone.home=currentPoint(id);store.members.push(clone);config.members=store.members;initActors([clone]);id=clone.id;activeMemberId=id;selectedMember=id;}
 if(!moveMember(id,point,'working'))return false;
 store.assignments[id]={deviceId,slot};actors.forEach((a,m)=>a.node.setAttribute('aria-pressed',String(m===activeMemberId)));refreshOccupancy();persist();updateStats();renderPanel();
 $('#scene-summary').textContent=shouldClone?'分身出发！本体继续工作，彩色光圈和编号帮你区分它们。':store.members.find(m=>m.id===id).name+'前往'+d.name+'，这里不限制人数。';return true;
}
function randomDestination(id){const from=currentPoint(id);for(let i=0;i<45;i++){const angle=Math.random()*Math.PI*2,range=65+Math.random()*180;const p=[from[0]+Math.cos(angle)*range,from[1]+Math.sin(angle)*range];if(walkable(p,layout)&&findPath(from,p,layout))return p;}return from;}
function wander(id){release(id);moveMember(id,randomDestination(id),'idle');persist();$('#scene-summary').textContent=config.members.find(m=>m.id===id).name+'正在办公室里走走。';}
function sendTo(zoneId,only){if(zoneId==='play')zoneId='lounge';const ids=only?[only]:config.members.map(m=>m.id);if(zoneId==='lounge'){for(const id of ids){const seat=nearestSeat(id,'sofa');if(seat)assignSeat(seat.id,id);else {const zone=layout.zones.find(z=>z.id==='lounge');const point=zone.spots[ids.indexOf(id)%zone.spots.length];if(moveMember(id,point,'idle'))release(id);}}persist();return;}if(zoneId==='work'){for(const id of ids){const preferred=store.assignments[id]?.deviceId;const available=layout.computers.find(d=>d.id===preferred)||layout.computers[0];if(available)assignDevice(available.id,id);}return;}
 const zone=layout.zones.find(z=>z.id===zoneId);if(!zone?.spots)return;ids.forEach((id,i)=>{const base=zone.spots[i%zone.spots.length];const point=[base[0]+Math.floor(i/zone.spots.length)*15,base[1]+Math.floor(i/zone.spots.length)*20];if(moveMember(id,point,zone.state||'idle'))release(id);});persist();$('#scene-summary').textContent=(only?config.members.find(m=>m.id===only).name:'小同事们')+'去'+zone.label+'了。';}
function applyZoom(){scene.style.setProperty('--world-scale',zoom);scene.style.width=layout.width*zoom+'px';scene.style.height=layout.height*zoom+'px';$('#zoom-label').textContent=Math.round(zoom*100)+'%';actors.forEach((_,id)=>updateDepth(id));}
function fallbackPoint(index){for(let y=layout.height-80;y>285;y-=35)for(let x=90+(index%5)*35;x<layout.width-65;x+=150)if(walkable([x,y],layout))return [x,y];return [90,300];}
function updateStats(){$('#map-stats').textContent=store.devices.length+' 台电脑 · '+store.members.length+' 位同事 / 分身 · '+store.props.length+' 件道具';}
function rebuildWorld(){
 const previous=new Map([...actors].map(([id,a])=>[id,{point:currentPoint(id),state:moves.get(id)?.state||a.character.currentState}]));
 for(const id of [...effects.keys()])stopEffects(id);
 for(const r of moves.values()){r.animation.onfinish=null;r.animation.cancel();}moves.clear();cancelAnimationFrame(depthFrame);depthFrame=0;actors.clear();positions.clear();seated.clear();$('#actors').replaceChildren();
 layout=createLayout(store.devices,store.props);config.viewBox=[0,0,layout.width,layout.height];config.zones=layout.zones;config.members=store.members;
 const validSeats={};for(const m of config.members){const seat=layout.seats.find(s=>s.id===store.seats[m.id]);if(seat&&!Object.values(validSeats).includes(seat.id))validSeats[m.id]=seat.id;}store.seats=validSeats;
 const assigned={};config.members.forEach((m,i)=>{
  if(store.seats[m.id]){m.home=layout.seats.find(s=>s.id===store.seats[m.id]).approach;return;}
  const old=store.assignments[m.id],d=layout.computers.find(d=>d.id===old?.deviceId);
  if(d){const slot=Number.isInteger(old.slot)&&old.slot>=0?old.slot:i;const point=workPoint(d,slot,layout);if(point){assigned[m.id]={deviceId:d.id,slot};m.home=point;return;}}
  const oldPoint=previous.get(m.id)?.point||m.home;m.home=oldPoint&&walkable(oldPoint,layout)?oldPoint:fallbackPoint(i);m.state=previous.get(m.id)?.state||m.state||'idle';if(m.state.startsWith('walk'))m.state='idle';
 });store.assignments=assigned;
 renderWorld(layout,artDocument,scene,id=>assignDevice(id),id=>{selectedMember=null;selectPanel(id);},id=>assignSeat(id));
 renderProps(layout,$('#props'),onPropClick);applyZoom();initActors();syncPlayback();refreshOccupancy();refreshBoardPreviews();updateStats();renderPanel();
}

function initActors(members=config.members){
 for(const m of members){const node=el('button','actor');node.type='button';node.setAttribute('aria-label','让'+m.name+'走走');node.setAttribute('aria-pressed',String(m.id===activeMemberId));node.style.left=m.home[0]/layout.width*100+'%';node.style.top=m.home[1]/layout.height*100+'%';node.style.width=m.width/layout.width*100+'%';node.dataset.memberId=m.id;if(m.cloneNumber){node.dataset.clone=String(m.cloneNumber);node.style.setProperty('--clone-color',m.cloneColor);node.append(el('span','clone-halo'));node.append(el('span','clone-badge','✦ '+m.cloneNumber));}node.style.setProperty('--foot',m.anchor*100+'%');node.style.setProperty('--ratio',String(m.ratio));node.style.setProperty('--anchor',(-m.anchor*100)+'%');const character=document.createElement('office-character');character.setAttribute('src',m.src);character.setAttribute('state',store.seats[m.id]?'sitting':store.assignments[m.id]?'working':m.state||'idle');character.setAttribute('seed',String(m.seed));node.append(character,el('span','actor-name',m.name));node.onclick=()=>{activeMemberId=m.id;selectedMember=m.id;wander(m.id);selectPanel('overview');};actors.set(m.id,{node,character});positions.set(m.id,m.home);$('#actors').append(node);updateDepth(m.id);
 character.addEventListener('characterready',()=>{const seat=layout.seats.find(s=>s.id===store.seats[m.id]);if(seat&&!moves.has(m.id)){finishPose(m.id,'sitting',seat);syncPlayback();}});
 character.addEventListener('characterstatechange',e=>{document.querySelectorAll('.member-status').forEach(n=>{if(n.dataset.member===m.id)n.textContent=stateNames[e.detail.state]||'准备中';});});character.addEventListener('charactererror',e=>status(m.name+'加载失败：'+e.detail.message));}
}
function selectPanel(name){selectedPanel=name;document.querySelectorAll('[data-panel]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.panel===name||(name==='work'||name==='play'||name==='lounge')&&b.dataset.panel==='overview')));document.querySelectorAll('[data-zone]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.zone===name)));actors.forEach((a,id)=>a.node.setAttribute('aria-pressed',String(id===activeMemberId)));renderPanel();}
function intro(title,desc){content.append(el('h2','',title),el('p','panel-intro',desc));}
function roster(){const list=el('div','roster-list');for(const m of config.members){const b=button('',()=>{selectedMember=m.id;activeMemberId=m.id;refreshOccupancy();refreshSeats();selectPanel('overview');},'colleague');const img=el('img','portrait');img.src=new URL('character.svg',new URL(m.src,location.href)).href;img.alt='';const copy=el('span');copy.append(el('strong','',m.name),el('small','',m.job));const s=el('span','member-status',stateNames[actors.get(m.id).character.currentState]||'准备中');s.dataset.member=m.id;b.append(img,copy,s);list.append(b);}return list;}
function renderOverview(){
 if(selectedMember){const m=config.members.find(m=>m.id===selectedMember);content.append(button('‹ 全部同事',()=>{selectedMember=null;renderPanel();},'text-button'));const hero=el('div','member-hero');const img=el('img');img.src=new URL('character.svg',new URL(m.src,location.href)).href;img.alt=m.name;hero.append(img);content.append(hero);intro(m.name,m.job+' · 已选中。点击地图上的电脑，就会走到它前面。');const grid=el('div','action-grid');for(const z of config.zones.filter(z=>z.spots))grid.append(button('去'+z.label,()=>sendTo(z.id,m.id),''));grid.append(button('找个座位坐下',()=>memberState(m.id,'sitting'),''),button('四处走走',()=>wander(m.id),''),button('开心庆祝',()=>memberState(m.id,'done'),''),button('发一会儿呆',()=>memberState(m.id,'idle'),''),button('打个小盹',()=>memberState(m.id,'tired'),''));content.append(grid);const devices=el('div','device-list');for(const d of layout.computers){const entry=button(d.name+' · '+occupants(d.id).length+' 人 · 不限人数',()=>assignDevice(d.id,m.id),'device-entry');entry.dataset.deviceEntry=d.id;devices.append(entry);}content.append(el('p','tiny-label','选一台电脑，和同事一起工作'),devices);const seats=el('div','device-list');for(const seat of layout.seats)seats.append(button('坐下 · '+seat.label,()=>assignSeat(seat.id,m.id),'device-entry'));content.append(el('p','tiny-label','选个座位，玩一会儿'),seats);return;}
 const zone=config.zones.find(z=>z.id===selectedPanel&&z.spots);
 intro(zone?zone.label:'今天，一起做点什么',zone?zone.description:config.members.length+' 位小同事，'+store.devices.length+' 台电脑。选中同事后点击电脑；直接点人物，让它走走。');
 if(zone)content.append(button('带大家去'+zone.label,()=>sendTo(zone.id),'primary'));
 content.append(el('div','tiny-label','在办公室的同事'),roster(),el('p','room-note','桌子留给专注，沙发留给发呆。\n点击墙上的看板，把消息、点子和拿手技能放进办公室。'));
}
function field(form,labelText,name,kind='input',value='',max=160){const label=el('label','',labelText);const input=el(kind);input.name=name;input.value=value;input.required=true;input.maxLength=max;if(kind==='textarea')input.rows=3;label.append(input);form.append(label);return input;}
function heading(title,action){const row=el('div','board-heading');row.append(el('h2','',title),action);content.append(row);}
function renderAnnouncements(){heading('公告看板',button('+ 写公告',()=>editNotice()));content.append(el('p','panel-intro','小消息、小约定，贴出来就不会忘记。'));const list=el('div');for(const n of store.announcements){const article=el('article','notice');article.append(el('span','notice-tag',n.tag+' · '+n.date),el('h3','',n.title),el('p','',n.body),button('编辑这张公告',()=>editNotice(n.id),'text-button'));list.append(article);}if(!store.announcements.length)list.append(el('p','empty','还没有公告，写下今天的第一条消息吧。'));content.append(list,el('div','inline-editor'));}
function editNotice(id){const old=store.announcements.find(n=>n.id===id);const host=content.querySelector('.inline-editor');host.replaceChildren();const form=el('form','inline-form');const title=field(form,'公告标题','title','input',old?.title||'',60);field(form,'公告内容','body','textarea',old?.body||'',1000);field(form,'分类','tag','input',old?.tag||'小消息',12);const row=el('div','form-row');const save=el('button','primary','保存公告');save.type='submit';row.append(save,button('取消',()=>host.replaceChildren(),'text-button'));if(old)row.append(button('删除',()=>{store.announcements=store.announcements.filter(n=>n.id!==id);persist();renderPanel();},'danger-button'));form.append(row);form.onsubmit=e=>{e.preventDefault();const fd=new FormData(form);const item={id:id||uid(),title:String(fd.get('title')).trim(),body:String(fd.get('body')).trim(),tag:String(fd.get('tag')).trim(),date:old?.date&&old.date!=='示例公告'?old.date:new Date().toLocaleDateString('zh-CN')};if(!item.title||!item.body||!item.tag)return;const i=store.announcements.findIndex(n=>n.id===id);if(i>=0)store.announcements[i]=item;else store.announcements.unshift(item);persist();renderPanel();};host.append(form);title.focus();}
function renderCanvas(){heading('画布看板',button('+ 贴便签',()=>{const n={id:uid(),text:'一个新的点子',x:20+(store.notes.length%3)*12,y:15+(store.notes.length%4)*14,color:'yellow'};store.notes.push(n);persist();renderPanel();editNote(n.id);}));content.append(el('p','panel-intro','把散落的灵感摆在一起，拖一拖，就有了新的关系。'));
 const board=el('div','canvas-board');board.setAttribute('aria-label','可拖动的灵感画布');
 for(const n of store.notes){const note=el('button','sticky',n.text);note.type='button';note.dataset.color=n.color;note.dataset.note=n.id;note.style.left=clamp(n.x,0,58)+'%';note.style.top=clamp(n.y,0,75)+'%';note.setAttribute('aria-label','编辑便签：'+n.text);note.setAttribute('aria-pressed','false');
  let drag=null,suppressClick=false;
  note.onclick=()=>{if(!suppressClick)editNote(n.id);suppressClick=false;};
  note.onpointerdown=e=>{if(e.button!==0)return;drag={x:e.clientX,y:e.clientY,left:n.x,top:n.y};note.setPointerCapture(e.pointerId);};
  note.onpointermove=e=>{if(!drag)return;const dx=(e.clientX-drag.x)/board.clientWidth*100,dy=(e.clientY-drag.y)/board.clientHeight*100;n.x=clamp(drag.left+dx,0,58);n.y=clamp(drag.top+dy,0,Math.max(0,(board.clientHeight-note.offsetHeight)/board.clientHeight*100));note.style.left=n.x+'%';note.style.top=n.y+'%';if(Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>4)suppressClick=true;};
  note.onpointerup=()=>{if(drag&&suppressClick)persist();drag=null;};note.onpointercancel=()=>{if(drag){n.x=drag.left;n.y=drag.top;note.style.left=n.x+'%';note.style.top=n.y+'%';}drag=null;suppressClick=false;};
  note.onkeydown=e=>{const delta={ArrowLeft:[-2,0],ArrowRight:[2,0],ArrowUp:[0,-2],ArrowDown:[0,2]}[e.key];if(!delta)return;e.preventDefault();n.x=clamp(n.x+delta[0],0,58);n.y=clamp(n.y+delta[1],0,Math.max(0,(board.clientHeight-note.offsetHeight)/board.clientHeight*100));note.style.left=n.x+'%';note.style.top=n.y+'%';persist();};board.append(note);
 }
 content.append(board,el('p','form-help','拖动摆放 · 点击编辑 · 键盘方向键移动'),el('div','note-editor'));
}
function editNote(id){const n=store.notes.find(n=>n.id===id);if(!n)return;const host=content.querySelector('.note-editor');host.replaceChildren();content.querySelectorAll('.sticky').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.note===id)));const form=el('form','inline-form');const text=field(form,'这张便签写什么？','text','textarea',n.text,140);const label=el('label','','便签颜色');const select=el('select');select.name='color';for(const [v,l] of [['yellow','奶油黄'],['green','嫩芽绿'],['pink','蜜桃粉']]){const option=el('option','',l);option.value=v;select.append(option);}select.value=n.color;label.append(select);form.append(label);const row=el('div','form-row');const save=el('button','primary','保存便签');save.type='submit';row.append(save,button('移除便签',()=>{store.notes=store.notes.filter(x=>x.id!==id);persist();renderPanel();},'danger-button'));form.append(row);form.onsubmit=e=>{e.preventDefault();if(!text.value.trim())return;n.text=text.value.trim();n.color=select.value;persist();renderPanel();};host.append(form);text.focus();}
function renderSkills(){heading('Skills 看板',button('+ 登记技能',()=>editSkill()));content.append(el('p','panel-intro','把团队擅长的事放在这里，带着调用词去找你的 AI 同事。'));const label=el('label','skill-search','查找技能');const search=el('input');search.type='search';search.placeholder='名称、用途或命令';label.append(search);content.append(label);const list=el('div');const paint=()=>{list.replaceChildren();const q=search.value.toLowerCase();const items=store.skills.filter(s=>(s.name+s.description+s.command).toLowerCase().includes(q));for(const s of items){const card=el('article','skill-card');card.append(el('h3','',s.name),el('span','skill-command','/'+s.command),el('p','',s.description));const details=el('details');details.append(el('summary','','查看调用词'),el('div','skill-prompt',s.prompt));card.append(details);const row=el('div','form-row');row.append(button('复制调用词',async()=>{try{await navigator.clipboard.writeText(s.prompt);status('已复制「'+s.name+'」调用词');}catch{details.open=true;status('未获得剪贴板权限，请从展开的调用词中手动复制。');}},'copy-button'),button('编辑',()=>editSkill(s.id),'text-button'));card.append(row);list.append(card);}if(!items.length)list.append(el('p','empty','没有匹配的技能，换个关键词试试。'));};search.oninput=paint;paint();content.append(list,el('div','skill-editor'));}
function editSkill(id){const s=store.skills.find(s=>s.id===id);const host=content.querySelector('.skill-editor');host.replaceChildren();const form=el('form','inline-form');const name=field(form,'技能名称','name','input',s?.name||'',50);const command=field(form,'调用名称（不带斜杠）','command','input',s?.command||'',64);command.pattern='[a-z0-9-]+';field(form,'能做什么','description','textarea',s?.description||'',300);field(form,'调用词','prompt','textarea',s?.prompt||'',2000);const row=el('div','form-row');const save=el('button','primary','保存技能');save.type='submit';row.append(save,button('取消',()=>host.replaceChildren(),'text-button'));if(s)row.append(button('移除',()=>{store.skills=store.skills.filter(x=>x.id!==id);persist();renderPanel();},'danger-button'));form.append(row);form.onsubmit=e=>{e.preventDefault();const fd=new FormData(form);const item={id:id||uid(),name:String(fd.get('name')).trim(),command:String(fd.get('command')).trim(),description:String(fd.get('description')).trim(),prompt:String(fd.get('prompt')).trim()};if(!item.name||!item.description||!item.prompt)return;const i=store.skills.findIndex(x=>x.id===id);if(i>=0)store.skills[i]=item;else store.skills.push(item);persist();renderPanel();};host.append(form);name.focus();}
function renderPanel(){content.replaceChildren();if(selectedPanel==='announcements')renderAnnouncements();else if(selectedPanel==='canvas')renderCanvas();else if(selectedPanel==='skills')renderSkills();else if(selectedPanel==='diy')renderDIY();else renderOverview();}
function refreshBoardPreviews(){
 if(!store)return;
 for(const kind of ['announcements','canvas','skills']){
  const board=document.querySelector(`.map-zone[data-zone="${kind}"]`);if(!board)continue;
  let body=board.querySelector('.board-preview');if(!body){body=el('div','board-preview '+kind);board.append(body);}body.replaceChildren();
  if(kind==='announcements')for(const n of store.announcements.slice(0,2)){const card=el('article');card.append(el('small','',n.tag),el('strong','',n.title),el('p','',n.body));body.append(card);}
  if(kind==='canvas')for(const n of store.notes.slice(0,5)){const note=el('div','mini-note',n.text);note.dataset.color=n.color;note.style.left=clamp(n.x,0,60)+'%';note.style.top=clamp(n.y,0,66)+'%';body.append(note);}
  if(kind==='skills')for(const n of store.skills.slice(0,3)){const card=el('article');card.append(el('strong','',n.name),el('p','',n.description),el('small','','/'+n.command));body.append(card);}
  if(!body.childElementCount)body.append(el('p','','点这里贴上第一个点子'));
 }
}
function stopEffects(id){const record=effects.get(id);if(!record)return;effects.delete(id);for(const a of record.animations){a.onfinish=null;a.cancel();}for(const done of record.cleanup)done();}
function trackEffect(id,animations,cleanup=[]){stopEffects(id);const record={animations,cleanup};effects.set(id,record);if(stopMotion())animations.forEach(a=>a.pause());return record;}
function checkProps(id){
 if(seated.has(id)||effects.has(id)||(propCooldown.get(id)||0)>performance.now())return false;
 const point=currentPoint(id),inside=store.props.find(p=>p.id===propInside.get(id));if(inside&&Math.hypot(point[0]-inside.x,point[1]-inside.y)>27)propInside.delete(id);const p=store.props.find(p=>p.id!==propInside.get(id)&&['spring-soft','spring-steel','carpet','slide'].includes(p.kind)&&!propBusy.has(p.id)&&Math.hypot(point[0]-p.x,point[1]-p.y)<21);
 if(!p)return false;propInside.set(id,p.id);activateProp(p,id);return true;
}
function activateProp(p,id=activeMemberId){
 if(!id||!actors.has(id)||propBusy.has(p.id))return;const a=actors.get(id);
 if(['firework','confetti'].includes(p.kind)){burst(p);return;}
 stopMember(id);undock(id);delete store.seats[id];release(id);propBusy.set(p.id,id);propCooldown.set(id,performance.now()+2500);
 const propNode=[...document.querySelectorAll('[data-prop]')].find(n=>n.dataset.prop===p.id);
 const cleanup=()=>{propBusy.delete(p.id);a.character.style.transform='';propNode?.classList.remove('in-use');if(propNode)propNode.style.zIndex=String(100+Math.round(p.y*1000));};propNode?.classList.add('in-use');
 if(reduced||motion.matches){if(p.endX!==undefined){a.node.style.left=p.endX/layout.width*100+'%';a.node.style.top=p.endY/layout.height*100+'%';positions.set(id,[p.endX,p.endY]);}cleanup();a.character.setState('idle');updateDepth(id);return;}
 if(p.kind.startsWith('spring')){
  a.character.setState('idle');const soft=p.kind==='spring-soft';
  const jump=Element.prototype.animate.call(a.character,[{transform:'translateY(0) scale(1)'},{transform:`translateY(8px) scale(${soft?'1.16,.78':'1.04,.92'})`,offset:.22},{transform:`translateY(-${(soft?95:150)*zoom}px) scale(1)`,offset:.55},{transform:'translateY(0) scale(1)',offset:.87},{transform:'translateY(-8px) scale(1)',offset:.94},{transform:'translateY(0) scale(1)'}],{duration:soft?1450:1150,easing:'ease-in-out'});
  const squash=propNode.querySelector('svg').animate([{transform:'scaleY(1)'},{transform:`scaleY(${soft?.55:.75})`,offset:.22},{transform:'scaleY(1.1)',offset:.45},{transform:'scaleY(1)'}],{duration:soft?1450:1150});
  const record=trackEffect(id,[jump,squash],[cleanup]);jump.onfinish=()=>{if(effects.get(id)===record){stopEffects(id);propCooldown.set(id,performance.now()+1700);}};
 }else{
  const end=[p.endX,p.endY];if(!walkable(end,layout)){cleanup();status('道具落点被挡住了，请在 DIY 中调整。');return;}
  const from=currentPoint(id),slide=p.kind==='slide',duration=slide?2000:3600;
  const lift=(slide?100:60)*zoom;const path=[from,end],frames=path.map((pt,i)=>({left:pt[0]/layout.width*100+'%',top:pt[1]/layout.height*100+'%',offset:i}));
  a.character.setState(slide?'sitting':'idle');
  const ride=a.node.animate(frames,{duration,easing:slide?'cubic-bezier(.5,0,.85,.6)':'ease-in-out',fill:'forwards'});
  const hover=Element.prototype.animate.call(a.character,[{transform:'translateY(0)'},{transform:`translateY(-${lift}px) rotate(${slide?-10:0}deg)`,offset:.2},{transform:`translateY(-${slide?15:lift}px)`,offset:.82},{transform:'translateY(0)'}],{duration,fill:'forwards'});
  const animations=[hover];
  if(!slide&&propNode){animations.push(propNode.animate(frames,{duration,easing:'ease-in-out',fill:'forwards'}));animations.push(propNode.querySelector('svg').animate([{transform:'translateY(0)'},{transform:`translateY(-${lift}px)`,offset:.2},{transform:`translateY(-${lift}px)`,offset:.82},{transform:'translateY(0)'}],{duration,fill:'forwards'}));}
  trackEffect(id,animations,[cleanup]);const record={animation:ride,point:end,state:'idle',seat:null,path,frames,duration,ride:true,propNode:slide?null:propNode};moves.set(id,record);ride.onfinish=()=>settleMove(id,record);if(stopMotion())ride.pause();startDepthLoop();
 }
 $('#scene-summary').textContent=store.members.find(m=>m.id===id).name+'正在玩'+p.name;persist();
}
function burst(p){
 if(propBusy.has(p.id))return;
 const effectId='fx-'+p.id;propBusy.set(p.id,true);
 const host=el('div','particle-burst');host.style.left=p.x/layout.width*100+'%';host.style.top=p.y/layout.height*100+'%';host.style.zIndex=String(100+Math.round(p.y*1000)+100000);$('#props').append(host);
 if(reduced||motion.matches){trackEffect(effectId,[],[()=>{host.remove();propBusy.delete(p.id);}]);host.textContent='✦ ✿ ✦';host.classList.add('static-burst');const b=button('收起庆祝',()=>stopEffects(effectId),'static-burst-close');host.append(b);return;}
 const animations=[];const colors=['#D88E72','#E5BD63','#93B69F','#AC9DC3','#F6E8C4'];
 for(let i=0;i<30;i++){const n=el('i');n.style.background=colors[i%colors.length];host.append(n);const angle=i/30*Math.PI*2,d=(45+Math.random()*85)*zoom,high=(p.kind==='firework'?140:50)*zoom;const tx=Math.cos(angle)*d,ty=Math.sin(angle)*d-high;
 animations.push(n.animate([{transform:'translate(0,0) scale(.2)',opacity:0},{transform:`translate(0,${-high}px) scale(.4)`,opacity:1,offset:.2},{transform:`translate(${tx}px,${ty}px) rotate(${i*43}deg)`,opacity:1,offset:.5},{transform:`translate(${tx*1.15}px,${ty+70*zoom}px) rotate(${i*87}deg)`,opacity:0}],{duration:2100,delay:i%5*30,easing:'ease-out',fill:'both'}));}
 const record=trackEffect(effectId,animations,[()=>{host.remove();propBusy.delete(p.id);}]);animations[29].onfinish=()=>{if(effects.get(effectId)===record)stopEffects(effectId);};status(p.name+'绽放了！');
}
function onPropClick(p){
 if(selectedPanel==='diy'){selectedProp=p.id;renderPanel();return;}
 if(['firework','confetti'].includes(p.kind)){burst(p);return;}
 if(['wall','tree'].includes(p.kind)){status(p.name+'是障碍物，同事会绕着走。');return;}
 if(propBusy.has(p.id)){status('这件道具正在使用，等同事玩完再来。');return;}
 if(activeMemberId&&Math.hypot(currentPoint(activeMemberId)[0]-p.x,currentPoint(activeMemberId)[1]-p.y)<21){propInside.set(activeMemberId,p.id);activateProp(p);return;}
 if(activeMemberId&&moveMember(activeMemberId,[p.x,p.y],'idle')){release(activeMemberId);persist();}
}
function renderDIY(){
 intro('道具库','办公室先留白，想玩时再布置。墙、弹簧、飞毯等能力都保留，按需取用。');
 const palette=el('div','prop-palette');for(const [kind,t] of Object.entries(PROP_TYPES))palette.append(button(t.label,()=>{placement={kind};selectedProp=null;scene.dataset.placing='true';status('在地面点一下，放置'+t.label);renderPanel();},'prop-choice'));content.append(palette);
 if(placement)content.append(el('p','path-hint',placement.draft?'再点一下：选择落点。':'点地图空地放置 '+PROP_TYPES[placement.kind].label),button('取消放置',cancelPlacement));
 const p=store.props.find(p=>p.id===selectedProp);
 if(p){intro(p.name,PROP_TYPES[p.kind].hint);const f=el('form','inline-form');field(f,'名字','name','input',p.name,32);const row=el('div','coordinate-grid');f.append(row);for(const [key,label] of [['x','横向位置'],['y','纵向位置'],...(p.endX!==undefined?[['endX','落点横向'],['endY','落点纵向']]:[])]){const input=field(row,label,key,'input',Math.round(p[key]));input.type='number';input.min='65';input.max=String(key.toLowerCase().includes('x')?layout.width-65:layout.height-65);}
 const actions=el('div','form-row');const save=el('button','primary','保存修改');save.type='submit';actions.append(save,button('移到别处',()=>{placement={kind:p.kind,existing:p};scene.dataset.placing='true';renderPanel();}));f.append(actions);f.onsubmit=e=>{e.preventDefault();const fd=new FormData(f),draft={...p,name:String(fd.get('name')).trim()};for(const k of ['x','y','endX','endY'])if(fd.has(k))draft[k]=Number(fd.get(k));commitProp(draft);};content.append(f,button('试一下',()=>{selectedPanel='overview';selectPanel('overview');onPropClick(p);}),button('收进道具库',()=>{store.propStorage.push({...p});store.props=store.props.filter(v=>v.id!==p.id);selectedProp=null;rebuildWorld();persist();},'danger-button'));}
 const shelf=el('div','device-list');for(const p of store.propStorage)shelf.append(button('放回地图 · '+p.name,()=>{placement={kind:p.kind,existing:p};scene.dataset.placing='true';renderPanel();},'device-entry'));if(store.propStorage.length)content.append(el('p','tiny-label','已收纳 · 原有道具和设置都在这里'),shelf);
 const list=el('div','device-list');for(const p of store.props)list.append(button(p.name+' · '+PROP_TYPES[p.kind].label,()=>{selectedProp=p.id;renderPanel();},'device-entry'));content.append(el('p','tiny-label','已放置的道具 · 点击编辑'),list);
}
function cancelPlacement(){placement=null;delete scene.dataset.placing;renderPanel();}
function commitProp(p){const error=canPlace(p,store.devices,store.props,[...actors.keys()].map(currentPoint));if(error){status(error);return false;}const i=store.props.findIndex(v=>v.id===p.id);if(i<0)store.props.push(p);else store.props[i]=p;store.propStorage=store.propStorage.filter(v=>v.id!==p.id);selectedProp=p.id;placement=null;delete scene.dataset.placing;rebuildWorld();persist();return true;}
function initDIY(){
 $('#diy-button').onclick=()=>selectPanel('diy');
 scene.addEventListener('click',e=>{
  const rect=scene.getBoundingClientRect(),point=[(e.clientX-rect.left)/rect.width*layout.width,(e.clientY-rect.top)/rect.height*layout.height];
  if(placement){e.preventDefault();e.stopImmediatePropagation();const draft=placement.draft;
   if(draft){draft.endX=Math.round(point[0]);draft.endY=Math.round(point[1]);commitProp(draft);return;}
   const t=PROP_TYPES[placement.kind],p={...placement.existing,id:placement.existing?.id||uid(),kind:placement.kind,name:placement.existing?.name||t.label,x:Math.round(point[0]),y:Math.round(point[1]),w:t.size[0],h:t.size[1]};
   if(['slide','carpet'].includes(p.kind)){placement.draft=p;status('现在点一个落点');renderPanel();}else commitProp(p);return;
  }
  if(e.target.closest('button'))return;if(activeMemberId&&walkable(point,layout)&&moveMember(activeMemberId,point,'idle')){release(activeMemberId);persist();}
 },true);
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&placement)cancelPlacement();});
}

async function init(){
 const response=await fetch('./office.json');if(!response.ok)throw Error('办公室设定加载失败');config=await response.json();roleCatalog=structuredClone(config.members);key='office-space:'+config.id+':v1';store=loadStore();activeMemberId=store.members[0]?.id;applySettings();
 const art=await fetch(config.scene);if(!art.ok)throw Error('办公室场景加载失败');const doc=new DOMParser().parseFromString(await art.text(),'image/svg+xml');if(doc.querySelector('parsererror')||doc.documentElement.localName!=='svg'||doc.querySelector('script,foreignObject,iframe'))throw Error('办公室 SVG 无效');artDocument=doc;
 rebuildWorld();if(!storageWarning)persist(false);zoom=Math.min(.85,$('.scene-scroll').clientWidth/layout.width);applyZoom();initDIY();$('#scene-summary').textContent=config.members.length+' 位小同事，都有自己的节奏。';if(!storageWarning)status('内容自动保存在当前浏览器，可随时导出。');
 document.querySelectorAll('[data-panel]').forEach(b=>b.onclick=()=>{selectedMember=null;selectPanel(b.dataset.panel);});
 document.querySelectorAll('[data-team]').forEach(b=>b.onclick=()=>{if(b.dataset.team==='done'){config.members.forEach(m=>memberState(m.id,'done'));$('#scene-summary').textContent='搞定了！每个人都用自己的方式庆祝。';}else sendTo(b.dataset.team);});
 $('#pause-all').onclick=()=>{paused=!paused;$('#pause-all').textContent=paused?'继续动态':'暂停动态';$('#pause-all').setAttribute('aria-pressed',String(paused));syncPlayback();};
 $('#reduce-all').onclick=()=>{reduced=!reduced;$('#reduce-all').setAttribute('aria-pressed',String(reduced));if(reduced){for(const [id,r] of moves)settleMove(id,r);for(const id of [...effects.keys()])stopEffects(id);}syncPlayback();};
 document.addEventListener('visibilitychange',syncPlayback);motion.addEventListener('change',()=>{if(motion.matches){for(const [id,r] of moves)settleMove(id,r);for(const id of [...effects.keys()])stopEffects(id);}});
 const dialog=$('#settings-dialog'),form=$('#settings-form');$('#settings-button').onclick=()=>{form.elements.namedItem('name').value=store.settings.name;form.elements.namedItem('brief').value=store.settings.brief;for(const k of ['wall','floor','accent'])form.elements.namedItem(k).value=store.settings.palette[k];dialog.showModal();};$('#close-settings').onclick=()=>dialog.close();
 form.onsubmit=e=>{e.preventDefault();const fd=new FormData(form);if(!String(fd.get('name')).trim()||!String(fd.get('brief')).trim())return;store.settings={name:String(fd.get('name')).trim(),brief:String(fd.get('brief')).trim(),palette:Object.fromEntries(['wall','floor','accent'].map(k=>[k,String(fd.get(k))]))};applySettings();persist();dialog.close();};
 $('#zoom-out').onclick=()=>{zoom=Math.max(.4,zoom-.15);applyZoom();};$('#zoom-in').onclick=()=>{zoom=Math.min(1.7,zoom+.15);applyZoom();};$('#fit-map').onclick=()=>{const viewport=$('.scene-scroll');zoom=Math.min(1,viewport.clientWidth/layout.width,viewport.clientHeight/layout.height);applyZoom();viewport.scrollTo(0,0);};
 document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>document.getElementById(b.dataset.close).close());
 $('#add-device').onclick=()=>{const f=$('#device-form');f.reset();f.elements.namedItem('name').value='新电脑 '+(store.devices.length+1);$('#device-dialog').showModal();};
 $('#device-form').onsubmit=e=>{e.preventDefault();const fd=new FormData(e.currentTarget);const name=String(fd.get('name')).trim();if(!name)return;const id='computer-'+uid();const nextDevices=[...store.devices,{id,name}];let nextProps;try{nextProps=reflowProps(nextDevices,store.props,layout.playY);}catch(error){status(error.message);return;}store.devices=nextDevices;store.props=nextProps;rebuildWorld();persist();$('#device-dialog').close();$('#scene-summary').textContent='已添加 '+name+'，工位、互动区和三个看板已重新布置。';const target=[...document.querySelectorAll('[data-device]')].find(n=>n.dataset.device===id);target?.scrollIntoView({block:'nearest',inline:'center',behavior:'instant'});};
 const roles=$('#member-role');for(const m of roleCatalog){const option=el('option','',m.name);option.value=m.id;roles.append(option);}$('#invite-member').onclick=()=>{$('#member-form').reset();$('#member-form').elements.namedItem('name').value=roleCatalog[0].name+'的新同事';$('#member-dialog').showModal();};roles.onchange=()=>{$('#member-form').elements.namedItem('name').value=roleCatalog.find(m=>m.id===roles.value).name+'的新同事';};
 $('#member-form').onsubmit=e=>{e.preventDefault();const fd=new FormData(e.currentTarget),name=String(fd.get('name')).trim();const role=roleCatalog.find(m=>m.id===fd.get('role'));if(!name||!role)return;const member={...structuredClone(role),id:role.id+'-'+uid(),name,seed:Math.floor(Math.random()*2147483646)+1};store.members.push(member);activeMemberId=member.id;selectedMember=member.id;rebuildWorld();persist();$('#member-dialog').close();selectPanel('overview');};
 $('#export-button').onclick=()=>{const data={...config,devices:store.devices,members:store.members,name:store.settings.name,brief:store.settings.brief,palette:store.settings.palette,announcements:store.announcements,notes:store.notes,skills:store.skills,props:store.props,propStorage:store.propStorage,cleanLayoutVersion:1,assignments:store.assignments,seats:store.seats,presentationVersion:2};const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=el('a');a.href=url;a.download=config.id+'-office.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);status('已导出办公室设定和三个看板的内容');};
}
init().catch(error=>{content.replaceChildren(el('p','error',error.message+'，请刷新重试。'));status('办公室未能打开。');});
