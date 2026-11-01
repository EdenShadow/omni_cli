import {writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

// Editable inline geometry; no raster noise, filters or external dependencies.
export function textileArt({kind='rug',width=800,height=500,base='#ded3bb',edge='#284e53',thread='#b3a184',accent='#b48e51'}={}){
  if(!['rug','carpet'].includes(kind))throw Error('kind must be rug or carpet');
  if(![width,height].every(n=>Number.isFinite(n)&&n>=40&&n<=4096))throw Error('width/height must be 40–4096');
  if(![base,edge,thread,accent].every(c=>/^#[0-9a-f]{6}$/i.test(c)))throw Error('Use six-digit hex colors');
  const n=v=>Math.round(v*100)/100,short=Math.min(width,height),border=kind==='rug'?short*.065:0;
  const rect=(x,y,w,h,fill,extra='')=>`<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${fill}"${extra}/>`;
  let art=rect(0,0,width,height,kind==='rug'?edge:base);
  if(border){
    art+=rect(border*.32,border*.32,width-border*.64,height-border*.64,'none',` stroke="${accent}" stroke-width="${n(short*.004)}"`);
    art+=rect(border,border,width-border*2,height-border*2,base);
    art+=rect(border*1.22,border*1.22,width-border*2.44,height-border*2.44,'none',` stroke="${thread}" stroke-width="${n(short*.003)}"`);
  }
  const inset=border*1.5,step=Math.max(8,short/45,width/100,height/100),paths=[];
  // Staggered directional yarn, not crosses or a high-contrast grid. The fine
  // strokes recede at room scale while the rug's border/pattern stays legible.
  for(let row=0,y=inset+step;y<height-inset-step;y+=step,row++)for(let x=inset+step;x<width-inset-step*2;x+=step*2){
    const shift=row%2?step*.8:0,direction=row%2?-1:1;
    paths.push(`M${n(x+shift)} ${n(y)}l${n(step*.6)} ${n(step*.22*direction)}`);
  }
  art+=`<path d="${paths.join('')}" fill="none" stroke="${thread}" stroke-width="${n(Math.max(.6,step*.06))}" opacity="0.2"/>`;
  if(border){
    const gap=short*.16,diamonds=[];
    for(let x=inset+gap;x<width-inset-gap*.5;x+=gap)for(const y of [inset+gap*.55,height-inset-gap*.55])diamonds.push(`M${n(x)} ${n(y-gap*.2)}l${n(gap*.23)} ${n(gap*.2)}l${n(-gap*.23)} ${n(gap*.2)}l${n(-gap*.23)} ${n(-gap*.2)}Z`);
    art+=`<path d="${diamonds.join('')}" fill="none" stroke="${edge}" stroke-width="${n(short*.004)}" opacity="0.65"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${art}</svg>`;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const options={},args=process.argv.slice(2);let output;
  for(let i=0;i<args.length;i+=2){
    const key=args[i].replace(/^--/,'');
    if(!['kind','width','height','base','edge','thread','accent','output'].includes(key)||args[i+1]===undefined)throw Error('Unknown or missing option: '+args[i]);
    if(key==='output')output=args[i+1];else options[key]=['width','height'].includes(key)?Number(args[i+1]):args[i+1];
  }
  if(!output)throw Error('Provide --output path.svg');
  writeFileSync(output,textileArt(options));
}
