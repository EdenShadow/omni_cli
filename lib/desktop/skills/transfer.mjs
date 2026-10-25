import {hasSkillBlob,readSkillBlob,saveSkillBlob} from '../../shared/skill-blobs.mjs';
import {readCdn} from '../cdn-download.mjs';
const chunks=pkg=>[...new Map(pkg.files.flatMap(f=>f.chunks||[]).map(c=>[c.sha256,c])).values()];
async function retry(work){let error;for(let i=0;i<3;i++){try{return await work();}catch(e){error=e;if(e.status&&e.status<500&&![408,429].includes(e.status))throw e;if(i<2)await new Promise(r=>setTimeout(r,500*(i+1)));}}throw error;}
export async function uploadSkillBlobs(pkg,request){for(const chunk of chunks(pkg))await retry(async()=>{const status=await request(chunk.sha256);if(status.present&&status.size===chunk.size)return;await request(chunk.sha256,{data:readSkillBlob(chunk).toString('base64')});});}
export async function downloadSkillBlobs(pkg,request){for(const chunk of chunks(pkg)){if(hasSkillBlob(chunk))continue;await retry(async()=>{const result=await request(chunk.sha256),bytes=result.download?await readCdn(result.download,{sha256:chunk.sha256,size:chunk.size,maxBytes:4*1024*1024}):Buffer.from(result.data,'base64');const saved=saveSkillBlob(bytes);if(saved.sha256!==chunk.sha256||saved.size!==chunk.size)throw Error('技能资源下载校验失败');});}}
