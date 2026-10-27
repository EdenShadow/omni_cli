import test from 'node:test';
import assert from 'node:assert/strict';
import {textQuestion} from '../lib/shared/text-question.mjs';
import {textQuestionId} from '../lib/shared/text-question-id.mjs';
const integration=(name,fn)=>test(name,{skip:!process.env.OMNI_WANWU_SOURCE,timeout:30000},fn);
let fixture,enqueue,until;
if(process.env.OMNI_WANWU_SOURCE)({fixture,enqueue,until}=await import('./helpers/bridge-fixture.mjs'));
const text='是否作为正式结算起点？这决定差额；画布开发不受影响，我会继续进行。\n\n- 是，使用累计值\n- 否，稍后提供\n- 从零开始';
const questions=[textQuestion(text)];
async function setup(t){const f=await fixture();t.after(()=>f.close());const d=f.devices[0],commandId=await enqueue(f,d,'Question test',f.other.token);await until(()=>d.runs.length);return {...f,d,commandId};}
const publish=(f,commandId=f.commandId,id=textQuestionId(commandId,'item'))=>f.call('/bridge/text-questions',f.d.bound.deviceToken,'POST',{id,commandId,questions}).then(()=>id);
integration('real bridge emission produces a form while the original turn is still running',async t=>{
 const f=await fixture();t.after(()=>f.close());const d=f.devices[0],adapter=d.b.adapter();let emit;
 adapter.run=(id,prompt,send,options)=>{emit=send;d.runs.push({id,prompt,options});return new Promise(resolve=>d.pending.set(id,resolve));};
 const commandId=await enqueue(f,d,'offline live question');await until(()=>emit);
 emit({kind:'delta',role:'assistant',id:'live',text:text.slice(0,55)});
 emit({kind:'delta',role:'assistant',id:'live',text:text.slice(55)});
 await until(async()=>{const rows=await f.call('/runtime-approvals',f.owner.token);return rows.some(r=>r.id===textQuestionId(commandId,'live'));});
 assert.equal(f.app.db.prepare('SELECT status FROM commands WHERE id=?').get(commandId).status,'running');
});
integration('multiple live sessions retain their own questions; answering B never targets A',async t=>{
 const f=await setup(t),a=await publish(f);
 const second=await f.d.b.createSession({projectId:f.project.id,provider:'codex',cwd:f.d.dataDir,title:'Second'});
 const bCommand=await enqueue(f,{session:second},'Second question',f.other.token);await until(()=>f.d.runs.length===2);
 const b=await publish(f,bCommand),rows=await f.call('/runtime-approvals',f.other.token);
 assert.equal(rows.length,2);assert.equal(rows.find(r=>r.id===a).sessionId,f.d.session.id);assert.equal(rows.find(r=>r.id===b).sessionId,second.id);
 const values={answers:{choice:['否，稍后提供\n补充说明']}};
 const answers=await Promise.allSettled([f.call(`/runtime-approvals/${b}/answer`,f.other.token,'POST',{answer:values}),f.call(`/runtime-approvals/${b}/answer`,f.other.token,'POST',{answer:values})]);
 assert.equal(answers.filter(r=>r.status==='fulfilled').length,1);
 const sent=f.app.db.prepare('SELECT session_id,prompt FROM commands WHERE id=?').get(b);assert.equal(sent.session_id,second.id);assert.match(sent.prompt,/补充说明/);
 assert.equal(f.app.db.prepare('SELECT count(*) n FROM commands WHERE id=?').get(b).n,1);
 assert((await f.call('/runtime-approvals',f.other.token)).some(r=>r.id===a));
});
integration('text questions survive normal completion but cancellation and access revocation close them',async t=>{
 const f=await setup(t),id=await publish(f);f.d.finish();await until(()=>f.d.b.busy.size===0);
 assert((await f.call('/runtime-approvals',f.other.token)).some(r=>r.id===id));
 f.app.taskNotifications.flush();assert.equal(f.app.db.prepare('SELECT count(*) n FROM task_notices WHERE command_id=?').get(f.commandId).n,0,'Waiting for an answer is not a completed-task notice');
 await assert.rejects(f.call(`/runtime-approvals/${id}/answer`,f.owner.token,'POST',{answer:{answers:{choice:['是，使用累计值']}}}),{status:403});
 f.app.db.prepare('DELETE FROM members WHERE project_id=? AND user_id=?').run(f.project.id,f.other.user.id);
 assert.deepEqual(await f.call('/runtime-approvals',f.other.token),[]);
});
integration('real tool question supersedes text fallback and foreground claims are account-only and deduplicated',async t=>{
 const f=await setup(t),id=await publish(f);
 assert.deepEqual(await f.call(`/runtime-approvals/${id}/notice`,f.other.token,'POST',{}),{show:true});
 assert.deepEqual(await f.call(`/runtime-approvals/${id}/notice`,f.other.token,'POST',{}),{show:false});
 await assert.rejects(f.call(`/runtime-approvals/${id}/notice`,f.owner.token),{status:404});
 const answer=f.d.b.approvals.request({commandId:f.commandId,provider:'codex',kind:'question',title:'Question',detail:'',questions});
 await until(async()=>{const rows=await f.call('/runtime-approvals',f.other.token);return rows.length===1&&rows[0].id!==id;});
 const [q]=await f.call('/runtime-approvals',f.other.token);
 assert.deepEqual(await f.call(`/runtime-approvals/${q.id}/notice`,f.other.token,'POST',{}),{show:false});
 await f.call(`/runtime-approvals/${q.id}/answer`,f.other.token,'POST',{answer:false});assert.equal(await answer,false);
});

