// Share resource work, never actor state. Each rendered character gets its own
// manifest copy and SVG tree. Private assets are shared only while in flight.
export function createCharacterResources({fetcher=fetch,origin=location.origin,protocol=location.protocol,now=Date.now}={}){
  const entries=new Map();let generation=0,delivery=null,pack=null,packPending=null,blockedUntil=0;
  const controllers=new Set();
  function configure(value){
    if(protocol==='wanwu:')return;
    try{
      const url=new URL(value.url);
      if(url.origin!=='https://download.wanwu321.com'||url.username||url.password||url.hash||!url.searchParams.has('sign')||!/^[a-f0-9]{64}$/.test(value.sha256)||url.pathname!==`/desktop-updates/characters/${value.sha256}.json`||!Number.isSafeInteger(value.size)||value.size<1||value.size>4*1024*1024||!Number.isFinite(value.expiresAt)||value.expiresAt<=now())return;
      if(delivery?.sha256!==value.sha256){clear();}
      delivery={...value,url:url.href};
    }catch{/* Older servers and offline builds need no CDN configuration. */}
  }
  function clear(){generation++;entries.clear();pack=null;packPending=null;blockedUntil=0;delivery=null;for(const c of controllers)c.abort();controllers.clear();}
  async function read(url,options={},timeout=15000){
    const controller=new AbortController();controllers.add(controller);
    const timer=setTimeout(()=>controller.abort(),timeout);
    try{
      const response=await fetcher(url,{...options,signal:options.signal?AbortSignal.any([options.signal,controller.signal]):controller.signal});
      if(!response.ok)throw Error(`角色资源加载失败 (${response.status})`);
      const reader=response.body.getReader(),chunks=[];let size=0;
      try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>16*1024*1024)throw Error('角色资源过大');chunks.push(value);}}
      finally{await reader.cancel().catch(()=>{});}
      const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
    }finally{clearTimeout(timer);controllers.delete(controller);}
  }
  async function fromPack(id){
    if(pack)return pack.characters[id];
    if(!delivery||delivery.expiresAt<=now()+5000||now()<blockedUntil)return null;
    if(!packPending){
      const config=delivery,epoch=generation;
      const pending=(async()=>{
        const cdnController=new AbortController(),originController=new AbortController();let timer,settled=false,originStarted=false;
        const verify=async(url,options)=>{
          const bytes=await read(url,options,5000);
          const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
          if(bytes.length!==config.size||digest!==config.sha256)throw Error('角色资源校验失败');
          const value=JSON.parse(new TextDecoder().decode(bytes));
          if(value.schemaVersion!==1||!value.characters)throw Error('角色资源包无效');
          return value;
        };
        try{
          const cdn=verify(config.url,{credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',signal:cdnController.signal});
          // CDN cold starts vary by region. After 200 ms, race the identical
          // same-origin pack and cancel the slower transfer once one is verified.
          const local=new Promise((resolve,reject)=>{
            const start=()=>{if(settled||originStarted)return;originStarted=true;verify(origin+'/office-characters/character-pack.json',{signal:originController.signal}).then(resolve,reject);};
            timer=setTimeout(start,200);cdn.catch(start);
          });
          const value=await Promise.any([cdn,local]);
          if(epoch!==generation)throw new DOMException('Account changed','AbortError');
          pack=value;return value;
        }catch(error){if(epoch!==generation)throw error;blockedUntil=now()+60000;return null;}
        finally{settled=true;clearTimeout(timer);cdnController.abort();originController.abort();if(packPending===pending)packPending=null;}
      })();packPending=pending;
    }
    return (await packPending)?.characters[id];
  }
  async function load(value){
    const url=new URL(value);
    if(url.origin!==origin)throw Error('角色包必须同源');
    const builtin=!url.search&&url.pathname.match(/^\/office-characters\/([a-zA-Z0-9_-]+)\/character\.json$/);
    let entry=entries.get(url.href);
    if(!entry){
      const epoch=generation;
      const pending=(async()=>{
        let result=builtin?await fromPack(builtin[1]):null;
        if(!result){
          const data=JSON.parse(new TextDecoder().decode(await read(url.href)));
          const artUrl=new URL(data.art,url);
          if(artUrl.origin!==origin)throw Error('SVG 必须同源');
          result={data,art:new TextDecoder().decode(await read(artUrl.href))};
        }
        if(epoch!==generation)throw new DOMException('Account changed','AbortError');
        return result;
      })();
      entry={pending};entries.set(url.href,entry);
      pending.then(()=>{if(!builtin&&entries.get(url.href)===entry)entries.delete(url.href);},()=>{if(entries.get(url.href)===entry)entries.delete(url.href);});
      // Bound retained public manifests; pending readers hold their own promise.
      if(entries.size>24)entries.delete(entries.keys().next().value);
    }
    const result=await entry.pending;
    return {data:structuredClone(result.data),art:result.art};
  }
  return {load,configure,clear};
}

export const characterResources=typeof window==='undefined'?null:createCharacterResources();
if(characterResources){
  if(window.wanwuCharacterDelivery)characterResources.configure(window.wanwuCharacterDelivery);
  window.addEventListener('wanwu-character-delivery',event=>characterResources.configure(event.detail));
  window.addEventListener('wanwu-character-resources-clear',()=>characterResources.clear());
}
