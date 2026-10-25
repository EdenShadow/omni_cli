import {b64,unb64} from './chat-crypto.mjs';
// One authenticated record fits the existing 4 MiB upload transport. A random
// key is used once per file; the 64-bit prefix + record index never repeats.
export const CHAT_FILE_RECORD=4*1024*1024,CHAT_FILE_PLAIN=CHAT_FILE_RECORD-16;
export function encryptedFileSize(size){return size+Math.max(1,Math.ceil(size/CHAT_FILE_PLAIN))*16;}
export function fileSecret(file){return {v:1,id:crypto.randomUUID(),key:b64(crypto.getRandomValues(new Uint8Array(32))),prefix:b64(crypto.getRandomValues(new Uint8Array(8))),name:file.name,mime:file.mime||file.type||'application/octet-stream',size:file.size};}
function params(meta,index){
  if(meta.v!==1||!Number.isSafeInteger(meta.size)||meta.size<0||meta.size>(meta.folder?2*1024*1024*1024:500*1024*1024)||!Number.isInteger(index)||index<0||index>=Math.max(1,Math.ceil(meta.size/CHAT_FILE_PLAIN)))throw Error('Invalid encrypted file record');
  const prefix=unb64(meta.prefix);if(prefix.length!==8)throw Error('Invalid file nonce');
  const iv=new Uint8Array(12);iv.set(prefix);new DataView(iv.buffer).setUint32(8,index);
  return {name:'AES-GCM',iv,tagLength:128,additionalData:new TextEncoder().encode(JSON.stringify(['wanwu-im-file',1,meta.id,meta.size,index]))};
}
export async function encryptFileRecord(meta,index,plain){
  const expected=Math.min(CHAT_FILE_PLAIN,meta.size-index*CHAT_FILE_PLAIN);if(plain.byteLength!==expected)throw Error('File record size changed');
  const key=await crypto.subtle.importKey('raw',unb64(meta.key),'AES-GCM',false,['encrypt']);
  return new Uint8Array(await crypto.subtle.encrypt(params(meta,index),key,plain));
}
export async function decryptFileRecord(meta,index,cipher){
  const expected=Math.min(CHAT_FILE_PLAIN,meta.size-index*CHAT_FILE_PLAIN)+16;if(cipher.byteLength!==expected)throw Error('Incomplete encrypted attachment');
  const key=await crypto.subtle.importKey('raw',unb64(meta.key),'AES-GCM',false,['decrypt']);
  return new Uint8Array(await crypto.subtle.decrypt(params(meta,index),key,cipher));
}
