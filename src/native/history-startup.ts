import type { HostMessage } from './protocol.ts';

/** Give a directly opened conversation the first rendering frames. Saved SSH
 * hosts remain visible and keep their original connection preferences. Only
 * background reads wait; user interaction and a bounded fallback release them. */
export class HistoryStartup {
  private readonly hostId: string | undefined;
  private readonly threadId: string | undefined;
  private finished = false;
  private pending?: Promise<void>;
  private resolve?: () => void;
  private timer?: ReturnType<typeof setTimeout>;
  private readonly timeoutMs: number;

  constructor(route: string | null, timeoutMs = 15_000) {
    this.timeoutMs = timeoutMs;
    const parts = route?.split('/');
    if (parts?.length === 3 && parts[1] && parts[2]) {
      try { this.hostId = decodeURIComponent(parts[1]); this.threadId = decodeURIComponent(parts[2]); } catch { /* invalid route */ }
    }
  }

  wait(message: HostMessage): Promise<void> | undefined {
    if (this.finished || !this.threadId || message.type !== 'mcp-request' || !message.request) return;
    const { method, params } = message.request;
    const otherHost = (message.hostId ?? 'local') !== this.hostId;
    const background = method === 'thread/list' && (otherHost || params?.cursor != null || Number(params?.limit) >= 100)
      || method === 'thread/attachment/list' && params?.threadId !== this.threadId
      || otherHost && ['model/list', 'mcpServerStatus/list', 'thread/read', 'thread/loaded/list'].includes(method);
    if (!background) return;
    return this.pending ??= new Promise(resolve => {
      this.resolve = resolve;
      this.timer = setTimeout(() => this.release(), this.timeoutMs);
    });
  }

  release() {
    this.finished = true;
    clearTimeout(this.timer);
    this.resolve?.();
    this.resolve = undefined;
  }
}
