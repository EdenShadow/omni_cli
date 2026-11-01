// Declarative world behavior. Source SVG remains a complete, inert static fallback.
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
function keys(x,allowed){if(!object(x)||Object.keys(x).some(k=>!allowed.includes(k)))throw Error('道具行为包含不支持的字段');}
function number(x,min,max,label){if(!Number.isFinite(x)||x<min||x>max)throw Error(`${label}须为 ${min}–${max}`);}
export function validatePropBehavior(behavior,art,validateArt){
 if(behavior===undefined)return;
 keys(behavior,['movement','trail']);
 const m=behavior.movement;if(!m)throw Error('自主道具需要 movement');
 keys(m,['mode','pattern','radius','speed','travelSeconds','chargeSeconds','waypoints','part','facing']);
 if(!['air','ground'].includes(m.mode)||!['wander','route'].includes(m.pattern))throw Error('移动需要 air/ground 与 wander/route');
 number(m.radius,1,24,'活动半径（格）');number(m.speed,.2,4,'速度（格/秒）');number(m.travelSeconds,5,300,'续航（秒）');number(m.chargeSeconds,2,300,'充电/停靠时间（秒）');
 if(m.facing!==undefined&&!['left','right','fixed'].includes(m.facing))throw Error('默认朝向支持 left / right / fixed');
 if(m.pattern==='route'){
  if(!Array.isArray(m.waypoints)||!m.waypoints.length||m.waypoints.length>12)throw Error('固定路线需要 1–12 个相对停靠点的坐标');
  for(const p of m.waypoints){keys(p,['x','y']);if(!Number.isFinite(p.x)||!Number.isFinite(p.y)||Math.hypot(p.x,p.y)>m.radius)throw Error('路线点须在活动半径内');}
 }else if(m.waypoints!==undefined)throw Error('自主巡游不使用固定路线点');
 if(m.part!==undefined){
  const source=String(art||'').replace(/<!--[\s\S]*?-->/g,'');
  if(typeof m.part!=='string'||!/^[-a-zA-Z0-9_]{1,48}$/.test(m.part)||(source.match(new RegExp(`<g\\b[^>]*\\sdata-part\\s*=\\s*["']${m.part}["']`,'g'))||[]).length!==1)throw Error('移动部位需要 SVG 中唯一的 g[data-part]');
 }
 if(behavior.trail!==undefined){
  const t=behavior.trail;keys(t,['svg','size','everySeconds','lifetimeSeconds','maxItems','onTouch','onTimer']);
  if(typeof t.svg!=='string'||t.svg.length>16000)throw Error('留下的物品需要不超过 16 KB 的 SVG');
  validateArt(t.svg,{allowText:true});number(t.size,.25,2,'物品尺寸（格）');number(t.everySeconds,2,60,'留下物品的间隔（秒）');number(t.lifetimeSeconds,3,120,'物品保留时间（秒）');
  if(!Number.isInteger(t.maxItems)||t.maxItems<1||t.maxItems>12)throw Error('同时最多保留 1–12 个物品');
  if(!t.onTouch&&!t.onTimer)throw Error('物品需要 onTouch 或 onTimer');
  for(const [kind,a] of [['onTouch',t.onTouch],['onTimer',t.onTimer]]){
   if(a===undefined)continue;
   keys(a,['radius','effect','colors','text','score','emotion','duration',...(kind==='onTimer'?['delaySeconds']:[])]);
   number(a.radius,.25,kind==='onTimer'?5:2,'互动范围（格）');number(a.duration,600,5000,'互动时长（毫秒）');
   if(kind==='onTimer'){number(a.delaySeconds,1,60,'倒计时（秒）');if(a.delaySeconds>=t.lifetimeSeconds)throw Error('倒计时必须短于物品保留时间');if(a.delaySeconds>=t.everySeconds*t.maxItems)throw Error('倒计时须短于物品数量上限覆盖的时间');if(a.score!==undefined)throw Error('定时效果不发放拾取积分');}
   if(!['confetti','glow','explosion'].includes(a.effect))throw Error('效果支持 confetti / glow / explosion');
   if(!Array.isArray(a.colors)||!a.colors.length||a.colors.length>4||a.colors.some(c=>!/^#[\da-f]{6}$/i.test(c)))throw Error('互动效果需要 1–4 个十六进制颜色');
   if(a.text!==undefined&&(typeof a.text!=='string'||a.text.length>24))throw Error('互动文字最多 24 字');
   if(a.score!==undefined&&(!Number.isInteger(a.score)||a.score<0||a.score>100))throw Error('加分须为 0–100 的整数');
   if(a.emotion!==undefined&&!['idle','done','tired','working','pranked','dancing'].includes(a.emotion))throw Error('表情支持 idle / done / tired / working / pranked / dancing');
  }
 }
}
export function validateBehaviorCompatibility(module){
 if(module.behavior&&(module.physics||module.trigger||module.seats?.length||module.canvasId))throw Error('自主移动道具不能同时绑定座位、踢球、画布或静态点击热点');
}
export function behaviorFingerprint(value){let h=2166136261;const s=JSON.stringify(value);for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);return(h>>>0).toString(36);}
// Split only for display; the saved asset still shows both the dock and traveler.
export function behaviorLayerSvg(svg,part,layer){
 if(!part)return layer==='dock'?'':svg;
 const css=layer==='dock'?`[data-part="${part}"]{display:none!important}`:`svg *{visibility:hidden}[data-part="${part}"],[data-part="${part}"] *{visibility:visible}`;
 return svg.replace(/(<svg\b[^>]*>)/,`$1<style>${css}</style>`);
}
export const propBehaviorContract=`AUTONOMOUS PROPS: For requested patrol, flight, roaming, return-to-dock or battery logic, read references/prop-behavior.md in office-space-designer. Use behavior.movement, with air/ground navigation, wander/route, radius, speed, travelSeconds, chargeSeconds, optional relative waypoints, facing (authored left/right, or fixed for front-facing/symmetric art), and a separate SVG data-part for the traveler so its dock stays fixed. For requested trails/pickups/traps, compose behavior.trail with custom inert SVG artwork and onTouch (effect, optional score/text/emotion) and/or onTimer (delaySeconds, radius, effect, colors, duration, optional text/emotion). Countdown is authoritative on the server and affects nearby members without crossing walls. Use emotion:"pranked" for 被整了 / Pranked, not tired, or emotion:"dancing" for 跳舞 / Dance; every existing character has a default and new characters may author their own. Both triggers consume a shared item exactly once. The host handles shared time, ground pathfinding, battery reserve, return, single shared collection and temporary character reactions. For ground side-view travelers, authored facing defaults to right and the host mirrors only the traveler when moving left; symmetric/front-facing art uses fixed. Patrols explore reachable space until the return reserve is needed, then recharge and depart without an extra idle cycle. Design the footprint for the actual passages; verify a reachable outbound patrol lasts longer than trail.everySeconds and verify timed effects as well as return-to-dock. Default props are static. Local animations are separate; never pretend rotating blades alone implements world travel. Preserve behavior metadata and SVG part anchors on edits. Only output prop.json and prop.svg.`;

export function assertRequestedPropBehavior(manifest,prompt=''){
 const parts=String(prompt).split(/[，。；,;\n]/).filter(s=>!/(不要|不用|无需|禁止|静态|\b(?:no|without|not|static)\b)/i.test(s));
 if(parts.some(s=>/巡游|巡逻|自动返[航回]|自己.{0,8}(飞|走)|寻路|低电.{0,6}(回|充)|自主移动|patrol|roam|return to (?:dock|home)|pathfinding/i.test(s))&&!manifest.behavior?.movement)throw Error('用户要求在办公室自主移动：请读取 prop-behavior.md 并输出 behavior.movement，不能仅用局部动画代替。');
 if(parts.some(s=>/(留下|掉落|放下|投放|扔|放).{0,12}(便便|物品|道具|炸药|炸弹|金币)|(?:drop|throw|place).{0,12}(?:bomb|item|pickup|trail)/i.test(s))&&!manifest.behavior?.trail)throw Error('用户要求留下可互动的物品：请输出 behavior.trail 与 onTouch 或 onTimer。');
 const reactions=[manifest.behavior?.trail?.onTouch,manifest.behavior?.trail?.onTimer].filter(Boolean);
 if(parts.some(s=>/(?:角色|人物|人|成员).{0,16}(?:被整|石化|焦黑)|(?:触发|切换).{0,12}被整|(?:character|member).{0,20}pranked/i.test(s))&&!reactions.some(a=>a.emotion==='pranked'))throw Error('用户要求角色切换到被整了表情：触发器须设置 emotion:"pranked"，text 只显示文字，不能代替角色表情。');
}
