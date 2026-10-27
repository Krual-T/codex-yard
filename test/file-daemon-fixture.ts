import { lstat, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ObjectValue } from '../src/native/protocol.ts';

// The real daemon wire shapes, deliberately without size in getMetadata.
// A path mapper lets tests put identical host paths on separate filesystems.
export function fileDaemonFixture(mapPath = (path: string) => path) {
  return async (method: string, params: ObjectValue) => {
    const path = mapPath(String(params.path));
    if (method === 'fs/getMetadata') {
      const info = await stat(path), link = await lstat(path);
      return { isFile: info.isFile(), isDirectory: info.isDirectory(), isSymlink: link.isSymbolicLink(),
        modifiedAtMs: info.mtimeMs, createdAtMs: info.birthtimeMs };
    }
    if (method === 'fs/readDirectory') {
      const entries = [];
      for (const entry of await readdir(path, { withFileTypes: true })) {
        const info = await stat(join(path, entry.name)).catch(() => null);
        entries.push({ fileName: entry.name, isDirectory: info?.isDirectory() ?? false, isFile: info?.isFile() ?? false });
      }
      return { entries };
    }
    if (method === 'fs/readFile') return { dataBase64: (await readFile(path)).toString('base64') };
    if (method === 'fs/createDirectory') { await mkdir(path, { recursive: params.recursive !== false }); return {}; }
    if (method === 'fs/writeFile') { await writeFile(path, Buffer.from(String(params.dataBase64), 'base64')); return {}; }
    throw new Error('Unexpected file RPC: ' + method);
  };
}