integration('encrypted CLI questions arrive during two active turns and replies remain in their source session',async t=>{
 const {randomUUID}=await import('node:crypto');
 const {ChatKeyring}=await import('../lib/shared/chat-crypto.mjs');
 const f=await fixture({requireEncryptedChat:true});t.after(()=>f.close());
 let state;const ring=new ChatKeyring({load:async()=>state,save:async value=>{state=structuredClone(value);},request:(p,m,b)=>f.call(p,f.owner.token,m,b)});
 await until(async()=>{const r=await ring.sync(f.project.id);for(const d of f.devices)await d.b.chatEncryption.sync();return r.ready;});
 await until(async()=>{await ring.sync(f.project.id);try{for(const d of f.devices)await d.b.chatEncryption.ring().key(f.project.id);return true;}catch{return false;}});
 const commands=[],emitters=[],publications=[];
 for(const [i,d] of f.devices.entries()){
  const request=d.b.request;
  d.b.request=async(p,m,body,...rest)=>{if(p==='/api/bridge/text-questions')publications.push(body);return request(p,m,body,...rest);};
  d.b.adapter().run=(id,prompt,emit,options)=>{emitters[i]=emit;d.runs.push({id,prompt,options});return new Promise(resolve=>d.pending.set(id,resolve));};
  const id=randomUUID(),payload={prompt:'PRIVATE_TASK_'+i,files:[]};commands.push(id);
  await f.call(`/sessions/${d.session.id}/commands`,f.owner.token,'POST',{
   id,prompt:'[加密会话消息 / Encrypted session message]',
   secureCommand:await ring.encrypt(f.project.id,['command',d.session.id,id],payload),
   secureDisplay:await ring.encrypt(f.project.id,['command-display',d.session.id,id],payload),
  });
 }
 await until(()=>emitters.filter(Boolean).length===2);
 for(const [i,emit]of emitters.entries())emit({kind:'delta',role:'assistant',id:'same-item-id',text:`PRIVATE_QUESTION_${i}：是否继续？\n- 继续\n- 稍后`});
 const ids=commands.map(id=>textQuestionId(id,'same-item-id'));
 await until(async()=>{const rows=await f.call('/runtime-approvals',f.owner.token);return ids.every(id=>rows.some(r=>r.id===id));});
 assert.equal(publications.length,2,'CLI source relay, not server plaintext detection');
 assert(publications.every(p=>p.secureApproval&&!p.questions));
 assert(!JSON.stringify(publications).includes('PRIVATE_QUESTION_'));
 const rows=await f.call('/runtime-approvals',f.owner.token);
 for(const [i,id]of ids.entries()){
  const row=rows.find(r=>r.id===id);
  assert.equal(row.sessionId,f.devices[i].session.id);
  assert.equal(f.app.db.prepare('SELECT status FROM commands WHERE id=?').get(commands[i]).status,'running');
  const question=await ring.decrypt(f.project.id,['approval',id],row.secureApproval);
  assert.match(question.questions[0].question,new RegExp('PRIVATE_QUESTION_'+i));
 }
 assert.deepEqual(await f.call('/runtime-approvals',f.other.token),[]);
 const id=ids[1],sid=f.devices[1].session.id,payload={prompt:'PRIVATE_REPLY_继续',files:[]};
 await f.call(`/runtime-approvals/${id}/answer`,f.owner.token,'POST',{reply:{
  prompt:'[加密会话消息 / Encrypted session message]',
  secureCommand:await ring.encrypt(f.project.id,['command',sid,id],payload),
  secureDisplay:await ring.encrypt(f.project.id,['command-display',sid,id],payload),
 }});
 assert.equal(f.app.db.prepare('SELECT session_id FROM commands WHERE id=?').get(id).session_id,sid);
 const options=JSON.parse(f.app.db.prepare('SELECT doc FROM command_options WHERE command_id=?').get(id).doc);
 assert.equal((await ring.decrypt(f.project.id,['command',sid,id],options.secureCommand)).prompt,payload.prompt);
 assert((await f.call('/runtime-approvals',f.owner.token)).some(r=>r.id===ids[0]));
 assert(!JSON.stringify(f.app.db.prepare('SELECT * FROM runtime_approvals').all()).includes('PRIVATE_QUESTION_'));
});
