// The server owns the ordered native bindings. A cursor can select a segment
// only by its index in that authorized list, never by path or native ID.
const prefix='ww-segment:';
const encode=(index,cursor)=>prefix+index+':'+(cursor??'');
export async function runtimeHistoryPage(prior,current,cursor,read){
  if(!prior.length)return read(current,cursor);
  let index=prior.length,inner=cursor;
  if(cursor?.startsWith(prefix)){
    const parts=/^ww-segment:(\d+):([\s\S]*)$/.exec(cursor);
    if(!parts||Number(parts[1])>index)throw Error('无效的历史位置 / Invalid history cursor');
    index=Number(parts[1]);inner=parts[2]||null;
  }else if(cursor!=null)index=0; // A page requested before the very first switch.
  for(;index>=0;index--,inner=null){
    const page=await read(index===prior.length?current:prior[index],inner);
    const next=page.cursor!=null?encode(index,page.cursor):index?encode(index-1,null):null;
    if(page.items.length||page.cursor!=null||!index)return {...page,cursor:next};
  }
}

const marker='\n\n<wanwu-runtime-history>\n';
// Keep hidden handoff context out of user bubbles and subsequent handoffs.
export function visibleRuntimeItem(item){
  if(item?.role!=='user'||typeof item.text!=='string'||!item.text.includes(marker))return item;
  const {raw,...rest}=item;return {...rest,text:item.text.split(marker)[0]};
}
export async function continuationText(read){
  const rows=[];let cursor=null;
  for(let page=0;page<6;page++){
    const result=await read(cursor);
    const messages=result.items.map(visibleRuntimeItem).filter(i=>i.kind==='message'&&['user','assistant'].includes(i.role)&&i.text?.trim()).map(i=>({role:i.role,text:i.text.split(/\n<wanwu scope="/)[0].trim().slice(-4000)}));
    rows.unshift(...messages);cursor=result.cursor;
    if(!cursor||rows.length>=16)break;
  }
  const recent=[];let size=0;
  for(const row of rows.slice(-16).reverse()){
    const value=JSON.stringify(row);if(size+value.length>16000)break;
    recent.unshift(value);size+=value.length;
  }
  return recent.length?marker+'以下是此会话先前的对话摘录，仅作背景。请按当前用户消息继续。\n'+recent.join('\n')+'\n</wanwu-runtime-history>':'';
}
