// File bytes travel through the local-file or explicit attachment-transfer channel,
// not through runtime history / live transcript JSON. Preserve paths and metadata.
export function withoutInlineMedia(value) {
  if (typeof value === 'string') return value.replace(/data:[\w.+-]+\/[\w.+-]+(?:;[^,\s]*)?;base64,[A-Za-z0-9+/=\r\n]+/gi, '[Inline file omitted]');
  if (Array.isArray(value)) return value.map(withoutInlineMedia);
  if (!value || typeof value !== 'object') return value;
  const media = /^(?:image|audio|video|document|input_audio|input_image|output_image|base64)$/.test(value.type || '')
    || typeof (value.mimeType || value.mime_type || value.media_type) === 'string';
  return Object.fromEntries(Object.entries(value).filter(([key]) => {
    if (media && ['data','base64','b64_json','bytes','blob'].includes(key)) return false;
    if (value.type === 'imageGeneration' && key === 'result') return false;
    return true;
  }).map(([key,child]) => [key, withoutInlineMedia(child)]));
}
