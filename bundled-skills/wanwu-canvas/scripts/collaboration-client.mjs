// Shared by the trusted CanvasFrame host and scoped Node producers. No account
// credentials enter the iframe; reconnects obtain a fresh short-lived ticket.
export function createCollaborationClient({ticket,emit=()=>{},WebSocketImpl=globalThis.WebSocket,clientId=globalThis.crypto.randomUUID(),now=Date.now}){
 let current,closed=false;
 const error=(message,status)=>Object.assign(Error(message),{status});
 function status(s,value,detail={}){s.status=value;emit('collab.status',{document:s.document,status:value,...detail});}
 function reject(s,message){for(const p of s.pending.values()){clearTimeout(p.timer);p.reject(error(message,503));}s.pending.clear();}
 function stop(s){s.stopped=true;clearTimeout(s.retry);clearTimeout(s.timeout);clearTimeout(s.joinTimeout);clearTimeout(s.drainTimer);clearInterval(s.pulse);clearInterval(s.flush);reject(s,'Disconnected; commit outcome may be unknown. Retry the same batch.');s.reject?.(error('Collaboration closed',410));s.resolve=null;s.reject=null;s.ws?.close();}
 function accept(s,items){const fresh=[];for(const r of items||[])if(r.revision>(s.objects.get(r.id)?.revision??0)){s.objects.set(r.id,r);fresh.push(r);}if(fresh.length)emit('collab.objects',{document:s.document,items:fresh});}
 function send(s,m){if(s.ws?.readyState!==1||s.ws.bufferedAmount>65536)return false;s.ws.send(JSON.stringify(m));return true;}
 // Leading-edge delivery, then latest-value coalescing under one connection
 // budget. Keep the existing wire format so older servers remain compatible.
 function drain(s){
  clearTimeout(s.drainTimer);s.drainTimer=null;
  if(!s.online||s.stopped)return;
  const time=now();s.tokens=Math.min(2,s.tokens+Math.max(0,time-s.tokenTime)*60/1000);s.tokenTime=time;
  for(const [key,v]of s.queued){
   if(time-v.at>1000){s.queued.delete(key);continue;}
   if(s.tokens<1)break;
   if(!send(s,{op:'transient',frame:{kind:v.kind,key:v.key,data:v.data,seq:s.seq+1}}))break;
   s.seq++;s.tokens--;s.queued.delete(key);
  }
  if(s.queued.size)s.drainTimer=setTimeout(()=>drain(s),Math.max(1,Math.ceil((1-s.tokens)*1000/60),s.ws?.bufferedAmount>65536?17:0));
 }
 function rpc(s,op,args={}){
  if(s.stopped||s.ws?.readyState!==1)return Promise.reject(error('Collaboration is offline',503));
  if(s.pending.size>=64)return Promise.reject(error('Too many collaboration requests',429));
  const id=crypto.randomUUID();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{s.pending.delete(id);reject(error('Request timed out; retry the same batch',504));},15000);s.pending.set(id,{resolve,reject,timer});if(!send(s,{id,op,...args})){clearTimeout(timer);s.pending.delete(id);reject(error('Collaboration connection is busy',429));}});
 }
 function frames(s,items,time){
  const fresh=[];for(const item of items||[]){
   const key=item.actor.id+':'+item.kind+':'+item.key,old=s.frames.get(key);if(old&&item.seq<=old.seq)continue;
   const f={...item,expiresAt:now()+Math.min(s.ttl,Math.max(0,item.expiresAt-time))};s.frames.set(key,f);fresh.push(f);
  }if(fresh.length)emit('collab.transient',{document:s.document,items:fresh});
 }
 function forget(s,actorId){s.people.delete(actorId);const expired=[];for(const [k,f]of s.frames)if(f.actor.id===actorId){s.frames.delete(k);expired.push({...f,data:null,expired:true});}if(expired.length)emit('collab.transient',{document:s.document,items:expired});emit('collab.participants',{document:s.document,items:[...s.people.values()]});}
 async function connect(s){
  if(closed||s.stopped||s!==current)return;status(s,s.attempt?'reconnecting':'connecting');let ws;
  try{
   const lease=await ticket({document:s.document,clientId});if(closed||s.stopped||s!==current)return;
   const url=new URL(lease.url||lease.path);if(!['https:','http:','ws:','wss:'].includes(url.protocol)||url.username||url.password)throw error('Invalid collaboration URL',400);url.protocol=['https:','wss:'].includes(url.protocol)?'wss:':'ws:';
   ws=new WebSocketImpl(url.href);s.ws=ws;s.online=false;s.lastSeen=now();s.seq=0;s.queued.clear();s.tokens=2;s.tokenTime=now();clearTimeout(s.drainTimer);
   clearTimeout(s.timeout);s.timeout=setTimeout(()=>ws.close(),15000);
   ws.onmessage=async event=>{
    if(s.stopped||s.ws!==ws)return;s.lastSeen=now();let m;try{m=JSON.parse(event.data);}catch{return;}
    if(m.type==='reply'){const p=s.pending.get(m.id);if(p){clearTimeout(p.timer);s.pending.delete(m.id);m.error?p.reject(error(m.error,m.status)):p.resolve(m.result);}return;}
    if(m.type==='objects'){accept(s,m.items);return;}
    if(m.type==='transient'){frames(s,m.items,m.time||now());return;}
    if(m.type==='leave'){forget(s,m.actorId);return;}
    if(m.type==='participant'){s.people.set(m.actor.id,m.actor);emit('collab.participants',{document:s.document,items:[...s.people.values()]});return;}
    if(m.type==='error'){s.reject?.(error(m.error,m.status));return;}
    if(m.type!=='joined')return;
    s.actor=m.actor;s.ttl=m.ttl;s.people=new Map(m.participants.map(p=>[p.id,p]));s.frames.clear();
    emit('collab.participants',{document:s.document,items:m.participants});frames(s,m.transients,m.time||now());
    clearTimeout(s.timeout);status(s,'syncing');
    clearInterval(s.pulse);s.pulse=setInterval(()=>{if(now()-s.lastSeen>30000)ws.close();else send(s,{op:'heartbeat'});},10000);
    try{
     let cursor='';do{const page=await rpc(s,'snapshot',{cursor});if(s.stopped||s.ws!==ws)return;accept(s,page.items);cursor=page.cursor;}while(cursor);
     s.online=true;s.attempt=0;clearTimeout(s.joinTimeout);status(s,'connected',{actor:s.actor});s.resolve?.({actor:s.actor,document:s.document,objects:[...s.objects.values()],participants:[...s.people.values()]});s.resolve=null;s.reject=null;
    }catch(e){if(s.ws===ws&&!s.stopped)ws.close();}
   };
   ws.onerror=()=>{};
   ws.onclose=e=>{
    if(s.ws!==ws)return;s.online=false;s.queued.clear();clearTimeout(s.drainTimer);clearInterval(s.pulse);clearTimeout(s.timeout);reject(s,'Disconnected; commit outcome may be unknown. Retry the same batch.');
    if(closed||s.stopped||s!==current)return;
    if([4001,4003].includes(e.code)){s.stopped=true;clearTimeout(s.joinTimeout);clearInterval(s.flush);s.frames.clear();s.people.clear();s.objects.clear();emit('collab.reset',{document:s.document});s.reject?.(error(e.reason||'Collaboration access ended',403));s.reject=null;status(s,'error',{message:e.reason});return;}
    status(s,'reconnecting');s.retry=setTimeout(()=>void connect(s),Math.min(5000,300*2**Math.min(s.attempt++,5)));
   };
  }catch(e){
   if(s.stopped||s!==current)return;
   if([400,401,403,404,409].includes(e.status)){s.stopped=true;clearTimeout(s.joinTimeout);clearInterval(s.flush);s.objects.clear();s.frames.clear();s.people.clear();emit('collab.reset',{document:s.document});s.reject?.(e);s.reject=null;status(s,'error',{message:e.message});}
   else{s.retry=setTimeout(()=>void connect(s),Math.min(5000,300*2**Math.min(s.attempt++,5)));status(s,'reconnecting');}
  }
 }
 return {
  join(document='main'){
   if(closed)return Promise.reject(error('Collaboration closed',410));if(!/^[a-zA-Z0-9_-]{1,24}$/.test(document))return Promise.reject(error('Invalid document name',400));
   if(current&&!current.stopped&&current.document===document){if(current.online)return Promise.resolve({actor:current.actor,document,objects:[...current.objects.values()],participants:[...current.people.values()]});if(!current.resolve)current.promise=new Promise((resolve,reject)=>{current.resolve=resolve;current.reject=reject;});return current.promise;}
   if(current)stop(current);
   const s={document,objects:new Map(),people:new Map(),frames:new Map(),queued:new Map(),pending:new Map(),attempt:0,ttl:8000,seq:0};s.promise=new Promise((resolve,reject)=>{s.resolve=resolve;s.reject=reject;});current=s;s.joinTimeout=setTimeout(()=>{stop(s);status(s,'error',{message:'Collaboration connection timed out'});},30000);
   s.flush=setInterval(()=>{
    const expired=[];for(const [k,f]of s.frames)if(f.expiresAt<=now()){s.frames.delete(k);expired.push({...f,data:null,expired:true});}if(expired.length)emit('collab.transient',{document:s.document,items:expired});
   },250);void connect(s);return s.promise;
  },
  transient(kind,key='self',data=null){const s=current;if(!s?.online||s.stopped)return false;if(!['awareness','preview'].includes(kind)||!/^[a-zA-Z0-9_-]{1,60}$/.test(key)||new TextEncoder().encode(JSON.stringify(data)).length>8192)throw error('Invalid collaboration preview',400);const k=kind+':'+key;if(s.queued.size>=64&&!s.queued.has(k))return false;s.queued.set(k,{kind,key,data,at:now()});drain(s);return true;},
  commit(batch){const s=current;if(!s?.online||s.stopped)return Promise.reject(error('Join collaboration before committing',503));return rpc(s,'commit',{batch});},
  leave(){if(current){stop(current);emit('collab.reset',{document:current.document});current=null;}return {ok:true};},
  close(){closed=true;if(current)stop(current);current=null;}
 };
}
