import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {realpath, stat, mkdtemp, mkdir, rm, open} from 'node:fs/promises';
import {packFolder} from './folder-archive.mjs';
import {ATTACHMENT_CHUNK_BYTES, chatFileName} from '../shared/chat-attachments.mjs';

export class FolderAttachments {
  constructor({dataDir, context, save, request, notify = () => {}}) {
    Object.assign(this, {dataDir, context, save, request, notify}); this.handles = new Map(); this.prepared = new Map();
  }
  async inspect(paths) {
    if (!Array.isArray(paths) || paths.length > 5) throw Error('每次最多 5 个附件 / Attach up to 5 items');
    return Promise.all(paths.map(async (value, index) => {
      if (!value) return null;
      const folder = await realpath(value); if (!(await stat(folder)).isDirectory()) return null;
      const id = randomUUID(); this.handles.set(id, folder);
      return {index, id, name: path.basename(folder) || 'Folder', path: folder};
    }));
  }
  async prepare(input) {
    const context = this.context(), source = this.handles.get(input.id);
    if (!context.token || !source) throw Error('请重新拖入文件夹 / Drop the folder again');
    for (const id of [input.projectId, input.deviceId, input.requestId]) if (!/^[a-f\d-]{36}$/i.test(id || '')) throw Error('Invalid folder transfer');
    const name = chatFileName(input.name || path.basename(source));
    const key = JSON.stringify([context.endpoint, context.userId, input.projectId, input.deviceId, input.requestId, input.id, name]);
    if (this.prepared.has(key)) return this.prepared.get(key);
    const run = this.transfer({...input, name, source}, context);
    this.prepared.set(key, run);
    try { return await run; } catch (error) { this.prepared.delete(key); throw error; }
  }
  async transfer(input, context) {
    const {projectId, deviceId, requestId, source, name} = input;
    const credentials = {...context}, boundId = context.device?.id;
    const valid = () => { if (this.context() !== context || !context.token || context.token !== credentials.token || context.userId !== credentials.userId || context.endpoint !== credentials.endpoint || context.device?.id !== boundId) throw Error('账号或设备已变化，请重新拖入 / Account or device changed; drop the folder again'); };
    const request = (route, method, body) => { valid(); return this.request(route, method, body, false, false, credentials); };
    const report = (stage, progress) => this.notify({type: 'folder-transfer', requestId, folderId: input.id, name, stage, progress});
    await request(`/api/projects/${projectId}/devices/${deviceId}/folder-support`, 'GET'); valid();
    const actual = await realpath(source); if (!(await stat(actual)).isDirectory()) throw Error('文件夹不存在 / Folder missing');
    if (boundId === deviceId) {
      // A damaged local binding must not silently become a cloud upload.
      if (!context.deviceToken) throw Error('请先恢复本机绑定后重试 / Restore this computer binding and retry');
      const id = randomUUID(); context.localFolderRefs ||= {};
      context.localFolderRefs[id] = {path: actual, projectId, userId: context.userId, deviceId, endpoint: context.endpoint, name};
      this.save(); report('local', 1);
      return {localFolder: {id, deviceId, name}};
    }
    const root = path.join(this.dataDir, 'folder-transfers'); await mkdir(root, {recursive: true, mode: 0o700});
    const temp = await mkdtemp(path.join(root, 'upload-')); let upload;
    try {
      report('compressing', 0); const archive = path.join(temp, 'folder.zip');
      const info = await packFolder(actual, archive); valid();
      upload = await request(`/api/projects/${projectId}/attachment-uploads`, 'POST', {name: name + '.zip', mime: 'application/zip', size: info.size, purpose: 'folder'});
      const file = await open(archive, 'r');
      try {
        while (!upload.ready) {
          valid(); const chunk = Buffer.alloc(Math.min(ATTACHMENT_CHUNK_BYTES, info.size - upload.received));
          const {bytesRead} = await file.read(chunk, 0, chunk.length, upload.received);
          if (!bytesRead) throw Error('无法读取压缩包 / Cannot read archive');
          upload = await request(`/api/projects/${projectId}/attachment-uploads/${upload.id}`, 'PUT', {offset: upload.received, data: chunk.subarray(0, bytesRead).toString('base64')});
          report('uploading', upload.received / info.size);
        }
      } finally { await file.close(); }
      report('publishing', 1);
      // uploadId is also the idempotency key: a lost COS publication response
      // can be retried without another object or another local archive.
      let result;
      for (let attempt = 0; attempt < 2; attempt++) {
        try { result = await request(`/api/projects/${projectId}/folder-uploads`, 'POST', {uploadId: upload.id, name}); break; }
        catch (error) { if (attempt || error.status && error.status < 500) throw error; }
      }
      valid(); report('ready', 1); return {folderArchiveId: result.id};
    } finally {
      // Only our mkdtemp directory is removed, including on upload failure.
      await rm(temp, {recursive: true, force: true});
      if (upload) await this.request(`/api/projects/${projectId}/attachment-uploads/${upload.id}`, 'DELETE', undefined, false, false, credentials).catch(() => {});
    }
  }
}

export async function resolveLocalFolder(bridge, command, file) {
  const context = bridge.store, grant = context.localFolderRefs?.[file.localFolderId];
  if (!grant || grant.projectId !== command.project_id || grant.userId !== command.options?.author?.id || grant.deviceId !== context.device?.id || grant.endpoint !== context.endpoint) throw Error('本机文件夹引用已失效，请重新拖入 / Local folder reference expired; drop it again');
  const folder = await realpath(grant.path);
  if (!(await stat(folder)).isDirectory()) throw Error('本机文件夹已移动或删除 / Local folder was moved or deleted');
  return folder;
}
