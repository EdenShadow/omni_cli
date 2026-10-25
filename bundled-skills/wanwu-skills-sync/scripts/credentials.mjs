import path from 'node:path';
import {execFile} from 'node:child_process';
import {resolveContext} from './runtime.mjs';

// Import this helper from a skill script. Credential values stay in process memory;
// the CLI intentionally exposes only status or runs a child with declared env names.
export async function resolveSkillCredentials({skill,dependency,entryId,...options}){
  const resolved=await resolveContext(options);
  if(resolved.selection)throw Error('请先选择当前技能所属项目 / Select the skill project first');
  const {context}=resolved,url=new URL(context.url);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.pathname!=='/skills'||url.username||url.password||url.search||url.hash||typeof context.token!=='string'||!context.token)throw Error('Invalid Wanwu runtime context');
  const request=async body=>{
    const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+context.token},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(30000)});
    const result=await response.json();if(!response.ok)throw Error(result.error||'Cannot read the team key library');return result;
  };
  if(options.project){const current=await request({action:'context',detail:'summary'});if(![current.project?.id,current.project?.name].includes(options.project))throw Error('Project differs from the active scope');}
  return request({action:'credentials-resolve',skill,dependency,entryId});
}
export async function runWithCredentials(request,{skill,dependency,entryId,contextFile},plan){
  if(!plan||typeof plan.command!=='string'||!path.isAbsolute(plan.command)||!Array.isArray(plan.args)||plan.args.length>100||plan.args.some(a=>typeof a!=='string'||a.length>32768)||typeof plan.cwd!=='string'||!path.isAbsolute(plan.cwd))throw Error('执行计划需要绝对路径 command、cwd 和字符串数组 args');
  const result=await request({action:'credentials-resolve',skill,dependency,entryId});
  if(result.status!=='ready')return result;
  const env=result.env||{};if(!Object.keys(env).length)throw Error('技能未声明环境变量，请用 resolveSkillCredentials 在脚本内读取');
  if(Object.keys(env).some(k=>!/^[A-Z][A-Z0-9_]{0,99}$/.test(k)||/^(?:PATH|PATHEXT|COMSPEC|SHELL|BASH_ENV|ENV|NODE_OPTIONS|NODE_PATH|PYTHONPATH|PYTHONHOME|RUBYOPT|PERL5OPT|SSLKEYLOGFILE|LD_.*|DYLD_.*|GIT_CONFIG.*)$/.test(k)))throw Error('凭据声明不能覆盖运行环境控制变量');
  const secrets=Object.values(result.values||{}).filter(v=>typeof v==='string'&&v).sort((a,b)=>b.length-a.length);
  const redact=text=>secrets.reduce((out,secret)=>out.split(secret).join('[redacted]'),String(text||''));
  return new Promise(resolve=>execFile(plan.command,plan.args,{cwd:plan.cwd,env:{...process.env,...env,...(contextFile?{WANWU_CONTEXT_FILE:contextFile}:{})},shell:false,windowsHide:true,timeout:300000,maxBuffer:2*1024*1024},(error,stdout,stderr)=>resolve({status:error?'failed':'completed',exitCode:error?typeof error.code==='number'?error.code:1:0,stdout:redact(stdout),stderr:redact(stderr),...(error?{message:'Credential-backed command did not complete successfully'}:{})})));
}
