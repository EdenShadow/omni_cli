// A shared dance for old library characters; authored choreography takes priority.
// Wrap joints instead of replacing their transforms, preserving custom rig placement.
export function installDancing(svg, data, {groundY}) {
  const states = [...new Set([...data.states, 'dancing'])];
  if (data.clips?.dancing) return {...data, states};
  const ns = 'http://www.w3.org/2000/svg', box = svg.viewBox.baseVal, u = box.height / 260;
  const names = new Set([...svg.querySelectorAll('[data-part]')].map(el => el.dataset.part));
  const group = name => {
    while (names.has(name)) name += '-';
    names.add(name);
    const el = document.createElementNS(ns, 'g');
    el.dataset.part = name;
    el.style.transformBox = 'view-box';
    return el;
  };
  const stage = group('wanwu-dance');
  stage.dataset.danceFallback = '';
  stage.style.transformOrigin = `${box.x + box.width / 2}px ${groundY}px`;
  for (const child of [...svg.children]) if (!['title','desc','defs','style'].includes(child.localName)) stage.append(child);
  svg.append(stage);
  const track = (part, transforms) => ({part, frames:transforms.map(transform => ({transform}))});
  const pose = (x, y, angle) => `translate(${x*u}px,${y*u}px) rotate(${angle}deg)`;
  // Two step-touches and a double bounce. A single clock keeps the limbs in time.
  const tracks = [track(stage.dataset.part, [
    pose(-5,0,-5), pose(-7,-4,-7), pose(0,0,0), pose(7,-4,7),
    pose(5,0,5), pose(0,-5,0), pose(0,0,0), pose(-3,-3,-3), pose(-5,0,-5),
  ])];
  for (const [name, angles, lifts] of [
    ['arm-l', [35,65,20,-25,-40,15,50,65,35]],
    ['arm-r', [40,25,-20,-65,-35,-65,-50,-15,40]],
    ['foot-l', [-8,-18,0,6,8,0,0,-10,-8], [0,-5,0,0,0,-3,0,-3,0]],
    ['foot-r', [-8,-6,0,18,8,0,0,6,-8], [0,0,0,-5,0,-3,0,0,0]],
  ]) {
    const joint = svg.querySelector(`[data-part="${name}"]`);
    if (!joint) continue; // Unrigged legacy artwork still gets a connected dance.
    const wrapper = group(`wanwu-dance-${name}`);
    wrapper.style.transformOrigin = getComputedStyle(joint).transformOrigin;
    joint.before(wrapper); wrapper.append(joint);
    tracks.push(track(wrapper.dataset.part, angles.map((angle, i) => pose(0, lifts?.[i] || 0, angle))));
  }
  return {...data, states, clips:{...data.clips, dancing:{duration:1600, loop:true, tracks}}};
}
