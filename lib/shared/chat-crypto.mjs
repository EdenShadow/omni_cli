// IM encryption v1. The relay receives public keys, wrapped room keys and
// authenticated ciphertext only. Never fall back to plaintext on a crypto error.
const enc = new TextEncoder(), dec = new TextDecoder();
export const b64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 16384) s += String.fromCharCode(...bytes.subarray(i, i + 16384)); return btoa(s); };
export const unb64 = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const bytes = value => enc.encode(JSON.stringify(value));
export async function digest(value) { return b64(new Uint8Array(await crypto.subtle.digest('SHA-256', value))); }
export async function createIdentity() {
  const pair = await crypto.subtle.generateKey({name:'RSA-OAEP',modulusLength:3072,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'}, true, ['encrypt','decrypt']);
  const publicKey = b64(new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey)));
  return {id:crypto.randomUUID(),publicKey,privateKey:await crypto.subtle.exportKey('jwk', pair.privateKey)};
}
export async function createRoomKey() { const raw = crypto.getRandomValues(new Uint8Array(32)); return {id:await digest(raw),raw:b64(raw)}; }
export async function wrapRoomKey(key, recipient) {
  const pub = await crypto.subtle.importKey('spki', unb64(recipient.publicKey), {name:'RSA-OAEP',hash:'SHA-256'}, false, ['encrypt']);
  return b64(new Uint8Array(await crypto.subtle.encrypt({name:'RSA-OAEP',label:bytes(['wanwu-im-key',1,key.id,recipient.id])}, pub, unb64(key.raw))));
}
export async function unwrapRoomKey(id, wrapped, identity) {
  const priv = await crypto.subtle.importKey('jwk', identity.privateKey, {name:'RSA-OAEP',hash:'SHA-256'}, false, ['decrypt']);
  const raw = new Uint8Array(await crypto.subtle.decrypt({name:'RSA-OAEP',label:bytes(['wanwu-im-key',1,id,identity.id])}, priv, unb64(wrapped)));
  if (raw.length !== 32 || await digest(raw) !== id) throw Error('Invalid chat key');
  return {id,raw:b64(raw)};
}
export async function seal(key, context, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aes = await crypto.subtle.importKey('raw', unb64(key.raw), 'AES-GCM', false, ['encrypt']);
  const data = await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:bytes(['wanwu-im',1,key.id,...context]),tagLength:128}, aes, bytes(value));
  return {v:1,keyId:key.id,iv:b64(iv),data:b64(new Uint8Array(data))};
}
export async function open(key, context, envelope) {
  if (envelope?.v !== 1 || envelope.keyId !== key.id || unb64(envelope.iv).length !== 12) throw Error('Invalid encrypted chat message');
  const aes = await crypto.subtle.importKey('raw', unb64(key.raw), 'AES-GCM', false, ['decrypt']);
  return JSON.parse(dec.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(envelope.iv),additionalData:bytes(['wanwu-im',1,key.id,...context]),tagLength:128}, aes, unb64(envelope.data))));
}

// Storage is account+origin scoped. Native callers store this document using
// Electron safeStorage; Web callers use their origin's IndexedDB.
export class ChatKeyring {
  constructor({load,save,request}) { this.load=load;this.save=save;this.request=request;this.pending=new Map(); }
  async identity() {
    if (!this.ready) this.ready=(async()=>{this.state=await this.load()||{keys:{}};if(!this.state.identity){this.state.identity=await createIdentity();await this.save(this.state);}return this.state.identity;})().catch(e=>{this.ready=null;throw e;});
    return this.ready;
  }
  sync(projectId) {
    if(this.pending.has(projectId)) return this.pending.get(projectId);
    const task=this.synchronize(projectId).finally(()=>this.pending.delete(projectId));this.pending.set(projectId,task);return task;
  }
  async synchronize(projectId) {
    const identity=await this.identity(),base=`/projects/${projectId}/chat-keys`;
    await this.request(base+'/clients','POST',{id:identity.id,publicKey:identity.publicKey});
    let room=await this.request(base+`?clientId=${identity.id}`);
    this.state.keys[projectId]||={}; const keys=this.state.keys[projectId];
    for(const envelope of room.envelopes) if(!keys[envelope.keyId]) keys[envelope.keyId]=await unwrapRoomKey(envelope.keyId,envelope.wrapped,identity);
    await this.save(this.state);
    if(!room.active){
      const key=await createRoomKey();
      // Persist before publishing: a lost HTTP acknowledgement must not lose
      // the only decrypting copy. The server arbitrates simultaneous creators.
      keys[key.id]=key;await this.save(this.state);
      const envelopes=await Promise.all(room.clients.map(async c=>({clientId:c.id,wrapped:await wrapRoomKey(key,c)})));
      try{await this.request(base,'POST',{epoch:room.epoch,keyId:key.id,envelopes});}catch(e){if(e.status!==409)throw e;}
      room=await this.request(base+`?clientId=${identity.id}`);
      for(const envelope of room.envelopes)if(!keys[envelope.keyId])keys[envelope.keyId]=await unwrapRoomKey(envelope.keyId,envelope.wrapped,identity);
      await this.save(this.state);
    }
    const shares=[];
    for(const need of room.missing){const key=keys[need.keyId],recipient=room.clients.find(c=>c.id===need.clientId);if(key&&recipient)shares.push({keyId:key.id,clientId:recipient.id,wrapped:await wrapRoomKey(key,recipient)});}
    for(let offset=0;offset<shares.length;offset+=1000)await this.request(base+'/shares','POST',{epoch:room.epoch,clientId:identity.id,envelopes:shares.slice(offset,offset+1000)});
    this.active||={};this.active[projectId]=room.active;
    return {ready:!!keys[room.active],active:room.active};
  }
  async key(projectId,id) {
    await this.identity();
    if(!id || !this.state.keys[projectId]?.[id])await this.sync(projectId);
    const key=this.state.keys[projectId]?.[id||this.active?.[projectId]];
    if(!key)throw Object.assign(Error('正在从团队设备同步聊天密钥 / Waiting for a team device to sync chat keys'),{code:'CHAT_KEY_PENDING'});
    return key;
  }
  async encrypt(projectId,context,value){
    // A just-registered client may need one background handoff from a peer.
    // Keep the user's send pending rather than asking them to retry manually.
    const deadline=Date.now()+20000;
    for(;;){try{return await seal(await this.key(projectId),[projectId,...context],value);}catch(e){if(Date.now()>=deadline||!(e.code==='CHAT_KEY_PENDING'||e.status===409||e.message==='Chat key storage changed; retry'))throw e;await new Promise(r=>setTimeout(r,750));}}
  }
  async decrypt(projectId,context,envelope){return open(await this.key(projectId,envelope.keyId),[projectId,...context],envelope);}
}
