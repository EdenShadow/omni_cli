import {hostname} from 'node:os';
import {createRequest} from './api.mjs';

const planPath='/api/bridge/nas/plan';
const conflict='当前已有设备托管。请先退出原来的万物客户端或 Omni CLI，待状态变为 waiting 后重试。';

export async function nasCommand(state,action,project){
  const {store}=state;
  const request=createRequest(store);
  const base='/api/projects/'+project;
  const catalog=await request(base+'/skill-credentials');
  const dependency=catalog.items.find(s=>s.name==='wanwu-skills-sync')?.dependencies.find(d=>d.id==='nas-smb');
  const entry=dependency?.entries.find(e=>e.id===dependency.currentEntryId);
  if(!entry)throw Error('请在项目钥匙库选择 NAS 共享盘');
  const assigned=async()=> (await request(planPath,'POST',{},true)).entries.some(e=>e.id===entry.id);

  if(action==='status')return {project,credential:entry.label,state:entry.nasWeb,port:entry.nasHttpPort,address:entry.nasHttpOrigin||null,eligibleOnThisDevice:store.deviceToken?await assigned():false};
  if(entry.createdBy!==store.userId)throw Error('请使用创建这把 NAS 钥匙的账号登录');
  if(!entry.ready || !Number.isInteger(entry.nasHttpPort))throw Error('请先在万物 1.2.442 或更高版本中配置有效的 NAS 钥匙');
  if(['ready','existing'].includes(entry.nasWeb) && (!store.deviceToken || !await assigned()))throw Error(conflict);
  if(!store.deviceToken){
    const deviceName=hostname()+' NAS';
    const binding=await request('/api/devices/bind','POST',{installation:store.installation,machineKey:store.machineKey,name:deviceName,platform:process.platform,runtimes:[]});
    store.installation=binding.installation||store.installation;
    store.device=binding.device;
    store.deviceToken=binding.deviceToken;
    store.deviceName=deviceName;
    state.save();
  }
  await request(base+'/devices','POST',{deviceId:store.device.id});
  await request(base+'/skill-credentials/wanwu-skills-sync','PUT',{
    dependency:'nas-smb',id:entry.id,revision:entry.revision,label:entry.label,values:{},nasHost:store.device.id
  });
  if(!await assigned())throw Error(conflict);
  return {project,device:store.device.name,credential:entry.label,configuredPort:entry.nasHttpPort,next:'omni start'};
}
