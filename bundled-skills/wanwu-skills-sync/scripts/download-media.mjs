// A local, unauthenticated download for an explicitly requested media URL.
// Stream to a temporary sibling; an incomplete file is never reported as saved.
import {open,link,unlink} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {randomUUID} from 'node:crypto';

async function download(input,output){
 const target=resolve(output),temporary=join(dirname(target),'.wanwu-media-'+randomUUID()+'.part');
 const url=new URL(input);
 if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw Error('Expected an HTTP(S) URL without credentials');
 const response=await fetch(url,{headers:{'User-Agent':'WanwuAI/1.0 (media download)',Accept:'image/*,video/*,audio/*,*/*;q=0.5'},signal:AbortSignal.timeout(600000)});
 if(!response.ok||!response.body){await response.body?.cancel();throw Error('Media download returned HTTP '+response.status);}
 const type=response.headers.get('content-type')?.split(';')[0].toLowerCase();
 const gif=type==='image/gif'||/\.gif$/i.test(url.pathname)||/\.gif$/i.test(target);
 if(type==='text/html'){await response.body.cancel();throw Error('Expected media, received HTML');}
 const file=await open(temporary,'wx',0o600);
 try{
  let bytes=0,header=Buffer.alloc(0);
  for await(const chunk of response.body){
   bytes+=chunk.length;
   if(bytes>1024**3)throw Error('Media exceeds the 1 GB attachment limit');
   if(gif&&header.length<6)header=Buffer.concat([header,chunk.subarray(0,6-header.length)]);
   await file.writeFile(chunk);
  }
  if(!bytes||gif&&!['GIF87a','GIF89a'].includes(header.toString('latin1')))throw Error('Empty or invalid media file');
  await file.close();await link(temporary,target);
  return {path:target,bytes};
 }finally{await file.close();await unlink(temporary);}
}
try{
 if(process.argv.length!==4)throw Error('Usage: node download-media.mjs URL OUTPUT');
 console.log(JSON.stringify(await download(process.argv[2],process.argv[3])));
}catch(error){console.error(error.code==='EEXIST'?'Output already exists; choose a new filename':error.message);process.exitCode=1;}
