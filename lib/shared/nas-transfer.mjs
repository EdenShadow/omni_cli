import {packOriginal,unpackOriginal,originalFormat,maxHeader,originalLength} from './nas-original.mjs';
import {lanUrl} from './nas-lan-address.mjs';
import {recordBytes,cryptRecord} from './nas-record.mjs';
export {recordBytes,cryptRecord};
export function recordUrl(grant,index) {
  const url=lanUrl(grant.url);
  if (!url || !/^\/transfer\/[0-9a-f]{64}$/.test(url.pathname) || !Number.isSafeInteger(index) || index<0 || index>=Math.ceil(grant.size/recordBytes)) throw Error('Invalid NAS transfer');
  return url.href+'/'+index;
}
export async function transferFetch(grant,index,body) {
  const url=recordUrl(grant,index);
  const response=await fetch(url,{method:body?'PUT':'GET',body,redirect:'error',credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(15000)});
  if(!response.ok){await response.body?.cancel();throw Error('NAS transfer unavailable');}
  if(body)return;
  if(!validWireLength(grant,index,Number(response.headers.get('content-length')))){await response.body?.cancel();throw Error('Invalid NAS record size');}
  return new Uint8Array(await response.arrayBuffer());
}
export function validWireLength(grant,index,length){
  if(!originalFormat(grant))return length===Math.min(recordBytes,grant.size-index*recordBytes)+28;
  const overhead=length-originalLength(grant,index);
  return overhead>=32&&overhead<=4+maxHeader;
}
// OPTIONS is supported by existing NAS hosts and never sends attachment bytes.
export async function probeNas(grant,signal){
  const response=await fetch(recordUrl(grant,0),{method:'OPTIONS',signal,redirect:'error',credentials:'omit'});
  return response.status===204;
}
const misses=new Map();
export function resetNasReachability(){misses.clear();}
function skipNas(project,batch,hint){
  const miss=misses.get(project);
  if(!miss)return false;
  if(hint)return miss.at>=hint.checkedAt;
  return Date.now()<miss.until || batch && batch===miss.batch;
}
function rememberMiss(project,batch){
  if(misses.size>=64)misses.delete(misses.keys().next().value);
  misses.set(project,{batch,at:Date.now(),until:Date.now()+30000});
}
export async function tryNasUpload(request,project,upload,read,wire,progress,original,routeCheck){
  if(upload.ready||upload.received||!upload.size)return;
  const route='/api/projects/'+project+'/attachment-uploads/'+upload.id+'/nas';
  const begin=original?{original:true,batch:routeCheck?.batch}:{};
  const hint=routeCheck?.hint;
  if(hint?.origin===null || routeCheck && skipNas(project,routeCheck.batch,hint))return;
  let grant;
  if(routeCheck){
    const controller=new AbortController();
    let timer;
    try{
      const deadline=new Promise(resolve=>{
        timer=setTimeout(()=>{controller.abort();resolve(null);},2000);
      });
      // A late grant only creates an unused ticket. Only the caller below writes bytes.
      const available=async()=>{
        const candidate=await request(route,'POST',begin);
        if(controller.signal.aborted || !candidate?.url)return null;
        if(hint?.origin===new URL(candidate.url).origin)return candidate;
        return await routeCheck.probe(candidate,controller.signal)?candidate:null;
      };
      grant=await Promise.race([available(),deadline]);
    }catch{/* Use the public upload when a route cannot be established. */}
    finally{clearTimeout(timer);}
    if(!grant){rememberMiss(project,routeCheck.batch);return;}
  }
  let finishing=false;
  try{
    grant??=await request(route,'POST',begin);
    if(!grant?.url)return;
    for(let offset=0,index=0;offset<upload.size;offset+=recordBytes,index++){
      if(originalFormat(grant)){
        const bytes=await original.read(index,originalLength(grant,index));
        await wire(grant,index,await packOriginal(grant,index,bytes,{name:original.name,im:original.im}));
      }else{
        const bytes=await read(offset,Math.min(recordBytes,upload.size-offset));
        await wire(grant,index,await cryptRecord(grant,index,bytes,true));
      }
      progress?.(Math.min(upload.size,offset+recordBytes)/upload.size);
    }
    finishing=true;
    return await request(route,'POST',{finish:true});
  }catch{
    if(!finishing){if(routeCheck)rememberMiss(project,routeCheck.batch);return;}
    // A lost completion response may already have committed the NAS object.
    const current=await request(route.slice(0,-4),'GET');
    if(current.ready)return current;
  }
}
// Stage only after a failed execution read or an explicit publication. Polling
// keeps large WAN transfers independent of any single HTTP request timeout.
export async function stageNas(request,endpoint,action){
  const route=endpoint+(endpoint.includes('?')?'&':'?')+action+'=1';
  const deadline=Date.now()+30*60*1000;
  while(Date.now()<deadline){
    const status=await request(route,'POST',{});
    if(!status?.pending)return status;
    await new Promise(ok=>setTimeout(ok,1000));
  }
  throw Error('NAS transfer timed out');
}
export async function nasReader(request,endpoint,wire=transferFetch){
  let grant;
  try{grant=await request(endpoint+(endpoint.includes('?')?'&':'?')+'original=1&lan=1','GET');}catch{return;}
  if(!grant?.url)return;
  const read=async index=>{
    const packet=await wire(grant,index);
    return originalFormat(grant)?(await unpackOriginal(grant,index,packet)).bytes:cryptRecord(grant,index,packet,false);
  };
  read.originalIM=grant.format==='original-im';return read;
}
