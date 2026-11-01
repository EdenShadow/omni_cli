// Shared by prompt validation and older saved props. An explicit empty seats array still means decorative only.
export function explicitSeatCapacity(text = '') {
  const value = text.match(/([1-8一二三四五六七八两])\s*(?:个\s*)?(?:人|座|位|seater|person|people)(?![a-z])/i)?.[1]
    || text.match(/(?:seats?|坐|做|容纳)\s*([1-8一二三四五六七八两])(?!\d)/i)?.[1];
  return value ? Number(value) || {一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8}[value] : undefined;
}
export function evenlySpacedSeats(count, y = 68) {
  return Array.from({length:count}, (_,i) => ({x:count === 1 ? 50 : 20 + i * 60 / (count - 1), y}));
}
