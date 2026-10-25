// Pure modular layout and grid navigation, shared by the preview and contract tests.
export function createLayout(devices,props=[]){
 const count=Math.max(1,devices.length),cols=Math.min(6,Math.max(3,Math.ceil(Math.sqrt(count*1.5)))),rows=Math.ceil(count/cols);
 const workWidth=cols*240+70,loungeX=workWidth+55,width=loungeX+465,playY=360+rows*240,height=Math.max(880,playY+100,...props.map(p=>Math.max(p.y,p.endY||0)+100));
 const computers=devices.map((d,i)=>{const x=185+(i%cols)*240,y=412+Math.floor(i/cols)*240;return {...d,x,y,depth:y+55,spots:[[x-25,y+100],[x+32,y+140]]};});
 const boards=[{id:'announcements',label:'公告看板',kind:'board',x:width*.18,y:160,artShift:[width*.18-206,0]},{id:'canvas',label:'画布看板',kind:'board',x:width*.49,y:160,artShift:[width*.49-550,0]},{id:'skills',label:'Skills 看板',kind:'board',x:width*.80,y:160,artShift:[width*.80-922,0]}];
 const zones=[{id:'work',label:'灵感工位',kind:'work',x:workWidth/2+20,y:302,description:`${devices.length} 台电脑，区域人数不限。忙碌同事可以派出分身，继续一起开工。`,spots:computers.flatMap(d=>d.spots),state:'working'},
 {id:'lounge',label:'休闲会客区',kind:'lounge',x:loungeX+190,y:302,description:'沙发、茶几、书架和一台小街机，在同一个角落休息或玩一会儿。',spots:[[loungeX+60,805],[loungeX+180,790],[loungeX+305,805]],state:'idle'},...boards];
 const obstacles=computers.map(d=>({x:d.x-106,y:d.y-36,w:212,h:83}));
 obstacles.push({x:loungeX+6,y:378,w:342,h:108},{x:loungeX+100,y:477,w:165,h:53},{x:loungeX+29,y:633,w:92,h:145},{x:loungeX+200,y:663,w:120,h:100});
 const seats=[];
 for(let i=0;i<3;i++)seats.push({id:'sofa-'+i,label:'沙发 '+(i+1)+' 号位',kind:'sofa',x:loungeX+66+i*108,y:440,approach:[loungeX+66+i*108,560],surface:440,depth:491});
 for(const p of props)if(p.kind==='wall'||p.kind==='tree')obstacles.push({x:p.x-p.w/2,y:p.y-(p.kind==='tree'?20:25),w:p.w,h:p.kind==='tree'?36:50,propId:p.id});
 return {width,height,cols,rows,workWidth,loungeX,playY,computers,zones,boards,obstacles,seats,props};
}
export function walkable(point,layout,padding=8){const [x,y]=point;return x>=65&&x<=layout.width-65&&y>=286&&y<=layout.height-65&&!layout.obstacles.some(o=>x>o.x-padding&&x<o.x+o.w+padding&&y>o.y-padding&&y<o.y+o.h+padding);}
function clearSegment(a,b,layout){
 if(!walkable(a,layout)||!walkable(b,layout))return false;
 // Exact segment/rectangle intersection avoids cutting a corner between grid samples.
 for(const o of layout.obstacles){let lo=0,hi=1,hit=true;const bounds=[[o.x-8+1e-7,o.x+o.w+8-1e-7],[o.y-8+1e-7,o.y+o.h+8-1e-7]];
  for(let axis=0;axis<2;axis++){const delta=b[axis]-a[axis],[min,max]=bounds[axis];if(Math.abs(delta)<1e-9){if(a[axis]<min||a[axis]>max){hit=false;break;}}else{let t1=(min-a[axis])/delta,t2=(max-a[axis])/delta;if(t1>t2)[t1,t2]=[t2,t1];lo=Math.max(lo,t1);hi=Math.min(hi,t2);if(lo>hi){hit=false;break;}}}
  if(hit&&lo<=1&&hi>=0)return false;
 }
 return true;
}
export function findPath(start,end,layout){
 if(!walkable(start,layout)||!walkable(end,layout))return null;
 if(clearSegment(start,end,layout))return [start,end];
 const step=20,nx=Math.ceil(layout.width/step),ny=Math.ceil(layout.height/step),point=(x,y)=>[x*step,y*step],key=(x,y)=>y*nx+x;
 function nearest(p){let best=null,dist=Infinity;const cx=Math.round(p[0]/step),cy=Math.round(p[1]/step);for(let x=cx-3;x<=cx+3;x++)for(let y=cy-3;y<=cy+3;y++){const v=point(x,y),dd=Math.hypot(v[0]-p[0],v[1]-p[1]);if(x>=0&&y>=0&&x<nx&&y<ny&&dd<dist&&walkable(v,layout)&&clearSegment(p,v,layout)){dist=dd;best=[x,y];}}return best;}
 const a=nearest(start),b=nearest(end);if(!a||!b)return null;
 const first=key(...a),target=key(...b),open=new Set([first]),cost=new Map([[first,0]]),from=new Map();let visits=0;
 while(open.size&&visits++<nx*ny){let current=-1,best=Infinity;for(const id of open){const x=id%nx,y=Math.floor(id/nx),score=cost.get(id)+Math.abs(x-b[0])+Math.abs(y-b[1]);if(score<best){current=id;best=score;}}
  if(current===target){const raw=[end,point(...b)];while(from.has(current)){current=from.get(current);raw.push(point(current%nx,Math.floor(current/nx)));}raw.push(start);raw.reverse();const compact=[raw[0]];let i=0;while(i<raw.length-1){let j=raw.length-1;while(j>i+1&&!clearSegment(raw[i],raw[j],layout))j--;compact.push(raw[j]);i=j;}return compact;}
  open.delete(current);const x=current%nx,y=Math.floor(current/nx);for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=nx||yy>=ny||!walkable(point(xx,yy),layout))continue;const next=key(xx,yy),g=cost.get(current)+1;if(g<(cost.get(next)??Infinity)){cost.set(next,g);from.set(next,current);open.add(next);}}
 }
 return null;
}

