import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as wait} from 'node:timers/promises';
import {randomUUID} from 'node:crypto';
import {textQuestion,watchTextQuestions} from '../lib/shared/text-question.mjs';
import {textQuestionId} from '../lib/shared/text-question-id.mjs';
import {relayTextQuestions} from '../lib/desktop/text-question-relay.mjs';

const text='是否作为正式结算起点？这决定差额；画布开发不受影响，我会继续进行。\n\n- 是，使用累计值\n- 否，稍后提供\n- 从零开始';
const questions=[textQuestion(text)];
test('explicit choice question qualifies; code, quotes, checklists and summaries do not',()=>{
 assert.equal(questions[0].options.length,3);
 for(const value of ['已完成这些步骤：\n- 读取文件\n- 创建画布','问题是什么？\n- [x] 测试\n- [ ] 构建','```md\n'+text+'\n```',text.split('\n').map(l=>'> '+l).join('\n'),'本次改动\n- 修复\n- 测试','是否继续？\n- 是\n- 否\n以下是工作总结','是否继续？\n- 是\n-'])assert.equal(textQuestion(value),null,value);
 assert.equal(textQuestion('继续吗？\n- 是\n- 否').options.length,2);assert.equal(textQuestion('示例：要继续吗？\n- 是\n- 否'),null);
 assert.equal(textQuestion('Which style should I use?\n1. Light\n2. Dark').options[1].label,'Dark');
});
test('streaming question appears before turn completion, updates once and ignores tool output',async()=>{
 const results=[],w=watchTextQuestions((id,q)=>results.push({id,q}),{delay:8});
 w.event({role:'system',kind:'message',id:'tool',text});
 for(const chunk of [text.slice(0,55),text.slice(55)])w.event({role:'assistant',kind:'delta',id:'a',text:chunk});
 await wait(25);assert.equal(results.length,1);assert.equal(results[0].q.options.length,3);
 w.event({role:'assistant',kind:'message',id:'a',text});await wait(25);assert.equal(results.length,1);
 w.stop();
});
test('encrypted source publishes only ciphertext and does not wait for the answer',async()=>{
 const sent=[],b={chatEncryption:{ring:()=>({encrypt:async(project,context,value)=>{assert.equal(value.questions[0].question,questions[0].question);return {opaque:true};}})},request:async(...args)=>sent.push(args)};
 const r=relayTextQuestions(b,{id:randomUUID(),project_id:randomUUID()},{},true);
 r.event({role:'assistant',kind:'message',id:'one',text});await r.finish();
 assert.equal(sent.length,1);assert.equal(sent[0][2].questions,undefined);assert.deepEqual(sent[0][2].secureApproval,{opaque:true});assert(!JSON.stringify(sent).includes('结算'));
});
test('a stalled question relay never blocks task completion; cancelled partial questions are not flushed',async()=>{
 const b={request:()=>new Promise(()=>{})},r=relayTextQuestions(b,{id:randomUUID()}, {},false,{finishGrace:10});
 r.event({role:'assistant',kind:'message',id:'one',text});
 await Promise.race([r.finish(),wait(200).then(()=>assert.fail('Task completion blocked by notification'))]);b.stopped=true;
 const cancelled=relayTextQuestions({request:()=>assert.fail('Do not publish a cancelled partial question')},{id:randomUUID()},{},false);
 cancelled.event({role:'assistant',kind:'delta',id:'partial',text});await cancelled.finish('cancelled');
});
