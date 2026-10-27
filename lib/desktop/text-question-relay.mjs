import {textQuestionId} from '../shared/text-question-id.mjs';
import {watchTextQuestions} from '../shared/text-question.mjs';

// Runs before encryption on the execution device. It never blocks the model,
// cancels work or supplies an invented tool result.
export function relayTextQuestions(bridge,command,session,encrypted,{finishGrace=1000}={}){
 const pending=new Map();let working,finished=false,deadline=Infinity;
 const sync=()=>working||=(async()=>{
  for(const [id,question]of pending){try{
   const body={id,commandId:command.id,questions:[question]};
   if(encrypted){body.secureApproval=await bridge.chatEncryption.ring().encrypt(command.project_id||session.groupChat?.projectId,['approval',id],{questions:[question]});delete body.questions;}
   await bridge.request('/api/bridge/text-questions','POST',body,true,false,AbortSignal.timeout(3000));
   if(pending.get(id)===question)pending.delete(id);
  }catch{/* Retain transient failures while the turn is active. */}}
 })().finally(()=>{working=null;if(finished&&!pending.size)clearInterval(retry);});
 const watcher=watchTextQuestions((itemId,q)=>{pending.set(textQuestionId(command.id,itemId),q);void sync();});
 const retry=setInterval(()=>{if(bridge.stopped||Date.now()>deadline){pending.clear();clearInterval(retry);return;}void sync();},2500);retry.unref();
 return {event:p=>watcher.event(p),async finish(status='done'){
  if(status!=='done'){finished=true;watcher.stop();pending.clear();clearInterval(retry);return;}
  watcher.flush();watcher.stop();finished=true;deadline=Date.now()+60000;
  // Publishing a question must not keep a finished task showing as busy when
  // the network stalls. Retain a short background retry window instead.
  let timer;await Promise.race([sync(),new Promise(resolve=>{timer=setTimeout(resolve,finishGrace);})]);clearTimeout(timer);
  if(!pending.size)clearInterval(retry);
 }};
}
