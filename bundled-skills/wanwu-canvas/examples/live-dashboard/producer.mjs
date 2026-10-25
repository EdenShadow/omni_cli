// Finite, simulated data only. Run after the user chooses the target canvas.
import {connectCanvas} from '../../scripts/live-client.mjs';
const [canvasId,agent='alpha',count='20']=process.argv.slice(2);
if(!['alpha','beta','gamma'].includes(agent)||!Number.isInteger(+count)||+count<1||+count>200)throw Error('Usage: producer.mjs CANVAS_ID alpha|beta|gamma [1..200]');
const client=await connectCanvas(canvasId);
for(let sequence=1;sequence<=+count;sequence++){
 const time=Date.now(),value=100+Math.round(Math.sin(sequence/3)*150)/100;
 const batch=client.prepare([
  {type:'merge',key:'agent.'+agent,value:{sequence,value,updated:time,status:sequence===+count?'complete':'running'}},
  {type:'increment',key:'totals',value:{events:1,volume:10}},
  {type:'append',key:'recent',value:[{agent,sequence,value,time,simulation:true}],limit:60}
 ]);
 await client.commit(batch);await new Promise(r=>setTimeout(r,250));
}
console.log(JSON.stringify({status:'complete',simulation:true,agent,updates:+count}));
