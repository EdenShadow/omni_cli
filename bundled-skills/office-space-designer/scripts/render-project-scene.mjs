import {readFileSync, writeFileSync} from 'node:fs';
import {validateProjectScene, renderProjectScene} from './project-scene.mjs';
const [input,output]=process.argv.slice(2);
if(!input||!output)throw Error('Usage: node render-project-scene.mjs office.json background.svg');
const scene=JSON.parse(readFileSync(input,'utf8'));
validateProjectScene(scene);
writeFileSync(output,renderProjectScene(scene));
console.log('Rendered pixel-grid project: '+scene.name);
