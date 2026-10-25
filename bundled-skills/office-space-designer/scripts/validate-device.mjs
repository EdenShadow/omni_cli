import {readFileSync} from 'node:fs';
import path from 'node:path';
import {validateDeviceAppearance} from './device-appearance.mjs';
const file=path.resolve(process.argv[2]||'output/device.json');
const manifest=JSON.parse(readFileSync(file));
validateDeviceAppearance(manifest,readFileSync(path.join(path.dirname(file),'device.svg'),'utf8'));
console.log('PASS device '+manifest.name);
