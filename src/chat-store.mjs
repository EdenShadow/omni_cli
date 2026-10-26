import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {privateDirectory,lock} from './state.mjs';
import {ChatKeyring} from '../lib/shared/chat-crypto.mjs';

export const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function chatStore(state,request,signal){
  const root=privateDirectory(path.join(state.directory,'chat'));
  const directory=privateDirectory(path.join(root,fingerprint([state.store.endpoint,state.store.userId])));
  function read(name){
    const file=path.join(directory,name);
    if(!fs.existsSync(file))return undefined;
    if(fs.lstatSync(file).isSymbolicLink())throw Error('Chat state must not be a link');
    return JSON.parse(fs.readFileSync(file,'utf8'));
  }
  function write(name,value){
    const temporary=path.join(directory,randomUUID()+'.tmp');
    try{fs.writeFileSync(temporary,JSON.stringify(value),{flag:'wx',mode:0o600});fs.renameSync(temporary,path.join(directory,name));}
    finally{fs.rmSync(temporary,{force:true});}
  }
  // A separate lock allows chat commands alongside the device daemon. Each
  // operation reloads keys under the lock, so parallel processes cannot replace
  // the identity or drop keys learned by another process.
  async function exclusive(operation){
    const deadline=Date.now()+70000;
    let release;
    while(!release){
      signal?.throwIfAborted();
      try{release=lock(directory);}catch(e){if(!e.message.includes('already running')||Date.now()>deadline)throw e;await delay(100,undefined,{signal});}
    }
    try{
      const ring=new ChatKeyring({load:async()=>read('keys.json'),save:async value=>write('keys.json',value),request:(p,...args)=>request('/api'+p,...args)});
      return await operation({ring,read,write});
    }finally{release();}
  }
  return {exclusive,directory};
}
