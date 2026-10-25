// Labels stay readable in the textarea; identity lives in message metadata.
// Resolve longest labels first so @Eden never consumes @Eden Smith or @Eden.png.
export function referenceMatches(text, tokens = []) {
  const labels = [...new Set(tokens.filter(token => token.startsWith('@') && token.length > 1))].sort((a,b) => b.length-a.length);
  const matches = [];
  for (let start = text.indexOf('@'); start !== -1; start = text.indexOf('@', start + 1)) {
    if (start && !/[\s\p{Script=Han}，。！？：；、([{'"“‘（]/u.test(text[start-1])) continue;
    const token = labels.find(token => {
      if (!text.startsWith(token, start)) return false;
      const next = text[start + token.length];
      if (!next || /[】」]$/.test(token)) return true;
      if (next === '.') return !/[\p{L}\p{N}_]/u.test(text[start + token.length + 1] || '');
      return /[\s,!?;:，。！？：；、)\]}）'"“”‘’]/u.test(next) || (/\p{Script=Han}/u.test(next) && !/\p{Script=Han}$/u.test(token));
    });
    if (token) { matches.push({start, end:start+token.length, token}); start += token.length-1; }
  }
  return matches;
}

export function replaceReferences(text, tokens, replacement = () => '') {
  let result = '', offset = 0;
  for (const match of referenceMatches(text, tokens)) {
    result += text.slice(offset, match.start) + replacement(match.token);
    offset = match.end;
  }
  return result + text.slice(offset);
}
