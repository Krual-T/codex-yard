import { basename, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { record } from './protocol.ts';
import type { ProcessSpawnParams, TerminalConnection, TerminalCreate, TerminalEvent, TerminalOperation, TerminalSnapshot } from './terminal-protocol.ts';

function dimension(value: unknown, fallback: number) {
  if (value == null) return fallback;
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 1000) throw new Error('无效的终端尺寸');
  return Number(value);
}
interface Session extends TerminalSnapshot {
  id: string;
  hostId: string;
  conversationId?: string;
  processHandle: string;
  connection?: TerminalConnection;
  opening: Promise<void>;
  closing?: Promise<void>;
  closed: boolean;
  ended: boolean;
  attached: boolean;
  spawned: boolean;
  shellPid?: number;
  cols: number;
  rows: number;
  prefix: string;
  decoders: { stdout: StringDecoder; stderr: StringDecoder };
  shellReady: Promise<void>;
  ready(): void;
  exited: Promise<void>;
  didExit(): void;
}
interface Options {
  workspace: string;
  connectionFor(hostId: string): Promise<TerminalConnection>;
  send(event: TerminalEvent): void;
}

/** Adapt the original terminal RPC to connection-owned official processes. */
export class TerminalHost {
  private readonly sessions = new Map<string, Session>();
  private readonly bindings = new Map<TerminalConnection, () => void>();
  private disposed = false;
  private readonly options: Options;
  constructor(options: Options) { this.options = options; }

  async request(operation: TerminalOperation, args: unknown[]) {
    if (!Array.isArray(args)) throw new Error('需要终端参数');
    switch (operation) {
      case 'create': return this.create(args[0] as TerminalCreate);
      case 'attach': return this.attach(args[0] as TerminalCreate);
      case 'attachExisting': return this.attach(args[0] as TerminalCreate, true);
      case 'close': return this.close(String(args[0]));
      case 'write': {
        const session = this.session(args[0]);
        if (typeof args[1] !== 'string' || args[1].length > 1024 * 1024) throw new Error('无效的终端输入');
        await session.opening;
        this.active(session);
        await session.connection!.request('process/writeStdin', { processHandle: session.processHandle,
          deltaBase64: Buffer.from(args[1], 'utf8').toString('base64') }, { mutating: true });
        return;
      }
      case 'resize': {
        const session = this.session(args[0]);
        const cols = dimension(args[1], 80), rows = dimension(args[2], 24);
        await session.opening;
        this.active(session);
        // The original renderer requests a redraw even when dimensions match.
        if (args[3] === true && session.cols === cols && session.rows === rows) {
          await this.resize(session, cols === 1 ? 2 : cols - 1, rows);
        }
        await this.resize(session, cols, rows);
        return;
      }
      // This converts a selected path to shell syntax, rather than querying cwd.
      case 'getShellCwd': this.session(args[0]); return typeof args[1] === 'string' ? args[1] : null;
      case 'getThreadSnapshot': {
        const session = [...this.sessions.values()].reverse().find(session => !session.closed && session.conversationId === args[0]);
        return session ? { cwd: session.cwd, shell: session.shell, buffer: session.buffer, truncated: session.truncated } : null;
      }
      default: throw new Error('未接入的终端操作：' + String(operation));
    }
  }

  private active(session: Session) {
    if (session.closed || !session.connection?.connected) throw new Error('终端已关闭，请重新打开；输入不会重发');
  }
  private session(id: unknown) {
    const session = this.sessions.get(String(id));
    if (!session || session.closed) throw new Error('终端已关闭，请重新打开');
    return session;
  }
  private async resize(session: Session, cols: number, rows: number) {
    this.active(session);
    await session.connection!.request('process/resizePty', { processHandle: session.processHandle, size: { rows, cols } }, { mutating: true });
    session.cols = cols;
    session.rows = rows;
  }

