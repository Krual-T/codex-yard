import { fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export type NodeContent = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
export class NodeRuntime {
  private child?: ChildProcess;
  private pending?: { resolve(value: NodeContent[]): void; reject(error: Error): void };
  private queue: Promise<unknown> = Promise.resolve();
  private generation = 0;
  private closed = false;
  private stopping: Promise<void> = Promise.resolve();
  private readonly cwd: string;
  constructor(cwd = process.cwd()) { this.cwd = cwd; }

  reset(reason = 'JavaScript kernel reset; variables were discarded.'): void {
    this.generation++;
    const child = this.child; this.child = undefined;
    const pending = this.pending; this.pending = undefined;
    if (child && child.exitCode === null && child.signalCode === null) {
      this.stopping = new Promise(resolve => child.once('close', () => resolve()));
      child.kill('SIGKILL');
    }
    pending?.reject(new Error(reason));
  }
  close() { this.closed = true; this.reset('JavaScript session closed.'); return this.stopping; }

  evaluate(code: string, timeout = 30000, signal?: AbortSignal): Promise<NodeContent[]> {
    if (typeof code !== 'string' || !code.trim() || Buffer.byteLength(code) > 65536) return Promise.reject(new Error('Provide 1–65536 bytes of JavaScript.'));
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 60000) return Promise.reject(new Error('timeout_ms must be an integer from 1 to 60000.'));
    const generation = this.generation;
    const next = this.queue.then(async () => {
      await this.stopping;
      signal?.throwIfAborted();
      if (this.closed || generation !== this.generation) throw new Error('JavaScript kernel reset before queued code ran; code was not executed.');
      return new Promise<NodeContent[]>((resolve, reject) => {
        const timer = setTimeout(() => this.reset('JavaScript timed out; kernel discarded. Prior external effects may remain; code was not retried.'), timeout);
        const abort = () => this.reset('JavaScript cancelled; kernel discarded. Prior external effects may remain; code was not retried.');
        const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); this.pending = undefined; };
        this.pending = { resolve: value => { finish(); resolve(value); }, reject: error => { finish(); reject(error); } };
        signal?.addEventListener('abort', abort, { once: true });
        if (!this.child) {
          const child = fork(fileURLToPath(new URL('kernel.ts', import.meta.url)), [], {
            cwd: this.cwd, execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
          });
          this.child = child;
          child.on('message', (message: { ready?: boolean; content?: NodeContent[]; error?: string; overflow?: boolean }) => {
            if (child !== this.child) return;
            if (message.ready) { child.send({ code }); return; }
            if (message.overflow) { this.reset('JavaScript output limit exceeded; kernel discarded. Prior external effects may remain.'); return; }
            if (message.error) this.pending?.reject(new Error(message.error));
            else this.pending?.resolve(message.content ?? []);
          });
          const failure = () => { if (this.child === child) this.reset('JavaScript process exited; kernel discarded. Prior external effects may remain.'); };
          child.once('error', failure); child.once('exit', failure);
        } else this.child.send({ code });
      });
    });
    this.queue = next.catch(() => {});
    return next;
  }
}
