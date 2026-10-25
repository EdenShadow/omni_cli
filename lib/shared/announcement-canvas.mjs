// Host-owned compact canvas behaviour, always executed in the opaque-origin sandbox.
import {systemFontStack} from './typography.mjs';
import {announcementThemeStyles,applyAnnouncementTheme} from './announcement-theme.mjs';

export function announcementCanvasRuntime(options={}){
 const {compact=false,mode='auto-scroll',channel='',title='',theme='light'}=options;
 const data=JSON.stringify({compact,mode,channel,title,theme}).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
 return `<style>${compact?compactStyle:''}${announcementThemeStyles}</style><script>(${applyAnnouncementTheme.toString()})(${data});(${canvasRuntime.toString()})(${data})</script>`;
}
const compactStyle=`
html,body,body *{-webkit-user-select:none!important;user-select:none!important}
body input,body textarea,body [contenteditable="true"]{-webkit-user-select:text!important;user-select:text!important}
img,a{-webkit-user-drag:none}
html{height:100%;overflow:auto!important;scrollbar-width:thin;scrollbar-color:#a18b6859 transparent;background:transparent!important}
body{display:flow-root;min-height:100%;height:auto!important;overflow:visible!important;background:transparent!important;margin:0!important;padding:0!important}
body[data-wanwu-motion]>*:not(#wanwu-motion):not(script):not(style){display:none!important}
#wanwu-motion{position:relative;height:100vh;width:100%;box-sizing:border-box;overflow:hidden}
#wanwu-motion .notice-message{position:absolute;left:0;margin:0;display:block;width:max-content;max-width:none;white-space:nowrap;padding:4px 12px;border-left:3px solid #b694cd;background:#fff6df;color:#493e55;font:600 clamp(10px,11vh,13px)/1.65 ${systemFontStack};pointer-events:none}
body[data-wanwu-motion="barrage"] #wanwu-motion .notice-message{padding:4px 2px;border:0;background:transparent;text-shadow:none}
body[data-wanwu-motion="barrage"] #wanwu-motion .notice-message:nth-child(even){color:#426658}
`;
function canvasRuntime({compact,mode,channel,title}){
 const send=type=>parent.postMessage({type,channel},'*');
 if(channel)send('wanwu-announcement-ready');
 if(!compact)return;
 // The board owns the title. Hide only a matching first headline in older cards.
 const headline=document.body.querySelector('h1,h2,[data-announcement-title]');
 if(headline?.textContent.trim()===(title?.trim()||'公告')){headline.hidden=true;headline.style.setProperty('display','none','important');}
 let pauseUntil=0,pauseTimer=0,hover=false,focused=false,suspended=false,last=0,waitUntil=0,scroller,carry=0;
 const flights=new Set(),syncFlights=()=>{for(const animation of flights)document.hidden||suspended||hover||focused||performance.now()<pauseUntil?animation.pause():animation.play();};
 const reduced=matchMedia('(prefers-reduced-motion:reduce)');
 // Opaque-origin iframes can miss pointerleave; the frame owner also reports its boundary.
 window.addEventListener('message',e=>{if(e.source!==parent||!channel||e.data?.channel!==channel||e.data?.type!=='wanwu-announcement-hover')return;hover=e.data.hovered===true;last=0;syncFlights();});
 const pause=(duration=12000)=>{clearTimeout(pauseTimer);pauseUntil=performance.now()+duration;syncFlights();pauseTimer=setTimeout(()=>{pauseUntil=0;last=0;syncFlights();},duration);};
 document.addEventListener('wheel',()=>pause(),{passive:true});
 // Touch scrolling the office must not permanently turn its announcement static.
 const touchPause=()=>{hover=false;focused=false;pause(1200);};
 document.addEventListener('touchstart',touchPause,{passive:true});document.addEventListener('touchmove',touchPause,{passive:true});document.addEventListener('touchend',touchPause,{passive:true});document.addEventListener('touchcancel',touchPause,{passive:true});
 document.addEventListener('pointerover',e=>{if(e.pointerType!=='mouse'&&e.pointerType!=='pen')return;if(!hover)send('wanwu-announcement-pointer-enter');hover=true;syncFlights();});document.documentElement.addEventListener('pointerleave',()=>{hover=false;last=0;syncFlights();});
 document.addEventListener('focusin',e=>{focused=!!e.target.closest?.('a,button,input,select,textarea,summary,[tabindex],[contenteditable="true"]');syncFlights();});document.addEventListener('focusout',()=>{focused=false;syncFlights();});
 const resume=()=>{if(document.hidden)return;suspended=false;hover=false;focused=false;pauseUntil=0;clearTimeout(pauseTimer);last=0;syncFlights();};
 document.addEventListener('visibilitychange',()=>document.hidden?syncFlights():resume());
 window.addEventListener('pagehide',()=>{suspended=true;syncFlights();});window.addEventListener('pageshow',resume);
 document.addEventListener('click',e=>{if(e.target.closest('a,button,input,select,textarea,summary,[role="button"]')||getSelection()?.toString())return;send('wanwu-announcement-open');});
 if((mode==='marquee'||mode==='barrage')&&!reduced.matches){
  // Read each text node once: nested list paragraphs and <br> must not duplicate a message.
  const messages=[],seen=new Set();let runs=[];
  const flush=()=>{const value=runs.map(r=>r.text).join('').replace(/\s+/g,' ').trim();if(value&&!seen.has(value)){seen.add(value);messages.push({text:value,runs});}runs=[];};
  const read=(node,color='')=>{
   if(node.nodeType===3){runs.push({text:node.textContent.replace(/\s+/g,' '),color});return;}
   if(node.nodeType!==1||node.matches('script,style,svg,canvas,button,input,select,textarea,[hidden],[aria-hidden="true"]'))return;
   const style=getComputedStyle(node);if(style.display==='none'||style.visibility==='hidden')return;
   color=node.style.color||node.getAttribute('data-announcement-color')||color;
   if(node.tagName==='BR'){flush();return;}
   const block=/^(H[1-6]|P|LI|TR|DIV|SECTION|ARTICLE|UL|OL|BLOCKQUOTE|FIGCAPTION)$/.test(node.tagName);
   if(block)flush();
   if(node.matches('td,th')&&runs.length)runs.push({text:' · ',color});
   for(const child of node.childNodes)read(child,color);
   if(block)flush();
  };
  for(const node of document.body.childNodes)read(node);flush();
  if(messages.length){
   const root=document.createElement('div');root.id='wanwu-motion';root.setAttribute('role','img');root.setAttribute('aria-label',messages.map(m=>m.text).join('\n'));
   const textWrappers=[];
   for(const node of [...document.body.childNodes])if(node.nodeType===3&&node.textContent.trim()){const wrapper=document.createElement('span');node.replaceWith(wrapper);wrapper.append(node);textWrappers.push(wrapper);}
   document.body.dataset.wanwuMotion=mode;document.body.append(root);
   const queue=mode==='marquee'?[{runs:messages.flatMap((m,i)=>i?[{text:'　·　',color:''},...m.runs]:m.runs)}]:messages;
   let stopped=false,width=0,height=0,cursor=0,laneCursor=0,lanes=[],raf=0;
   const active=new Set(),speed=mode==='marquee'?36:52,gap=34;
   const cancel=()=>{for(const animation of flights){animation.onfinish=null;animation.cancel();}flights.clear();active.clear();root.replaceChildren();};
   const makeItem=index=>{
    const item=document.createElement('span');item.className='notice-message';item.setAttribute('aria-hidden','true');
    for(const run of queue[index].runs){const span=document.createElement('span');span.textContent=run.text;if(run.color){span.style.color=run.color;span.setAttribute('data-announcement-color',run.color);}item.append(span);}
    return item;
   };
   const launch=(lane,index)=>{
    const item=makeItem(index);item.dataset.lane=String(lane);root.append(item);
    const itemWidth=item.offsetWidth;item.style.top=Math.max(0,(lane+.5)*height/lanes.length-item.offsetHeight/2)+'px';
    const animation=item.animate([{transform:`translateX(${width+8}px)`},{transform:`translateX(${-itemWidth-8}px)`}],{duration:(width+itemWidth+16)/speed*1000,easing:'linear',fill:'both'});
    active.add(index);flights.add(animation);lanes[lane]={animation,width:itemWidth};syncFlights();
    animation.onfinish=()=>{flights.delete(animation);active.delete(index);item.remove();animation.cancel();};
   };
   const fill=()=>{
    if(stopped||document.hidden||suspended||hover||focused||performance.now()<pauseUntil)return;
    // All lanes share one velocity. A new item enters as soon as the previous
    // tail clears the entry gap, while that previous item is still on screen.
    const startLane=laneCursor;
    for(let step=0;step<lanes.length;step++){
     const lane=(startLane+step)%lanes.length,tail=lanes[lane];
     if(tail&&flights.has(tail.animation)&&width+8+tail.width-Number(tail.animation.currentTime||0)*speed/1000>width-gap)continue;
     let index=cursor,checked=0;while(active.has(index)&&checked<queue.length){index=(index+1)%queue.length;checked++;}
     if(checked===queue.length)break;
     launch(lane,index);cursor=(index+1)%queue.length;laneCursor=(lane+1)%lanes.length;
    }
   };
   const layout=()=>{
    if(stopped)return;
    const w=root.clientWidth,h=root.clientHeight;if(w===width&&h===height)return;
    width=w;height=h;cancel();if(!w||!h)return;
    const probe=makeItem(0);root.append(probe);const pitch=Math.max(34,probe.offsetHeight+12);probe.remove();
    lanes=Array.from({length:mode==='marquee'?1:Math.max(1,Math.floor(h/pitch))},()=>null);fill();
   };
   const tick=()=>{fill();if(!stopped)raf=requestAnimationFrame(tick);};
   layout();raf=requestAnimationFrame(tick);const observer=new ResizeObserver(layout);observer.observe(root);
   // Wheel and keyboard always offer a way to read the complete static content.
   const reveal=()=>{stopped=true;cancelAnimationFrame(raf);observer.disconnect();cancel();root.remove();delete document.body.dataset.wanwuMotion;for(const wrapper of textWrappers)wrapper.replaceWith(...wrapper.childNodes);};document.addEventListener('wheel',reveal,{once:true,passive:true});document.addEventListener('keydown',e=>{if(['ArrowDown','ArrowUp','PageDown','PageUp','Home','End'].includes(e.key))reveal();});
   reduced.addEventListener('change',e=>{if(e.matches)reveal();});

  }
 }
 if(mode==='auto-scroll'){
  const choose=()=>{const root=document.scrollingElement;scroller=root;let most=root.scrollHeight-root.clientHeight;for(const e of document.body.querySelectorAll('*')){if(['auto','scroll'].includes(getComputedStyle(e).overflowY)&&e.scrollHeight-e.clientHeight>most){scroller=e;most=e.scrollHeight-e.clientHeight;}}};
  choose();new ResizeObserver(choose).observe(document.body);
  function tick(now){const dt=last?Math.min(now-last,50):0;last=now;
   if(!reduced.matches&&!document.hidden&&!suspended&&!hover&&!focused&&now>=pauseUntil&&now>=waitUntil&&scroller&&scroller.scrollHeight>scroller.clientHeight+2){
    if(scroller.scrollTop+scroller.clientHeight>=scroller.scrollHeight-1){scroller.scrollTop=0;waitUntil=now+2200;}else {carry+=dt*.022;const pixels=Math.floor(carry);if(pixels){scroller.scrollTop+=pixels;carry-=pixels;}}
   }requestAnimationFrame(tick);
  }waitUntil=performance.now()+2200;requestAnimationFrame(tick);
 }
}
