import {readdirSync,lstatSync,readFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import {validSkillName,skillMetadata} from '../../shared/skill-package.mjs';

const generation=/^\d{13}-[a-f0-9-]{36}$/;
function realDirectory(dir){try{return lstatSync(dir).isDirectory();}catch{return false;}}
// Only prune our own backup generations after the live install was validated.
// Never traverse directory symlinks or arbitrary user-named backup folders.
export function pruneSkillBackups(options){
  try{prune(options);}catch{/* Cleanup must never turn a successful install into a failure. */}
}
function prune({dataDir,provider,name,receipt}){
  if(!validSkillName(name)||!['codex','claude','dsh','wanwu'].includes(provider)||receipt?.source!=='wanwu-registry'||receipt.name!==name)return;
  const base=path.resolve(dataDir,'skill-backups'),root=path.join(base,provider,name);
  if(![path.resolve(dataDir),base,path.dirname(root),root].every(realDirectory))return;
  const rows=readdirSync(root).filter(n=>generation.test(n)&&realDirectory(path.join(root,n))).sort().reverse();
  const referenced=[receipt.backup,...(receipt.backups||[]).map(b=>b.backup)].filter(v=>typeof v==='string').map(v=>path.relative(root,path.resolve(v)).split(path.sep)[0]).filter(n=>rows.includes(n));
  // The receipt identifies the successful update's previous version. A newer
  // directory may be a failed/incomplete install and must not replace it.
  const keep=new Set(referenced.length?referenced:[rows[0]]);
  for(const id of rows){
    if(keep.has(id))continue;
    const dir=path.join(root,id);
    let owned=false;
    try{const old=JSON.parse(readFileSync(path.join(dir,'.wanwu-skill.json'),'utf8'));owned=old.source==='wanwu-registry'&&old.name===name;}catch{}
    // Early installers backed up the original skill before adding a receipt.
    // Require a real SKILL.md matching this exact skill, inside our generation.
    try{const file=path.join(dir,'SKILL.md');owned ||= lstatSync(file).isFile()&&skillMetadata(readFileSync(file,'utf8')).name===name;}catch{}
    try{const restore=JSON.parse(readFileSync(path.join(dir,'restore.json'),'utf8'));owned ||= Array.isArray(restore)&&restore.length>0&&restore.every(r=>typeof r.backup==='string'&&path.resolve(r.backup).startsWith(dir+path.sep));}catch{}
    if(owned)try{rmSync(dir,{recursive:true,force:true});}catch{/* Retry on next successful sync. */}
  }
}
