// Credentials stay in the main process. Recover only the authenticated account's
// exact installation, including legacy states that retained login but not binding.
export function createBindingRecovery({store,request,save,notify,isCurrent,evidence=()=>({}),now=Date.now}) {
  let pending, checkedToken, checkedDeviceToken, checkedAt=0;
  let failedToken, failure, retryAt=0, failures=0;
  return function recover(force=false) {
    if(!isCurrent()||!store.token||!store.installation)return Promise.resolve();
    if(pending)return pending;
    if(failedToken===store.token&&now()<retryAt)return Promise.reject(failure);
    if(failedToken!==store.token){failedToken=undefined;failure=undefined;retryAt=0;failures=0;}
    // Validate cached bindings once per startup. A negative lookup is temporary:
    // a later server recovery or restored backup must work without another login.
    if(!force&&checkedToken===store.token&&checkedDeviceToken===store.deviceToken
      &&(store.deviceToken||now()-checkedAt<30_000))return Promise.resolve();
    const token=store.token,userId=store.userId,installation=store.installation;
    const current=()=>isCurrent()&&store.token===token&&store.userId===userId&&store.installation===installation;
    const job=(async()=>{
      const result=await request('/api/devices/restore','POST',{installation,installations:store.installationCandidates,machineKey:store.machineKey,...evidence()});
      if(!current())return;
      const binding=result.deviceBinding;
      if(binding&&(binding.device?.userId!==userId||!binding.deviceToken))throw Error('设备绑定与当前账号不匹配');
      store.device=binding?.device||null;
      store.deviceToken=binding?.deviceToken||null;
      if(binding?.installation){
        store.installation=binding.installation;
        store.installationCandidates=[...new Set([binding.installation,installation,...(store.installationCandidates||[])])].slice(0,16);
      }
      save();checkedToken=token;checkedDeviceToken=store.deviceToken;checkedAt=now();
      notify({type:'device-binding',device:store.device});
      failedToken=undefined;failure=undefined;retryAt=0;failures=0;
    })().catch(error=>{
      if(current()){
        failedToken=token;failure=error;failures++;
        // Force/reconnect must not bypass a rejected login or server cooldown.
        // A new login token immediately permits recovery again.
        retryAt=error.status===401||error.status===403||error.status===423?Infinity:
          now()+(error.status===429?Math.max(60,Number(error.retryAfter)||900)*1000:Math.min(300_000,5000*2**Math.min(failures-1,6)));
      }
      throw error;
    }).finally(()=>{if(pending===job)pending=null;});
    pending=job;return job;
  };
}
