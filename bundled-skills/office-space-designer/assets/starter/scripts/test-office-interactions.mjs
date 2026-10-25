import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createLayout,cloneIdentity,tidyOfficeStore} from '../public/office-space/layout.js';
import {reflowProps,canPlace} from '../public/office-space/props.js';
const source=fs.readFileSync('public/office-space/office.js','utf8');
function fn(name){const start=source.indexOf('function '+name+'('),end=source.indexOf('\nfunction ',start+1);return source.slice(start,end<0?undefined:end);}
// Execute the real trigger function with a minimal host to catch re-entry/cooldown bugs.
let point=[100,500],activations=0,now=10000;
const context={seated:new Map(),effects:new Map(),propCooldown:new Map(),propInside:new Map(),propBusy:new Map(),performance:{now:()=>now},currentPoint:()=>point,store:{props:[{id:'spring',kind:'spring-soft',x:100,y:500}]},activateProp:()=>activations++};
vm.createContext(context);vm.runInContext(fn('checkProps')+';this.check=checkProps;',context);
assert.equal(context.check('person'),true);assert.equal(activations,1);
for(let i=0;i<50;i++)assert.equal(context.check('person'),false,'standing on a spring must not trap the person');
point=[132,500];context.check('person');point=[100,500];context.check('person');assert.equal(activations,2);
context.propInside.clear();context.propBusy.set('spring','another-person');assert.equal(context.check('person'),false);
context.propBusy.clear();context.propCooldown.set('person',11000);assert.equal(context.check('person'),false);now=12000;assert.equal(context.check('person'),true);
// Actual device command: a working source stays assigned while a new identity is sent.
const src={id:'original',name:'芽团',seed:4,width:130};let lastMoved;
const c={activeMemberId:'original',store:{members:[src],assignments:{original:{deviceId:'pc1',slot:0}}},layout:{computers:[{id:'pc1',name:'一号'},{id:'pc2',name:'二号'}]},actors:new Map([['original',{character:{currentState:'working'},node:{setAttribute(){}}}]]),moves:new Map(),config:{members:[src]},occupants:()=>[],workPoint:()=>[100,500],findPath:()=>true,currentPoint:()=>[50,500],cloneIdentity,uid:()=> 'new-clone',initActors(ms){ms.forEach(m=>c.actors.set(m.id,{character:{currentState:'idle'},node:{setAttribute(){}}}));},moveMember:(id)=>{lastMoved=id;return true;},refreshOccupancy(){},persist(){},updateStats(){},renderPanel(){},status(){},$:()=>({textContent:''})};
vm.createContext(c);vm.runInContext(fn('assignDevice')+';this.assign=assignDevice;',c);
assert.equal(c.assign('pc2'),true);assert.equal(c.store.members.length,2);assert.equal(c.store.assignments.original.deviceId,'pc1');assert.equal(c.store.assignments['new-clone'].deviceId,'pc2');assert.equal(lastMoved,'new-clone');assert.equal(c.actors.get('original').character.currentState,'working');
c.activeMemberId='original';c.assign('pc1');assert.equal(c.store.members.length,2,'repeat same-device must not clone');
c.actors.get('original').character.currentState='idle';c.assign('pc2');assert.equal(c.store.members.length,2,'idle original moves directly');
const config=JSON.parse(fs.readFileSync('public/office-space/office.json','utf8'));let devices=config.devices,props=reflowProps(config.devices,config.propStorage,createLayout(config.devices).playY);
for(let n=4;n<=16;n++){const before=createLayout(devices).playY;devices=[...devices,{id:'extra'+n,name:'extra'}];props=reflowProps(devices,props,before);for(const p of props)assert.equal(canPlace(p,devices,props),null,p.id+' invalid after addition');assert.deepEqual(props.map(p=>p.id),config.propStorage.map(p=>p.id));}
console.log('PASS auto-trigger entry/cooldown, unlimited device dispatch/clones, 4–16 device additions retain usable props');

const saved={props:[{id:'custom',kind:'slide',endX:123,endY:456}],members:[{id:'one',state:'sitting'}],seats:{one:'pc-chair',two:'sofa-1'},devices:[{id:'keep'}],announcements:[{id:'notice',body:'keep'}]};
tidyOfficeStore(saved);assert.equal(saved.props.length,0);assert.equal(saved.propStorage[0].endX,123);assert.equal(saved.seats.one,undefined);assert.equal(saved.seats.two,'sofa-1');assert.equal(saved.members[0].state,'idle');
saved.props.push({id:'new'});tidyOfficeStore(saved);assert.equal(saved.props.length,1,'must not keep shelving new props');assert.equal(saved.devices[0].id,'keep');assert.equal(saved.announcements[0].body,'keep');
console.log('PASS one-time tidy migration retains custom props, boards/devices, releases removed chairs');
