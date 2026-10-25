// One canonical question/answer shape across Codex, Claude, desktop and web.
export function runtimeQuestions(values){
 if(!Array.isArray(values))return [];
 return values.slice(0,16).map((q,i)=>({id:String(q.id||`question-${i}`).slice(0,200),question:String(q.question||q.header||'').slice(0,8000),header:String(q.header||'').slice(0,100),multiSelect:q.multiSelect===true,allowOther:q.allowOther!==false&&q.isOther!==false,isSecret:q.isSecret===true,options:(q.options||[]).slice(0,30).map(o=>({label:String(o.label||'').slice(0,1000),description:String(o.description||'').slice(0,3000)}))}));
}
export function validateRuntimeAnswer(details,answer){
 if(answer===false)return false;
 if(details.kind!=='question'){
  if(answer!==true)throw Error('请选择允许或拒绝 / Choose allow or deny');
  return true;
 }
 const questions=runtimeQuestions(details.questions);
 if(!questions.length)throw Error('问题已失效 / Question unavailable');
 const values=typeof answer==='string'&&questions.length===1?{[questions[0].id]:[answer]}:answer?.answers;
 if(!values||typeof values!=='object'||Array.isArray(values))throw Error('请逐题填写回答 / Answer each question');
 const answers={};
 for(const q of questions){
  const list=values[q.id];
  if(!Array.isArray(list)||!list.length||list.length>30||!q.multiSelect&&list.length!==1||list.some(v=>typeof v!=='string'||!v.trim()||v.length>8000))throw Error('请完整回答每道题 / Complete every answer');
  if(!q.allowOther&&q.options.length&&list.some(v=>!q.options.some(o=>o.label===v)))throw Error('请选择提供的选项 / Choose a listed option');
  answers[q.id]=[...new Set(list.map(v=>v.trim()))];
 }
 if(Object.keys(values).some(id=>!questions.some(q=>q.id===id)))throw Error('问题已变化 / Questions changed');
 return {answers};
}
export function runtimeAnswerValues(answer,q,i){
 if(typeof answer==='string')return [answer]; // Compatibility with existing local clients.
 return answer?.answers?.[q.id||`question-${i}`]||[];
}

// A single-choice answer remains one value even when the user adds a note.
// Keeping this shared makes browser validation and runtime delivery identical.
export function runtimeQuestionAnswers(questions,selected={},custom={}){
 return {answers:Object.fromEntries(runtimeQuestions(questions).map(q=>{
  const values=(selected[q.id]||[]).filter(v=>q.options.some(o=>o.label===v));
  const note=q.allowOther||!q.options.length?String(custom[q.id]||'').trim():'';
  const combined=[values[0],note].filter(Boolean).join('\n\n');
  return [q.id,q.multiSelect?[...values,...(note?[note]:[])]:combined?[combined]:[]];
 }))};
}
