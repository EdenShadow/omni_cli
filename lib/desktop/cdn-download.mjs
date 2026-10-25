import {createHash} from 'node:crypto';
export function validateCdnUrl(value){
  const url=new URL(value);
  if(url.origin!=='https://download.wanwu321.com'||url.username||url.password||url.hash||!url.searchParams.has('sign'))throw Error('Invalid CDN download URL');
  return url;
}
export async function readCdn(delivery,{maxBytes=24*1024*1024,sha256,size,write,cancelled=()=>{},fetcher=fetch}={}){
  const url=validateCdnUrl(delivery.url),controller=new AbortController();let count=0;const chunks=[],hash=createHash('sha256');
  const timeout=setTimeout(()=>controller.abort(),30*60*1000);
  try{
    cancelled();const response=await fetcher(url,{redirect:'error',credentials:'omit',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(30*60*1000)])});
    if(response.status!==200)throw Error('CDN 下载暂不可用，请重试 / CDN download unavailable. Retry.');
    const reader=response.body.getReader();
    try{while(true){cancelled();const idle=setTimeout(()=>controller.abort(),45000);let result;try{result=await reader.read();}finally{clearTimeout(idle);}if(result.done)break;
      count+=result.value.length;if(count>maxBytes||(size!==undefined&&count>size))throw Error('Download too large');hash.update(result.value);if(write)await write(result.value,count);else chunks.push(result.value);
    }}finally{await reader.cancel().catch(()=>{});}
    cancelled();if(size!==undefined&&count!==size||sha256&&hash.digest('hex')!==sha256)throw Error('下载文件校验失败 / Download integrity check failed');
    return write?count:Buffer.concat(chunks);
  }finally{clearTimeout(timeout);controller.abort();}
}
