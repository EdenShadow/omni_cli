import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {groupChatState} from '../lib/desktop/group-chat.mjs';
import {botProviderOrder} from '../lib/desktop/bot-provider-order.mjs';

export const DEFAULT_RUNTIME_ORDER=Object.freeze(['codex','claude','dsh']);
export const runtimeOrderHelp=`omni runtimes order                         查看 @Bot 运行时顺序
omni runtimes order set claude codex dsh      修改顺序（也支持逗号分隔）
omni runtimes order reset                    恢复 Codex > Claude Code > DeepSeek Harness

使用 codex、claude、dsh，每种恰好一次。仅在本设备已绑定的运行时中选择。
运行期间可修改；下次设备状态上报生效，不中断当前任务。
`;
export function validateRuntimeOrder(order){
  if(!Array.isArray(order)||order.length!==3||new Set(order).size!==3||order.some(p=>!DEFAULT_RUNTIME_ORDER.includes(p)))
    throw Error('顺序必须包含 codex、claude、dsh 各一次 / Include codex, claude and dsh exactly once');
  return [...order];
}
function preferenceFile(state){
  const {store,directory}=state;
  // Separate atomic file: commands may run beside the daemon without overwriting
  // its credentials, task outbox or other in-memory state.
  const key=createHash('sha256').update(JSON.stringify([store.endpoint||'',store.userId||'',store.installation||''])).digest('hex');
  return path.join(directory,`runtime-order-${key}.json`);
}
export function readRuntimeOrder(state){
  const file=preferenceFile(state);
  try{
    if(!fs.lstatSync(file).isFile())throw Error('Runtime order must be a regular file');
    return validateRuntimeOrder(JSON.parse(fs.readFileSync(file,'utf8')));
  }catch(error){
    if(error.code==='ENOENT')return botProviderOrder(state.store).filter(p=>DEFAULT_RUNTIME_ORDER.includes(p));
    throw error;
  }
}
export function writeRuntimeOrder(state,order){
  order=validateRuntimeOrder(order);
  const file=preferenceFile(state),temp=file+'.'+randomUUID()+'.tmp';
  try{fs.writeFileSync(temp,JSON.stringify(order)+'\n',{flag:'wx',mode:0o600});fs.renameSync(temp,file);}
  finally{fs.rmSync(temp,{force:true});}
  return order;
}
export function runtimeOrderCommand(state,args){
  if(!state.store.token||!state.store.userId)throw Error('请先运行 omni login / Sign in first');
  let order;
  if(!args.length)order=readRuntimeOrder(state);
  else if(args[0]==='reset'&&args.length===1)order=writeRuntimeOrder(state,DEFAULT_RUNTIME_ORDER);
  else if(args[0]==='set')order=writeRuntimeOrder(state,args.slice(1).flatMap(s=>s.split(',')).map(s=>s.trim()));
  else throw Error(runtimeOrderHelp);
  return {order,boundOrder:order.filter(p=>state.store.device?.runtimes?.includes(p)),appliesTo:'@Bot on this CLI device',activation:'Next device status report; active conversations keep their runtime'};
}
export function installRuntimeOrderReporting(bridge,state){
  let order=botProviderOrder(state.store).filter(p=>DEFAULT_RUNTIME_ORDER.includes(p)),failed=false;
  bridge.reportGroupChat=()=>{
    if(bridge.ws?.readyState!==1)return;
    try{order=readRuntimeOrder(state);failed=false;}
    catch{
      // A damaged preference must not terminate the device or interrupt tasks.
      if(!failed)console.error('无法读取 @Bot 顺序，暂时保留上次顺序；运行 omni runtimes order reset 修复 / Invalid runtime order; retaining last order');
      failed=true;
    }
    bridge.ws.send(JSON.stringify({type:'group-chat-state',...groupChatState(bridge),botProviderOrder:[...order,'wanwu']}));
  };
}
