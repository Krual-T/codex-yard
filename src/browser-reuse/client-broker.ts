import { randomBytes, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { WebSocket } from 'ws';
import { checkClientKey } from './client-protocol.ts';
import type { ChromeConnections, ClientChromeReply, ConnectionRequest } from './client-protocol.ts';
import type { ChromePanelState, ChromeRequest } from './protocol.ts';

interface Pending { session: string; resolve(value: ChromePanelState): void; reject(error: Error): void; timer: NodeJS.Timeout }
interface Device { id: string; socket: WebSocket; label: string; pending: Map<string, Pending>; alive: boolean }

/** Only the page holding the device capability can create a one-use pairing or
 * route to it. Credentials and browser contents stay in memory. The companion
 * makes the outbound connection; no client debugging port is exposed. */
export class ClientChromeBroker {
  private readonly pairs = new Map<string, { clientKey: string; expiresAt: number }>();
  private readonly devices = new Map<string, Device>();
  private readonly heartbeat: NodeJS.Timeout;
  private readonly server: ChromeConnections['server'];
  private readonly timeoutMs: number;
  constructor(server: ChromeConnections['server'], timeoutMs = 70_000) {
    this.server = server; this.timeoutMs = timeoutMs;
    this.heartbeat = setInterval(() => {
      for (const [token, pair] of this.pairs) if (pair.expiresAt <= Date.now()) this.pairs.delete(token);
      for (const device of this.devices.values()) {
        if (!device.alive) device.socket.terminate();
        else { device.alive = false; device.socket.ping(); }
      }
    }, 30_000);
    this.heartbeat.unref();
  }
  connections(request: ConnectionRequest): ChromeConnections {
    checkClientKey(request.clientKey);
    if (!['state', 'pair', 'disconnect'].includes(request.operation)) throw new Error('无效的浏览器连接操作');
    const device = this.devices.get(request.clientKey);
    if (request.operation !== 'state') {
      for (const [token, pair] of this.pairs) if (pair.clientKey === request.clientKey) this.pairs.delete(token);
    }
    if (request.operation === 'disconnect' && device) this.detach(request.clientKey, device);
    let pairing: ChromeConnections['pairing'];
    if (request.operation === 'pair') {
      if (device) throw new Error('这台电脑已经配对，请先断开后再配对');
      const token = randomBytes(24).toString('base64url');
      const expiresAt = Date.now() + 5 * 60_000;
      this.pairs.set(token, { clientKey: request.clientKey, expiresAt });
      pairing = { token, expiresAt };
    }
    const current = this.devices.get(request.clientKey);
    return { client: { connected: !!current, label: current?.label }, server: this.server, ...(pairing ? { pairing } : {}) };
  }
  authorize(request: IncomingMessage): string | undefined {
    const token = request.headers.authorization?.match(/^Bearer ([a-zA-Z0-9_-]{32})$/)?.[1];
    const pair = token ? this.pairs.get(token) : undefined;
    if (!pair || pair.expiresAt <= Date.now() || this.devices.has(pair.clientKey)) return;
    this.pairs.delete(token!);
    return pair.clientKey;
  }
  attach(clientKey: string, socket: WebSocket, label: string) {
    const device: Device = { id: randomUUID(), socket, label: label.slice(0, 120), pending: new Map(), alive: true };
    this.devices.set(clientKey, device);
    socket.on('pong', () => { device.alive = true; });
    socket.on('message', data => {
      let reply: ClientChromeReply;
      try { reply = JSON.parse(String(data)); } catch { socket.close(1007); return; }
      if (!reply || reply.type !== 'result' || typeof reply.id !== 'string') { socket.close(1007); return; }
      const pending = device.pending.get(reply.id);
      if (!pending) return;
      device.pending.delete(reply.id); clearTimeout(pending.timer);
      if (typeof reply.error === 'string') pending.reject(new Error(reply.error));
      else if (reply.state && Array.isArray(reply.state.pages)) pending.resolve(reply.state);
      else pending.reject(new Error('客户端 Chrome 返回了无效画面'));
    });
    socket.on('close', () => this.detach(clientKey, device));
    socket.on('error', () => this.detach(clientKey, device));
    socket.send(JSON.stringify({ type: 'paired' }));
  }
  private detach(clientKey: string, device: Device) {
    if (this.devices.get(clientKey) === device) this.devices.delete(clientKey);
    for (const pending of device.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('访问电脑的 Chrome 连接已断开；请核对真实标签页后重新配对，操作不会重发'));
    }
    device.pending.clear(); device.socket.terminate();
  }
  device(clientKey: string) { checkClientKey(clientKey); return this.devices.get(clientKey)?.id; }
  request(clientKey: string, deviceId: string, session: string, request: ChromeRequest): Promise<ChromePanelState> {
    const device = this.devices.get(clientKey);
    if (!device || device.id !== deviceId || device.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('访问电脑的 Chrome 尚未连接或已经更换，请配对后刷新面板'));
    }
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.detach(clientKey, device), this.timeoutMs);
      device.pending.set(id, { session, resolve, reject, timer });
      device.socket.send(JSON.stringify({ type: 'request', id, session, request }), error => {
        if (error) this.detach(clientKey, device);
      });
    });
  }
  release(clientKey: string, deviceId: string, session: string) {
    const device = this.devices.get(clientKey);
    if (device?.id !== deviceId) return;
    for (const [id, pending] of device.pending) if (pending.session === session) {
      device.pending.delete(id); clearTimeout(pending.timer); pending.reject(new Error('浏览器面板已关闭，未确认的操作不会重发'));
    }
    if (device.socket.readyState === WebSocket.OPEN) device.socket.send(JSON.stringify({ type: 'release', session }));
  }
  get pendingRequests() { return [...this.devices.values()].reduce((sum, device) => sum + device.pending.size, 0); }
  close() {
    clearInterval(this.heartbeat); this.pairs.clear();
    for (const [key, device] of this.devices) this.detach(key, device);
  }
}
