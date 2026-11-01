// Resolve a stable standing baseline, never the current animated pose.
export function characterGroundY(design, viewBox, measuredGroundY) {
  const bottom = viewBox.y + viewBox.height;
  for (const y of [design?.groundY, design?.anchor?.[1], measuredGroundY]) {
    if (Number.isFinite(y) && y > viewBox.y && y <= bottom) return y;
  }
  return bottom;
}

// SVG uses xMidYMid meet; account for both artwork padding and letterboxing.
export function characterGroundOffset({width, height}, viewBox, groundY, inset = 8) {
  if (![width, height, viewBox.width, viewBox.height].every(n => Number.isFinite(n) && n > 0)) return 0;
  const scale = Math.min(width / viewBox.width, height / viewBox.height);
  const artTop = (height - viewBox.height * scale) / 2;
  return height - inset - (artTop + (groundY - viewBox.y) * scale);
}
