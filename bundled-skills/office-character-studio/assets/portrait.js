// Portrait coordinates stay in the original SVG space; the map keeps the full body.
export function characterPortraitViewBox(design, box, features) {
  const explicit = design?.avatarViewBox;
  if (Array.isArray(explicit) && explicit.length === 4 && explicit.every(Number.isFinite)
      && explicit[2] > 0 && explicit[3] > 0 && explicit[2] <= box.width && explicit[3] <= box.height) {
    return explicit;
  }
  const shortSide = Math.min(box.width, box.height);
  if (features && [features.x,features.y,features.width,features.height].every(Number.isFinite)
      && features.width > 0 && features.height > 0) {
    const size = Math.min(shortSide * .82, Math.max(shortSide * .42, features.width * 3, features.height * 2));
    const centerX = features.x + features.width / 2;
    const centerY = features.y + features.height / 2 + size * .08;
    return [centerX - size / 2, centerY - size / 2, size, size];
  }
  const size = shortSide * .7;
  return [box.x + (box.width - size) / 2, box.y + box.height * .35 - size / 2, size, size];
}
