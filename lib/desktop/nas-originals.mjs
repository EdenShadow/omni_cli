import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,link,rm,rename} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {recordBytes} from '../shared/nas-transfer.mjs';
import {packOriginal,unpackOriginal,originalLength} from '../shared/nas-original.mjs';
import {encryptFileRecord,encryptedFileSize} from '../shared/chat-file-crypto.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function cache(host,grant){
 if(!/^[a-f0-9-]{36}$/.test(grant.id))throw Error('Invalid transfer ID');
 return path.join(host.bridge.dataDir,'nas-originals',grant.id);
}
function filename(value){
 if(typeof value!=='string'||!value||value.length>1024)throw Error('Invalid original filename');
 const name=Array.from(value.replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').replace(/[. ]+$/,'')).slice(0,180).join('');
 return !name||/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)?'_'+name:name;
}
async function immutable(file,bytes){
 const temp=file+'.'+randomUUID()+'.tmp';
 try{
  await writeFile(temp,bytes,{mode:0o600,flag:'wx'});
  try{await link(temp,file);}catch(e){if(e.code!=='EEXIST'||!(await readFile(file)).equals(bytes))throw e;}
 }finally{await rm(temp,{force:true});}
}
export async function storeOriginalPart(host,grant,index,packet){
 const {bytes,metadata}=await unpackOriginal(grant,index,packet),dir=cache(host,grant);
 const name=filename(metadata.name);
 const im=grant.format==='original-im'?metadata.im:null;
 if(grant.format==='original-im'&&(!im||im.v!==1||typeof im.id!=='string'||!Number.isSafeInteger(im.size)||im.size<0||encryptedFileSize(im.size)!==grant.size||typeof im.key!=='string'||Buffer.from(im.key,'base64').length!==32||typeof im.prefix!=='string'||Buffer.from(im.prefix,'base64').length!==8))throw Error('Invalid IM control header');
 await mkdir(dir,{recursive:true,mode:0o700});
 await immutable(path.join(dir,'meta'),Buffer.from(JSON.stringify({name,im})));
 await immutable(path.join(dir,index+'.part'),Buffer.from(bytes));
}
async function readRange(client,remote,index,grant,expectedHash){
 const length=originalLength(grant,index),unit=recordBytes-(grant.format==='original-im'?16:0);
 const chunks=[];let count=0;
 if(length)for await(const bytes of client.createReadStream(remote,{start:BigInt(index*unit),end:BigInt(index*unit+length-1)})){
  count+=bytes.length;if(count>length)throw Error('Invalid NAS range');chunks.push(bytes);
 }
 const bytes=Buffer.concat(chunks);
 if(count!==length||sha(bytes)!==expectedHash)throw Error('NAS original has changed');
 return bytes;
}
export async function readOriginalPart(host,client,directoryFor,grant,index){
 const manifest=JSON.parse(await readFile(path.join(cache(host,grant),'ready'),'utf8'));
 const root=await directoryFor(manifest.folder||grant.id);
 const bytes=await readRange(client,root+'/'+filename(manifest.name),index,grant,manifest.hashes[index]);
 return packOriginal(grant,index,bytes);
}
async function verifyOriginal(client,remote,digest){
 const hash=createHash('sha256');
 for await(const bytes of client.createReadStream(remote))hash.update(bytes);
 if(hash.digest('hex')!==digest)throw Error('NAS verification failed');
}
export async function originalJob(host,client,directoryFor,grant,job){
 const dir=cache(host,grant),manifestFile=path.join(dir,'ready');
 const journal=path.join(dir,'publishing');
 if(grant.remove){
  let stage;
  try{stage=JSON.parse(await readFile(journal,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  if(stage){
   const root=await directoryFor(stage.folder);
   await client.rm(root+'/'+stage.tempName).catch(e=>{if(e.code!=='ENOENT')throw e;});
  }
  await rm(dir,{recursive:true,force:true});await host.call('transfer-done',{job});return;
 }
 const {name,im}=JSON.parse(await readFile(path.join(dir,'meta'),'utf8'));
 const records=Math.ceil(grant.size/recordBytes);
 let manifest;
 try{manifest=JSON.parse(await readFile(manifestFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 const hash=createHash('sha256');
 // IM's public attachment metadata uses the digest of its authenticated
 // envelope. Recreate that representation privately, never on the LAN wire.
 const cloudRecord=(i,bytes)=>im?encryptFileRecord(im,i,bytes):bytes;
 if(!manifest){
  if(grant.recall)throw Error('Original not committed');
  // Keep the verified temp name and intended destination until the rename is
  // acknowledged. A restarted job can distinguish its own rename from a collision.
  let stage;
  try{stage=JSON.parse(await readFile(journal,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  const folder=stage?.folder||grant.folder||grant.id,root=await directoryFor(folder,true);
  if(!stage){
   const tempName='.wanwu-'+randomUUID()+'.part',temp=root+'/'+tempName;
   const hashes=[],originalHash=createHash('sha256');
   async function* parts(){
    for(let i=0;i<records;i++){
     const bytes=await readFile(path.join(dir,i+'.part'));
     if(bytes.length!==originalLength(grant,i))throw Error('Incomplete original');
     hashes.push(sha(bytes));originalHash.update(bytes);hash.update(await cloudRecord(i,bytes));yield bytes;
    }
   }
   try{
    await pipeline(Readable.from(parts()),client.createWriteStream(temp));
    const digest=originalHash.digest('hex');
    await verifyOriginal(client,temp,digest);
    stage={tempName,name,folder,hashes,digest,cloudHash:hash.digest('hex'),number:1};
    await immutable(journal,Buffer.from(JSON.stringify(stage)));
   }catch(error){await client.rm(temp).catch(()=>{});throw error;}
  }
  const temp=root+'/'+stage.tempName;
  for(let collision=0;;collision++){
   const remote=root+'/'+stage.name;
   try{await client.rename(temp,remote);break;}
   catch(error){
    if(error.code==='ENOENT'){
     // SMB applied an earlier rename before the host recorded its receipt.
     await verifyOriginal(client,remote,stage.digest);
     break;
    }
    if(error.code!=='EEXIST'||collision>=30)throw error;
    const ext=path.extname(name),stem=path.basename(name,ext);
    stage.number++;
    stage.name=filename(Array.from(stem).slice(0,150).join('')+' ('+stage.number+')'+Array.from(ext).slice(0,20).join(''));
    await writeFile(journal+'.next',JSON.stringify(stage),{mode:0o600});await rename(journal+'.next',journal);
   }
  }
  manifest={name:stage.name,folder,hashes:stage.hashes,cloudHash:stage.cloudHash};
  await immutable(manifestFile,Buffer.from(JSON.stringify(manifest)));
  await rm(journal,{force:true});
  for(let i=0;i<records;i++)await rm(path.join(dir,i+'.part'),{force:true});
 }else if(grant.recall){
  const remote=(await directoryFor(manifest.folder||grant.id))+'/'+filename(manifest.name);
  for(let i=0;i<records;i++){
   const bytes=await readRange(client,remote,i,grant,manifest.hashes[i]);
   const cloud=await cloudRecord(i,bytes);hash.update(cloud);
   await host.call('transfer-part',{job,index:i,data:Buffer.from(cloud).toString('base64')});
  }
  if(hash.digest('hex')!==manifest.cloudHash)throw Error('Public copy mismatch');
 }
 await host.call('transfer-done',{job,sha256:manifest.cloudHash});
}
