// Runtime counters only; never infer tokens from character counts or a cost estimate.
const number = v => Number.isSafeInteger(v) && v >= 0 ? v : null;
const fields = ['inputTokens','outputTokens','cacheReadInputTokens','cacheWriteInputTokens','reasoningOutputTokens'];
const zero = () => Object.fromEntries(fields.map(k=>[k,0]));
export function codexCounters(value) {
  if(number(value?.inputTokens)===null||number(value?.outputTokens)===null)return null;
  return {inputTokens:value.inputTokens,outputTokens:value.outputTokens,
    cacheReadInputTokens:number(value.cachedInputTokens)||0,cacheWriteInputTokens:number(value.cacheWriteInputTokens)||0,
    reasoningOutputTokens:number(value.reasoningOutputTokens)};
}
export class CodexUsage {
  constructor({baseline,fresh=false,model}={}) {this.previous=baseline||(fresh?zero():null);this.value=zero();this.model=model;this.revision=0;this.quality='reported';}
  accept(event) {
    const total=codexCounters(event?.tokenUsage?.total);if(!total)return null;
    // total is session lifetime; last is one model call, not the whole user turn.
    // Resume normally publishes the baseline before turn/start. If unavailable,
    // account only the last reported call, and explicitly mark coverage partial.
    let delta;
    if(!this.previous){delta=codexCounters(event.tokenUsage.last);this.quality='partial';}
    else if(['inputTokens','outputTokens'].some(k=>total[k]<this.previous[k])){delta=codexCounters(event.tokenUsage.last);this.quality='partial';}
    else delta=Object.fromEntries(fields.map(k=>[k,total[k]===null||this.previous[k]===null?null:Math.max(0,total[k]-this.previous[k])]));
    this.previous=total;if(!delta)return null;
    for(const k of fields)this.value[k]=delta[k]===null||this.value[k]===null?null:this.value[k]+delta[k];
    return {revision:++this.revision,...this.value,quality:this.quality,scope:'codex-thread',model:this.model||null,observedAt:Date.now()};
  }
}
export class ClaudeUsage {
  constructor(model){this.model=model;this.value={...zero(),reasoningOutputTokens:null};this.revision=0;this.seen=new Set();}
  accept(result) {
    if(result.uuid&&this.seen.has(result.uuid))return null;
    const u=result.usage;if(number(u?.input_tokens)===null||number(u?.output_tokens)===null)return null;
    if(result.uuid)this.seen.add(result.uuid);
    const read=number(u.cache_read_input_tokens)||0,write=number(u.cache_creation_input_tokens)||0;
    this.value.inputTokens+=u.input_tokens+read+write;this.value.outputTokens+=u.output_tokens;
    this.value.cacheReadInputTokens+=read;this.value.cacheWriteInputTokens+=write;
    // SDK result.usage is per turn, main agent only. modelUsage and costUSD are
    // cumulative, including resumed history; never add those as a new expense.
    return {revision:++this.revision,...this.value,quality:'reported',scope:'claude-main-loop',model:this.model||null,observedAt:Date.now()};
  }
}
export class DshUsage {
  constructor(model){this.model=model;this.value=zero();this.revision=0;this.seen=new Set();this.quality='reported';}
  accept(event){
    if(!['assistant/message','assistant/attempt'].includes(event.type)||this.seen.has(event.seq))return null;
    this.seen.add(event.seq);
    const d=event.data||{},u=d.usage||d.stream?.findLast(r=>r.type==='chunk'&&r.chunk?.type==='usage')?.chunk.usage;
    const source=d.message?.source;if(source?.model)this.model=source.provider+'::'+source.model;
    if(number(u?.inputTokens)===null||number(u?.outputTokens)===null){this.quality='partial';if(!this.revision)return null;}
    else{
      const read=number(u.cacheReadTokens)||0,write=number(u.cacheWriteTokens)||0;
      this.value.inputTokens+=u.inputTokens+read+write;this.value.outputTokens+=u.outputTokens;
      this.value.cacheReadInputTokens+=read;this.value.cacheWriteInputTokens+=write;
      this.value.reasoningOutputTokens=this.value.reasoningOutputTokens===null||number(u.reasoningTokens)===null?null:this.value.reasoningOutputTokens+u.reasoningTokens;
    }
    return {revision:++this.revision,...this.value,quality:this.quality,scope:'dsh-main-loop',model:this.model||null,observedAt:Date.now()};
  }
}
