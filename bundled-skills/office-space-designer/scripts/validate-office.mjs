import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const input=process.argv[2];
if(!input){console.error('Usage: node validate-office.mjs /absolute/path/office.json');process.exit(2);}
const file=path.resolve(input),dir=path.dirname(file),c=JSON.parse(await fs.readFile(file,'utf8'));
if(c.schemaVersion===2){const {validateProjectScene}=await import('./project-scene.mjs');validateProjectScene(c);const {validateOfficeCirculation}=await import('./floor-plan.mjs');validateOfficeCirculation(c);console.log('PASS pixel-grid project '+c.name);process.exit(0);}
assert.equal(c.schemaVersion,1);assert.ok(c.id&&c.name&&c.brief);
for(const k of ['wall','floor','accent'])assert.match(c.palette[k],/^#[0-9a-f]{6}$/i);
const svg=await fs.readFile(path.resolve(dir,c.scene),'utf8');assert.match(svg,/<svg\b/);assert.ok(!/<(?:script|foreignObject)\b/i.test(svg));
for(const group of ['devices','members','announcements','notes','skills']){assert.ok(Array.isArray(c[group]),group);assert.equal(new Set(c[group].map(x=>x.id)).size,c[group].length,group+' duplicate IDs');}
assert.ok(c.devices.length&&c.members.length);
for(const d of c.devices)assert.ok(d.id&&d.name,'invalid device');
for(const m of c.members){assert.ok(m.width>0&&m.ratio>0&&m.anchor>0&&m.anchor<=1,'invalid member proportions');const role=JSON.parse(await fs.readFile(path.resolve(dir,m.src),'utf8'));assert.ok(role);await fs.access(path.join(path.dirname(path.resolve(dir,m.src)),'character.svg'));}
const {createLayout,walkable,findPath}=await import(pathToFileURL(path.join(dir,'layout.js')));
const {propValid}=await import(pathToFileURL(path.join(dir,'props.js')));
assert.ok(Array.isArray(c.props));assert.ok(!c.propStorage||Array.isArray(c.propStorage));for(const p of [...c.props,...(c.propStorage||[])])assert.ok(propValid(p),'invalid prop '+p.id);assert.equal(new Set(c.props.map(p=>p.id)).size,c.props.length);
const l=createLayout(c.devices,c.props),start=l.computers[0].spots[0];
assert.equal(l.computers.length,c.devices.length);assert.equal(l.boards.length,3);
const spots=l.computers.flatMap(d=>d.spots);assert.equal(new Set(spots.map(p=>p.join(','))).size,spots.length);
for(const z of l.zones.filter(z=>z.spots))for(const p of z.spots){assert.ok(walkable(p,l),'blocked destination '+p);const route=findPath(start,p,l);assert.ok(route,'unreachable '+p);for(let i=1;i<route.length;i++){const a=route[i-1],b=route[i],n=Math.max(1,Math.ceil(Math.hypot(a[0]-b[0],a[1]-b[1])/4));for(let j=0;j<=n;j++)assert.ok(walkable([a[0]+(b[0]-a[0])*j/n,a[1]+(b[1]-a[1])*j/n],l),'path through furniture');}}
console.log(`PASS ${c.name}: ${c.devices.length} devices, ${c.props.length} interactive props, ${c.members.length} members, 3 boards, valid assets and routes`);

for(const p of c.props){if(!['wall','tree'].includes(p.kind))assert.ok(findPath(start,[p.x,p.y],l),'blocked prop entry '+p.id);if(p.endX!==undefined)assert.ok(walkable([p.endX,p.endY],l),'blocked prop landing '+p.id);}
