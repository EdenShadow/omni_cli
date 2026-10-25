// Thin host plugin over DSH's public session services. fd 3 is private to
// Wanwu; stdout (including the web profile's bearer URL) is never forwarded.
import {createInterface} from 'node:readline';
import {createWriteStream} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {mergeDshModelProviders} from './dsh-model-catalog.mjs';
import {DshRunCompletion} from './dsh-run-completion.mjs';
export const name = 'wanwu-session-host';
export const inject = ['sessionController','agents','sessions','permissionPresets','agentPresets','userQuestions','llm','loader'];
export function apply(ctx) {
  const watched=new Set(), pending=new Map(), lifetime=new AbortController();
  const output=createWriteStream(null,{fd:3,autoClose:false});output.on('error',()=>lifetime.abort());
  const send=value=>{if(!lifetime.signal.aborted)output.write(JSON.stringify(value)+'\n');};
  const request=(method,req)=>new Promise((resolve,reject)=>{
    const id=randomUUID(), signal=req.signal;
    if(signal?.aborted)return reject(Error('Cancelled'));
    const abort=()=>{pending.delete(id);send({method:'approval-cancel',params:{id}});reject(Error('Cancelled'));};
    pending.set(id,{resolve,reject,signal,abort,method});signal?.addEventListener('abort',abort,{once:true});
    send({method,params:{id,sessionId:req.agent?.id,toolName:req.toolName,reason:req.displayReason?.zh||req.reason,questions:req.questions}});
  });
  ctx.on('approval/request',async(req,next)=>watched.has(req.agent?.id)?(await request('permission',req)===true?'allowed-once':'rejected'):next(),{prepend:true});
  ctx.on('user-questions/request',async(req,next)=>{
    if(!watched.has(req.agent?.id))return next();
    const claim=new AbortController();
    if(req.wait?.timed&&ctx.userQuestions)void(async()=>{try{for await(const _ of ctx.userQuestions.attachWait(req.agent,req.wait.callId,claim.signal)){} }catch{}})();
    try{return await request('question',req);}finally{claim.abort();}
  },{prepend:true});
  ctx.on('session/event',(session,event)=>{if(watched.has(session.id))send({method:'event',params:{sessionId:session.id,event}});});
  ctx.on('agent/status',({agent,status})=>{if(watched.has(agent.id))send({method:'status',params:{sessionId:agent.id,status}});});
  ctx.on('agent/assistant-stream',({agent,frame})=>{if(watched.has(agent.id))send({method:'stream',params:{sessionId:agent.id,frame}});});
  const controller=ctx.sessionController;
  let modelUpdates=Promise.resolve();
  function withModels(profiles,operation){
    const task=modelUpdates.then(async()=>{
      const refresh=async()=>{
        if(!profiles)return;
        const hasImports=profiles.some(profile=>Object.keys(profile.providers||{}).length);
        const entry=[...ctx.loader.entries()].find(entry=>entry.options.id==='llm-pi-ai'&&entry.fiber);
        if(!entry){if(!hasImports)return;throw Error('当前 DeepSeek 版本不支持导入自定义模型，请更新 DeepSeek Harness');}
        const original=entry.options,config=original.config||{};
        // Update volatile runtime references only. Keep the raw profile options
        // intact so later DSH settings writes cannot persist imported secrets.
        const current=entry.fiber.config?.providers?.get?.();
        if(!current){if(!hasImports)return;throw Error('当前 DeepSeek 版本不支持刷新自定义模型，请更新 DeepSeek Harness');}
        entry.options={...original,config:{...config,providers:current}};
        try{await entry.update({config:{...config,providers:mergeDshModelProviders(config.providers,profiles)}});}
        finally{entry.options=original;}
      };
      await refresh();return operation(refresh);
    });
    modelUpdates=task.catch(()=>{});return task;
  }
  async function call(method,p={}){
    switch(method){
      case 'ping': return {protocol:1};
      case 'list': return controller.list({},lifetime.signal);
      case 'inspect': return controller.inspect(p.sessionId,lifetime.signal);
      case 'run-state': {
        const agent=ctx.agents.get(p.sessionId);
        if(!agent)return {};
        const events=agent.session.snapshotEvents(),completion=new DshRunCompletion(p.requestId);
        for(const event of events)completion.accept(event);
        if(!completion.reason)return {};
        return {reason:completion.reason,events:events.filter(event=>event.data?.turn===completion.turn&&['assistant/message','assistant/attempt','tool/call','tool/result'].includes(event.type))};
      }
      case 'page': return controller.page(p,lifetime.signal);
      case 'models': return withModels(p.modelProfiles,()=>controller.modelCatalog());
      case 'create': return controller.create(p);
      case 'fork': return controller.fork(p);
      case 'rename': return controller.rename(p);
      case 'watch': watched.add(p.sessionId);return {};
      case 'unwatch': watched.delete(p.sessionId);return {};
      case 'configure': return withModels(p.modelProfiles,async()=>{
        const found=await controller.resolveAgent(p.sessionId);if(found.error)throw found.error;const agent=found.agent;
        watched.add(p.sessionId);
        // Permission, planning and imported model choices are session-scoped.
        ctx.permissionPresets.set(agent.session,p.access==='full'?'danger-full-access':'workspace-write');
        const plan=ctx.agentPresets?.serviceFor(agent,'planMode')||ctx.get('planMode');
        if(!plan&&p.mode==='plan')throw Error('DSH plan mode is unavailable');
        plan?.set(agent,p.mode==='plan');
        if(p.model){
          if(p.modelProfiles){
            // Use the controller's session selection/admission services without
            // saveSelection: an imported route must not become the standalone
            // web profile's default, where that route does not exist.
            const state=controller.agents;
            if(!state?.serializeImageAdmission||!state?.selectForNextRequest)throw Error('请更新 DeepSeek Harness 后重试模型选择');
            await state.serializeImageAdmission(agent,async()=>{
              const resolved=await ctx.llm.resolveCallConfig(p.model);
              state.selectForNextRequest(agent,{provider:resolved.provider,model:resolved.model,...(resolved.reasoningEffort===undefined?{}:{reasoningEffort:resolved.reasoningEffort})});
            });
          }else await controller.selectModel({sessionId:p.sessionId,...p.model});
        }
        return {};
      });
      case 'prompt': watched.add(p.sessionId);return controller.prompt(p,lifetime.signal);
      case 'cancel': return controller.cancel(p);
      case 'answer': {
        const ask=pending.get(p.id);if(!ask)return {expired:true};pending.delete(p.id);ask.signal?.removeEventListener('abort',ask.abort);
        if(p.answer===false&&ask.method==='question')ask.reject(Error('User cancelled'));else ask.resolve(p.answer);return {};
      }
      default: throw Error('Unknown Wanwu DSH operation');
    }
  }
  const lines=createInterface({input:process.stdin});
  lines.on('line',line=>{
    let message;try{message=JSON.parse(line);}catch{return;}
    if(!message||typeof message.id!=='string'||typeof message.method!=='string')return;
    void call(message.method,message.params).then(result=>send({id:message.id,result}),error=>send({id:message.id,error:{message:String(error?.message||error),code:error?.code}}));
  });
  lines.on('close',()=>{lifetime.abort();void ctx.root.fiber.dispose();});
  ctx.on('dispose',()=>{lifetime.abort();lines.close();for(const ask of pending.values()){ask.signal?.removeEventListener('abort',ask.abort);ask.reject(Error('Runtime stopped'));}pending.clear();});
  send({method:'ready',params:{protocol:1}});
}
