import {createHash} from 'node:crypto';
import {cryptRecord,recordBytes} from '../shared/nas-transfer.mjs';

async function directory(client,name){
  try{await client.mkdir(name);}catch(error){if(!(await client.stat(name)).isDirectory)throw error;}
}
async function objectRoot(client,tools,config,id,create){
  if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid object ID');
  let base=config.base;
  if(!base){
    // A host-only key has no default share. Use only the conventional transfer
    // share when present, never the first visible volume or a home directory.
    const shares=await tools.listNas(client,'');
    base=shares.find(s=>s.name.toLowerCase()==='sharews')?.name;
  }
  if(!base)throw Error('Select a NAS share for transfers');
  const root=base+'/Wanwu-Transfers',folder=root+'/'+id;
  if(create){await directory(client,root);await directory(client,folder);}
  return folder;
}
async function readRecord(client,root,index,size){
  const target=root+'/'+index+'.bin',expected=Math.min(recordBytes,size-index*recordBytes)+28;
  if((await client.stat(target)).size!==expected)throw Error('Incomplete NAS record');
  const chunks=[];let length=0;
  for await(const chunk of client.createReadStream(target)){length+=chunk.length;if(length>expected)throw Error('Oversized NAS record');chunks.push(chunk);}
  if(length!==expected)throw Error('Incomplete NAS record');
  return Buffer.concat(chunks);
}
export async function serveTransfer(host,req,res,ticket,index){
  if(!['GET','PUT','OPTIONS'].includes(req.method)){res.writeHead(405).end();return;}
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Private-Network','true');
  res.setHeader('Access-Control-Allow-Methods','GET,PUT,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS'){res.writeHead(204).end();return;}
  const write=req.method==='PUT';
  const grant=await host.call('transfer-grant',{ticket,write}),entry=host.entries.get(grant.entry);
  if(!entry||entry.revision!==grant.revision||entry.origin!=='http://'+req.socket.localAddress+':'+req.socket.localPort||index>=Math.ceil(grant.size/recordBytes))throw Error('Invalid transfer');
  await host.withClient(entry,async(client,tools,config)=>{
    const root=await objectRoot(client,tools,config,grant.id,write);
    if(!write){
      const data=await readRecord(client,root,index,grant.size);
      res.writeHead(200,{'Content-Length':data.length,'Content-Type':'application/octet-stream'}).end(data);return;
    }
    const expected=Math.min(recordBytes,grant.size-index*recordBytes)+28;
    if(Number(req.headers['content-length'])!==expected)throw Error('Invalid record size');
    const chunks=[];let length=0;
    for await(const data of req){length+=data.length;if(length>expected)throw Error('Record too large');chunks.push(data);}
    if(length!==expected)throw Error('Incomplete record');
    const bytes=Buffer.concat(chunks);
    await cryptRecord(grant,index,bytes,false);
    // Publish only complete, immutable records. Duplicate concurrent PUTs cannot
    // overwrite a committed file, even if a client loses its acknowledgement.
    const temp=root+'/'+crypto.randomUUID()+'.part',target=root+'/'+index+'.bin';
    try{await client.writeFile(temp,bytes);await client.rename(temp,target);}finally{await client.rm(temp).catch(()=>{});}
    res.writeHead(204).end();
  });
}
export async function processTransfer(host,msg){
  try{
    const grant=await host.call('transfer-job',{job:msg.job}),entry=host.entries.get(grant.entry);
    if(!entry||entry.revision!==grant.revision)throw Error('NAS binding changed');
    await host.withClient(entry,async(client,tools,config)=>{
      const root=await objectRoot(client,tools,config,grant.id,false),hash=createHash('sha256');
      if(grant.remove){
        let names;try{names=await client.readdir(root);}catch(e){if(e.code!=='ENOENT')throw e;names=[];}
        for(const name of names){if(!/^(?:[0-9]{1,4}\.bin|[a-f0-9-]{36}\.part)$/.test(name))throw Error('Unknown transfer entry');}
        for(const name of names)await client.rm(root+'/'+name);
        await client.rmdir(root).catch(e=>{if(e.code!=='ENOENT')throw e;});
        await host.call('transfer-done',{job:msg.job});return;
      }
      for(let index=0;index<Math.ceil(grant.size/recordBytes);index++){
        const plain=await cryptRecord(grant,index,await readRecord(client,root,index,grant.size),false);
        hash.update(plain);
        if(grant.recall)await host.call('transfer-part',{job:msg.job,index,data:Buffer.from(plain).toString('base64')});
      }
      await host.call('transfer-done',{job:msg.job,sha256:hash.digest('hex')});
    });
  }catch{await host.call('transfer-done',{job:msg.job,error:true}).catch(()=>{});}
}
