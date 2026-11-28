// Resolve non-secret field locations against this turn's decrypted user message.
// The CLI can describe a field without repeating its value in tool arguments.
export function credentialInput(body,prompt){
  if(body.fromPrompt===undefined)return body;
  const {fromPrompt,...write}=body;
  const invalid=()=>Error('无法从本轮消息准确定位凭据字段 / Invalid field reference in the current message');
  const isMap=value=>value&&typeof value==='object'&&!Array.isArray(value);
  if(typeof prompt!=='string'||!isMap(fromPrompt)||(body.values!==undefined&&!isMap(body.values)))throw invalid();
  const lines=prompt.split(/\r\n|\n|\r/);
  const values={...body.values};
  for(const [field,ref] of Object.entries(fromPrompt)){
    if(!/^[a-z][a-z0-9_-]{0,63}$/.test(field)||Object.hasOwn(values,field)||!isMap(ref)
      ||Object.keys(ref).some(k=>!['line','after','before'].includes(k))
      ||!Number.isInteger(ref.line)||ref.line<1||ref.line>lines.length)throw invalid();
    let value=lines[ref.line-1];
    for(const key of ['after','before']){
      const marker=ref[key];
      if(marker===undefined)continue;
      if(typeof marker!=='string'||!marker.length||marker.length>128)throw invalid();
      const at=value.indexOf(marker);
      if(at<0||at!==value.lastIndexOf(marker))throw invalid();
      value=key==='after'?value.slice(at+marker.length):value.slice(0,at);
    }
    if(!value.length||value.length>16384)throw invalid();
    values[field]=value;
  }
  return {...write,values};
}
