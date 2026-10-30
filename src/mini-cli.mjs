import fs from 'node:fs';
import path from 'node:path';
import {homedir} from 'node:os';
import {loadState,lock} from './state.mjs';
import {login} from './login.mjs';
import {accountRequest} from './account-request.mjs';
import {chatCommand} from './chat-command.mjs';
import {catalogCommand} from './catalog-command.mjs';
const version=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url))).version;
const help=`Omni Mini ${version} / 公屏极简客户端
omni-mini setup | login     登录；不检测或安装 AI 终端，不绑定执行设备
omni-mini projects          列出已加入项目
omni-mini agents list PROJECT [--query 关键词]   查询可 @会话及备注
omni-mini agents watch PROJECT                监听目录变化
omni-mini chat list PROJECT                   读取公屏
omni-mini chat send PROJECT --session SESSION --text '任务' --wait
omni-mini chat watch PROJECT [--after SEQ]     读取后续反馈
omni-mini chat wait PROJECT MESSAGE           等待指定任务结果
omni-mini status | logout
chat --help 查看重试 UUID、超时、@Bot 和加密说明。
仅作为公屏控制端；AI 任务在被 @的在线执行设备上运行。
Node.js 24+，无需第三方 npm 依赖。OMNI_MINI_HOME 指定独立配置目录。
`;
export async function main(args){
 const [command='help',...rest]=args;
 if(['help','--help','-h'].includes(command)){console.log(help);return;}
 if(['version','--version'].includes(command)){console.log(version);return;}
 if(!['setup','login','logout','status','projects','agents','chat'].includes(command))throw Error('Mini only supports public chat and agent discovery; run omni-mini --help');
 if(command==='agents'&&!['list','watch','--help','-h'].includes(rest[0]))throw Error('Mini supports agents list/watch only');
 if(!['agents','chat'].includes(command)&&rest.length)throw Error('Unexpected argument');
 const state=loadState(process.env.OMNI_MINI_HOME||path.join(homedir(),'.omni-mini'));
 if(command==='chat')return chatCommand(state,rest);
 if(command==='agents')return catalogCommand(state,'agents',rest);
 if(command==='status'){console.log(JSON.stringify({mode:'mini',server:state.store.endpoint,username:state.store.username||null,signedIn:!!state.store.token,stateDirectory:state.directory}));return;}
 if(command==='projects'){const result=await accountRequest(state)('/api/me');console.log(JSON.stringify(result.projects.map(({id,name})=>({id,name}))));return;}
 const release=lock(state.directory);
 try{
  if(command==='logout'){
   const {installation,machineKey,endpoint}=state.store;
   for(const k of Object.keys(state.store))delete state.store[k];
   Object.assign(state.store,{installation,machineKey,endpoint});state.save();console.log('Signed out / 已退出');return;
  }
  await login(state);console.log('Mini ready / 已就绪：使用 projects 查询项目，再用 agents list 查询可 @会话。');
 }finally{release();}
}
