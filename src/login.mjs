import {createRequest,DEFAULT_ENDPOINT,endpoint} from './api.mjs';
import {ask,password} from './prompts.mjs';
export async function login(state){
  const {store,save}=state;
  const proposed=endpoint(process.env.OMNI_SERVER_URL||store.endpoint||DEFAULT_ENDPOINT);
  if(store.token&&store.endpoint!==proposed)throw Error('先 logout 再更换服务器 / Log out before changing server');
  store.endpoint=proposed;
  console.log('服务器 / Server: '+store.endpoint);
  const username=await ask('万物账号 / Username');
  let secret=await password();
  let result;try{result=await createRequest(store)('/api/auth/login','POST',{username,password:secret,installation:store.installation,machineKey:store.machineKey});}finally{secret='';}
  if(store.userId&&store.userId!==result.user.id)throw Error('请先 logout 再切换账号 / Log out before switching accounts');
  store.token=result.token;store.userId=result.user.id;store.username=result.user.username||username;
  if(result.deviceBinding){store.installation=result.deviceBinding.installation||store.installation;store.device=result.deviceBinding.device;store.deviceToken=result.deviceBinding.deviceToken;}
  save();console.log('已登录 / Signed in: '+store.username);
}
