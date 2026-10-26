import {randomUUID} from 'node:crypto';
export const DEFAULT_ENDPOINT='https://43-154-101-190.sslip.io';
export function endpoint(value){
  const u=new URL(value);
  if(u.username||u.password||u.search||u.hash||u.pathname!=='/'||!(u.protocol==='https:'||u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))throw Error('Use an HTTPS server origin (HTTP is allowed only for local development)');
  return u.origin;
}
export function createRequest(store,fetcher=fetch,{signal}={}){
  const client=randomUUID();
  return async function request(p,method='GET',body,device=false,raw=false){
    if(!/^\/api\/[\w/?=&%.-]+$/.test(p)||p.includes('..'))throw Error('Invalid API path');
    const token=device?store.deviceToken:store.token;
    const response=await fetcher(new URL(p,endpoint(store.endpoint)),{method,redirect:'error',headers:{'Content-Type':'application/json','X-Wanwu-Desktop':'1','X-Wanwu-Access-Client':client,...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.any([AbortSignal.timeout(/skills|blobs|attachment|outputs|skill-assistant/.test(p)?1800000:60000),...(signal?[signal]:[])])});
    if(!response.ok){let detail;try{detail=await response.json();}catch{}throw Object.assign(Error(detail?.error||`Server returned ${response.status}`),{status:response.status,code:detail?.code});}
    return raw?Buffer.from(await response.arrayBuffer()):response.status===204?{}:response.json();
  };
}
