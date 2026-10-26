import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {uuid} from './chat.mjs';
import {sessionDisplayName,sessionNameFields} from '../lib/shared/session-mentions.mjs';

const fields=(value,keys)=>Object.fromEntries(keys.filter(k=>value[k]!==undefined).map(k=>[k,value[k]]));
// Team metadata is server-authoritative. Never merge it into device state or
// cache labels across requests: another client may rename/revoke a target.
export function createCatalog({request,signal,sleep=(ms=1500)=>delay(ms,undefined,{signal})}){
  const base=p=>`/api/projects/${uuid(p,'Project ID')}`;
  const view=s=>({...fields(s,['id','projectId','deviceId','provider','folderId','folderName','status','noteRevision']),name:sessionDisplayName(s),alias:s.mentionAlias||'',token:s.mentionAlias?'@'+s.mentionAlias:null,notes:s.noteDetails||''});
  async function list(project,{agents=false,device,query=''}={}){
    if(device)uuid(device,'Device ID');
    const snapshot=await request(base(project)+'/snapshot');
    const devices=new Map(snapshot.devices.map(d=>[d.id,d]));
    return (snapshot.sessions||[]).filter(s=>!s.archivedAt&&devices.has(s.deviceId)&&(!agents||s.mentionAlias)&&(!device||s.deviceId===device)).map(s=>({...view(s),deviceName:devices.get(s.deviceId).name,online:!!devices.get(s.deviceId).online})).filter(s=>!query||[s.name,s.notes,s.deviceName,s.folderName].some(v=>String(v||'').toLocaleLowerCase().includes(query.toLocaleLowerCase())));
  }
  async function session(project,id){return await request(base(project)+`/sessions/${uuid(id,'Session ID')}/open`);}
  async function show(project,id){const s=await session(project,id);return {...view(s),...(await request(`/api/sessions/${id}/model-preference`))};}
  async function update(project,id,{name,notes,revision}={}){
    if(name===undefined&&notes===undefined)throw Error('Provide --name and/or --notes');
    if(name!==undefined&&(typeof name!=='string'||!name.trim()||name.trim().length>72))throw Error('Name must contain 1–72 characters');
    if(notes!==undefined&&(typeof notes!=='string'||notes.trim().length>12000))throw Error('Notes must be at most 12000 characters');
    const s=await session(project,id);
    // Keep fields not edited by this command, and reject concurrent changes.
    const result=await request(base(project)+'/work-notes','POST',{kind:'session',targetId:id,...(name===undefined?{summary:s.note||'',mentionAlias:s.mentionAlias||''}:sessionNameFields(name)),details:notes===undefined?s.noteDetails||'':notes,expectedRevision:revision??s.noteRevision??0});
    return view({...s,...result});
  }
  async function models(project,id){
    const s=await session(project,id),requestId=randomUUID();
    await request(base(project)+`/devices/${s.deviceId}/workbench`,'POST',{id:requestId,action:'models',provider:s.provider});
    for(let i=0;i<45;i++){
      signal?.throwIfAborted();
      const r=await request(`/api/workbench/requests/${requestId}`);
      if(r.status==='failed'||r.error)throw Error(r.error||'Runtime model discovery failed');
      if(r.status==='done')return {provider:s.provider,models:r.models||[]};
      await sleep();
    }
    throw Error('Runtime model discovery timed out; the target device must run omni start / Wanwu');
  }
  async function model(project,id,{model,effort}={}){
    if(model===undefined&&effort===undefined)return (await show(project,id)).preference;
    const current=await show(project,id);
    const selected=model===undefined?current.preference?.model||'':model;
    const strength=effort===undefined?(model!==undefined&&model!==current.preference?.model?'':current.preference?.effort||''):effort;
    if(!selected&&strength)throw Error('Choose an explicit --model before setting --effort');
    if(selected){
      const catalog=await models(project,id),item=catalog.models.find(m=>m.id===selected);
      if(!item)throw Error('Model is not available on this runtime; run sessions models first');
      if(strength&&!item.efforts?.includes(strength))throw Error('Effort is not supported by this model; run sessions models first');
    }
    // Model choices belong to this account, as in the app. Other members keep
    // their own preferences. Never reset unrelated fast/priority preferences.
    const latest=(await request(`/api/sessions/${id}/model-preference`)).preference;
    if(JSON.stringify(latest)!==JSON.stringify(current.preference))throw Error('Model preference changed on another client; read it again before editing');
    const value={model:selected,effort:strength,serviceTier:selected===current.preference?.model?current.preference.serviceTier||'default':'default'};
    return (await request(`/api/sessions/${id}/model-preference`,'PUT',value)).preference;
  }
  async function watch(project,options,emit){
    let last;
    for(;;){signal?.throwIfAborted();const items=await list(project,options),key=JSON.stringify(items);if(key!==last){emit({type:'catalog',projectId:project,items});last=key;}await sleep(5000);}
  }
  async function discover(project){
    const snapshot=await request(base(project)+'/snapshot');
    return {projectId:project,bot:{token:'@Bot',notes:'按团队默认规则自动选择设备与可用 AI；使用 --session 精确派给已有智能体。'},agents:await list(project,{agents:true}),canvases:(snapshot.canvases||[]).map(c=>fields(c,['id','title','description','note','tags','kind','url','access'])),skills:snapshot.skills,canvasAccess:'Use bundled wanwu-canvas skill for API, resources and knowledge; permissions still apply.'};
  }
  return {list,show,update,models,model,watch,discover};
}
