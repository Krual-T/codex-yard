import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createConnection, createServer } from 'node:net';
import type { Server, Socket } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import WebSocket from 'ws';
import { transform } from 'esbuild';
import { PortForwarding } from '../src/native/port-forwarding.ts';
import type { PortForwardRule, PortForwardSnapshot } from '../src/native/port-forwarding.ts';
import { adaptYardMenu } from '../src/native/app-menu-renderer.ts';
import type { SshHost } from '../src/native/ssh.ts';
import { rendererRoot } from '../lib/app-resources.ts';
import { createFakeCodex } from './fake-codex.ts';
import { nativeFixture } from './native-fixture.ts';
import { createNativeWorkbench } from '../src/native/server.ts';

async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as import('node:net').AddressInfo).port;
}
async function stop(server: Server) { await new Promise<void>(resolve => server.close(() => resolve())); }
async function unusedPort() { const server = createServer(); const port = await listen(server); await stop(server); return port; }
function rule(localPort: number, servicePort = 3000, id = 'fixture'): PortForwardRule {
  return { id, name: 'Fixture', sourceHostId: 'local', targetHostId: 'local', serviceHost: '127.0.0.1', servicePort, localPort };
}
async function echo(port: number, payload: string) {
  const socket = createConnection(port, '127.0.0.1');
  await once(socket, 'connect');
  socket.write(payload);
  const [chunk] = await once(socket, 'data', { signal: AbortSignal.timeout(3000) });
  socket.destroy();
  return String(chunk);
}

test('forwarding carries TCP bytes, detects receiver port conflicts, and cleans up open connections on stop', async t => {
  const sourceSockets = new Set<Socket>();
  const source = createServer(socket => { sourceSockets.add(socket); socket.on('close', () => sourceSockets.delete(socket)); socket.pipe(socket); });
  const servicePort = await listen(source), localPort = await unusedPort();
  let persisted: PortForwardRule[] = [];
  const manager = new PortForwarding({ hosts: new Map(), save: async rules => { persisted = rules; } });
  t.after(async () => { await manager.close(); for (const socket of sourceSockets) socket.destroy(); await stop(source); });
  await manager.request({ operation: 'save', rule: rule(localPort, servicePort) });
  const started = await manager.request({ operation: 'start', id: 'fixture' });
  assert.equal(started.rules[0].status, 'running');
  assert.equal(await echo(localPort, 'service bytes \u4f60\u597d'), 'service bytes \u4f60\u597d');
  await assert.rejects(manager.request({ operation: 'save', rule: rule(localPort, servicePort) }), /先停止/);
  await manager.request({ operation: 'save', rule: rule(localPort, servicePort, 'duplicate') });
  await assert.rejects(manager.request({ operation: 'start', id: 'duplicate' }), /端口已有转发/);
  const active = createConnection(localPort, '127.0.0.1');
  await once(active, 'connect'); const closed = once(active, 'close');
  await manager.request({ operation: 'stop', id: 'fixture' }); await closed;
  await assert.rejects(echo(localPort, 'closed'), /ECONNREFUSED/);
  const restored = new PortForwarding({ hosts: new Map(), rules: persisted, save: async () => {} });
  assert.ok(restored.snapshot().rules.every(rule => rule.status === 'stopped'));
  await restored.close();
});

test('failed listeners report an error and saved rules survive a persistence failure', async t => {
  const occupied = createServer(), port = await listen(occupied);
  let rejectSave = false;
  const manager = new PortForwarding({ hosts: new Map(), save: async () => { if (rejectSave) throw new Error('disk failure'); } });
  t.after(async () => { await manager.close(); await stop(occupied); });
  await manager.request({ operation: 'save', rule: rule(port) });
  await assert.rejects(manager.request({ operation: 'start', id: 'fixture' }), /EADDRINUSE/);
  assert.equal(manager.snapshot().rules[0].status, 'error');
  rejectSave = true;
  await assert.rejects(manager.request({ operation: 'remove', id: 'fixture' }), /disk failure/);
  assert.equal(manager.snapshot().rules.length, 1);
});

