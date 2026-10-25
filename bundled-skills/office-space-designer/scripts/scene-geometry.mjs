// Unvalidated geometry: shared by navigation and the floor-plan validator without recursive scene resolution.
export function furnitureObstacles(s) {
  return [...(s.obstacles||[]),...s.modules.filter(m=>!m.walkThrough&&!['rug','window','lamp'].includes(m.kind)).map(m=>({
    x:m.x/s.columns*100,y:(m.y+(m.kind==='wall'?0:m.height*.5))/s.rows*100,
    width:m.width/s.columns*100,height:m.height*(m.kind==='wall'?1:.48)/s.rows*100,
  }))];
}
