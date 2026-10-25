import {z} from 'zod';

export const CREDENTIAL_MANIFEST = 'wanwu.credentials.json';
const id=z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
const label=z.string().trim().min(1).max(100);
const field=z.object({id,label,secret:z.boolean().default(true),required:z.boolean().default(true),env:z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/).optional()}).strict();
const dependency=z.object({id,label,description:z.string().max(1000).optional(),setupUrl:z.string().url().max(1000).refine(v=>{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password;}).optional(),fields:z.array(field).min(1).max(20)}).strict();
const manifest=z.object({schemaVersion:z.literal(1),skill:z.string(),credentials:z.array(dependency).max(20)}).strict();
export function validateCredentialManifest(input,name){
  let result;try{result=manifest.parse(input);}catch{throw Error('凭据依赖声明无效：请检查 wanwu.credentials.json，只填写字段定义，不填写密钥值');}
  if(result.skill!==name)throw Error('凭据依赖声明的 skill 必须与技能名称一致');
  if(new Set(result.credentials.map(d=>d.id)).size!==result.credentials.length)throw Error('凭据依赖 ID 不能重复');
  for(const d of result.credentials){
    if(new Set(d.fields.map(f=>f.id)).size!==d.fields.length)throw Error('凭据字段 ID 不能重复');
    const env=d.fields.filter(f=>f.env).map(f=>f.env);if(new Set(env).size!==env.length)throw Error('凭据环境变量不能重复');
  }
  return result;
}
export function skillCredentialManifest(pkg){
  const file=pkg.files.find(f=>f.path.toLowerCase()===CREDENTIAL_MANIFEST);
  if(!file)return {schemaVersion:1,skill:pkg.name,credentials:[]};
  if(file.path!==CREDENTIAL_MANIFEST||file.data.length>65536)throw Error('凭据依赖声明文件名称或大小无效');
  let input;try{input=JSON.parse(Buffer.from(file.data,'base64').toString('utf8'));}catch{throw Error('wanwu.credentials.json 必须是有效 JSON');}
  return validateCredentialManifest(input,pkg.name);
}
// Text shown to the skill author, never populated with credential values.
export const skillCredentialBrief=`Declare credential dependencies yourself in wanwu.credentials.json: {"schemaVersion":1,"skill":"<the exact skill name>","credentials":[{"id":"service","label":"Service account","fields":[{"id":"api_key","label":"API Key","secret":true,"required":true,"env":"SERVICE_API_KEY"}]}]}. Declare all API keys, account/password pairs and user IDs actually needed; use credentials: [] when none are needed. Only definitions belong in this file, never real values, defaults or example secrets. In SKILL.md explain that before using each dependency the skill must resolve it from the current team's Wanwu key library using wanwu-skills-sync/scripts/credentials.mjs (resolveSkillCredentials), or credentials-run via sync.mjs for env-based scripts. Resolve afresh for each execution under the current request initiator's scope. Use their personal selection; otherwise the server picks the earliest accessible set. Keep paired fields (such as user ID and API key) in one dependency. Never cache plaintext across tasks, use the executing device owner's credentials, or override the chosen entry unless the user explicitly requests it. If a selected entry is revoked or removed, stop and ask them to choose again; never silently fall back to a different account. A missing dependency returns setup-required; follow the skill's setup instructions, and do not treat access errors or service outages as permission to register another account. Document any registration procedure and respect the user's authorization for it.`;
