import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {accountRequest} from './account-request.mjs';
import {loadState} from './state.mjs';
import {uuid} from './chat.mjs';

const help = `omni work roster <project-id>
omni work dispatch --project <project-id> --input plan.json --request UUID
omni work status --project <project-id> --request UUID
名册按项目工位分组，包括复制设备、可 @ 名字、普通会话、Runtime 和备注。
派工与查询进度沿用运行中的万物会话授权；也可以传 --scope 或 --context。`;
export async function workCommand([action,...args]) {
  if (!action || action==='--help' || action==='-h' || args.includes('--help')) {console.log(help);return;}
  if (action==='roster') {
    if(args.length!==1)throw Error(help);
    const project=uuid(args[0],'Project ID');
    const result=await accountRequest(loadState())(`/api/projects/${project}/work-roster`);
    console.log(JSON.stringify(result,null,2));return;
  }
  if(!['dispatch','status'].includes(action))throw Error(help);
  const script=fileURLToPath(new URL('../bundled-skills/wanwu-skills-sync/scripts/sync.mjs',import.meta.url));
  const child=spawn(process.execPath,[script,'work-'+action,...args],{stdio:'inherit'});
  process.exitCode=await new Promise((resolve,reject)=>{
    child.once('error',reject);
    child.once('exit',code=>resolve(code??1));
  });
}
