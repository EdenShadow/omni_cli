// Host-owned work indicator, independent of the character's artwork and clips.
const NS = 'http://www.w3.org/2000/svg';
export const WORK_EFFECT_VARIANTS = ['cotton','swirl','steam','poof'];
const clouds = {
  cotton: '<path d="M-17 7C-28 5-27-9-16-10C-15-24 5-24 9-13C24-18 31 2 19 8C15 19-1 18-5 12C-13 16-20 13-17 7Z" fill="#f5f1e9" stroke="#b4abbe" stroke-width="2"/><path d="M-14-4q4-7 10-4M9 6q6 2 8-3" fill="none" stroke="#cec4d3" stroke-width="2"/>',
  swirl: '<path d="M-19 7C-29-2-17-16-6-11C-1-24 19-17 17-4C31 1 20 20 7 13C-8 24-23 18-19 7Z" fill="#e8e1f2" stroke="#ad9abc" stroke-width="2"/><path d="M-10 6C-19-2-3-11 4-5C15 4 0 14-3 5C-5 0 3-1 4 3" fill="none" stroke="#b19ec3" stroke-width="2.4"/>',
  steam: '<path d="M-9 19C-24 4 7 0-5-16M5 20C-7 8 21-5 8-23" fill="none" stroke="#d2e5df" stroke-width="9"/><path d="M-9 19C-24 4 7 0-5-16M5 20C-7 8 21-5 8-23" fill="none" stroke="#a7c6bc" stroke-width="2"/>',
  poof: '<path d="M-20 7Q-31-3-17-10Q-19-25-5-18Q6-30 13-15Q30-18 23-3Q37 8 20 13Q19 27 6 17Q-7 27-12 15Q-29 22-20 7Z" fill="#f1e8d7" stroke="#c5b697" stroke-width="2"/><path d="M-11 4l5-6M7-9l2 7M11 9l7 1" stroke="#d4c4a3" stroke-width="2"/>',
};
const tools = {
  wrench:'<path d="M-8-15L-3-9L3-14L1-20C10-18 14-8 6-3L-3 13Q-8 19-13 13Q-16 9-10 4L-1-7C-8-7-12-11-8-15Z" fill="#d1dce0" stroke="#78828d" stroke-width="2.5"/><circle cx="-8" cy="10" r="2" fill="#fbf8ef"/>',
  driver:'<path d="M-2-19L2-19L3-10L1-6L1 5L-2 5L-2-7L-4-10Z" fill="#c8d4db" stroke="#78828d" stroke-width="2"/><path d="M-5 1Q-1-2 3 1L5 14Q-1 20-7 14Z" fill="#c6a6c4" stroke="#8a748d" stroke-width="2.2"/><path d="M-1 4v9" stroke="#f1e6ee" stroke-width="2"/>',
  screw:'<path d="M-7-10H7V-4H3V9L0 14L-3 9V-4H-7Z" fill="#d2d8da" stroke="#7d8790" stroke-width="2"/><path d="M-4-7h8M-3 0l6-2M-3 5l6-2M-2 10l5-2" stroke="#7d8790" stroke-width="1.7"/>',
};

export function chooseWorkEffect(previous, random = Math.random) {
  const pool = WORK_EFFECT_VARIANTS.filter(id => id !== previous);
  return pool[Math.min(pool.length-1,Math.max(0,Math.floor(random()*pool.length)))];
}

