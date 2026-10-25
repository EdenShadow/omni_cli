import fs from 'node:fs/promises';
import path from 'node:path';
import {prepareOfficeScene,assertOfficeBrief} from './office-floorplan.mjs';
import {validateProjectScene} from './project-scene.mjs';
const [input,output,prompt]=process.argv.slice(2);
if(!input||!output||!prompt){console.error('Usage: node plan-office.mjs input.json output.json "office description"');process.exit(2);}
const scene=prepareOfficeScene(JSON.parse(await fs.readFile(input,'utf8')),prompt);
validateProjectScene(scene);assertOfficeBrief(scene,prompt);
await fs.mkdir(path.dirname(path.resolve(output)),{recursive:true});await fs.writeFile(output,JSON.stringify(scene,null,2)+'\n');
console.log(`Planned ${scene.columns} × ${scene.rows} tiles, ${scene.floorPlan?.rooms.length||0} rooms, ${scene.deviceZones.length} desks`);
