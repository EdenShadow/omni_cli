import assert from 'node:assert/strict';
import {createLayout,walkable,findPath,workPoint,cloneIdentity} from '../public/office-space/layout.js';
import {canPlace,propValid,reflowProps} from '../public/office-space/props.js';
import fs from 'node:fs';
for(const count of [1,3,4,8,16,40]){
 const devices=Array.from({length:count},(_,i)=>({id:'pc-'+i,name:'电脑 '+i})),l=createLayout(devices);
 assert.equal(l.seats.length,3);assert.equal(l.computers.length,count);assert.equal(l.boards.length,3);
 const start=workPoint(l.computers[0],0,l);
 for(const seat of l.seats)assert.ok(findPath(start,seat.approach,l),'seat unreachable');
 for(const d of l.computers)for(let i=0;i<150;i++)assert.ok(walkable(workPoint(d,i,l),l),'unlimited gathering failed');
 for(const target of [...l.zones.filter(z=>z.spots).flatMap(z=>z.spots),workPoint(l.computers.at(-1),149,l)]){
  const route=findPath(start,target,l);assert.ok(route,'destination unreachable');
  for(let i=1;i<route.length;i++){const a=route[i-1],b=route[i],n=Math.max(1,Math.ceil(Math.hypot(a[0]-b[0],a[1]-b[1])/4));for(let j=0;j<=n;j++)assert.ok(walkable([a[0]+(b[0]-a[0])*j/n,a[1]+(b[1]-a[1])*j/n],l),'path clips furniture');}
 }
 assert.equal(findPath(start,[l.computers[0].x,l.computers[0].y],l),null);
 console.log(`PASS ${count} computers: 150 people per device, seats, boards and obstacle-safe routes`);
}
const config=JSON.parse(fs.readFileSync('public/office-space/office.json','utf8'));
config.props=reflowProps(config.devices,config.propStorage,createLayout(config.devices).playY);
const l=createLayout(config.devices,config.props);
for(const p of config.props){assert.ok(propValid(p));if(!['tree','wall'].includes(p.kind))assert.ok(findPath(l.computers[0].spots[0],[p.x,p.y],l),p.name+' entrance blocked');if(p.endX)assert.ok(walkable([p.endX,p.endY],l));}
const tree=config.props[0];assert.equal(walkable([tree.x,tree.y],l),false);
const wall={id:'wall',name:'wall',kind:'wall',x:350,y:800,w:150,h:85};
assert.equal(canPlace(wall,config.devices,config.props),null);
assert.ok(canPlace({...wall,x:l.computers[0].x,y:l.computers[0].y},config.devices,config.props));
assert.ok(canPlace({...wall,x:300,y:780},config.devices,config.props,[[300,780]]));
assert.ok(canPlace({...wall,kind:'carpet',endX:l.computers[0].x,endY:l.computers[0].y},config.devices,config.props));
const base={id:'base',name:'橘子妹妹',seed:3,width:126};const original=JSON.stringify(base);const clone=cloneIdentity(base,[base],'clone',()=>.2),clone2=cloneIdentity(clone,[base,clone],'clone2',()=>.6);
assert.equal(JSON.stringify(base),original);assert.equal(clone.rootId,base.id);assert.equal(clone2.rootId,base.id);assert.equal(clone2.cloneNumber,3);assert.notEqual(clone.seed,clone2.seed);assert.notEqual(clone.cloneColor,clone2.cloneColor);assert.equal(clone.width,base.width);
console.log('PASS default props, blocked placement, safe landings and independent clone identity');
