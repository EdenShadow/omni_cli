// Count only resource payloads. Application code and ordinary page text can be large.
const inlineLimit = 64 * 1024;
const totalLimit = 256 * 1024;
const source = /\.(?:html?|css|[cm]?js|json|webmanifest|map|xml|txt|svg)$/i;
const program = /\.(?:html?|css|[cm]?js|json|webmanifest|map|xml|txt|wasm)$/i;

function validateSize(bytes, path, total) {
  if (bytes >= inlineLimit || total + bytes >= totalLimit) {
    throw Error(`画布素材超出轻量网页预算（${path}）。用 asset 或 attach 保存到当前画布，在页面按需调用 Wanwu.files.url(fileId,{cdn:true})。仅明确需要离线内嵌时设置 assetDelivery="embedded"。`);
  }
  return total + bytes;
}

export async function checkPageAssets(refs, handles, mode = 'cdn') {
  if (!['cdn', 'embedded'].includes(mode)) throw Error('assetDelivery must be cdn or embedded');
  let total = 0;
  for (const [i, ref] of refs.entries()) {
    const item = handles[i];
    if (/(?:^|\/)(?:\.env(?:\.|$)|auth\.json$|credentials)/i.test(ref.path)) throw Error('Do not publish credential files');
    if (mode === 'cdn' && !program.test(ref.path)) total = validateSize(item.size, ref.path, total);
    if (!source.test(ref.path)) continue;
    const text = await item.file.readFile('utf8');
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:sk-[a-zA-Z0-9_-]{24,}|AKID[a-zA-Z0-9]{28,})\b/.test(text)) throw Error('Remove credentials from ' + ref.path);
    if (mode === 'embedded' || !program.test(ref.path)) continue;
    // Count encoded bytes as transferred, including payloads assigned to a JS/JSON string.
    const dataUrls = /\bdata:[^,\s"'\x60<>()]{0,256}?;base64,([A-Za-z0-9+/=\r\n\t ]+)|\bdata:[^,\s"'\x60<>()]{0,256},([^"'\x60\s<>)]*)/gi;
    for (const match of text.matchAll(dataUrls)) total = validateSize(Buffer.byteLength(match[1] ?? match[2]), ref.path, total);
    const base64Strings = /(["'\x60])([A-Za-z0-9+/]{4096,}={0,2})\1/g;
    for (const match of text.matchAll(base64Strings)) total = validateSize(match[2].length, ref.path, total);
  }
}
