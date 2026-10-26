import {createHash,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {seal} from '../lib/shared/chat-crypto.mjs';
import {hasBotMention,BOT_ID} from '../lib/shared/chat-mentions.mjs';
import {encryptedFileSize} from '../lib/shared/chat-file-crypto.mjs';
import {fingerprint} from './chat-store.mjs';

export function uuid(value,label='ID'){
  if(!/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(value||''))throw Error(`${label} must be a UUID`);
  return value;
}
export function integer(value,label,min=0,max=Number.MAX_SAFE_INTEGER){
  const n=Number(value);if(!Number.isSafeInteger(n)||n<min||n>max)throw Error(`Invalid ${label}`);return n;
}
// Compatibility with server/group-chat-bot.mjs operationId. Older servers
// attach only commandId to normal @Bot replies (no replyTo). Match exact
// deterministic IDs, never session name, latest message or a time window.
export function botCommandId(messageId,attempt=0){
  const h=createHash('sha256').update(messageId+':command:'+attempt).digest('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
}
const terminal=new Set(['done','failed','unavailable','cancelled']);
const metadata=m=>Object.fromEntries(['id','seq','projectId','userId','name','kind','created','replyTo','recalledAt','botTask'].filter(k=>m[k]!==undefined).map(k=>[k,m[k]]));

export async function decodeMessage(ring,project,m){
  const out=metadata(m);
  if(m.bot)out.bot=Object.fromEntries(['commandId','sessionId','deviceId','replyTo'].filter(k=>typeof m.bot[k]==='string').map(k=>[k,m.bot[k]]));
  if(m.recalledAt)return {...out,text:'',attachments:[]};
  let payload=m;
  if(m.secure){
    payload=await ring.decrypt(project,[m.senderId,m.clientId],m.secure);
    if(!['text','voice'].includes(payload?.kind)||typeof payload.text!=='string'||payload.text.length>4000||!Array.isArray(payload.files)||payload.files.length!==(m.attachments||[]).length||(payload.replyTo||undefined)!==(m.replyTo||undefined))throw Error('Invalid encrypted chat payload');
  }
  // Only public file metadata leaves the CLI. File decryption keys, envelopes,
  // quoted ciphertext and local identities must never appear in JSON output.
  const attachments=(m.attachments||[]).map((a,i)=>{
    const f=m.secure?payload.files[i]:a;
    if(!f||typeof f.name!=='string'||typeof f.mime!=='string'||!Number.isSafeInteger(f.size)||f.size<0)throw Error('Invalid attachment metadata');
    if(m.secure&&(f.v!==1||encryptedFileSize(f.size)!==a.size))throw Error('Invalid encrypted attachment size');
    return {id:a.id,name:f.name,mime:f.mime,size:f.size};
  });
  return {...out,kind:payload.kind,text:payload.text||'',attachments,...(payload.duration!==undefined?{duration:payload.duration}:{})};
}

export function createChat({request,storage,userId,signal,emit=()=>{},sleep=()=>delay(2000,undefined,{signal})}){
  const base=p=>`/api/projects/${uuid(p,'Project ID')}/chat`;
  async function decode(project,messages){return storage.exclusive(async({ring})=>{
    const result=[];for(const m of messages){signal?.throwIfAborted();result.push(await decodeMessage(ring,project,m));}return result;
  });}
  async function list(project,{after,before,limit=100}={}){
    if(after!==undefined&&before!==undefined)throw Error('Use either --after or --before');
    const query=new URLSearchParams({limit:String(integer(limit,'limit',1,100))});
    if(after!==undefined)query.set('after',String(integer(after,'after')));
    if(before!==undefined)query.set('before',String(integer(before,'before')));
    const page=await request(base(project)+'?'+query);
    const messages=await decode(project,page.messages);
    return {messages,hasMore:!!page.hasMore,cursor:messages.at(-1)?.seq??after??0,before:messages[0]?.seq??before??null,retentionDays:page.retentionDays};
  }
  async function send(project,{text,id=randomUUID(),replyTo,bot=false,botMode='continue',locale='zh'}){
    base(project);uuid(id,'Request ID');if(replyTo)uuid(replyTo,'Reply ID');
    if(!['continue','new'].includes(botMode)||!['zh','en'].includes(locale))throw Error('Invalid bot mode or locale');
    if(typeof text!=='string'||!text.trim())throw Error('Message text is required');
    if(bot&&!hasBotMention(text))text='@Bot '+text;
    if(text.length>4000)throw Error('Message exceeds 4000 characters');
    const botRequest=bot||hasBotMention(text);
    const payload={...(replyTo?{replyTo}:{}),botRequest,botMode,kind:'text',text,mentions:botRequest?[{kind:'bot',id:BOT_ID,name:'Bot',token:'@Bot'}]:[],files:[]};
    const hash=fingerprint([project,payload,locale]),name=`request-${project}-${id}.json`;
    return storage.exclusive(async({ring,read,write})=>{
      let saved=read(name);
      if(saved&&saved.hash!==hash)throw Error('Request ID already used with different content; use a new --id');
      // POST the same encrypted body again after an uncertain network outcome;
      // the server deduplicates by account + project + request ID.
      async function prepare(){
        const secure=await ring.encrypt(project,[userId,id],payload);
        signal?.throwIfAborted();
        const key=await ring.key(project,secure.keyId);
        const secureExecution=botRequest?await seal(key,[project,userId,id],payload):undefined;
        saved={hash,body:{id,...(replyTo?{replyTo}:{}),secure,...(secureExecution?{secureExecution}:{}),attachments:[],botRequest,botMode,locale}};
        write(name,saved);
      }
      if(!saved)await prepare();
      let m;
      try{m=await request(base(project),'POST',saved.body);}catch(e){
        // A definite epoch rejection means the message was not committed. Rewrap
        // once under the new room key, retaining the same deduplication ID.
        if(e.status!==409||e.message!=='CHAT_KEY_EPOCH_CHANGED')throw e;
        await prepare();m=await request(base(project),'POST',saved.body);
      }
      return {status:'sent',id:m.id,seq:m.seq,projectId:project,requestId:id,botRequested:botRequest,...(m.botTask?{botTask:m.botTask}:{})};
    });
  }
  async function drain(project,cursor,accept=()=>true){
    for(;;){
      signal?.throwIfAborted();
      const page=await request(base(project)+`?after=${integer(cursor,'cursor')}&limit=100`);
      const selected=page.messages.filter(accept);
      for(const m of await decode(project,selected))emit({type:'message',message:m});
      const next=page.messages.at(-1)?.seq??cursor;
      if(page.hasMore&&next<=cursor)throw Error('Invalid chat pagination');
      cursor=next;
      if(!page.hasMore)return cursor;
    }
  }
  async function watch(project,{after}={}){
    let cursor=after===undefined?(await list(project,{limit:1})).cursor:integer(after,'after'),recalls=0;
    const tasks=new Map();
    emit({type:'cursor',cursor});
    for(;;){
      cursor=await drain(project,cursor);
      const page=await request(base(project)+'?tasks=1');
      const current=new Set();
      for(const m of page.messages){current.add(m.id);const value=JSON.stringify(m.botTask);if(value!==tasks.get(m.id)){emit({type:'task',id:m.id,task:m.botTask});tasks.set(m.id,value);}}
      for(const id of tasks.keys())if(!current.has(id))tasks.delete(id);
      for(;;){
        const recalled=await request(base(project)+`?recallsAfter=${recalls}`);
        for(const m of recalled.messages)emit({type:'recall',id:m.id,recalledAt:m.recalledAt});
        if(recalled.hasMore&&recalled.recallCursor<=recalls)throw Error('Invalid recall pagination');
        recalls=recalled.recallCursor;if(!recalled.hasMore)break;
      }
      emit({type:'cursor',cursor});await sleep();
    }
  }
  async function wait(project,id){
    uuid(id,'Message ID');let cursor,last;
    const commands=new Set(Array.from({length:1024},(_,i)=>botCommandId(id,i)));
    const related=m=>m.replyTo===id||m.bot?.replyTo===id||commands.has(m.bot?.commandId);
    for(;;){
      signal?.throwIfAborted();
      // Status updates do not increment message seq. Fetch the original message
      // each time; an after-cursor poll alone would miss completion/failure.
      const page=await request(base(project)+`?around=${id}`),original=page.messages.find(m=>m.id===id);
      if(!original)throw Error('Message expired or unavailable');
      if(original.recalledAt){emit({type:'finished',id,status:'recalled'});return 'recalled';}
      cursor??=original.seq;
      if(original.botTask?.commandId)commands.add(original.botTask.commandId);
      const state=JSON.stringify(original.botTask);
      if(state!==last){emit({type:'task',id,task:original.botTask});last=state;}
      cursor=await drain(project,cursor,related);
      if(terminal.has(original.botTask?.status)){
        emit({type:'finished',id,status:original.botTask.status});return original.botTask.status;
      }
      await sleep();
    }
  }
  return {send,list,watch,wait};
}
