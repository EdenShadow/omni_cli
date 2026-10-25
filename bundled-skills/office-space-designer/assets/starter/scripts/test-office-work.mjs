import assert from 'node:assert/strict';
import fs from 'node:fs';
globalThis.HTMLElement=class {attachShadow(){}};
globalThis.customElements={get:()=>true};
globalThis.document={hidden:false};
globalThis.getComputedStyle=()=>({transform:'none',opacity:'1'});
globalThis.setTimeout=()=>1;
globalThis.clearTimeout=()=>{};
const {OfficeCharacter}=await import('../public/office-characters/office-character.js');
function setup(id){
 const h=new OfficeCharacter();h.rng=42;h.flags=new Set();h.hasAttribute=k=>h.flags.has(k);h.emit=()=>{};
 h.data=JSON.parse(fs.readFileSync(new URL(`../public/office-characters/${id}/character.json`,import.meta.url)));
 h.svg={dataset:{},querySelectorAll:()=>[],animate:(_frames,options)=>({options,playState:'running',pause(){this.playState='paused'},play(){this.playState='running'},cancel(){this.playState='idle'},finish(){this.playState='finished';this.onfinish?.()}})};
 return h;
}
for(const id of ['yatuan','banana-uncle','orange-sister']){
 const h=setup(id);h.setState('working');const seen=[];
 for(let i=0;i<30;i++){
  seen.push(h.clipName);assert.equal(h.currentState,'working');assert.equal(h.svg.dataset.state,'working');
  const clock=[...h.animations].at(-1);const duration=h.data.clips[h.clipName].duration;
  assert.ok([duration*2+220,duration*3+220].includes(clock.options.duration));
  clock.finish();assert.equal(h.animations.size,1);
 }
 assert.equal(new Set(seen).size,h.data.workVariants.length);assert.ok(seen.every((v,i)=>i===0||v!==seen[i-1]));
 assert.ok(!seen.includes('done'));
 const clock=[...h.animations][0];h.flags.add('paused');h.syncPlayback();assert.equal(clock.playState,'paused');
 h.flags.delete('paused');h.syncPlayback();assert.equal(clock.playState,'running');
 const staleCallback=clock.onfinish;h.setState('idle');staleCallback();assert.equal(h.clipName,'idle');assert.equal(h.facing,'front');
 h.playWork(h.data.workVariants[1]);assert.equal(h.clipName,h.data.workVariants[1]);assert.equal(h.currentState,'working');
 const oldWork=[...h.animations].at(-1).onfinish;
 h.setState('done');oldWork();assert.equal(h.currentState,'done');assert.ok(h.data.doneVariants.includes(h.clipName));
 assert.equal(h.animations.size,1,'done needs its own continuing clock');
 const celebrationSeen=[];
 for(let i=0;i<30;i++){celebrationSeen.push(h.clipName);assert.equal(h.currentState,'done');assert.equal(h.animations.size,1);[...h.animations].at(-1).finish();}
 assert.equal(new Set(celebrationSeen).size,3);assert.ok(celebrationSeen.every((v,i)=>!i||v!==celebrationSeen[i-1]));
 h.playDone(h.data.doneVariants[1]);assert.equal(h.clipName,h.data.doneVariants[1]);assert.equal(h.currentState,'done');
 const doneClock=[...h.animations].at(-1);h.flags.add('paused');h.syncPlayback();assert.equal(doneClock.playState,'paused');h.flags.delete('paused');h.syncPlayback();assert.equal(doneClock.playState,'running');
 const staleDone=doneClock.onfinish;h.setState('sitting');staleDone();assert.equal(h.currentState,'sitting');
 const sitSeen=[];
 for(let i=0;i<30;i++){sitSeen.push(h.clipName);assert.equal(h.currentState,'sitting');[...h.animations].at(-1).finish();}
 assert.equal(new Set(sitSeen).size,4);assert.ok(sitSeen.every((v,i)=>!i||v!==sitSeen[i-1]));
 h.playSit(h.data.sitVariants[1]);assert.equal(h.clipName,h.data.sitVariants[1]);
 const staleSit=[...h.animations].at(-1).onfinish;h.setState('walk-left');staleSit();assert.equal(h.currentState,'walk-left');
 h.flags.add('reduced-motion');h.setState('sitting');assert.equal(h.animations.size,0);assert.equal(h.clipName,'sitting');h.flags.delete('reduced-motion');
 h.setState('working');
 h.flags.add('reduced-motion');h.onMotion();assert.equal(h.clipName,'working');assert.equal(h.animations.size,0);
 h.flags.delete('reduced-motion');delete h.data.workVariants;h.setState('working');assert.equal(h.clipName,'working');assert.equal(h.animations.size,0);
 delete h.data.doneVariants;delete h.data.doneLabels;delete h.data.clips.done;h.data.states=h.data.states.filter(s=>s!=='done');
 let error;h.emit=(name,detail)=>{if(name==='charactererror')error=detail.message};
 h.setState('done');assert.match(error,/不支持/);assert.equal(h.currentState,'working');
 // Static completion uses the final pose, and normal completion runs each track once.
 const pose=setup(id);const done=pose.data.clips.done;
 const parts=done.tracks.map(t=>({dataset:{part:t.part},style:{},animate:pose.svg.animate}));
 pose.svg.querySelectorAll=()=>parts;pose.flags.add('reduced-motion');pose.setState('done');
 for(const [i,part] of parts.entries())for(const [key,value] of Object.entries(done.tracks[i].frames.at(-1))) {
  if(key!=='offset'&&key!=='easing')assert.equal(part.style[key],value);
 }
 assert.equal(pose.animations.size,0);
 pose.flags.delete('reduced-motion');pose.onMotion();
 for(const a of [...pose.animations].filter(a=>a.options.duration===200))a.finish(); // entrance transitions launch finite tracks
 const tracks=[...pose.animations].filter(a=>a.options.iterations!==undefined);
 assert.equal(tracks.length,parts.length);assert.ok(tracks.every(a=>a.options.iterations===1&&a.options.fill==='forwards'));
 for(const a of tracks)a.finish();assert.equal(pose.currentState,'done');
 pose.setState('idle');assert.equal(pose.svg.dataset.clip,'idle');assert.equal(pose.facing,'front');
 for(const name of pose.data.doneVariants){
  const celebration=pose.data.clips[name];const particles=celebration.tracks.filter(t=>/^(confetti|flower|popper)-/.test(t.part));
  assert.ok(particles.length>=10);assert.ok(particles.every(t=>t.frames.at(-1).opacity===0),'celebration particles must fade out');
  pose.flags.add('reduced-motion');pose.svg.querySelectorAll=()=>particles.map(t=>({dataset:{part:t.part},style:{},animate:pose.svg.animate}));
  pose.playDone(name);assert.equal(pose.currentState,'done');assert.equal(pose.animations.size,0);
 }
 console.log(`PASS ${id}: celebration coverage/nonrepeat/particle cleanup, manual celebration,  five-action coverage/nonrepeat, clock/pause, stale callback cancellation, continuous independent done/sitting, final-pose reduced motion, legacy fallback`);
}
