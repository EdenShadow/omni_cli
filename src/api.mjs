import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
const {version}=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
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
    const restore=p==='/api/devices/restore';
    if(restore&&(device||!store.token||!store.userId))throw Error('请先登录 / Sign in before device recovery');
    const recoveryHeaders=restore?{'X-Wanwu-Client-Version':version,'X-Wanwu-Reported-User-Id':store.userId}:{};
    const response=await fetcher(new URL(p,endpoint(store.endpoint)),{method,redirect:'error',headers:{'Content-Type':'application/json','X-Wanwu-Desktop':'1','X-Wanwu-Access-Client':client,...recoveryHeaders,...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.any([AbortSignal.timeout(/skills|blobs|attachment|outputs|skill-assistant/.test(p)?1800000:60000),...(signal?[signal]:[])])});
    if(!response.ok){let detail;try{detail=await response.json();}catch{}throw Object.assign(Error(detail?.error||`Server returned ${response.status}`),{status:response.status,signInRejected:p==='/api/auth/login'&&response.status>=400&&response.status<500,code:detail?.code,retryAfter:detail?.retryAfter||Number(response.headers?.get?.('retry-after'))||undefined,failures:detail?.failures,reference:detail?.reference,supportEmail:detail?.supportEmail});}
    return raw?Buffer.from(await response.arrayBuffer()):response.status===204?{}:response.json();
  };
}
