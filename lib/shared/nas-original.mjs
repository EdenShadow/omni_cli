// The body of a LAN record is the original file data. Only its small control
// header is sealed, so IM keys never appear in a LAN packet or on the share.
import {cryptRecord,recordBytes} from './nas-record.mjs';
export const maxHeader=8192;
export const originalFormat=g=>g.format==='original'||g.format==='original-im';
export const originalLength=(g,index)=>Math.min(recordBytes,g.size-recordBytes*index)-(g.format==='original-im'?16:0);
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
export async function packOriginal(grant,index,bytes,metadata={}){
 if(bytes.length!==originalLength(grant,index))throw Error('Invalid original size');
 const header=await cryptRecord(grant,index,new TextEncoder().encode(JSON.stringify({...metadata,hash:await digest(bytes)})),true);
 if(header.length>maxHeader)throw Error('Invalid original metadata');
 const output=new Uint8Array(4+header.length+bytes.length);
 new DataView(output.buffer).setUint32(0,header.length);output.set(header,4);output.set(bytes,4+header.length);
 return output;
}
export async function unpackOriginal(grant,index,packet){
 if(packet.length<4)throw Error('Invalid original record');
 const length=new DataView(packet.buffer,packet.byteOffset,4).getUint32(0);
 if(length>maxHeader||packet.length!==4+length+originalLength(grant,index))throw Error('Invalid original record');
 const metadata=JSON.parse(new TextDecoder().decode(await cryptRecord(grant,index,packet.subarray(4,4+length),false)));
 const bytes=packet.subarray(4+length);
 if(await digest(bytes)!==metadata.hash)throw Error('Original checksum mismatch');
 return {bytes,metadata};
}
