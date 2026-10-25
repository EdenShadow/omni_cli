// Coalesce only events that have never been sent. A failed HTTP response may
// still mean the server accepted the batch, so attempted transport IDs and
// their payloads must remain unchanged for idempotent retries.
export function compactRuntimeOutbox(outbox,sessionId,payload,inFlight=new Set()){
  if(!payload.id||!payload.commandId||payload.id.startsWith('dsh:'))return {outbox,payload};
  const unsent=e=>e.sessionId===sessionId&&!e.attempted&&!inFlight.has(e.id)&&e.payload.commandId===payload.commandId&&e.payload.id===payload.id;
  if(payload.kind==='delta'&&typeof payload.text==='string'){
    const last=outbox.at(-1);
    if(last&&!last.usage&&unsent(last)&&last.payload.kind==='delta'&&typeof last.payload.text==='string'&&
      JSON.stringify({...last.payload,text:undefined})===JSON.stringify({...payload,text:undefined})&&
      Buffer.byteLength(last.payload.text)+Buffer.byteLength(payload.text)<=65536){
      return {outbox:outbox.slice(0,-1),payload:{...payload,text:last.payload.text+payload.text}};
    }
  }
  // Normalized message/tool events are full snapshots of the same runtime
  // item. Keep other items and completed records; never discard raw deltas
  // unless the matching full snapshot supersedes them.
  if(['message','tool'].includes(payload.kind)&&typeof payload.text==='string'&&['inProgress','completed'].includes(payload.status)){
    outbox=outbox.filter(e=>!unsent(e)||e.usage||e.payload.turnId!==payload.turnId||
      e.payload.role!==payload.role||!(e.payload.kind==='delta'||e.payload.kind===payload.kind&&e.payload.status==='inProgress'));
  }
  return {outbox,payload};
}
