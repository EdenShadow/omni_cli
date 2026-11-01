// Runtime compatibility for every existing library asset. Never mutate cached JSON.
// Authored pranked clips take priority and retain their own visual language.
export function installPranked(svg,data,{featureBox,headY,groundY}) {
 if(data.clips?.pranked)return {...data,states:[...new Set([...data.states,'pranked'])]};
 const ns='http://www.w3.org/2000/svg',box=svg.viewBox.baseVal,u=box.height/260;
 const cx=featureBox?featureBox.x+featureBox.width/2:box.x+box.width/2;
 const ey=featureBox?featureBox.y+featureBox.height*.65:headY+(groundY-headY)*.3;
 const gap=Math.max(9*u,Math.min(22*u,(featureBox?.width||40*u)*.32));
 const names=new Set([...svg.querySelectorAll('[data-part]')].map(e=>e.dataset.part));
 let part='wanwu-pranked';while(names.has(part))part+='-';
 const stage=document.createElementNS(ns,'g');stage.dataset.prankedBody='';
 for(const child of [...svg.children])if(!['title','desc','defs','style'].includes(child.localName))stage.append(child);
 svg.append(stage);
 const style=document.createElementNS(ns,'style');style.textContent='svg[data-state="pranked"] > [data-pranked-body]{filter:grayscale(1) brightness(.32)}';svg.append(style);
 const effect=document.createElementNS(ns,'g');effect.dataset.part=part;effect.dataset.prankedFallback='';effect.setAttribute('opacity','0');
 // White dazed eyes, tear beads and short soot wisps remain legible at map size.
 for(const x of [cx-gap,cx+gap]){
  const eye=document.createElementNS(ns,'ellipse');for(const [k,v]of Object.entries({cx:x,cy:ey,rx:5*u,ry:3*u,fill:'#fff8dc'}))eye.setAttribute(k,String(v));effect.append(eye);
  const tear=document.createElementNS(ns,'path');tear.setAttribute('d',`M${x} ${ey+4*u}q${-7*u} ${11*u} 0 ${12*u}q${7*u} ${-1*u} 0 ${-12*u}`);tear.setAttribute('fill','#7ed9f4');effect.append(tear);
 }
 for(const dx of [-12,9]){const smoke=document.createElementNS(ns,'path');smoke.setAttribute('d',`M${cx+dx*u} ${headY-3*u}q${-8*u} ${-6*u} 0 ${-12*u}q${8*u} ${-6*u} 0 ${-12*u}`);smoke.setAttribute('fill','none');smoke.setAttribute('stroke','#9eabb2');smoke.setAttribute('stroke-width',String(3*u));smoke.setAttribute('stroke-linecap','round');effect.append(smoke);}
 svg.append(effect);
 return {...data,states:[...new Set([...data.states,'pranked'])],clips:{...data.clips,pranked:{duration:1800,loop:true,tracks:[{part,frames:[{opacity:1},{opacity:1}]}]}}};
}
