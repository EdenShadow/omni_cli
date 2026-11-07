import {execFile} from 'node:child_process';
import {access, constants, realpath} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const run = promisify(execFile);
const script = fileURLToPath(new URL('./sync.mjs', import.meta.url));

async function macExecutable() {
  const executable = 'Contents/MacOS/万物 AI';
  for (const dir of ['/Applications', path.join(homedir(), 'Applications')]) {
    const candidate = path.join(dir, '万物 AI.app', executable);
    try {
      await access(candidate, constants.X_OK);
      return await realpath(candidate);
    } catch (e) {
      if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') throw e;
    }
  }
  // On older clients the app may be running from a renamed or relocated bundle.
  try {
    const {stdout} = await run('/usr/bin/lsappinfo', ['info', '-only', 'bundlepath', 'com.wanwu321.desktop'], {timeout: 1500});
    const bundle = stdout.match(/^\s*bundle path="(\/[^"\n]+\.app)"\s*$/m)?.[1];
    if (bundle) return await realpath(path.join(bundle, executable));
  } catch { /* A standalone CLI host can run the skill without a desktop installation. */ }
}

export async function runNasInWanwu(contextFile, args) {
  if (process.platform !== 'darwin' || !contextFile) return;
  const app = await macExecutable();
  if (!app || app === await realpath(process.execPath)) return;

  // Re-resolve the original scoped key in Wanwu. Never pass its values to the child.
  const env = {ELECTRON_RUN_AS_NODE: '1'};
  for (const key of ['HOME', 'TMPDIR', 'LANG', 'WANWU_RUNTIME_DIR', 'NODE_EXTRA_CA_CERTS', 'NODE_USE_SYSTEM_CA']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  let stdout;
  try {
    ({stdout} = await run(app, [script, '--context', contextFile, ...args], {env, maxBuffer: 32 * 1024 * 1024}));
  } catch (failure) {
    throw new Error('万物 App 执行失败：' + (failure.stderr?.trim() || failure.code || '执行中断'), {cause: failure});
  }
  return JSON.parse(stdout);
}
