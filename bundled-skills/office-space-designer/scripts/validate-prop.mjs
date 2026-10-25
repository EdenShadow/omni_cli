import {readFileSync} from 'node:fs';
import path from 'node:path';
import {validateProp} from './prop-art.mjs';
const file=path.resolve(process.argv[2]||'output/prop.json'),manifest=JSON.parse(readFileSync(file));
validateProp(manifest,readFileSync(path.join(path.dirname(file),'prop.svg'),'utf8'));
console.log('PASS prop '+manifest.name);
