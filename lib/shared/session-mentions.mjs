import {referenceMatches} from './reference-tokens.mjs';
import {activeMentions,hasBotMention} from './chat-mentions.mjs';
const invalid=message=>Object.assign(Error(message),{status:400});
export const normalizeSessionAlias=value=>String(value||'').normalize('NFKC').trim().replace(/^@/,'');
export const sessionAliasKey=value=>normalizeSessionAlias(value).toLowerCase();
export const validSessionAlias=value=>value.length<=32&&/^[\p{L}\p{N}_-]{1,32}$/u.test(value)&&!/^bot$/i.test(value);
export const sessionDisplayName=session=>session?.mentionAlias?'@'+normalizeSessionAlias(session.mentionAlias):session?.note||session?.title||'';
// One editor field: a plain title removes the mention name; @name sets both.
// Keep the legacy wire fields so older clients can continue editing notes.
export function sessionNameFields(value){
 const name=String(value||'').trim();
 if(!/^[@＠]/.test(name))return {summary:name,mentionAlias:''};
 const alias=normalizeSessionAlias(name);
 if(!validSessionAlias(alias))throw invalid('@名字限 1–32 个中文、字母、数字、下划线或短横线，不能使用 Bot / Invalid @name');
 return {summary:'@'+alias,mentionAlias:alias};
}
const otherBotMention=(text,mentions,names)=>{let remaining=text;for(const match of referenceMatches(text,mentions.map(m=>m.token)).reverse())remaining=remaining.slice(0,match.start)+' '+remaining.slice(match.end);return hasBotMention(remaining,names);};
// Labels are presentation only. The selected session ID is the destination,
// including when several devices expose exactly the same visible token.
export function resolveSessionMentions(text,targets=[],selected=[],materialNames=[]){
 const active=activeMentions(text,targets,materialNames),result=[];
 for(const token of new Set(active.map(m=>m.token))){
  const options=active.filter(m=>m.token===token),chosen=selected.filter(m=>m.token===token);
  if(chosen.some(m=>m.kind!=='session'))continue;
  const explicit=chosen.filter(m=>m.kind==='session');
  if(explicit.length){const match=options.find(m=>m.id===explicit.at(-1).id);if(!match)throw invalid('这个 @会话已更名或不可用，请重新选择 / Select the session again');result.push(match);}
  else if(options.length===1)result.push(options[0]);
  else throw invalid('存在同名 @会话，请从列表选择具体设备 / Choose a device for this session mention');
 }
 // A stale selected target must never silently turn into a generic Bot request.
 for(const m of activeMentions(text,selected.filter(m=>m.kind==='session'),materialNames))if(!result.some(r=>r.id===m.id))throw invalid('这个 @会话已更名或不可用，请重新选择 / Select the session again');
 if(result.length>1||result.length&&otherBotMention(text,result,materialNames))throw invalid('每条消息请只选择一个 AI 会话 / Choose one AI session per message');
 return result;
}
export function sessionTargetFromMentions(text,mentions=[],materialNames=[]){
 const active=activeMentions(text,mentions.filter(m=>m.kind==='session'),materialNames);
 if(active.length>1||active.length&&otherBotMention(text,active,materialNames))throw invalid('每条消息请只选择一个 AI 会话 / Choose one AI session per message');
 const m=active[0];if(!m)return undefined;
 if(!validSessionAlias(m.name)||m.token!=='@'+m.name||!m.deviceId)throw invalid('Invalid session mention');
 return {sessionId:m.id,deviceId:m.deviceId,alias:m.name};
}
