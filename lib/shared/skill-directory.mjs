import {readFileSync,readdirSync,lstatSync} from 'node:fs';
import path from 'node:path';
import {skillFileReference} from './skill-blobs.mjs';
import {validateSkillPackage,skillMetadata,validSkillPath,sha256,MAX_SKILL_BYTES,inlineSkillPaths} from './skill-package.mjs';
export function packageSkillDirectory(directory,version) {
  const files=[],entries=[];let total=0;
  function walk(root,prefix=''){
    for(const entry of readdirSync(root,{withFileTypes:true})){
      if(['.DS_Store','.git','.gitignore','.wanwu-skill.json','__pycache__'].includes(entry.name)||/\.py[co]$/i.test(entry.name))continue;
      const relative=prefix+entry.name;if(!validSkillPath(relative))throw Error('不支持发布这个文件或目录：'+relative);
      const target=path.join(root,entry.name),stat=lstatSync(target);
      if(stat.isSymbolicLink())throw Error('技能包不能包含符号链接：'+relative);
      if(stat.isDirectory())walk(target,relative+'/');
      else if(stat.isFile()){
        total+=stat.size;if(total>MAX_SKILL_BYTES)throw Error('技能总大小不能超过 1000 MB');
        entries.push({target,relative,stat});if(entries.length>512)throw Error('技能文件过多');
      } else throw Error('技能只支持普通文件');
    }
  }
  if(lstatSync(directory).isSymbolicLink())throw Error('请选择实际技能目录');
  walk(directory);
  const large=total>16*1024*1024||entries.some(e=>e.stat.size>6*1024*1024);
  const inline=inlineSkillPaths(entries.map(e=>({path:e.relative,size:e.stat.size})));
  for(const {target,relative,stat} of entries){
    const meta=['SKILL.md','wanwu.ui.json','wanwu.credentials.json','agents/openai.yaml'].includes(relative);
    if(meta&&stat.size>1024*1024)throw Error('技能元信息最多 1 MB：'+relative);
    const file={path:relative,mode:stat.mode&0o111?0o755:0o644};
    if(large&&!inline.has(relative))files.push({...file,...skillFileReference(target)});
    else{const bytes=readFileSync(target);files.push({...file,data:bytes.toString('base64'),sha256:sha256(bytes)});}
  }
  const entry=files.find(f=>f.path==='SKILL.md');if(!entry)throw Error('请选择包含 SKILL.md 的技能目录');
  const meta=skillMetadata(Buffer.from(entry.data,'base64').toString());
  return validateSkillPackage({schemaVersion:large?2:1,name:meta.name,version,files}).package;
}
