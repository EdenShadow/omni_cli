import {randomUUID} from 'node:crypto';
import {runtimeQuestions,runtimeAnswerValues} from '../shared/runtime-questions.mjs';

// Process-local: never rewrite the user's Codex configuration or change modes.
export const codexQuestionArgs=['-c','features.default_mode_request_user_input=true'];
export const questionGuidance='Wanwu displays structured questions as selectable options with an always-visible free-text field. When a clarification or choice genuinely needs the user\'s answer, use the available question tool (Codex: request_user_input; Claude: AskUserQuestion) instead of only writing a question and bullet options in ordinary text. Do not ask unnecessary questions when the request is already clear. Do not turn explanatory lists into questions, or invent a user answer. After submitting a blocking question, wait for its answer before dependent work.';

export async function askRuntimeQuestion(ask,details,emit=()=>{}){
 const id='runtime-question-'+randomUUID(),questions=runtimeQuestions(details.questions);
 const questionText=questions.map(q=>[q.question,...q.options.map(o=>'• '+o.label)].join('\n')).join('\n\n');
 const base={id,kind:'tool',role:'system',activity:'runtimeQuestion',label:'userInput'};
 emit({...base,status:'waiting',text:questionText});
 try{
  const answer=await ask(details);
  const cancelled=answer===false;
  const text=questions.map((q,i)=>q.question+'\n'+(cancelled?'未回答 / Not answered':q.isSecret?'已回答私密问题 / Private answer submitted':runtimeAnswerValues(answer,q,i).join('\n'))).join('\n\n');
  emit({...base,status:cancelled?'cancelled':'completed',text});
  return answer;
 }catch(error){emit({...base,status:'cancelled',text:questionText});throw error;}
}
