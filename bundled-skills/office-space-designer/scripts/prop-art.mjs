import {explicitSeatCapacity, evenlySpacedSeats} from './seat-capacity.mjs';
import {validatePropTrigger} from './prop-triggers.mjs';
import {validatePropPhysics} from './prop-interactions.mjs';
import {propAnimationStyle,validatePropAnimations} from './prop-animation.mjs';
export function validatePropArt(art, {allowText=false}={}) {
  if (typeof art !== 'string' || art.length > 160000 || !/^\s*<svg\b[^>]*>[\s\S]*<\/svg>\s*$/.test(art)) throw Error('道具需要独立的 SVG，最大 160 KB');
  const clean = art.replace(/<!--[\s\S]*?-->/g, '');
  const allowed = new Set(['svg','g','path','rect','circle','ellipse','line','polyline','polygon','defs','clipPath','title','desc']);
  if(allowText){allowed.add('text');allowed.add('tspan');}
  for (const tag of clean.matchAll(/<\/?([^\s/>]+)/g)) if (!allowed.has(tag[1])) throw Error('道具 SVG 只支持静态内联形状');
  if (/\s(?:[\w-]+:)?(?:href|src|style|on[\w-]+)\s*=|<!|<\?|@import|javascript:|url\(\s*['"]?[^#]/i.test(clean)) throw Error('道具 SVG 不能包含脚本、样式或外部引用');
  const viewBox = clean.match(/^\s*<svg\b[^>]*\bviewBox\s*=\s*["']([^"']+)["']/)?.[1].trim().split(/[ ,]+/).map(Number);
  if (!viewBox || viewBox.length !== 4 || !viewBox.every(Number.isFinite) || viewBox[2] <= 0 || viewBox[3] <= 0) throw Error('道具 SVG 需要有效 viewBox');
  return true;
}
export function propSeats(manifest) {
  if (manifest.seats?.length === 0) return [];
  const seatable = /沙发|椅|sofa|couch|armchair|bench/i.test(manifest.name || '');
  const capacity = seatable ? explicitSeatCapacity(manifest.name) : undefined;
  if (capacity && manifest.seats?.length !== capacity) return evenlySpacedSeats(capacity, manifest.seats?.[0]?.y ?? 68);
  return manifest.seats ?? (seatable ? evenlySpacedSeats(1) : []);
}
export function validatePropSeats(seats) {
  if (!Array.isArray(seats)||seats.length>8||seats.some(p=>!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<5||p.x>95||p.y<5||p.y>95)) throw Error('道具坐点须为 0–8 个有效的内部百分比坐标');
}
export function validateProp(manifest, art) {
  if (manifest?.schemaVersion !== 1 || manifest.kind !== 'prop' || manifest.art !== 'prop.svg' || typeof manifest.name !== 'string' || !manifest.name.trim() || manifest.name.length > 80) throw Error('道具描述需要名称、kind: prop 和 art: prop.svg');
  for (const key of ['width','height']) if (!Number.isInteger(manifest[key]) || manifest[key] < 1 || manifest[key] > 12) throw Error('道具宽高必须为 1–12 格');
  if (manifest.walkThrough !== undefined && typeof manifest.walkThrough !== 'boolean') throw Error('道具可穿行属性无效');
  if (manifest.seats !== undefined) validatePropSeats(manifest.seats);
  validatePropPhysics(manifest.physics);
  validatePropTrigger(manifest.trigger);
  validatePropAnimations(manifest.animations,art);
  return validatePropArt(art);
}
export function renderPropArt(art,animations) {
  validatePropArt(art);
  const {scope,css}=propAnimationStyle(art,animations);
  return art.replace(/<svg\b([^>]*)>/,(_,attrs)=>`<svg xmlns="http://www.w3.org/2000/svg"${attrs.replace(/\sxmlns\s*=\s*["'][^"']*["']/g,'')}${scope?` data-prop-animation="${scope}"`:''}>${css?`<style>${css}</style>`:''}`);
}
export function fitPropArt(art, width, height, animations) {
  return renderPropArt(art,animations).replace(/<svg\b([^>]*)>/,(_,attrs)=>`<svg${attrs.replace(/\s(?:width|height|preserveAspectRatio)\s*=\s*["'][^"']*["']/g,'')} width="${width}" height="${height}" preserveAspectRatio="xMidYMax meet">`);
}
