import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,renameSync,openSync,readSync,closeSync} from 'node:fs';
import path from 'node:path';
import {homedir} from 'node:os';
export const SKILL_CHUNK_BYTES=4*1024*1024;
const root=()=>process.env.WANWU_SKILL_BLOB_ROOT||path.join(homedir(),'.wanwu','skill-blobs');
const digest=b=>createHash('sha256').update(b).digest('hex');
export function blobPath(hash){if(!/^[a-f0-9]{64}$/.test(hash))throw Error('Invalid skill blob');return path.join(root(),hash);}
export function readSkillBlob(chunk){const bytes=readFileSync(blobPath(chunk.sha256));if(bytes.length!==chunk.size||digest(bytes)!==chunk.sha256)throw Error('技能资源校验失败，请重新同步');return bytes;}
export function hasSkillBlob(chunk){try{readSkillBlob(chunk);return true;}catch{return false;}}
export function saveSkillBlob(bytes){
 if(bytes.length>SKILL_CHUNK_BYTES)throw Error('Skill chunk too large');
 const sha256=digest(bytes),chunk={sha256,size:bytes.length};if(hasSkillBlob(chunk))return chunk;
 mkdirSync(root(),{recursive:true,mode:0o700});const dest=blobPath(sha256),temp=dest+'.'+randomUUID();writeFileSync(temp,bytes,{mode:0o600});renameSync(temp,dest);return chunk;
}
export function hashSkillFile(file){const hash=createHash('sha256'),fd=openSync(file,'r'),buffer=Buffer.alloc(SKILL_CHUNK_BYTES);try{let n;while((n=readSync(fd,buffer,0,buffer.length,null)))hash.update(buffer.subarray(0,n));}finally{closeSync(fd);}return hash.digest('hex');}
export function skillFileReference(file){
 const chunks=[],hash=createHash('sha256'),fd=openSync(file,'r'),buffer=Buffer.alloc(SKILL_CHUNK_BYTES);let size=0;
 try{let n;while((n=readSync(fd,buffer,0,buffer.length,null))){const bytes=buffer.subarray(0,n);size+=n;hash.update(bytes);chunks.push(saveSkillBlob(bytes));}}finally{closeSync(fd);}
 return {sha256:hash.digest('hex'),size,chunks};
}
export function* skillFileBytes(file){if(typeof file.data==='string'){yield Buffer.from(file.data,'base64');return;}for(const chunk of file.chunks)yield readSkillBlob(chunk);}
export function writeSkillFile(file,target){
 const hash=createHash('sha256'),fd=openSync(target,'w',file.mode);let size=0;
 try{for(const bytes of skillFileBytes(file)){hash.update(bytes);size+=bytes.length;writeFileSync(fd,bytes);}}finally{closeSync(fd);}
 if(hash.digest('hex')!==file.sha256||file.size!==undefined&&file.size!==size)throw Error('技能资源完整性校验失败：'+file.path);
}
export function skillFileSize(file){return file.size??Buffer.byteLength(file.data,'base64');}
