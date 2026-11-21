import { lstat, mkdir, rm } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { dirname } from 'node:path';
import { isRecord } from './codex-protocol.ts';

/** Recover a crashed host's socket without replacing a live host or other file. */
export async function preparePrivateSocket(socketPath: string, label: string): Promise<void> {
  if (Buffer.byteLength(socketPath) > 107) throw new Error(`${label} Unix socket 路径超过 107 字节，请缩短数据目录：${socketPath}`);
  const directory = dirname(socketPath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const parent = await lstat(directory);
  if (!parent.isDirectory() || parent.uid !== process.getuid?.() || (parent.mode & 0o077)) {
    throw new Error(`${label} socket 需要当前用户拥有的私有目录（0700）：${directory}`);
  }
  const missing = (cause: unknown) => {
    if (!isRecord(cause) || cause.code !== 'ENOENT') throw cause;
    return null;
  };
  const existing = await lstat(socketPath).catch(missing);
  if (!existing) return;
  if (!existing.isSocket() || existing.uid !== process.getuid?.() || (existing.mode & 0o077)) {
    throw new Error(`${label} socket 路径已被其他内容占用：${socketPath}`);
  }
  const active = await new Promise<boolean>((resolve, reject) => {
    const probe = createConnection({ path: socketPath });
    const finish = (value: boolean) => { probe.destroy(); resolve(value); };
    probe.setTimeout(300, () => finish(true));
    probe.once('connect', () => finish(true));
    probe.once('error', cause => {
      probe.destroy();
      if (isRecord(cause) && (cause.code === 'ECONNREFUSED' || cause.code === 'ENOENT')) resolve(false);
      else reject(cause);
    });
  });
  if (active) throw new Error(`${label} socket 已由运行中的实例使用：${socketPath}`);
  const current = await lstat(socketPath).catch(missing);
  if (current && (current.ino !== existing.ino || current.dev !== existing.dev)) throw new Error(`${label} socket 在启动时发生变化，请重试。`);
  if (current) await rm(socketPath);
}
