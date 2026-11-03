// Transport records are encrypted even when the underlying attachment is plain.
// The URL is a short-lived ticket. The AES key only travels over the authenticated API.
import {lanUrl} from './nas-lan-address.mjs';
export const recordBytes = 4 * 1024 * 1024;
export function recordUrl(grant,index) {
  const url=lanUrl(grant.url);
  if (!url || !/^\/transfer\/[0-9a-f]{64}$/.test(url.pathname) || !Number.isSafeInteger(index) || index<0 || index>=Math.ceil(grant.size/recordBytes)) throw Error('Invalid NAS transfer');
  return url.href+'/'+index;
}
export async function cryptRecord(grant,index,bytes,encrypt) {
  const material=Uint8Array.from(atob(grant.key),c=>c.charCodeAt(0));
  const key=await crypto.subtle.importKey('raw',material,'AES-GCM',false,[encrypt?'encrypt':'decrypt']);
  const iv=encrypt?crypto.getRandomValues(new Uint8Array(12)):bytes.subarray(0,12);
  const options={name:'AES-GCM',iv,additionalData:new TextEncoder().encode(JSON.stringify([grant.id,grant.size,index]))};
  if(!encrypt)return new Uint8Array(await crypto.subtle.decrypt(options,key,bytes.subarray(12)));
  const cipher=new Uint8Array(await crypto.subtle.encrypt(options,key,bytes)),out=new Uint8Array(cipher.length+12);
  out.set(iv);out.set(cipher,12);return out;
}
export async function transferFetch(grant,index,body) {
  const url=recordUrl(grant,index);
  const response=await fetch(url,{method:body?'PUT':'GET',body,redirect:'error',credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(15000)});
  if(!response.ok){await response.body?.cancel();throw Error('NAS transfer unavailable');}
  if(body)return;
  const size=Math.min(recordBytes,grant.size-index*recordBytes)+28;
  if(Number(response.headers.get('content-length'))!==size){await response.body?.cancel();throw Error('Invalid NAS record size');}
  return new Uint8Array(await response.arrayBuffer());
}
export async function tryNasUpload(request,project,upload,read,wire,progress){
  if(upload.ready||upload.received||!upload.size)return;
  const route='/api/projects/'+project+'/attachment-uploads/'+upload.id+'/nas';
  try{
    const grant=await request(route,'POST',{});
    if(!grant?.url)return;
    for(let offset=0,index=0;offset<upload.size;offset+=recordBytes,index++){
      const bytes=await read(offset,Math.min(recordBytes,upload.size-offset));
      await wire(grant,index,await cryptRecord(grant,index,bytes,true));
      progress?.(Math.min(upload.size,offset+recordBytes)/upload.size);
    }
    return await request(route,'POST',{finish:true});
  }catch{
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
  try{grant=await request(endpoint+(endpoint.includes('?')?'&':'?')+'lan=1','GET');}catch{return;}
  if(!grant?.url)return;
  return async index=>cryptRecord(grant,index,await wire(grant,index),false);
}
