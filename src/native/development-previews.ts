import { execFile, fork, spawn } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import type { IncomingHttpHeaders, IncomingMessage, Server, ServerResponse } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createConnection } from 'node:net';
import type { Socket } from 'node:net';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);
const idleTime = 45 * 60_000;
interface ServeLease { origin: string; ended: Promise<void>; close(): Promise<void>; alive(): boolean }

/** A foreground Serve session disappears with its CLI. The IPC worker also
 * terminates that CLI if Yard crashes, without writing background Serve state. */
export async function serveLoopback(port: number, hostname: string, binary = 'tailscale', signal?: AbortSignal): Promise<ServeLease> {
  signal?.throwIfAborted();
  if (process.platform === 'win32') throw new Error('自动预览的服务主机目前需要 Linux 或 macOS；访问设备可以使用 Windows');
  const origin = `https://${hostname}:${port}`;
  const worker = fork(fileURLToPath(import.meta.url), ['--serve-lease', binary, String(port)],
    { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], detached: true, execArgv: [] });
  let output = '', closing: Promise<void> | undefined;
  const ended = new Promise<void>(resolve => worker.once('close', () => {
    try { if (worker.pid) process.kill(-worker.pid, 'SIGKILL'); } catch {}
    resolve();
  }));
  const close = () => closing ??= (async () => {
    if (worker.exitCode == null && worker.signalCode == null) {
      if (worker.connected) worker.send('stop', () => {});
      else worker.kill('SIGTERM');
    }
    const force = setTimeout(() => {
      try { if (process.platform !== 'win32' && worker.pid) process.kill(-worker.pid, 'SIGKILL'); else worker.kill('SIGKILL'); } catch {}
    }, 4000);
    await ended; clearTimeout(force);
  })();
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('Tailscale 预览入口创建超时，请检查 Serve 权限和 HTTPS 配置')), 15_000);
      const abort = () => finish(new Error('预览创建已取消或超时'));
      const finish = (error?: Error) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); error ? reject(error) : resolve(); };
      signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
      worker.once('error', finish);
      worker.once('exit', code => finish(new Error('Tailscale 预览入口未能启动：' + (output.trim() || `exit ${code}`))));
      worker.stdout!.on('data', chunk => {
        output = (output + String(chunk)).slice(-8192);
        if (output.includes(origin + '/') || output.includes(origin + '\n')) finish();
      });
      worker.stderr!.on('data', chunk => { output = (output + String(chunk)).slice(-8192); });
    });
    return { origin, ended, close, alive: () => worker.exitCode == null && worker.signalCode == null };
  } catch (error) { await close(); throw error; }
}

interface Entry {
  target: URL;
  origin: string;
  server: Server;
  sockets: Set<Socket>;
  websockets: Set<Socket>;
  active: number;
  lastUsed: number;
  lease?: ServeLease;
  closing?: Promise<void>;
}
interface Options {
  publicOrigin: string;
  localOrigin(): string;
  tailscaleBin?: string;
  idleMs?: number;
}

