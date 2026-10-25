// A durable turn boundary, correlated to the submitted prompt, is authoritative.
// Text/step endings and other queued prompts must never finish this request.
export class DshRunCompletion {
  constructor(requestId){this.requestId=requestId;this.queues={'next-turn':[],'next-step':[]};}
  matches(message){return message?.source?.kind==='user'&&message.source.rpcId===this.requestId;}
  accept(event){
    if(this.reason)return this.reason;
    const d=event.data||{};
    if(event.type==='turn/start')this.currentTurn=d.turn;
    if(event.type==='agent/inbox/spliced'&&this.queues[d.target]){
      const queue=this.queues[d.target],inserted=(d.inserted||[]).map(message=>this.matches(message));
      // A live subscription can start with unrelated messages already queued.
      while(queue.length<d.start+(d.removedCount||0))queue.push(false);
      const removed=queue.splice(d.start,d.removedCount||0,...inserted);
      if(removed.includes(true)){
        if(d.outcome==='canceled'){if(!inserted.includes(true))this.reason={kind:'aborted'};}
        else this.turn=this.currentTurn;
      }
    }
    if(event.type==='user/message'&&this.matches(d))this.turn=d.turn??this.currentTurn;
    if(event.type==='turn/end'&&this.turn!==undefined&&d.turn===this.turn)this.reason=d.reason;
    return this.reason;
  }
}
