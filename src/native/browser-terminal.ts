import type { TerminalCreate, TerminalEvent, TerminalOperation } from './terminal-protocol.ts';

/** Electron normally dispatches this app shortcut to the original tab controller. */
export function registerTerminalShortcut(target: Window, open: () => void) {
  target.addEventListener('keydown', event => {
    if (!event.defaultPrevented && !event.isComposing && event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey &&
      (event.code === 'Backquote' || event.key === '`')) {
      event.preventDefault();
      event.stopPropagation();
      open();
    }
  }, { capture: true });
}

interface RemoteListener {
  (event: TerminalEvent): Promise<void> & { [Symbol.dispose]?: () => void };
  dup(): RemoteListener;
  onRpcBroken(callback: () => void): void;
  [Symbol.dispose](): void;
}

export class BrowserTerminal {
  private listener: RemoteListener | null = null;
  private readonly sessions = new Set<string>();
  private readonly request: (operation: TerminalOperation, args: unknown[]) => Promise<unknown>;
  constructor(request: (operation: TerminalOperation, args: unknown[]) => Promise<unknown>) { this.request = request; }

  receive(event: TerminalEvent) {
    if (event.type === 'attached') this.sessions.add(event.sessionId);
    if (event.type === 'exit' || event.type === 'error') this.sessions.delete(event.sessionId);
    const result = this.listener?.(event);
    if (result) void Promise.resolve(result).catch(() => {}).finally(() => result[Symbol.dispose]?.());
  }
  disconnected() {
    for (const sessionId of this.sessions) this.receive({ type: 'exit', sessionId, code: null, signal: null,
      error: '宿主连接已断开，终端已关闭。请重新打开终端；输入不会重发。' });
  }
  subscribe(listener: RemoteListener) {
    this.unsubscribe();
    const copy = listener.dup();
    this.listener = copy;
    copy.onRpcBroken(() => { if (this.listener === copy) this.unsubscribe(); });
  }
  unsubscribe() { const listener = this.listener; this.listener = null; listener?.[Symbol.dispose](); }
  async call(operation: TerminalOperation, args: unknown[]) {
    if (operation === 'create' || operation === 'attach') this.sessions.add((args[0] as TerminalCreate).sessionId);
    if (operation === 'close') this.sessions.delete(String(args[0]));
    try { return await this.request(operation, args); }
    catch (error) {
      if (operation === 'create' || operation === 'attach') { this.sessions.delete((args[0] as TerminalCreate).sessionId); throw error; }
      if (operation === 'attachExisting') throw error;
      if (operation === 'write') this.receive({ type: 'input-status', sessionId: String(args[0]), error: (error as Error).message });
      else if (operation !== 'close') this.receive({ type: 'error', sessionId: String(args[0]), message: (error as Error).message });
      return null;
    }
  }
}

/** The original RPC engine requires service targets to extend its own RpcTarget. */
export function terminalRpcService(Base: new () => object, transport: BrowserTerminal) {
  return new class extends Base {
    create(value: TerminalCreate) { return transport.call('create', [value]); }
    attach(value: TerminalCreate) { return transport.call('attach', [value]); }
    attachExisting(value: TerminalCreate) { return transport.call('attachExisting', [value]); }
    close(id: string) { return transport.call('close', [id]); }
    write(id: string, data: string) { return transport.call('write', [id, data]); }
    resize(id: string, cols: number, rows: number, force = false) { return transport.call('resize', [id, cols, rows, force]); }
    getShellCwd(id: string, cwd: string) { return transport.call('getShellCwd', [id, cwd]); }
    getThreadSnapshot(conversationId: string) { return transport.call('getThreadSnapshot', [conversationId]); }
    getAvailableShells() { return []; } // Original Linux service returns no alternate shell choices.
    subscribe(listener: RemoteListener) { transport.subscribe(listener); }
    unsubscribe() { transport.unsubscribe(); }
    transferSessionOwnership() { return false; }
    [Symbol.dispose]() { transport.unsubscribe(); }
  }();
}
