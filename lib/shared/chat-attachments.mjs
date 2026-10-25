export const MAX_CHAT_FILES = 5;
export const MAX_CHAT_FILE_BYTES = 500 * 1024 * 1024;
export const MAX_CHAT_TOTAL_BYTES = MAX_CHAT_FILES * MAX_CHAT_FILE_BYTES;
export const ATTACHMENT_CHUNK_BYTES = 4 * 1024 * 1024;
// Compatibility for older clients. Large files use bounded upload chunks.
export const MAX_INLINE_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_INLINE_TOTAL_BYTES = 16 * 1024 * 1024;

export function chatFileName(value) {
  return String(value || '').split(/[\\/]/).at(-1).replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, 180) || 'attachment';
}
export function chatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes >= 1024 ** 3) return `${(bytes / (1024 ** 3)).toFixed(1)} GB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// SVG is rendered only as a passive <img>, never inserted into the document. HTML stays a file.
const mediaMimes = {svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',avif:'image/avif',bmp:'image/bmp',mp4:'video/mp4',m4v:'video/mp4',mov:'video/quicktime',webm:'video/webm',ogv:'video/ogg'};
export function attachmentMime(name, mime='') {
  const clean=String(mime).split(';')[0].trim().toLowerCase();
  const canonical=({'audio/x-wav':'audio/wav','audio/wave':'audio/wav','audio/x-m4a':'audio/mp4','audio/mp3':'audio/mpeg','audio/x-flac':'audio/flac'})[clean]||clean;
  return (!canonical||canonical==='application/octet-stream')?({...mediaMimes,mp3:'audio/mpeg',wav:'audio/wav',m4a:'audio/mp4',aac:'audio/aac',ogg:'audio/ogg',opus:'audio/ogg',flac:'audio/flac'}[String(name).split('.').at(-1).toLowerCase()]||'application/octet-stream'):canonical;
}
export function attachmentMediaKind(name,mime='') {
  const type=attachmentMime(name,mime);
  return Object.values(mediaMimes).includes(type)?(type.startsWith('image/')?'image':'video'):null;
}

export function audioAttachmentMime(name) {
  const type=attachmentMime(name);
  if(type.startsWith('audio/'))return type;
  return {webm:'audio/webm',mp4:'audio/mp4',m4v:'audio/mp4'}[String(name).split('.').at(-1).toLowerCase()]||type;
}
