import {randomUUID} from 'node:crypto';
import {runtimeQuestions} from '../shared/runtime-questions.mjs';

// Runtime requests remain on their source computer. The server only relays a
// single accepted answer; a lost response is retried without executing twice.
export class ApprovalRelay {
  constructor(bridge,approvals){
    this.bridge=bridge;this.approvals=approvals;this.instanceId=randomUUID();
    this.closed=new Map();this.published=new Set();
    this.identity=JSON.stringify([bridge.store.endpoint,bridge.store.userId,bridge.store.device?.id]);
  }
  current(){return this.identity===JSON.stringify([this.bridge.store.endpoint,this.bridge.store.userId,this.bridge.store.device?.id]);}
  supports(p){return !!this.bridge.store.deviceToken&&!!(p?.details.commandId||p?.details.approvalScope==='creation');}
  event(e){
    if(e.type==='approval-resolved'||e.type==='approval-expired')this.closed.set(e.id,e.type==='approval-resolved'?'resolved':'expired');
    this.schedule();
  }
  schedule(){if(this.timer)return;this.timer=setTimeout(()=>{this.timer=null;void this.sync().catch(()=>{});},30);this.timer.unref();}
  async sync(){
    if(this.running){this.again=true;return this.running;}
    if(!this.current()||!this.bridge.store.deviceToken)return;
    this.running=(async()=>{
      do{
        this.again=false;
        let requests=[...this.approvals.pending].filter(([,p])=>this.supports(p)).map(([id,p])=>{
          const d=p.details;return {id,commandId:d.commandId,projectId:d.projectId,approvalScope:d.approvalScope,provider:d.provider,kind:d.kind,title:String(d.title||'').slice(0,300),detail:String(d.detail||'').slice(0,48000),questions:d.questions?runtimeQuestions(d.questions):undefined,canRemember:p.canRemember,expiresAt:p.expiresAt};
        });
        requests=await Promise.all(requests.map(async r=>{const sessionId=[...this.bridge.busy.entries()].find(([id])=>id===r.commandId)?.[1];if(!sessionId?.encryptedChat)return r;const projectId=sessionId.groupChat.projectId;return {...r,projectId,title:'加密会话请求 / Encrypted session request',detail:'',questions:undefined,secureApproval:await this.bridge.chatEncryption.ring().encrypt(projectId,['approval',r.id],{title:r.title,detail:r.detail,questions:r.questions})};}));
        const closed=[...this.closed].slice(0,200).map(([id,status])=>({id,status}));
        if(!requests.length&&!closed.length)return;
        // Mark before I/O: a timeout may happen after the server committed.
        for(const r of requests)this.published.add(r.id);
        let result;
        try{result=await this.bridge.request('/api/bridge/runtime-approvals/sync','POST',{instanceId:this.instanceId,requests,closed},true);}
        catch(e){if(e.status===404){this.unsupported=true;for(const r of requests)this.published.delete(r.id);}throw e;}
        if(!this.current())return;
        this.unsupported=false;
        for(const c of closed)if(this.closed.get(c.id)===c.status){this.closed.delete(c.id);this.published.delete(c.id);}
        for(const a of result.answers||[]){
          if(!this.approvals.pending.has(a.id))continue;
          if(a.expired)this.approvals.finish(a.id,false,'approval-expired');
          else {if(a.secureAnswer){const pending=this.approvals.pending.get(a.id),m=[...this.bridge.busy.entries()].find(([id])=>id===pending?.details.commandId)?.[1];if(!m?.encryptedChat)throw Error('Encrypted approval scope changed');const decoded=await this.bridge.chatEncryption.ring().decrypt(m.groupChat.projectId,['approval-answer',a.id],a.secureAnswer);this.approvals.answer({...a,...decoded});}else this.approvals.answer(a);}
          this.again=true;
        }
      }while(this.again&&this.current());
    })();
    try{return await this.running;}finally{this.running=null;}
  }
  async answer(data){
    const p=this.approvals.pending.get(data.id);
    if(!this.supports(p))return this.approvals.answer(data);
    try{await this.sync();}catch(e){if(!this.unsupported)throw Error('连接暂时中断，请重试提交 / Connection interrupted; retry your answer');}
    if(!this.current())throw Error('账号或设备已切换 / Account or device changed');
    if(this.unsupported&&!this.published.has(data.id))return this.approvals.answer(data);
    const m=[...this.bridge.busy.entries()].find(([id])=>id===p.details.commandId)?.[1];const payload=m?.encryptedChat?{secureAnswer:await this.bridge.chatEncryption.ring().encrypt(m.groupChat.projectId,['approval-answer',data.id],{answer:data.answer,remember:data.remember})}:data;
    await this.bridge.request(`/api/runtime-approvals/${data.id}/answer`,'POST',payload);
    await this.sync().catch(()=>{}); // Accepted remotely; retry delivery in the background.
    return {ok:true,status:'answered'};
  }
}
