#!/usr/bin/env node
import path from 'node:path';
import {runWithCredentials} from './credentials.mjs';
import {resolveContext} from './runtime.mjs';
import {readFileSync,writeFileSync,constants} from 'node:fs';
import {openFiles,closeFiles,upload,portableChat} from './transport.mjs';
import {resolveNas,nasTransfer} from './nas.mjs';
import {readNasHttp} from './nas-http-read.mjs';
import {sceneCommand} from './scene.mjs';
import {referenceCommand} from './references.mjs';
const args=process.argv.slice(2),options={},files=[],todoKeys=[];let action;
const actions=['service-install','service-revoke','service-list','service-invoke','service-status','schedule-get','schedule-create','schedule-update','schedule-delete','nas-http-check','nas-http-get','nas-put','nas-get','nas-list','interact','question','credentials-status','credentials-run','work-roster','work-context','work-note','work-inspect','work-dispatch','work-status','conversation-files','context','catalog','preview','publish','result','chat','voice','audio','chat-status','board','announcement-publish','todo-create','todo-update','todo-delete','operation-status','scene-members','scene-references','scene-context','scene-prepare','scene-preview','scene-apply','scene-save','scene-inventory','scene-status'];
const uuid=value=>{if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value||''))throw Error('请用 --request UUID 指定操作标识，重试保持相同 / Supply --request UUID; reuse it for retries');return value;};
async function main(){
try{
 while(args.length){const item=args.shift();if(item.startsWith('--')){if(item==='--mention-all'){options.mentionAll=true;continue;}if(item==='--autoplay'){options.autoplay=true;continue;}if(!args[0]||args[0].startsWith('--'))throw Error('参数缺少值：'+item);if(item==='--file')files.push(args.shift());else if(item==='--todo-key')todoKeys.push(args.shift());else if(item==='--mention')(options.mentionIds??=[]).push(args.shift());else if(item==='--member')(options.members??=[]).push(args.shift());else if(item==='--prop')(options.props??=[]).push(args.shift());else if(['url','skill','dependency','entry','context','scope','project','runtime','native-session','provider','include','device','device-name','session','candidate','version','request','text','text-file','input','revision','todo','output','kind','workspace','path','destination','layout','asset','canvas-id','canvas-name','auto-size','x','y','query','cursor','limit','office'].includes(item.slice(2)))options[item.slice(2)]=args.shift();else throw Error('无法识别参数：'+item);}else if(!action)action=item;else throw Error('无法识别参数：'+item);}
 if(!actions.includes(action))throw Error('用法：node sync.mjs [--scope REQUEST_ID | --context CONTEXT_FILE] [--project PROJECT] '+actions.join('|'));
 if(options.include&&options.include.split(',').some(v=>!['skills','devices','sessions'].includes(v)))throw Error('--include 支持 skills,devices,sessions');
 if(options.autoplay&&!['audio','chat'].includes(action))throw Error('--autoplay 仅用于 audio 或 chat / Use --autoplay with audio or chat');
 if(options.mentionAll&&action!=='chat')throw Error('--mention-all 仅用于 chat / Use --mention-all with chat');
 if(options.mentionIds&&action!=='chat')throw Error('--mention 仅用于 chat / Use --mention with chat');
 if(options.path&&!action.startsWith('nas-')&&!(action==='chat'&&['auto','nas'].includes(options.destination)))throw Error('--path 用于 NAS 共享目录内的相对路径');
 if(['chat','voice','audio'].includes(action)&&options.destination&&!(action==='chat'&&['auto','nas','cdn'].includes(options.destination)))throw Error('无效的附件目的地');
 if(action.startsWith('nas-')&&options.destination&&options.destination!=='nas')throw Error('NAS 操作只访问已配置的共享盘');
 const resolved=await resolveContext(options);
 if(resolved.selection){if(action!=='context')throw Error('请先运行 context 并选择目标项目或运行时');process.stdout.write(JSON.stringify(resolved.selection,null,2)+'\n');return;}
 const context=resolved.context;options.context=resolved.file;
 const url=new URL(context.url);
 if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.pathname!=='/skills'||url.username||url.password||url.search||url.hash||typeof context.token!=='string'||!context.token)throw Error('无效的万物会话上下文 / Invalid Wanwu session context');
 const request=async body=>{
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+context.token},body:JSON.stringify(body.action==='context'?{...body,detail:'summary',include:options.include?.split(',')||[]}:body),redirect:'error',signal:AbortSignal.timeout(['conversation-files','service-install','work-dispatch-local','chat','voice','audio','voice-send','publish','interact','question'].includes(body.action)?1800000:100000)});
  const result=await response.json();if(!response.ok)throw Object.assign(Error(result.error||'同步失败 / Sync failed'),{status:response.status});return result;
 };
 if(options.project){const current=await request({action:'context'});if(![current.project?.id,current.project?.name].includes(options.project))throw Error('不能把当前万物任务切换到另一个项目 / Project differs from the active scope');}
 let result;
 if (action === 'nas-http-check' || action === 'nas-http-get') {
  if (!options.url || files.length || options.path) throw Error('请用 --url 指定已知 NAS 文件的完整地址');
  if (action === 'nas-http-get' && !options.output) throw Error('请用 --output 指定新的本地绝对路径');
  result = await readNasHttp(request, options.context, options.url, action === 'nas-http-get' ? options.output : undefined);
 } else if(action.startsWith('nas-')){
  const operation=action.slice(4);
  if(files.length!==(operation==='put'?1:0))throw Error('nas-put 需要一个 --file；nas-get 和 nas-list 使用 --path');
  const remote=options.path??(operation==='put'?path.basename(files[0]):'');
  result=await nasTransfer(()=>resolveNas(request,'nas'),{operation,remote,file:files[0],output:options.output,contextFile:options.context});
 }else if(action.startsWith('service-')){
  if(!options.input)throw Error('Use --input JSON_FILE');
  const input=JSON.parse(readFileSync(options.input,'utf8'));
  if(action==='service-install'){
   if(!(await request({action:'context'})).capabilities?.deviceServiceInstall)throw Error('请在目标设备主人的万物会话内操作，并更新万物或 Omni CLI');
   if(!path.isAbsolute(input.script))throw Error('请选择本机适配器的绝对路径');
   input.source=readFileSync(input.script,'utf8');
  }
  result=await request({...input,action,...(['service-install','service-revoke','service-invoke'].includes(action)?{requestId:uuid(options.request)}:{})});
 }else if(action.startsWith('schedule-')){
  if(!(await request({action:'context'})).capabilities?.sessionScheduleLocal)throw Error('请在万物会话内使用，并更新执行设备和服务端');
  const input=options.input?JSON.parse(readFileSync(options.input,'utf8')):{};
  result=await request({action,prompt:input.prompt,rule:input.rule,scheduleId:input.scheduleId,revision:action==='schedule-create'?0:input.revision,
   requestId:['schedule-create','schedule-update'].includes(action)?uuid(options.request):undefined});
 }else if(action==='interact'){
  if(!(await request({action:'context'})).capabilities?.interactionInput)throw Error('请更新万物客户端和服务端，并在万物 AI 会话中使用自定义交互 / Update Wanwu and use an active AI conversation');
  if(!options.input)throw Error('Use --input INTERACTION_JSON');
  const input=JSON.parse(readFileSync(options.input,'utf8'));
  if(input.htmlFile){if(input.html)throw Error('Choose html or htmlFile');input.html=readFileSync(path.resolve(path.dirname(options.input),input.htmlFile),'utf8');delete input.htmlFile;}
  result=await request({action,id:uuid(options.request),interaction:input});
 }else if(action==='conversation-files'){
  if(!(await request({action:'context'})).capabilities?.conversationFileUpload)throw Error('请更新万物客户端和服务端，并在已导入的 AI 会话中交付附件');
  if(options.destination||options.autoplay||options.mentionIds||options.mentionAll)throw Error('会话附件不支持公屏参数');
  if(options.text&&options['text-file'])throw Error('选择 --text 或 --text-file');
  result=await request({action,id:uuid(options.request),text:options['text-file']?readFileSync(options['text-file'],'utf8'):options.text||'',files});
 }else if(action==='question'){
  if(!(await request({action:'context'})).capabilities?.questionInput)throw Error('请升级客户端，并在万物会话内提问 / Update the app and ask in a Wanwu conversation');
  if(!options.input)throw Error('Use --input QUESTIONS_JSON');
  const input=JSON.parse(readFileSync(options.input,'utf8'));
  result=await request({action,id:uuid(options.request),questions:input.questions});
 }else if(action==='credentials-status'){result=await request({action});if(options.skill)result.items=result.items.filter(s=>s.name===options.skill);}
 else if(action==='credentials-run'){if(!options.skill||!options.dependency||!options.input)throw Error('Use --skill NAME --dependency ID --input PLAN_JSON');result=await runWithCredentials(request,{skill:options.skill,dependency:options.dependency,entryId:options.entry,contextFile:options.context},JSON.parse(readFileSync(options.input,'utf8')));}
 else if(action==='work-roster')result=await request({action});
 else if(action.startsWith('work-')){
  if(!(await request({action:'context'})).capabilities?.workDispatch)throw Error('此范围不支持派工或备注；原生会话请先导入万物，旧服务端请更新 / Import this native session before dispatching work');
  if(action==='work-context')result=await request({action});
  else if(action==='work-status')result=await request({action,id:uuid(options.request)});
  else{if(!options.input)throw Error('Use --input JSON_FILE');const input=JSON.parse(readFileSync(options.input,'utf8'));
   if(action==='work-dispatch'){if(!(await request({action:'context'})).capabilities?.workDispatchUpload)throw Error('请升级当前电脑的万物 AI / Update this computer’s Wanwu AI');result=await request({action:'work-dispatch-local',plan:{...input,id:uuid(options.request)}});}
   else result=await request(action==='work-note'?{action,note:input}:{...input,action});
  }
 }else if(['scene-members','scene-references'].includes(action))result=await referenceCommand(request,action,options);
 else if(action.startsWith('scene-'))result=await sceneCommand(request,action,options,uuid);
 else if(action==='chat'||action==='voice'||action==='audio'||action==='chat-status'){
  const id=uuid(options.request);
  result=action==='chat-status'?await request({action,id}):await sendMessage();
  async function sendMessage(){
   if(options.text&&options['text-file'])throw Error('选择 --text 或 --text-file / Use either --text or --text-file');
   let text=options['text-file']?readFileSync(options['text-file'],'utf8'):options.text||'';
   if(text.length>4000||files.length>30)throw Error('消息最多 4000 字符，附件最多 30 个 / Up to 4000 characters and 30 files');
   if(!text.trim()&&!files.length)throw Error('请输入消息或选择附件 / Add a message or file');
   if(action==='voice'){
    if(files.length!==1)throw Error('请用 --file 指定一个音频文件 / Use --file with one audio file');
    if(!(await request({action:'context'})).capabilities?.voice)throw Error('请更新万物 AI 服务以发送公屏语音 / Update the server for team voice messages');
   }
   const capabilities=options.autoplay?(await request({action:'context'})).capabilities:null;
   if(options.autoplay&&!capabilities?.audioAutoplay)throw Error('请更新万物 AI 服务以自动播放音乐 / Update the server for music autoplay');
   if(options.mentionIds&&!(await request({action:'context'})).capabilities?.chatMemberMentions)throw Error('请更新发送端万物 AI 后使用 @成员 / Update the sending app for member mentions');
   if(options.mentionAll&&!(await request({action:'context'})).capabilities?.chatEveryoneMentions)throw Error('请更新发送端万物 AI 后使用 Bot @所有人 / Update the sending app for Bot @everyone');
   let attachments=files;
   if(action==='chat'&&['auto','nas'].includes(options.destination)){
    if(!files.length||options.autoplay||options.path&&files.length!==1)throw Error('请选择附件；自定义 --path 只用于单个文件，自动播放请使用普通附件');
    const receipt=await request({action:'chat-status',id});
    if(receipt.status==='sent')return receipt;
    const config=await resolveNas(request,options.destination);
    if(config){
     const paths=files.map(file=>options.path||path.basename(file));
     text=[text,...paths.map(name=>'NAS · '+name)].filter(Boolean).join('\n');
     if(text.length>4000)throw Error('消息和 NAS 文件名合计超过 4000 字符');
     for(const [index,file] of files.entries())await nasTransfer(config,{operation:'put',remote:paths[index],file,contextFile:options.context});
     attachments=[];
    }
   }
   const body={action,id,text,files:attachments,...(options.mentionAll?{mentionAll:true}:{}),...(options.mentionIds?{mentionIds:options.mentionIds}:{}),...(options.autoplay?{autoplay:true}:{})};
   // Older native upload handlers strip unknown fields; use the portable path
   // unless this client explicitly advertises support for the autoplay flag.
   const sent=options.autoplay&&!capabilities?.audioAutoplayUpload?{status:'client-upload-required'}:await request(body);
   if(sent.status==='client-upload-required'&&(options.mentionIds||options.mentionAll))throw Error('发送端不支持 @成员，请更新客户端 / Update the sending app for member mentions');
   return sent.status==='client-upload-required'?portableChat(request,body,options.context):sent;
  }
 }else if(action==='todo-delete'){
  const id=uuid(options.request),revision=Number(options.revision);
  if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(options.todo||''))throw Error('请提供读取到的 --todo TODO_ID / Supply the task ID from the board');
  if(!Number.isSafeInteger(revision)||revision<1)throw Error('请提供该待办当前的 --revision / Supply the selected task revision');
  if(!(await request({action:'context'})).capabilities?.todoDelete)throw Error('请更新万物 AI 服务以删除指定待办 / Update the server for TODO deletion');
  result=await request({action,id,todoId:options.todo,revision});
 }else if(['announcement-publish','todo-create','todo-update'].includes(action)){
  const id=uuid(options.request);
  if(!options.input)throw Error('使用 --input 指定 JSON 文件 / Supply --input JSON_FILE');
  const revision=options.revision===undefined?undefined:Number(options.revision);
  if(action!=='todo-create'&&(!Number.isSafeInteger(revision)||revision<0))throw Error('请提供读取到的 --revision / Supply the revision you read');
  if(action==='todo-update'&&!options.todo)throw Error('请提供 --todo TODO_ID / Supply --todo TODO_ID');
  if(!(await request({action:'context'})).capabilities?.board)throw Error('请更新万物 AI 服务以同步公告和待办 / Update the server for announcement and TODO sync');
  const handles=await openFiles([options.input],options.context,8*1024*1024);let uploadId;
  try{
   // Parse locally before sending any bytes. Schemas and revision checks are enforced by the server.
   JSON.parse(await handles[0].file.readFile('utf8'));
   uploadId=await upload(request,'board-upload',handles[0],id=>{uploadId=id;});
   result=await request({action,id,uploadId,revision,todoId:options.todo,selectedTodoKeys:todoKeys});
  }finally{await closeFiles(handles);if(uploadId)await request({action:'board-upload',method:'DELETE',uploadId}).catch(()=>{});}
 }else if(action==='operation-status')result=await request({action,id:uuid(options.request)});
 else result=await request({action,deviceId:options.device,sessionId:options.session,candidateId:options.candidate,version:options.version,requestId:options.request});
 if(options.output&&!['nas-get','nas-http-get'].includes(action)){
  if(!path.isAbsolute(options.output))throw Error('输出文件需要绝对路径 / Use an absolute output path');
  writeFileSync(options.output,JSON.stringify(result,null,2)+'\n',{mode:0o600,flag:constants.O_WRONLY|constants.O_CREAT|constants.O_TRUNC|constants.O_NOFOLLOW});
  process.stdout.write(JSON.stringify({status:'saved',output:options.output,projectId:result.projectId||result.project?.id},null,2)+'\n');
 }else process.stdout.write(JSON.stringify(result,null,2)+'\n');
}catch(e){process.stderr.write(e.message+'\n');process.exitCode=1;}

}
await main();
