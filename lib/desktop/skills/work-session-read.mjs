import {redactSecretValues} from '../../shared/conversation-privacy.mjs';
import {reduceMessages,buildWorkTurns} from '../../shared/work-transcript.mjs';

// Decrypt on the requesting bridge. Only dialogue text may leave this adapter.
export async function sessionReadResult(packet,bridge){
  if(packet.status!=='ok')return packet;
  const {native,turns,limit,...identity}=packet;
  const decrypt=entry=>bridge.chatEncryption.ring().decrypt(packet.projectId,entry.context,entry.secure);
  function project(p){
    if(!['message','delta'].includes(p.kind)||!['user','assistant'].includes(p.role)||typeof p.text!=='string')return null;
    return {id:p.id,turnId:p.turnId,replaceId:p.replaceId,kind:p.kind,role:p.role,text:p.text,phase:p.phase||p.raw?.phase,hidden:p.hidden===true};
  }
  const text=p=>redactSecretValues(p.text);
  function summarize(messages,status){
    const candidates=messages.filter(p=>p.role==='assistant'&&p.text?.trim());
    const explicit=candidates.filter(p=>p.phase==='final_answer');
    const end=explicit.length?explicit:candidates.filter(p=>!p.phase).slice(-1);
    if(status==='done')return {reply:end.map(text).join('\n\n')||null};
    return {reply:null,progress:candidates.at(-1)?text(candidates.at(-1)):null};
  }
  async function messages(entries){
    const list=[],fragments=new Map();
    for(const entry of entries){
      let p=entry.secure?await decrypt(entry):entry;
      if(p.kind!==entry.kind||p.role!==entry.role)throw Error('Unexpected event envelope');
      if(p.kind==='fragment'){
        if(p.role!=='assistant'||typeof p.group!=='string'||!Number.isInteger(p.total)||p.total<1||p.total>1000||!Number.isInteger(p.index)||p.index<0||p.index>=p.total||typeof p.data!=='string')throw Error('Incomplete reply');
        const parts=fragments.get(p.group)||{total:p.total,data:new Map()};
        if(parts.total!==p.total)throw Error('Incomplete reply');
        parts.data.set(p.index,p.data);fragments.set(p.group,parts);
        if(parts.data.size!==p.total)continue;
        fragments.delete(p.group);
        p=JSON.parse(Array.from({length:p.total},(_,i)=>parts.data.get(i)).join(''));
        if(p.role!=='assistant')throw Error('Unexpected fragment role');
      }
      const item=project(p);if(item)list.push({payload:item});
    }
    if(fragments.size)throw Error('Incomplete reply');
    return reduceMessages(list);
  }
  try{
    if(native){
      const groups=buildWorkTurns(await messages(native),[],packet.sessionStatus==='idle'?'done':packet.sessionStatus);
      return {...identity,turns:groups.slice(-limit).map(g=>({status:g.status,prompts:g.prompts.map(p=>p.hidden?null:text(p)),...summarize(g.replies,g.status)}))};
    }
    const result=[];
    for(const turn of turns){
      const prompts=[];
      for(const p of turn.prompts){
        if(p.hidden){prompts.push(null);continue;}
        const value=p.secure?(await decrypt(p))[p.field]:p.text;
        prompts.push(typeof value==='string'?redactSecretValues(value):null);
      }
      result.push({commandId:turn.commandId,status:turn.status,created:turn.created,prompts,
        ...(turn.responseHidden?{responseHidden:true,reply:null}:summarize(await messages(turn.events),turn.status))});
    }
    return {...identity,turns:result};
  }catch(e){
    // Neither ciphertext nor a partially decrypted conversation is a usable result.
    return {...identity,status:e.message==='Incomplete reply'?'incomplete':'decryption_unavailable'};
  }
}
