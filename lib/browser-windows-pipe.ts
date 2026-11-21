// The original Chrome native host stays on Windows. WSL exposes its original
// framed protocol through an owner-only Unix socket, with no TCP listener.
import { spawn } from 'node:child_process';
import { chmod, readdir } from 'node:fs/promises';
import { createConnection, createServer } from 'node:net';
import type { Socket } from 'node:net';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { windowsNode, windowsPath } from './windows-paths.ts';
import { preparePrivateSocket } from './private-socket.ts';

const prefix = '\\\\.\\pipe\\codex-browser-use';

/** Read only the upstream getInfo handshake; never expose App IAB pipes. */
export function chromePipeInfo(path: string): Promise<Record<string, unknown> | null> {
  return new Promise(resolve => {
    const socket = createConnection(path), id = 1;
    let bytes = Buffer.alloc(0), done = false;
    const finish = (info: Record<string, unknown> | null) => {
      if (done) return; done = true; clearTimeout(timer); socket.destroy(); resolve(info);
    };
    const timer = setTimeout(() => finish(null), 1500);
    socket.once('connect', () => {
      const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, method: 'getInfo', params: {
        session_id: randomUUID(), turn_id: randomUUID(), session_context: 'live',
      } }));
      const header = Buffer.alloc(4); header.writeUInt32LE(body.length);
      socket.write(Buffer.concat([header, body]));
    });
    socket.on('data', (chunk: Buffer) => {
      bytes = Buffer.concat([bytes, chunk]);
      if (bytes.length < 4) return;
      const length = bytes.readUInt32LE(0);
      if (length > 8 * 1024 * 1024) { finish(null); return; }
      if (bytes.length < length + 4) return;
      try {
        const message = JSON.parse(bytes.subarray(4, length + 4).toString('utf8')) as { id?: unknown; result?: Record<string, unknown> };
        finish(message.id === id && message.result?.type === 'extension' ? message.result : null);
      } catch { finish(null); }
    });
    socket.once('error', () => finish(null)); socket.once('close', () => finish(null));
  });
}

async function discoverChromePipe(selected?: string): Promise<string> {
  if (process.platform !== 'win32') throw new Error('Chrome named-pipe discovery must run in standalone Windows Node.');
  const candidates = selected ? [selected] : (await readdir('\\\\.\\pipe\\')).map(name => '\\\\.\\pipe\\' + name).filter(name => name.startsWith(prefix));
  const active = (await Promise.all(candidates.map(async path => ({ path, info: await chromePipeInfo(path) })))).filter(item => item.info);
  if (!active.length) throw new Error('No Windows Chrome extension backend is connected. Install the original native host and connect the official ChatGPT Chrome extension.');
  if (active.length !== 1) throw new Error('Multiple Windows Chrome profiles are connected. Set YARD_CHROME_WINDOWS_PIPE to the intended original extension pipe.');
  return active[0].path;
}

export async function startWindowsChromeBridge(socketPath: string, env: NodeJS.ProcessEnv = process.env): Promise<{ path: string; close(): Promise<void> }> {
  if (process.platform === 'win32') throw new Error('Native Windows Node connects to Chrome pipes directly; this bridge is for WSL.');
  const executable = windowsNode(env), script = windowsPath(fileURLToPath(import.meta.url));
  await preparePrivateSocket(socketPath, 'Windows Chrome');
  const sockets = new Set<Socket>();
  const children = new Set<ReturnType<typeof spawn>>();
  const server = createServer(socket => {
    sockets.add(socket);
    const child = spawn(executable, [script, '--connect', env.YARD_CHROME_WINDOWS_PIPE || ''], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    children.add(child);
    socket.pipe(child.stdin); child.stdout.pipe(socket);
    child.stderr.on('data', (value: Buffer) => console.error('Windows Chrome:', value.toString('utf8').trim()));
    child.stdin.on('error', () => socket.destroy()); child.once('error', error => { console.error('Windows Chrome:', error.message); socket.destroy(); });
    socket.once('error', () => child.stdin.end());
    socket.once('close', () => { sockets.delete(socket); child.stdin.end(); });
    child.once('close', () => { children.delete(child); socket.destroy(); });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
  await chmod(socketPath, 0o600);
  return { path: socketPath, async close() {
    for (const socket of sockets) socket.destroy();
    for (const child of children) child.stdin?.end();
    await new Promise<void>(resolve => server.close(() => resolve()));
  } };
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode !== '--connect' && mode !== '--list') throw new Error('Use --connect or --list.');
  const path = await discoverChromePipe(process.argv[3] || undefined);
  if (mode === '--list') { console.log(JSON.stringify({ path, type: 'extension' })); return; }
  const socket = createConnection(path);
  socket.once('connect', () => { process.stdin.pipe(socket); socket.pipe(process.stdout); });
  socket.once('error', error => { console.error(error.message); process.exitCode = 1; process.stdin.destroy(); });
  socket.once('close', () => process.stdin.destroy());
  process.stdout.once('error', () => socket.destroy());
  process.once('SIGTERM', () => socket.end()); process.once('SIGINT', () => socket.end());
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main().catch(error => { console.error((error as Error).message); process.exitCode = 1; });
