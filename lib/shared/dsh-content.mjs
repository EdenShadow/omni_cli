const text=content=>typeof content==='string'?content:(content||[]).map(b=>b.text||b.type==='image'&&'[图片]'||'').filter(Boolean).join('\n');
// Stable ids let completed envelopes replace live content without duplicating it.
export function dshItems(sessionId,event,{attemptId}={}){
  const d=event.data||{},base=`dsh:${sessionId}:${event.seq}`;
  if(event.type==='user/message'&&d.source?.kind==='user')return [{id:d.id||base,kind:'message',role:'user',text:text(d.content),status:'completed'}];
  if(event.type==='assistant/message')return (d.message?.content||[]).flatMap((b,i)=>{
    const id=base+':'+i,replaceId=attemptId?`dsh:${attemptId}:${i}`:undefined;
    if(b.type==='text')return [{id,replaceId,kind:'message',role:'assistant',text:b.text,status:'completed'}];
    if(b.type==='reasoning')return [{id,replaceId,kind:'tool',role:'system',activity:'reasoning',label:'思考摘要',text:b.text,status:'completed'}];
    return [];
  });
  if(event.type==='tool/call'){
    let args;try{args=JSON.parse(d.arguments);}catch{args={};}
    return [{id:'dsh-tool:'+d.callId,kind:'tool',role:'system',label:d.name,status:'inProgress',text:d.arguments,command:args.command,paths:[args.path||args.file_path].filter(Boolean)}];
  }
  if(event.type==='tool/result')return [{id:'dsh-tool:'+d.message?.toolCallId,kind:'tool',role:'system',status:d.message?.isError?'failed':'completed',output:text(d.message?.content)}];
  return [];
}
export class DshStream {
  constructor(){this.attempts=new Map();this.current=null;}
  accept(frame){
    if(frame.type==='end'){this.attempts.delete(frame.attemptId);return [];}
    if(frame.type==='start'){this.current=frame.attemptId;this.attempts.set(frame.attemptId,new Map());return [];}
    if(frame.type!=='chunk')return [];
    const c=frame.chunk,blocks=this.attempts.get(frame.attemptId);if(!blocks)return [];
    if(!['text-delta','reasoning-delta'].includes(c.type))return [];
    const value=(blocks.get(c.index)||'')+c.text;blocks.set(c.index,value);
    return [{id:`dsh:${frame.attemptId}:${c.index}`,kind:c.type==='text-delta'?'message':'tool',role:c.type==='text-delta'?'assistant':'system',...(c.type==='reasoning-delta'?{activity:'reasoning',label:'思考摘要'}:{}),text:value,status:'inProgress'}];
  }
}
