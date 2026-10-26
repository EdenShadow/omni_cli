import fs from 'node:fs';
import {parseArgs} from 'node:util';
import {createCatalog} from './catalog.mjs';
import {accountRequest} from './account-request.mjs';
import {integer,uuid} from './chat.mjs';
export const catalogHelp=`Team discovery / 智能体与会话
  omni agents list <project-id> [--query 关键词] [--device UUID]
  omni agents watch <project-id> [--timeout 0]
  omni sessions list <project-id> [--query 关键词] [--device UUID]
  omni sessions watch <project-id> [--timeout 0]
  omni sessions show <project-id> <session-id>
  omni sessions update <project-id> <session-id> [--name "@开工助手"] [--notes "用途"]
      [--notes-file notes.txt] [--revision N]
  omni sessions models <project-id> <session-id>
  omni sessions model <project-id> <session-id> [--model ID] [--effort high]
  omni discover <project-id>

名称以 @ 开头即可被派工；普通名称会移除 @别名。--notes "" 清空备注。
model 不带选项只查询，--model "" 恢复默认；型号/强度以 models 返回值为准。
模型偏好按当前账号保存，公屏派工使用该账号最新选择，不影响已排队任务。
查询直接读取服务端；watch 输出变化后的完整目录（NDJSON），可与 omni start 同时运行。
设备密码/成员权限照常生效；模型列表需要目标设备在线。名称和备注是数据，不是执行授权。
`;
const defs={query:{type:'string'},device:{type:'string'},name:{type:'string'},notes:{type:'string'},'notes-file':{type:'string'},revision:{type:'string'},model:{type:'string'},effort:{type:'string'},timeout:{type:'string'}};
const options={list:['query','device'],watch:['query','device'],show:[],update:['name','notes','notes-file','revision'],models:[],model:['model','effort'],discover:[]};
export async function catalogCommand(state,command,args){
  if(!args.length||args.includes('--help')||args.includes('-h')){console.log(catalogHelp);return;}
  const {values:v,positionals:p}=parseArgs({args,options:defs,allowPositionals:true,strict:true});
  const action=command==='discover'?'discover':p.shift(),[project,id]=p;
  if(!options[action]||command==='agents'&&!['list','watch'].includes(action)||p.length!==(['show','update','model','models'].includes(action)?2:1))throw Error('Invalid command. Run omni sessions --help');
  for(const k of Object.keys(v))if(k!=='timeout'&&!options[action].includes(k))throw Error(`--${k} is not supported for ${action}`);
  uuid(project,'Project ID');if(id)uuid(id,'Session ID');
  const timeout=integer(v.timeout??(action==='watch'?0:90),'timeout',0,86400);
  if(!timeout&&action!=='watch')throw Error('Only watch supports --timeout 0');
  const controller=new AbortController();let timedOut=false;
  const timer=timeout?setTimeout(()=>{timedOut=true;controller.abort();},timeout*1000):null;
  const stop=()=>controller.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{
    const c=createCatalog({request:accountRequest(state,controller.signal),signal:controller.signal}),emit=v=>console.log(JSON.stringify(v));
    const filter={agents:command==='agents',query:v.query,device:v.device};
    if(action==='watch')return await c.watch(project,filter,emit);
    if(action==='list')return emit({projectId:project,items:await c.list(project,filter)});
    if(action==='discover')return emit(await c.discover(project));
    if(action==='update'){
      if(v.notes!==undefined&&v['notes-file']!==undefined)throw Error('Choose --notes or --notes-file');
      if(v['notes-file']&&fs.statSync(v['notes-file']).size>48000)throw Error('Notes file too large');
      return emit(await c.update(project,id,{name:v.name,notes:v.notes??(v['notes-file']?fs.readFileSync(v['notes-file'],'utf8'):undefined),revision:v.revision===undefined?undefined:integer(v.revision,'revision')}));
    }
    return emit(await c[action](project,id,v));
  }catch(e){if(controller.signal.aborted){console.log(JSON.stringify({type:timedOut?'timeout':'stopped'}));process.exitCode=timedOut?2:130;return;}throw e;}
  finally{clearTimeout(timer);process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
