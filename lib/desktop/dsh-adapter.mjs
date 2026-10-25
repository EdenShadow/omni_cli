import {homedir} from 'node:os';
import {redactSecretValues as redactSecrets} from '../shared/conversation-privacy.mjs';
import {spawnRuntime,runtimeSearchPath} from './runtime-launch.mjs';
import {createInterface} from 'node:readline';
import {readFileSync,mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {desktopDshLaunch,dshModelProfiles} from './dsh-desktop.mjs';
import {dshItems,DshStream} from '../shared/dsh-content.mjs';
import {runtimeAnswerValues} from '../shared/runtime-questions.mjs';
import {askRuntimeQuestion} from './runtime-question-flow.mjs';
import {bundledNode,dshHome,dshHostPlugin} from './dsh-paths.mjs';
import {DshUsage} from './token-usage.mjs';
import {DshRunCompletion} from './dsh-run-completion.mjs';
import {runtimeSessionTitle} from '../shared/runtime-session-title.mjs';
import {DshStreamRelay} from './dsh-stream-relay.mjs';
export class DshAdapter {
  constructor(executable,ask,{provider='dsh',environment=()=>({}),patches=[],beforeStart=()=>{},home=()=>dshHome(provider),node=()=>bundledNode()}={}){
    Object.assign(this,{executable,ask,provider,environment,patches,beforeStart,home,node});this.pending=new Map();this.running=new Map();this.approvals=new Map();
  }
  async start(){
    if(this.closed)throw Error('DSH 已停止');
    if(this.starting)return this.starting;
    this.starting=(async()=>{
      await this.beforeStart();
      if(this.closed)throw Error('DSH 已停止');
      const home=this.home();mkdirSync(home,{recursive:true,mode:0o700});
      const plugin=dshHostPlugin();
      const overlay=path.join(home,'.wanwu-host.patch.yml');
      writeFileSync(overlay,JSON.stringify([{insert:[{id:'wanwu-host',name:pathToFileURL(plugin).href}]},{id:'hmr',disabled:true}]),{mode:0o600});
      const env={...process.env,...this.environment(),DSH_HOME:home,WANWU_AI_RUNTIME_PROVIDER:this.provider,DSH_TELEMETRY_DISABLED:'1'};
      delete env.ELECTRON_RUN_AS_NODE;
      // Nested launches must not inherit another runtime's session identity.
      delete env.CODEX_THREAD_ID;delete env.CLAUDE_SESSION_ID;
      // External executables keep their launcher; the internal copy uses a
      // packaged Node binary and therefore works without Homebrew or Node.
      const executable=typeof this.executable==='function'?this.executable():this.executable,js=/\.(?:mjs|cjs|js)$/.test(executable);
      const desktop=this.provider==='dsh'?desktopDshLaunch(executable):null;
      const command=desktop?.command||(js?(this.provider==='wanwu'?this.node():'node'):executable);
      env.PATH=[...(this.provider==='wanwu'?[path.dirname(this.node())]:[]),runtimeSearchPath({env})].join(path.delimiter);
      const patches=typeof this.patches==='function'?this.patches():this.patches;
      const args=[...(desktop?.args||(js?[executable]:[])),'web',...patches.flatMap(p=>['--patch',p]),'--patch',overlay,'--no-open','--host','127.0.0.1','--port','0'];
      const child=this.child=spawnRuntime(command,args,{env,electronNode:!!desktop,stdio:['pipe','ignore','pipe','pipe']});
      // Never forward raw startup logs: they may contain provider credentials.
      child.stderr.on('data',()=>{});
      const ready=new Promise((resolve,reject)=>{this.ready={resolve,reject};});
      createInterface({input:child.stdio[3]}).on('line',line=>{try{void this.receive(JSON.parse(line));}catch{}});
      child.once('error',()=>{if(this.child===child)this.fail(Error('DSH 启动失败，请检查安装和本机配置'));});
      child.once('exit',code=>{if(this.child===child)this.fail(Error(`DSH 已退出（${code??'停止'}），请重试或检查本机配置`));});
      const timer=setTimeout(()=>{this.fail(Error('DSH 启动超时，请检查版本与本机配置'));child.kill('SIGTERM');},60000);
      try{await ready;}finally{clearTimeout(timer);}
    })();
    try{await this.starting;}catch(e){this.starting=null;throw e;}
  }
  fail(error){this.ready?.reject(error);this.ready=null;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();for(const r of this.running.values())r.reject(error);this.running.clear();for(const a of this.approvals.values())a.abort();this.approvals.clear();this.starting=null;this.child=null;}
  async rpc(method,params={}){
    if(this.provider==='dsh'&&['models','configure'].includes(method))params={...params,modelProfiles:dshModelProfiles(this.home())};
    await this.start();const child=this.child;if(!child?.stdin?.writable)throw Error('DSH 连接已关闭');const id=randomUUID();return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('DSH 操作超时'));},60000);
      this.pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,method,params})+'\n',error=>{if(error){clearTimeout(timer);this.pending.delete(id);reject(Error('DSH 连接已关闭'));}});
    });
  }
  async receive(m){
    if(m.method==='ready'){this.ready?.resolve();this.ready=null;return;}
    if(m.id){const p=this.pending.get(m.id);if(!p)return;this.pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(redactSecrets(m.error.message))):p.resolve(m.result);return;}
    const p=m.params||{},run=this.running.get(p.sessionId);
    if(m.method==='approval-cancel'){this.approvals.get(p.id)?.abort();return;}
    if(m.method==='permission'||m.method==='question'){
      const abort=new AbortController();this.approvals.set(p.id,abort);
      try{
        const ask=details=>m.method==='question'?askRuntimeQuestion(this.ask,details,run?.emit):this.ask(details);
        const value=run?await ask({provider:this.provider,requestId:p.id,signal:abort.signal,approvalScope:run.options.approvalScope,commandId:run.options.commandId,projectId:run.options.projectId,kind:m.method==='question'?'question':'permission',title:m.method==='question'?'DSH 需要你的回答':'DSH 请求操作权限',detail:[p.toolName,p.reason].filter(Boolean).join('\n'),questions:p.questions}):false;
        const answer=m.method==='question'&&value!==false?{answers:(p.questions||[]).map((q,i)=>{const values=runtimeAnswerValues(value,q,i),labels=new Set((q.options||[]).map(o=>o.label));return {id:q.id,selected:values.filter(v=>labels.has(v)),custom:values.filter(v=>!labels.has(v)).join('\n')};})}:value;
        await this.rpc('answer',{id:p.id,answer});
      }catch{await this.rpc('answer',{id:p.id,answer:false}).catch(()=>{});}finally{this.approvals.delete(p.id);}return;
    }
    if(!run)return;
    if(m.method==='stream'){
      const items=run.stream.accept(p.frame);
      if(run.relay)run.relay.push(items);else items.forEach(run.emit);
    }
    if(m.method==='event'){
      if(run.seen.has(p.event.seq))return;
      run.seen.add(p.event.seq);
      run.relay?.flush();
      dshItems(p.sessionId,p.event,{attemptId:run.stream.current}).forEach(run.emit);
      if(['assistant/message','assistant/attempt'].includes(p.event.type)){
        const accounting=run.usage.accept(p.event);if(accounting)run.emit({kind:'usage',accounting});
      }
      const reason=run.completion.accept(p.event);if(reason)this.finishRun(run,reason);
    }
    if(m.method==='status'){
      if(p.status==='idle')void this.checkRun(p.sessionId,run);
    }
  }
  finishRun(run,reason){
    if(run.settled)return;run.relay?.flush();run.settled=true;
    if(reason.kind==='error')run.reject(Error(redactSecrets(reason.error?.message||'DSH 请求失败')));
    else if(reason.kind==='blocked')run.reject(Error('DSH 未执行本次请求，请检查权限或会话配置'));
    else if(['completed','max-tokens','interrupted','aborted'].includes(reason.kind))run.resolve({cancelled:run.cancelled||['interrupted','aborted'].includes(reason.kind)});
    else run.reject(Error('DSH 本轮已结束，但未确认请求成功完成'));
  }
  async checkRun(id,run){
    if(run.checking||run.settled||!run.accepted||this.running.get(id)!==run)return;
    run.checking=true;
    try{
      const state=await this.rpc('run-state',{sessionId:id,requestId:run.requestId});
      if(!state.reason||run.settled||this.running.get(id)!==run)return;
      for(const event of state.events||[])await this.receive({method:'event',params:{sessionId:id,event}});
      this.finishRun(run,state.reason);
    }catch{/* A failed read is not completion. The live stream and next check remain active. */}
    finally{run.checking=false;}
  }
  async list(cursor=0){const {items}=await this.rpc('list');const start=Number(cursor)||0,visible=items.filter(i=>!i.parentSessionId),rows=visible.slice(start,start+80);return {sessions:rows.map(s=>({provider:this.provider,localId:s.sessionId,cwd:s.cwd,title:runtimeSessionTitle(s.projections?.values?.title)||'新的 DSH 会话',updated:s.updatedAt})),cursor:start+80<visible.length?String(start+80):null};}
  async metadata(id){const s=await this.rpc('inspect',{sessionId:id});return {...s.meta,cwd:s.meta.cwd,customTitle:runtimeSessionTitle([...s.events].reverse().find(e=>e.type==='session/title')?.data.title)};}
  async historyPage(id,cursor=null){const s=await this.rpc('inspect',{sessionId:id});const throughSeq=s.events.at(-1)?.seq??-1;if(throughSeq<0)return {items:[],cursor:null};const page=await this.rpc('page',{address:{kind:'session',sessionId:id},throughSeq,...(cursor!==null?{beforeSeq:Number(cursor)}:{}),maxMessages:25});return {items:(page.entries||page.records||[]).flatMap(r=>dshItems(id,r.event)),cursor:page.hasMore?String(page.records?.[0]?.event?.seq??page.entries?.[0]?.event?.seq):null};}
  async history(id){const s=await this.rpc('inspect',{sessionId:id});return s.events.flatMap(e=>dshItems(id,e));}
  async create(cwd){return (await this.rpc('create',{cwd,sessionId:randomUUID()})).sessionId;}
  async fork(id,cwd,title){if(this.running.has(id))throw Error('请先结束当前任务');const source=await this.metadata(id);if(cwd&&path.resolve(cwd)!==path.resolve(source.cwd))throw Error('DSH 分支保留原会话的工作目录，请选择原目录');const result=await this.rpc('fork',{sessionId:id});if(title)await this.rpc('rename',{sessionId:result.sessionId,title});return result.sessionId;}
  async models(){
    const catalog=await this.rpc('models');
    const groups=this.provider==='wanwu'&&catalog.groups.some(g=>g.id.startsWith('wanwu-quikwin'))?catalog.groups.filter(g=>g.id.startsWith('wanwu-quikwin')):catalog.groups;
    return groups.flatMap(g=>g.models.map(m=>{
      const efforts=(m.reasoning?.efforts||[]).map(e=>e.id);
      return {id:g.id+'::'+m.id,name:m.name,description:m.description,default:catalog.default?.provider===g.id&&catalog.default?.model===m.id,efforts,defaultEffort:m.reasoning?.defaultEffort||(this.provider==='wanwu'&&efforts.includes('high')?'high':undefined)};
    }));
  }
  content(prompt,images=[]){return [{type:'text',text:prompt},...images.map(file=>({type:'image',mediaType:({'.png':'image/png','.webp':'image/webp','.gif':'image/gif'})[path.extname(file).toLowerCase()]||'image/jpeg',data:readFileSync(file).toString('base64')}))];}
  async run(id,prompt,emit,options={}){
    if(this.running.has(id))throw Error('DSH 会话正在运行');
    let resolve,reject;const done=new Promise((a,b)=>{resolve=a;reject=b;});done.catch(()=>{});
    const requestId=options.commandId||randomUUID();
    const run={emit,options,resolve,reject,requestId,completion:new DshRunCompletion(requestId),seen:new Set(),stream:new DshStream(),relay:new DshStreamRelay(emit),usage:new DshUsage(options.model)};this.running.set(id,run);
    try{
      const [provider,...parts]=(options.model||'').split('::');
      const effort=options.effort||(this.provider==='wanwu'&&parts.length?(await this.models()).find(m=>m.id===options.model)?.defaultEffort:undefined);
      await this.rpc('configure',{sessionId:id,access:options.access,mode:options.mode,...(parts.length?{model:{provider,model:parts.join('::'),...(effort?{reasoningEffort:effort}:{})}}:{})});
      if(options.fresh&&options.initialTitle){
        const title=options.initialTitle.replace(/\s+/g,' ').trim().slice(0,160);
        if(title)await this.rpc('rename',{sessionId:id,title});
      }
      await this.rpc('prompt',{sessionId:id,requestId,mode:'queue',content:this.content(prompt,options.images),clientTimeZone:Intl.DateTimeFormat().resolvedOptions().timeZone});
      run.accepted=true;
      run.timer=setInterval(()=>void this.checkRun(id,run),3000);run.timer.unref?.();
      void this.checkRun(id,run);
      return await done;
    }finally{clearInterval(run.timer);run.relay.close();this.running.delete(id);void this.rpc('unwatch',{sessionId:id}).catch(()=>{});}
  }
  async steer(id,prompt,options={}){if(!this.running.has(id))throw Error('会话已结束');return this.rpc('prompt',{sessionId:id,requestId:options.commandId||randomUUID(),mode:'steer',content:this.content(prompt,options.images)});}
  async cancel(id){const run=this.running.get(id);if(run)run.cancelled=true;await this.rpc('cancel',{sessionId:id});}
  close(){this.closed=true;const child=this.child;if(child){child.stdin.end();setTimeout(()=>child.kill('SIGTERM'),3000).unref();}this.fail(Error('DSH 已停止'));}
}