test('starting a service for this client reuses its own listener and leaves the other client untouched', async t => {
  const host: SshHost = { hostId: 'remote-ssh-other', displayName: 'Other client', sshHost: 'unused.invalid', sshAlias: null, sshPort: 22, identity: null };
  const source = createServer(socket => socket.pipe(socket)), servicePort = await listen(source), localPort = await unusedPort();
  const original = { ...rule(localPort, servicePort), targetHostId: host.hostId };
  let saved: PortForwardRule[] = [];
  const manager = new PortForwarding({ hosts: new Map([[host.hostId, host]]), rules: [original], save: async rules => { saved = rules; } });
  t.after(async () => { await manager.close(); await stop(source); });
  await Promise.all([manager.request({ operation: 'start', id: original.id, targetHostId: 'local' }),
    manager.request({ operation: 'start', id: original.id, targetHostId: 'local' })]);
  const snapshot = manager.snapshot(), current = snapshot.rules.find(rule => rule.targetHostId === 'local')!;
  assert.equal(snapshot.rules.length, 2, 'concurrent clicks must reuse one client instance');
  assert.equal(current.status, 'running');
  assert.equal(snapshot.rules.find(rule => rule.id === original.id)?.status, 'stopped');
  assert.deepEqual(saved.find(rule => rule.id === original.id), original);
  assert.equal(await echo(localPort, 'CURRENT_CLIENT_OK'), 'CURRENT_CLIENT_OK');
  await assert.rejects(manager.request({ operation: 'stop', id: original.id, targetHostId: 'local' }), /属于其他设备/);
  await assert.rejects(manager.request({ operation: 'remove', id: current.id, targetHostId: host.hostId }), /属于其他设备/);
  assert.equal(manager.snapshot().rules.find(rule => rule.id === current.id)?.status, 'running');
  await manager.request({ operation: 'stop', id: current.id, targetHostId: 'local' });
  assert.equal(manager.snapshot().rules.find(rule => rule.id === original.id)?.status, 'stopped');
});

test('invalid clients and a failed client-instance save leave the service catalog intact', async t => {
  const host: SshHost = { hostId: 'remote-ssh-other', displayName: 'Other client', sshHost: 'unused.invalid', sshAlias: null, sshPort: 22, identity: null };
  const original = { ...rule(13000), targetHostId: host.hostId };
  const manager = new PortForwarding({ hosts: new Map([[host.hostId, host]]), rules: [original], save: async () => { throw new Error('disk failure'); } });
  t.after(() => manager.close());
  await assert.rejects(manager.request({ operation: 'start', id: original.id, targetHostId: '' }), /关联当前设备/);
  await assert.rejects(manager.request({ operation: 'start', id: original.id, targetHostId: 'missing' }), /设备已移除/);
  await assert.rejects(manager.request({ operation: 'start', id: original.id, targetHostId: 'local' }), /disk failure/);
  assert.deepEqual(manager.snapshot().rules, [{ ...original, status: 'stopped' }]);
});

test('rules reference registered SSH devices without exposing their credentials and reject invalid destinations', async t => {
  const host: SshHost = { hostId: 'remote-ssh-fixture', displayName: 'Pad fixture', sshHost: 'fixture.invalid', sshAlias: null, sshPort: 2222, identity: '/private/key' };
  const hosts = new Map([[host.hostId, host]]);
  const manager = new PortForwarding({ hosts, save: async () => {}, sshBin: process.execPath });
  t.after(() => manager.close());
  const input = { ...rule(13000), sourceHostId: host.hostId, targetHostId: host.hostId };
  await manager.request({ operation: 'save', rule: input });
  assert.doesNotMatch(JSON.stringify(manager.snapshot()), /private\/key|fixture\.invalid/);
  for (const override of [{ targetHostId: 'unknown' }, { localPort: 0 }, { serviceHost: '-oProxyCommand=bad' }, { servicePort: 1.5 }, { localPort: 65536 }]) {
    await assert.rejects(manager.request({ operation: 'save', rule: { ...input, ...override } }));
  }
  await assert.rejects(manager.request({ operation: 'save', rule: rule(3000) }), /不同的端口/);
  await assert.rejects(manager.request({ operation: 'start', id: 'fixture' }), /SSH/);
  assert.equal(manager.snapshot().rules[0].status, 'error');
  hosts.delete(host.hostId); await manager.hostsChanged([host.hostId]);
  await assert.rejects(manager.request({ operation: 'start', id: 'fixture' }), /SSH 设备已移除/);
});

