import {validateProjectScene} from './project-scene.mjs';
const clone=value=>structuredClone(value);
const changed=(a,b)=>JSON.stringify(a)!==JSON.stringify(b);
function diffFields(before={},after={},keys){
 const patch={};for(const key of keys)if(changed(before?.[key],after?.[key]))patch[key]=after?.[key]===undefined?null:clone(after[key]);return patch;
}
const paletteKeys=['wall','floor','tile','accent','wood','leaf'];
const boardKeys=['background','foreground','muted','border','accent','backgroundSvg'];
const artKeys=['rendering','floorSvg','wallSvg'];
const surfaceNames=['floor','walls','theme','boards.announcement','boards.canvas','boards.skills'];
export const isLockedOfficeEdit=mode=>mode==='style'||mode==='partial';
function replacementScope(scope){
 if(scope?.version!==1)throw Error('局部替换缺少 replacement-targets.json（version: 1）');
 for(const key of ['moduleIds','roomIds','surfaces'])if(!Array.isArray(scope[key])||scope[key].some(id=>typeof id!=='string'||!id)||new Set(scope[key]).size!==scope[key].length)throw Error(`局部替换范围 ${key} 必须是无重复的字符串数组`);
 if(scope.surfaces.some(s=>!surfaceNames.includes(s)))throw Error('局部替换包含未知的表面类型');
 if(!scope.moduleIds.length&&!scope.roomIds.length&&!scope.surfaces.length)throw Error('请明确局部替换的目标，不能提交空范围');
 return {version:1,moduleIds:[...scope.moduleIds],roomIds:[...scope.roomIds],surfaces:[...scope.surfaces]};
}
const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>Object.hasOwn(value||{},key)).map(key=>[key,clone(value[key])]));
function scopedPatch(patch){
 const scope=replacementScope(patch.scope),surfaces=new Set(scope.surfaces);
 return {...patch,scope,
  palette:pick(patch.palette,surfaces.has('theme')?paletteKeys:[...(surfaces.has('floor')?['floor','tile']:[]),...(surfaces.has('walls')?['wall']:[])]),
  appearance:pick(patch.appearance,[...(surfaces.has('theme')?['rendering']:[]),...(surfaces.has('floor')?['floorSvg']:[]),...(surfaces.has('walls')?['wallSvg']:[])]),
  boards:Object.fromEntries(['announcement','canvas','skills'].filter(key=>surfaces.has('boards.'+key)).map(key=>[key,pick(patch.boards?.[key],boardKeys)])),
  modules:(patch.modules||[]).filter(m=>scope.moduleIds.includes(m.id)),rooms:(patch.rooms||[]).filter(r=>scope.roomIds.includes(r.id)),
 };
}
function patchFields(target,patch,keys){for(const key of keys)if(Object.hasOwn(patch||{},key)){if(patch[key]===null)delete target[key];else target[key]=clone(patch[key]);}}
export function clearOfficeStyle(scene){const result=clone(scene);delete result.officeEditMode;delete result.officeStyle;return result;}
// Store visual differences, not a stale copy of the layout. Later application can
// preserve edits made by members while the model was still working.
export function officeStylePatch(base,candidate){
 const patch={version:1,palette:diffFields(base.palette,candidate.palette,paletteKeys),appearance:diffFields(base.appearance,candidate.appearance,artKeys),boards:{},modules:[],rooms:[]};
 for(const key of ['announcement','canvas','skills'])patch.boards[key]=diffFields(base.appearance?.boards?.[key],candidate.appearance?.boards?.[key],boardKeys);
 for(const item of base.modules){const next=candidate.modules?.find(m=>m.id===item.id&&m.kind===item.kind);if(next){const art=diffFields(item,next,['color','svg']);if(Object.keys(art).length)patch.modules.push({id:item.id,kind:item.kind,...art});}}
 for(const room of base.floorPlan?.rooms||[]){const next=candidate.floorPlan?.rooms?.find(r=>r.id===room.id);if(!next)continue;
  const doors=(room.doors||[]).flatMap(d=>{const n=next.doors?.find(n=>n.side===d.side&&n.offset===d.offset&&n.width===d.width);return n&&n.material!==d.material?[{side:d.side,offset:d.offset,width:d.width,material:n.material}]:[];});
  patch.rooms.push({id:room.id,...diffFields(room,next,['material']),doors});
 }
 return patch;
}
export function applyOfficeStyle(base,patch){
 if(![1,2].includes(patch?.version))throw Error('缺少有效的局部修改记录，请重新生成作品');
 if(patch.version===2)patch=scopedPatch(patch);
 const scene=clearOfficeStyle(base);
 patchFields(scene.palette,patch.palette,paletteKeys);
 const appearance=scene.appearance||{};patchFields(appearance,patch.appearance,artKeys);
 for(const key of ['announcement','canvas','skills']){const board={...appearance.boards?.[key]};patchFields(board,patch.boards?.[key],boardKeys);
  if(Object.keys(board).length)appearance.boards={...appearance.boards,[key]:board};else if(appearance.boards)delete appearance.boards[key];
 }
 if(appearance.boards&&!Object.keys(appearance.boards).length)delete appearance.boards;
 if(Object.keys(appearance).length)scene.appearance=appearance;else delete scene.appearance;
 for(const m of scene.modules){const update=patch.modules?.find(p=>p.id===m.id&&p.kind===m.kind);if(update)patchFields(m,update,patch.version===2?['name','color','svg']:['color','svg']);}
 for(const r of scene.floorPlan?.rooms||[]){const update=patch.rooms?.find(p=>p.id===r.id);if(!update)continue;patchFields(r,update,['material']);
  for(const d of r.doors||[]){const next=update.doors?.find(p=>p.side===d.side&&p.offset===d.offset&&p.width===d.width);if(next)patchFields(d,next,['material']);}
 }
 validateProjectScene(scene);return scene;
}
// Restrict changes to explicit stable IDs/surfaces, then apply to the latest
// layout. Neither an over-broad model rewrite nor a stale creation can move items.
export function officeReplacementPatch(base,candidate,targets){
 const scope=replacementScope(targets);
 for(const id of scope.moduleIds){const original=base.modules.find(m=>m.id===id),next=candidate.modules?.find(m=>m.id===id);
  if(!original||!next||next.kind!==original.kind)throw Error(`局部替换目标 ${id} 不存在或被删除/改变了类型；请保留原 ID 和 kind`);
 }
 for(const id of scope.roomIds)if(!base.floorPlan?.rooms?.some(r=>r.id===id)||!candidate.floorPlan?.rooms?.some(r=>r.id===id))throw Error(`局部替换房间 ${id} 不存在`);
 const patch=officeStylePatch(base,candidate);
 patch.modules=base.modules.filter(m=>scope.moduleIds.includes(m.id)).map(m=>({id:m.id,kind:m.kind,...diffFields(m,candidate.modules.find(n=>n.id===m.id),['name','color','svg'])}));
 const result=scopedPatch({...patch,version:2,scope});
 if(!changed(clearOfficeStyle(base),applyOfficeStyle(base,result)))throw Error('指定范围内没有可应用的修改；请实际修改目标的 SVG、名称或材质');
 return result;
}
export const officeReplacementContract=`LOCAL REPLACEMENT MODE (layout locked): Read output/office.json, PREVIOUS_OFFICE.json and EXISTING_FURNITURE.json. Identify exactly the requested existing object(s) by stable module id and name. Replacing a plaque, lamp, rug or other object means redesigning its inline SVG and optionally its name/color IN PLACE, preserving ID, kind, dimensions, position, assetId, seats, physics, behavior, triggers, animation tracks and data-part anchors. Do not replace all objects of the same kind. Keep every non-target object unchanged. Preserve map dimensions, floor plan, door openings, device zones, walkable bounds and board rectangles. Do not prepare or reflow the layout. For a floor-only change, edit the actual rendered appearance.floorSvg when present; leave independent rugs unchanged. If geometry or behavior must change, explain that Redesign layout or the prop editor is needed rather than changing unrelated data.
Save the updated output/office.json AND output/replacement-targets.json with {"version":1,"moduleIds":[],"roomIds":[],"surfaces":[]}. These arrays list only explicitly requested targets: moduleIds for a specific plaque/prop/rug; roomIds for existing room/door MATERIALS; surfaces may contain "floor", "walls", "boards.announcement", "boards.canvas", "boards.skills" or "theme" (global palette/rendering ONLY when explicitly requested). A module-only replacement must leave roomIds/surfaces empty. Example: only the data-room plaque => {"version":1,"moduleIds":["the-existing-data-plaque-id"],"roomIds":[],"surfaces":[]}. Never invent IDs or broaden the scope to make validation pass. At least one target must actually change. Preserve pixel style unless requested otherwise; use the office-space-designer skill for materials/textiles. The host restricts the diff to this scope, locks geometry/interaction data, renders background.svg, and applies it to the latest layout so concurrent moves survive.`;
export const officeStyleContract=`STYLE-ONLY EDIT MODE (layout locked): Read output/office.json as the exact current layout. Change only requested colors, textures and visual artwork, such as palette, appearance.floorSvg/wallSvg/boards, module color/svg and room/door materials. Preserve every object's ID, kind, position, dimensions, count, interactions, animation anchors and seating. Preserve map dimensions, rooms, door openings, device zones, walkable bounds and all three board rectangles. Do not run floor-plan preparation, reflow, add, remove, resize or move furniture, devices or props. If the request mentions a room while changing its material, change that room's material only. A floor change must not recolor unrelated rugs or furniture. Preserve pixel style unless explicitly asked otherwise. Read the office-space-designer skill's material/textile guidance for attractive surface detail. The host enforces these geometry constraints and applies only visual differences to the latest project layout. Save output/office.json; the host renders background.svg.`;
