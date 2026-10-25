import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const files=[];
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else if(p.endsWith('.mjs'))files.push(p);}}
for(const dir of ['bin','src','lib','scripts'])walk(dir);
for(const file of files)execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
await import('../src/cli.mjs');
console.log(`Checked ${files.length} modules and CLI import graph`);
