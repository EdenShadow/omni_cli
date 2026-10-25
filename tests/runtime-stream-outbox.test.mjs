import test from 'node:test';
import assert from 'node:assert/strict';
import {RuntimeBridge} from '../lib/desktop/bridge.mjs';
import {compactRuntimeOutbox} from '../lib/desktop/runtime-stream-outbox.mjs';

const delta=(text,extra={})=>({kind:'delta',id:'reply',role:'assistant',turnId:'turn',commandId:'command',text,...extra});
const entry=(payload,extra={})=>({sessionId:'session',id:'transport-old',payload,...extra});
function bridge(request){
 const b=Object.create(RuntimeBridge.prototype);
 Object.assign(b,{store:{deviceToken:'fixture'},outbox:[],localOutputs:{record(){}},privacyFor:()=>({event:x=>x}),persist(){},chatEncryption:{event:async(s,id,p)=>({kind:'encrypted-chat-event',secureEvent:JSON.stringify(p)})},request});
 return b;
}
test('slow encrypted uploads coalesce token bursts and reasoning snapshots before encryption',async()=>{
 let release;const gate=new Promise(r=>release=r),uploads=[];
 const b=bridge(async(route,method,body)=>{uploads.push(body);if(uploads.length===1)await gate;});
 b.enqueue('session',delta('first'));
 for(let i=0;i<1000;i++)b.enqueue('session',delta('x'));
 assert.equal(b.outbox.length,2);
 for(let i=0;i<1000;i++)b.enqueue('session',{...delta('summary '+i,{id:'reasoning',role:'system'}),kind:'tool',status:'inProgress',activity:'reasoning'});
 assert.equal(b.outbox.length,3);
 b.enqueue('session',{...delta('first'+'x'.repeat(1000)),kind:'message',status:'completed',phase:'final_answer'});
 assert.equal(b.outbox.length,3);
 release();await b.flush();
 assert.equal(uploads.length,2);
 const items=uploads.flatMap(b=>b.events.map(e=>JSON.parse(e.payload.secureEvent)));
 assert.equal(items.at(-1).text,'first'+'x'.repeat(1000));
 assert.equal(items[1].text,'summary 999');
 assert.equal(b.outbox.length,0);
});
test('adjacent delta aggregation preserves every character without a final snapshot',()=>{
 const first=entry(delta('你好'));
 const result=compactRuntimeOutbox([first],'session',delta(' 🌍'));
 assert.equal(result.payload.text,'你好 🌍');assert.equal(result.outbox.length,0);
 assert.equal(first.payload.text,'你好');
});
test('compaction preserves boundaries, complete items, usage and sent IDs',()=>{
 const base=entry(delta('old'));
 for(const changed of [
  {sessionId:'other'}, {attempted:true}, {usage:true},
  {payload:delta('old',{commandId:'other'})}, {payload:delta('old',{turnId:'other'})},
  {payload:delta('old',{role:'system'})}, {payload:{...delta('old'),kind:'message',status:'completed'}},
 ]){
  const old={...base,...changed};assert.deepEqual(compactRuntimeOutbox([old],'session',delta('new')).outbox,[old]);
 }
 assert.deepEqual(compactRuntimeOutbox([base],'session',delta('new'),new Set([base.id])).outbox,[base]);
 const boundary=entry({kind:'tool',id:'tool',status:'completed'});
 assert.deepEqual(compactRuntimeOutbox([base,boundary],'session',delta('new')).outbox,[base,boundary]);
 const large=entry(delta('x'.repeat(65536)));
 assert.equal(compactRuntimeOutbox([large],'session',delta('x')).outbox.length,1);
});
test('ambiguous upload failure retains exact retry bytes across persisted queue restoration',async()=>{
 let fail=true;const uploads=[];
 const b=bridge(async(route,method,body)=>{uploads.push(body);if(fail)throw Error('Response lost after server acceptance');});
 b.enqueue('session',delta('accepted'));
 await assert.rejects(b.flush());
 const saved=JSON.parse(JSON.stringify(b.outbox));assert.equal(saved[0].attempted,true);
 b.outbox=saved;
 b.enqueue('session',delta(' next'));
 await assert.rejects(b.flush());
 assert.equal(b.outbox[0].id,saved[0].id);
 assert.equal(b.outbox[0].payload.text,'accepted');
 fail=false;await b.flush();
 const retried=uploads.at(-1).events[0];
 assert.equal(retried.id,uploads[0].events[0].id);
 assert.deepEqual(retried.payload,uploads[0].events[0].payload);
 assert.equal(b.outbox.length,0);
});
