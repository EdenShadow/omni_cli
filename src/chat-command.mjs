import fs from 'node:fs';
import {parseArgs} from 'node:util';
import {randomUUID} from 'node:crypto';
import {accountRequest} from './account-request.mjs';
import {chatStore} from './chat-store.mjs';
import {createChat,uuid,integer} from './chat.mjs';

export const chatHelp=`Public chat / 团队公屏（当前登录账号）
  omni chat list <project-id> [--limit 100] [--before seq | --after seq]
  omni chat send <project-id> --text "@Bot 帮我整理项目" [--id UUID]
  omni chat send <project-id> --text-file request.txt [--bot | --session UUID] [--reply-to message-id]
      [--bot-mode continue|new] [--locale zh|en] [--wait] [--timeout 300]
  omni chat watch <project-id> [--after seq] [--timeout seconds]
  omni chat wait <project-id> <server-message-id> [--timeout 300]

list/send 输出 JSON；watch/wait 输出逐行 JSON。watch 默认只看新消息。
发送默认加密，不支持明文降级。--session 按 ID 派工，自动使用最新 @名称。
自然文本中的唯一 @会话也会解析派工；同名必须使用 --session，不能和 @Bot 混用。
首次聊天可能需已解锁的团队客户端在线共享密钥。
--wait 等待 Bot 任务结束；超时退出码 2，服务端任务继续运行。
chat 命令可与 omni start 同时运行；无需本机绑定 AI。
`;
const definitions={
  text:{type:'string'},'text-file':{type:'string'},id:{type:'string'},'reply-to':{type:'string'},bot:{type:'boolean'},session:{type:'string'},'bot-mode':{type:'string'},locale:{type:'string'},wait:{type:'boolean'},timeout:{type:'string'},limit:{type:'string'},after:{type:'string'},before:{type:'string'},help:{type:'boolean',short:'h'},
};
const allowed={send:['text','text-file','id','reply-to','bot','session','bot-mode','locale','wait','timeout'],list:['limit','after','before','timeout'],watch:['after','timeout'],wait:['timeout']};
export async function chatCommand(state,args){
  if(!args.length||args.includes('--help')||args.includes('-h')){console.log(chatHelp);return;}
  const {values:v,positionals}=parseArgs({args,options:definitions,allowPositionals:true,strict:true});
  const [action,project,id]=positionals;
  if(!allowed[action]||positionals.length!==(action==='wait'?3:2))throw Error('Invalid chat command. Run omni chat --help');
  for(const option of Object.keys(v))if(!allowed[action].includes(option))throw Error(`--${option} is not supported by chat ${action}`);
  uuid(project,'Project ID');
  if(!state.store.token||!state.store.userId)throw Error('请先运行 omni login / Sign in first');
  const seconds=v.timeout===undefined?(action==='watch'?0:action==='wait'||v.wait?300:90):integer(v.timeout,'timeout',0,86400);
  if(seconds===0&&action!=='watch')throw Error('Only watch supports --timeout 0');
  const controller=new AbortController();let timedOut=false;
  const timer=seconds?setTimeout(()=>{timedOut=true;controller.abort();},seconds*1000):null;
  const stop=()=>controller.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
  const emit=value=>console.log(JSON.stringify(value));
  try{
    const request=accountRequest(state,controller.signal);
    const chat=createChat({request,storage:chatStore(state,request,controller.signal),userId:state.store.userId,signal:controller.signal,emit});
    if(action==='list'){emit(await chat.list(project,v));return;}
    if(action==='send'){
      if((v.text!==undefined)===(v['text-file']!==undefined))throw Error('Provide exactly one of --text or --text-file');
      if(v['text-file']&&fs.statSync(v['text-file']).size>16000)throw Error('Text file exceeds 16000 bytes');
      const text=v.text??fs.readFileSync(v['text-file'],'utf8'),requestId=v.id||randomUUID();
      uuid(requestId,'Request ID');
      console.error(`Request ID: ${requestId} (retry with identical content and --id if delivery is uncertain)`);
      const result=await chat.send(project,{text,id:requestId,replyTo:v['reply-to'],bot:v.bot,sessionId:v.session,requireBot:v.wait,botMode:v['bot-mode'],locale:v.locale});
      emit(result);
      if(v.wait){
        const status=await chat.wait(project,result.id);if(status!=='done')process.exitCode=1;
      }
      return;
    }
    if(action==='watch')return await chat.watch(project,v);
    const status=await chat.wait(project,id);if(status!=='done')process.exitCode=1;
  }catch(e){
    if(controller.signal.aborted){emit({type:timedOut?'timeout':'stopped',message:'Only local waiting stopped; a sent server task is not cancelled.'});process.exitCode=timedOut?2:130;return;}
    throw e;
  }finally{clearTimeout(timer);process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
