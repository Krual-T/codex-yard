import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectCatalogWrites } from '../src/native/project-catalog-writes.ts';
import { createStateMutations } from '../src/native/state-mutations.ts';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import WebSocket from 'ws';
import { createNativeWorkbench } from '../src/native/server.ts';
import { createFakeCodex } from './fake-codex.ts';
import { nativeFixture } from './native-fixture.ts';

test('concurrent project additions merge inside the shared durable native-state interval', async () => {
  const globals: Record<string, unknown> = { unknown: { keep: true }, 'local-projects': { '/old': { id: 'old', future: true } } };
  const events: unknown[] = [], snapshots: unknown[] = [];
  const add = createProjectCatalogWrites(globals, createStateMutations(), async () => { snapshots.push(structuredClone(globals)); }, event => events.push(event));
  await Promise.all([add('local', '/a', 'A'), add('local', '/b', 'B'), add('ssh-fixture', '/same', 'Remote A'), add('ssh-fixture', '/same', 'Remote B')]);
  assert.deepEqual(Object.keys(globals['local-projects'] as object), ['/old', '/a', '/b']);
  assert.deepEqual((globals['local-projects'] as any)['/old'], { id: 'old', future: true });
  const remote = globals['remote-projects'] as { id: string }[];
  assert.equal(remote.length, 2); assert.notEqual(remote[0].id, remote[1].id);
  assert.deepEqual(globals.unknown, { keep: true });
  assert.equal(events.length, 4); assert.equal(snapshots.length, 4);
});

test('failed project persistence rolls back before the next addition and does not erase malformed catalogs', async () => {
  const globals: Record<string, unknown> = {};
  let fail = true, events = 0;
  const add = createProjectCatalogWrites(globals, createStateMutations(), async () => { if (fail) { fail = false; throw new Error('disk full'); } }, () => { events++; });
  const results = await Promise.allSettled([add('local', '/rejected', 'Rejected'), add('local', '/accepted', 'Accepted')]);
  assert.equal(results[0].status, 'rejected'); assert.equal(results[1].status, 'fulfilled');
  assert.deepEqual(Object.keys(globals['local-projects'] as object), ['/accepted']); assert.equal(events, 1);
  for (const bad of [null, [], 'opaque']) {
    globals['local-projects'] = bad;
    await assert.rejects(add('local', '/new', 'New'), /原值已保留/);
    assert.equal(globals['local-projects'], bad);
  }
});

test('adding an existing local project preserves all roots and unknown fields without replacing malformed entries', async () => {
  const globals: Record<string, unknown> = { 'local-projects': {
    '/a': { id: 'original', rootPaths: ['/a', '/b'], future: { keep: true } }, '/opaque': 'archive',
  } };
  const add = createProjectCatalogWrites(globals, createStateMutations(), async () => {}, () => {});
  assert.deepEqual((await add('local', '/a', 'Renamed')).project,
    { id: 'original', rootPaths: ['/a', '/b'], future: { keep: true }, name: 'Renamed' });
  await assert.rejects(add('local', '/opaque', 'Replacement'), /原值已保留/);
  assert.equal((globals['local-projects'] as any)['/opaque'], 'archive');
});

test('project inventory never dials an offline SSH host and skips scanning when there are no legacy identities', async t => {
  const root = await mkdtemp('/tmp/yard-project-inventory-'), hostId = 'ssh-fixture';
  const fake = await createFakeCodex(root), resources = await nativeFixture(root);
  await mkdir(join(root, 'data'));
  await writeFile(join(root, 'data/native-state.json'), JSON.stringify({ globals: {
    'thread-project-assignments': { legacy: { projectKind: 'local', projectId: '/p' } },
    'remote-connection-auto-connect-by-host-id': { [hostId]: false },
  }, settings: {} }));
  let dials = 0;
  const app = await createNativeWorkbench({ ...resources, workspace: root, dataDir: join(root, 'data'), socketPath: fake.socketPath,
    codexHome: join(root, 'codex'), port: 0,
    hostCatalog: { hosts: [{ hostId, displayName: 'Offline', sshAlias: 'fixture', sshHost: 'fixture', sshPort: null, identity: null }], projects: [], assignments: {} },
    sshStream: () => { dials++; throw new Error('An inventory read must not dial SSH'); } });
  const socket = new WebSocket(app.url.replace('http', 'ws') + '/native-host', { origin: app.url });
  t.after(async () => { socket.terminate(); await app.close(); await fake.close(); await rm(root, { recursive: true, force: true }); });
  await once(socket, 'open');
  let sequence = 0;
  async function host(endpoint: string, params: Record<string, unknown> = {}): Promise<any> {
    const requestId = String(++sequence);
    const reply = new Promise<any>((resolve, reject) => {
      const listener = (bytes: WebSocket.RawData) => {
        const message = JSON.parse(String(bytes));
        if (message.type !== 'fetch-response' || message.requestId !== requestId) return;
        socket.off('message', listener);
        if (message.responseType === 'error') reject(new Error(message.error)); else resolve(message.body);
      };
      socket.on('message', listener);
    });
    socket.send(JSON.stringify({ type: 'fetch', requestId, url: 'vscode://codex/' + endpoint, body: JSON.stringify(params) }));
    return reply;
  }
  socket.send(JSON.stringify({ type: 'ready' }));
  await assert.rejects(host('project-add', { hostId: 'missing-host', path: '/a', name: 'Unknown' }), /未登记的执行主机/);
  const initial = await host('thread-project-state');
  assert.equal(initial.inventory.complete, false); assert.ok(initial.inventory.errors[hostId]);
  assert.deepEqual(initial.unresolved.assignments.legacy, { projectKind: 'local', projectId: '/p' });
  await host('set-remote-connection-auto-connect', { hostId, autoConnect: false });
  await host('thread-project-state'); assert.equal(dials, 0);
  await host('set-global-state', { key: 'thread-project-assignments', value: {} });
  const before = fake.calls('thread/list').length;
  assert.equal((await host('thread-project-state')).inventory.complete, true);
  assert.equal(fake.calls('thread/list').length, before); assert.equal(dials, 0);
});
