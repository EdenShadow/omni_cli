const NS='http://www.w3.org/2000/svg';
function node(tag,attrs={},children=[]){const n=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));for(const c of children)n.append(c);return n;}
function baseSVG(layout){return node('svg',{viewBox:`0 0 ${layout.width} ${layout.height}`,fill:'none',stroke:'#47483C','stroke-width':3,'stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'});}
export function renderWorld(layout,art,root,onDevice,onZone,onSeat){
 const {width:w,height:h,loungeX:lx,playY:py}=layout;
 const background=baseSVG(layout);background.append(art.querySelector('defs').cloneNode(true));
 // Cutaway architecture: thick edges, inset wall panels, separate room finishes.
 background.append(node('rect',{x:30,y:48,width:w-50,height:h-70,rx:22,fill:'#B7B6A3',stroke:'none'}),node('path',{d:`M42 36H${w-42}V${h-53}H42Z`,fill:'var(--floor,#F3EAD7)',stroke:'#A3A68F','stroke-width':2}),node('rect',{x:44,y:40,width:w-88,height:227,fill:'var(--wall,#DCE7D9)',stroke:'none'}),node('rect',{x:46,y:268,width:w-92,height:h-321,fill:'url(#planks)',stroke:'none'}));
 background.append(node('path',{d:`M44 48H${w-44}V65H44Z`,fill:'#9DAD94',stroke:'none'}),node('path',{d:`M44 254H${w-44}V270H44Z`,fill:'#FAF4E4',stroke:'#BCC4AD','stroke-width':1}),node('path',{d:`M44 270H${w-44}V277H44Z`,fill:'#A6AD95',stroke:'none'}));
 for(let x=70;x<w-40;x+=82)background.append(node('path',{d:`M${x} 70V250`,stroke:'#C6D3BD','stroke-width':1}));
 background.append(node('rect',{x:74,y:322,width:layout.workWidth-60,height:layout.rows*240-7,rx:16,fill:'#C7D3C6',stroke:'#AAB9A6','stroke-width':2}),node('rect',{x:83,y:331,width:layout.workWidth-78,height:layout.rows*240-25,rx:12,fill:'none',stroke:'#E1E7D8','stroke-width':3}));
 for(let y=352;y<320+layout.rows*240;y+=38)background.append(node('path',{d:`M90 ${y}H${layout.workWidth+4}`,stroke:'#BBCCBB','stroke-width':1}));
 background.append(node('rect',{x:lx-5,y:330,width:374,height:498,rx:28,fill:'#D9CDB7',stroke:'#BCAD90','stroke-width':2}),node('rect',{x:lx+4,y:339,width:356,height:480,rx:23,fill:'none',stroke:'#EEE3CD','stroke-width':3}));
 // Ceiling lights and brass pins tie the board gallery into the architecture.
 for(const board of layout.boards)background.append(node('path',{d:`M${board.x-58} 52h116l9 14h-134Z`,fill:'#F5E5AC',stroke:'#B9AB7C','stroke-width':2}));
 const lounge=art.querySelector('[data-zone-art="lounge"]'),parts=[...lounge.children];
 const shifted=indices=>node('g',{transform:`translate(${lx-751} 0)`},indices.map(i=>parts[i].cloneNode(true)));
 background.append(shifted([5,6,7]));
 const play=art.querySelector('[data-zone-art="play"]');

 const layers=document.createDocumentFragment();
 const layer=(children,depth)=>{const svg=baseSVG(layout);svg.classList.add('scene-layer');svg.style.zIndex=String(100+Math.round(depth*1000));for(const c of children)svg.append(c);layers.append(svg);};
 layer([shifted([0,1,2,3,4])],490);layer([shifted([8,9,10,11])],534);layer([shifted([12,13,14])],492);
 const arcade=play.children[2].cloneNode(true);arcade.setAttribute('transform',`translate(${lx+73} 694)`);layer([arcade],778);
 layer([node('g',{transform:`translate(${lx+260} 755)`},[
 node('ellipse',{cx:0,cy:12,rx:65,ry:16,fill:'#8D987B33',stroke:'none'}),node('rect',{x:-60,y:-100,width:120,height:104,rx:8,fill:'#C5AB82'}),node('rect',{x:-51,y:-89,width:102,height:37,fill:'#9D8E72'}),node('rect',{x:-51,y:-40,width:102,height:34,fill:'#9D8E72'}),...['#D59375','#B4C5A3','#F0D69A','#8CABA3','#B8A9C5'].map((color,i)=>node('rect',{x:-46+i*19,y:-83+(i%2)*6,width:15,height:31-(i%2)*6,rx:2,fill:color,'stroke-width':1})),node('path',{d:'M-40 -16h35v-16h-35ZM8 -13h34v-20H8Z',fill:'#DACBB1'}),node('use',{href:'#plant',transform:'translate(5 -111) scale(.55)'})
 ])],765);

 layer([node('use',{href:'#plant',transform:'translate(86 330) scale(.7)'})],352);
 for(const d of layout.computers){const b=document.createElement('button');b.type='button';b.className='device';b.dataset.device=d.id;b.setAttribute('aria-label','去'+d.name);b.setAttribute('aria-pressed','false');b.style.left=(d.x-105)/w*100+'%';b.style.top=(d.y-95)/h*100+'%';b.style.width=210/w*100+'%';b.style.height=130/h*100+'%';b.style.zIndex=String(100+Math.round(d.depth*1000));
  const sprite=node('svg',{viewBox:'-105 -95 210 190',fill:'none',stroke:'#47483C','stroke-width':3,'stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'},[node('use',{href:'#desk'})]);b.append(sprite);
  const name=document.createElement('span');name.className='device-name';name.textContent=d.name;const count=document.createElement('span');count.className='device-count';count.dataset.capacity=d.id;b.append(name,count);b.onclick=()=>onDevice(d.id);layers.append(b);
 }
 for(const seat of layout.seats){
  const b=document.createElement('button');b.type='button';b.className='seat-target '+seat.kind;b.dataset.seat=seat.id;b.setAttribute('aria-label','坐到'+seat.label);b.setAttribute('aria-pressed','false');
  b.style.left=(seat.x-32)/w*100+'%';b.style.top=(seat.kind==='chair'?seat.y-34:seat.y-23)/h*100+'%';b.style.width=64/w*100+'%';b.style.height=(seat.kind==='chair'?70:36)/h*100+'%';b.style.zIndex=String(100+Math.round((seat.kind==='chair'?seat.depth-2:490)*1000)+1);
  if(seat.kind==='chair')b.append(node('svg',{viewBox:'-46 -49 92 100',fill:'none',stroke:'#47483C','stroke-width':3,'stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'},[node('use',{href:'#chair'})]));
  const hint=document.createElement('span');hint.className='seat-label';hint.textContent='坐这里';b.append(hint);b.onclick=()=>onSeat(seat.id);layers.append(b);
 }
 root.querySelector('#scene-art').replaceChildren(background);root.querySelector('#furniture').replaceChildren(layers);
 const hotspots=root.querySelector('#zone-hotspots');hotspots.replaceChildren();
 for(const z of layout.zones){const b=document.createElement('button');b.type='button';b.className='map-zone'+(z.kind==='board'?' board':'');b.style.left=z.x/w*100+'%';b.style.top=z.y/h*100+'%';if(z.kind==='board'){b.style.width=310/w*100+'%';b.style.height=174/h*100+'%';}b.dataset.zone=z.id;b.setAttribute('aria-label','打开'+z.label);b.setAttribute('aria-pressed','false');const label=document.createElement('span');label.textContent=(z.kind==='board'?({'announcements':'01  /  ','canvas':'02  /  ','skills':'03  /  '}[z.id]):'')+z.label;b.append(label);b.onclick=()=>onZone(z.id);hotspots.append(b);}
}
