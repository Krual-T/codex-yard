import type { HostMessage } from './protocol.ts';

export function initialWorkspaceRoute(metadata: string | null | undefined, search: string, pathname: string) {
  return metadata?.trim() || new URLSearchParams(search).get('initialRoute')?.trim() || pathname || '/';
}

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
  private workspaceTimer?: ReturnType<typeof setTimeout>;
  private readonly timeoutMs: number;
  private readonly homepage: boolean;

  constructor(route: string | null, timeoutMs = 15_000, waitForWorkspace = false) {
    this.timeoutMs = timeoutMs;
    this.homepage = waitForWorkspace && (!route || route === '/');
    const parts = route?.split('/');
    if (parts?.length === 3 && parts[1] && parts[2]) {
      try { this.hostId = decodeURIComponent(parts[1]); this.threadId = decodeURIComponent(parts[2]); } catch { /* invalid route */ }
    }
  }

  wait(message: HostMessage): Promise<void> | undefined {
    if (this.finished || message.type !== 'mcp-request' || !message.request) return;
    const { method, params } = message.request;
    if (this.homepage) {
      if (method !== 'thread/list' || params?.cursor == null) return;
    } else if (!this.threadId) return;
    const otherHost = (message.hostId ?? 'local') !== this.hostId;
    const background = this.homepage || method === 'thread/list' && (otherHost || params?.cursor != null || Number(params?.limit) >= 100)
      || method === 'thread/attachment/list' && params?.threadId !== this.threadId
      || otherHost && ['model/list', 'mcpServerStatus/list', 'thread/read', 'thread/loaded/list'].includes(method);
    if (!background) return;
    return this.pending ??= new Promise(resolve => {
      this.resolve = resolve;
      this.timer = setTimeout(() => this.release(), this.timeoutMs);
    });
  }

  workspaceReady() {
    // Do not flood the first interactive frames with older pages from every
    // host. Sidebar navigation can still release them immediately.
    if (this.homepage && !this.finished) this.workspaceTimer ??= setTimeout(() => this.release(), 1500);
  }

  interact(listNavigation = false) {
    if (!this.homepage || listNavigation) this.release();
  }

  release() {
    this.finished = true;
    clearTimeout(this.timer);
    clearTimeout(this.workspaceTimer);
    this.resolve?.();
    this.resolve = undefined;
  }
}
