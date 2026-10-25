// Compatibility acting for earlier, under-animated emotional work clips.
// Authored files and every non-work clip remain untouched. New, visually checked
// performances opt out with design.workPerformance = "authored-v1".
export const WORK_STAGE = '__wanwu_work_performance';
const round = value => Math.round(value * 100) / 100;
const angles = track => (track?.frames || []).map(frame => Number(/rotate\(\s*(-?[\d.]+)deg\)/.exec(frame.transform || '')?.[1] || 0));
const range = values => values.length ? Math.max(...values) - Math.min(...values) : 0;

function actingKind(name, label = '') {
  if (/frantic|疯狂|赶工/.test(name + ' ' + label)) return 'frantic';
  if (/frustrated|抓狂|返工/.test(name + ' ' + label)) return 'frustrated';
  if (/emo|沮丧/.test(name + ' ' + label)) return 'emo';
}

// Different silhouettes share beats, not identical poses: keep the authored
// resting angle, translations, elbow tracks, accessories and facial selectors.
function accentArm(track, kind, side) {
  const span = range(angles(track));
  const minimum = kind === 'frantic' ? 85 : kind === 'frustrated' ? 90 : 45;
  if (span >= minimum || track.frames.some(f => /matrix|rotate[XYZ3]|perspective/.test(f.transform || ''))) return track;
  const first = track.frames[0], base = first.transform || '', resting = angles(track)[0];
  const poses = kind === 'frantic'
    ? [[0,0],[.1,98],[.18,-10],[.27,100],[.35,-12],[.44,95],[.52,-8],[.64,10],[.84,10],[1,0]]
    : kind === 'frustrated'
      ? [[0,0],[.16,-18],[.32,138],[.46,138],[.54,110],[.62,140],[.76,0],[.88,-12],[1,0]]
      : [[0,0],[.22,45],[.56,45],[.68,-16],[.77,45],[.9,45],[1,0]];
  return {...track, duration:undefined, frames:poses.map(([offset,delta]) => {
    const rotation = `rotate(${round(resting + delta * side)}deg)`;
    return {...first, offset, easing:'ease-in-out', transform:/rotate\(/.test(base) ? base.replace(/rotate\([^)]*\)/,rotation) : `${base} ${rotation}`.trim()};
  }), easing:'linear'};
}

export function expressiveWorkData(data, {parts, groundY, centerX, footHalfWidth = 0, unit = 1} = {}) {
  if (data.design?.workPerformance === 'authored-v1' || !parts?.has(WORK_STAGE)) return data;
  const clips = {...data.clips};
  let changed = false;
  for (const name of data.workVariants || []) {
    const clip = data.clips[name], kind = actingKind(name,data.workLabels?.[name]);
    if (!clip?.loop || !kind) continue;
    const tracks = clip.tracks.map(track => /^arm-[lr]$/.test(track.part)
      ? accentArm(track,kind,track.part === 'arm-l' ? 1 : -1) : track);
    // Don't double an already large whole-body performance, or infer a skeleton
    // from unfamiliar names. The stage contains feet and body together.
    const wholeBody = clip.tracks.find(t => ['root','character'].includes(t.part));
    const largeRoot = range(angles(wholeBody)) >= 18 || (wholeBody?.frames || []).some(f => /translate/.test(f.transform || ''));
    if (!largeRoot) {
      const beats = kind === 'frantic'
        ? [[0,-5,0],[.12,-17,0],[.35,-17,0],[.47,14,0],[.64,14,0],[.8,-5,0],[1,-5,0]]
        : kind === 'frustrated'
          ? [[0,0,0],[.16,-12,0],[.32,17,9],[.43,17,0],[.55,-16,0],[.66,16,0],[.8,0,0],[1,0,0]]
          : [[0,-7,0],[.24,-17,0],[.58,-17,0],[.7,-8,0],[.82,-17,0],[1,-7,0]];
      tracks.push({part:WORK_STAGE,frames:beats.map(([offset,angle,lift]) => ({offset,easing:'ease-in-out',
        // Lift the lower foot just enough to keep it above the floor as the
        // connected rig leans. No horizontal travel, squash, or scale changes.
        transform:`translateY(${-round(Math.abs(Math.sin(angle*Math.PI/180))*footHalfWidth + lift*unit)}px) rotate(${angle}deg)`,
        transformOrigin:`${centerX}px ${groundY}px`,
      })),easing:'linear'});
    }
    clips[name] = {...clip, tracks};
    changed = true;
  }
  return changed ? {...data,clips} : data;
}