export class DevelopmentPreviews {
  private readonly options: Options;
  private readonly entries = new Map<string, Entry>();
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  private readonly shutdown = new AbortController();
  private readonly timer: ReturnType<typeof setInterval>;
  constructor(options: Options) {
    this.options = options;
    this.timer = setInterval(() => { void this.sweep().catch(() => {}); }, Math.min(options.idleMs ?? idleTime, 60_000));
    this.timer.unref();
  }
  private parent() {
    if (!this.options.publicOrigin) return undefined;
    const url = new URL(this.options.publicOrigin);
    return url.protocol === 'https:' && url.hostname.endsWith('.ts.net') ? url : undefined;
  }
  private async hostname(parent: URL, signal: AbortSignal) {
    const { stdout } = await execute(this.options.tailscaleBin ?? 'tailscale', ['status', '--json'], { timeout: 5000, maxBuffer: 2 * 1024 * 1024, signal });
    const status = JSON.parse(stdout) as { BackendState?: string; Self?: { DNSName?: string } };
    if (status.BackendState !== 'Running' || status.Self?.DNSName?.replace(/\.$/, '').toLowerCase() !== parent.hostname.toLowerCase()) {
      throw new Error('自动预览需要已连接的 Tailscale，且 Yard HTTPS 地址属于当前设备');
    }
    return parent.hostname;
  }
  open(value: string, hostId = 'local'): Promise<{ url: string }> {
    const signal = AbortSignal.any([this.shutdown.signal, AbortSignal.timeout(15_000)]);
    const result = this.queue.catch(() => {}).then(async () => {
      if (this.closed) throw new Error('开发预览服务已关闭');
      signal.throwIfAborted();
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('预览需要不含凭据的 HTTP 或 HTTPS 地址');
      const parent = this.parent();
      if (!parent) return { url: url.href };
      const existing = [...this.entries.values()].find(entry => entry.origin === url.origin);
      if (existing) { existing.lastUsed = Date.now(); return { url: url.href }; }
      if (!loopback.has(url.hostname)) return { url: url.href };
      if (hostId !== 'local') throw new Error('自动预览当前支持 Yard 运行主机上的网站，请使用该主机的 Tailscale 网页地址');
      if (!url.port || Number(url.port) < 1024) throw new Error('自动预览需要 1024 到 65535 的开发端口');
      const local = new URL(this.options.localOrigin());
      if (url.port === local.port && url.protocol === local.protocol) return { url: parent.origin + url.pathname + url.search + url.hash };
      let entry = this.entries.get(url.origin);
      if (!entry) {
        const hostname = await this.hostname(parent, signal);
        await new Promise<void>((resolve, reject) => {
          const socket = createConnection({ host: url.hostname === 'localhost' ? '127.0.0.1' : url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port), signal });
          socket.setTimeout(3000, () => socket.destroy(new Error('开发服务连接超时')));
          socket.once('connect', () => { socket.destroy(); resolve(); }); socket.once('error', reject);
        }).catch(error => { throw new Error('开发服务尚未运行或无法访问：' + (error as Error).message); });
        entry = await this.create(url, hostname, signal);
        if (signal.aborted || this.closed) { await this.destroy(entry); throw new Error('预览创建已取消或超时'); }
        this.entries.set(url.origin, entry);
      }
      entry.lastUsed = Date.now();
      return { url: entry.origin + url.pathname + url.search + url.hash };
    });
    this.queue = result;
    return result;
  }
  private async create(target: URL, hostname: string, signal: AbortSignal): Promise<Entry> {
    const entry: Entry = { target: new URL(target.origin), origin: '', sockets: new Set(), websockets: new Set(), active: 0, lastUsed: Date.now(),
      server: createServer((request, response) => this.proxy(entry, request, response)) };
    entry.server.on('connection', socket => { entry.sockets.add(socket); socket.once('close', () => entry.sockets.delete(socket)); });
    entry.server.on('upgrade', (request, socket, head) => this.upgrade(entry, request, socket as Socket, head));
    try {
      const { stdout } = await execute(this.options.tailscaleBin ?? 'tailscale', ['serve', 'status', '--json'], { signal, timeout: 5000, maxBuffer: 2 * 1024 * 1024 });
      const occupied = new Set<string>();
      const ports = (config: { TCP?: Record<string, unknown>; Foreground?: Record<string, unknown> }) => {
        for (const port of Object.keys(config.TCP ?? {})) occupied.add(port);
        for (const child of Object.values(config.Foreground ?? {})) ports(child as typeof config);
      };
      ports(JSON.parse(stdout) ?? {});
      for (let creation = 0; ; creation++) {
        for (let attempt = 0; ; attempt++) {
          signal.throwIfAborted();
          await new Promise<void>((resolve, reject) => {
            entry.server.once('error', reject);
            entry.server.listen(0, '127.0.0.1', () => { entry.server.removeListener('error', reject); resolve(); });
          });
          if (!occupied.has(String((entry.server.address() as import('node:net').AddressInfo).port))) break;
          await new Promise<void>(resolve => entry.server.close(() => resolve()));
          if (attempt >= 10) throw new Error('无法找到空闲的 Tailscale 预览端口');
        }
        const port = (entry.server.address() as import('node:net').AddressInfo).port;
        entry.origin = `https://${hostname}:${port}`;
        try { entry.lease = await serveLoopback(port, hostname, this.options.tailscaleBin, signal); break; }
        catch (error) {
          const conflict = /listener already exists for port|address already in use|port.*already in use|another foreground session/i.test((error as Error).message);
          if (!conflict || creation >= 2 || signal.aborted) throw error;
          occupied.add(String(port));
          entry.server.closeAllConnections();
          await new Promise<void>(resolve => entry.server.close(() => resolve()));
        }
      }
      if (signal.aborted || !entry.lease.alive()) throw new Error('预览入口在创建期间已关闭');
      void entry.lease.ended.then(() => {
        if (!entry.closing) {
          if (this.entries.get(entry.target.origin) === entry) this.entries.delete(entry.target.origin);
          void this.destroy(entry);
        }
      });
      return entry;
    } catch (error) { await this.destroy(entry); throw error; }
  }
  private allowed(entry: Entry, request: IncomingMessage) {
    if (!request.url?.startsWith('/') || request.url.startsWith('//') || request.url.includes('\\')) return false;
    const host = request.headers.host;
    const port = new URL(entry.origin).port;
    if (host !== new URL(entry.origin).host && host !== `127.0.0.1:${port}`) return false;
    if (request.headers.origin && request.headers.origin !== entry.origin) return false;
    if (request.headers['sec-fetch-site'] !== 'cross-site') return true;
    try {
      return request.method === 'GET' && request.headers['sec-fetch-mode'] === 'navigate'
        && request.headers['sec-fetch-dest'] === 'iframe' && new URL(request.headers.referer ?? '').origin === this.options.publicOrigin;
    } catch { return false; }
  }
  private headers(entry: Entry, request: IncomingMessage): IncomingHttpHeaders {
    const headers = { ...request.headers, host: entry.target.host };
    if (headers.origin === entry.origin) headers.origin = entry.target.origin;
    if (headers.referer) {
      try { const ref = new URL(headers.referer); if (ref.origin === entry.origin) headers.referer = entry.target.origin + ref.pathname + ref.search; } catch {}
    }
    return headers;
  }
  private responseHeaders(entry: Entry, headers: IncomingHttpHeaders, path: string) {
    const result = { ...headers };
    delete result['x-frame-options'];
    const policies = result['content-security-policy'];
    const reframe = (policy: string) => policy.split(';').filter(part => !/^\s*frame-ancestors(?:\s|$)/i.test(part)).join(';')
      + `; frame-ancestors 'self' ${this.options.publicOrigin}`;
    result['content-security-policy'] = Array.isArray(policies) ? policies.map(reframe) : reframe(policies ?? '');
    if (result.location) {
      try { const url = new URL(result.location, new URL(path, entry.target)); if (url.origin === entry.target.origin) result.location = entry.origin + url.pathname + url.search + url.hash; } catch {}
    }
    if (result['set-cookie']) result['set-cookie'] = result['set-cookie'].map(cookie => cookie.replace(/;\s*domain=\.?(?:localhost|127\.0\.0\.1|\[?::1\]?)(?=;|$)/ig, ''));
    return result;
  }
  private upstream(entry: Entry, request: IncomingMessage) {
    const send = entry.target.protocol === 'https:' ? httpsRequest : httpRequest;
    const upstream = send(entry.target, { path: request.url ?? '/', method: request.method, headers: this.headers(entry, request), agent: false,
      lookup: entry.target.hostname === 'localhost' ? (_host, options, done) => {
        if (options.all) done(null, [{ address: '127.0.0.1', family: 4 }]); else done(null, '127.0.0.1', 4);
      } : undefined });
    upstream.on('socket', socket => { entry.sockets.add(socket); socket.once('close', () => entry.sockets.delete(socket)); });
    return upstream;
  }
  private proxy(entry: Entry, request: IncomingMessage, response: ServerResponse) {
    if (!this.allowed(entry, request)) { response.writeHead(403); response.end('预览请求来源不受信任'); return; }
    entry.lastUsed = Date.now(); entry.active++;
    response.once('close', () => { entry.active--; entry.lastUsed = Date.now(); });
    const upstream = this.upstream(entry, request);
    const timeout = setTimeout(() => upstream.destroy(new Error('开发服务响应超时')), 30_000);
    upstream.once('response', result => {
      clearTimeout(timeout);
      response.writeHead(result.statusCode ?? 502, this.responseHeaders(entry, result.headers, request.url ?? '/'));
      result.once('error', error => response.destroy(error)); result.pipe(response);
    });
    upstream.once('error', error => {
      clearTimeout(timeout);
      if (response.headersSent) response.destroy(error);
      else if (request.method === 'GET' && request.headers.accept?.includes('text/html')) {
        const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
        response.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
          'Content-Security-Policy': `default-src 'none'; frame-ancestors 'self' ${this.options.publicOrigin}` });
        response.end(`<html lang="zh-CN"><meta charset="utf-8"><title>预览暂时无法连接</title><h1>预览暂时无法连接</h1><p>${escape(error.message)}</p><p>确认开发服务仍在运行后，<a href="${escape(entry.origin + request.url)}">重试</a>。</p></html>`);
      } else { response.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('无法连接开发服务：' + error.message); }
    });
    request.once('aborted', () => upstream.destroy()); response.once('close', () => { if (!response.writableEnded) upstream.destroy(); });
    request.once('error', () => upstream.destroy()); response.once('error', () => upstream.destroy());
    request.pipe(upstream);
  }
  private upgrade(entry: Entry, request: IncomingMessage, socket: Socket, head: Buffer) {
    socket.once('error', () => socket.destroy());
    if (!this.allowed(entry, request)) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
    entry.lastUsed = Date.now();
    const upstream = this.upstream(entry, request);
    const timeout = setTimeout(() => upstream.destroy(new Error('开发服务 WebSocket 连接超时')), 10_000);
    const respond = (message: IncomingMessage) => {
      const headers = message.rawHeaders;
      socket.write(`HTTP/1.1 ${message.statusCode} ${message.statusMessage}\r\n` + headers.reduce((text, value, index) => text + (index % 2 ? value + '\r\n' : value + ': '), '') + '\r\n');
    };
    upstream.once('upgrade', (message, outgoing, upstreamHead) => {
      clearTimeout(timeout); respond(message);
      entry.sockets.add(outgoing); entry.websockets.add(socket);
      outgoing.once('close', () => { entry.sockets.delete(outgoing); socket.destroy(); });
      socket.once('close', () => { entry.websockets.delete(socket); outgoing.destroy(); entry.lastUsed = Date.now(); });
      socket.on('data', () => { entry.lastUsed = Date.now(); }); outgoing.on('data', () => { entry.lastUsed = Date.now(); });
      socket.on('error', () => outgoing.destroy()); outgoing.on('error', () => socket.destroy());
      if (upstreamHead.length) socket.write(upstreamHead); if (head.length) outgoing.write(head);
      socket.pipe(outgoing).pipe(socket);
    });
    upstream.once('response', message => { clearTimeout(timeout); respond(message); message.once('error', () => socket.destroy()); message.pipe(socket); });
    upstream.once('error', () => { clearTimeout(timeout); socket.destroy(); });
    socket.once('close', () => upstream.destroy()); upstream.end();
  }
  private destroy(entry: Entry) {
    return entry.closing ??= (async () => {
      for (const socket of entry.sockets) socket.destroy();
      await entry.lease?.close();
      if (entry.server.listening) await new Promise<void>(resolve => entry.server.close(() => resolve()));
    })();
  }
  async sweep() {
    const next = this.queue.catch(() => {}).then(async () => {
      for (const [key, entry] of this.entries) if (!entry.active && !entry.websockets.size && Date.now() - entry.lastUsed >= (this.options.idleMs ?? idleTime)) {
        this.entries.delete(key); await this.destroy(entry);
      }
    });
    this.queue = next; await next;
  }
  async close() {
    this.closed = true; this.shutdown.abort(); clearInterval(this.timer); await this.queue.catch(() => {});
    await Promise.all([...this.entries.values()].map(entry => this.destroy(entry))); this.entries.clear();
  }
}

if (process.argv[2] === '--serve-lease' && process.send) {
  const child = spawn(process.argv[3]!, ['serve', '--yes', '--https=' + process.argv[4], 'http://127.0.0.1:' + process.argv[4]], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
  let closing = false;
  const stop = () => {
    if (closing) return; closing = true; child.kill('SIGINT');
    setTimeout(() => child.kill('SIGKILL'), 1500).unref();
  };
  process.once('disconnect', stop); process.on('message', stop);
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  child.once('error', error => { console.error(error.message); process.exit(1); });
  child.once('close', code => process.exit(closing ? 0 : code || 1));
}
