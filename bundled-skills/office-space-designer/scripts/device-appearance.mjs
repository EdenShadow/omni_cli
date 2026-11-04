import {validatePropArt} from './prop-art.mjs';
import {propAnimationStyle,validatePropAnimations} from './prop-animation.mjs';
// The canvas extends up and sideways from the original ground anchor.
const defaultCanvas = {width:408, height:328};

export function deviceAppearanceSummary(assetId, name, manifest) {
  const summary = {assetId, name};
  if (manifest.canvas) summary.canvas = {width:manifest.canvas.width, height:manifest.canvas.height};
  if (manifest.patrol) summary.patrol = manifest.patrol;
  if (manifest.iconPath) summary.iconPath = manifest.iconPath;
  return summary;
}
export function validateDeviceAppearance(manifest,art){
 if(![1,2].includes(manifest?.schemaVersion)||manifest.kind!=='device'||manifest.art!=='device.svg'||typeof manifest.name!=='string'||!manifest.name.trim()||manifest.name.length>80)throw Error('设备外观需要 schemaVersion:1 或 2、kind:device、名称和 art:device.svg');
 validatePropArt(art,{allowText:true});
 const box=art.match(/^\s*<svg\b[^>]*\bviewBox\s*=\s*["']([^"']+)["']/)?.[1].trim().split(/[ ,]+/).map(Number);
 const canvas = manifest.canvas === undefined ? defaultCanvas : manifest.canvas;
 if (!canvas || !Number.isInteger(canvas.width) || canvas.width < 408 || canvas.width > 816 ||
     !Number.isInteger(canvas.height) || canvas.height < 328 || canvas.height > 656) {
   throw Error('设备画幅宽度须为 408–816，高度须为 328–656');
 }
 if (box?.length !== 4 || box[0] !== 0 || box[1] !== 0 || box[2] !== canvas.width || box[3] !== canvas.height) {
   throw Error('设备 SVG viewBox 必须匹配 device.json 的 canvas，默认 0 0 408 328');
 }
 if (manifest.iconPath !== undefined && (typeof manifest.iconPath !== 'string' ||
     manifest.iconPath.length > 2048 || !/^[Mm](?=[\s.0-9+-])[MmLlHhVvCcSsQqTtAaZzEe0-9.,+\s-]+$/.test(manifest.iconPath))) {
   throw Error('设备图标需要 24 × 24 画布内的单色 SVG 路径数据');
 }
 if (manifest.patrol !== undefined) {
   const route = manifest.patrol;
   const bounded = (v, min, max) => Number.isFinite(v) && v >= min && v <= max;
   if (manifest.schemaVersion !== 2 || !route || !bounded(route.duration, 600, 60000) ||
       !bounded(route.returnMs, 150, 3000) || !Array.isArray(route.points) ||
       route.points.length < 1 || route.points.length > 12 ||
       !route.points.every(p => p && bounded(p.x,-25,25) && bounded(p.y,-25,25)) ||
       !route.points.some(p => p.x || p.y)) {
     throw Error('工作路线需要 1–12 个有效位移点，x/y 为画幅百分比（±25），并指定工作周期与回位时间');
   }
 }
 if(manifest.animations!==undefined){
  if(manifest.schemaVersion!==2||!manifest.animations||typeof manifest.animations!=='object'||Array.isArray(manifest.animations)||Object.keys(manifest.animations).some(k=>!['idle','working','returning'].includes(k)))throw Error('设备动画需要 schemaVersion:2，支持 idle / working / returning 状态');
  validatePropAnimations(manifest.animations.idle,art);
  validatePropAnimations(manifest.animations.working,art);
  validatePropAnimations(manifest.animations.returning,art);
 }
 return true;
}
// Static remains the default for old assets, thumbnails and reduced/hidden views.
export function renderDeviceArt(manifest,art,state='static'){
 validateDeviceAppearance(manifest,art);
 const tracks=manifest.schemaVersion===2&&state!=='static'&&['idle','working','returning'].includes(state)
  ? manifest.animations?.[state]??(state==='returning'?manifest.animations?.working:undefined)??manifest.animations?.idle : undefined;
 const {scope,css}=propAnimationStyle(art,tracks);
 return art.replace(/<svg\b([^>]*)>/,(_,attrs)=>`<svg xmlns="http://www.w3.org/2000/svg"${attrs.replace(/\sxmlns\s*=\s*["'][^"']*["']/g,'')}${scope?` data-prop-animation="${scope}"`:''}>${css?`<style>${css}</style>`:''}`);
}
export const defaultDeviceManifest={schemaVersion:1,kind:'device',name:'经典电脑桌',art:'device.svg'};
export const defaultDeviceArt=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 408 328" shape-rendering="crispEdges"><path d="M8 186H394V278H8Z" fill="#bb8e64"/><path d="M20 278H42V324H20ZM360 278H382V324H360Z" fill="#986b45"/><path d="M8 182H384V260H8Z" fill="#e4b681"/><path d="M16 190H376V250H16Z" fill="#edc58f"/><path d="M384 190H400V268H384Z" fill="#8e6949"/><path d="M93 8H305V152H93Z" fill="#51495f"/><path d="M101 14H297V140H101Z" fill="#9a8caa"/><path d="M111 23H287V130H111Z" fill="#eee7fb"/><path d="M190 146H210V185H190Z" fill="#786b87"/><path d="M159 183H251V197H159Z" fill="#675b76"/><path d="M110 207H266V233H110Z" fill="#dad2df"/><path d="M123 213H254M123 220H254M134 208V232M153 208V232M172 208V232M191 208V232M210 208V232M229 208V232" fill="none" stroke="#b7a9c0" stroke-width="2"/><path d="M137 48H180V98H137Z" fill="#8170ab"/><path d="M199 47H269V55H199ZM199 68H255V76H199ZM199 89H242V97H199Z" fill="#c9bce4"/></svg>`;
export const deviceAppearanceContract=`Use the office-space-designer skill in DEVICE APPEARANCE mode. Read references/device-appearance.md and SCENE_CONTEXT.json. Create only output/device.json and output/device.svg. Design a creative device appearance, NOT a real device or standalone prop. A desk is OPTIONAL: a bouncing ball carrying a computer, floating UFO terminal, cloud computer or robotic arm are all valid. These are inspiration examples, NOT an allowlist or fixed templates; follow any user-imagined device form and motion within the rendering constraints. Preserve the user's requested shape, components and aesthetic. Default to STATIC artwork with {"schemaVersion":1,"kind":"device","name":"short design name","art":"device.svg"}. Only when the user requests motion, use schemaVersion:2 and animations:{idle:[tracks],working:[tracks]}. Read references/prop-animation.md for bounded tracks. Each track targets a unique g[data-part], with duration 600–60000ms and 2–16 frames of x/y/rotate/scale/opacity; maximum 16 tracks per state. idle plays normally; working plays during real device tasks. Omit working to keep the idle animation, or use working:[] for a static working state. A working-only animation leaves idle static. Do NOT invent animation when none was requested. For scrolling terminal text use clipped groups; for bouncing figures or floating bodies leave margins for the full motion. Default viewBox is "0 0 408 328". For tall digital employees and wider motion, set optional manifest.canvas={width,height}, integers 408–816 by 328–656, and match the SVG viewBox. Display scale is one half, centered on the same feet. Budget margins for extreme poses. For roaming employees use v2 patrol with duration, returnMs, and points [{x,y}] in percentages of the viewport. The host loops while working and returns smoothly from the current position when work stops. Optional animations.returning controls the run home without work effects. Use working tracks for footsteps, gestures and falling effects; hide effects in static art. Optional iconPath is a single 24x24 outline SVG path d with rounded strokes, only change when the user requests a list icon. Preserve an existing icon on unrelated edits. Computer instances can have independent designs. Keep all poses within this transparent canvas and preserve the existing world footprint and click target. The base SVG must be a complete, visible and attractive static pose without animation CSS: older clients display this same pose even for v2 assets. Never rely on animation to reveal initially hidden artwork. A grounded desk can have feet near y=320, but a floating design need not. It is visual art: never edit or infer real hardware inventory, accounts, sessions or bindings. Default to dimensional pixel artwork matching office scale. When the user requests DIY or another visual language, follow that direction with original silhouettes, smooth curves, illustration, linework or layered forms instead of forcing pixel edges. Keep the fixed footprint, click target and visual proportions aligned with the scene. For edits use existing device.json and device.svg as master; preserve unrelated parts and any requested existing motion. Inline static SVG shapes and short text/tspan labels are allowed. SVG source must NOT contain images, use, links, href/src, style, gradients, scripts, event handlers, SMIL or external resources. Animation is JSON data compiled by the host, never executable code. Set colors directly on shapes. No scene walls/background, member avatars, floating name labels, session bubbles or status badges. Decorative toy figures are allowed when requested. No seats, physics or prop triggers. Save actual files and validate with node <skill>/scripts/validate-device.mjs output/device.json. The host previews normal/working states; the user explicitly applies the appearance to one project device, shared live. Generation alone does not apply it.`;
