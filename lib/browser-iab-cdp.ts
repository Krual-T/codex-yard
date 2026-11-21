/** Chromium's documented remote-debugging-pipe transport. No listening TCP port
 * or installed desktop application's private process is used. */
import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { Readable, Writable } from 'node:stream';

export interface CdpEvent { method: string; params: Record<string, unknown>; sessionId?: string }
interface Reply { id?: number; result?: unknown; error?: { message: string }; method?: string; params?: Record<string, unknown>; sessionId?: string }

export class IabCdp extends EventEmitter {
  private readonly child: ChildProcess;
  private readonly input: Writable;
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
  private nextId = 0;
  private stopped = false;
  private stderr = '';
  private readonly exited: Promise<void>;
  constructor(executable: string, args: string[]) {
    super();
    this.child = spawn(executable, args, { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'], windowsHide: true });
    this.input = this.child.stdio[3] as Writable;
    const output = this.child.stdio[4] as Readable;
    let buffered = '';
    output.setEncoding('utf8');
    output.on('data', (part: string) => {
      buffered += part;
      if (Buffer.byteLength(buffered) > 64 * 1024 * 1024) { this.fail(new Error('Chromium returned an oversized CDP message')); this.child.kill(); return; }
      for (let end; (end = buffered.indexOf('\0')) >= 0;) {
        const line = buffered.slice(0, end); buffered = buffered.slice(end + 1);
        if (!line) continue;
        try { this.receive(JSON.parse(line) as Reply); } catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))); }
      }
    });
    this.child.stderr!.setEncoding('utf8').on('data', (part: string) => { this.stderr = (this.stderr + part).slice(-2500); });
    this.child.on('error', error => this.fail(error));
    this.input.on('error', error => this.fail(error));
    this.exited = new Promise(resolve => this.child.once('close', () => {
      this.fail(new Error('Yard Browser stopped. ' + this.stderr)); resolve();
    }));
  }
  private fail(error: Error) {
    if (!this.stopped) { this.stopped = true; this.emit('closed', error); }
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); }
    this.pending.clear();
  }
  private receive(value: Reply) {
    if (typeof value.id === 'number') {
      const item = this.pending.get(value.id);
      if (!item) return;
      this.pending.delete(value.id); clearTimeout(item.timer);
      if (value.error) item.reject(new Error(value.error.message)); else item.resolve(value.result);
    } else if (value.method) this.emit('event', { method: value.method, params: value.params ?? {}, sessionId: value.sessionId } satisfies CdpEvent);
  }
  send<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}, sessionId?: string, timeoutMs = 15_000): Promise<T> {
    if (this.stopped) return Promise.reject(new Error('Yard Browser is disconnected'));
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id); reject(new Error(`Chromium CDP timed out: ${method}. Check the tab before retrying an input action.`));
      }, Math.max(1, Math.min(timeoutMs, 120_000)));
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer });
      this.input.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
    });
  }
  async close() {
    if (!this.stopped) await this.send('Browser.close', {}, undefined, 1500).catch(() => {});
    const stop = setTimeout(() => this.child.kill(), 2000);
    const hardStop = setTimeout(() => this.child.kill('SIGKILL'), 4000);
    await this.exited; clearTimeout(stop); clearTimeout(hardStop);
  }
}
