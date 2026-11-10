import {ENCRYPTED_SCHEDULE_PROMPT,scheduleContext} from '../../shared/encrypted-schedule.mjs';
import {redactSecrets} from '../../shared/conversation-privacy.mjs';

export async function sessionSchedule(bridge,scope,input){
 const request=body=>bridge.request('/api/bridge/skill-assistant/'+scope.commandId,'POST',body,true);
 const state=await request({action:'schedule-state'});
 const row=state.schedule;
 const describe=async saved=>{
  if(!saved)return {status:'absent',provider:state.provider};
  const {secureSchedule,...schedule}=saved;
  if(secureSchedule){
   const clear=await bridge.chatEncryption.ring().decrypt(state.projectId,scheduleContext(saved),secureSchedule);
   schedule.prompt=clear.prompt;
  }
  schedule.prompt=redactSecrets(schedule.prompt);
  return {status:'saved',provider:state.provider,schedule};
 };
 if(input.action==='schedule-get')return describe(row);
 const target={scheduleId:input.scheduleId??null,revision:input.revision};
 if(input.action==='schedule-delete')return request({action:'schedule-remove',...target});
 if(row&&row.requestId===input.requestId)return describe(row);
 if(input.action==='schedule-create'&&row)throw Error('当前会话已有定时任务，请先读取后修改');
 if(input.action==='schedule-update'&&!row)throw Error('当前会话没有可修改的定时任务');
 if(target.scheduleId!==(row?.id??null)||target.revision!==(row?.revision??0))throw Error('定时设置已变化，请重新读取');
 if(input.prompt===undefined&&input.rule===undefined)throw Error('请提供执行内容或时间规则');
 const rule={...row?.rule,...input.rule};
 let prior=row?.prompt;
 if(row?.secureSchedule)prior=(await bridge.chatEncryption.ring().decrypt(state.projectId,scheduleContext(row),row.secureSchedule)).prompt;
 let prompt=input.prompt??prior;
 if(prior&&prompt===redactSecrets(prior))prompt=prior;
 else if(prior&&prior!==redactSecrets(prior)&&typeof prompt==='string'&&prompt.includes('***'))throw Error('修改含敏感值的任务时请填写完整内容');
 if(typeof prompt!=='string'||!prompt.trim()||prompt.length>30000)throw Error('定时任务需要有效的执行内容');
 if(state.encryptedChat&&row&&!row.secureSchedule&&prompt.includes('***'))throw Error('将旧任务转为加密定时任务时，请重新提供完整执行内容');
 let secureSchedule;
 if(state.encryptedChat||row?.secureSchedule){
  secureSchedule=await bridge.chatEncryption.ring().encrypt(state.projectId,scheduleContext({...state,requestId:input.requestId}),{prompt});
  prompt=ENCRYPTED_SCHEDULE_PROMPT;
 }
 const saved=await request({action:'schedule-save',...target,rule,prompt,secureSchedule,requestId:input.requestId});
 return describe(saved.schedule);
}
