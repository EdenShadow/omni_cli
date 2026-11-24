// Call for references intended to remain in a canvas after the current session.
export function cdnReference(value) {
  if (typeof value !== 'string' || !/^https:\/\//i.test(value) || /[\s\\]/.test(value)) {
    throw Error('请提供可长期引用的 HTTPS 素材地址');
  }
  const url = new URL(value);
  const protectedQuery = /^(?:sign(?:ature)?|sig|token|access_token|auth_key|expires?|policy|key-pair-id|hdnts|hdnea|x-amz-.+|x-goog-.+|q-(?:sign-.+|signature)|x-oss-(?:signature.+|signature|credential|expires)|ossaccesskeyid)$/i;
  if (url.username || url.password || /\/api\/canvas-content\//i.test(url.pathname) ||
      [...url.searchParams.keys()].some(key => protectedQuery.test(key))) {
    throw Error('临时或带凭据的地址请使用原附件 ID 或由来源按权限刷新');
  }
  return {url:value};
}

// Browser-side helper for a canvas with a URL input and a file picker/drop target.
export async function saveAssetSource(source, options) {
  if (typeof source === 'string') return cdnReference(source);
  if (typeof source?.fileId === 'string' && source.fileId) return {fileId:source.fileId};
  if (typeof File === 'undefined' || !(source instanceof File)) throw Error('请选择文件、现有附件或 CDN 地址');
  const file = await globalThis.Wanwu.files.upload(source, options);
  return {fileId:file.id};
}

export async function resolveAssetSource(ref) {
  if (ref.fileId) return (await globalThis.Wanwu.files.url(ref.fileId,{cdn:true})).url;
  return cdnReference(ref.url).url;
}
