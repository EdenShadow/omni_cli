import {validatePropArt} from './prop-art.mjs';

const colors=['background','foreground','muted','border','accent'];
const rgb=color=>color.slice(1).match(/../g).map(v=>parseInt(v,16));
const mix=(a,b,t)=>'#'+rgb(a).map((v,i)=>Math.round(v*(1-t)+rgb(b)[i]*t).toString(16).padStart(2,'0')).join('');
const luminance=color=>rgb(color).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
const contrast=(a,b)=>(Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
// Retain the authored hue when readable, otherwise move it toward a readable
// ink. The same text must work on the board, buttons and their selected state.
function readable(color,surfaces){
 const score=c=>Math.min(...surfaces.map(bg=>contrast(c,bg)));
 if(score(color)>=4.5)return color;
 const ink=score('#ffffff')>score('#000000')?'#ffffff':'#000000';
 for(let i=1;i<=100;i++){const next=mix(color,ink,i/100);if(score(next)>=4.5)return next;}
 return ink;
}
function controlSurface(background,ink,amount){
 const strong=contrast('#ffffff',background)>contrast('#000000',background)?'#ffffff':'#000000';
 // Middle-gray themes have little contrast headroom. Reduce the surface tint
 // there rather than creating a hover state that neither ink can read.
 for(let i=100;i>=0;i--){const color=mix(background,ink,amount*i/100);if(contrast(strong,color)>=4.5)return color;}
 return background;
}
export function boardColorTheme(background){
 return background&&rgb(background).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0)<145?'dark':'light';
}
export function validateBoardAppearance(boards){
 if(!boards||typeof boards!=='object'||Array.isArray(boards)||Object.keys(boards).some(k=>!['announcement','canvas','skills'].includes(k)))throw Error('看板外观只能指定 announcement、canvas、skills');
 for(const b of Object.values(boards)){
  if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>![...colors,'backgroundSvg'].includes(k)))throw Error('看板外观字段无效');
  for(const key of colors)if(b[key]!==undefined&&!/^#[\da-f]{6}$/i.test(b[key]))throw Error('看板配色须使用六位十六进制颜色');
  if(b.backgroundSvg!==undefined)validatePropArt(b.backgroundSvg,{allowText:true});
 }
}
// Only paint properties: layout, padding, hit targets and real content belong
// to the host. CSS backgrounds cannot intercept clicks or cover the controls.
export function officeBoardStyle(board){
 if(!board)return {};
 const background=board.background||'#191b1f',ink=readable(board.foreground||(boardColorTheme(background)==='dark'?'#f5f1e8':'#292e30'),[background]);
 const surface=controlSurface(background,ink,.075),active=controlSurface(background,ink,.15),surfaces=[background,surface,active];
 const foreground=readable(ink,surfaces),muted=readable(board.muted||mix(background,foreground,.72),surfaces),accent=readable(board.accent||foreground,surfaces),border=board.border||mix(background,foreground,.3);
 return {backgroundColor:background,backgroundImage:board.backgroundSvg?`url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(board.backgroundSvg.replace(/<svg\b([^>]*)>/,(_,a)=>`<svg xmlns="http://www.w3.org/2000/svg"${a.replace(/\s(?:xmlns|preserveAspectRatio)\s*=\s*["'][^"']*["']/g,'')} preserveAspectRatio="none">`))}")`:'none',backgroundSize:'100% 100%',backgroundRepeat:'no-repeat',color:foreground,borderColor:border,boxShadow:`inset 0 1px 0 ${mix(border,foreground,.3)}, 4px 5px 0 ${mix(background,'#000000',.45)}`,'--scene-board-danger':readable(boardColorTheme(background)==='dark'?'#f0ad9d':'#a93628',surfaces),'--scene-board-background':background,'--scene-board-ink':foreground,'--scene-board-muted':muted,'--scene-board-accent':accent,'--scene-board-surface':surface,'--scene-board-active':active,'--scene-board-border':border};
}
