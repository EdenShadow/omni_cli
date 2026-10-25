import {skillUiBrief,skillUiManifest} from '../../shared/skill-ui.mjs';
import {skillCredentialBrief,skillCredentialManifest} from '../../shared/skill-credentials.mjs';
import {PROVIDERS} from '../../shared/providers.mjs';
import {existsSync,mkdirSync,writeFileSync,readFileSync,readdirSync,chmodSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {readCdn} from '../cdn-download.mjs';
import {writeSkillFile} from '../../shared/skill-blobs.mjs';
import {uploadSkillBlobs,downloadSkillBlobs} from './transfer.mjs';
import {packageSkillDirectory,cacheSkillPackage,installSkillPackage,installedSkill,currentInstalledSkill,skillInstallRoot} from './packages.mjs';
import {skillSearchRoots,reusedSkill} from './local-reuse.mjs';
import {GithubSkills} from './github.mjs';
import {detectRuntimes,installSkills} from '../runtimes.mjs';
import {validSkillName,validSkillVersion,validateSkillPackage,compareSkillVersions,sha256} from '../../shared/skill-package.mjs';
import {skillPresentation,withGeneratedSkillIcon,currentSkillPresentation} from '../../shared/skill-presentation.mjs';
import {skillIconBrief} from '../../shared/skill-icon-art.mjs';
export class DesktopSkills {
  constructor(bridge,{github=new GithubSkills(),detect=detectRuntimes,rootFor=skillInstallRoot,bundled=installSkills}={}){
    Object.assign(this,{bridge,github,detect,rootFor,bundled});
    this.drafts=new Map();this.sources=new Map();this.draftMeta=new Map();this.jobs=new Map();this.installing=new Set();this.scans=new Map();
    this.syncJobs=new Map();this.syncTail=Promise.resolve();this.syncState={status:'idle'};this.closed=false;
  }
  stop(){this.closed=true;clearTimeout(this.syncTimer);}
  localOptions(provider){const root=this.rootFor(provider);return {dataDir:this.bridge.dataDir,searchRoots:skillSearchRoots(provider,root)};}
  scheduleSync(projectId,checkSources=false){
    if(this.closed||!projectId)return;
    clearTimeout(this.syncTimer);
    this.pendingSourceCheck=!!this.pendingSourceCheck||checkSources;
    this.syncTimer=setTimeout(()=>{
      const check=this.pendingSourceCheck;this.pendingSourceCheck=false;
      // Binding may finish while this unbound-client background check is queued.
      // Let the device barrier verify content before entering an update state.
      if(this.bridge.store.deviceToken&&this.bridge.skillUpdates){this.bridge.skillUpdates.invalidate();return;}
      void this.syncAll({projectId,checkSources:check}).catch(()=>{});
    },600);
    this.syncTimer.unref?.();
  }
  async scanGithub({url}){
    const scan=await this.github.scan(url),scanId=randomUUID();
    // Scan IDs refer to immutable commit trees and never to caller-provided file paths.
    for(const [id,s] of this.scans)if(Date.now()-s.created>600000)this.scans.delete(id);
    if(this.scans.size>=8)this.scans.delete(this.scans.keys().next().value);
    this.scans.set(scanId,{...scan,created:Date.now()});
    return {scanId,repository:scan.source.owner+'/'+scan.source.repo,ref:scan.source.ref,commit:scan.source.commit,
      skills:scan.directories.map(directory=>({directory,label:directory||scan.source.directory.split('/').at(-1)||scan.source.repo}))};
  }
  async importGithub({scanId,directory,version='1.0.0'}){
    const scan=this.scans.get(scanId);
    if(!scan||Date.now()-scan.created>600000||!scan.directories.includes(directory))throw Error('请重新读取 GitHub 技能列表');
    if(!validSkillVersion(version))throw Error('请输入有效的版本号');
    const prefix=directory?directory+'/':'';
    const source={...scan.source,directory:[scan.source.directory,directory].filter(Boolean).join('/')};
    const entries=scan.entries.filter(e=>e.path.startsWith(prefix)).map(e=>({...e,path:e.path.slice(prefix.length)})).filter(e=>e.path);
    const pkg=await this.github.package(source,entries,version),id=randomUUID();this.saveDraft(id,pkg,source);
    return this.preview(id,pkg);
  }
  async verifyPlan(plan){
    const skills=new Map(plan.projects.flatMap(p=>p.skills).map(s=>[s.name,s]));
    if(!skills.size)return true;
    const runtimes=(await this.detect()).filter(r=>r.available).map(r=>r.provider);
    if(!runtimes.length||(plan.runtimes||[]).some(p=>!runtimes.includes(p)))return false;
    return runtimes.every(provider=>[...skills.values()].every(skill=>currentInstalledSkill(this.rootFor(provider),skill,this.localOptions(provider))));
  }
  async recordPlan(plan){
    const runtimes=(await this.detect()).filter(r=>r.available).map(r=>r.provider);
    for(const project of plan.projects)for(const skill of project.skills)for(const provider of runtimes){
      if(this.closed||this.bridge.stopped)throw Error('技能同步已停止');
      if(!currentInstalledSkill(this.rootFor(provider),skill,this.localOptions(provider)))throw Error('本地技能已有变化，请重新校验 / Local skills changed; verify again.');
      await this.bridge.request(`/api/projects/${project.id}/skills/${skill.name}/installs`,'POST',{provider,version:skill.version,sha256:skill.sha256,deviceId:this.bridge.store.device.id});
    }
  }
  syncAll({projectId,checkSources=true,barrier=false}={}){
    if(!barrier&&this.bridge.store.deviceToken&&this.bridge.skillUpdates)return this.bridge.skillUpdates.manual(()=>this.syncAll({projectId,checkSources,barrier:true}));
    if(!/^[a-zA-Z0-9-]+$/.test(projectId))return Promise.reject(Error('请先选择项目'));
    const key=projectId+':'+checkSources;if(this.syncJobs.has(key))return this.syncJobs.get(key);
    const job=this.syncTail.catch(()=>{}).then(()=>this.runSync(projectId,checkSources));
    this.syncJobs.set(key,job);this.syncTail=job;
    job.finally(()=>this.syncJobs.delete(key)).catch(()=>{});return job;
  }
  async runSync(projectId,checkSources){
    const assertActive=()=>{if(this.closed||this.bridge.stopped)throw Error('技能同步已停止');};
    assertActive();
    const emit=state=>{this.syncState={...state,projectId};this.bridge.notify?.({type:'skill-sync',...this.syncState});};
    const result={projectId,updated:0,current:0,errors:[],runtimes:[],finishedAt:null};
    emit({status:'running'});
    try{
      const runtimes=(await this.detect()).filter(r=>r.available);result.runtimes=runtimes.map(r=>r.provider);
      if(!runtimes.length)throw Error('未检测到本机 AI Runtime');
      const bundledResults=[];
      if(this.bridge.skillsRoot)for(const r of runtimes){
        assertActive();try{bundledResults.push(...this.bundled(this.bridge.skillsRoot,r.provider));}
        catch(e){result.errors.push({name:'内置技能',provider:r.provider,message:e.message});}
      }
      let catalog=await this.bridge.request(`/api/projects/${projectId}/skills`);assertActive();
      for(const item of bundledResults)if(!catalog.items.some(s=>s.name===item.name))result[item.state==='installed'?'updated':'current']++;
      if(checkSources)this.github.beginCheck?.();
      if(checkSources)for(const item of catalog.items.filter(i=>i.autoUpdate&&i.source&&i.canEdit)){
        try{
          const previous=item.versions[0].version,parts=previous.split('.');parts[2]=String(BigInt(parts[2])+1n);
          const update=await this.github.update(item.source,parts.join('.'));assertActive();
          if(update){
            const old=await this.sync({projectId,name:item.name,version:previous});assertActive();
            if(update.package.name!==item.name)throw Error('GitHub 技能名称已改变，请重新导入');
            const same=JSON.stringify(update.package.files)===JSON.stringify(old.files);
            if(same)await this.bridge.request(`/api/projects/${projectId}/skills/${item.name}/source`,'PATCH',{source:update.source});
            else try{await uploadSkillBlobs(update.package,(hash,body)=>this.bridge.request(`/api/projects/${projectId}/skills/${update.package.name}/blobs/${hash}`,body?'POST':'GET',body));await this.bridge.request(`/api/projects/${projectId}/skills`,'POST',{package:update.package,source:update.source,notes:`GitHub ${update.source.ref} · ${update.source.commit.slice(0,12)}`});}
            catch(e){if(e.status!==409)throw e;} // A second device may have published the same update first; re-read below.
          }
        }catch(e){assertActive();result.errors.push({name:item.name,phase:'github',message:e.message});}
      }
      catalog=await this.bridge.request(`/api/projects/${projectId}/skills`);assertActive();
      for(const item of catalog.items){
        let version=item.activeVersion;
        if(item.autoUpdate&&item.canEdit&&version!==item.versions[0].version){
          await this.bridge.request(`/api/projects/${projectId}/skills/${item.name}`,'PATCH',{autoUpdate:true});version=item.versions[0].version;
        }
        for(const r of runtimes){
          assertActive();
          try{const installed=await this.install({projectId,name:item.name,version,provider:r.provider,expectedSha:item.versions.find(v=>v.version===version)?.sha256});if(this.bridge.store.deviceToken&&!installed.recorded)throw Error('安装回执未送达，请重试 / Installation receipt could not be recorded. Retry syncing.');result[installed.state==='current'?'current':'updated']++;}
          catch(e){assertActive();result.errors.push({name:item.name,provider:r.provider,message:e.message});}
        }
      }
      result.finishedAt=Date.now();emit({status:result.errors.length?'partial':'done',result});return result;
    }catch(e){emit({status:'error',error:e.message});throw e;}
  }
  async sync({projectId,name,version}){
    if(!/^[a-zA-Z0-9-]+$/.test(projectId)||!validSkillName(name)||!validSkillVersion(version))throw Error("技能请求参数无效");
    let pkg=await this.bridge.request(`/api/projects/${projectId}/skills/${name}/${version}/package?cdn=1`);
    if(pkg.download){const bytes=await readCdn(pkg.download,{sha256:pkg.download.sha256});pkg=validateSkillPackage({...JSON.parse(bytes),sha256:pkg.download.sha256}).package;}
    await downloadSkillBlobs(pkg,hash=>this.bridge.request(`/api/projects/${projectId}/skills/${name}/${version}/blobs/${hash}`));
    return cacheSkillPackage(pkg,this.bridge.dataDir);
  }
  // Manual sync uses the same queue and project version as automatic sync. There
  // is deliberately no provider argument: every available terminal gets it.
  syncSkill({projectId,name,overwriteModified=true,barrier=false}){
    if(!barrier&&this.bridge.store.deviceToken&&this.bridge.skillUpdates)return this.bridge.skillUpdates.manual(()=>this.syncSkill({projectId,name,overwriteModified,barrier:true}));
    if(!/^[a-zA-Z0-9-]+$/.test(projectId)||!validSkillName(name))return Promise.reject(Error('技能请求参数无效'));
    const job=this.syncTail.catch(()=>{}).then(async()=>{
      const emit=state=>{this.syncState={...state,projectId};this.bridge.notify?.({type:'skill-sync',...this.syncState});};
      emit({status:'running'});
      try{
      const catalog=await this.bridge.request(`/api/projects/${projectId}/skills`),item=catalog.items.find(s=>s.name===name);
      if(!item)throw Error('项目中没有这个技能');
      const runtimes=(await this.detect()).filter(r=>r.available),result={projectId,updated:0,current:0,errors:[],runtimes:runtimes.map(r=>r.provider),finishedAt:null};
      if(!runtimes.length)throw Error('未检测到本机 AI Runtime');
      const pkg=await this.sync({projectId,name,version:item.activeVersion});
      for(const {provider} of runtimes){
        try{const installed=await this.install({projectId,name,version:item.activeVersion,provider,overwriteModified},pkg);result[installed.state==='current'?'current':'updated']++;}
        catch(e){result.errors.push({name,provider,code:e.code,message:e.message});}
      }
      result.finishedAt=Date.now();emit({status:result.errors.length?'partial':'done',result});return result;
      }catch(e){emit({status:'error',error:e.message});throw e;}
    });
    this.syncTail=job;return job;
  }
  async status({projectId}){
    const catalog=await this.bridge.request(`/api/projects/${projectId}/skills`);
    return Object.fromEntries(catalog.items.map(item=>[item.name,Object.fromEntries(PROVIDERS.map(provider=>[provider,reusedSkill(this.rootFor(provider),item.name,this.localOptions(provider))||installedSkill(this.rootFor(provider),item.name)]))]));
  }
  async install({projectId,name,version,provider,overwriteModified=true,expectedSha},cachedPackage){
    if(!validSkillName(name)||!validSkillVersion(version))throw Error('技能名称或版本无效');
    const lock=provider+':'+name;if(this.installing.has(lock))throw Error('此技能正在安装');this.installing.add(lock);
    try{
      const localOptions=this.localOptions(provider);
      const current=expectedSha&&currentInstalledSkill(this.rootFor(provider),{name,version,sha256:expectedSha},localOptions);
      const pkg=current||cachedPackage||await this.sync({projectId,name,version});
      if(pkg.name!==name||pkg.version!==version||expectedSha&&pkg.sha256!==expectedSha)throw Error('项目技能版本已变化，请重新同步 / Project skill version changed; sync again.');
      if(this.closed||this.bridge.stopped)throw Error('技能同步已停止');
      const result=current||installSkillPackage(pkg,{projectId,provider,root:this.rootFor(provider),overwriteModified,...localOptions});
      let recorded=false;
      if(this.bridge.store.device)try{
        await this.bridge.request(`/api/projects/${projectId}/skills/${name}/installs`,'POST',{provider,version,sha256:pkg.sha256,deviceId:this.bridge.store.device.id});recorded=true;
      }catch{}
      return {...result,recorded};
    }finally{this.installing.delete(lock);}
  }
  async inspectDirectory({directory,version}){
    const pkg=packageSkillDirectory(directory,version),id=randomUUID();this.saveDraft(id,pkg);
    return this.preview(id,pkg);
  }
  draftRoot(){return path.join(this.bridge.dataDir,'skill-drafts',sha256((this.bridge.store.endpoint||'')+'|'+(this.bridge.store.userId||'local')));}
  saveDraft(id,pkg,source=null,meta=null){this.drafts.set(id,pkg);if(source)this.sources.set(id,source);if(meta)this.draftMeta.set(id,meta);mkdirSync(this.draftRoot(),{recursive:true});writeFileSync(path.join(this.draftRoot(),id+'.json'),JSON.stringify({package:pkg,source,meta}),{mode:0o600});}
  listDrafts(){
    if(existsSync(this.draftRoot()))for(const file of readdirSync(this.draftRoot()))if(/^[a-f0-9-]+\.json$/.test(file))try{const saved=JSON.parse(readFileSync(path.join(this.draftRoot(),file))),pkg=validateSkillPackage(saved.package||saved).package,id=file.slice(0,-5);if(saved.meta?.basePackage)validateSkillPackage(saved.meta.basePackage);this.drafts.set(id,pkg);if(saved.source)this.sources.set(id,saved.source);if(saved.meta)this.draftMeta.set(id,saved.meta);}catch{}
    return {drafts:[...this.drafts].map(([id,pkg])=>this.preview(id,pkg)),jobs:[...this.jobs].map(([jobId,j])=>({jobId,...j}))};
  }
  preview(id,pkg){
    const meta=this.draftMeta.get(id),base=meta?.basePackage,old=new Map(base?.files.map(f=>[f.path,f])||[]),current=new Map(pkg.files.map(f=>[f.path,f]));
    const changes=base?[...new Set([...old.keys(),...current.keys()])].sort().flatMap(p=>{
      const before=old.get(p),after=current.get(p);
      return before?.sha256===after?.sha256&&before?.mode===after?.mode?[]:[{path:p,status:!before?'added':!after?'removed':'modified'}];
    }):pkg.files.map(f=>({path:f.path,status:'added'}));
    return {ui:skillUiManifest(pkg),credentials:skillCredentialManifest(pkg).credentials,presentation:currentSkillPresentation(skillPresentation(pkg),pkg.name,pkg.description),source:this.sources.get(id)||null,draftId:id,name:pkg.name,version:pkg.version,description:pkg.description,sha256:pkg.sha256,files:pkg.files.map(f=>f.path),markdown:Buffer.from(pkg.files.find(f=>f.path==='SKILL.md').data,'base64').toString(),projectId:meta?.projectId,provider:meta?.provider,baseVersion:base?.version,changes,created:meta?.created,detachedGithub:meta?.detachedGithub};
  }
  draftFile({draftId,file}){
    this.listDrafts();const pkg=this.drafts.get(draftId),base=this.draftMeta.get(draftId)?.basePackage;
    if(!pkg)throw Error('草稿不存在');
    const before=base?.files.find(f=>f.path===file),after=pkg.files.find(f=>f.path===file);
    if(!before&&!after)throw Error('草稿中没有这个文件');
    const text=f=>{if(!f)return '';if(f.chunks)return null;const data=Buffer.from(f.data,'base64'),value=data.toString('utf8');return data.length>131072||data.includes(0)||!Buffer.from(value).equals(data)?null:value;};
    return {path:file,before:text(before),after:text(after),beforeMode:before?.mode,afterMode:after?.mode};
  }
  async publish({projectId,draftId,notes}){
    this.listDrafts();
    const pkg=this.drafts.get(draftId);if(!pkg)throw Error('草稿已过期，请重新预览');
    const meta=this.draftMeta.get(draftId);
    if(meta?.projectId&&meta.projectId!==projectId)throw Error('此草稿属于其他项目，请切换到原项目发布');
    if(meta?.basePackage){
      const catalog=await this.bridge.request(`/api/projects/${projectId}/skills`),item=catalog.items.find(s=>s.name===pkg.name);
      if(!item?.canEdit)throw Error('只有技能作者或项目发起者可以编辑此技能');
      const published=item.versions.find(r=>r.version===pkg.version);
      if(published&&published.sha256!==pkg.sha256)throw Error('此版本已发布，请重新编辑并使用新的版本号');
      if(!published&&(item.versions[0].version!==meta.latestVersion||compareSkillVersions(pkg.version,item.versions[0].version)<=0))throw Error('此技能已有更新版本，请基于最新版本重新编辑');
    }
    await uploadSkillBlobs(pkg,(hash,body)=>this.bridge.request(`/api/projects/${projectId}/skills/${pkg.name}/blobs/${hash}`,body?'POST':'GET',body));
    const published=await this.bridge.request(`/api/projects/${projectId}/skills`,'POST',{package:pkg,notes,source:this.sources.get(draftId)||null,restore:true,origin:meta?.origin==='created'?'created':'imported'});
    if(meta?.basePackage)try{await this.bridge.request(`/api/projects/${projectId}/skills/${pkg.name}`,'PATCH',{version:pkg.version,autoUpdate:meta.autoUpdate});}
    catch(e){throw Error('版本已发布，但项目版本切换失败，请在版本历史中启用新版本：'+e.message);}
    return published;
  }
  async edit({projectId,name,baseVersion,version,prompt,provider}){
    this.bridge.skillUpdates?.assertAvailable();
    if(!/^[a-zA-Z0-9-]+$/.test(projectId)||!validSkillName(name)||!validSkillVersion(baseVersion)||!validSkillVersion(version)||typeof prompt!=='string'||!prompt.trim()||prompt.length>15000)throw Error('请填写有效的编辑说明和新版本号');
    const runtimes=await this.detect();if(!runtimes.some(r=>r.provider===provider&&r.available))throw Error('所选 AI 终端尚未安装');
    const catalog=await this.bridge.request(`/api/projects/${projectId}/skills`),item=catalog.items.find(s=>s.name===name);
    if(!item?.canEdit)throw Error('只有技能作者或项目发起者可以编辑此技能');
    if(!item.versions.some(r=>r.version===baseVersion))throw Error('原版本不存在');
    if(compareSkillVersions(version,item.versions[0].version)<=0)throw Error('新版本号必须高于所有已发布版本');
    const basePackage=await this.sync({projectId,name,version:baseVersion}),jobId=randomUUID(),dir=path.join(this.draftRoot(),jobId),output=path.join(dir,name);
    mkdirSync(output,{recursive:true});
    for(const file of basePackage.files){const dest=path.join(output,file.path);mkdirSync(path.dirname(dest),{recursive:true});writeSkillFile(file,dest);chmodSync(dest,file.mode);}
    const instruction=`Edit the existing agent skill in ${output}, copied from immutable version ${baseVersion}. This is a revision, not a replacement: inspect SKILL.md and supporting files, apply the requested changes, and preserve unrelated behavior, references, scripts, file permissions and the icon. Keep the frontmatter name exactly ${name}. The new release version is ${version}. Change version metadata only where it already exists. Work only inside this draft folder. Do not install/activate skills, change global configuration, upload, run generated scripts, or include credentials, hidden files, symlinks, node_modules or build output. Save actual files, not just suggestions. ${skillCredentialBrief} ${skillUiBrief} User edit request:\n${prompt}`;
    const meta={projectId,provider,basePackage,latestVersion:item.versions[0].version,autoUpdate:item.autoUpdate,detachedGithub:!!item.source,created:Date.now()};
    writeFileSync(path.join(dir,'DRAFT.md'),instruction,{mode:0o600});
    const adapter=this.bridge.adapter(provider),localId=await adapter.create(dir);
    this.jobs.set(jobId,{projectId,provider,localId,name,version,kind:'edit'});
    this.finish({adapter,localId,instruction,output,version,jobId,meta,expectedName:name}).catch(()=>{});
    return {jobId};
  }
  async generate({name,version,prompt,provider,projectId}){
    this.bridge.skillUpdates?.assertAvailable();
    if(!validSkillName(name)||!validSkillVersion(version)||typeof prompt!=='string'||!prompt.trim()||prompt.length>15000)throw Error('请填写技能名称、三段版本号和创作描述');
    const jobId=randomUUID(),dir=path.join(this.draftRoot(),jobId),output=path.join(dir,name);
    mkdirSync(output,{recursive:true});
    const instruction=`Create an agent skill inside ${output}. The entry file must be SKILL.md with YAML frontmatter name: ${name} and a meaningful description describing when to use it. Add a short human-friendly display_name in the frontmatter using the user language. ${skillIconBrief} Add references and scripts only if needed. This is version ${version}. Work only inside this draft folder; do not install or activate skills, modify global configuration, upload, or run generated scripts. Keep it self-contained and do not include credentials, hidden files, symlinks, node_modules or build output. Save actual files and include concise usage examples and failure handling. ${skillCredentialBrief} ${skillUiBrief} User request:\n${prompt}`;
    writeFileSync(path.join(dir,'DRAFT.md'),instruction,{mode:0o600});
    const adapter=this.bridge.adapter(provider),localId=await adapter.create(dir);
    const meta={projectId,provider,origin:'created',created:Date.now()};
    this.jobs.set(jobId,{projectId,provider,localId,name,version});
    this.finish({adapter,localId,instruction,output,version,jobId,meta,expectedName:name}).catch(()=>{});
    return {jobId};
  }
  async finish({adapter,localId,instruction,output,version,jobId,meta,expectedName}){
    const emit=detail=>this.bridge.notify({type:'skill-generation',jobId,projectId:meta?.projectId,...detail});
    try{
      const result=await adapter.run(localId,instruction,payload=>emit({status:'running',payload}),{fresh:true,approvalScope:'creation',projectId:meta?.projectId});
      if(result?.cancelled||this.jobs.get(jobId)?.cancelled)throw Error('技能生成已取消');
      if(this.closed||this.bridge.stopped)throw Error('技能创作已停止');
      let pkg=withGeneratedSkillIcon(packageSkillDirectory(output,version));
      // Windows stat cannot recover POSIX executable bits from the draft.
      // Retain the published modes so edits do not break scripts on Mac/Linux.
      if(process.platform==='win32'&&meta?.basePackage){
        const modes=new Map(meta.basePackage.files.map(file=>[file.path,file.mode]));
        pkg=validateSkillPackage({...pkg,sha256:undefined,files:pkg.files.map(file=>({...file,mode:modes.get(file.path)??file.mode}))}).package;
      }
      const id=randomUUID();
      if(expectedName&&pkg.name!==expectedName)throw Error('技能名称被改变，请重新编辑并保留原名称');
      if(meta?.basePackage&&JSON.stringify(pkg.files)===JSON.stringify(meta.basePackage.files))throw Error('尚未检测到文件改动，请补充编辑要求后重试');
      this.saveDraft(id,pkg,null,meta);
      emit({status:'ready',preview:this.preview(id,pkg)});
    }catch(e){emit({status:'error',error:e.message});}
    finally{this.jobs.delete(jobId);}
  }
  async cancel({jobId}){const job=this.jobs.get(jobId);if(job){job.cancelled=true;await this.bridge.adapter(job.provider).cancel(job.localId);}return {ok:true};}
}
