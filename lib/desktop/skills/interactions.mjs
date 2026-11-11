import {z} from 'zod';
import {skillInteraction} from '../../shared/skill-interactions.mjs';

const schema=z.object({action:z.literal('interact'),id:z.string().uuid(),interaction:z.unknown()}).strict();
export class SkillInteractions {
 constructor(exchange){this.exchange=exchange;this.requests=new Map();}
 async ask(scope,input){
  const b=schema.parse(input),interaction=skillInteraction(b.interaction),{bridge}=this.exchange;
  if(scope.native)throw Error('请在万物 AI 会话内发起交互 / Start this interaction in a Wanwu AI conversation');
  const context=await bridge.request(`/api/bridge/skill-assistant/${scope.commandId}`,'POST',{action:'context',detail:'summary'},true);
  if(!context.capabilities?.skillInteractions)throw Error('请更新万物服务端 / Update the Wanwu server');
  const key=scope.commandId+':'+b.id,fingerprint=JSON.stringify(interaction),old=this.requests.get(key);
  if(old){if(old.fingerprint!==fingerprint)throw Error('交互标识已被使用 / Interaction ID already used');return old.promise;}
  const active=[...this.requests.values()].filter(r=>r.commandId===scope.commandId);
  if(active.length>=32||active.filter(r=>!r.done).length>=4)throw Error('最多同时展示 4 个交互 / Up to 4 concurrent interactions');
  const controller=new AbortController(),record={commandId:scope.commandId,controller,fingerprint,done:false};
  record.promise=(async()=>{
   const emit=status=>{bridge.enqueue(context.session.id,{id:'skill-interaction-'+b.id,kind:'tool',role:'system',activity:'runtimeQuestion',label:'userInput',text:interaction.title,status,commandId:scope.commandId});void bridge.flush().catch(()=>{});};
   emit('waiting');
   try{
    const answer=await bridge.approvals.request({provider:scope.provider,commandId:scope.commandId,sessionId:context.session.id,projectId:context.project.id,kind:'interaction',title:interaction.title,detail:'',display:interaction.display,interaction,signal:controller.signal});
    if(controller.signal.aborted||!this.exchange.isActive(scope))throw Error('会话已结束 / Session ended');
    emit(answer===false?'cancelled':'completed');
    // Submitted values and original files are already delivered as a normal,
    // session-bound user command. Do not repeat private inputs in tool output.
    return {status:answer===false?'cancelled':'submitted',requestId:b.id,...(answer===false?{}:{commandId:answer.submissionId,delivery:'conversation',message:'The interaction was submitted as user text and attachments. Continue with that input; do not submit it again.'})};
   }catch(e){emit('cancelled');throw e;}
  })().finally(()=>{record.done=true;});
  this.requests.set(key,record);return record.promise;
 }
 release(commandId){for(const [key,r] of this.requests)if(r.commandId===commandId){r.controller.abort();this.requests.delete(key);}}
 close(){for(const r of this.requests.values())r.controller.abort();this.requests.clear();}
}
