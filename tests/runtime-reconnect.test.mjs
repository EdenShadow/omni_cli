import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CodexAdapter} from '../lib/desktop/runtimes.mjs';
import {RuntimeBridge} from '../lib/desktop/bridge.mjs';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function fixture(timeout=25){
 const adapter=new CodexAdapter('unused',null,{reconnectTimeoutMs:timeout}),calls=[],events=[];adapter.start=async()=>{};adapter.fresh.add('thread');
 adapter.rpc=async(method,params)=>{calls.push({method,params});return {turn:{id:'turn-1'}};};
 const result=adapter.run('thread','test',e=>events.push(e));result.catch(()=>{});await delay(0);
 const emit=(method,params={})=>adapter.receive({method,params:{threadId:'thread',turnId:'turn-1',...params}});
 return {adapter,calls,events,result,emit};
}
test('continuous reconnects expire without resetting the budget or starting another turn',async()=>{
 const f=await fixture();f.emit('error',{willRetry:true,message:'Reconnecting 1/5'});await delay(15);f.emit('error',{willRetry:true,message:'Reconnecting 2/5'});
 await assert.rejects(f.result,/连接持续中断/);assert.equal(f.calls.filter(c=>c.method==='turn/start').length,1);assert.equal(f.calls.filter(c=>c.method==='turn/interrupt').length,1);assert.equal(f.adapter.turns.size,0);
});
test('real progress clears recovery timeout and long-running tools are allowed',async()=>{
 const f=await fixture();f.emit('error',{willRetry:true});f.emit('item/started',{item:{id:'generate',type:'imageGeneration',status:'inProgress'}});await delay(45);
 assert.equal(f.adapter.turns.size,1);assert.equal(f.calls.filter(c=>c.method==='turn/interrupt').length,0);
 f.emit('turn/completed',{turn:{id:'turn-1',status:'completed'}});assert.deepEqual(await f.result,{cancelled:false});
});
test('terminal upstream errors settle without waiting for a second completion notification',async()=>{
 const f=await fixture();f.emit('error',{willRetry:false,error:{message:'502 Bad Gateway'}});await assert.rejects(f.result,/502/);assert.equal(f.adapter.turns.size,0);
});
test('accepted stop clears a turn even when the completion notification is missing',async()=>{
 const f=await fixture();await f.adapter.cancel('thread');assert.deepEqual(await f.result,{cancelled:true});assert.equal(f.adapter.turns.size,0);
});
test('late errors and completions for an old turn do not stop a newer turn',async()=>{
 const f=await fixture();f.emit('error',{turnId:'old-turn',willRetry:false,error:{message:'old error'}});f.emit('turn/completed',{turn:{id:'old-turn',status:'failed'},turnId:'old-turn'});
 assert.equal(f.adapter.turns.size,1);f.emit('turn/completed',{turn:{id:'turn-1',status:'completed'}});assert.deepEqual(await f.result,{cancelled:false});
});

const capacity='Selected model is at capacity. Please try a different model.';
for(const willRetry of [true,false,undefined])test(`model capacity ends the turn even with willRetry=${willRetry}`,async()=>{
 const f=await fixture();const turn=f.adapter.turns.get('thread');
 f.emit('error',{willRetry,error:{message:capacity}});
 await assert.rejects(f.result,{message:capacity});
 assert.equal(f.adapter.turns.size,0);assert.equal(turn.reconnectTimer,null);
 assert.equal(turn.controller.signal.aborted,true);
 assert.equal(f.events.at(-1).willRetry,false);assert.equal(f.events.at(-1).status,'failed');
 assert.equal(f.calls.filter(c=>c.method==='turn/interrupt').length,willRetry===false?0:1);
});
test('errors without an explicit retry promise end instead of waiting forever',async()=>{
 const f=await fixture();f.emit('error',{error:{message:'Invalid model'}});
 await assert.rejects(f.result,/Invalid model/);assert.equal(f.adapter.turns.size,0);
});
test('capacity interrupts only its turn, ignores late progress, and stays failed through completion races',async()=>{
 const f=await fixture();let acknowledge;
 f.adapter.turns.set('other',{emit(){}});
 f.adapter.rpc=async(method,params)=>{f.calls.push({method,params});if(method==='turn/interrupt')await new Promise(r=>{acknowledge=r;});return {turn:{id:'turn-2'}};};
 f.emit('error',{willRetry:true,error:{message:capacity}});
 const count=f.events.length;
 f.emit('error',{willRetry:true,message:'Reconnecting 2/5'});
 f.emit('item/started',{item:{id:'late',type:'commandExecution'}});
 assert.equal(f.events.length,count);
 f.emit('turn/completed',{turn:{id:'turn-1',status:'interrupted'}});
 await assert.rejects(f.result,{message:capacity});assert.equal(f.adapter.turns.has('other'),true);
 const next=f.adapter.run('thread','try another model',e=>f.events.push(e));await delay(0);
 acknowledge();await delay(0);
 f.emit('error',{willRetry:false,error:{message:'old error'}});
 f.emit('turn/completed',{turn:{id:'turn-1',status:'failed'}});
 assert.equal(f.adapter.turns.get('thread').turnId,'turn-2');
 f.emit('turn/completed',{turnId:'turn-2',turn:{id:'turn-2',status:'completed'}});
 assert.deepEqual(await next,{cancelled:false});
});
test('an unresponsive interrupt is bounded and preserves the model error',async()=>{
 const f=await fixture();let killed=false;f.adapter.interruptTimeoutMs=15;
 f.adapter.child={kill(){killed=true;}};f.adapter.rpc=()=>new Promise(()=>{});
 f.emit('error',{willRetry:true,error:{message:capacity}});
 await assert.rejects(f.result,{message:capacity});assert.equal(killed,true);assert.equal(f.adapter.turns.size,0);
});
test('terminal model errors finish the shared command without waiting for stalled metadata',async()=>{
 const adapter=new CodexAdapter('unused',null),events=[],requests=[];
 adapter.start=async()=>{};adapter.fresh.add('thread');adapter.rpc=async()=>({turn:{id:'turn'}});
 adapter.metadata=()=>new Promise(()=>{});
 const command={id:'command',session_id:'session',project_id:'project',prompt:'hello',options:{}},session={provider:'codex',localId:'thread',fresh:false};
 const bridge=Object.create(RuntimeBridge.prototype);
 Object.assign(bridge,{store:{},outbox:[],busy:new Map([[command.id,session]]),adapter:()=>adapter,
  skillExchange:{context:async()=>null,release(){}},enqueue:(_id,p)=>events.push(p),persist(){},reportGroupChat(){},flush:async()=>{},
  request:async(route,_method,body)=>requests.push({route,body}),syncSessionTitle:async()=>{},pump:async()=>{}});
 const execution=bridge.execute(command,session);await delay(0);
 await adapter.receive({method:'error',params:{threadId:'thread',turnId:'turn',willRetry:true,error:{message:capacity}}});
 await execution;
 const finish=requests.find(r=>r.route.endsWith('/finish')).body;
 assert.equal(finish.status,'failed');assert.equal(finish.error,capacity);assert.equal(bridge.busy.size,0);

});