export function workEffectParticles(variant) {
  if (!WORK_EFFECT_VARIANTS.includes(variant)) throw Error('Unknown work effect');
  const quick = variant === 'poof', curled = variant === 'swirl', steam = variant === 'steam';
  const particles = [];
  for (let i=0;i<4;i++) {
    const side=i%2?1:-1, lane=Math.floor(i/2);
    const transform=(x,y,scale,angle)=>`translate(${side*x}px, ${y}px) rotate(${side*angle}deg) scale(${scale})`;
    particles.push({kind:'smoke',art:clouds[variant],duration:quick?1900:steam?3100:2700,phase:i/4,
      frames:[
        {offset:0,opacity:0,transform:transform(42+lane*9,34,.3,0)},
        {offset:.18,opacity:steam?.8:.72,transform:transform(57+lane*7,13,.8,curled?-25:8)},
        {offset:.58,opacity:.62,transform:transform(curled?45:66+lane*7,-18,quick?1.3:1.08,curled?75:18)},
        {offset:1,opacity:0,transform:transform(72+lane*10,-55,1.38,curled?150:28)},
      ]});
  }
  for (const [i,kind] of ['wrench','driver','screw','screw'].entries()) {
    const side=i%2?1:-1, small=kind==='screw', reach=small?82:94;
    particles.push({kind,art:tools[kind],duration:(quick?2250:2900)+i*130,phase:.16+i*.22,
      frames:[
        {offset:0,opacity:0,transform:`translate(${side*36}px, 28px) rotate(0deg) scale(.4)`},
        {offset:.15,opacity:1,transform:`translate(${side*54}px, -2px) rotate(${side*35}deg) scale(${small?.7:.82})`},
        {offset:.5,opacity:1,transform:`translate(${side*70}px, ${small?-58:-34}px) rotate(${side*145}deg) scale(${small?.7:.82})`},
        {offset:.82,opacity:.9,transform:`translate(${side*reach}px, 6px) rotate(${side*265}deg) scale(${small?.65:.75})`},
        {offset:1,opacity:0,transform:`translate(${side*(reach+6)}px, 40px) rotate(${side*310}deg) scale(.4)`},
      ]});
  }
  return particles;
}

export class WorkEffects {
  constructor(container, {viewBox,headY,groundY,centerX}, random = Math.random) {
    this.random=random;this.animations=[];this.active=false;
    this.root=document.createElementNS(NS,'svg');
    this.root.setAttribute('viewBox',viewBox.join(' '));
    this.root.setAttribute('aria-hidden','true');this.root.setAttribute('focusable','false');
    this.root.setAttribute('data-work-effects','');
    this.root.style.cssText='position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none;display:none';
    this.layer=document.createElementNS(NS,'g');
    const unit=Math.min(viewBox[2]/240,viewBox[3]/260);
    this.layer.setAttribute('transform',`translate(${centerX} ${headY+(groundY-headY)*.05}) scale(${unit})`);
    this.layer.setAttribute('stroke-linecap','round');this.layer.setAttribute('stroke-linejoin','round');
    this.root.appendChild(this.layer);container.appendChild(this.root);
  }
  sync({active,paused,reduced}) {
    if (!active) {this.stop();return;}
    if (!this.active) {
      this.variant=chooseWorkEffect(this.variant,this.random);
      this.root.dataset.variant=this.variant;this.active=true;this.reduced=undefined;
    }
    if (this.reduced!==reduced) {
      this.clear();this.reduced=reduced;
      const particles=workEffectParticles(this.variant);
      for (const [i,particle] of particles.entries()) {
        // Keep a recognizable, motionless badge in reduced-motion mode.
        if (reduced && ![0,1,4,6].includes(i)) continue;
        const el=document.createElementNS(NS,'g');el.dataset.particle=particle.kind;
        el.innerHTML=particle.art;el.style.cssText='opacity:0;transform-box:view-box;transform-origin:0px 0px';
        this.layer.appendChild(el);
        if (reduced) {
          const pose=particle.frames[2];el.style.transform=pose.transform;el.style.opacity=String(particle.kind==='smoke'?.45:.85);
        } else {
          const a=el.animate(particle.frames,{duration:particle.duration,iterations:Infinity,easing:'linear',fill:'both'});
          a.currentTime=particle.phase*particle.duration;this.animations.push(a);
        }
      }
    }
    this.root.style.display='block';
    for (const a of this.animations) paused?a.pause():a.play();
  }
  clear() {for (const a of this.animations) a.cancel();this.animations=[];this.layer.replaceChildren();}
  stop() {if(this.active)this.clear();this.active=false;this.root.style.display='none';}
  destroy() {this.stop();this.root.remove();}
}
