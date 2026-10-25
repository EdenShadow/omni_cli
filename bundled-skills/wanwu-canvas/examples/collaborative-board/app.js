/* No local-only drawing model: objects commit to Wanwu; previews are disposable. */
(async()=>{
 const api=window.Wanwu,collab=api.collab,$=id=>document.getElementById(id),svg=$('board'),surface=$('surface'),records=new Map(),previews=new Map();
 const english=new URLSearchParams(location.search).get('lang')==='en'||navigator.language.startsWith('en');
 document.documentElement.lang=english?'en':'zh-CN';for(const el of document.querySelectorAll('[data-zh]'))el.textContent=el.dataset[english?'en':'zh'];
 let actor,tool='pen',drawing,online=false,lastPublish=0;
 const status=text=>$('status').textContent=text,error=e=>$('error').textContent=e?.message||String(e||'');
 const point=e=>{const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(svg.getScreenCTM().inverse());return {x:Math.round(p.x*10)/10,y:Math.round(p.y*10)/10};};
 const project=p=>{const r=surface.getBoundingClientRect(),v=new DOMPoint(p.x,p.y).matrixTransform(svg.getScreenCTM());return {x:v.x-r.left,y:v.y-r.top};};
 collab.mountCursors(surface,{project});
 function node(d,id){
  if(!d||!['path','rect','ellipse'].includes(d.type))return null;
  const n=document.createElementNS(svg.namespaceURI,d.type),color=/^#[a-f\d]{6}$/i.test(d.color||'')?d.color:'#5b58cf';
  n.dataset.objectId=id;n.setAttribute('stroke',color);n.setAttribute('stroke-width',Math.min(24,Math.max(1,Number(d.strokeWidth)||4)));n.setAttribute('fill','none');n.setAttribute('stroke-linecap','round');n.setAttribute('stroke-linejoin','round');n.setAttribute('opacity',d.marker?'.4':'1');
  if(d.type==='path'){
   if(!Array.isArray(d.points)||d.points.length>4000)return null;const points=d.points.filter(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite));if(!points.length)return null;if(points.length===1)points.push([points[0][0]+.01,points[0][1]]);n.setAttribute('d',points.map((p,i)=>(i?'L':'M')+p.join(' ')).join(' '));
  }else{for(const key of d.type==='rect'?['x','y','width','height']:['cx','cy','rx','ry'])if(Number.isFinite(d[key]))n.setAttribute(key,String(d[key]));if(d.type==='rect')n.setAttribute('rx','6');}
  return n;
 }
 function render(){
  const layers=[[$('objects'),[...records].filter(([id,r])=>!r.deleted&&!previews.has(id)).map(([id,r])=>[id,r.data])],[$('previews'),[...previews].map(([id,r])=>[id,r])],[$('draft'),drawing?[[drawing.id,drawing.data]]:[]]];
  for(const [layer,items]of layers)layer.replaceChildren(...items.map(([id,data])=>node(data,id)).filter(Boolean));
  $('empty').hidden=[...records.values()].some(r=>!r.deleted)||previews.size>0||!!drawing;
 }
 collab.onObjects(e=>{for(const r of e.items)if(r.revision>(records.get(r.id)?.revision||0)){records.set(r.id,r);if((previews.get(r.id)?.baseRevision??0)<r.revision)previews.delete(r.id);}render();});
 collab.onTransient(e=>{for(const f of e.items){if(f.kind!=='preview')continue;if(!f.data||f.expired)previews.delete(f.key);else if(f.actor.id!==actor?.id&&(f.data.baseRevision??0)>=(records.get(f.key)?.revision||0))previews.set(f.key,f.data);}render();});
 collab.onParticipants(e=>$('participants').textContent=String(e.items.length));
 collab.onStatus(e=>{online=e.status==='connected';status(online?(english?'Live':'已同步'):(english?'Connecting…':'连接中…'));if(e.status==='error')error(e.message);});
 collab.onReset(()=>{records.clear();previews.clear();render();});
 for(const b of document.querySelectorAll('[data-tool]'))b.onclick=()=>{tool=b.dataset.tool;for(const el of document.querySelectorAll('[data-tool]'))el.setAttribute('aria-pressed',String(el===b));};
 async function commit(operations){
  const batch=collab.prepare(operations);for(let attempt=0;;attempt++)try{return await collab.commit(batch);}catch(e){if(attempt>=2||e.status&&e.status<500&&e.status!==429)throw e;await new Promise(r=>setTimeout(r,400*(attempt+1)));}
 }
 svg.onpointerdown=async e=>{
  if(!online||e.button!==0)return;error('');const p=point(e);
  if(tool==='erase'){const id=e.target.dataset.objectId,r=records.get(id);if(r&&!r.deleted)try{await commit([{type:'remove',id,revision:r.revision}]);}catch(e){error(e);}return;}
  if(drawing)return;svg.setPointerCapture(e.pointerId);drawing={pointerId:e.pointerId,id:Wanwu.uuid(),start:p,data:{type:['rect','ellipse'].includes(tool)?tool:'path',points:[[p.x,p.y]],color:$('color').value,strokeWidth:Number($('width').value)*(tool==='marker'?3:1),marker:tool==='marker'}};render();
 };
 function updateDraft(p){if(drawing){const d=drawing.data,start=drawing.start;if(d.type==='path'){d.points.push([p.x,p.y]);if(d.points.length>250)d.points=d.points.filter((_,i)=>i===0||i%2===0||i===d.points.length-1);}else if(d.type==='rect')Object.assign(d,{x:Math.min(start.x,p.x),y:Math.min(start.y,p.y),width:Math.abs(start.x-p.x),height:Math.abs(start.y-p.y)});else Object.assign(d,{cx:(start.x+p.x)/2,cy:(start.y+p.y)/2,rx:Math.abs(start.x-p.x)/2,ry:Math.abs(start.y-p.y)/2});render();}}
 svg.onpointermove=e=>{
  if(drawing&&drawing.pointerId!==e.pointerId)return;const p=point(e);updateDraft(p);
  if(performance.now()-lastPublish>70){lastPublish=performance.now();void collab.awareness({cursor:p,tool}).catch(error);if(drawing)void collab.preview(drawing.id,drawing.data).catch(error);}
 };
 svg.onpointerup=async e=>{if(!drawing||drawing.pointerId!==e.pointerId)return;updateDraft(point(e));const saved=drawing;drawing=null;try{await commit([{type:'put',id:saved.id,revision:0,data:saved.data}]);}catch(e){error(e);}finally{void collab.preview(saved.id,null).catch(()=>{});render();}};
 svg.onpointercancel=()=>{if(drawing)void collab.preview(drawing.id,null).catch(()=>{});drawing=null;render();};
 svg.onpointerleave=()=>{if(!drawing)void collab.awareness({cursor:null}).catch(()=>{});};
 $('export').onclick=()=>{const out=document.createElementNS(svg.namespaceURI,'svg');out.setAttribute('xmlns',svg.namespaceURI);out.setAttribute('viewBox','0 0 1200 760');for(const [id,r]of records)if(!r.deleted){const n=node(r.data,id);if(n)out.append(n);}const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(out)],{type:'image/svg+xml'})),a=document.createElement('a');a.href=url;a.download='shared-drawing.svg';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 try{const initial=await collab.join('board');actor=initial.actor;for(const r of initial.objects)records.set(r.id,r);$('participants').textContent=String(initial.participants.length);render();}catch(e){error(e);}
 api.live.provide(()=>({objects:[...records.values()].filter(r=>!r.deleted).length,collaborators:Number($('participants').textContent),connected:online}));
})();
