import path from 'node:path';
import {createWriteStream, constants} from 'node:fs';
import {lstat, realpath, readdir, mkdir, chmod, rm, rename, open} from 'node:fs/promises';
import {crc32} from 'node:zlib';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import {ZipFile} from 'yazl';
import yauzl from 'yauzl';
import {MAX_FOLDER_BYTES, MAX_FOLDER_ARCHIVE_BYTES, MAX_FOLDER_ENTRIES, folderEntryPath} from '../shared/folder-transfer.mjs';

export async function packFolder(source, archive, progress = () => {}, include = () => true) {
  const root = await realpath(source), entries = [];
  if (!(await lstat(root)).isDirectory()) throw Error('文件夹不存在 / Folder is missing');
  let bytes = 0;
  async function walk(dir, prefix = '') {
    for (const entry of await readdir(dir, {withFileTypes: true})) {
      const name = folderEntryPath(prefix + entry.name);if(!include(name))continue;const file = path.join(dir, entry.name), info = await lstat(file);
      if (info.isSymbolicLink() || !info.isDirectory() && !info.isFile()) throw Error(`无法打包链接或特殊文件 / Cannot transfer links or special files: ${name}`);
      if (entries.length >= MAX_FOLDER_ENTRIES) throw Error('文件夹条目过多（最多 20000）/ Folder has too many entries');
      bytes += info.isFile() ? info.size : 0;
      if (bytes > MAX_FOLDER_BYTES) throw Error('文件夹展开后最多 10 GB / Folder contents can be up to 10 GB');
      entries.push({name, file, info});
      if (info.isDirectory()) await walk(file, name + '/');
    }
  }
  await walk(root);
  const zip = new ZipFile(); let compressed = 0;
  const limit = new Transform({transform(chunk, _enc, done) { compressed += chunk.length; done(compressed > MAX_FOLDER_ARCHIVE_BYTES ? Error('文件夹压缩包最多 2 GB / Folder archive can be up to 2 GB') : null, chunk); }});
  const writing = pipeline(zip.outputStream, limit, createWriteStream(archive, {flags: 'wx', mode: 0o600}));
  zip.on('error', error => zip.outputStream.destroy(error));
  for (const entry of entries) {
    const options = {mtime: entry.info.mtime, mode: entry.info.mode};
    if (entry.info.isDirectory()) zip.addEmptyDirectory(entry.name, options);
    else zip.addReadStreamLazy(entry.name, {...options, size: entry.info.size}, callback => {
      // Recheck when the stream actually opens: a directory must not become a
      // symlink to unrelated data between scanning and reading.
      void (async () => {
        const resolved = await realpath(entry.file);
        if (!resolved.startsWith(root + path.sep)) throw Error('打包时路径发生变化 / Folder path changed while packing');
        const handle = await open(entry.file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
        try { const current = await handle.stat(); if (!current.isFile() || current.ino !== entry.info.ino || current.dev !== entry.info.dev || current.size !== entry.info.size) throw Error('打包时文件发生变化，请重试 / File changed while packing; retry'); }
        catch (error) { await handle.close(); throw error; }
        callback(null, handle.createReadStream());
      })().catch(callback);
    });
  }
  progress({stage: 'compressing', files: entries.length, bytes}); zip.end();
  try { await writing; return {size: compressed, files: entries.length, bytes}; }
  catch (error) { zip.outputStream.destroy(); await rm(archive, {force: true}); throw error; }
}

// Always unpack into a new staging directory. Never merge into a user's folder.
export async function unpackFolder(archive, destination, cancelled = () => {}, progress = () => {}) {
  const stage = destination + '.extracting';
  await rm(stage, {recursive: true, force: true}); await mkdir(stage, {recursive: true, mode: 0o700});
  let zip, count = 0, total = 0; const names = new Set(), paths = new Map();
  try {
    zip = await new Promise((resolve, reject) => yauzl.open(archive, {lazyEntries: true, strictFileNames: true, validateEntrySizes: true}, (error, value) => error ? reject(error) : resolve(value)));
    await new Promise((resolve, reject) => {
      zip.once('error', reject); zip.once('end', resolve);
      zip.on('entry', entry => { void (async () => {
        cancelled(); if (++count > MAX_FOLDER_ENTRIES) throw Error('压缩包条目过多 / Too many archive entries');
        const relative = folderEntryPath(entry.fileName), key = relative.normalize('NFC').toLowerCase(), directory = entry.fileName.endsWith('/');
        const mode = (entry.externalFileAttributes >>> 16) & 0xffff, type = mode & 0xf000;
        if (entry.isEncrypted() || type && type !== 0x8000 && type !== 0x4000 || type === 0x4000 && !directory) throw Error('不支持加密、链接或特殊文件 / Encrypted or special archive entries are unsupported');
        if (names.has(key)) throw Error('压缩包有重复路径 / Duplicate archive path');
        for (let parent = path.posix.dirname(key); parent !== '.'; parent = path.posix.dirname(parent)) {
          if (paths.get(parent) === 'file') throw Error('压缩包路径冲突 / Archive path conflict');
          paths.set(parent, 'directory');
        }
        if (!directory && paths.has(key)) throw Error('压缩包路径冲突 / Archive path conflict');
        names.add(key); paths.set(key, directory ? 'directory' : 'file');
        total += entry.uncompressedSize;
        if (total > MAX_FOLDER_BYTES) throw Error('解压内容超过 10 GB / Expanded archive exceeds 10 GB');
        const target = path.join(stage, relative);
        if (directory) await mkdir(target, {recursive: true, mode: 0o700});
        else {
          await mkdir(path.dirname(target), {recursive: true, mode: 0o700});
          const stream = await new Promise((res, rej) => zip.openReadStream(entry, (error, value) => error ? rej(error) : res(value)));
          let written = 0, checksum = 0;
          await pipeline(stream, new Transform({transform(chunk, _enc, done) { try { cancelled(); written += chunk.length; checksum = crc32(chunk, checksum); if (written > entry.uncompressedSize) throw Error('Invalid archive size'); done(null, chunk); } catch (error) { done(error); } }}), createWriteStream(target, {flags: 'wx', mode: 0o600}));
          if (written !== entry.uncompressedSize || checksum !== entry.crc32) throw Error('解压内容校验失败 / Archive entry integrity check failed');
          if (mode & 0o111) await chmod(target, 0o700);
        }
        progress(count); zip.readEntry();
      })().catch(reject); });
      zip.readEntry();
    });
    cancelled(); await rename(stage, destination); return {files: count, bytes: total};
  } catch (error) { zip?.close(); await rm(stage, {recursive: true, force: true}); throw error; }
}
