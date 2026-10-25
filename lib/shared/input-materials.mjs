import {chatFileName} from './chat-attachments.mjs';
import {referenceMatches, replaceReferences} from './reference-tokens.mjs';

export const LARGE_PASTE_CHARACTERS = 2000;
export const LARGE_PASTE_LINES = 40;

export function shouldAttachPaste(text, remaining = Infinity) {
  return !!text && (text.length > LARGE_PASTE_CHARACTERS || text.split(/\r\n|\r|\n/).length >= LARGE_PASTE_LINES || text.length > remaining);
}

// Upload names are also the reference labels, so they must be unique and match
// the server's sanitized names. The original file on disk is never renamed.
export function uniqueMaterialName(name, existing) {
  const clean = chatFileName(name).replace(/[「」]/g, '_');
  const taken = new Set(existing.map(n => n.toLocaleLowerCase()));
  const dot = clean.lastIndexOf('.');
  const extension = dot > 0 && clean.length - dot <= 16 ? clean.slice(dot) : '';
  const base = extension ? clean.slice(0, -extension.length) : clean;
  let result = clean, n = 2;
  while (taken.has(result.toLocaleLowerCase())) {
    const suffix = ` (${n++})${extension}`;
    result = base.slice(0, 180 - suffix.length) + suffix;
  }
  return result;
}

export function materialReference(name) { return `@${name}`; }
export const materialTokens = names => names.flatMap(name => [materialReference(name), `@「${name}」`]);
export function stripMaterialReferences(text, names = []) {
  return replaceReferences(text, materialTokens(names), () => ' ').replace(/@「[^」\r\n]*」/g, ' ');
}
export function removeMaterialReference(text, name, names = [name]) {
  return replaceReferences(text, materialTokens([...names, name]), token => materialTokens([name]).includes(token) ? '' : token);
}
export function materialQuery(text, start, end = start, knownTokens = []) {
  if (start !== end) return null;
  const match = text.slice(0, start).match(/(?:^|[\s([{，。！？：；、\p{Script=Han}])@([^\n@「」【】]{0,180})$/u);
  if (!match) return null;
  const candidate = '@' + match[1];
  // Completed references must not keep the picker open as the sentence grows.
  // A longer matching name can still be searched, e.g. @Eden S for Eden Smith.
  const longer = knownTokens.some(token => token.length > candidate.length && token.toLocaleLowerCase().startsWith(candidate.toLocaleLowerCase()));
  if (!longer && referenceMatches(candidate, knownTokens.filter(token => token.toLowerCase() !== '@bot')).some(m => m.start === 0)) return null;
  // A completed Bot mention is a token, not the start of an ever-growing
  // material query. Preserve spaces in real file-name searches.
  if (!longer && /^bot(?:[\s,，:：!！?？。;；、]|\p{Script=Han})/iu.test(match[1])) return null;
  return {start: start - match[1].length - 1, end: start, query: match[1]};
}
export function insertMaterialReference(text, query, name) {
  const token = materialReference(name), tail = text.slice(query.end);
  const prefix = text.slice(0, query.start) + token + (tail.startsWith(' ') ? '' : ' ');
  return {text: prefix + tail, caret: prefix.length};
}
export function missingMaterialReferences(text, names, knownNames = []) {
  const available = new Set(names);
  const referenced = referenceMatches(text, materialTokens([...names, ...knownNames]));
  return [...new Set([...text.matchAll(/@「([^「」\n]+)」/gu)].map(m => m[1]).concat(knownNames.filter(name => referenced.some(m => materialTokens([name]).includes(m.token)))).filter(name => !available.has(name)))];
}
