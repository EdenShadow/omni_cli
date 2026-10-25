import {PROVIDERS} from '../shared/providers.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {validateAnnouncement,announcementContract} from '../shared/team-board.mjs';
export class AnnouncementDrafts {
 constructor(bridge){this.bridge=bridge;this.jobs=new Map();this.closed=false;}
 root(scope){if(scope)return path.join(this.bridge.dataDir,'announcement-drafts',scope);const identity=JSON.stringify([this.bridge.store.endpoint,this.bridge.store.userId||this.bridge.store.user?.id||this.bridge.store.token]);return path.join(this.bridge.dataDir,'announcement-drafts',createHash('sha256').update(identity).digest('hex').slice(0,24));}
 save(job){const root=this.root(job.scope);fs.mkdirSync(root,{recursive:true});const file=path.join(root,job.jobId+'.json');fs.writeFileSync(file+'.tmp',JSON.stringify(job),{mode:0o600});fs.renameSync(file+'.tmp',file);}
 list({projectId}){if(!fs.existsSync(this.root()))return [];return fs.readdirSync(this.root()).filter(n=>n.endsWith('.json')).flatMap(n=>{try{const saved=JSON.parse(fs.readFileSync(path.join(this.root(),n),'utf8'));if(saved.projectId!==projectId)return [];const job=this.jobs.get(saved.jobId)||saved;return [{...job,...(job.status==='running'&&!this.jobs.has(job.jobId)?{status:'error',error:'上次创作被中断，请重新生成。已有草稿仍保留。'}:{})}];}catch{return [];}}).sort((a,b)=>b.created-a.created).slice(0,12);}
 async generate({projectId,provider,prompt,basePage,revision}){
  if(!PROVIDERS.includes(provider)||typeof prompt!=='string'||!prompt.trim()||prompt.length>15000)throw Error('请选择创作终端并填写公告要求');
  if(this.list({projectId}).some(j=>j.status==='running'))throw Error('此项目的公告正在创作中');
  const published=await this.bridge.request(`/api/projects/${encodeURIComponent(projectId)}/announcements`);
  if(basePage&&(!Number.isInteger(revision)||revision!==(published?.revision||0)))throw Error('团队公告已有更新，请先重新载入最新版本');
  const base=basePage?validateAnnouncement(basePage):published;
  const job={scope:path.basename(this.root()),jobId:randomUUID(),projectId,provider,prompt,revision:published?.revision||0,created:Date.now(),status:'running',progress:[]};this.jobs.set(job.jobId,job);this.save(job);
  void this.finish(job,base);return job;
 }
 async finish(job,base){
  try{
   const dir=path.join(this.root(job.scope),job.jobId);fs.mkdirSync(path.join(dir,'output'),{recursive:true});
   if(base)fs.writeFileSync(path.join(dir,'base.json'),JSON.stringify(base,null,2));
   const source=path.join(this.bridge.skillsRoot,'announcement-designer','SKILL.md');
   // Resolve the project's active version so edits made in the Skills panel also apply here.
   let skill=fs.existsSync(source)?fs.readFileSync(source,'utf8'):'';
   try{const catalog=await this.bridge.request(`/api/projects/${job.projectId}/skills`);const active=catalog.items.find(s=>s.name==='announcement-designer');const pkg=active?await this.bridge.skills?.sync({projectId:job.projectId,name:'announcement-designer',version:active.activeVersion}):null;const f=pkg?.files.find(f=>f.path==='SKILL.md');if(f)skill=Buffer.from(f.data,'base64').toString('utf8');}catch{}
   const instruction=`Create or revise this team's interactive announcement. Work only inside ${dir}. Read base.json when present. ${announcementContract}\n\nSkill guidance:\n${skill}\n\nUser request:\n${job.prompt}`;
   fs.writeFileSync(path.join(dir,'CREATION.md'),instruction);
   const adapter=this.bridge.adapter(job.provider);job.localId=await adapter.create(dir);
   if(job.cancelled||this.closed)throw Error('公告创作已停止');
   const result=await adapter.run(job.localId,instruction,p=>{if(typeof p.text==='string'){job.progress=[...job.progress,{text:p.text.slice(-4000),kind:p.kind}].slice(-80);this.save(job);}},{fresh:true,approvalScope:'creation',projectId:job.projectId});
   if(result?.cancelled||job.cancelled||this.closed)throw Error('公告创作已停止');
   const file=path.join(dir,'output','announcement.json'),stat=fs.lstatSync(file);
   if(stat.isSymbolicLink()||!stat.isFile()||stat.size>1200000||!fs.realpathSync(file).startsWith(fs.realpathSync(dir)+path.sep))throw Error('公告输出文件无效');
   job.page=validateAnnouncement(JSON.parse(fs.readFileSync(file,'utf8')));job.status='ready';
  }catch(e){job.status='error';job.error=e.message;}
  finally{this.save(job);this.jobs.delete(job.jobId);this.bridge.notify({type:'announcement-generation',...job});}
 }
 async cancel({jobId}){const job=this.jobs.get(jobId);if(job){job.cancelled=true;if(job.localId)await this.bridge.adapter(job.provider).cancel(job.localId);}return {ok:true};}
 stop(){this.closed=true;for(const job of this.jobs.values()){job.cancelled=true;if(job.localId)void this.bridge.adapter(job.provider).cancel(job.localId).catch(()=>{});}}
}
