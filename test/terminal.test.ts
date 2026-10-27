import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { TerminalHost } from '../src/native/terminal.ts';
import type { TerminalConnection, TerminalEvent } from '../src/native/terminal-protocol.ts';
import { BrowserTerminal, terminalRpcService } from '../src/native/browser-terminal.ts';

class ProcessConnection extends EventEmitter implements TerminalConnection {
  connected = true;
  shells = new Map<number, string>();
  calls: { method: string; params: Record<string, unknown>; mutating?: boolean }[] = [];
  intercept?: (method: string, params: Record<string, unknown>) => Promise<unknown> | undefined;
  async request(method: string, params: Record<string, unknown>, options?: { mutating?: boolean }) {
    this.calls.push({ method, params, mutating: options?.mutating });
    const intercepted = this.intercept?.(method, params);
    if (intercepted) return intercepted;
    if (method === 'process/spawn') {
      if (!params.tty) {
        const pid = Number((params.command as string[])[3]);
        const handle = this.shells.get(pid);
        if (handle) this.exit(handle, 1);
        this.exit(String(params.processHandle), handle ? 0 : 1);
        return {};
      }
      const pid = 100 + this.shells.size;
      this.shells.set(pid, String(params.processHandle));
      // Both a split shell header and output can precede the spawn response.
      this.output(String(params.processHandle), '\x1e' + params.processHandle);
      this.output(String(params.processHandle), '\x1f/bin/bash\x1f' + pid + '\x1fearly\r\n');
    } else if (method === 'process/kill') this.exit(String(params.processHandle), 137);
    return {};
  }
  output(processHandle: string, data: string | Buffer, stream = 'stdout') {
    this.emit('message', { method: 'process/outputDelta', params: { processHandle, stream, deltaBase64: Buffer.from(data).toString('base64'), capReached: false } });
  }
  exit(processHandle: string, exitCode: number) {
    this.emit('message', { method: 'process/exited', params: { processHandle, exitCode, stdout: '', stderr: '', stdoutCapReached: false, stderrCapReached: false } });
  }
  disconnect() { this.connected = false; this.emit('status'); }
  handle() { return String(this.calls.filter(call => call.method === 'process/spawn' && call.params.tty).at(-1)!.params.processHandle); }
}