// A gathering area, not reserved slots: golden-angle dispersion may overlap naturally.
export function workPoint(device,index,layout){
 for(let attempt=0;attempt<100;attempt++){
  const n=index+attempt,angle=n*2.3999632297,r=24+Math.sqrt(n%70)*7;
  const p=[device.x+Math.cos(angle)*r,device.y+108+Math.sin(angle)*Math.min(r,42)];
  if(walkable(p,layout))return p;
 }
 return device.spots.find(p=>walkable(p,layout))||null;
}
export function cloneIdentity(source,members,id,random=Math.random){
 const rootId=source.rootId||source.id,number=Math.max(1,...members.filter(m=>(m.rootId||m.id)===rootId).map(m=>m.cloneNumber||1))+1;
 const allColors=['#AD78CC','#56ADA4','#E3A04A','#E17889','#669BCC'];const last=members.filter(m=>(m.rootId||m.id)===rootId).at(-1)?.cloneColor;const colors=allColors.filter(c=>c!==last);
 return {...source,id,rootId,cloneNumber:number,name:(source.baseName||source.name)+' · 分身 '+number,baseName:source.baseName||source.name,cloneColor:colors[Math.floor(random()*colors.length)%colors.length],seed:Math.floor(random()*2147483646)+1};
}

// One-time presentation migration: store the playground instead of deleting its contents.
export function tidyOfficeStore(saved){
 if(!Array.isArray(saved.propStorage))saved.propStorage=[];
 if(saved.cleanLayoutVersion===1)return saved;
 const byId=new Map([...saved.propStorage,...(saved.props||[])].map(p=>[p.id,p]));
 saved.propStorage=[...byId.values()];saved.props=[];
 for(const [id,seat] of Object.entries(saved.seats||{}))if(!seat.startsWith('sofa-')){
  delete saved.seats[id];const member=saved.members?.find(m=>m.id===id);if(member)member.state='idle';
 }
 saved.cleanLayoutVersion=1;return saved;
}
