// Only explicit assistant questions followed by choices qualify. Code, quoted
// examples, checklists and ordinary progress lists are not questions.
export function textQuestion(text) {
 if(typeof text!=='string'||text.length>48000)return null;
 const lines=text.replace(/\r/g,'').split('\n');
 let fenced=false,clean=[];
 for(const line of lines){if(/^\s*(```|~~~)/.test(line)){fenced=!fenced;clean.push('');continue;}clean.push(fenced||/^\s*>/.test(line)?'':line);}
 const choice=/^\s*(?:[-*•]|\d{1,2}[.)、]|[A-Fa-f][.)、])\s+(.+?)\s*$/;
 let start=-1,end=-1,options=[];
 for(let i=0;i<clean.length;i++){
  const match=clean[i].match(choice);
  if(match&&!/^\[[ xX]\]/.test(match[1])){if(start<0)start=i;options.push(match[1].replace(/\*\*/g,'').trim());end=i;}
  else if(clean[i].trim()){start=-1;end=-1;options=[];}
 }
 if(start<0||options.length<2||options.length>6||new Set(options).size!==options.length||options.some(o=>o.length>360))return null;
 const before=clean.slice(0,start).join('\n').trim(),paragraph=before.split(/\n\s*\n/).at(-1)?.replace(/\*\*/g,'').trim()||'';
 if(!/[?？]/.test(paragraph)||paragraph.length>1600||paragraph.length<3||/^\s*(?:(?:例如|示例)(?:[:：，,\s]|$)|(?:Example|For example)\b)/i.test(paragraph))return null;
 // No unrelated prose following the choices; an incomplete trailing marker is
 // held until the next streamed fragment rather than offered as an answer.
 if(clean.slice(end+1).some(l=>l.trim()))return null;
 return {id:'choice',question:paragraph,allowOther:true,options:options.map(label=>({label,description:''}))};
}

export function watchTextQuestions(onQuestion,{delay=800}={}){
 const items=new Map();let stopped=false;
 function publish(id,row){clearTimeout(row.timer);row.timer=null;const q=textQuestion(row.text);if(!q)return;const key=JSON.stringify(q);if(key===row.published)return;row.published=key;onQuestion(id,q);}
 return {
  event(p){
   if(stopped||p?.role!=='assistant'||!['message','delta'].includes(p.kind)||!p.id||typeof p.text!=='string')return;
   const row=items.get(p.id)||{text:'',published:''};
   row.text=p.kind==='delta'?row.text+p.text:p.text;clearTimeout(row.timer);
   if(row.text.length>48000){items.delete(p.id);return;}
   items.set(p.id,row);row.timer=setTimeout(()=>publish(p.id,row),delay);row.timer.unref?.();
   if(items.size>24){const first=items.keys().next().value;clearTimeout(items.get(first).timer);items.delete(first);}
  },
  flush(){for(const [id,row]of items)publish(id,row);},
  stop(){stopped=true;for(const row of items.values())clearTimeout(row.timer);items.clear();}
 };
}
