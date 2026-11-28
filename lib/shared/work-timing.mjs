const terminal=new Set(['done','failed','cancelled']);
const timestamp=value=>Number.isFinite(value)&&value>0?value:undefined;
export function messageSentAt(message,command){
 for(const value of [command?.created,message?.sentAt,message?.created,message?.startedAt,message?.timestamp]){
  const time=typeof value==='string'?Date.parse(value):value;
  if(timestamp(time)&&Number.isFinite(new Date(time).getTime()))return time;
 }
}
export function formatMessageTime(value,english=false,timeZone){
 const time=messageSentAt({sentAt:value});if(!time)return;
 const date=new Date(time),locale=english?'en-US':'zh-CN';
 const options={year:'numeric',month:english?'short':'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',...(timeZone?{timeZone}:{})};
 return {dateTime:date.toISOString(),label:new Intl.DateTimeFormat(locale,options).format(date),title:new Intl.DateTimeFormat(locale,{...options,second:'2-digit',timeZoneName:'short'}).format(date)};
}

// Store only command IDs and execution timestamps, never prompts or replies.
// The server's "updated" is the claim time while running and the finish time
// once terminal. Remember the former before the latter replaces it.
export function createWorkTimingMemory(storage,key){
 let rows={};
 try{
  const saved=JSON.parse(storage().getItem(key)||'{}');
  for(const [id,row] of Object.entries(saved).slice(-500)){
   if(timestamp(row?.startedAt))rows[id]={startedAt:row.startedAt,...(timestamp(row.finishedAt)?{finishedAt:row.finishedAt}:{})};
  }
 }catch{/* The timer works in memory when storage is unavailable. */}
 function save(){rows=Object.fromEntries(Object.entries(rows).slice(-500));try{storage().setItem(key,JSON.stringify(rows));}catch{}}
 function put(id,value){
  const old=rows[id];
  if(old?.startedAt===value?.startedAt&&old?.finishedAt===value?.finishedAt)return;
  delete rows[id];if(value)rows[id]=value;save();
 }
 return {
  receive(event){
   const p=event.payload,time=timestamp(event.created);
   if(p?.kind==='command'&&p.status==='queued'&&typeof p.id==='string'){put(p.id,undefined);return;}
   if(!time||p?.kind!=='status'||typeof p.commandId!=='string')return;
   const old=rows[p.commandId];
   if(p.status==='working'&&!old)put(p.commandId,{startedAt:time});
   else if(terminal.has(p.status)&&old&&!old.finishedAt)put(p.commandId,{...old,finishedAt:Math.max(old.startedAt,time)});
  },
  apply(commands){
   let changed=false;
   const next=commands.map(command=>{
    let row=rows[command.id];
    // A queued snapshot can still be in flight when the live claim arrives.
    // Only a new queued event (e.g. a rejected steer) invalidates a prior start.
    if(command.status==='queued')return command;
    const start=timestamp(command.startedAt)||row?.startedAt||
      (['running','steering'].includes(command.status)?timestamp(command.updated):undefined);
    if(!start)return command;
    const end=terminal.has(command.status)?timestamp(command.finishedAt)||timestamp(command.updated)||row?.finishedAt:undefined;
    row={startedAt:start,...(end?{finishedAt:Math.max(start,end)}:{})};
    put(command.id,row);
    // Streaming packets rarely change timing. Retain metadata identity so a
    // new token does not invalidate every command lookup and prompt component.
    if(command.startedAt===row.startedAt&&(!end||command.finishedAt===row.finishedAt))return command;
    changed=true;
    return {...command,...row};
   });
   return changed?next:commands;
  },
 };
}
export function formatWorkDuration(milliseconds,english=false){
 const seconds=Math.floor(Math.max(0,Number.isFinite(milliseconds)?milliseconds:0)/1000);
 const h=Math.floor(seconds/3600),m=Math.floor(seconds%3600/60),s=seconds%60;
 return english?(h?`${h}h ${m}m ${s}s`:m?`${m}m ${s}s`:`${s}s`):
   h?`${h}时 ${m}分 ${s}秒`:m?`${m}分 ${s}秒`:`${s}秒`;
}
