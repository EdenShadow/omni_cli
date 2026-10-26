import fs from 'node:fs';
import path from 'node:path';
import {createRequest} from './api.mjs';
// Metadata/chat commands can coexist with the device daemon without writing
// its state. Refuse continued access after local logout/account replacement.
export function accountRequest(state,signal){
  if(!state.store.token||!state.store.userId)throw Error('请先运行 omni login / Sign in first');
  const raw=createRequest(state.store,fetch,{signal});
  return async(...args)=>{
    signal?.throwIfAborted();
    const file=path.join(state.directory,'state.json');
    if(fs.lstatSync(file).isSymbolicLink())throw Error('State file must not be a link');
    const current=JSON.parse(fs.readFileSync(file,'utf8'));
    if(current.token!==state.store.token||current.userId!==state.store.userId||current.endpoint!==state.store.endpoint)throw Error('Login changed; restart the command');
    return raw(...args);
  };
}
