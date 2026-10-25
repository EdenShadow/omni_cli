import {referenceMatches} from './reference-tokens.mjs';
import {materialTokens, stripMaterialReferences} from './input-materials.mjs';
export const BOT_ID='wanwu-sync-bot';
export const memberMentionToken=name=>'@'+String(name).replace(/[【】\r\n]/g,' ').trim().slice(0,100);
export const hasBotMention=(text,materialNames=[])=>/(?:^|[\s\p{Script=Han}，。！？：；、(（])@bot(?=$|[\s\p{Script=Han}，。！？：；、,.!?;:）)])(?!\.[\p{L}\p{N}_])/iu.test(stripMaterialReferences(text,materialNames));
const aliases=m=>m.kind==='member'&&!m.token.startsWith('@【')?[m.token,`@【${m.token.slice(1)}】`]:[m.token];
export function activeMentions(text,mentions=[],materialNames=[]){
 const matches=referenceMatches(text,[...mentions.flatMap(aliases),...materialTokens(materialNames)]);
 return mentions.flatMap(m=>{
  if(m.kind==='bot')return hasBotMention(text,materialNames)?[m]:[];
  const found=matches.find(match=>aliases(m).includes(match.token)&&!materialTokens(materialNames).includes(match.token));
  return found?[{...m,token:found.token}]:[];
 });
}
export function remarkMentions(mentions=[],userId='',materialNames=[]){
 return ()=>tree=>{
  const tokens=mentions.filter(m=>m.token),visit=node=>{
   if(['code','inlineCode','link'].includes(node.type)||!node.children)return;
   node.children=node.children.flatMap(child=>{
    if(child.type!=='text'){visit(child);return [child];}
    const labels=[...tokens.map(m=>m.token),...materialTokens(materialNames)];
    // Bot matching is case-insensitive, while member/file labels retain case.
    if(tokens.some(m=>m.kind==='bot'))labels.push(...child.value.match(/@bot/ig)||[]);
    let offset=0;const parts=[];
    for(const match of referenceMatches(child.value,labels)){
     const found=tokens.find(m=>m.kind==='bot'?match.token.toLowerCase()==='@bot':match.token===m.token);
     if(match.start>offset)parts.push({type:'text',value:child.value.slice(offset,match.start)});
     if(found&&!materialTokens(materialNames).includes(match.token))parts.push({type:'strong',data:{hProperties:{className:'chat-mention'+(found.id===userId?' is-self':'')}},children:[{type:'text',value:'@'+found.name}]});
     else parts.push({type:'text',value:match.token.replace(/^@「(.*)」$/u,'@$1')});
     offset=match.end;
    }
    if(offset<child.value.length)parts.push({type:'text',value:child.value.slice(offset)});
    return parts;
   });
  };visit(tree);
 };
}
