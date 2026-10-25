// Preview framing is independent from the character's world size and foot anchor.
export function characterActionViewBox(viewBox, bounds) {
  const original = [viewBox.x, viewBox.y, viewBox.width, viewBox.height];
  if (!bounds || !['x', 'y', 'width', 'height'].every(k => Number.isFinite(bounds[k])) || bounds.width <= 0 || bounds.height <= 0) return original;
  const x = Math.min(viewBox.x, bounds.x), y = Math.min(viewBox.y, bounds.y);
  const width = Math.max(viewBox.x + viewBox.width, bounds.x + bounds.width) - x;
  const height = Math.max(viewBox.y + viewBox.height, bounds.y + bounds.height) - y;
  const pad = Math.max(width, height) * .04;
  const framed = [x - pad, y - pad, width + pad * 2, height + pad * 2];
  return framed.every(Number.isFinite) ? framed : original;
}
