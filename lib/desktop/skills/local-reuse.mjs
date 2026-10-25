import {hashSkillFile} from '../../shared/skill-blobs.mjs';
import {readFileSync,readdirSync,lstatSync,realpathSync,statSync,mkdirSync,writeFileSync,renameSync} from 'node:fs';
import path from 'node:path';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {skillMetadata,validSkillName,validateSkillPackage,MAX_SKILL_BYTES,sha256} from '../../shared/skill-package.mjs';

// Only search locations the selected runtime actually loads. A Claude-only
// skill is not evidence that Codex can use it, and vice versa.
export function skillSearchRoots(provider,root){
  const roots=[path.resolve(root)];
  if(provider==='codex'&&roots[0]===path.resolve(process.env.CODEX_HOME||path.join(homedir(),'.codex'),'skills'))roots.push(path.join(homedir(),'.agents/skills'));
  return [...new Set(roots)];
}
export const activeSkillDirectory=name=>!name.startsWith('.')&&!/\.(?:wanwu-backup|backup|bak|old)(?:[.-]|$)/i.test(name);

// Symlinked skill directories can be reused read-only. Their targets are never
// adopted for writes. Do not follow links inside the package's individual files.
export function localSkillCandidates(roots,name,{includeAliases=false}={}){
  const candidates=[],seen=new Set();
  for(const root of [...new Set(roots.map(r=>path.resolve(r)))]){
    let entries;try{entries=readdirSync(root,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')continue;throw e;}
    for(const entry of entries){
      if(!activeSkillDirectory(entry.name)||!entry.isDirectory()&&!entry.isSymbolicLink())continue;
      const directory=path.join(root,entry.name),file=path.join(directory,'SKILL.md');
      let canonical,meta;
      try{
        canonical=realpathSync(directory);
        const stat=lstatSync(file);
        if(!stat.isFile()||stat.size>64*1024)throw Error('Invalid skill entry');
        meta=skillMetadata(readFileSync(file,'utf8'));
      }catch(e){
        // An unusable same-name destination must not turn into a fresh install.
        if(entry.name===name)candidates.push({directory,canonical:canonical||null,linked:entry.isSymbolicLink(),invalid:true});
        continue;
      }
      if(meta.name!==name&&entry.name!==name||!includeAliases&&seen.has(canonical))continue;
      seen.add(canonical);candidates.push({directory,canonical,linked:entry.isSymbolicLink(),invalid:meta.name!==name});
    }
  }
  return candidates;
}
export function matchesLocalSkill(candidate,pkg){
  if(candidate.invalid||!candidate.canonical)return false;
  try{
    if(realpathSync(candidate.directory)!==candidate.canonical)return false;
    let total=0;
    for(const file of pkg.files){
      let target=candidate.canonical,missing=false;
      for(const part of file.path.split('/')){
        target=path.join(target,part);
        try{if(lstatSync(target).isSymbolicLink())return false;}
        catch(e){if(e.code!=='ENOENT')throw e;missing=true;break;}
      }
      // Project presentation supplies an icon when publishing a local skill.
      // It is not an executable dependency and needn't be written to the source.
      if(missing&&file.path==='assets/skill-icon.svg')continue;
      if(missing)return false;
      const stat=statSync(target);total+=stat.size;
      if(!stat.isFile()||total>MAX_SKILL_BYTES||process.platform!=='win32'&&!!(stat.mode&0o111)!==!!(file.mode&0o111)||hashSkillFile(target)!==file.sha256)return false;
    }
    return true;
  }catch{return false;}
}
function receiptPath(dataDir,root,name){
  return path.join(dataDir,'skill-reuse',sha256(path.resolve(root)),name+'.json');
}
export function reusedSkill(root,name,{dataDir,searchRoots=[root]}={}){
  if(!dataDir||!validSkillName(name))return null;
  try{
    const receipt=JSON.parse(readFileSync(receiptPath(dataDir,root,name),'utf8'));
    if(receipt.source!=='wanwu-local-reuse'||receipt.name!==name||!/^[a-f0-9]{64}$/.test(receipt.sha256))return null;
    const pkg=validateSkillPackage(JSON.parse(readFileSync(path.join(dataDir,'skill-cache',receipt.sha256,'package.json'),'utf8'))).package;
    if(pkg.name!==name||pkg.version!==receipt.version||pkg.sha256!==receipt.sha256)return null;
    const candidates=localSkillCandidates(searchRoots,name);
    if(!candidates.length||!candidates.every(c=>matchesLocalSkill(c,pkg)))return null;
    return {...receipt,state:'current',directory:candidates[0].directory};
  }catch{return null;}
}
export function recordSkillReuse(pkg,{root,dataDir,projectId,provider},candidates){
  const receipt={schemaVersion:1,source:'wanwu-local-reuse',name:pkg.name,version:pkg.version,sha256:pkg.sha256,provider,projectId,directory:candidates[0].directory,installedAt:Date.now(),backup:null,state:'current'};
  // Keep compatibility with standalone installers without an app data directory.
  // All production callers supply one; never write receipts into external skills.
  if(!dataDir)return receipt;
  const cached=path.join(dataDir,'skill-cache',pkg.sha256,'package.json'),file=receiptPath(dataDir,root,pkg.name);
  for(const [target,value] of [[cached,pkg],[file,receipt]]){
    mkdirSync(path.dirname(target),{recursive:true});
    const temporary=target+'.'+randomUUID()+'.tmp';
    writeFileSync(temporary,JSON.stringify(value),{mode:0o600});renameSync(temporary,target);
  }
  return receipt;
}
