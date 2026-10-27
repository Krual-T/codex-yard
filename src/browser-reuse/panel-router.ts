import { randomUUID } from 'node:crypto';
import { ChromePanelHost } from './panel-host.ts';
import { ClientChromeBroker } from './client-broker.ts';
import { checkClientKey } from './client-protocol.ts';
import type { ChromeConnection } from './chrome-mcp.ts';
import { chromeSnapshot } from './protocol.ts';
import type { ChromePanelState, ChromeRequest } from './protocol.ts';

/** One native page owns its sessions. The access device is the default; the
 * service machine is selected explicitly and is never a failure fallback. */
export class ChromePanelRouter {
  private server?: ChromePanelHost;
  private remote?: { clientKey: string; deviceId: string; session: string };
  private clientKey?: string;
  private closed = false;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly config: ChromeConnection | undefined;
  private readonly broker: ClientChromeBroker;
  private readonly publish: (message: Record<string, unknown>) => void;
  private readonly origin: string;
  constructor(config: ChromeConnection | undefined, broker: ClientChromeBroker,
    publish: (message: Record<string, unknown>) => void, origin: string) {
    this.config = config; this.broker = broker; this.publish = publish; this.origin = origin;
  }

  request(request: ChromeRequest): Promise<ChromePanelState> {
    const result = this.queue.catch(() => {}).then(() => this.run(request));
    this.queue = result;
    return result;
  }
  private async run(request: ChromeRequest): Promise<ChromePanelState> {
    if (this.closed) throw new Error('浏览器面板连接已关闭');
    checkClientKey(request.clientKey);
    if (this.clientKey && this.clientKey !== request.clientKey) throw new Error('访问设备已变化，请刷新工作台');
    this.clientKey = request.clientKey;
    if (request.connection === 'server') {
      this.server ??= new ChromePanelHost(this.config, this.publish, this.origin);
      return this.server.request(request);
    }
    if (request.connection !== 'client') throw new Error('请选择浏览器所在电脑');
    const deviceId = this.broker.device(request.clientKey);
    if (!deviceId) {
      const error = '这台访问电脑尚未连接 Chrome。点击“连接这台电脑”完成首次配对。';
      if (!['state', 'release'].includes(request.operation)) throw new Error(error);
      return { configured: false, location: 'Chrome · 当前访问电脑', pages: [], error };
    }
    if (!this.remote || this.remote.deviceId !== deviceId) {
      if (!['state', 'release'].includes(request.operation)) throw new Error('Chrome 连接已更换，请先刷新面板，再核对操作');
      if (this.remote) this.broker.release(this.remote.clientKey, this.remote.deviceId, this.remote.session);
      this.remote = { clientKey: request.clientKey, deviceId, session: randomUUID() };
    }
    const state = await this.broker.request(request.clientKey, deviceId, this.remote.session, request);
    if (!this.closed && state.frame) this.publish({ type: 'browser-sidebar-state', conversationId: request.conversationId,
      browserTabId: request.browserTabId, snapshot: chromeSnapshot(state.frame) });
    return state;
  }
  async close() {
    this.closed = true;
    if (this.remote) this.broker.release(this.remote.clientKey, this.remote.deviceId, this.remote.session);
    await this.server?.close();
    await this.queue.catch(() => {});
  }
}
