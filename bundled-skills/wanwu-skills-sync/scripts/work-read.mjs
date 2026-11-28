import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function readWork(request,options){
  const {capabilities}=await request({action:'context'});
  if(!capabilities?.workSessionRead||!capabilities.workSessionReadLocal)throw Error('请更新服务端、发起电脑及同步助手，并在已导入的会话中读取');
  if(!options.input&&!options.request&&!options.session&&!options.latest) return request({action:'work-read-devices'});
  if([options.input,options.request,options.session,options.latest].filter(Boolean).length!==1)throw Error('Choose a target list, session, or dispatch request');
  const operation=randomUUID();let targets,unfinished=[];
  if(options.request){
    const wait=Number(options.wait??0);
    if(!Number.isInteger(wait)||wait<0||wait>300)throw Error('--wait must be 0–300 seconds');
    const until=Date.now()+wait*1000;
    let batch;
    do{
      batch=await request({action:'work-status',id:options.request});
      if(batch.status!=='accepted'||Date.now()>=until)break;
      await pause(Math.min(1800,until-Date.now()));
    }while(true);
    if(batch.status==='missing')throw Error('找不到这个派工批次');
    unfinished=batch.tasks.filter(t=>t.state!=='done').map(({key,state})=>({key,status:state}));
    targets=batch.tasks.filter(t=>t.state==='done').map(({key,deviceId,sessionId,computerId,commandId})=>({key,deviceId,sessionId,computerId,commandId}));
  }else targets=options.input?JSON.parse(readFileSync(options.input==='-'?0:options.input,'utf8')).targets:
    [{deviceId:options.device,...(options.latest?{latest:true}:(/^[a-f\d-]{36}$/i.test(options.session)?{sessionId:options.session}:{session:options.session}))}];
  if(!Array.isArray(targets)||targets.length>32||!options.request&&!targets.length)throw Error('请提供 1 至 32 个会话目标 / Supply 1–32 target sessions');
  const results=[];
  async function read(i){
    let target={},key;
    try{
      if(!targets[i]||typeof targets[i]!=='object'||Array.isArray(targets[i]))throw Error('Invalid session target');
      ({key,...target}=targets[i]);
      if(options.request&&(!target.commandId||!target.sessionId))throw Error('Missing task result identity');
      if(options.limit!==undefined)target.turns=Number(options.limit);
      const r=await request({action:'work-read',target,operation});
      results[i]={...r,deviceId:target.deviceId,...(key?{key}:{})};
    }catch(e){results[i]={deviceId:target.deviceId,sessionId:target.sessionId,session:target.session,key,status:'error',error:e.message};}
  }
  let pending=targets.map((_,i)=>i);
  while(pending.length){
    for(let i=0;i<pending.length;i+=3)await Promise.all(pending.slice(i,i+3).map(read));
    pending=pending.filter(i=>results[i].status==='awaiting_unlock');
    if(!pending.length)break;
    await pause(1800);
  }
  return {results:[...results,...unfinished]};
}
