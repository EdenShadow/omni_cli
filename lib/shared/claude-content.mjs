import {withoutInlineMedia} from './transcript-media.mjs';
import {redactSecrets,submissionCommandId,maskedSubmissionPreview} from './conversation-privacy.mjs';
export function normalizeClaudeMessage(item) {
  item = withoutInlineMedia(item);
  const content = item.message?.content;
  const blocks = Array.isArray(content)
    ? content
    : [
        {
          type: "text",
          text:
            typeof content === "string"
              ? content
              : JSON.stringify(item.message || item),
        },
      ];
  return {
    id: item.uuid || item.message?.id || crypto.randomUUID(),
    kind: "message",
    role:
      item.type === "user"
        ? "user"
        : item.type === "assistant"
          ? "assistant"
          : "system",
    text: blocks
      .map(
        (b) =>
          b.text ||
          (b.type === "tool_use"
            ? `${b.name}\n${JSON.stringify(b.input, null, 2)}`
            : b.type === "tool_result"
              ? typeof b.content === "string"
                ? b.content
                : JSON.stringify(b.content)
              : b.type === "thinking"
                ? b.thinking
                : JSON.stringify(b)),
      )
      .join("\n"),
    raw: item,
  };
}
export function normalizeClaudeItems(item, fallbackId) {
  item = withoutInlineMedia(item);
  const content = item.message?.content;
  if (!['assistant','user'].includes(item.type)) return [];
  if (!Array.isArray(content)) return [{...normalizeClaudeMessage(item),...(fallbackId&&!item.uuid&&!item.message?.id?{id:fallbackId}:{})}];
  const base = item.uuid || item.message?.id || fallbackId || crypto.randomUUID();
  const submittedText = content.filter(block=>block.type==='text').map(block=>block.text||'').join('\n');
  const hideSubmission = item.type==='user' && redactSecrets(submittedText)!==submittedText;
  const commandId = item.type==='user' ? submissionCommandId(submittedText) : undefined;
  return content.flatMap((block,index) => {
    const common = {id:content.length === 1 ? base : base+':'+index, status:'completed'};
    if (block.type === 'text') return [{...common,...(commandId?{commandId}:{}),kind:'message',role:item.type,text:hideSubmission?'***':block.text,...(hideSubmission?{maskedPreview:maskedSubmissionPreview(submittedText)}:{})}];
    if (block.type === 'thinking') return block.thinking ? [{...common,kind:'tool',role:'system',activity:'reasoning',label:'思考摘要',text:block.thinking}] : [];
    if (block.type === 'tool_use') return [{...common,id:'claude-tool:'+block.id,kind:'tool',role:'system',label:block.name,
      status:'inProgress',command:block.input?.command,paths:[block.input?.file_path||block.input?.path].filter(Boolean),text:JSON.stringify(block.input,null,2)}];
    if (block.type === 'tool_result') return [{...common,id:'claude-tool:'+block.tool_use_id,kind:'tool',role:'system',status:block.is_error?'failed':'completed',output:typeof block.content==='string'?block.content:JSON.stringify(block.content)}];
    if (block.type === 'image') return [{...common,kind:'message',role:item.type,text:'[图片]'}];
    return [];
  });
}

// Match each streamed content block to its completed SDK envelope. A Claude
// message may contain thinking, text and multiple tools, each with its own delta.
export class ClaudeStream {
  constructor(){this.messages=new Map();this.current=new Map();}
  accept(message){
    const channel=message.parent_tool_use_id||'',current=this.current.get(channel)||'';
    if(message.type!=='stream_event'){
      const items=normalizeClaudeItems(message).map(item=>channel&&item.role==='assistant'?{...item,phase:'commentary'}:item),state=this.messages.get(message.message?.id||current);
      if(message.type!=='assistant'||!state)return items;
      const content=message.message?.content;
      if(!Array.isArray(content))return items;
      const output=[];
      for(let index=0;index<content.length;index++){
        const block=content[index],normalized=normalizeClaudeItems({...message,message:{...message.message,content:[block]}});
        if(!normalized.length)continue;
        const candidate=[...state.blocks.values()].find(b=>!b.consumed&&b.type===block.type&&(block.type!=='tool_use'||b.toolId===block.id));
        const item=items[output.length];
        if(candidate){candidate.consumed=true;output.push({...item,replaceId:candidate.item.id,streaming:false});}
        else output.push(item);
      }
      return output;
    }
    const event=message.event;
    if(event.type==='message_start'){
      this.current.set(channel,event.message.id);this.messages.set(event.message.id,{blocks:new Map()});return [];
    }
    const state=this.messages.get(current);if(!state)return [];
    if(event.type==='content_block_start'){
      const block=event.content_block;
      const item=normalizeClaudeItems({type:'assistant',uuid:'claude-stream:'+current+':'+event.index,message:{content:[block]}})[0];
      // Empty reasoning blocks become visible once public thinking deltas arrive.
      const start=item|| (block.type==='thinking'?{id:'claude-stream:'+current+':'+event.index,kind:'tool',role:'system',activity:'reasoning',label:'思考摘要',text:''}:null);
      if(!start)return [];
      if(block.type==='tool_use')start.text='';
      start.status='inProgress';start.streaming=true;if(channel&&start.role==='assistant')start.phase='commentary';
      state.blocks.set(event.index,{type:block.type,toolId:block.id,item:start});return [start];
    }
    const block=state.blocks.get(event.index);if(!block)return [];
    if(event.type==='content_block_delta'){
      const delta=event.delta,part=delta.type==='text_delta'?delta.text:delta.type==='thinking_delta'?delta.thinking:delta.type==='input_json_delta'?delta.partial_json:null;
      if(typeof part!=='string')return [];
      block.item={...block.item,text:(block.item.text||'')+part};
      return [{...block.item,kind:'delta',text:part}];
    }
    if(event.type==='content_block_stop'){
      block.item={...block.item,status:block.type==='tool_use'?'inProgress':'completed',streaming:false};return [block.item];
    }
    return [];
  }
}
