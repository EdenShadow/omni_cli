import fs from 'node:fs';
import path from 'node:path';
import {hostname} from 'node:os';
import {loadState,lock} from './state.mjs';
import {createRequest,DEFAULT_ENDPOINT,endpoint} from './api.mjs';
import {ask,password} from './prompts.mjs';
import {client,detectRuntimes,bootstrap,importAll} from './client.mjs';

const help=`Omni CLI / 万物命令行设备 0.1.0

omni setup              登录、检测终端、绑定设备、选择项目并启动
omni login              输入账号密码登录（密码不保存）
omni bind               选择 AI 终端，安装默认技能并绑定设备
omni start              前台运行设备；Ctrl+C 停止
omni status             显示当前账号和设备（不显示凭据）
omni runtimes           检测 Codex / Claude Code / DeepSeek Harness
omni projects          查看已加入的项目及项目 ID
omni join <project-id>  将本设备放入已加入的项目
omni import <project-id> [provider]  导入该终端的全部已有会话
omni skills sync        检查并同步团队技能
omni access            设置文件访问范围及 AI 执行审批
omni logout            清除本 CLI 登录与设备凭据（保留工作文件和技能）

环境变量：OMNI_HOME（独立配置目录）、OMNI_SERVER_URL（HTTPS 服务端）、
WANWU_CODEX_PATH / WANWU_CLAUDE_PATH / WANWU_DSH_PATH（可执行文件）。
首次运行需要 Node.js 24+，并先安装、登录至少一种 AI 终端。
设备在线期间才能接收会话、公屏 @任务及团队技能更新。
`;
const print=value=>console.log(JSON.stringify(value,null,2));
const checkId=id=>{if(!/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(id||''))throw Error('Provide a project UUID from omni projects');return id;};
function logged(store){if(!store.token)throw Error('请先运行 omni login / Sign in first');}
function bound(store){logged(store);if(!store.deviceToken)throw Error('请先运行 omni bind / Bind a device first');}
function notifier(){let last='';return e=>{
  let line;
  if(e.type==='bridge-status')line=e.online?'设备已连接 / Device connected':'连接暂时中断，将自动重连 / Reconnecting';
  if(e.type==='device-skills')line='技能 / Skills: '+e.status+(e.error?' · '+e.error:'');
  if(e.type==='runtime-approval')line='有任务等待授权，请在万物中处理 / A task needs approval in Wanwu';
  if(line&&line!==last){console.log(line);last=line;}
};}
async function login(state){
  const {store,save}=state;
  const proposed=endpoint(process.env.OMNI_SERVER_URL||store.endpoint||DEFAULT_ENDPOINT);
  if(store.token&&store.endpoint!==proposed)throw Error('先 logout 再更换服务器 / Log out before changing server');
  store.endpoint=proposed;
  console.log('服务器 / Server: '+store.endpoint);
  const username=await ask('万物账号 / Username');
  let secret=await password();
  let result;try{result=await createRequest(store)('/api/auth/login','POST',{username,password:secret,installation:store.installation,machineKey:store.machineKey});}finally{secret='';}
  if(store.userId&&store.userId!==result.user.id)throw Error('请先 logout 再切换账号 / Log out before switching accounts');
  store.token=result.token;store.userId=result.user.id;store.username=result.user.username||username;
  if(result.deviceBinding){store.installation=result.deviceBinding.installation||store.installation;store.device=result.deviceBinding.device;store.deviceToken=result.deviceBinding.deviceToken;}
  save();console.log('已登录 / Signed in: '+store.username);
}
async function access(state){
  const {store,save}=state;logged(store);
  console.log('文件访问沿用当前系统用户的权限。共享范围不会绕过 Windows/macOS/Linux 的系统限制。');
  const scope=await ask('团队文件访问：1=仅项目已导入的文件夹，2=当前系统用户可访问的全部目录','1');
  if(!['1','2'].includes(scope))throw Error('Choose 1 or 2');
  store.fileAccessByUser={...store.fileAccessByUser,[store.userId]:scope==='2'?'all':'imported'};
  const permission=await ask('AI 命令执行：1=需要时请求授权，2=允许完整执行（当前系统用户权限）','1');
  if(!['1','2'].includes(permission))throw Error('Choose 1 or 2');
  const account=JSON.stringify([store.endpoint,store.userId]);
  store.creationPermissions={...store.creationPermissions,[account]:Object.fromEntries(['codex','claude','dsh'].map(p=>[p,permission==='2']))};
  save();
}
async function bind(state){
  logged(state.store);
  const found=detectRuntimes().filter(r=>r.available);
  if(!found.length)throw Error('未找到已安装的 Codex / Claude Code / DeepSeek Harness，请先安装并登录');
  console.log('已检测到 / Detected: '+found.map(r=>r.provider).join(', '));
  const selected=(await ask('选择绑定的终端，逗号分隔',found.map(r=>r.provider).join(','))).split(',').map(s=>s.trim());
  if(!selected.length||selected.some(p=>!found.some(r=>r.provider===p)))throw Error('选择了不可用的终端 / Unavailable runtime');
  state.store.deviceName=await ask('设备名称 / Device name',state.store.deviceName||hostname()+' CLI');
  const folder=path.resolve(await ask('公屏任务工作目录 / Team task folder',state.store.workspace||path.join(state.directory,'projects')));
  fs.mkdirSync(folder,{recursive:true,mode:0o700});fs.accessSync(folder,fs.constants.R_OK|fs.constants.W_OK);state.store.workspace=fs.realpathSync(folder);
  await access(state);
  console.log('将向选中终端安装默认技能，已有本地技能会保留 / Installing default skills');
  const bridge=client(state,notifier());
  try{const device=await bridge.bind([...new Set(selected)]);console.log('已绑定 / Device: '+device.name+' · '+device.id);}finally{bridge.stop();}
}
async function chooseProject(state){
  const result=await createRequest(state.store)('/api/me');
  for(const [i,p] of result.projects.entries())console.log(`${i+1}. ${p.name} (${p.id})`);
  if(!result.projects.length){console.log('可稍后在万物中把设备放入项目 / Add this device to a project in Wanwu later');return;}
  const choice=await ask('选择项目编号，0=稍后添加','0');if(choice==='0')return;
  const project=result.projects[Number(choice)-1];if(!project)throw Error('Invalid project');
  await createRequest(state.store)(`/api/projects/${project.id}/devices`,'POST',{deviceId:state.store.device.id});
  const mode=await ask('会话绑定：1=默认工作区（不导入旧会话），2=导入全部已有会话','1');
  if(!['1','2'].includes(mode))throw Error('Choose 1 or 2');
  if(mode==='2'){
    const bridge=client(state,notifier());
    try{print(await importAll(bridge,project.id,state.store.device.runtimes));}finally{bridge.stop();}
  }
}
async function run(state,once=false){
  bound(state.store);bootstrap(state.store.device.runtimes);
  const bridge=client(state,notifier());
  if(once){
    // A maintenance command must not claim queued AI work while syncing skills.
    bridge.pump=async()=>{};bridge.workbench.pump=async()=>{};bridge.scheduler.tick=async()=>{};
  }
  const keepAlive=setInterval(()=>{},60000);
  const stopped=new Promise(resolve=>{
    const stop=()=>resolve();process.once('SIGINT',stop);process.once('SIGTERM',stop);
    bridge.removeSignalHandlers=()=>{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);};
  });
  try{
    await bridge.start().catch(e=>{if(once)throw e;console.log('暂时无法连接，保留任务并自动重试 / Connection unavailable; retrying');});
    if(once){
      const deadline=Date.now()+1800000;
      while(!bridge.skillUpdates.available){
        await bridge.skillUpdates.tick();
        if(bridge.skillUpdates.state.status==='error')throw Error(bridge.skillUpdates.state.error);
        if(Date.now()>deadline)throw Error('Skill sync timed out; run omni start to retry');
        const stop=await Promise.race([stopped.then(()=>true),new Promise(r=>setTimeout(()=>r(false),250))]);if(stop)return;
      }
      console.log('团队技能已同步 / Team skills synchronized');return;
    }
    console.log('Omni CLI 正在运行，支持项目协作与公屏 @会话。Ctrl+C 停止。');
    await stopped;
  }finally{bridge.stopped=true;bridge.stop();bridge.removeSignalHandlers();clearInterval(keepAlive);}
}
export async function main(args){
  const command=args[0]||'help';
  if(['help','--help','-h'].includes(command)){console.log(help);return;}
  if(['--version','version'].includes(command)){console.log('0.1.0');return;}
  if(command==='runtimes'){print(detectRuntimes());return;}
  const allowed=['setup','login','bind','start','status','projects','join','import','skills','access','logout'];
  if(!allowed.includes(command))throw Error('Unknown command. Run omni --help');
  const state=loadState(),{store,save}=state;
  if(command==='status'){print({server:store.endpoint||DEFAULT_ENDPOINT,username:store.username||null,device:store.device?{id:store.device.id,name:store.device.name,runtimes:store.device.runtimes}:null,configured:!!store.deviceToken,folder:store.workspace,stateDirectory:state.directory});return;}
  const unlock=lock(state.directory);
  try{
    if(command==='login')return await login(state);
    if(command==='setup'){if(!store.token)await login(state);await bind(state);await chooseProject(state);return await run(state);}
    if(command==='bind')return await bind(state);
    if(command==='access')return await access(state);
    if(command==='logout'){
      if((store.outbox||[]).length||Object.keys(store.pendingFinish||{}).length)throw Error('仍有未同步的任务结果，请先运行 omni start 完成同步');
      const keep={installation:store.installation,machineKey:store.machineKey,endpoint:store.endpoint};
      for(const key of Object.keys(store))delete store[key];Object.assign(store,keep);save();console.log('已清除本 CLI 登录 / Signed out');return;
    }
    logged(store);
    if(command==='projects'){const r=await createRequest(store)('/api/me');print(r.projects.map(({id,name})=>({id,name})));return;}
    bound(store);
    if(command==='start')return await run(state);
    if(command==='skills'&&args[1]==='sync')return await run(state,true);
    if(command==='join'){await createRequest(store)(`/api/projects/${checkId(args[1])}/devices`,'POST',{deviceId:store.device.id});console.log('已加入项目 / Device added to project');return;}
    if(command==='import'){
      const project=checkId(args[1]),providers=args[2]?[args[2]]:store.device.runtimes;
      if(providers.some(p=>!store.device.runtimes.includes(p)))throw Error('Runtime is not bound');
      const bridge=client(state,notifier());try{print(await importAll(bridge,project,providers));}finally{bridge.stop();}return;
    }
    throw Error('Unknown command. Run omni --help');
  }finally{unlock();}
}
