import {redactSecrets,maskedSubmissionPreview} from './conversation-privacy.mjs';

export const ENCRYPTED_SCHEDULE_PROMPT='[加密会话消息 / Encrypted session message]';
// The save request is immutable across pause/resume and distinct from each run.
export const scheduleContext=row=>['schedule',row.sessionId,row.userId,row.requestId];

export async function scheduledCommand(ring,row,id){
 const payload=row.secureSchedule?await ring.decrypt(row.projectId,scheduleContext(row),row.secureSchedule):{prompt:row.prompt};
 if(typeof payload.prompt!=='string'||!payload.prompt.trim()||payload.prompt.length>30000)throw Error('定时任务内容无效 / Invalid scheduled prompt');
 const prompt=redactSecrets(payload.prompt);
 // Never persist plaintext in scheduler state or reuse ciphertext authenticated
 // for another occurrence. Each run enters the normal encrypted command path.
 return {
  secureCommand:await ring.encrypt(row.projectId,['command',row.sessionId,id],{prompt:payload.prompt,files:[]}),
  secureDisplay:await ring.encrypt(row.projectId,['command-display',row.sessionId,id],{prompt,...(prompt!==payload.prompt?{maskedPreview:maskedSubmissionPreview(payload.prompt)}:{}),files:[]}),
 };
}
