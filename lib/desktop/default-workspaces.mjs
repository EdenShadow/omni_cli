import path from 'node:path';
import {accessSync, constants, lstatSync, mkdirSync, realpathSync} from 'node:fs';

const validId = value => typeof value === 'string' && /^[a-f\d-]{36}$/i.test(value);

export function ensureDefaultWorkspace(bridge, projectId, existingPath) {
  const {userId, device} = bridge.store;
  if (![userId, device?.id, projectId].every(validId)) throw Error('Invalid default workspace scope');
  // Keep user work outside versioned Runtime installs and isolate accounts,
  // devices and projects. UI language never changes this directory's identity.
  let directory = realpathSync(bridge.dataDir);
  for (const name of ['workspaces', userId, device.id, projectId]) {
    directory = path.join(directory, name);
    try { mkdirSync(directory, {mode: 0o700}); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const stat = lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw Error('默认工作区路径不可用 / Default workspace path is unavailable');
  }
  const canonical = realpathSync(directory);
  if (existingPath && path.resolve(existingPath) !== canonical) throw Error('默认工作区位置已变化，请在原设备上检查 / Default workspace location changed. Check the source computer.');
  accessSync(canonical, constants.R_OK | constants.W_OK);
  return canonical;
}

export class DefaultWorkspaces {
  constructor(bridge) { this.bridge = bridge; this.nextCheck = 0; this.running = null; }
  invalidate() { this.nextCheck = 0; }
  sync() {
    if (this.running) return this.running;
    const b = this.bridge, store = b.store, deviceId = store.device?.id, userId = store.userId;
    const token = store.deviceToken, generation = b.connectionGeneration;
    if (b.stopped || !deviceId || !userId || !token || Date.now() < this.nextCheck) return Promise.resolve();
    const current = () => !b.stopped && b.store === store && store.device?.id === deviceId && store.userId === userId && store.deviceToken === token && b.connectionGeneration === generation;
    this.nextCheck = Date.now() + 30000;
    this.running = (async () => {
      const result = await b.request('/api/bridge/default-workspaces', 'GET', undefined, true);
      for (const item of result.workspaces || []) {
        if (!current()) return;
        const cwd = ensureDefaultWorkspace(b, item.projectId, item.path);
        if (!item.ready) await b.request('/api/bridge/default-workspaces', 'POST', {projectId: item.projectId, provider: item.provider, path: cwd}, true);
      }
    })().catch(error => {
      if (current()) { this.lastError = error.message; this.nextCheck = Date.now() + (error.status === 404 ? 60000 : 5000); }
      // Retry independently: a folder/network failure must not stop existing work.
    }).finally(() => { this.running = null; });
    return this.running;
  }
}
