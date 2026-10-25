import {createLayout,walkable,findPath} from './layout.js';
export const PROP_TYPES={
 wall:{label:'矮墙',size:[150,85],hint:'挡住路线，人物会绕行'},
 tree:{label:'点子树',size:[78,145],hint:'不可穿过的树，装饰也有碰撞'},
 'spring-soft':{label:'软糖弹簧',size:[92,78],hint:'走上去压扁，再软软地弹起来'},
 'spring-steel':{label:'钢铁弹簧',size:[80,80],hint:'走上去，干脆地高高弹起'},
 carpet:{label:'云朵飞毯',size:[130,55],hint:'站上去乘坐，到落点后自动下毯'},
 slide:{label:'灵感滑梯',size:[160,150],hint:'走到入口自动坐下，滑到落点'},
 firework:{label:'好点子烟花',size:[65,90],hint:'点击点燃，彩色烟花在空中绽放'},
 confetti:{label:'惊喜爆爆箱',size:[70,65],hint:'点击爆出星星与彩纸，可重复触发'}
};
// New kinds can register a painter/behavior in code; user JSON is always data, never eval.
export function propValid(p){return p&&PROP_TYPES[p.kind]&&typeof p.id==='string'&&typeof p.name==='string'&&['x','y','w','h'].every(k=>Number.isFinite(p[k]))&&p.w>=30&&p.w<=300&&p.h>=30&&p.h<=300&&(!['carpet','slide'].includes(p.kind)||['endX','endY'].every(k=>Number.isFinite(p[k])));}
export function canPlace(p,devices,props,people=[]){
 const base=createLayout(devices,props.filter(v=>v.id!==p.id));
 if(!propValid(p)||p.x-p.w/2<50||p.x+p.w/2>base.width-50||p.y-p.h<282||!walkable([p.x,p.y],base))return '这里被家具或障碍挡住了，请换一个位置。';
 if(props.some(v=>v.id!==p.id&&Math.hypot(v.x-p.x,v.y-p.y)<(v.w+p.w)*.3))return '道具离得太近了，挪开一点更好玩。';
 const next=createLayout(devices,[...props.filter(v=>v.id!==p.id),p]);
 const points=[...base.computers.flatMap(d=>d.spots),...base.seats.map(s=>s.approach),...props.filter(v=>v.id!==p.id&&!['wall','tree'].includes(v.kind)).flatMap(v=>[[v.x,v.y],...(v.endX!==undefined?[[v.endX,v.endY]]:[])]),...people];
 if(points.some(pt=>!walkable(pt,next)))return '不能挡住人物、电脑或座位入口。';
 if(['carpet','slide'].includes(p.kind)&&!walkable([p.endX,p.endY],next))return '落点被挡住了，请换一个落点。';
 if(['wall','tree'].includes(p.kind)){
  const obstacle=next.obstacles.at(-1);
  if(base.obstacles.some(o=>obstacle.x<o.x+o.w&&obstacle.x+obstacle.w>o.x&&obstacle.y<o.y+o.h&&obstacle.y+obstacle.h>o.y))return '障碍物不能穿进现有家具。';
  if(points.some(pt=>!findPath(points[0],pt,next)))return '这会封住通道，请给电脑和座位留一条路。';
 }
 return null;
}
function art(p){
 const w=p.w,h=p.h;
 switch(p.kind){
 case 'wall':return `<path d="M${-w/2} -55L${-w/2+12} -72H${w/2+12}L${w/2} -55Z" fill="#E9DFCA"/><path d="M${w/2} -55L${w/2+12} -72V-8L${w/2} 8Z" fill="#A2AD94"/><rect x="${-w/2}" y="-55" width="${w}" height="63" rx="3" fill="#B6C5AC"/><path d="M${-w/2+8} -28H${w/2-8}M0 -55V-28M-35 -28V5M35 -28V5" stroke="#93A38A"/>`;
 case 'tree':return '<ellipse cy="4" rx="37" ry="12" fill="#829F7740" stroke="none"/><path d="M-7 -15L-5 -77H7L10 -15" fill="#A68058"/><path d="M2 -43L-19 -68M3 -58L24 -78"/><path d="M-28 -65Q-53 -72 -35 -101Q-48 -119 -21 -126Q-14 -149 12 -132Q39 -142 41 -112Q59 -92 34 -75Q33 -49 5 -59Q-17 -44 -28 -65Z" fill="#7E9D7B"/><path d="M-22 -104Q-12 -116 -3 -108M11 -87Q24 -101 32 -91" stroke="#B8CEA1"/><circle cx="-21" cy="-82" r="7" fill="#EDB965"/><circle cx="20" cy="-119" r="8" fill="#EDB965"/><path d="M-19 -11H20L15 5H-14Z" fill="#C0AC82"/>';
 case 'spring-soft':return '<ellipse cy="3" rx="44" ry="13" fill="#E0BAC5"/><path d="M-31 -12Q-45 -24 -22 -31Q-46 -43 -20 -50Q-44 -62 -19 -68H22Q44 -58 20 -49Q45 -39 21 -30Q44 -19 28 -12Z" fill="#DDB9D2"/><path d="M-22 -31H22M-20 -50H22" stroke="#B18FA9"/><ellipse cy="-68" rx="34" ry="9" fill="#F3DFE5"/>';
 case 'spring-steel':return '<ellipse cy="4" rx="37" ry="10" fill="#A3B5B2"/><path d="M-23 -7L23 -20L-23 -31L23 -42L-23 -53L23 -65" stroke="#758B93" stroke-width="9"/><path d="M-23 -7L23 -20L-23 -31L23 -42L-23 -53L23 -65" stroke="#C7D9D6" stroke-width="4"/><ellipse cy="-68" rx="32" ry="9" fill="#DBE8DE"/>';
 case 'carpet':return '<ellipse cy="3" rx="56" ry="11" fill="#8F83B933" stroke="none"/><path d="M-62 -18Q-25 -38 0 -21Q29 -8 62 -27L51 -2Q20 13 -7 -2Q-32 -17 -60 4Z" fill="#A5A0CA"/><path d="M-47 -16Q-17 -28 1 -14Q23 -3 48 -18L43 -9Q17 3 -4 -9Q-24 -22 -46 -7Z" fill="#D9CBE2"/><path d="M-63 -16L-70 -12M-61 -8L-68 -4M-59 0L-66 4M61 -23L68 -27M58 -14L65 -17M55 -5L62 -8" stroke="#BD974D"/><path d="M-8 -13L0 -20L8 -11L0 -4Z" fill="#EDD38A"/>';
 case 'slide':return '<path d="M-30 0V-120M4 -5V-120M-30 -22H4M-30 -47H4M-30 -72H4M-30 -97H4" stroke="#A6855A" stroke-width="7"/><path d="M-35 -120H15V-131H-35Z" fill="#E8B77B"/><path d="M-35 -131V-150M15 -131V-150M-35 -150H15" stroke="#80A698" stroke-width="5"/>';
 case 'firework':return '<ellipse cy="4" rx="29" ry="8" fill="#B2A99555" stroke="none"/><path d="M0 4V-64" stroke="#AC9471" stroke-width="5"/><path d="M-16 -25V-64L0 -82L17 -64V-25Z" fill="#D98076"/><path d="M-16 -64H17M-14 -37L14 -53" stroke="#F8D89C" stroke-width="6"/><path d="M-12 -22Q-30 -18 -16 -9" stroke="#837052"/>';
 default:return '<ellipse cy="4" rx="34" ry="9" fill="#B2A99555" stroke="none"/><path d="M-29 -46L-15 -56L31 -47V-2H-29Z" fill="#E3B86B"/><path d="M-29 -46H31M3 -46V-2" stroke="#BB8263"/><path d="M-8 -48Q-29 -70 -9 -63L2 -48Q21 -69 22 -57Q22 -48 2 -48" fill="#C17E92"/><path d="M-12 -22L-5 -32L2 -22L-5 -13Z" fill="#FCEDC1"/>';
 }
}
export function renderProps(layout,container,onClick){
 container.replaceChildren();
 for(const p of layout.props){
  if(p.kind==='slide'){
   const track=document.createElementNS('http://www.w3.org/2000/svg','svg');track.setAttribute('viewBox',`0 0 ${layout.width} ${layout.height}`);track.classList.add('scene-layer');track.style.zIndex=String(99+Math.round(p.y*1000));track.setAttribute('aria-hidden','true');
   const dx=p.endX-p.x,dy=p.endY-p.y;const d=`M${p.x} ${p.y-118} C${p.x+dx*.15} ${p.y-110} ${p.x+dx*.55} ${p.y+dy*.55-35} ${p.endX} ${p.endY}`;
   for(const [width,color] of [[35,'#A08B68'],[30,'#E1AD71'],[19,'#F7DDA3']]){const rail=document.createElementNS('http://www.w3.org/2000/svg','path');rail.setAttribute('d',d);rail.setAttribute('fill','none');rail.setAttribute('stroke',color);rail.setAttribute('stroke-width',width);rail.setAttribute('stroke-linecap','round');track.append(rail);}container.append(track);
  }
  const b=document.createElement('button');b.type='button';b.className='world-prop';b.dataset.prop=p.id;b.setAttribute('aria-label',p.name+'：'+PROP_TYPES[p.kind].hint);b.style.cssText=`left:${p.x/layout.width*100}%;top:${p.y/layout.height*100}%;width:${p.w/layout.width*100}%;height:${(p.h+25)/layout.height*100}%;z-index:${100+Math.round(p.y*1000)};`;
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox',`${-p.w/2-12} ${-p.h-12} ${p.w+24} ${p.h+37}`);svg.setAttribute('aria-hidden','true');svg.innerHTML=`<g fill="none" stroke="#566051" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${art(p)}</g>`;b.append(svg);const label=document.createElement('span');label.textContent=p.name;b.append(label);b.onclick=e=>{e.stopPropagation();onClick(p);};container.append(b);}
}
// Reflow only when new core furniture would conflict. Keep IDs, content and custom destinations.
export function reflowProps(devices,props,oldPlayY){
 const next=createLayout(devices),dy=next.playY-oldPlayY;
 const result=props.map(p=>{const q={...p};if(q.y>=oldPlayY){q.y+=dy;if(q.endY!==undefined)q.endY+=dy;}return q;});
 for(let i=0;i<result.length;i++){
  if(!canPlace(result[i],devices,result.slice(0,i)))continue;
  const original=result[i];let found=null;
  for(let r=30;r<Math.max(next.width,next.height)&&!found;r+=30)for(let n=0;n<16&&!found;n++){
   const dx=Math.round(Math.cos(n*Math.PI/8)*r),dy=Math.round(Math.sin(n*Math.PI/8)*r),candidate={...original,x:original.x+dx,y:original.y+dy};
   if(original.endX!==undefined){candidate.endX+=dx;candidate.endY+=dy;}
   if(!canPlace(candidate,devices,result.slice(0,i)))found=candidate;
  }
  if(!found)throw Error('暂时没有足够空间安置'+original.name+'，请先移开附近道具再添加电脑。');result[i]=found;
 }
 return result;
}
