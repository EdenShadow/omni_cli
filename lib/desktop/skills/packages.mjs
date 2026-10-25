import {readFileSync,writeFileSync,readdirSync,lstatSync,existsSync,mkdirSync,cpSync,copyFileSync,readlinkSync,symlinkSync,renameSync,rmSync,chmodSync} from 'node:fs';
import path from 'node:path';
import {homedir} from 'node:os';
import {dshHome} from '../dsh-paths.mjs';
import {PROVIDERS} from '../../shared/providers.mjs';
import {randomUUID} from 'node:crypto';
import {hashSkillFile,writeSkillFile} from '../../shared/skill-blobs.mjs';
import {validateSkillPackage,validSkillPath,sha256,MAX_SKILL_BYTES} from '../../shared/skill-package.mjs';
import {skillSearchRoots,localSkillCandidates,matchesLocalSkill,reusedSkill,recordSkillReuse} from './local-reuse.mjs';
export {packageSkillDirectory} from '../../shared/skill-directory.mjs';
export function skillInstallRoot(provider) {
  if(!PROVIDERS.includes(provider))throw Error('不支持这个 Runtime');
  if(provider==='wanwu'||provider==='dsh')return path.join(dshHome(provider),'skills');
  return provider==='codex'?path.join(process.env.CODEX_HOME||path.join(homedir(),'.codex'),'skills'):path.join(process.env.CLAUDE_CONFIG_DIR||path.join(homedir(),'.claude'),'skills');
}
function assertNoLink(root,relative='') {
  let current=root;
  for(const part of ['',...relative.split('/').filter(Boolean)]){
    if(part)current=path.join(current,part);
    let stat;try{stat=lstatSync(current);}catch(e){if(e.code!=='ENOENT')throw e;}
    if(stat?.isSymbolicLink())throw Error('安装目录包含符号链接，未写入：'+relative);
  }
}
export function installedSkill(root,name) {
  try {const f=path.join(root,name,'.wanwu-skill.json');assertNoLink(path.join(root,name),'.wanwu-skill.json');return JSON.parse(readFileSync(f,'utf8'));}
  catch {return null;}
}
// Verify the installed bytes against the cloud digest before skipping a sync.
// A receipt alone is insufficient: files may have been edited or removed locally.
export function currentInstalledSkill(root,{name,version,sha256:digest},options={}) {
  if(!validSkillPath(name)||!/^[a-f0-9]{64}$/.test(digest||''))return null;
  try {
    const reused=reusedSkill(root,name,options);
    if(reused?.version===version&&reused.sha256===digest)return reused;
    // Don't bypass conflict detection when another active directory exposes the
    // same skill name. Backup directories never count as active installations.
    if(localSkillCandidates(options.searchRoots||[root],name).some(c=>c.directory!==path.resolve(root,name)||c.linked))return null;
    const receipt=installedSkill(root,name);
    if(receipt?.source!=='wanwu-registry'||receipt.name!==name||receipt.version!==version||receipt.sha256!==digest||!Array.isArray(receipt.files)||!receipt.files.length||receipt.files.length>512)return null;
    let total=0;
    const files=receipt.files.map(file=>{
      if(!validSkillPath(file.path))throw Error('Invalid installed path');
      const dest=path.join(root,name);assertNoLink(dest,file.path);
      const target=path.join(dest,file.path),stat=lstatSync(target);total+=stat.size;
      if(!stat.isFile()||total>MAX_SKILL_BYTES||process.platform!=='win32'&&(stat.mode&0o777)!==file.mode)throw Error('Installed file changed');
      if(file.chunks){if(hashSkillFile(target)!==file.sha256||stat.size!==file.size)throw Error('Installed resource changed');return file;}
      return {...file,data:readFileSync(target).toString('base64')};
    });
    validateSkillPackage({schemaVersion:receipt.packageSchema||1,name,version,sha256:digest,files});
    return {...receipt,state:'current'};
  }catch{return null;}
}
// A project sync owns the selected skill version. Stage validated bytes in a
// fresh directory, back up every conflicting entry outside runtime search roots,
// then swap. Moving a symlink never writes through it to an external target.
function backupSkillEntry(source,dest){
  const stat=lstatSync(source);
  if(stat.isSymbolicLink()){symlinkSync(readlinkSync(source),dest);return;}
  if(stat.isDirectory()){
    mkdirSync(dest,{mode:0o700});
    for(const entry of readdirSync(source))backupSkillEntry(path.join(source,entry),path.join(dest,entry));
    chmodSync(dest,stat.mode&0o777);return;
  }
  if(!stat.isFile())throw Error('技能包含无法备份的文件：'+source);
  copyFileSync(source,dest);chmodSync(dest,stat.mode&0o777);
}
function replaceSkillPackage(pkg,{projectId,provider,dataDir,root,searchRoots}) {
  const dest=path.resolve(root,pkg.name),id=Date.now()+'-'+randomUUID();
  mkdirSync(root,{recursive:true});assertNoLink(root);
  const stage=path.join(root,'.wanwu-stage-'+id);
  const entries=localSkillCandidates(searchRoots,pkg.name,{includeAliases:true}).map(c=>c.directory);
  // Also handle an invalid file or a broken link occupying the canonical name.
  try{lstatSync(dest);if(!entries.includes(dest))entries.unshift(dest);}catch(e){if(e.code!=='ENOENT')throw e;}
  const backupRoot=path.resolve(dataDir,'skill-backups',provider,pkg.name,id);
  const backups=entries.map((directory,index)=>({directory,
    backup:directory===dest?path.join(backupRoot,'original'):path.join(backupRoot,'duplicates',String(index)),
    retired:path.join(path.dirname(directory),'.wanwu-old-'+id+'-'+index)}));
  for(const {directory} of backups){
    if(!searchRoots.some(r=>path.resolve(r)===path.dirname(directory)))throw Error('技能目录不在当前终端的技能库中');
    if(backupRoot===directory||backupRoot.startsWith(directory+path.sep))throw Error('技能备份目录不能位于待替换的技能中');
    assertNoLink(path.dirname(directory));
  }
  const moved=[];
  try{
    mkdirSync(stage);
    for(const file of pkg.files){const target=path.join(stage,file.path);mkdirSync(path.dirname(target),{recursive:true});writeSkillFile(file,target);chmodSync(target,file.mode);}
    if(backups.length)mkdirSync(backupRoot,{recursive:true,mode:0o700});
    for(const {directory,backup} of backups){mkdirSync(path.dirname(backup),{recursive:true});backupSkillEntry(directory,backup);}
    if(backups.length)writeFileSync(path.join(backupRoot,'restore.json'),JSON.stringify(backups.map(({directory,backup})=>({directory,backup})),null,2),{mode:0o600});
    const receipt={schemaVersion:1,source:'wanwu-registry',name:pkg.name,version:pkg.version,projectId,provider,sha256:pkg.sha256,installedAt:Date.now(),
      backup:backups.find(b=>b.directory===dest)?.backup||backups[0]?.backup||null,backups:backups.map(({directory,backup})=>({directory,backup})),
      packageSchema:pkg.schemaVersion,files:pkg.files.map(({path,mode,sha256,size,chunks})=>({path,mode,sha256,...(chunks?{size,chunks}:{})}))};
    writeFileSync(path.join(stage,'.wanwu-skill.json'),JSON.stringify(receipt,null,2),{mode:0o600});
    try{
      for(const entry of backups){renameSync(entry.directory,entry.retired);moved.push(entry);}
      renameSync(stage,dest);
    }catch(e){for(const entry of moved.reverse())renameSync(entry.retired,entry.directory);throw e;}
    // A cleanup failure must not misreport a successful install as a conflict.
    // Hidden retired entries are excluded from runtime skill discovery.
    for(const {retired} of backups)try{rmSync(retired,{recursive:true,force:true});}catch{}
    return {...receipt,state:'installed'};
  }finally{if(existsSync(stage))rmSync(stage,{recursive:true,force:true});}
}
export function installSkillPackage(input,{projectId,provider,dataDir,root=skillInstallRoot(provider),searchRoots=skillSearchRoots(provider,root),overwriteModified=false}) {
  const {package:pkg}=validateSkillPackage(input),dest=path.join(root,pkg.name);
  const recorded=installedSkill(root,pkg.name);
  const previous=recorded?.source==='wanwu-registry'&&recorded.name===pkg.name&&Array.isArray(recorded.files)?recorded:null;
  const reuseOptions={root,dataDir,projectId,provider,searchRoots};
  const current=currentInstalledSkill(root,pkg,reuseOptions);
  if(current)return current;
  const candidates=localSkillCandidates(searchRoots,pkg.name);
  const external=candidates.some(c=>c.directory!==path.resolve(dest)||c.linked);
  if(candidates.length&&(external||!previous)&&candidates.every(c=>matchesLocalSkill(c,pkg)))return recordSkillReuse(pkg,reuseOptions,candidates);
  if(overwriteModified)return replaceSkillPackage(pkg,reuseOptions);
  if(candidates.length&&(external||!previous)){
    if(external||!overwriteModified)throw Object.assign(Error('已有同名技能与项目版本不同，已保留本地文件，未重复安装 / Existing local skill differs; preserved without duplicate installation: '+pkg.name),{code:external?'LOCAL_SKILL_CONFLICT':'LOCAL_SKILL_MODIFIED'});
  }
  mkdirSync(root,{recursive:true});assertNoLink(dest,'.wanwu-skill.json');
  const changed=[];
  for(const file of pkg.files)assertNoLink(dest,file.path);
  if(previous?.files)for(const file of previous.files){
    if(!validSkillPath(file.path))throw Error('本地安装记录异常');assertNoLink(dest,file.path);
    const f=path.join(dest,file.path);
    if(!existsSync(f)||!lstatSync(f).isFile()||process.platform!=='win32'&&(lstatSync(f).mode&0o777)!==file.mode||hashSkillFile(f)!==file.sha256)changed.push(file.path);
  }
  // Identical existing files can be adopted without overwriting personal changes.
  const identical=pkg.files.every(f=>{const target=path.join(dest,f.path);return f.path==='assets/skill-icon.svg'&&!existsSync(target)||existsSync(target)&&lstatSync(target).isFile()&&hashSkillFile(target)===f.sha256;});
  if(existsSync(dest)&&!previous&&!identical)changed.push('(现有本地技能尚未纳入版本管理)');
  for(const file of pkg.files){
    if(previous?.files?.some(f=>f.path===file.path))continue;
    const target=path.join(dest,file.path);
    if(existsSync(target)&&(!lstatSync(target).isFile()||hashSkillFile(target)!==file.sha256))changed.push(file.path);
  }
  if(changed.length&&!overwriteModified)throw Object.assign(Error('检测到本地修改，请先确认备份后替换：'+[...new Set(changed)].slice(0,8).join('、')),{code:'LOCAL_SKILL_MODIFIED'});
  if(previous?.sha256===pkg.sha256&&!changed.length&&currentInstalledSkill(root,pkg,reuseOptions))return {...previous,state:'current'};
  const id=Date.now()+'-'+randomUUID(),stage=path.join(root,'.wanwu-stage-'+id),retired=path.join(root,'.wanwu-old-'+id);
  const backup=existsSync(dest)?path.join(dataDir,'skill-backups',provider,pkg.name,id):null;
  try{
    if(backup){mkdirSync(path.dirname(backup),{recursive:true});cpSync(dest,backup,{recursive:true});cpSync(dest,stage,{recursive:true});}
    else mkdirSync(stage,{recursive:true});
    for(const file of previous?.files||[])if(!pkg.files.some(f=>f.path===file.path))rmSync(path.join(stage,file.path),{force:true});
    for(const file of pkg.files){const target=path.join(stage,file.path);mkdirSync(path.dirname(target),{recursive:true});writeSkillFile(file,target);chmodSync(target,file.mode);}
    const receipt={schemaVersion:1,source:'wanwu-registry',name:pkg.name,version:pkg.version,projectId,provider,sha256:pkg.sha256,installedAt:Date.now(),backup,
      packageSchema:pkg.schemaVersion,files:pkg.files.map(({path,mode,sha256,size,chunks})=>({path,mode,sha256,...(chunks?{size,chunks}:{})}))};
    writeFileSync(path.join(stage,'.wanwu-skill.json'),JSON.stringify(receipt,null,2),{mode:0o600});
    if(existsSync(dest))renameSync(dest,retired);
    try{renameSync(stage,dest);}catch(e){if(existsSync(retired))renameSync(retired,dest);throw e;}
    if(existsSync(retired))rmSync(retired,{recursive:true});
    return {...receipt,state:'installed'};
  }finally{if(existsSync(stage))rmSync(stage,{recursive:true,force:true});}
}
export function cacheSkillPackage(input,dataDir) {
  const checked=validateSkillPackage(input),dir=path.join(dataDir,'skill-cache',checked.sha256);
  mkdirSync(dir,{recursive:true});const dest=path.join(dir,'package.json'),tmp=dest+'.'+randomUUID()+'.tmp';
  writeFileSync(tmp,JSON.stringify(checked.package),{mode:0o600});renameSync(tmp,dest);return checked.package;
}
