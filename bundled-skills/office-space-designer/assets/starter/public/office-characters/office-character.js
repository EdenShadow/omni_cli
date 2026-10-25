// Office Character Studio v1. Original runtime; no third-party dependencies.
import {characterGroundY, characterGroundOffset} from './grounding.js';
import {characterPortraitViewBox} from './portrait.js';
import {characterActionViewBox} from './action-framing.js';
import {expressiveWorkData, WORK_STAGE} from './work-performance.js';
import {WorkEffects} from './work-effects.js';
import {characterResources} from './resources.js';
const STATES = ['idle', 'walk-left', 'walk-right', 'working', 'tired', 'done', 'sitting'];
const LEGACY_STATES = STATES.filter(state=>!['done','sitting'].includes(state));
export class OfficeCharacter extends HTMLElement {
  static observedAttributes = ['src', 'state', 'paused', 'seed', 'reduced-motion', 'grounded', 'portrait', 'seat-anchor', 'action-preview'];
  constructor() {
    super();
    this.attachShadow({mode:'open'});
    this.animations = new Set();
    this.facing = 'front';
    this.currentState = 'idle';
    this.inView = true;
    this.version = 0;
    this.onVisibility = () => this.syncPlayback();
    this.onMotion = () => this.currentState==='action' ? this.resumeAction() : this.renderClip(this.currentState);
  }
  connectedCallback() {
    this.rng = Number(this.getAttribute('seed') || Math.floor(Math.random()*2147483646)) || 1;
    this.motion = matchMedia('(prefers-reduced-motion: reduce)');
    this.motion.addEventListener('change', this.onMotion);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.observer = new IntersectionObserver(([entry]) => {this.inView=entry.isIntersecting; this.syncPlayback();});
    this.observer.observe(this);
    this.resizeObserver = new ResizeObserver(() => this.alignGround());
    this.resizeObserver.observe(this);
    this.load();
  }
  disconnectedCallback() {
    this.abort?.abort();
    this.cancel();
    this.workEffects?.destroy();
    this.observer?.disconnect();
    this.resizeObserver?.disconnect();
    this.motion?.removeEventListener('change', this.onMotion);
    document.removeEventListener('visibilitychange', this.onVisibility);
  }
  attributeChangedCallback(name, old, value) {
    if (old === value || !this.isConnected) return;
    if (name === 'src') this.load();
    if (name === 'state') this.setState(value || 'idle');
    if (name === 'reduced-motion') this.onMotion();
    if (name === 'paused') this.syncPlayback();
    if (name === 'seed') this.rng = Number(value) || 1;
    if (name === 'grounded' || name === 'seat-anchor') this.alignGround();
    if (name === 'portrait' || name === 'action-preview') this.framePortrait();
  }
  random() { this.rng = (Math.imul(1664525, this.rng) + 1013904223) >>> 0; return this.rng/4294967296; }
  get reduced() {return this.hasAttribute('reduced-motion') || this.motion?.matches;}
  // An action can still be visible when its caster is outside the viewport.
  get stopped() { return this.hasAttribute('paused') || document.hidden || (!this.inView && this.currentState !== 'action'); }
  emit(name, detail) {this.dispatchEvent(new CustomEvent(name,{detail,bubbles:true,composed:true}));}
  async load() {
    this.abort?.abort(); this.cancel(); this.data = null;
    this.workEffects?.destroy();this.workEffects=null;
    const abort = this.abort = new AbortController();
    try {
      const url = new URL(this.getAttribute('src'), document.baseURI);
      if (url.origin !== location.origin) throw Error('角色包必须同源');
      const {data,art} = await characterResources.load(url.href);
      if (abort.signal.aborted) return;
      if (data.schemaVersion!==1 || !LEGACY_STATES.every(s=>data.clips?.[s]) || (['done','sitting'].some(s=>data.states?.includes(s)&&!data.clips?.[s]))) throw Error('角色包状态不完整');
      const artURL = new URL(data.art, url);
      if (artURL.origin!==location.origin) throw Error('SVG 必须同源');
      const doc = new DOMParser().parseFromString(art,'image/svg+xml');
      const svg = doc.documentElement;
      if (svg.localName !== 'svg' || doc.querySelector('parsererror')) throw Error('SVG 无效');
      // Local authored SVG only. Reject active/external content, including CSS URLs.
      if (svg.querySelector('script,foreignObject,iframe,image,use,a') || /@import|url\(\s*['"]?(?!#)/i.test(svg.textContent)) throw Error('SVG 包含不支持的外部或主动内容');
      for (const el of [svg,...svg.querySelectorAll('*')]) for (const attr of el.attributes) {
        if (attr.name==='xmlns' && attr.value==='http://www.w3.org/2000/svg') continue;
        if (/^on/i.test(attr.name) || /href/i.test(attr.name) || /javascript:|https?:/i.test(attr.value)) throw Error('SVG 包含不支持的属性');
      }
      if (abort.signal.aborted) return;
      this.shadowRoot.innerHTML = '<style>:host{display:inline-block;width:160px;height:160px;overflow:visible}.art{position:relative;width:100%;height:100%;overflow:visible}svg{display:block;width:100%;height:100%;overflow:visible!important;pointer-events:none}:host([portrait]){overflow:hidden}</style><div class="art"></div>';
      this.art = this.shadowRoot.querySelector('.art');
      this.svg = this.art.appendChild(document.importNode(svg,true));
      this.svg.setAttribute('role','img'); this.svg.setAttribute('aria-label',data.name);
      this.data=data;
      // Read the neutral artwork once. Jumping and sitting keep their own motion.
      this.originalAspectRatio = this.svg.getAttribute('preserveAspectRatio');
      this.originalViewBox = this.svg.getAttribute('viewBox');
      this.actionViewBox = characterActionViewBox(this.svg.viewBox.baseVal, data.actionBounds);
      const feet = [...this.svg.querySelectorAll('[data-part="foot-l"], [data-part="foot-r"]')];
      const boxes = (feet.length ? feet : [this.svg]).map(el => el.getBBox());
      this.groundY = characterGroundY(data.design, this.svg.viewBox.baseVal, Math.max(...boxes.map(b => b.y + b.height)));
      // Measure the neutral, visible silhouette before animation. Transparent canvas
      // padding and hidden effects must not push conversation bubbles away from the head.
      const silhouette = this.svg.querySelector('[data-part="body"]') || this.svg;
      const inverse = this.svg.getScreenCTM().inverse();
      const geometry = 'path,rect,circle,ellipse,polygon,polyline,line,text';
      const tops = [silhouette,...silhouette.querySelectorAll(geometry)].filter(el => el.matches(geometry)).flatMap(el => {
        for (let node = el; node && node !== this.svg; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return [];
        }
        const b = el.getBBox(), matrix = inverse.multiply(el.getScreenCTM());
        if (!b.width && !b.height) return [];
        return [[b.x,b.y],[b.x+b.width,b.y],[b.x,b.y+b.height],[b.x+b.width,b.y+b.height]]
          .map(([x,y]) => new DOMPoint(x,y).matrixTransform(matrix).y);
      });
      this.headY = tops.length ? Math.min(...tops) : this.svg.viewBox.baseVal.y;
      const features = this.svg.querySelector('[data-part="eyes"]') || this.svg.querySelector('[data-part="face"]');
      let featureBox;
      if (features) {
        const b = features.getBBox();
        // A generated face can sit inside translated/scaled art groups.
        const matrix = this.svg.getScreenCTM().inverse().multiply(features.getScreenCTM());
        const points = [[b.x,b.y],[b.x+b.width,b.y],[b.x,b.y+b.height],[b.x+b.width,b.y+b.height]].map(([x,y]) => new DOMPoint(x,y).matrixTransform(matrix));
        const xs = points.map(p=>p.x), ys = points.map(p=>p.y);
        featureBox = {x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)};
      }
      this.portraitViewBox = characterPortraitViewBox(data.design, this.svg.viewBox.baseVal, featureBox);
      // One connected stage keeps legacy rigs with separate feet intact. It is
      // animated by the same clock as all other parts, and resets on state exit.
      if (data.workVariants?.length && data.design?.workPerformance !== 'authored-v1') {
        const stage = document.createElementNS('http://www.w3.org/2000/svg','g');
        stage.dataset.part = WORK_STAGE;
        stage.style.transformBox = 'view-box';
        const box = this.svg.viewBox.baseVal, centerX = box.x + box.width/2;
        stage.style.transformOrigin = `${centerX}px ${this.groundY}px`;
        const footEdges = feet.flatMap(el => {
          const b=el.getBBox(), matrix=this.svg.getScreenCTM().inverse().multiply(el.getScreenCTM());
          return [[b.x,b.y],[b.x+b.width,b.y],[b.x,b.y+b.height],[b.x+b.width,b.y+b.height]]
            .map(([x,y]) => Math.abs(new DOMPoint(x,y).matrixTransform(matrix).x-centerX));
        });
        for (const child of [...this.svg.children]) if (!['title','desc','style','defs'].includes(child.localName)) stage.appendChild(child);
        this.svg.appendChild(stage);
        const footHalfWidth = footEdges.length ? Math.max(...footEdges) : box.width*.12;
        this.data = expressiveWorkData(data,{parts:new Set([...this.svg.querySelectorAll('[data-part]')].map(el=>el.dataset.part)),groundY:this.groundY,centerX,footHalfWidth,unit:box.height/260});
      }
      const effectBox=this.svg.viewBox.baseVal;
      this.workEffects=new WorkEffects(this.art,{viewBox:[effectBox.x,effectBox.y,effectBox.width,effectBox.height],headY:this.headY,groundY:this.groundY,centerX:featureBox?featureBox.x+featureBox.width/2:effectBox.x+effectBox.width/2});
      this.framePortrait();
      this.setState(this.getAttribute('state')||'idle');
      this.emit('characterready',{id:data.id,idleVariants:data.idleVariants.map(id=>({id,label:data.idleLabels?.[id]||id})),workVariants:(data.workVariants||[]).map(id=>({id,label:data.workLabels?.[id]||id})),sitVariants:(data.sitVariants||[]).map(id=>({id,label:data.sitLabels?.[id]||id})),doneVariants:(data.doneVariants||[]).map(id=>({id,label:data.doneLabels?.[id]||id}))});
    } catch (error) {
      if (abort.signal.aborted || error.name==='AbortError') return;
      this.shadowRoot.textContent=error.message;
      this.emit('charactererror',{message:error.message});
    }
  }
  framePortrait() {
    if (!this.svg || !this.data || !this.portraitViewBox) return;
    this.svg.setAttribute('viewBox', this.hasAttribute('portrait') ? this.portraitViewBox.join(' ') : this.hasAttribute('action-preview') ? this.actionViewBox.join(' ') : this.originalViewBox);
    this.alignGround();
    this.syncWorkEffects();
  }
  alignGround() {
    if (!this.art || !this.data) return;
    const portrait = this.hasAttribute('portrait');
    const preview = this.hasAttribute('action-preview');
    const grounded = this.hasAttribute('grounded') && !portrait && !preview;
    if (grounded || portrait || preview) this.svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    else if (this.originalAspectRatio !== null) this.svg.setAttribute('preserveAspectRatio', this.originalAspectRatio);
    else this.svg.removeAttribute('preserveAspectRatio');
    const inset = parseFloat(getComputedStyle(this).getPropertyValue('--character-ground-inset'));
    const offset = grounded ? characterGroundOffset(
      {width:this.clientWidth, height:this.clientHeight}, this.svg.viewBox.baseVal,
      this.hasAttribute('seat-anchor') && Number.isFinite(this.data.seating?.hipAnchor) ? this.svg.viewBox.baseVal.y+this.svg.viewBox.baseVal.height*this.data.seating.hipAnchor : this.groundY, this.hasAttribute('seat-anchor') ? 0 : Number.isFinite(inset) ? inset : 8,
    ) : 0;
    this.art.style.transform = `translateY(${offset}px)`;
    if (grounded && Number.isFinite(this.headY)) {
      const box = this.svg.viewBox.baseVal, scale = Math.min(this.clientWidth / box.width, this.clientHeight / box.height);
      this.headTop = (this.clientHeight - box.height * scale) / 2 + (this.headY - box.y) * scale + offset;
      this.emit('characterlayout', {headTop:this.headTop});
    }
  }
  cancel() {
    this.version++;
    clearTimeout(this.timer);
    for (const a of this.animations) {a.onfinish=null; a.cancel();}
    this.animations.clear();
  }
  animate(el, frames, options, done) {
    const a=el.animate(frames,options); this.animations.add(a);
    a.onfinish=()=>{done?.();};
    if (this.stopped) a.pause();
    return a;
  }
  syncPlayback() {
    this.syncWorkEffects();
    if(this.currentState==='action' && this.actionLoop && !this.stopped) {
      this.resumeAction();
      return;
    }
    for (const a of this.animations) if (a.playState!=='finished') this.stopped ? a.pause() : a.play();
    clearTimeout(this.timer);
    if (!this.stopped && this.clipName==='idle' && !this.reduced) this.scheduleIdle();
  }
  syncWorkEffects() {
    this.workEffects?.sync({active:this.currentState==='working'&&!this.hasAttribute('portrait')&&!this.hasAttribute('action-preview'),paused:this.stopped,reduced:!!this.reduced});
  }
  setState(state) {
    if (!STATES.includes(state)) {this.emit('charactererror',{message:`未知状态: ${state}`}); return;}
    if (this.data && !this.data.clips[state]) {this.emit('charactererror',{message:`此角色不支持状态: ${state}`}); return;}
    this.currentState=state;
    this.actionLoop=false;
    // Every public state owns its facing; idle must undo a previous walk.
    this.facing = state==='walk-right' ? 'right' : state==='walk-left' ? 'left' : 'front';
    if (state==='working' && this.data?.workVariants?.length && !this.reduced) this.nextWork();
    else if (state==='done' && this.data?.doneVariants?.length && !this.reduced) this.nextDone();
    else if (state==='sitting' && this.data?.sitVariants?.length && !this.reduced) this.nextSit();
    else this.renderClip(this.currentState);
  }
  restart() {this.facing='front'; this.setState('idle');}
  playIdle(name) {
    if (!this.data?.idleVariants.includes(name)) return;
    this.currentState='idle'; this.facing='front'; this.renderClip(name);
  }
  playWork(name) {
    if (!this.data?.workVariants?.includes(name)) return;
    this.currentState='working'; this.facing='front'; this.renderClip(name);
  }
  playAction(name, elapsed=0, {loop=false}={}) {
    if (!this.data?.actionVariants?.includes(name)) return false;
    const duration=this.data.clips[name].duration;
    if(!loop&&elapsed>=duration){this.setState('idle');return false;}
    elapsed=Math.max(0,Number.isFinite(elapsed)?elapsed:0);
    this.actionStart=Date.now()-elapsed;this.actionLoop=loop;
    this.currentState='action';this.facing='front';
    this.renderClip(name,{elapsed:loop?elapsed%duration:elapsed,loop});return true;
  }
  resumeAction() {
    const startedAt=this.actionStart;
    this.playAction(this.clipName,Date.now()-startedAt,{loop:this.actionLoop});
    // Preserve the shared epoch instead of accumulating callback/rendering delay.
    this.actionStart=startedAt;
  }
  nextWork() {
    const variants=this.data?.workVariants||[];
    const pool=variants.filter(name=>name!==this.lastWork);
    if (!pool.length) {this.renderClip('working'); return;}
    this.renderClip(pool[Math.floor(this.random()*pool.length)]);
  }
  playDone(name) {
    if (!this.data?.doneVariants?.includes(name)) return;
    this.currentState='done'; this.facing='front'; this.renderClip(name);
  }
  nextDone() {
    const variants=this.data?.doneVariants||[];
    const pool=variants.filter(name=>name!==this.lastDone);
    this.renderClip(pool.length ? pool[Math.floor(this.random()*pool.length)] : 'done');
  }
  playSit(name) {
    if (!this.data?.sitVariants?.includes(name)) return;
    this.currentState='sitting'; this.facing='front'; this.renderClip(name);
  }
  nextSit() {
    const variants=this.data?.sitVariants||[];
    const pool=variants.filter(name=>name!==this.lastSit);
    this.renderClip((pool.length?pool:variants)[Math.floor(this.random()*(pool.length||variants.length))]||'sitting');
  }
  scheduleIdle() {
    clearTimeout(this.timer);
    if (this.stopped || this.reduced || this.currentState!=='idle') return;
    this.timer=setTimeout(()=>{
      const pool=this.data.idleVariants.filter(n=>n!==this.lastIdle);
      this.lastIdle=pool[Math.floor(this.random()*pool.length)];
      this.renderClip(this.lastIdle);
    },3500+this.random()*3000);
  }
  renderClip(name, action) {
    if (!this.data || !this.svg) return;
    const clip=this.data.clips[name]; if (!clip) return;
    const parts=[...this.svg.querySelectorAll('[data-part]')];
    const previous=new Map(parts.map(el=>[el,{transform:getComputedStyle(el).transform,opacity:getComputedStyle(el).opacity}]));
    this.cancel(); const version=this.version;
    this.clipName=name;
    if(this.data.sitVariants?.includes(name)) this.lastSit=name;
    if(this.data.workVariants?.includes(name)) this.lastWork=name;
    if(this.data.doneVariants?.includes(name)) this.lastDone=name;
    this.svg.dataset.clip=name;
    this.svg.dataset.state=this.currentState;
    this.svg.dataset.facing=this.facing;
    this.syncWorkEffects();
    for(const el of parts) {el.style.transform='';el.style.opacity='';}
    const tracks=new Map(clip.tracks.map(t=>[t.part,t]));
    const reduced=this.reduced;
    for(const el of parts) {
      const track=tracks.get(el.dataset.part);
      const base={transform:getComputedStyle(el).transform,opacity:getComputedStyle(el).opacity};
      const first={...base,...(reduced && action ? track?.frames[Math.floor(track.frames.length/2)] : reduced && this.currentState==='done' ? track?.frames.at(-1) : track?.frames[0])};
      delete first.offset; delete first.easing;
      if (reduced) {
        // A legible static pose, including the sleepy expression and work prop.
        Object.assign(el.style, first); continue;
      }
      const startLoop=()=>{
        if(this.version!==version || !track) return;
        const animation=this.animate(el,track.frames,{duration:track.duration||clip.duration,iterations:clip.loop?Infinity:1,fill:'forwards',easing:track.easing||'ease-in-out'});
        if(action)animation.currentTime=action.elapsed;
      };
      if(action)startLoop();
      else this.animate(el,[previous.get(el),first],{duration:200,fill:'forwards',easing:'ease-out'},startLoop);
    }
    if(action&&(!action.loop||!reduced)){
      const clock=this.animate(this.svg,[{opacity:1},{opacity:1}],{duration:clip.duration},()=>{
        if(this.version!==version)return;
        if(action.loop){this.resumeAction();return;}
        this.setState('idle');this.emit('characteractionend',{clip:name});
      });
      clock.currentTime=action.elapsed;
    }
    // A clock animation pauses together with all visual tracks, unlike setTimeout.
    if (this.data.idleVariants.includes(name) && !clip.loop && !reduced) this.animate(this.svg,[{opacity:1},{opacity:1}],{duration:clip.duration+220},()=>{
      if(this.version!==version)return;
      this.renderClip('idle');
    });
    // Finish whole work cycles; the animation clock pauses with the character.
    if (this.currentState==='working' && this.data.workVariants?.length && clip.loop && !reduced) {
      const cycles=2+Math.floor(this.random()*2);
      this.animate(this.svg,[{opacity:1},{opacity:1}],{duration:clip.duration*cycles+220},()=>{
        if(this.version===version && this.currentState==='working') this.nextWork();
      });
    }
    // Independent clocks keep celebrating or playing until explicitly changed.
    if (['done','sitting'].includes(this.currentState) && !reduced) {
      const state=this.currentState;
      const duration=Math.max(clip.duration,...clip.tracks.map(t=>t.duration||clip.duration));
      this.animate(this.svg,[{opacity:1},{opacity:1}],{duration:duration*(state==='sitting'?2:1)+220},()=>{
        if(this.version!==version || this.currentState!==state)return;
        state==='done'?this.nextDone():this.nextSit();
      });
    }
    if(name==='idle') this.scheduleIdle();
    this.emit('characterstatechange',{state:this.currentState,clip:name,facing:this.facing});
  }
}
if (!customElements.get('office-character')) customElements.define('office-character',OfficeCharacter);
