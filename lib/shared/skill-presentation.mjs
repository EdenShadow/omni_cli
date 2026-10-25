import {parse as parseYaml} from 'yaml';
import {validSkillPath,sha256,validateSkillPackage} from './skill-package.mjs';
import {generatedSkillIcon,isLegacyGeneratedSkillIcon} from './skill-icon-art.mjs';
import {isOfficialSkill} from './official-skills.mjs';
export {generatedSkillIcon} from './skill-icon-art.mjs';

const palettes=[['#ece6fa','#765cbe'],['#e1f0e9','#40816a'],['#f9e9d8','#b6793c'],['#e5edf8','#527aac'],['#f5e1e8','#ae6482']];
export function skillAppearance(name){
  const index=name==='office-character-studio'?0:name==='office-space-designer'?1:parseInt(sha256(name).slice(0,8),16)%palettes.length;
  return {background:palettes[index][0],foreground:palettes[index][1],initial:Array.from(name.trim())[0]?.toLocaleUpperCase()||'S'};
}
function iconUri(file){
  if(!file||typeof file.data!=='string')return null;
  const bytes=Buffer.from(file.data,'base64');if(bytes.length>96*1024)return null;
  let mime;
  if(file.path.endsWith('.svg')){
    const svg=bytes.toString('utf8').replace(/^\s*<\?xml[^?]*\?>/,'');
    // Display only self-contained SVG drawings in an image context, never inline HTML.
    if(!/<svg[\s>]/i.test(svg)||/<(?:script|foreignObject|image|use|a|style|animate\w*|set)\b|\bon\w+\s*=|\b(?:href|src)\s*=|url\s*\(|<!ENTITY|<!DOCTYPE|<\?/i.test(svg))return null;
    mime='image/svg+xml';
  }else if(file.path.endsWith('.png')&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))mime='image/png';
  else if(/\.jpe?g$/.test(file.path)&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)mime='image/jpeg';
  else if(file.path.endsWith('.webp')&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')mime='image/webp';
  return mime?`data:${mime};base64,${file.data}`:null;
}
export function skillPresentation(pkg){
  const text=p=>{const f=pkg.files.find(f=>f.path===p);return f?Buffer.from(f.data,'base64').toString('utf8'):'';};
  let iface={},meta={};
  try{iface=parseYaml(text('agents/openai.yaml'),{maxAliasCount:0})?.interface||{};}catch{}
  try{meta=parseYaml(text('SKILL.md').match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1]||'',{maxAliasCount:0})||{};}catch{}
  const displayName=[iface.display_name,meta.display_name,meta.metadata?.display_name,pkg.name].find(v=>typeof v==='string'&&v.trim())?.trim().slice(0,80)||pkg.name;
  const candidates=[iface.icon_large,iface.icon_small,meta.metadata?.icon,'assets/skill-icon.svg','assets/icon.svg','icon.svg','assets/icon.png','icon.png','assets/icon.webp','icon.webp'];
  let icon=null;
  for(const value of candidates){if(typeof value!=='string')continue;const p=value.replace(/^\.\//,'');if(!validSkillPath(p))continue;icon=iconUri(pkg.files.find(f=>f.path===p));if(icon)break;}
  return {displayName,icon,...skillAppearance(displayName)};
}

export function withGeneratedSkillIcon(input){
  const pkg=validateSkillPackage(input).package;
  const presentation=skillPresentation(pkg);
  if(presentation.icon)return pkg;
  const bytes=Buffer.from(generatedSkillIcon(pkg.name,`${presentation.displayName} ${pkg.description}`)),file={path:'assets/skill-icon.svg',mode:0o644,data:bytes.toString('base64'),sha256:sha256(bytes)};
  return validateSkillPackage({...pkg,sha256:undefined,files:[...pkg.files.filter(f=>f.path!==file.path),file]}).package;
}

// Upgrade display metadata without rewriting immutable packages or installed files.
export function currentSkillPresentation(presentation,name,description=''){
  if(isOfficialSkill(name))return presentation;
  const icon=presentation?.icon;
  const legacy=typeof icon==='string'&&icon.startsWith('data:image/svg+xml;base64,')&&icon.length<140000&&isLegacyGeneratedSkillIcon(Buffer.from(icon.slice(26),'base64').toString('utf8'),name);
  if(icon&&!legacy)return presentation;
  const displayName=presentation?.displayName||name;
  return {...skillAppearance(displayName),...presentation,displayName,icon:`data:image/svg+xml;base64,${Buffer.from(generatedSkillIcon(name,`${displayName} ${description}`)).toString('base64')}`};
}
