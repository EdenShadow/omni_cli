import {SECURITY_REASONS} from '../shared/command-security.mjs';

export async function submitSecurityReport(bridge,id,reason){
  if(!SECURITY_REASONS.includes(reason))throw Error('Invalid security reason');
  bridge.store ||= {};
  bridge.store.pendingSecurityReports ||= {};
  bridge.store.pendingSecurityReports[id]={reason};
  bridge.save?.();
  try{
    const result=await bridge.request(`/api/bridge/commands/${id}/security-report`,'POST',{reason},true);
    delete bridge.store.pendingSecurityReports[id];bridge.save?.();return result;
  }catch(e){throw Object.assign(Error('报告暂未送达，已保留重试；停止当前任务 / Report pending; stop the current task'),{code:'WANWU_SECURITY_BLOCKED'});}
}

export async function retrySecurityReports(bridge){
  for(const [id,body] of Object.entries(bridge.store.pendingSecurityReports||{})){
    try{await bridge.request(`/api/bridge/commands/${id}/security-report`,'POST',body,true);}
    catch(e){
      // An explicit denial is terminal; transient outages keep the metadata-only
      // report on disk and never resume the suspect work.
      if(![401,403,404,409].includes(e.status))continue;
    }
    delete bridge.store.pendingSecurityReports[id];bridge.save();
  }
}
