import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { createConnection, createServer, isIP } from 'node:net';
import type { Server, Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { record } from './protocol.ts';
import { sshArguments } from './ssh.ts';
import type { SshHost } from './ssh.ts';

export interface PortForwardRule {
  id: string;
  name: string;
  sourceHostId: string;
  targetHostId: string;
  serviceHost: string;
  servicePort: number;
  localPort: number;
}
export type PortForwardStatus = 'stopped' | 'starting' | 'running' | 'error';
export interface PortForwardSnapshot {
  hosts: { hostId: string; displayName: string }[];
  rules: (PortForwardRule & { status: PortForwardStatus; error?: string })[];
}
interface Options {
  hosts: Map<string, SshHost>;
  rules?: unknown;
  save(rules: PortForwardRule[]): Promise<void>;
  sshBin?: string;
}
interface Run {
  server?: Server;
  directory?: string;
  source?: SshHost;
  sourceSocket?: string;
  children: Set<ChildProcessWithoutNullStreams>;
  sockets: Set<Socket>;
  error?: string;
  closing?: Promise<void>;
}
const execute = promisify(execFile);
const address = (host: string, port: number) => `${host.includes(':') ? `[${host}]` : host}:${port}`;
function argumentsFor(host: SshHost, extra: string[]) {
  const args = sshArguments(host);
  args.splice(args.length - 2, 0, ...extra);
  return args;
}
function ruleFrom(value: unknown): PortForwardRule {
  const item = record(value);
  if (typeof item.id !== 'string' || !/^[\w-]{1,80}$/.test(item.id)) throw new Error('无效的转发规则 ID');
  if (typeof item.sourceHostId !== 'string' || typeof item.targetHostId !== 'string') throw new Error('请选择来源设备和接收设备');
  const host = typeof item.serviceHost === 'string' ? item.serviceHost.trim().replace(/^\[([^\]]+)\]$/, '$1') : '';
  if (!isIP(host) && !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,252}$/.test(host)) throw new Error('服务地址需要主机名或 IP 地址');
  for (const key of ['servicePort', 'localPort'] as const) {
    if (typeof item[key] !== 'number' || !Number.isInteger(item[key]) || item[key] < 1 || item[key] > 65535) throw new Error('端口需要是 1 到 65535 的整数');
  }
  const name = typeof item.name === 'string' ? item.name.trim() : '';
  if (name.length > 120) throw new Error('名称最多 120 个字符');
  if (item.sourceHostId === item.targetHostId && item.servicePort === item.localPort && ['127.0.0.1', '::1', 'localhost'].includes(host)) {
    throw new Error('来源和接收设备相同时，请使用不同的端口');
  }
  return { id: item.id, name: name || address(host, item.servicePort as number), sourceHostId: item.sourceHostId,
    targetHostId: item.targetHostId, serviceHost: host, servicePort: item.servicePort as number, localPort: item.localPort as number };
}

/** Owned by the Yard service, independently of browser and Codex connections.
 * Remote listeners are created by OpenSSH -R on the selected receiving device.
 * A loopback relay carries source channels through the source's SSH master. */
