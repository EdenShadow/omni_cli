import {createHash} from 'node:crypto';
import {mkdtemp,open,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {skillFileReference} from '../../shared/skill-blobs.mjs';
import {skillMetadata,validSkillPath,validateSkillPackage,MAX_SKILL_BYTES,sha256,inlineSkillPaths} from '../../shared/skill-package.mjs';
import {validateGithubSource} from '../../shared/github-skill-source.mjs';
const segment=encodeURIComponent;
export function parseGithubUrl(input) {
  let url;try{url=new URL(input);}catch{throw Error('请输入 GitHub 仓库或技能目录链接');}
  if(url.protocol!=='https:'||url.hostname!=='github.com'||url.port||url.username||url.password||url.search||url.hash)throw Error('请使用不含参数或凭据的 https://github.com 链接');
  const parts=url.pathname.replace(/\/$/,'').split('/').slice(1).map(decodeURIComponent);
  const [owner,rawRepo,kind,...tail]=parts,repo=rawRepo?.replace(/\.git$/,'');
  if(!/^[a-zA-Z0-9-]{1,100}$/.test(owner)||!/^[\w.-]{1,100}$/.test(repo)||['.','..'].includes(repo)||parts.some(p=>!p||p==='.'||p==='..'||/[\x00-\x1f\\]/.test(p)))throw Error('GitHub 链接格式无效');
  if(kind&&!['tree','blob'].includes(kind))throw Error('请使用仓库、目录或 SKILL.md 链接');
  if(kind&&!tail.length)throw Error('GitHub 链接缺少分支');
  if(kind==='blob'&&tail.at(-1)!=='SKILL.md')throw Error('请使用 SKILL.md 文件或其目录链接');
  if(tail.at(-1)==='SKILL.md')tail.pop();
  return {owner,repo,tail};
}
async function boundedBytes(response,limit) {
  if(Number(response.headers.get('content-length'))>limit)throw Error('GitHub 文件超过大小限制');
  const chunks=[];let total=0;
  try { for await(const chunk of response.body){total+=chunk.length;if(total>limit)throw Error('GitHub 文件超过大小限制');chunks.push(chunk);} }
  catch(e){await response.body?.cancel().catch(()=>{});throw e;}
  return Buffer.concat(chunks);
}
export class GithubSkills {
  constructor({fetchImpl=fetch}={}){this.fetch=fetchImpl;this.metadata=new Map();}
  beginCheck(){this.metadata.clear();}
  apiRead(url){
    const old=this.metadata.get(url);if(old&&Date.now()-old.at<60000)return old.promise;
    const promise=this.read(url);this.metadata.set(url,{promise,at:Date.now()});
    promise.catch(()=>this.metadata.delete(url));return promise;
  }
  async read(url,raw=false,limit=8*1024*1024) {
    const response=await this.fetch(url,{redirect:'error',signal:AbortSignal.timeout(25000),headers:raw?{}:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'Wanwu-AI'}});
    if(!response.ok)throw Object.assign(Error(response.status===404?'找不到公开仓库、分支或技能':response.status===403||response.status===429?'GitHub 请求受限，请稍后重试（已安装技能不受影响）':`GitHub 请求失败（${response.status}）`),{status:response.status});
    const bytes=await boundedBytes(response,limit);return raw?bytes:JSON.parse(bytes);
  }
  api(owner,repo,suffix=''){return `https://api.github.com/repos/${segment(owner)}/${segment(repo)}${suffix}`;}
  async resolve(input) {
    const {owner,repo,tail}=parseGithubUrl(input);let ref,directory='',commit;
    if(!tail.length){const meta=await this.apiRead(this.api(owner,repo));ref=meta.default_branch;commit=await this.apiRead(this.api(owner,repo,'/commits/'+segment(ref)));}
    else {
      // Resolve slash-containing branch names without guessing the skill folder boundary.
      for(let count=Math.min(tail.length,12);count>0;count--){
        ref=tail.slice(0,count).join('/');
        try{commit=await this.apiRead(this.api(owner,repo,'/commits/'+segment(ref)));directory=tail.slice(count).join('/');break;}
        catch(e){if(![404,422].includes(e.status))throw e;}
      }
      if(!commit)throw Error('找不到该 GitHub 分支或标签');
    }
    return {source:validateGithubSource({type:'github',owner,repo,ref,directory,commit:commit.sha}),tree:commit.commit.tree.sha};
  }
  async tree(source,rootTree) {
    let tree=rootTree;
    for(const part of source.directory.split('/').filter(Boolean)){
      const listing=await this.apiRead(this.api(source.owner,source.repo,'/git/trees/'+tree));
      const found=listing.tree.find(e=>e.path===part&&e.type==='tree');if(!found)throw Error('找不到技能目录');tree=found.sha;
    }
    const result=await this.apiRead(this.api(source.owner,source.repo,'/git/trees/'+tree+'?recursive=1'));
    if(result.truncated)throw Error('仓库目录过大，请粘贴更具体的技能目录链接');
    return result.tree;
  }
  async scan(url) {
    const {source,tree}=await this.resolve(url),entries=await this.tree(source,tree);
    const directories=entries.filter(e=>e.type==='blob'&&['100644','100755'].includes(e.mode)&&(e.path==='SKILL.md'||e.path.endsWith('/SKILL.md')))
      .map(e=>e.path==='SKILL.md'?'':e.path.slice(0,-9));
    if(!directories.length)throw Error('这个目录下没有找到 SKILL.md');
    if(directories.length>200)throw Error('技能超过 200 个，请选择更具体的目录链接');
    return {source,entries,directories};
  }
  async package(source,entries,version) {
    validateGithubSource(source);
    const files=entries.filter(e=>e.type!=='tree'&&!e.path.split('/').some(p=>['.git','.github','.gitignore','.gitattributes','.DS_Store','__pycache__','node_modules','dist','release'].includes(p))&&!/\.py[co]$/i.test(e.path));
    if(!files.length||files.length>512)throw Error('技能文件数量须为 1–512');
    let total=0;
    for(const f of files){
      if(f.type!=='blob'||!['100644','100755'].includes(f.mode))throw Error('GitHub 技能不能包含符号链接或子模块：'+f.path);
      if(!validSkillPath(f.path))throw Error('不支持导入文件：'+f.path);
      if(!Number.isSafeInteger(f.size)||f.size<0)throw Error('技能文件大小无效');total+=f.size;
      if(total>MAX_SKILL_BYTES)throw Error('技能总大小不能超过 1000 MB');
    }
    const large=total>16*1024*1024||files.some(f=>f.size>6*1024*1024);
    const inline=inlineSkillPaths(files);
    const downloaded=[];let next=0,bytesTotal=0;
    const results=await Promise.allSettled(Array.from({length:Math.min(4,files.length)},async()=>{
      while(next<files.length){const f=files[next++];
        const parts=[source.owner,source.repo,source.commit,...source.directory.split('/').filter(Boolean),...f.path.split('/')];
        const url='https://raw.githubusercontent.com/'+parts.map(segment).join('/');
        if(large&&!inline.has(f.path)){
          const dir=await mkdtemp(path.join(tmpdir(),'wanwu-skill-github-')),file=path.join(dir,'resource');
          try{const response=await this.fetch(url,{redirect:'error',signal:AbortSignal.timeout(1800000)});if(!response.ok)throw Error('GitHub 资源下载失败');
            const handle=await open(file,'wx'),hash=createHash('sha1').update(`blob ${f.size}\0`);let size=0;
            try{for await(const bytes of response.body){size+=bytes.length;if(size>f.size)throw Error('GitHub 资源大小变化');hash.update(bytes);await handle.writeFile(bytes);}}finally{await handle.close();}
            if(size!==f.size||hash.digest('hex')!==f.sha)throw Error('GitHub 文件校验失败：'+f.path);
            downloaded.push({path:f.path,mode:f.mode==='100755'?0o755:0o644,...skillFileReference(file)});
          }finally{if(path.dirname(dir)!==path.resolve(tmpdir())||!path.basename(dir).startsWith('wanwu-skill-github-'))throw Error('Invalid temporary directory');await rm(dir,{recursive:true,force:true});}continue;
        }
        const bytes=await this.read(url,true,large?1024*1024:6*1024*1024);
        bytesTotal+=bytes.length;if(bytesTotal>MAX_SKILL_BYTES)throw Error('技能总大小不能超过 1000 MB');
        const gitHash=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
        if(gitHash!==f.sha)throw Error('GitHub 文件校验失败：'+f.path);
        downloaded.push({path:f.path,mode:f.mode==='100755'?0o755:0o644,sha256:sha256(bytes),data:bytes.toString('base64')});
      }
    }));
    const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;
    const entry=downloaded.find(f=>f.path==='SKILL.md');if(!entry)throw Error('请选择一个包含 SKILL.md 的技能目录');
    const meta=skillMetadata(Buffer.from(entry.data,'base64').toString());
    return validateSkillPackage({schemaVersion:large?2:1,name:meta.name,version,files:downloaded}).package;
  }
  async update(source,version) {
    source=validateGithubSource(source);
    const commit=await this.apiRead(this.api(source.owner,source.repo,'/commits/'+segment(source.ref)));
    if(commit.sha===source.commit)return null;
    const next={...source,commit:commit.sha};
    return {source:next,package:await this.package(next,await this.tree(next,commit.commit.tree.sha),version)};
  }
}
