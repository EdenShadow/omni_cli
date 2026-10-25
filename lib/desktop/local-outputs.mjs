import path from 'node:path';
import os from 'node:os';
import {stat,lstat,realpath,open} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {createHash} from 'node:crypto';
import {ATTACHMENT_CHUNK_BYTES,MAX_CHAT_FILE_BYTES} from '../shared/chat-attachments.mjs';
import {fileURLToPath} from 'node:url';
import {isTextPreview,decodeTextPreview,TEXT_PREVIEW_BYTES} from '../shared/text-preview.mjs';

const types={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',avif:'image/avif',bmp:'image/bmp',mp4:'video/mp4',m4v:'video/mp4',mov:'video/quicktime',webm:'video/webm',mp3:'audio/mpeg',wav:'audio/wav',m4a:'audio/mp4',aac:'audio/aac',ogg:'audio/ogg',flac:'audio/flac',pdf:'application/pdf'};
const kindOf=ext=>types[ext]?.startsWith('image/')?'image':types[ext]?.startsWith('video/')?'video':types[ext]?.startsWith('audio/')?'audio':ext==='pdf'?'pdf':/^(xlsx?|csv|ods|numbers)$/.test(ext)?'sheet':/^(docx?|odt|rtf|txt|md)$/.test(ext)?'document':/^(pptx?|odp|key)$/.test(ext)?'slides':/^(zip|rar|7z|gz|tar)$/.test(ext)?'archive':'file';
function candidate(value,cwd){
  let p=String(value||'').trim().replace(/^<|>$/g,'').replace(/:\d+(?::\d+)?$/,'');
  if(p.length>4096||p.startsWith('//')||/[\x00-\x1f]/.test(p))return;
  try{if(p.startsWith('file:'))p=fileURLToPath(p);else p=decodeURIComponent(p);}catch{return;}
  if(/^[a-z][\w+.-]*:/i.test(p)&&!/^\w:[\\/]/.test(p))return;
  if(p.startsWith('~/'))p=path.join(os.homedir(),p.slice(2));
  if(!/\.[a-z0-9]{1,12}$/i.test(p))return;
  if(!path.isAbsolute(p)){if(!cwd||p.startsWith('-')||/[<>|\n]/.test(p))return;p=path.resolve(cwd,p);}
  if(p.split(/[\\/]/).some(s=>(s.startsWith('.')&&s!=='.'&&s!=='..')||['skill-contexts','node_modules'].includes(s))||/\.(pem|key|p12|pfx|keystore)$/i.test(p))return;
  return path.normalize(p);
}

// Only source-runtime output is accepted; renderer-supplied paths are never read.
export function outputReferences(item,cwd){
  if(!item||item.kind==='delta'||item.role==='user'||['failed','error','declined'].includes(item.status)||['reasoning','thinking','read','search','Read','Grep','Glob','WebSearch','WebFetch'].includes(item.activity||item.label))return [];
  if(item.kind!=='tool'&&!(item.kind==='message'&&item.role==='assistant'))return [];
  const found=new Set(),add=value=>{const p=candidate(value,cwd);if(p&&found.size<80)found.add(p);};
  for(const p of Array.isArray(item.paths)?item.paths:[])add(p);
  const text=[item.text,item.output,item.command].filter(s=>typeof s==='string').join('\n').slice(0,200000);
  for(const m of text.matchAll(/!?\[[^\]\n]*\]\((<[^>\n]+>|[^)\n]+)\)/g))add(m[1]);
  for(const m of text.matchAll(/(?:`([^`\n]+)`|"([^"\n]+)"|'([^'\n]+)')/g))add(m[1]||m[2]||m[3]);
  for(const m of text.matchAll(/(?<![\w:/])(?:file:\/\/\/|[a-zA-Z]:[\\/]|~\/|\/|\b(?:output|outputs|artifacts|deliverables)\/)[^\s"'`<>()[\]{},;]+\.[a-zA-Z0-9]{1,12}(?=\s|$|["'`<>()[\]{},;。])/g))add(m[0]);
  return [...found];
}
const generatedRoot=()=>path.resolve(process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),'generated_images');
const generatedImage=(value,root=generatedRoot())=>{
  if(typeof value!=='string'||!path.isAbsolute(value)||! /\.(png|jpe?g|webp)$/i.test(value))return false;
  const relative=path.relative(root,path.resolve(value));
  return !!relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&!relative.split(path.sep).some(p=>p.startsWith('.'));
};
const stamp=s=>`${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
// Presentation fingerprints are optional. Bound discovery IO and leave large
// images visible separately instead of delaying conversation history for them.
const fingerprintBudget=64*1024*1024;
const deadline=(promise,ms)=>{let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Preview timed out')),ms);})]).finally(()=>clearTimeout(timer));};

export class LocalOutputs {
  constructor(bridge){this.bridge=bridge;this.sessions=new Map();this.files=new Map();this.previews=new Map();this.hydrated=new Map();this.checks=new Map();this.generated=new Set();this.uploads=new Map();}
  record(sessionId,items){
    const cwd=this.bridge.mappings[sessionId]?.cwd;if(!cwd)return;
    let refs=this.sessions.get(sessionId);if(!refs){refs=new Map();this.sessions.set(sessionId,refs);}
    for(const item of items||[]) {
      const paths=outputReferences(item,cwd);
      if(item.activity==='imageGeneration'&&item.status==='completed')for(const p of item.paths||[])if(generatedImage(p)){this.generated.add(path.normalize(p));paths.push(path.normalize(p));}
      for(const p of paths){
      const sources=refs.get(p)||new Set();if(item.id)sources.add(String(item.id));
      refs.set(p,sources);while(refs.size>200)refs.delete(refs.keys().next().value);
    }
    }
    while(this.sessions.size>100)this.sessions.delete(this.sessions.keys().next().value);
  }
  context(){const s=this.bridge.store;return [s.endpoint,s.userId,s.token,s.device?.id].join('|');}
  async authorize(projectId,sessionId){
    if(!/^[a-f0-9-]{36}$/.test(projectId||'')||!/^[a-f0-9-]{36}$/.test(sessionId||''))throw Error('Invalid session');
    const b=this.bridge,m=b.mappings[sessionId],context=this.context();
    if(!b.store.token||!m||b.stopped)throw Error('Local session unavailable');
    const key=context+'|'+projectId;
    if(!this.checks.has(key))this.checks.set(key,Promise.resolve().then(()=>b.request(`/api/projects/${projectId}/snapshot`)).finally(()=>this.checks.delete(key)));
    const snapshot=await this.checks.get(key);
    const s=snapshot.sessions.find(s=>s.id===sessionId&&s.deviceId===b.store.device?.id);
    if(context!==this.context()||b.stopped||!s||!snapshot.devices.some(d=>d.id===s.deviceId)||s.localId!==m.localId||s.provider!==m.provider)throw Error('Local session unavailable');
    return {m,context};
  }
  async list({projectId,sessionId,hydrate=true}){
    const {m,context}=await this.authorize(projectId,sessionId);
    // Rehydrate once after a desktop restart; ordinary history paging also records references.
    if(hydrate&&!m.fresh&&!this.hydrated.has(sessionId)){
      this.hydrated.set(sessionId,true);
      try{const adapter=this.bridge.adapter(m.provider);if(m.provider==='claude')adapter.dirs.set(m.localId,m.cwd);const page=await deadline(adapter.historyPage(m.localId),10000);this.record(sessionId,page.items);}catch{this.hydrated.delete(sessionId);}
    }
    const result=[];let remaining=fingerprintBudget;
    for(const [p,sources] of this.sessions.get(sessionId)||[]){
      try{
        const actual=await realpath(p);
        const ordinary=candidate(p,m.cwd)&&candidate(actual,m.cwd)===actual;
        const generated=!ordinary&&this.generated.has(p)&&!(await lstat(p)).isSymbolicLink()&&generatedImage(actual,await realpath(generatedRoot()));
        if(!ordinary&&!generated)continue;
        const info=await stat(actual);if(!info.isFile())continue;
        let record=[...this.files.values()].find(f=>f.context===context&&f.sessionId===sessionId&&f.path===actual&&f.stamp===stamp(info));
        if(!record){record={id:createHash('sha256').update([projectId,sessionId,actual,stamp(info)].join('\0')).digest('hex'),sessionId,projectId,path:actual,stamp:stamp(info),context};this.files.set(record.id,record);}
        const name=path.basename(actual),ext=path.extname(name).slice(1).toLowerCase();
        let sha256;
        if(kindOf(ext)==='image'&&(record.fingerprint||info.size<=remaining)){
          if(!record.fingerprint)remaining-=info.size;
          try{sha256=await this.fingerprint(record);}catch{/* A fingerprint must never block an otherwise usable file entry. */}
        }
        result.push({id:record.id,name,path:actual,size:info.size,kind:kindOf(ext),mime:types[ext]||'application/octet-stream',sources:[...sources].slice(-200),...(sha256?{sha256}:{})});
      }catch{/* Missing or still-being-written output is not a usable attachment. */}
    }
    while(this.files.size>500){const id=this.files.keys().next().value;this.files.delete(id);this.previews.delete(id);}
    if(context!==this.context()||this.bridge.stopped)throw Error('Local session unavailable');
    return result;
  }
  async fingerprint(record){
    if(!record.fingerprint){
      record.fingerprint=(async()=>{
        const handle=await open(record.path,'r');
        try{
          if(stamp(await handle.stat())!==record.stamp)throw Error('File changed');
          const hash=createHash('sha256'),buffer=Buffer.alloc(128*1024);let offset=0;
          while(true){
            if(record.context!==this.context()||this.bridge.stopped)throw Error('File access changed');
            const {bytesRead}=await handle.read(buffer,0,buffer.length,offset);if(!bytesRead)break;
            offset+=bytesRead;if(offset>fingerprintBudget)throw Error('File grew beyond fingerprint budget');
            hash.update(buffer.subarray(0,bytesRead));
          }
          if(stamp(await handle.stat())!==record.stamp||await realpath(record.path)!==record.path||stamp(await stat(record.path))!==record.stamp)throw Error('File changed');
          return hash.digest('hex');
        }finally{await handle.close();}
      })().catch(error=>{delete record.fingerprint;throw error;});
    }
    return record.fingerprint;
  }
  async file(id){
    const f=this.files.get(id);if(!f||f.context!==this.context())throw Error('File unavailable');
    await this.authorize(f.projectId,f.sessionId);
    if(await realpath(f.path)!==f.path||stamp(await stat(f.path))!==f.stamp)throw Error('File changed; reopen the conversation');
    return f;
  }
  async preview(id){
    const f=await this.file(id);
    if(!this.previews.has(id)){
      const job=(async()=>{
        // Quick Look can return a large white system icon instead of content.
        // Archives, audio and unknown files use the renderer's file-type glyph.
        const kind=kindOf(path.extname(f.path).slice(1).toLowerCase());
        if(['archive','audio','file'].includes(kind)||isTextPreview(f.path))return {url:'',thumbnail:false};
        try{const image=await deadline(this.thumbnail(f.path),8000);if(image&&!image.isEmpty()){const {width,height}=image.getSize(),scale=Math.min(1,512/width,512/height);return {url:image.resize({width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale)),quality:'good'}).toDataURL(),thumbnail:true};}}catch{}
        // The renderer has file-type icons. Avoid getFileIcon: some macOS/Electron
        // versions crash inside that native API instead of rejecting the promise.
        return {url:'',thumbnail:false};
      })();
      this.previews.set(id,job);
      while(this.previews.size>40)this.previews.delete(this.previews.keys().next().value);
    }
    const result=await this.previews.get(id);
    if(f.context!==this.context()||this.bridge.stopped)throw Error('File unavailable');
    return result;
  }
  async textPreview(id){
    const f=await this.file(id);if(!isTextPreview(f.path))throw Error('TEXT_UNAVAILABLE');
    const handle=await open(f.path,'r');
    try{
      const info=await handle.stat();if(stamp(info)!==f.stamp)throw Error('File changed');
      const bytes=Buffer.alloc(Math.min(info.size,TEXT_PREVIEW_BYTES));let offset=0;
      while(offset<bytes.length){const read=await handle.read(bytes,offset,bytes.length-offset,offset);if(!read.bytesRead)throw Error('File changed');offset+=read.bytesRead;}
      if(stamp(await handle.stat())!==f.stamp)throw Error('File changed');
      await this.file(id);
      return decodeTextPreview(bytes,path.basename(f.path),info.size>TEXT_PREVIEW_BYTES);
    }finally{await handle.close();}
  }
  async uploadRequested(request){
    const {sessionId,projectId,outputId,requestId,provider,localId}=request;
    if(this.uploads.has(requestId))return this.uploads.get(requestId);
    const job=(async()=>{
      const b=this.bridge,context=this.context();let uploadId;
      const route=`/api/bridge/sessions/${sessionId}/outputs/${outputId}`;
      const current=()=>{if(context!==this.context()||b.stopped)throw Error('File access changed');};
      try{
        await b.resolveMapping(sessionId,provider,localId);current();
        const entries=await this.list({projectId,sessionId});current();
        const entry=entries.find(f=>f.id===outputId);if(!entry)throw Error('原文件已变化或不存在，请重新打开会话 / Source file changed or is missing');
        if(entry.size>MAX_CHAT_FILE_BYTES)throw Error('单个文件最多 500 MB / File can be up to 500 MB');
        const f=await this.file(outputId),handle=await open(f.path,'r');
        try{
          if(stamp(await handle.stat())!==f.stamp)throw Error('Source file changed');
          const upload=await b.request(`/api/projects/${projectId}/attachment-uploads`,'POST',{name:entry.name,mime:entry.mime,size:entry.size});uploadId=upload.id;current();
          const buffer=Buffer.alloc(Math.min(ATTACHMENT_CHUNK_BYTES,entry.size));let offset=0;
          while(offset<entry.size){
            current();const {bytesRead}=await handle.read(buffer,0,Math.min(buffer.length,entry.size-offset),offset);
            if(!bytesRead)throw Error('Source file changed');
            await b.request(`/api/projects/${projectId}/attachment-uploads/${uploadId}`,'PUT',{offset,data:buffer.subarray(0,bytesRead).toString('base64')});offset+=bytesRead;
          }
          current();if(stamp(await handle.stat())!==f.stamp)throw Error('Source file changed');
          await this.file(outputId);current();
          await b.request(route+'/commit','POST',{requestId,uploadId},true);
        }finally{await handle.close();}
      }catch(error){
        if(context===this.context()&&!b.stopped)await b.request(route+'/fail','POST',{requestId,error:'文件上传失败，请确认原电脑在线后重试 / Upload failed. Check the source computer and retry.'},true).catch(()=>{});
      }finally{
        if(uploadId&&context===this.context()&&!b.stopped)await b.request(`/api/projects/${projectId}/attachment-uploads/${uploadId}`,'DELETE').catch(()=>{});
      }
    })();this.uploads.set(requestId,job);
    try{return await job;}finally{this.uploads.delete(requestId);}
  }
  async response(id,range){
    const f=await this.file(id),ext=path.extname(f.path).slice(1).toLowerCase(),mime=types[ext];
    if(!mime||mime==='application/pdf')return new Response('Preview unavailable',{status:415});
    const handle=await open(f.path,'r'),s=await handle.stat();
    if(stamp(s)!==f.stamp){await handle.close();return new Response('File changed',{status:409});}
    let start=0,end=s.size-1,status=200;
    if(range){const m=/^bytes=(\d*)-(\d*)$/.exec(range);if(!m||(!m[1]&&!m[2])){await handle.close();return new Response(null,{status:416});}
      start=m[1]?Number(m[1]):Math.max(0,s.size-Number(m[2]));end=m[1]&&m[2]?Math.min(Number(m[2]),end):end;status=206;
      if(start>end||start>=s.size){await handle.close();return new Response(null,{status:416,headers:{'Content-Range':`bytes */${s.size}`}});}}
    const headers={'Content-Type':mime,'Content-Length':String(Math.max(0,end-start+1)),'Accept-Ranges':'bytes','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
    if(status===206)headers['Content-Range']=`bytes ${start}-${end}/${s.size}`;
    if(!s.size){await handle.close();return new Response(null,{headers});}
    return new Response(Readable.toWeb(handle.createReadStream({start,end})),{status,headers});
  }
}
