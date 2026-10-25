import {PROVIDERS} from '../../shared/providers.mjs';
import {captureCanvas} from '../canvas-capture.mjs';
import {SkillRuntimeDiscovery} from './runtime-discovery.mjs';
import {WorkDispatch} from './work-dispatch.mjs';
import {withGeneratedSkillIcon} from '../../shared/skill-presentation.mjs';
import http from 'node:http';
import {ChatShare} from './chat-share.mjs';
import path from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync,readdirSync,existsSync,lstatSync,realpathSync,rmSync} from 'node:fs';
import {skillInstallRoot} from './packages.mjs';
import {skillSearchRoots,activeSkillDirectory} from './local-reuse.mjs';
import {packageSkillDirectory} from '../../shared/skill-directory.mjs';
import {skillFileBytes} from '../../shared/skill-blobs.mjs';
import {uploadSkillBlobs} from './transfer.mjs';
import {skillMetadata} from '../../shared/skill-package.mjs';
import {SkillQuestions} from './questions.mjs';

export class SkillExchange {
  constructor(bridge,{rootFor=skillInstallRoot}={}){this.bridge=bridge;this.rootFor=rootFor;this.chatShare=new ChatShare(bridge);this.workDispatch=new WorkDispatch(bridge);this.tokens=new Map();this.candidates=new Map();this.discovery=new SkillRuntimeDiscovery(this);this.questions=new SkillQuestions(this);this.activeNative=0;}
  async start(){
    if(this.starting)return this.starting;
    this.starting=new Promise((resolve,reject)=>{
      this.server=http.createServer(async(req,res)=>{
        const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
        try{
          const token=req.headers.authorization?.replace(/^Bearer /,''),scope=this.tokens.get(token),discovery=req.url==='/runtime';
          if(req.headers.origin||req.method!=='POST'||!['/runtime','/skills'].includes(req.url)||(discovery?token!==this.discovery.secret:!this.isActive(scope)))return send(403,{error:'当前会话凭据无效或已结束 / Session context expired or invalid'});
          let bytes=0,chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>1100000)return send(413,{error:'请求过大'});chunks.push(chunk);}
          const body=JSON.parse(Buffer.concat(chunks).toString());
          if(discovery)return send(200,await this.discovery.resolve(body));
          if(scope.native&&this.bridge.skillUpdates?.state.status==='syncing')throw Object.assign(Error('万物技能正在同步，请稍后重试'),{status:503});
          if(scope.native)this.activeNative++;
          try{
          if(body.action==='question'){send(200,await this.questions.ask(scope,body));return;}
          let result=body.action==='canvas-capture'?await captureCanvas({request:body=>this.bridge.request(`/api/bridge/skill-assistant/${scope.commandId}`,'POST',body,true),endpoint:this.bridge.store.endpoint,canvasId:body.canvasId,requestId:body.requestId,entry:body.entry,contentRevision:body.contentRevision}):body.action==='work-dispatch-local'?await this.workDispatch.send(scope,body):['chat','voice','audio'].includes(body.action)?await this.chatShare.send(scope,body):await this.bridge.request(`/api/bridge/skill-assistant/${scope.commandId}`,'POST',body,true);
          if(body.action==='canvas-collab-ticket'&&result.path)result={...result,url:new URL(result.path,this.bridge.store.endpoint).href};
          if(body.action==='canvas-share'&&result.path)result={...result,url:new URL(result.path,this.bridge.store.endpoint).href};
          if(body.action==='canvas-file'&&result.path)result={...result,url:new URL(result.path,this.bridge.store.endpoint).href};
          if(body.action==='context'&&result.capabilities)result={...result,capabilities:{...result.capabilities,audioAutoplayUpload:true,workDispatchUpload:true,canvasCapture:false,canvasCoverPage:!!result.capabilities.canvas}};
          const start=Date.now();
          while(result.status==='pending'&&Date.now()-start<90000){
            if(this.closed)throw Error('技能助手已关闭');
            await new Promise(r=>setTimeout(r,350));
            result=await this.bridge.request(`/api/bridge/skill-assistant/${scope.commandId}`,'POST',{action:'result',requestId:result.requestId},true);
          }
          if(body.action==='context'&&result.capabilities)result.capabilities.questionInput=!scope.native;
          if(body.action==='context'&&scope.metadata)result.request=scope.metadata;
          send(200,result);
          }finally{if(scope.native)this.activeNative--;}
        }catch(e){send(e.status||400,{error:e.message});}
      });
      this.server.once('error',reject);this.server.listen(0,'127.0.0.1',()=>{try{if(this.closed){this.server.close();return reject(Error('Runtime closed'));}this.discovery.publish(this.server.address().port);resolve();}catch(e){this.server.close();reject(e);}});this.server.unref();
    });this.starting.catch(()=>{this.starting=null;});return this.starting;
  }
  isActive(scope){return !!scope&&!this.closed&&!this.bridge.stopped&&(scope.native?!!this.bridge.store.deviceToken&&scope.expires>Date.now():this.bridge.busy.has(scope.parentCommandId));}
  async context(c,extra={}){
    await this.start();
    const prior=[...this.tokens].find(([,v])=>v.commandId===c.id);if(prior){Object.assign(prior[1],extra);return prior[1].file;}
    const token=randomBytes(32).toString('hex'),dir=path.join(this.bridge.dataDir,'skill-contexts');mkdirSync(dir,{recursive:true,mode:0o700});
    const file=path.join(dir,c.id+'.json');writeFileSync(file,JSON.stringify({url:`http://127.0.0.1:${this.server.address().port}/skills`,token}),{mode:0o600});
    const parentCommandId=[...this.bridge.busy].find(([,m])=>m.localId===c.local_id&&m.provider===c.provider)?.[0]||c.id;
    this.tokens.set(token,{commandId:c.id,parentCommandId,file,localId:c.local_id,provider:c.provider,...extra});return file;
  }
  release(commandId){for(const [token,v] of this.tokens)if(v.commandId===commandId||v.parentCommandId===commandId){this.questions.release(v.commandId);this.chatShare.release(v.commandId);this.workDispatch.release(v.commandId);rmSync(v.file,{force:true});this.tokens.delete(token);}}
  stop(){this.closed=true;this.questions.close();this.discovery.close();for(const v of this.tokens.values())rmSync(v.file,{force:true});this.tokens.clear();this.chatShare.requests.clear();this.server?.close();}
  catalog(r){
    const b=this.bridge,roots=[];
    for(const provider of b.store.device?.runtimes||PROVIDERS)for(const dir of skillSearchRoots(provider,this.rootFor(provider)))roots.push({dir,label:provider});
    if(r.sessionId){
      const mapping=b.mappings[r.sessionId];if(!mapping?.cwd)throw Error('此会话尚未导入本机或工作目录不可用 / Session is not imported or its workspace is unavailable');
      // Only conventional skill locations in the selected session workspace.
      for(const rel of ['.dsh/skills','.codex/skills','.claude/skills','.agents/skills','skills','bundled-skills'])roots.push({dir:path.join(mapping.cwd,rel),label:'session/'+rel});
      if(existsSync(path.join(mapping.cwd,'SKILL.md')))roots.push({dir:path.dirname(mapping.cwd),only:path.basename(mapping.cwd),label:'session'});
    }
    const found=[],seen=new Set();
    for(const root of roots){
      if(!existsSync(root.dir)||lstatSync(root.dir).isSymbolicLink())continue;
      for(const dirent of readdirSync(root.dir,{withFileTypes:true}).slice(0,1000)){
        if(found.length>=500)break;
        if(!dirent.isDirectory()||!activeSkillDirectory(dirent.name)||root.only&&dirent.name!==root.only)continue;
        const directory=path.join(root.dir,dirent.name),entry=path.join(directory,'SKILL.md');
        if(!existsSync(entry)||lstatSync(entry).isSymbolicLink()||seen.has(realpathSync(directory)))continue;
        try{
          const meta=skillMetadata(readFileSync(entry,'utf8'));let version='1.0.0';
          try{version=JSON.parse(readFileSync(path.join(directory,'.wanwu-skill.json'))).version||version;}catch{}
          const candidateId=randomUUID();this.candidates.set(candidateId,{directory,projectId:r.projectId,sessionId:r.sessionId,commandId:r.commandId,created:Date.now(),canonical:realpathSync(directory)});
          seen.add(realpathSync(directory));found.push({candidateId,...meta,version,location:root.label+'/'+dirent.name});
        }catch{}
      }
    }
    for(const [id,c] of this.candidates)if(Date.now()-c.created>600000)this.candidates.delete(id);
    return {skills:found};
  }
  preview(r){
    const c=this.candidates.get(r.candidateId);
    if(!c||c.projectId!==r.projectId||c.commandId!==r.commandId||Date.now()-c.created>600000||realpathSync(c.directory)!==c.canonical)throw Error('请重新列出技能后选择 / List skills again and select a fresh candidate');
    const pkg=withGeneratedSkillIcon(packageSkillDirectory(c.directory,r.version));
    for(const f of pkg.files){
      let tail='';for(const bytes of skillFileBytes(f)){const content=tail+bytes.toString();
      if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:sk-[a-zA-Z0-9_-]{24,}|AKID[a-zA-Z0-9]{28,})\b/.test(content))throw Error('技能中疑似含有密钥，请移除后再发布 / Remove suspected credentials before publishing: '+f.path);
      tail=content.slice(-256);}
    }
    return {package:pkg};
  }
  async pump(){
    for(const [token,scope] of this.tokens)if(scope.native&&scope.expires<=Date.now()){this.chatShare.release(scope.commandId);this.workDispatch.release(scope.commandId);rmSync(scope.file,{force:true});this.tokens.delete(token);}
    const b=this.bridge;if(this.pumping||this.closed||b.stopped||!b.store.deviceToken)return;this.pumping=true;
    try{for(const r of await b.request('/api/bridge/skill-exchange','GET',undefined,true)){
      let result;try{result=r.action==='catalog'?this.catalog(r):this.preview(r);if(result.package)await uploadSkillBlobs(result.package,(hash,body)=>b.request('/api/bridge/skill-exchange/'+r.id+'/blobs/'+hash,'POST',{name:result.package.name,...body},true));}catch(e){result={error:e.message};}
      await b.request('/api/bridge/skill-exchange/'+r.id,'POST',result,true);
    }}finally{this.pumping=false;}
  }
}
