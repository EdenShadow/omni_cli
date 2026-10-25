// DSH chunks describe growing snapshots, not independent messages. Publishing
// every token would synchronously encrypt/save and upload the same text again.
export class DshStreamRelay {
  constructor(emit,delay=80){this.emit=emit;this.delay=delay;this.pending=new Map();}
  push(items){
    for(const item of items)this.pending.set(item.id,item);
    if(this.pending.size&&!this.timer)this.timer=setTimeout(()=>this.flush(),this.delay);
  }
  flush(){clearTimeout(this.timer);this.timer=null;const items=[...this.pending.values()];this.pending.clear();for(const item of items)this.emit(item);}
  close(){clearTimeout(this.timer);this.timer=null;this.pending.clear();}
}

// Never mutate an in-flight upload or reuse its transport id: retries are
// idempotent. Only superseded, unsent DSH snapshots may be dropped.
export function compactDshOutbox(outbox,sessionId,payload,inFlight=new Set()){
  if(!payload.id?.startsWith('dsh:')||!['message','tool'].includes(payload.kind))return outbox;
  const ids=new Set([payload.id,payload.replaceId].filter(Boolean));
  return outbox.filter(e=>e.sessionId!==sessionId||inFlight.has(e.id)||e.payload.commandId!==payload.commandId||
    e.payload.status!=='inProgress'||!ids.has(e.payload.id)||!['message','tool'].includes(e.payload.kind));
}
