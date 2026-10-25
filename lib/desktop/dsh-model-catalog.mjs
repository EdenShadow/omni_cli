import {isDeepStrictEqual} from 'node:util';

// Preserve distinct routes even when profiles reuse the same provider ID.
// Never combine endpoints, credential references or conflicting model options.
export function mergeDshModelProviders(base,profiles){
  const providers=structuredClone(base||{});
  for(const {source,providers:incoming} of profiles||[]){
    for(const [id,provider] of Object.entries(incoming||{})){
      if(!provider||typeof provider!=='object'||!Array.isArray(provider.models))continue;
      if(Object.hasOwn(providers,id)&&isDeepStrictEqual(providers[id],provider))continue;
      let key=id,value=structuredClone(provider);
      if(Object.hasOwn(providers,key)){
        const prefix=`wanwu-${source}-${id}`;key=prefix;
        let suffix=2;while(Object.hasOwn(providers,key))key=`${prefix}-${suffix++}`;
        value.displayName=`${provider.displayName||id} (${source})`;
      }
      Object.defineProperty(providers,key,{value,enumerable:true,writable:true,configurable:true});
    }
  }
  return providers;
}
