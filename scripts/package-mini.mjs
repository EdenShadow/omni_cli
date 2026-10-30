import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {builtinModules} from 'node:module';
import {execFileSync} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
const out=path.resolve(process.argv[2]||path.join(root,'.local/mini-package'));
const stage=path.join(out,'package');await fs.mkdir(out,{recursive:true});await fs.rm(stage,{recursive:true,force:true});await fs.mkdir(stage);
const seen=new Set();
async function copy(relative){
 if(seen.has(relative))return;seen.add(relative);
 const source=path.resolve(root,relative);if(!source.startsWith(root))throw Error('Import outside package');
 const code=await fs.readFile(source,'utf8');
 for(const m of code.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)['"]([^'"]+)['"]/g)){
  const spec=m[1];if(spec.startsWith('.'))await copy(path.normalize(path.join(path.dirname(relative),spec)));
  else if(!spec.startsWith('node:')&&!builtinModules.includes(spec))throw Error('Mini must have zero external dependencies: '+spec);
 }
 const target=path.join(stage,relative);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,code);
}
await copy('bin/omni-mini.mjs');
const original=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
await fs.writeFile(path.join(stage,'package.json'),JSON.stringify({name:'@edenshadow/omni-mini',version:original.version,type:'module',license:original.license,engines:original.engines,bin:{'omni-mini':'bin/omni-mini.mjs'},description:'Zero-dependency Wanwu public-chat client; no local AI runtime'},null,2)+'\n');
await fs.copyFile(path.join(root,'docs/mini.md'),path.join(stage,'README.md'));await fs.copyFile(path.join(root,'LICENSE'),path.join(stage,'LICENSE'));
await fs.chmod(path.join(stage,'bin/omni-mini.mjs'),0o755);
const result=JSON.parse(execFileSync('npm',['pack','--json','--pack-destination',out],{cwd:stage,encoding:'utf8'}));
console.log(JSON.stringify(result.map(p=>({file:path.join(out,p.filename),size:p.size,unpackedSize:p.unpackedSize,files:p.files.length,dependencies:0})),null,2));