function fixture(t: import('node:test').TestContext) {
  const local = new ProcessConnection(), remote = new ProcessConnection(), events: TerminalEvent[] = [];
  const connections = new Map([['local', local], ['ssh', remote]]);
  const host = new TerminalHost({ workspace: '/workspace', connectionFor: async hostId => {
    const connection = connections.get(hostId);
    if (!connection) throw new Error('未登记的执行主机：' + hostId);
    return connection;
  }, send: event => events.push(event) });
  t.after(() => host.dispose());
  const output = () => events.filter(event => event.type === 'data').map(event => event.data).join('');
  return { host, local, remote, connections, events, output };
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

test('official process RPC preserves early output, UTF-8, stdin bytes, PTY dimensions and exit codes', async t => {
  const h = fixture(t);
  await h.host.request('create', [{ sessionId: 'shell', conversationId: 'thread', cwd: '/remote/path', hostId: 'ssh' }]);
  assert.equal(h.local.calls.length, 0);
  const spawn = h.remote.calls[0]!;
  assert.equal(spawn.method, 'process/spawn');
  assert.equal(spawn.params.cwd, '/remote/path');
  assert.equal(spawn.params.tty, true);
  assert.equal(spawn.params.timeoutMs, null);
  assert.equal(spawn.params.outputBytesCap, null);
  assert.deepEqual(spawn.params.size, { rows: 24, cols: 80 });
  assert.ok(h.events.some(event => event.type === 'init-log' && event.log === 'early\r\n'));
  assert.ok(h.events.some(event => event.type === 'attached' && event.shell === 'bash'));
  const bytes = Buffer.from('中🙂\r\n');
  h.remote.output(h.remote.handle(), bytes.subarray(0, 1));
  h.remote.output(h.remote.handle(), bytes.subarray(1, 4));
  h.remote.output(h.remote.handle(), bytes.subarray(4));
  h.remote.output(h.remote.handle(), 'stderr', 'stderr');
  assert.equal(h.output(), '中🙂\r\nstderr');
  await h.host.request('write', ['shell', '中文\x03']);
  assert.deepEqual(h.remote.calls.at(-1)?.params, { processHandle: h.remote.handle(), deltaBase64: Buffer.from('中文\x03').toString('base64') });
  await h.host.request('resize', ['shell', 80, 24, true]);
  assert.deepEqual(h.remote.calls.slice(-2).map(call => call.params.size), [{ rows: 24, cols: 79 }, { rows: 24, cols: 80 }]);
  assert.ok(h.remote.calls.every(call => call.mutating === true));
  h.remote.exit(h.remote.handle(), 7);
  assert.deepEqual(h.events.at(-1), { type: 'exit', sessionId: 'shell', code: 7, signal: null });
  await assert.rejects(h.host.request('write', ['shell', 'late']), /已关闭/);
});

test('page, host and process generation isolate notification ownership and reconnect never replays input', async t => {
  const a = fixture(t), b = fixture(t);
  const request = { sessionId: 'same', conversationId: 'thread', cwd: '/workspace' };
  await Promise.all([a.host.request('create', [request]), b.host.request('create', [request]),
    a.host.request('create', [{ ...request, sessionId: 'remote', hostId: 'ssh' }])]);
  const firstHandle = a.local.handle();
  a.remote.output(firstHandle, 'WRONG_HOST');
  b.local.output(firstHandle, 'WRONG_PAGE');
  assert.equal(a.output(), ''); assert.equal(b.output(), '');
  a.local.disconnect();
  assert.equal(a.events.filter(event => event.type === 'exit').length, 1);
  a.remote.output(a.remote.handle(), 'remote survives');
  b.local.output(b.local.handle(), 'other page survives');
  assert.equal(a.output(), 'remote survives'); assert.equal(b.output(), 'other page survives');
  await assert.rejects(a.host.request('write', ['same', 'must not replay']), /已关闭/);
  a.local.connected = true;
  await a.host.request('create', [request]);
  assert.notEqual(a.local.handle(), firstHandle);
  a.local.output(firstHandle, 'STALE'); a.local.exit(firstHandle, 9);
  assert.equal(a.events.filter(event => event.type === 'exit').length, 1);
  assert.equal(a.output(), 'remote survives');
  assert.equal(a.local.calls.filter(call => call.method === 'process/writeStdin').length, 0);
  await a.host.closeHost('ssh');
  assert.deepEqual(a.remote.calls.at(-1)?.params.command, ['/bin/kill', '-HUP', '--', '100']);
  assert.equal(a.local.calls.at(-1)?.method, 'process/spawn');
  await a.host.dispose();
  assert.equal(a.local.listenerCount('message'), 0);
  assert.equal(a.remote.listenerCount('status'), 0);
  await b.host.request('write', ['same', 'still alive']);
});

test('reattach does not spawn; targets and invalid dimensions are checked before process calls', async t => {
  const h = fixture(t), request = { sessionId: 'same', cwd: '/workspace', conversationId: 'thread' };
  await h.host.request('create', [request]);
  await h.host.request('create', [request]); await h.host.request('attach', [request]);
  assert.equal(await h.host.request('attachExisting', [request]), true);
  assert.equal(h.local.calls.length, 1);
  assert.deepEqual(await h.host.request('getThreadSnapshot', ['thread']), { cwd: '/workspace', shell: 'bash', buffer: 'early\r\n', truncated: false });
  await assert.rejects(h.host.request('create', [{ ...request, hostId: 'ssh' }]), /目标已变化/);
  await assert.rejects(h.host.request('attach', [{ ...request, cwd: '/different' }]), /目标已变化/);
  assert.equal(await h.host.request('attachExisting', [{ ...request, cwd: '/different' }]), false);
  await assert.rejects(h.host.request('create', [{ sessionId: 'unknown', cwd: '/tmp', hostId: 'unknown' }]), /未登记/);
  await assert.rejects(h.host.request('create', [{ sessionId: 'relative', cwd: '../tmp' }]), /绝对目录/);
  await assert.rejects(h.host.request('resize', ['same', 0, 80]), /尺寸/);
  assert.equal(h.local.calls.length, 1);
});

test('closing while connection or spawn is pending cannot attach late or leak a handle', async t => {
  const h = fixture(t), started = deferred(), release = deferred();
  h.local.intercept = method => method === 'process/spawn' ? (async () => { started.resolve(); await release.promise; return {}; })() : undefined;
  const creating = h.host.request('create', [{ sessionId: 'pending' }]);
  await started.promise;
  const closing = h.host.close('pending');
  release.resolve();
  await Promise.all([creating, closing]);
  assert.deepEqual(h.local.calls.map(call => call.method), ['process/spawn', 'process/kill']);
  assert.equal(h.events.some(event => event.type === 'attached'), false);
  const connect = deferred(), events: TerminalEvent[] = [], connection = new ProcessConnection();
  const host = new TerminalHost({ workspace: '/workspace', connectionFor: async () => { await connect.promise; return connection; }, send: event => events.push(event) });
  const opening = host.request('create', [{ sessionId: 'connecting' }]);
  const disposed = host.dispose();
  connect.resolve();
  await Promise.all([opening, disposed]);
  assert.equal(connection.calls.length, 0);
  assert.equal(events.some(event => event.type === 'attached'), false);
});

test('an uncertain spawn is killed on its original connection; unsupported daemons never fall back', async t => {
  const h = fixture(t);
  h.local.intercept = method => method === 'process/spawn' ? Promise.reject(Object.assign(new Error('timeout'), { uncertain: true })) : undefined;
  await assert.rejects(h.host.request('create', [{ sessionId: 'uncertain' }]), /timeout/);
  assert.deepEqual(h.local.calls.map(call => call.method), ['process/spawn', 'process/kill']);
  h.remote.intercept = method => method === 'process/spawn' ? Promise.reject(Object.assign(new Error('Method not found'), { code: -32601 })) : undefined;
  await assert.rejects(h.host.request('create', [{ sessionId: 'unsupported', hostId: 'ssh', cwd: '/tmp' }]), /主机 ssh.*不支持 process\/spawn/);
  assert.deepEqual(h.remote.calls.map(call => call.method), ['process/spawn']);
});

test('a failed kill keeps its handle available to page cleanup until exit is confirmed', async t => {
  const h = fixture(t);
  await h.host.request('create', [{ sessionId: 'closing' }]);
  const handle = h.local.handle();
  h.local.intercept = method => ['process/kill', 'process/spawn'].includes(method) ? Promise.reject(new Error('transport timeout')) : undefined;
  await assert.rejects(h.host.close('closing'), /transport timeout/);
  assert.equal(h.events.filter(event => event.type === 'exit').length, 0);
  await assert.rejects(h.host.request('create', [{ sessionId: 'closing' }]), /正在关闭/);
  h.local.intercept = undefined;
  await h.host.dispose();
  assert.ok(h.local.calls.some(call => call.method === 'process/kill' && call.params.processHandle === handle));
  assert.equal(h.events.filter(event => event.type === 'exit').length, 1);
});

test('normal close sends HUP only to its active shell on its original connection and waits for helper exit', async t => {
  const h = fixture(t), signalled = deferred(), release = deferred();
  await h.host.request('create', [{ sessionId: 'closing', hostId: 'ssh', cwd: '/remote' }]);
  const handle = h.remote.handle();
  h.remote.intercept = (method, params) => method === 'process/spawn' ? (async () => {
    assert.deepEqual(params.command, ['/bin/kill', '-HUP', '--', '100']);
    assert.equal(params.cwd, '/');
    assert.notEqual(params.processHandle, handle);
    signalled.resolve();
    // The spawn response is not the helper's completion notification.
    void release.promise.then(() => { h.remote.exit(handle, 1); h.remote.exit(String(params.processHandle), 0); });
    return {};
  })() : undefined;
  let closed = false;
  const closing = h.host.close('closing').then(() => { closed = true; });
  await signalled.promise;
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(closed, false);
  assert.equal(h.remote.calls.some(call => call.method === 'process/kill'), false);
  assert.equal(h.local.calls.length, 0);
  release.resolve();
  await closing;
  assert.equal(h.remote.listenerCount('message'), 1);
  const calls = h.remote.calls.length;
  await h.host.close('closing');
  h.remote.exit(handle, 1);
  await h.host.dispose();
  assert.equal(h.remote.calls.length, calls, 'never signal an exited handle or cached PID again');
});

test('a failed HUP reports the job cleanup gap and still kills the official shell handle', async t => {
  const h = fixture(t);
  await h.host.request('create', [{ sessionId: 'closing' }]);
  const handle = h.local.handle();
  h.local.intercept = (method, params) => {
    if (method !== 'process/spawn') return;
    h.local.exit(String(params.processHandle), 1);
    return Promise.resolve({});
  };
  await h.host.close('closing');
  assert.equal(h.local.calls.at(-1)?.method, 'process/kill');
  assert.equal(h.local.calls.at(-1)?.params.processHandle, handle);
  assert.ok(h.events.some(event => event.type === 'error' && event.message.includes('后台作业可能仍存活')));
});

test('host shutdown waits for every shell even if another close fails', async t => {
  const h = fixture(t), pending = deferred(), release = deferred();
  await h.host.request('create', [{ sessionId: 'first' }]);
  const first = h.local.handle();
  await h.host.request('create', [{ sessionId: 'second' }]);
  const second = h.local.handle();
  h.local.intercept = (method, params) => {
    if (method === 'process/kill' && params.processHandle === first) return Promise.reject(new Error('first kill failed'));
    if (method !== 'process/spawn') return;
    if ((params.command as string[])[3] === '100') { h.local.exit(String(params.processHandle), 1); return Promise.resolve({}); }
    pending.resolve();
    void release.promise.then(() => { h.local.exit(second, 1); h.local.exit(String(params.processHandle), 0); });
    return Promise.resolve({});
  };
  let finished = false;
  const closing = h.host.closeHost('local');
  const assertion = assert.rejects(closing, /first kill failed/).then(() => { finished = true; });
  await pending.promise;
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(finished, false, 'the host connection must remain usable until the second shell closes');
  release.resolve();
  await assertion;
  h.local.intercept = undefined;
});

test('RPC subscriptions retain callbacks and a browser disconnect closes once without replaying input', async () => {
  const requests: unknown[] = [], events: TerminalEvent[] = [];
  let disposed = 0, duplicated = 0;
  const listener = Object.assign(async (event: TerminalEvent) => { events.push(event); }, {
    dup() { duplicated++; return listener; }, onRpcBroken() {}, [Symbol.dispose]() { disposed++; },
  });
  const transport = new BrowserTerminal(async (operation, args) => { requests.push([operation, args]); });
  const service = terminalRpcService(class {}, transport);
  service.subscribe(listener);
  await service.create({ sessionId: 'browser', hostId: 'local', cwd: '/tmp' });
  transport.receive({ type: 'attached', sessionId: 'browser', shell: 'bash', cwd: '/tmp' });
  await service.write('browser', 'sleep 60\r');
  transport.disconnected(); transport.disconnected();
  assert.equal(requests.length, 2);
  assert.equal(events.filter(event => event.type === 'exit').length, 1);
  assert.match((events.at(-1) as Extract<TerminalEvent, { type: 'exit' }>).error!, /不会重发/);
  service.unsubscribe();
  assert.equal(duplicated, 1); assert.equal(disposed, 1);
});
