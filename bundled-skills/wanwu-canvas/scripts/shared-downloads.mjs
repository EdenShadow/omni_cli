import {createHash} from 'node:crypto';

export async function verifyPublicDownloads(policy,sourceFiles,expectedIds){
 if(policy.mode!=='public'||!policy.url)throw Error('Anonymous verification requires an existing public share');
 if(!Array.isArray(expectedIds)||!expectedIds.length||new Set(expectedIds).size!==expectedIds.length)throw Error('Supply the expected attachmentIds in --input');
 const link=new URL(policy.url),token=link.pathname.match(/^\/canvas\/share\/([a-f0-9]{48})$/)?.[1];
 if(!token||!['http:','https:'].includes(link.protocol)||link.username||link.password)throw Error('Invalid share link');
 const root=link.origin+'/api/shared-canvases/'+token+'/files';
 const guest=async url=>{
  const response=await fetch(url,{credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(600000)});
  if(!response.ok)throw Error('Guest request failed ('+response.status+')');
  return response;
 };
 const {files}=await (await guest(root)).json();
 const expected=new Set(expectedIds);
 if(files.length!==expected.size||files.some(f=>!expected.delete(f.id)))throw Error('Guest file list differs from the expected selection');
 let bytes=0;
 for(const {id} of files){
  const source=sourceFiles.find(f=>f.id===id&&f.role==='attachment');
  if(!source)throw Error('Expected attachment missing from source canvas');
  const ticket=await (await guest(root+'/'+encodeURIComponent(id))).json();
  if(!/^\/api\/canvas-content\/[a-f0-9]{48}\/[^/]+$/.test(ticket.path))throw Error('Invalid download ticket');
  const response=await guest(link.origin+ticket.path),hash=createHash('sha256');
  let size=0;
  for await(const chunk of response.body){
   size+=chunk.length;
   if(size>source.size)throw Error('Download exceeded source size');
   hash.update(chunk);
  }
  if(size!==source.size||hash.digest('hex')!==source.sha256)throw Error('Guest download differs from the source attachment');
  bytes+=size;
 }
 return {status:'verified',verifiedFiles:files.length,verifiedBytes:bytes};
}
