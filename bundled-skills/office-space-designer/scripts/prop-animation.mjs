// Artwork stays inert source data. Only these bounded keyframes become CSS.
const fields={x:[-500,500],y:[-500,500],rotate:[-3600,3600],scale:[.2,4],opacity:[0,1]};
const easings=['linear','ease-in-out','steps(4)'];
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
export function assertRequestedPropAnimation(manifest,prompt=''){
 const requests=String(prompt).split(/[，。；,;\n]/).some(s=>!/(不要|不用|不需要|无需|禁止|静态|\b(?:no|without|not|static)\b)/i.test(s)&&/(水.{0,3}在动|水.{0,3}流动|流动的水|循环.{0,3}(转|动)|闪烁|摇摆|动效|动画|会动|animated|animation|flowing water)/i.test(s));
 if(requests&&!manifest.animations?.length)throw Error('用户要求道具持续动画：请在 SVG 中分出 g[data-part] 局部部位，并在 prop.json 添加 animations 关键帧。水波需要真实循环位移或透明度变化，不能用静态波纹代替。');
}
export function validatePropAnimations(animations,art){
 if(animations===undefined)return true;
 if(!Array.isArray(animations)||animations.length>16)throw Error('道具动画最多 16 条局部轨道');
 const source=String(art||'').replace(/<!--[\s\S]*?-->/g,''),parts=new Map(),used=new Set();
 for(const group of source.matchAll(/<g\b([^>]*)>/g)){
  const part=group[1].match(/\sdata-part\s*=\s*["']([a-zA-Z][\w-]{0,39})["']/)?.[1];
  if(part)parts.set(part,(parts.get(part)||0)+1);
 }
 for(const track of animations){
  if(!object(track)||Object.keys(track).some(k=>!['part','duration','delay','easing','frames'].includes(k)))throw Error('道具动画只接受局部关键帧数据');
  if(typeof track.part!=='string'||!parts.has(track.part)||parts.get(track.part)!==1||used.has(track.part))throw Error('动画 part 必须对应唯一的 SVG g[data-part]，每个部位一条轨道');
  used.add(track.part);
  if(!Number.isFinite(track.duration)||track.duration<600||track.duration>60000)throw Error('动画周期须为 600–60000 毫秒');
  if(track.delay!==undefined&&(!Number.isFinite(track.delay)||track.delay<0||track.delay>60000))throw Error('动画错峰时间须为 0–60000 毫秒');
  if(track.easing!==undefined&&!easings.includes(track.easing))throw Error('动画缓动仅支持 linear、ease-in-out 或 steps(4)');
  if(!Array.isArray(track.frames)||track.frames.length<2||track.frames.length>16)throw Error('每条动画需要 2–16 个关键帧');
  for(const frame of track.frames){
   if(!object(frame)||!Object.keys(frame).length||Object.keys(frame).some(k=>!Object.hasOwn(fields,k)))throw Error('关键帧只支持 x / y / rotate / scale / opacity');
   for(const [key,value] of Object.entries(frame))if(!Number.isFinite(value)||value<fields[key][0]||value>fields[key][1])throw Error(`动画 ${key} 超出允许范围`);
  }
  const poses=new Set(track.frames.map(f=>JSON.stringify([f.x??0,f.y??0,f.rotate??0,f.scale??1,f.opacity??1])));
  if(poses.size<2)throw Error('动画关键帧需要实际变化，不能用相同帧冒充动态道具');
 }
 return true;
}
function fingerprint(text){let hash=2166136261;for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),16777619);return(hash>>>0).toString(36);}
export function propAnimationStyle(art,animations){
 validatePropAnimations(animations,art);
 if(!animations?.length)return {scope:'',css:''};
 const scope='p'+fingerprint(art+JSON.stringify(animations)),selector=`svg[data-prop-animation="${scope}"]`;
 const css=animations.map((track,i)=>{
  const frames=track.frames.map((f,n)=>`${n/(track.frames.length-1)*100}%{transform:translate(${f.x??0}px,${f.y??0}px) rotate(${f.rotate??0}deg) scale(${f.scale??1});opacity:${f.opacity??1}}`).join('');
  return `@keyframes ${scope}-${i}{${frames}}${selector} [data-part="${track.part}"]{transform-box:fill-box;transform-origin:center;animation:${scope}-${i} ${track.duration}ms ${track.easing||'linear'} -${track.delay||0}ms infinite}`;
 }).join('');
 return {scope,css:css+`@media(prefers-reduced-motion:reduce){${selector} [data-part]{animation:none!important}}`};
}