export class PortForwarding {
  private readonly options: Options;
  private rules = new Map<string, PortForwardRule>();
  private readonly states = new Map<string, { status: PortForwardStatus; error?: string }>();
  private readonly runs = new Map<string, Run>();
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  constructor(options: Options) {
    this.options = options;
    for (const value of Array.isArray(options.rules) ? options.rules : []) {
      const rule = ruleFrom(value);
      this.rules.set(rule.id, rule);
    }
  }
  snapshot(): PortForwardSnapshot {
    return { hosts: [{ hostId: 'local', displayName: 'Yard 运行主机' }, ...[...this.options.hosts.values()]
      .map(host => ({ hostId: host.hostId, displayName: host.displayName }))],
    rules: [...this.rules.values()].map(rule => ({ ...rule, ...this.states.get(rule.id) ?? { status: 'stopped' as const } })) };
  }
  async request(value: unknown): Promise<PortForwardSnapshot> {
    const params = record(value);
    if (params.operation === 'list') return this.snapshot();
    const next = this.queue.catch(() => {}).then(async () => {
      if (this.closed) throw new Error('端口转发服务已关闭');
      if (params.operation === 'save') {
        const rule = ruleFrom(params.rule);
        this.host(rule.sourceHostId); this.host(rule.targetHostId);
        if (this.runs.has(rule.id)) throw new Error('请先停止转发，再修改规则');
        const updated = new Map(this.rules); updated.set(rule.id, rule);
        await this.options.save([...updated.values()]); this.rules = updated;
        this.states.set(rule.id, { status: 'stopped' });
      } else {
        let rule = this.rules.get(String(params.id));
        if (!rule) throw new Error('转发规则不存在，请刷新列表');
        if (params.targetHostId != null) {
          if (typeof params.targetHostId !== 'string' || !params.targetHostId) throw new Error('请先关联当前设备');
          this.host(params.targetHostId);
          if (params.operation === 'start') {
            const source = rule;
            const current = source.targetHostId === params.targetHostId ? source : [...this.rules.values()].find(candidate =>
              candidate.targetHostId === params.targetHostId && candidate.sourceHostId === source.sourceHostId
              && candidate.serviceHost === source.serviceHost && candidate.servicePort === source.servicePort);
            if (current) rule = current;
            else {
              rule = ruleFrom({ ...source, id: randomUUID(), targetHostId: params.targetHostId });
              this.host(rule.sourceHostId);
              const updated = new Map(this.rules); updated.set(rule.id, rule);
              await this.options.save([...updated.values()]); this.rules = updated;
              this.states.set(rule.id, { status: 'stopped' });
            }
          } else if (rule.targetHostId !== params.targetHostId) throw new Error('这个转发属于其他设备，请重新打开面板');
        }
        if (params.operation === 'start') await this.start(rule);
        else if (params.operation === 'stop') await this.stop(rule.id);
        else if (params.operation === 'remove') {
          await this.stop(rule.id);
          const updated = new Map(this.rules); updated.delete(rule.id);
          await this.options.save([...updated.values()]); this.rules = updated; this.states.delete(rule.id);
        } else throw new Error('未知的端口转发操作');
      }
      return this.snapshot();
    });
    this.queue = next;
    return next;
  }
  private host(id: string) {
    if (id === 'local') return undefined;
    const host = this.options.hosts.get(id);
    if (!host) throw new Error('SSH 设备已移除，请在设置 → 连接中检查设备');
    return { ...host };
  }
  private spawn(host: SshHost, extra: string[], run: Run) {
    const child = spawn(this.options.sshBin ?? 'ssh', argumentsFor(host, extra), { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    run.children.add(child);
    child.once('close', () => run.children.delete(child));
    return child;
  }
  private async master(id: string, host: SshHost, socket: string, run: Run) {
    const child = this.spawn(host, ['-N', '-M', '-S', socket, '-o', 'ControlPersist=no', '-o', 'ExitOnForwardFailure=yes',
      '-o', 'ForwardAgent=no', '-o', 'ForwardX11=no'], run);
    let stderr = '';
    child.stdout.resume();
    child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-4096); });
    const fail = (message: string) => {
      if (run.closing) return;
      run.error = message;
      this.states.set(id, { status: 'error', error: message });
      void this.release(run).then(() => { if (this.runs.get(id) === run) this.runs.delete(id); });
    };
    child.once('error', error => fail('无法启动 SSH：' + error.message));
    child.once('exit', code => fail(`SSH 连接已结束${code == null ? '' : ` (${code})`}：${stderr.trim() || host.displayName}`));
    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline) {
      if (run.error || run.closing || this.closed) throw new Error(run.error || '端口转发已停止');
      try {
        await access(socket);
        await execute(this.options.sshBin ?? 'ssh', argumentsFor(host, ['-S', socket, '-O', 'check']), { timeout: 1500 });
        if (run.error || run.closing || this.closed) throw new Error(run.error || '端口转发已停止');
        return;
      } catch { /* The control socket appears only after SSH authentication. */ }
      await delay(50);
    }
    throw new Error('SSH 连接超时：' + (stderr.trim() || host.displayName));
  }
  private connect(rule: PortForwardRule, run: Run, incoming: Socket) {
    run.sockets.add(incoming);
    incoming.once('close', () => run.sockets.delete(incoming));
    const report = (message: string) => {
      if (!run.closing) this.states.set(rule.id, { status: 'running', error: message });
    };
    const healthy = () => { if (!run.closing) this.states.set(rule.id, { status: 'running' }); };
    if (!run.source) {
      const outgoing = createConnection({ host: rule.serviceHost, port: rule.servicePort });
      run.sockets.add(outgoing);
      outgoing.setTimeout(10_000, () => outgoing.destroy(new Error('连接来源服务超时')));
      outgoing.once('connect', () => { outgoing.setTimeout(0); healthy(); });
      outgoing.once('close', () => { run.sockets.delete(outgoing); incoming.destroy(); });
      outgoing.once('error', error => { report(error.message); incoming.destroy(); });
      incoming.once('error', () => outgoing.destroy());
      incoming.once('close', () => outgoing.destroy());
      incoming.pipe(outgoing).pipe(incoming);
    } else {
      const channel = this.spawn(run.source, ['-S', run.sourceSocket!, '-W', address(rule.serviceHost, rule.servicePort)], run);
      let stderr = '';
      channel.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-4096); });
      channel.stdout.once('data', healthy);
      channel.once('error', error => { report(error.message); incoming.destroy(); });
      channel.once('close', code => { if (code) report(stderr.trim() || '来源服务连接已断开'); incoming.destroy(); });
      channel.stdin.on('error', () => incoming.destroy());
      incoming.once('error', () => channel.kill());
      incoming.once('close', () => channel.kill());
      incoming.pipe(channel.stdin); channel.stdout.pipe(incoming);
    }
  }
  private async start(rule: PortForwardRule) {
    if (this.runs.has(rule.id)) return;
    const source = this.host(rule.sourceHostId), target = this.host(rule.targetHostId);
    for (const [id] of this.runs) {
      const other = this.rules.get(id)!;
      if (other.targetHostId === rule.targetHostId && other.localPort === rule.localPort) throw new Error('接收设备的这个端口已有转发，请选择其他端口');
    }
    const run: Run = { source, children: new Set(), sockets: new Set() };
    this.runs.set(rule.id, run); this.states.set(rule.id, { status: 'starting' });
    try {
      if (source || target) run.directory = await mkdtemp(join(tmpdir(), 'yard-forward-'));
      if (source) {
        run.sourceSocket = join(run.directory!, 'source');
        await this.master(rule.id, source, run.sourceSocket, run);
      }
      const server = run.server = createServer(socket => this.connect(rule, run, socket));
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(target ? 0 : rule.localPort, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
      });
      server.on('error', error => {
        if (!run.closing) {
          this.states.set(rule.id, { status: 'error', error: error.message });
          void this.release(run).then(() => { if (this.runs.get(rule.id) === run) this.runs.delete(rule.id); });
        }
      });
      if (target) {
        const relayPort = (server.address() as import('node:net').AddressInfo).port;
        const socket = join(run.directory!, 'target');
        await this.master(rule.id, target, socket, run);
        // A master's control socket can be ready before startup -R replies.
        // The multiplex forward command waits for the receiver's bind result.
        try {
          await execute(this.options.sshBin ?? 'ssh', argumentsFor(target,
            ['-S', socket, '-O', 'forward', '-R', `127.0.0.1:${rule.localPort}:127.0.0.1:${relayPort}`]), { timeout: 10_000 });
        } catch (error) {
          const failure = error as Error & { stderr?: string };
          throw new Error('接收设备端口转发失败：' + (failure.stderr?.trim() || failure.message));
        }
      }
      if (this.closed || run.closing || run.error) throw new Error(run.error || '端口转发已停止');
      this.states.set(rule.id, { status: 'running' });
    } catch (error) {
      await this.release(run);
      if (this.runs.get(rule.id) === run) this.runs.delete(rule.id);
      const message = run.error || (error as Error).message;
      this.states.set(rule.id, { status: 'error', error: message });
      throw new Error(message);
    }
  }
  private release(run: Run) {
    return run.closing ??= (async () => {
      for (const socket of run.sockets) socket.destroy();
      const stopped = [...run.children].map(child => new Promise<void>(resolve => {
        if (child.exitCode != null || child.signalCode != null) { resolve(); return; }
        const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 2000);
        child.once('close', () => { clearTimeout(timer); resolve(); });
        child.kill();
      }));
      if (run.server) await new Promise<void>(resolve => run.server!.close(() => resolve()));
      await Promise.all(stopped);
      if (run.directory) await rm(run.directory, { recursive: true, force: true });
    })();
  }
  private async stop(id: string) {
    const run = this.runs.get(id);
    if (run) { await this.release(run); if (this.runs.get(id) === run) this.runs.delete(id); }
    this.states.set(id, { status: 'stopped' });
  }
  async hostsChanged(ids: string[]) {
    const next = this.queue.catch(() => {}).then(async () => {
      for (const rule of this.rules.values()) if (ids.includes(rule.sourceHostId) || ids.includes(rule.targetHostId)) {
        await this.stop(rule.id);
        this.states.set(rule.id, { status: 'error', error: 'SSH 设备配置已变更，请核对设备后重新启动转发' });
      }
    });
    this.queue = next; await next;
  }
  async close() {
    this.closed = true;
    await this.queue.catch(() => {});
    await Promise.all([...this.runs.values()].map(run => this.release(run)));
    this.runs.clear();
  }
}
