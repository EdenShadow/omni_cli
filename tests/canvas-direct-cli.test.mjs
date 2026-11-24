import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {openFiles,closeFiles,uploadDirectAsset} from '../bundled-skills/wanwu-canvas/scripts/transport.mjs';
test('CLI streams byte-identical media directly; handle remains usable and completed retry uploads nothing',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'wanwu-direct-cli-')),bytes=Buffer.alloc(2*1024*1024,37),context=path.join(dir,'context.json'),file=path.join(dir,'media.mp4');writeFileSync(context,'{}');writeFileSync(file,bytes);
 let puts=0,result,meta;const server=createServer(async(req,res)=>{puts++;const chunks=[];for await(const b of req)chunks.push(b);assert.deepEqual(Buffer.concat(chunks),bytes);assert.equal(req.headers['content-md5'],createHash('md5').update(bytes).digest('base64'));res.end();});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const items=await openFiles([file],context,10*1024*1024),requestId=randomUUID(),request=async b=>{if(b.action==='canvas-direct-begin'){meta=b.body;return result?{file:result}:{supported:true,upload:{url:`http://127.0.0.1:${server.address().port}/`,headers:{'Content-MD5':meta.md5}}};}assert.equal(b.action,'canvas-direct-finish');return result={id:randomUUID()};};
 try{const one=await uploadDirectAsset(request,randomUUID(),items[0],requestId);assert.equal(meta.sha256,createHash('sha256').update(bytes).digest('hex'));assert.equal((await items[0].file.stat()).size,bytes.length);const two=await uploadDirectAsset(request,randomUUID(),items[0],requestId);assert.equal(one.id,two.id);assert.equal(puts,1);}finally{await closeFiles(items);await new Promise(r=>server.close(r));rmSync(dir,{force:true,recursive:true});}
});
