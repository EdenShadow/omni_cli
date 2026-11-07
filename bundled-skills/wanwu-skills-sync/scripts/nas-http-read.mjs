import {createHash, randomUUID} from 'node:crypto';
import {open, link, unlink} from 'node:fs/promises';
import path from 'node:path';
import {runNasInWanwu} from './nas-mac-runtime.mjs';

async function download(response, output) {
  if (response.status !== 200 || !response.body) throw Error('NAS 文件返回 HTTP ' + response.status);
  const temp = path.join(path.dirname(output), '.wanwu-part-' + randomUUID());
  const file = await open(temp, 'wx', 0o600);
  const hash = createHash('sha256');
  let size = 0;
  try {
    for await (const bytes of response.body) {
      await file.writeFile(bytes);
      hash.update(bytes);
      size += bytes.length;
    }
    await file.close();
    await link(temp, output);
    return {status: 'downloaded', httpStatus: response.status, output, size, sha256: hash.digest('hex')};
  } finally { await file.close(); await unlink(temp); }
}

// Read a known static file on the selected NAS without sending SMB credentials.
export async function readNasHttp(request, contextFile, input, output) {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.search || url.hash || url.pathname.endsWith('/')) throw Error('请提供已知 NAS 文件的完整 HTTP(S) 地址');
  if (output && !path.isAbsolute(output)) throw Error('请用 --output 指定新的本地绝对路径');
  const args = output ? ['nas-http-get', '--output', output] : ['nas-http-check'];
  const appResult = await runNasInWanwu(contextFile, [...args, '--url', url.href]);
  if (appResult !== undefined) return appResult;

  const catalog = await request({action: 'credentials-status'});
  const dependency = catalog.items.find(s => s.name === 'wanwu-skills-sync')?.dependencies.find(d => d.id === 'nas-smb');
  const entry = dependency?.entries.find(e => e.id === dependency.currentEntryId);
  if (entry?.nasWeb !== 'existing' || url.origin !== entry.nasHttpOrigin)
    throw Error('请使用当前选中 NAS 已就绪的网页服务和文件地址；万物代理地址请在画布里验证');

  const headers = {'Accept-Encoding': 'identity'};
  if (!output) headers.Range = 'bytes=0-127';
  const response = await fetch(url, {headers, redirect: 'error', signal: AbortSignal.timeout(output ? 600000 : 10000)});
  try {
    if (output) return await download(response, output);
    if (![200, 206].includes(response.status) || !response.body) throw Error('NAS 文件返回 HTTP ' + response.status);
    const range = response.headers.get('content-range');
    const match = range?.match(/^bytes 0-(\d+)\/(\d+)$/);
    if (response.status === 206 && (!match || Number(match[1]) !== Math.min(Number(match[2]), 128) - 1))
      throw Error('NAS 返回的分段范围无效');
    const reader = response.body.getReader();
    let sampleBytes = 0;
    const hash = createHash('sha256');
    try {
      while (sampleBytes < 128) {
        const {value, done} = await reader.read();
        if (done) break;
        const part = value.subarray(0, 128 - sampleBytes);
        sampleBytes += part.length;
        hash.update(part);
      }
    } finally { reader.releaseLock(); }
    if (response.status === 206 && sampleBytes !== Number(match[1]) + 1) throw Error('NAS 分段读取不完整');
    return {status: response.status, contentRange: range, sampleBytes, sampleSha256: hash.digest('hex')};
  } finally { await response.body?.cancel().catch(() => {}); }
}
