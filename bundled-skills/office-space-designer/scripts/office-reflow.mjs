const contains=(a,b)=>b.x>=a.x&&b.y>=a.y&&b.x+b.width<=a.x+a.width&&b.y+b.height<=a.y+a.height;
// Maximal free rectangles let furnishing use both sides and the space below
// rooms. A single left strip wastes the width released by smaller objects.
export function commonOfficeRegions(scene){
 const floor={x:2,y:11,width:scene.columns-4,height:scene.rows-12};
 const rooms=scene.floorPlan.rooms.map(r=>({x:r.x-1.5,y:r.y-1.5,width:r.width+3,height:r.height+3}));
 const cuts=[...new Set([floor.y,floor.y+floor.height,...rooms.flatMap(r=>[r.y,r.y+r.height]).filter(y=>y>floor.y&&y<floor.y+floor.height)])].sort((a,b)=>a-b),regions=[];
 for(let i=0;i<cuts.length-1;i++)for(let j=i+1;j<cuts.length;j++){
  const top=cuts[i],bottom=cuts[j],blocked=rooms.filter(r=>r.y<bottom&&r.y+r.height>top).sort((a,b)=>a.x-b.x);
  let x=floor.x;
  for(const r of [...blocked,{x:floor.x+floor.width,width:0}]){
   const end=Math.min(r.x,floor.x+floor.width);
   if(end-x>=1&&bottom-top>=1)regions.push({x,y:top,width:end-x,height:bottom-top});
   x=Math.max(x,r.x+r.width);
  }
 }
 return regions.filter((r,i)=>!regions.some((other,j)=>j!==i&&contains(other,r)&&(other.width*other.height>r.width*r.height||j<i))).map((r,i)=>({...r,id:'common-'+i,kind:'common'}));
}
export function packOfficeRooms(rooms,columns,{fillWidth=false,publicWidth=20,top=10.15}={}){
 let count=1;
 if(fillWidth)for(let n=2;n<=Math.min(rooms.length,4);n++){
  const widths=Array.from({length:n},(_,c)=>Math.max(...rooms.filter((_,i)=>i%n===c).map(r=>r.width)));
  if(widths.reduce((a,b)=>a+b,0)+(n-1)*2+publicWidth<=columns)count=n;
 }
 const widths=Array.from({length:count},(_,c)=>Math.max(0,...rooms.filter((_,i)=>i%count===c).map(r=>r.width)));
 const left=columns-widths.reduce((a,b)=>a+b,0)-(count-1)*2,ys=Array(count).fill(top);
 return rooms.map((room,i)=>{
  const column=i%count,x=left+widths.slice(0,column).reduce((a,b)=>a+b+2,0)+widths[column]-room.width,y=ys[column];ys[column]+=room.height+2;
  return {...room,x,y,column};
 });
}
