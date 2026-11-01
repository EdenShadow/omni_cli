import {referenceMatches} from '../shared/reference-tokens.mjs';
import {activeMentions,memberMentionToken,EVERYONE_ID,expandEveryoneMention} from '../shared/chat-mentions.mjs';

// Match readable prose only. Code, quoted examples and link destinations do not
// turn an AI answer into an unsolicited mention notification.
const prose=text=>text.replace(/```[^\n]*\n[\s\S]*?(?:```|(?![\s\S]))|~~~[^\n]*\n[\s\S]*?(?:~~~|(?![\s\S]))|`+[^`]*`+|^\s*>.*$|!?\[[^\]]*\]\([^)]*\)|<[^>]*>/gm,part=>' '.repeat(part.length));
export function resolveBotMentions(text,members,mentionIds=[],materialNames=[],mentionAll=false){
 const byId=new Map(members.map(m=>[m.id,m])),tokens=new Map();
 for(const m of members){
  for(const name of new Set([m.displayName,m.projectNickname,m.accountDisplayName,m.username].filter(Boolean))){
   const token=memberMentionToken(name);if(!tokens.has(token))tokens.set(token,new Map());tokens.get(token).set(m.id,m);
  }
 }
 const candidates=[...tokens].filter(([token,people])=>people.size===1&&!/^@(bot|所有人|everyone)$/i.test(token)).map(([token,people])=>{const m=[...people.values()][0];return {kind:'member',id:m.id,name:m.displayName||m.username,token};});
 // Keep the existing member wire format so receiving clients need no new
 // mention type. The visible all-members label remains a single label.
 const everyoneTokens=new Set(['@所有人','@everyone','@Everyone',...text.match(/@everyone/ig)||[]]);
 candidates.push(...[...everyoneTokens].map(token=>({kind:'member',id:EVERYONE_ID,name:token.slice(1),token})));
 let mentions=activeMentions(prose(text),candidates,materialNames);
 if(mentionAll&&!mentions.some(m=>m.id===EVERYONE_ID)){
  text='@所有人 '+text;mentions.push({kind:'member',id:EVERYONE_ID,name:'所有人',token:'@所有人'});
 }
 mentions=expandEveryoneMention(mentions,members);
 for(const id of new Set(mentionIds)){
  const m=byId.get(id);if(!m)throw Error('被 @ 的成员已不在当前项目，请重新选择 / Mentioned member is not in this project');
  if(mentions.some(v=>v.id===id))continue;
  // Username is unique even when project nicknames collide; always show the
  // explicit recipient in the message, instead of hiding notification metadata.
  const token='@【'+String(m.username||m.displayName).replace(/[【】\r\n]/g,' ').trim().slice(0,100)+'】';
  text=token+' '+text;mentions.push({kind:'member',id,name:m.displayName||m.username,token});
 }
 return {text,mentions};
}
export async function prepareBotMentions(request,text,mentionIds=[],materialNames=[],mentionAll=false){
 if(!text.includes('@')&&!mentionIds.length&&!mentionAll)return {text,mentions:[]};
 const members=[],seen=new Set();let cursor;
 do{
  const page=await request({action:'scene-members',limit:100,...(cursor?{cursor}:{})});
  if(!Array.isArray(page.members))throw Error('请更新万物 AI 服务以读取项目成员 / Update server for project members');
  members.push(...page.members);cursor=page.nextCursor;
  if(cursor&&seen.has(cursor))throw Error('成员列表有变化，请重试 / Member list changed; retry');
  if(cursor)seen.add(cursor);
 }while(cursor);
 return resolveBotMentions(text,members,mentionIds,materialNames,mentionAll);
}

export function botReplyChunks(text,mentions,limit=3800){
 const visible=prose(text),matches=referenceMatches(visible,mentions.map(m=>m.token)),chunks=[];
 for(let offset=0;offset<text.length;){
  let end=Math.min(text.length,offset+limit);
  const crossing=matches.find(m=>m.start<end&&m.end>end);
  if(crossing&&crossing.start>offset)end=crossing.start;
  const part=text.slice(offset,end);
  chunks.push({offset,text:part,mentions:activeMentions(visible.slice(offset,end),mentions)});offset=end;
 }
 return chunks;
}
