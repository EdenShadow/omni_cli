import {randomUUID} from 'node:crypto';
import {nextOccurrence} from '../shared/local-schedule.mjs';
// Encrypted with the bridge store, scoped to the bound device and server. The
// controller may disconnect: subsequent runs use only this device's credential.
export class DeviceScheduler {
 constructor(bridge,{now=()=>Date.now()}={}){this.bridge=bridge;this.now=now;this.running=false;}
 async tick(){
  const b=this.bridge;if(this.running||b.stopped||!b.store.deviceToken)return;this.running=true;
  const scope=b.store.endpoint+'|'+b.store.device?.id,valid=()=>!b.stopped&&scope===b.store.endpoint+'|'+b.store.device?.id;
  try{
   const remote=await b.request('/api/bridge/schedules','GET',undefined,true);if(!valid())return;
   const previous=b.store.deviceSchedules||[],rows=[];
   for(const config of remote){
    const old=previous.find(s=>s.scope===scope&&s.id===config.id);
    let local=old;
    if(!old||old.revision!==config.revision){local={...config,scope,nextAt:config.enabled?nextOccurrence(config.rule,this.now()):null,lastAt:old?.lastAt||config.lastAt||null,error:'',pending:null};}
    else local={...old,status:config.status};
    rows.push(local);
   }
   const next=[...previous.filter(s=>s.scope!==scope),...rows],changed=JSON.stringify(previous)!==JSON.stringify(next);
   b.store.deviceSchedules=next;if(changed)b.save();
   for(const row of rows){
    if(!valid())return;
    if(!row.enabled||(!row.pending&&row.nextAt>this.now())||!b.skillUpdates.available)continue;
    if(!row.pending&&(row.status==='working'||row.status==='queued'||[...b.busy.values()].some(c=>c.sessionId===row.sessionId))){
     if(row.rule.overlap!=='wait'){row.nextAt=nextOccurrence(row.rule,this.now(),row.nextAt);row.error='';b.save();}
     continue;
    }
    try{
     if(!row.pending){row.pending={id:randomUUID(),at:row.nextAt,revision:row.revision};b.save();}
     const result=await b.request(`/api/bridge/schedules/${row.id}/run`,'POST',row.pending,true);if(!valid())return;
     if(result.status!=='skipped')row.lastAt=this.now();row.nextAt=nextOccurrence(row.rule,this.now(),row.pending.at);row.pending=null;row.error='';b.save();
    }catch(error){if(!valid())return;if(error.status!==409)row.error=String(error.message).slice(0,500);b.save();}
   }
   const report={rows:rows.map(s=>({id:s.id,revision:s.revision,nextAt:s.nextAt,lastAt:s.lastAt,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,error:s.error||''}))},key=scope+'|'+JSON.stringify(report);
   if(valid()&&key!==this.lastReport){await b.request('/api/bridge/schedules/state','POST',report,true);if(valid())this.lastReport=key;}
  }finally{this.running=false;}
 }
}
