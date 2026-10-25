import {createHash} from 'node:crypto';
import {parse as parseYaml} from 'yaml';
import {skillUiManifest} from './skill-ui.mjs';
import {skillCredentialManifest} from './skill-credentials.mjs';
export const SKILL_BUCKET = 'wanwu-1465647384';
export const MAX_SKILL_BYTES = 1000 * 1024 * 1024;
export const MAX_INLINE_SKILL_BYTES = 16 * 1024 * 1024;
export const SKILL_METADATA_PATHS=['SKILL.md','wanwu.ui.json','wanwu.credentials.json','agents/openai.yaml'];
// Leave room for metadata while retaining small custom artwork in the manifest.
export function inlineSkillPaths(entries){
  const selected=new Set(SKILL_METADATA_PATHS);let budget=12*1024*1024-4096;
  for(const f of [...entries].sort((a,b)=>Number(/\.(svg|png|jpe?g|webp)$/.test(b.path))-Number(/\.(svg|png|jpe?g|webp)$/.test(a.path)))){
    if(selected.has(f.path))continue;
    if(f.size<=96*1024&&f.size<=budget){selected.add(f.path);budget-=f.size;}
  }
  return selected;
}
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const validSkillName = name => typeof name === 'string' && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name) && name.length <= 64;
export const validSkillVersion = v => typeof v === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(v) && v.length < 40;
export function validSkillPath(name) {
  return typeof name === 'string' && name.length <= 240 && !name.includes('\\') && !name.includes('\0') &&
    name.split('/').every(p=>p && p!=='.' && p!=='..' && !p.startsWith('.') && !/[<>:"|?*\x00-\x1f]|[. ]$/.test(p) && !['node_modules','dist','release','__pycache__'].includes(p)) &&
    !/\.(pem|key|p12|pfx|sqlite|db|pyc|pyo)$/i.test(name) && !/^(?:[a-z]:|\/)/i.test(name);
}
export function skillMetadata(markdown) {
  const header=markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if(!header) throw Error('SKILL.md 缺少 YAML 元信息');
  const info=parseYaml(header[1],{maxAliasCount:0});
  if(!validSkillName(info?.name) || typeof info?.description!=='string' || !info.description.trim()) throw Error('SKILL.md 必须包含有效的 name 和 description');
  return {name:info.name,description:info.description.trim().slice(0,2000)};
}
export function validateSkillPackage(input) {
  if(![1,2].includes(input?.schemaVersion) || !validSkillName(input.name) || !validSkillVersion(input.version)) throw Error('技能名称或版本无效，版本格式为 1.0.0');
  if(!Array.isArray(input.files)||!input.files.length||input.files.length>512) throw Error('技能文件数量须为 1–512');
  let total=0,inline=0;const seen=new Set();
  const files=input.files.map(f=>{
    if(!validSkillPath(f.path) || seen.has(f.path.toLowerCase())) throw Error('技能路径无效或重复');
    seen.add(f.path.toLowerCase());
    if(input.schemaVersion===2&&f.data===undefined){
      if(!Number.isSafeInteger(f.size)||f.size<1||!Array.isArray(f.chunks)||f.chunks.length!==Math.ceil(f.size/(4*1024*1024))||!/^[a-f0-9]{64}$/.test(f.sha256)||![0o644,0o755].includes(f.mode))throw Error('技能资源描述无效');
      if(['SKILL.md','wanwu.ui.json','wanwu.credentials.json','agents/openai.yaml'].includes(f.path))throw Error('技能元信息必须内嵌');
      total+=f.size;if(total>MAX_SKILL_BYTES)throw Error('技能总大小不能超过 1000 MB');
      const chunks=f.chunks.map((c,i)=>{if(!/^[a-f0-9]{64}$/.test(c?.sha256)||c.size!==Math.min(4*1024*1024,f.size-i*4*1024*1024))throw Error('技能资源分块无效');return {sha256:c.sha256,size:c.size};});
      return {path:f.path,mode:f.mode,sha256:f.sha256,size:f.size,chunks};
    }
    if(typeof f.data!=='string'||f.data.length>8*1024*1024) throw Error('技能文件编码或大小无效');
    const bytes=Buffer.from(f.data,'base64');total+=bytes.length;inline+=bytes.length;
    if(bytes.toString('base64')!==f.data)throw Error('技能文件编码无效');
    if(total>MAX_SKILL_BYTES) throw Error('技能总大小不能超过 1000 MB');
    if(inline>MAX_INLINE_SKILL_BYTES)throw Error('大技能包请使用分块上传 / Use chunked skill upload');
    if(sha256(bytes)!==f.sha256) throw Error('技能文件校验失败：'+f.path);
    if(![0o644,0o755].includes(f.mode)) throw Error('技能文件权限无效');
    return {path:f.path,mode:f.mode,sha256:f.sha256,data:f.data};
  }).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  for(const file of files) if(files.some(other=>other.path.toLowerCase().startsWith(file.path.toLowerCase()+'/'))) throw Error('技能文件与目录冲突');
  const entry=files.find(f=>f.path==='SKILL.md');if(!entry) throw Error('技能必须包含 SKILL.md');
  const meta=skillMetadata(Buffer.from(entry.data,'base64').toString('utf8'));
  if(meta.name!==input.name) throw Error('技能名称与 SKILL.md 不一致');
  const content={schemaVersion:input.schemaVersion,name:input.name,version:input.version,description:meta.description,files};
  skillCredentialManifest(content);
  skillUiManifest(content);
  const bytes=Buffer.from(JSON.stringify(content));const digest=sha256(bytes);
  if(input.sha256 && input.sha256!==digest) throw Error('技能包完整性校验失败');
  return {package:{...content,sha256:digest},bytes,sha256:digest,size:total};
}
export function compareSkillVersions(a,b) {
  const av=a.split('.').map(Number),bv=b.split('.').map(Number);
  for(let i=0;i<3;i++) if(av[i]!==bv[i]) return av[i]-bv[i];return 0;
}
