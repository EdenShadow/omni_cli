export const recordBytes = 4 * 1024 * 1024;
export async function cryptRecord(grant,index,bytes,encrypt) {
  const material=Uint8Array.from(atob(grant.key),c=>c.charCodeAt(0));
  const key=await crypto.subtle.importKey('raw',material,'AES-GCM',false,[encrypt?'encrypt':'decrypt']);
  const iv=encrypt?crypto.getRandomValues(new Uint8Array(12)):bytes.subarray(0,12);
  const options={name:'AES-GCM',iv,additionalData:new TextEncoder().encode(JSON.stringify([grant.id,grant.size,index]))};
  if(!encrypt)return new Uint8Array(await crypto.subtle.decrypt(options,key,bytes.subarray(12)));
  const cipher=new Uint8Array(await crypto.subtle.encrypt(options,key,bytes)),out=new Uint8Array(cipher.length+12);
  out.set(iv);out.set(cipher,12);return out;
}