  private async create(request: TerminalCreate) {
    if (this.disposed) throw new Error('终端连接已关闭');
    if (!request || typeof request.sessionId !== 'string' || !request.sessionId || request.sessionId.length > 256) throw new Error('需要终端 sessionId');
    if (request.environmentId != null) throw new Error('当前终端支持本机与已登记 SSH 项目');
    const hostId = request.hostId ?? 'local';
    const cwd = request.cwd ?? (hostId === 'local' ? this.options.workspace : null);
    if (typeof cwd !== 'string' || !isAbsolute(cwd) || cwd.includes('\0')) throw new Error('终端需要所选主机上的绝对目录');
    const cols = dimension(request.cols, 80), rows = dimension(request.rows, 24);
    const existing = this.sessions.get(request.sessionId);
    if (existing) {
      if (existing.closed) throw new Error('终端正在关闭，请重新打开');
      if (existing.hostId !== hostId || existing.cwd !== cwd || existing.conversationId !== request.conversationId) throw new Error('终端目标已变化，请新建终端');
      await existing.opening;
      this.replay(existing);
      return;
    }
    let ready!: () => void, didExit!: () => void;
    const shellReady = new Promise<void>(resolve => { ready = resolve; });
    const exited = new Promise<void>(resolve => { didExit = resolve; });
    const session: Session = { id: request.sessionId, hostId, cwd, conversationId: request.conversationId, shell: '', buffer: '', truncated: false,
      processHandle: 'workbench-terminal-' + randomUUID(), closed: false, ended: false, attached: false, spawned: false, cols, rows,
      prefix: '', decoders: { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') },
      opening: Promise.resolve(), shellReady, ready, exited, didExit };
    this.sessions.set(session.id, session);
    session.opening = this.start(session);
    try { await session.opening; }
    catch (error) {
      // A timed-out spawn may still have started. Kill its handle on the same
      // connection; never retry a spawn or input on a replacement connection.
      if (this.sessions.get(session.id) === session) await this.close(session.id).catch(() => {});
      const detail = record(error);
      if (detail.code === -32601 || /unknown variant [`'"]process\/spawn/.test(String(detail.message))) {
        throw new Error(`主机 ${hostId} 的 Codex daemon 不支持 process/spawn；请更新该主机 Codex 后重试。`, { cause: error });
      }
      throw error;
    }
  }

  private async start(session: Session) {
    const connection = await this.options.connectionFor(session.hostId);
    if (session.closed) return;
    if (!connection.connected) throw new Error('终端主机连接已断开');
    session.connection = connection;
    this.bind(connection);
    // exec preserves this PID. It is used only while this connection's handle
    // is active, to preserve node-pty's normal SIGHUP close semantics.
    const params: ProcessSpawnParams = {
      processHandle: session.processHandle, cwd: session.cwd,
      command: ['/bin/sh', '-c', `printf '\\036%s\\037%s\\037%s\\037' '${session.processHandle}' "\${SHELL:-/bin/sh}" "$$"; exec "\${SHELL:-/bin/sh}" -i`],
      tty: true, size: { rows: session.rows, cols: session.cols }, timeoutMs: null, outputBytesCap: null,
      env: { TERM: 'xterm-256color', COLORTERM: 'truecolor' },
    };
    session.spawned = true;
    try { await connection.request('process/spawn', params, { mutating: true }); }
    catch (error) {
      if (record(error).uncertain !== true) session.spawned = false;
      throw error;
    }
    if (session.closed) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([session.shellReady, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('终端 shell 启动超时')), 10000);
      })]);
    } finally { clearTimeout(timer); }
    if (!session.closed) { session.attached = true; this.replay(session); }
  }

  private bind(connection: TerminalConnection) {
    if (this.bindings.has(connection)) return;
    const message = (value: unknown) => {
      const envelope = record(value), params = record(envelope.params);
      if (envelope.id != null || !['process/outputDelta', 'process/exited'].includes(String(envelope.method))) return;
      const session = [...this.sessions.values()].find(session => session.connection === connection && session.processHandle === params.processHandle);
      if (!session || session.ended) return;
      if (envelope.method === 'process/exited') {
        for (const decoder of Object.values(session.decoders)) this.output(session, decoder.end());
        this.end(session, typeof params.exitCode === 'number' ? params.exitCode : null);
      } else if ((!session.closed || !session.shell) && (params.stream === 'stdout' || params.stream === 'stderr') && typeof params.deltaBase64 === 'string') {
        this.output(session, session.decoders[params.stream].write(Buffer.from(params.deltaBase64, 'base64')));
      }
    };
    const status = () => {
      if (connection.connected) return;
      for (const session of this.sessions.values()) if (session.connection === connection) {
        this.end(session, null, '主机连接已断开，终端已关闭；后台作业可能仍在运行。请重新打开终端；输入不会重发。');
      }
    };
    connection.on('message', message);
    connection.on('status', status);
    this.bindings.set(connection, () => { connection.off('message', message); connection.off('status', status); });
  }

  private output(session: Session, data: string) {
    if (!data) return;
    if (!session.shell) {
      session.prefix += data;
      const marker = '\x1e' + session.processHandle + '\x1f';
      const begin = session.prefix.indexOf(marker);
      const end = begin < 0 ? -1 : session.prefix.indexOf('\x1f', begin + marker.length);
      const pidEnd = end < 0 ? -1 : session.prefix.indexOf('\x1f', end + 1);
      if (pidEnd < 0) return;
      const pid = session.prefix.slice(end + 1, pidEnd);
      if (!/^[1-9]\d*$/.test(pid) || !Number.isSafeInteger(Number(pid)) || Number(pid) <= 1) return;
      session.shellPid = Number(pid);
      session.shell = basename(session.prefix.slice(begin + marker.length, end));
      data = session.prefix.slice(0, begin) + session.prefix.slice(pidEnd + 1);
      session.prefix = '';
      session.ready();
    }
    session.truncated ||= session.buffer.length + data.length > 16000;
    session.buffer = (session.buffer + data).slice(-16000);
    if (data && session.attached && !session.closed) this.options.send({ type: 'data', sessionId: session.id, data });
  }

  private replay(session: Session) {
    if (session.closed) return;
    this.options.send({ type: 'init-log', sessionId: session.id, log: session.buffer });
    this.options.send({ type: 'attached', sessionId: session.id, cwd: session.cwd, shell: session.shell });
  }
  private end(session: Session, code: number | null, error?: string) {
    if (session.ended) return;
    session.closed = session.ended = true;
    session.ready();
    session.didExit();
    if (this.sessions.get(session.id) === session) this.sessions.delete(session.id);
    this.options.send({ type: 'exit', sessionId: session.id, code, signal: null, ...(error ? { error } : {}) });
  }

  private async attach(request: TerminalCreate, existingOnly = false) {
    if (!request || typeof request.sessionId !== 'string') throw new Error('需要终端 sessionId');
    const session = this.sessions.get(request.sessionId);
    if (!session || session.closed) { if (existingOnly) return false; await this.create(request); return; }
    if (session.hostId !== (request.hostId ?? 'local') || session.conversationId !== request.conversationId || request.cwd != null && session.cwd !== request.cwd) {
      if (existingOnly) return false;
      throw new Error('终端目标已变化，请新建终端');
    }
    await session.opening;
    if (session.closed) return existingOnly ? false : undefined;
    this.replay(session);
    return existingOnly ? true : undefined;
  }

  private async hangup(session: Session) {
    const connection = session.connection!;
    if (session.ended || !connection.connected || !session.shellPid) return;
    const processHandle = 'workbench-terminal-hangup-' + randomUUID();
    let didExit!: (code: number | null) => void, ended = false;
    const exited = new Promise<number | null>(resolve => { didExit = resolve; });
    const message = (value: unknown) => {
      const envelope = record(value), params = record(envelope.params);
      if (envelope.id == null && envelope.method === 'process/exited' && params.processHandle === processHandle) {
        ended = true;
        didExit(typeof params.exitCode === 'number' ? params.exitCode : null);
      }
    };
    const status = () => { if (!connection.connected) didExit(null); };
    connection.on('message', message);
    connection.on('status', status);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // process/kill has no signal option and kills the shell before it can
      // notify jobs. Signal only this still-active shell, via the same daemon.
      await connection.request('process/spawn', { processHandle,
        command: ['/bin/kill', '-HUP', '--', String(session.shellPid)], cwd: '/', timeoutMs: 1000, outputBytesCap: 1024,
      }, { mutating: true, timeoutMs: 5000 });
      const code = await Promise.race([exited, new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 2000); })]);
      if (code !== 0 && !session.ended) throw new Error('shell SIGHUP 未确认，后台作业可能仍存活');
    } finally {
      clearTimeout(timer);
      if (!ended && connection.connected) await connection.request('process/kill', { processHandle }, { mutating: true, timeoutMs: 1000 }).catch(() => {});
      connection.off('message', message);
      connection.off('status', status);
    }
  }

  async close(id: string) {
    const session = this.sessions.get(id);
    if (!session) return;
    if (session.closing) return session.closing;
    session.closed = true;
    session.ready();
    session.closing = (async () => {
      // Wait for an in-flight spawn before killing its connection-scoped handle.
      await session.opening.catch(() => {});
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        if (session.spawned && !session.ended && session.connection?.connected) {
          if (session.shellPid) {
            try {
              await this.hangup(session);
              // Let the interactive shell propagate HUP to its jobs before
              // falling back to the daemon's unconditional process/kill.
              if (!session.ended) await Promise.race([session.exited, new Promise<void>(resolve => { timer = setTimeout(resolve, 1000); })]);
            } catch (error) {
              this.options.send({ type: 'error', sessionId: session.id, message: '终端关闭：' + (error as Error).message });
            } finally { clearTimeout(timer); }
          }
          if (!session.ended && session.connection.connected) {
            await session.connection.request('process/kill', { processHandle: session.processHandle }, { mutating: true, timeoutMs: 5000 });
            await Promise.race([session.exited, new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error('尚未收到终端退出通知')), 5000);
            })]);
          }
        }
        this.end(session, null);
      } catch (error) {
        if (!session.ended) {
          // Keep the handle until a real exit or disconnect. A failed kill must
          // not make an unconfirmed process invisible to page cleanup.
          this.options.send({ type: 'error', sessionId: session.id, message: '终端关闭结果待确认：' + (error as Error).message });
          throw error;
        }
      } finally { clearTimeout(timer); session.closing = undefined; }
    })();
    return session.closing;
  }

  async closeHost(hostId: string) {
    const results = await Promise.allSettled([...this.sessions.values()].filter(session => session.hostId === hostId).map(session => this.close(session.id)));
    const failed = results.find(result => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
  }
  async dispose() {
    this.disposed = true;
    await Promise.allSettled([...this.sessions.keys()].map(id => this.close(id)));
    for (const unsubscribe of this.bindings.values()) unsubscribe();
    this.bindings.clear();
  }
}
