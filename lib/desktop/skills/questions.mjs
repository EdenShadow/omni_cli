import {z} from 'zod';
import {askRuntimeQuestion} from '../runtime-question-flow.mjs';

const schema=z.object({action:z.literal('question'),id:z.string().uuid(),questions:z.array(z.object({
 id:z.string().min(1).max(100),question:z.string().trim().min(1).max(4000),header:z.string().max(100).optional(),multiSelect:z.boolean().optional(),isSecret:z.boolean().optional(),
 options:z.array(z.object({label:z.string().trim().min(1).max(300),description:z.string().max(1000).optional()}).strict()).max(8).optional(),
}).strict()).min(1).max(3)}).strict();

// Provider-independent fallback for runtimes without a native question tool.
// Stable IDs recover a lost HTTP response without asking the same question twice.
export class SkillQuestions {
 constructor(exchange){this.exchange=exchange;this.requests=new Map();}
 async ask(scope,input){
  const b=schema.parse(input),exchange=this.exchange,bridge=exchange.bridge;
  if(new Set(b.questions.map(q=>q.id)).size!==b.questions.length)throw Error('问题 ID 不能重复 / Question IDs must be unique');
  if(scope.native)throw Error('请在万物会话内提问 / Ask within an active Omni AI conversation');
  const context=await bridge.request(`/api/bridge/skill-assistant/${scope.commandId}`,'POST',{action:'context',detail:'summary'},true);
  const key=scope.commandId+':'+b.id,fingerprint=JSON.stringify(b.questions),old=this.requests.get(key);
  if(old){if(old.fingerprint!==fingerprint)throw Error('问题标识已被使用 / Question ID already used');return old.promise;}
  const active=[...this.requests.values()].filter(r=>r.commandId===scope.commandId);
  if(active.length>=32||active.some(r=>!r.done))throw Error('请先等待当前问题的回答 / Wait for the current answer');
  const controller=new AbortController(),record={commandId:scope.commandId,controller,fingerprint,done:false};
  record.promise=(async()=>{
   const answer=await askRuntimeQuestion(details=>bridge.approvals.request(details),{provider:scope.provider,commandId:scope.commandId,sessionId:context.session.id,projectId:context.project.id,kind:'question',title:'需要你的回答 / Your answer is needed',detail:'',questions:b.questions,signal:controller.signal},payload=>{bridge.enqueue(context.session.id,{...payload,commandId:scope.commandId});void bridge.flush().catch(()=>{});});
   if(controller.signal.aborted||!exchange.isActive(scope))throw Error('会话已结束 / Session ended');
   await bridge.request(`/api/bridge/skill-assistant/${scope.commandId}`,'POST',{action:'context',detail:'summary'},true);
   return {status:answer===false?'cancelled':'answered',requestId:b.id,...(answer===false?{}:answer)};
  })().finally(()=>{record.done=true;});
  this.requests.set(key,record);return record.promise;
 }
 release(commandId){for(const [key,r] of this.requests)if(r.commandId===commandId){r.controller.abort();this.requests.delete(key);}}
 close(){for(const r of this.requests.values())r.controller.abort();this.requests.clear();}
}
