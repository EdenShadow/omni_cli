import {spawn} from 'node:child_process';
// Use the already validated open file, not a newly resolved user path. POSIX
// fd access also supports MP4s whose metadata is at the end of the file.
export async function nativeVideoPoster(file){
 if(!file.mime?.startsWith('video/')||process.platform==='win32')return;
 const format=file.mime==='video/webm'?'matroska':file.mime==='video/ogg'?'ogg':'mov';
 try{
  const bytes=await new Promise((resolve,reject)=>{
   const child=spawn(process.env.WANWU_FFMPEG_PATH||'ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-protocol_whitelist','file,pipe','-threads','1','-f',format,'-i','/dev/fd/3','-map','0:v:0','-frames:v','1','-vf','scale=192:192:force_original_aspect_ratio=decrease','-threads','1','-q:v','10','-f','image2pipe','-c:v','mjpeg','pipe:1'],{stdio:['ignore','pipe','ignore',file.file.fd]});
   const chunks=[];let length=0;const timer=setTimeout(()=>{child.kill();reject(Error('Poster timed out'));},4000);
   child.stdout.on('data',part=>{length+=part.length;if(length>8192){child.kill();return;}chunks.push(part);});
   child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',code=>{clearTimeout(timer);code===0&&length>0&&length<=8192?resolve(Buffer.concat(chunks)):reject(Error('Poster unavailable'));});
  });return {mime:'image/jpeg',data:bytes.toString('base64')};
 }catch{/* Missing local ffmpeg/codec falls back to private range extraction. */}
}