test('closing during startup releases the newly opened receiver port', async () => {
  const localPort = await unusedPort();
  const manager = new PortForwarding({ hosts: new Map(), save: async () => {} });
  await manager.request({ operation: 'save', rule: rule(localPort) });
  const starting = manager.request({ operation: 'start', id: 'fixture' });
  const finished = assert.rejects(starting, /已关闭|已停止/);
  await manager.close(); await finished;
  const probe = createServer();
  await new Promise<void>((resolve, reject) => { probe.once('error', reject); probe.listen(localPort, '127.0.0.1', resolve); });
  await stop(probe);
});

test('the pinned Yard product menu replaces Work with forwarding while preserving Codex', async () => {
  const path = '/assets/app-initial-a68277f60b93.js';
  const original = await readFile(join(rendererRoot, path));
  const adapted = adaptYardMenu(path, original).toString();
  assert.match(adapted, /triggerButton:I,children:\[\(0,p3.jsx\)\(Ta.Item,\{[^\]]*端口转发管理[^\]]*,te\]/);
  assert.doesNotMatch(adapted, /triggerButton:I,children:\[ee,te\]/);
  assert.throws(() => adaptYardMenu(path, Buffer.from('different renderer')), /版本不匹配/);
  await transform(adapted, { loader: 'js' });
  const sharedPath = '/assets/app-shared-61271c39e3c5.js';
  const shared = await readFile(join(rendererRoot, sharedPath));
  const menuMotion = adaptYardMenu(sharedPath, shared);
  assert.notDeepEqual(menuMotion, shared);
  await transform(menuMotion.toString(), { loader: 'js' });
  assert.throws(() => adaptYardMenu(sharedPath, Buffer.from('different renderer')), /版本不匹配/);
});

test('host forwarding controls keep running after the creating browser disconnects and persist rules across host restart', async t => {
  const root = await mkdtemp('/tmp/yard-forward-host-');
  const fake = await createFakeCodex(root), native = await nativeFixture(root);
  const options = { ...native, port: 0, workspace: root, socketPath: fake.socketPath, codexHome: join(root, 'codex'), dataDir: join(root, 'data') };
  let app = await createNativeWorkbench(options);
  let page: WebSocket | undefined;
  const source = createServer(socket => socket.pipe(socket)), servicePort = await listen(source), localPort = await unusedPort();
  t.after(async () => { page?.terminate(); await app.close(); await fake.close(); await stop(source); await rm(root, { recursive: true, force: true }); });
  async function connect() { page = new WebSocket(app.url.replace('http', 'ws') + '/native-host', { origin: app.url }); await once(page, 'open'); }
  let id = 0;
  async function request(params: unknown) {
    const requestId = 'forward-' + ++id;
    const response = new Promise<{ responseType: string; body: PortForwardSnapshot }>(resolve => {
      const receive = (bytes: WebSocket.RawData) => { const value = JSON.parse(String(bytes)); if (value.requestId === requestId) { page!.off('message', receive); resolve(value); } };
      page!.on('message', receive);
    });
    page!.send(JSON.stringify({ type: 'fetch', requestId, url: 'vscode://codex/port-forwarding', body: JSON.stringify(params) }));
    const result = await response; assert.equal(result.responseType, 'success'); return result.body;
  }
  await connect();
  await request({ operation: 'save', rule: rule(localPort, servicePort) });
  await request({ operation: 'start', id: 'fixture' });
  page!.close(); await once(page!, 'close');
  assert.equal(await echo(localPort, 'browser closed'), 'browser closed');
  await connect(); assert.equal((await request({ operation: 'list' })).rules[0].status, 'running');
  page!.terminate(); await app.close(); app = await createNativeWorkbench(options);
  await connect(); assert.equal((await request({ operation: 'list' })).rules[0].status, 'stopped');
  await request({ operation: 'remove', id: 'fixture' });
  assert.equal((await request({ operation: 'list' })).rules.length, 0);
});
