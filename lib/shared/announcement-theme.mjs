// Theme the sandbox's HTML surfaces, never invert artwork or rewrite saved content.
export const announcementThemeStyles = `
html[data-wanwu-theme="dark"]{color-scheme:dark;background:#191b1f!important;scrollbar-color:#50545d #191b1f}
html[data-wanwu-theme="dark"] body{background:#191b1f!important;color:#e5e7eb!important}
html[data-wanwu-theme="dark"] [data-wanwu-surface]{background-color:#24272c!important;border-color:#383d45!important;box-shadow:none!important}
html[data-wanwu-theme="dark"] [data-wanwu-gradient]{background-image:none!important}
html[data-wanwu-theme="dark"] [data-wanwu-ink]{color:var(--wanwu-night-ink,#e5e7eb)!important;text-shadow:none!important}
html[data-wanwu-theme="dark"] :is(a,button,input,select,textarea){color:#c2b5df;border-color:#414650}
html[data-wanwu-theme="dark"] :is(th,td,hr,blockquote){border-color:#414650!important}
html[data-wanwu-theme="dark"] #wanwu-motion .notice-message{background:#24272c;color:#e5e7eb;border-color:#ab9acb;text-shadow:none}
html[data-wanwu-theme="dark"] body[data-wanwu-motion="barrage"] #wanwu-motion .notice-message{background:transparent;text-shadow:none}
html[data-wanwu-theme="dark"] body[data-wanwu-motion="barrage"] #wanwu-motion .notice-message:nth-child(even){color:#abd3c0}
`;

// Serialized into the existing opaque-origin announcement sandbox.
export function applyAnnouncementTheme({theme='light',channel=''}) {
 const root=document.documentElement;
 const rgb=value=>{const parts=value.match(/[\d.]+/g)?.map(Number);return parts?.length>=3?parts:null;};
 const brightness=c=>c[0]*.2126+c[1]*.7152+c[2]*.0722;
 const adapt=()=>{
  // Read authored colors with the host overrides disabled, including inherited colors.
  root.dataset.wanwuTheme='light';
  const changes=[];
  for(const el of document.body.querySelectorAll('*')){
   if(!(el instanceof HTMLElement)||el.closest('svg,canvas,picture,video,script,style'))continue;
   const s=getComputedStyle(el),bg=rgb(s.backgroundColor),fg=rgb(s.color);
   if(el.style.color)el.setAttribute('data-announcement-color',el.style.color);
   const gradient=s.backgroundImage.includes('gradient(')&&[...s.backgroundImage.matchAll(/rgba?\([^)]+\)/g)].every(m=>brightness(rgb(m[0])||[0,0,0])>170);
   changes.push({el,surface:!!bg&&(bg[3]??1)>.15&&brightness(bg)>170,gradient,ink:!el.closest('[data-announcement-color]')&&fg&&brightness(fg)<180?fg.map((v,i)=>i<3?Math.round(v*.23+235*.77):v).slice(0,3):null});
  }
  for(const {el,surface,gradient,ink} of changes){
   el.toggleAttribute('data-wanwu-surface',surface);
   el.toggleAttribute('data-wanwu-gradient',gradient);
   el.toggleAttribute('data-wanwu-ink',!!ink);
   if(ink)el.style.setProperty('--wanwu-night-ink','rgb('+ink.join(',')+')');
  }
  root.dataset.wanwuTheme=theme;root.style.colorScheme=theme;
 };
 let queued=false;
 const schedule=()=>{if(theme!=='dark'||queued)return;queued=true;requestAnimationFrame(()=>{queued=false;adapt();});};
 if(theme==='dark')adapt();else root.dataset.wanwuTheme='light';
 new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true});
 window.addEventListener('message',e=>{
  if(e.source!==parent||!channel||e.data?.channel!==channel||e.data.type!=='wanwu-announcement-theme'||!['light','dark'].includes(e.data.theme))return;
  theme=e.data.theme;if(theme==='dark')adapt();else root.dataset.wanwuTheme=theme;root.style.colorScheme=theme;
 });
}
