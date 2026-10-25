export const FOLDER_MIME = 'application/x-wanwu-folder';
export const MAX_FOLDER_ENTRIES = 20000;
export const MAX_FOLDER_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024;
export const MAX_FOLDER_BYTES = 10 * 1024 * 1024 * 1024;
// The same archive must be safe to unpack on macOS, Windows and Linux.
export function folderEntryPath(value) {
  if (typeof value !== 'string' || !value || value.length > 2048 || /[\\\u0000-\u001f\u007f:<>"|?*]/.test(value) || value.startsWith('/')) throw Error('文件夹内路径无效 / Invalid folder entry path');
  const parts = value.replace(/\/$/, '').split('/');
  if (parts.some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) throw Error('文件名无法跨设备使用 / Filename is not portable between devices');
  return parts.join('/');
}
