import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import WebSocket from 'ws';
import { captureThreadProjectMembershipExpected } from '../src/native/thread-project-condition.ts';
import type { ThreadProjectConditionState, ThreadProjectRootIdentity } from '../src/native/thread-project-condition.ts';
import { createThreadProjectInventory } from '../src/native/thread-project-inventory.ts';
import { createNativeWorkbench } from '../src/native/server.ts';
import type { createSshProxyStream } from '../src/native/ssh.ts';
import { createFakeCodex, fixtureThread } from './fake-codex.ts';
import { nativeFixture } from './native-fixture.ts';

type Message = Record<string, any>;
const remoteId = 'ssh-fixture';
const source: ThreadProjectRootIdentity = { hostId: 'local', id: 'source', rootPaths: ['/source'] };
const target: ThreadProjectRootIdentity = { hostId: 'local', id: 'target', rootPaths: ['/target'] };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function page(url: string) {
  const socket = new WebSocket(url.replace('http', 'ws') + '/native-host', { origin: url });
  const messages: Message[] = [];
  socket.on('message', bytes => { messages.push(JSON.parse(String(bytes))); socket.emit('received'); });
  await once(socket, 'open');
  async function until(predicate: (message: Message) => boolean, from = 0) {
    const signal = AbortSignal.timeout(10_000);
    while (!messages.slice(from).some(predicate)) await once(socket, 'received', { signal });
    return messages.slice(from).find(predicate)!;
  }
  let sequence = 0;
  function rpc(method: string, params: Record<string, unknown>, hostId = 'local', generation?: string) {
    const id = ++sequence, from = messages.length;
    socket.send(JSON.stringify({ type: 'mcp-request', hostId, ...(generation ? { daemonConnectionGeneration: generation } : {}),
      request: { id, method, params } }));
    return until(message => message.type === 'mcp-response' && message.message.id === id && message.hostId === hostId, from);
  }
  function host(endpoint: string, params: Record<string, unknown> = {}) {
    const requestId = `host-${++sequence}`, from = messages.length;
    socket.send(JSON.stringify({ type: 'fetch', requestId, url: 'vscode://codex/' + endpoint, body: JSON.stringify(params) }));
    return until(message => message.type === 'fetch-response' && message.requestId === requestId, from);
  }
  async function connect(hostId = 'local') {
    const result = await rpc('thread/read', { threadId: 'same' }, hostId);
    assert.ok(result.message.result, JSON.stringify(result));
    return (await until(message => message.type === 'codex-app-server-connection-changed' && message.hostId === hostId &&
      message.state === 'connected')).daemonConnectionGeneration as string;
  }
  return { socket, messages, until, rpc, host, connect };
}

async function fixture(t: TestContext, globals: Record<string, unknown> = {}, extraState: Record<string, unknown> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'yard-side-native-'));
  let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined;
  let local: Awaited<ReturnType<typeof createFakeCodex>> | undefined;
  let remote: Awaited<ReturnType<typeof createFakeCodex>> | undefined;
  const sockets: WebSocket[] = [];
  const releases = new Set<() => void>();
  t.after(async () => {
    for (const release of releases) release();
    for (const socket of sockets) socket.terminate();
    await app?.close(); await local?.close(); await remote?.close();
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(join(root, 'local')); await mkdir(join(root, 'remote')); await mkdir(join(root, 'data'));
  local = await createFakeCodex(join(root, 'local')); remote = await createFakeCodex(join(root, 'remote'));
  const localPeer = local, remotePeer = remote;
  localPeer.threads.set('same', fixtureThread('same', '/source'));
  remotePeer.threads.set('same', fixtureThread('same', '/remote'));
  remotePeer.threads.set('archived-remote', fixtureThread('archived-remote', '/remote'));
  remotePeer.archived.add('archived-remote');
  await writeFile(join(root, 'data', 'native-state.json'), JSON.stringify({ globals, settings: {}, futureRoot: { keep: true }, ...extraState }));
  const resources = await nativeFixture(root);
  const host = { hostId: remoteId, displayName: 'Fixture', sshAlias: 'fixture', sshHost: 'fixture', sshPort: null, identity: null };
  const sshStream = ((_host, paths) => { paths?.({ homeDirectory: '/fixture', codexHome: '/fixture/.codex' });
    return createConnection(remotePeer.socketPath); }) as typeof createSshProxyStream;
  let gate: { entered: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> } | undefined;
  app = await createNativeWorkbench({ ...resources, workspace: root, dataDir: join(root, 'data'), socketPath: localPeer.socketPath,
    codexHome: join(root, 'codex'), port: 0, hostCatalog: { hosts: [host], projects: [], assignments: {} }, sshStream,
    async nativeStateCheckpoint(step) {
      if (step === 'file-sync' && gate) { const active = gate; gate = undefined; active.entered.resolve(); await active.release.promise; }
    } });
  const workbench = app;
  return { root, local: localPeer, remote: remotePeer,
    async page() { const result = await page(workbench.url); sockets.push(result.socket); return result; },
    releaseOnCleanup(release: () => void) { releases.add(release); },
    gateNextCommit() { gate = { entered: deferred(), release: deferred() }; releases.add(gate.release.resolve); return gate; },
  };
}

test('requested identities trigger a real all-host current and archived inventory, and incomplete scans never certify identity', async t => {
  const f = await fixture(t), p = await f.page(), generation = await p.connect();
  const legacy = await p.host('thread-project-state');
  assert.equal(legacy.responseType, 'success'); assert.equal(legacy.body.inventory.complete, true);
  assert.equal(Object.hasOwn(legacy.body, 'resolvedThreadHosts'), false);
  assert.equal(f.local.calls('thread/list').length, 0);
  const offline = await p.host('thread-project-state', { hostId: 'local', daemonConnectionGeneration: generation,
    resolveThreadIds: ['same', 'archived-remote', 'missing'] });
  assert.equal(offline.body.inventory.complete, false); assert.ok(offline.body.inventory.errors[remoteId]);
  assert.equal(offline.body.resolvedThreadHosts, null);
  await p.connect(remoteId);
  const scan = await p.host('thread-project-state', { hostId: 'local', daemonConnectionGeneration: generation,
    resolveThreadIds: ['same', 'archived-remote', 'missing', 'same'] });
  assert.equal(scan.responseType, 'success', JSON.stringify(scan)); assert.equal(scan.body.inventory.complete, true);
  assert.deepEqual([...scan.body.resolvedThreadHosts.same].sort(), ['local', remoteId].sort());
  assert.deepEqual(scan.body.resolvedThreadHosts['archived-remote'], [remoteId]);
  assert.deepEqual(scan.body.resolvedThreadHosts.missing, []);
  assert.equal(scan.body.membershipSources.length, 6);
  assert.ok(f.local.calls('thread/list').some(call => call.params.archived === true));
  assert.ok(f.remote.calls('thread/list').some(call => call.params.archived === true));
  const bad = await p.host('thread-project-state', { hostId: 'local', daemonConnectionGeneration: 'old', resolveThreadIds: ['same'] });
  assert.equal(bad.responseType, 'error'); assert.equal(bad.sendPhase, 'before-send');
});

test('host IDs with prototype names cannot hide an inventory failure', async () => {
  const inventory = createThreadProjectInventory(['local', '__proto__'], async hostId => {
    if (hostId === '__proto__') throw new Error('offline');
    return { async request() { return { data: [{ id: 'same' }], nextCursor: null }; } };
  });
  const result = await inventory.refresh();
  assert.equal(result.complete, false);
  assert.equal(Object.hasOwn(result.errors, '__proto__'), true);
  assert.equal(result.errors.__proto__, 'offline');
  assert.equal(inventory.compatibility.resolveLegacyThreadHosts('same'), undefined);
});

test('an original remote connection lost during inventory cannot certify a partial result', async t => {
  const f = await fixture(t), p = await f.page(), generation = await p.connect();
  await p.connect(remoteId);
  const entered = deferred(), release = deferred();
  f.releaseOnCleanup(release.resolve);
  let originalSocket: WebSocket | undefined;
  f.remote.handlers.set('thread/list', async (params, context) => {
    originalSocket = context.socket; entered.resolve(); await release.promise;
    return f.remote.defaultResult('thread/list', params);
  });
  const pending = p.host('thread-project-state', { hostId: 'local', daemonConnectionGeneration: generation, resolveThreadIds: ['same'] });
  await entered.promise;
  assert.ok(originalSocket); const closed = once(originalSocket!, 'close'); originalSocket!.terminate(); await closed;
  release.resolve();
  const result = await pending;
  assert.equal(result.responseType, 'success', JSON.stringify(result));
  assert.equal(result.body.inventory.complete, false); assert.ok(result.body.inventory.errors[remoteId]);
  assert.equal(result.body.resolvedThreadHosts, null);
});

test('real host conditionally moves and detaches while preserving other hosts, legacy envelopes and unrelated writes', async t => {
  const globals = {
    'local-projects': { '/source': { id: 'source', rootPaths: ['/source'], future: 1 },
      '/target': { id: 'target', rootPaths: ['/target'], future: 2 }, '/other': { id: 'other', rootPaths: ['/other'] } },
    'remote-projects': [{ id: 'source', hostId: remoteId, remotePath: '/remote', future: true }],
    'thread-project-assignments': { $codexYardThreadProjects: 1,
      legacy: { same: { projectKind: 'local', projectId: 'source' }, opaque: { newer: true } },
      hosts: { local: { same: { projectKind: 'local', projectId: 'source' } },
        [remoteId]: { same: { projectKind: 'remote', projectId: 'source', hostId: remoteId } } }, future: { retain: 'assignments' } },
    'projectless-thread-ids': { $codexYardThreadProjects: 1, legacy: ['same', 'unrelated'],
      hosts: { local: { same: false }, [remoteId]: { same: true } }, future: { retain: 'projectless' } },
    'thread-projectless-output-directories': { same: '/old-output' }, 'thread-workspace-root-hints': { same: '/old-root' },
    unrelated: { keep: true },
  };
  const f = await fixture(t, globals), a = await f.page(), b = await f.page();
  const generation = await a.connect(); await a.connect(remoteId); await b.connect();
  async function state() {
    const response = await a.host('thread-project-state', { hostId: 'local', daemonConnectionGeneration: generation, resolveThreadIds: ['same'] });
    assert.equal(response.responseType, 'success', JSON.stringify(response));
    assert.equal(response.body.inventory.complete, true); return response.body as ThreadProjectConditionState;
  }
  const original = await state(), identity = { hostId: 'local', threadId: 'same' };
  const projectedIdentity = { ...identity, cwd: '/source' }, projectedSource = { ...source, name: 'Source' },
    projectedTarget = { ...target, name: 'Target' };
  const expected = captureThreadProjectMembershipExpected(original, projectedIdentity, projectedSource, projectedTarget);
  assert.deepEqual(expected.identity, identity);
  assert.deepEqual(expected.source, source); assert.deepEqual(expected.target, target);
  const changedCatalog = structuredClone(globals['local-projects']);
  changedCatalog['/other'].rootPaths = ['/external'];
  assert.equal((await b.host('set-global-state', { key: 'local-projects', value: changedCatalog })).responseType, 'success');
  assert.equal((await b.host('thread-projects', { operation: 'setProjectless', value: { hostId: remoteId, threadId: 'same', projectless: false } })).responseType, 'success');
  const move = await a.host('thread-projects', { hostId: 'local', daemonConnectionGeneration: generation, operation: 'setMembership',
    value: { ...identity, assignment: { projectKind: 'local', projectId: 'target' }, projectless: false, expected } });
  assert.equal(move.responseType, 'success', JSON.stringify(move));
  const persisted = JSON.parse(await readFile(join(f.root, 'data', 'native-state.json'), 'utf8'));
  assert.equal(persisted.globals['thread-project-assignments'].hosts.local.same.projectId, 'target');
  assert.equal(persisted.globals['thread-project-assignments'].hosts[remoteId].same.projectId, 'source');
  assert.equal(persisted.globals['projectless-thread-ids'].hosts[remoteId].same, false);
  assert.deepEqual(persisted.globals['thread-project-assignments'].legacy, globals['thread-project-assignments'].legacy);
  assert.deepEqual(persisted.globals['thread-project-assignments'].future, { retain: 'assignments' });
  assert.deepEqual(persisted.globals['projectless-thread-ids'].future, { retain: 'projectless' });
  assert.deepEqual(persisted.globals['thread-projectless-output-directories'], globals['thread-projectless-output-directories']);
  assert.deepEqual(persisted.globals['thread-workspace-root-hints'], globals['thread-workspace-root-hints']);
  assert.deepEqual(persisted.globals.unrelated, { keep: true }); assert.deepEqual(persisted.futureRoot, { keep: true });
  assert.deepEqual(persisted.globals['local-projects']['/other'].rootPaths, ['/external']);

  const beforeConflict = await state();
  const staleSource = captureThreadProjectMembershipExpected(beforeConflict, identity, target, source);
  const sourceCatalog = structuredClone(changedCatalog); sourceCatalog['/target'].rootPaths = ['/moved-source'];
  assert.equal((await b.host('set-global-state', { key: 'local-projects', value: sourceCatalog })).responseType, 'success');
  const sourceConflict = await a.host('thread-projects', { hostId: 'local', daemonConnectionGeneration: generation, operation: 'setMembership',
    value: { ...identity, assignment: { projectKind: 'local', projectId: 'source' }, projectless: false, expected: staleSource } });
  assert.equal(sourceConflict.responseType, 'error'); assert.match(sourceConflict.error, /roots changed/);
  assert.equal((await b.host('set-global-state', { key: 'local-projects', value: changedCatalog })).responseType, 'success');
  const stale = captureThreadProjectMembershipExpected(await state(), identity, target, source);
  const conflictCatalog = structuredClone(changedCatalog); conflictCatalog['/source'].rootPaths = ['/moved'];
  assert.equal((await b.host('set-global-state', { key: 'local-projects', value: conflictCatalog })).responseType, 'success');
  const conflict = await a.host('thread-projects', { hostId: 'local', daemonConnectionGeneration: generation, operation: 'setMembership',
    value: { ...identity, assignment: { projectKind: 'local', projectId: 'source' }, projectless: false, expected: stale } });
  assert.equal(conflict.responseType, 'error'); assert.match(conflict.error, /roots changed/);
  const beforeDetach = await state();
  const detach = captureThreadProjectMembershipExpected(beforeDetach, identity, target, null);
  const detached = await a.host('thread-projects', { hostId: 'local', daemonConnectionGeneration: generation, operation: 'setMembership',
    value: { ...identity, assignment: null, projectless: true, expected: detach } });
  assert.equal(detached.responseType, 'success', JSON.stringify(detached));
  const final = JSON.parse(await readFile(join(f.root, 'data', 'native-state.json'), 'utf8'));
  assert.equal(final.globals['thread-project-assignments'].hosts.local.same, null);
  assert.equal(final.globals['projectless-thread-ids'].hosts.local.same, true);
  assert.deepEqual(final.globals['thread-projectless-output-directories'], globals['thread-projectless-output-directories']);
  assert.deepEqual(final.globals['thread-workspace-root-hints'], globals['thread-workspace-root-hints']);
});

test('a conditional move distinguishes an absent membership from a concurrent explicit clear', async t => {
  const f = await fixture(t, { 'local-projects': { '/target': { id: 'target', rootPaths: ['/target'] } }, 'remote-projects': [] });
  const a = await f.page(), b = await f.page(), generation = await a.connect(); await a.connect(remoteId); await b.connect();
  const identity = { hostId: 'local', threadId: 'same' };
  const snapshot = await a.host('thread-project-state', { hostId: 'local', daemonConnectionGeneration: generation, resolveThreadIds: ['same'] });
  const expected = captureThreadProjectMembershipExpected(snapshot.body, identity, null, target);
  assert.equal(expected.observed.raw.assignment.qualified.state, 'missing');
  const cleared = await b.host('thread-projects', { operation: 'setAssignment', value: { ...identity, assignment: null } });
  assert.equal(cleared.responseType, 'success');
  const stale = await a.host('thread-projects', { hostId: 'local', daemonConnectionGeneration: generation, operation: 'setMembership',
    value: { ...identity, assignment: { projectKind: 'local', projectId: 'target' }, projectless: false, expected } });
  assert.equal(stale.responseType, 'error'); assert.match(stale.error, /membership changed/);
  const raw = (await a.host('get-global-state', { key: 'thread-project-assignments' })).body.value;
  assert.equal(raw.hosts.local.same, null);
});

test('unknown fields on the membership being replaced are retained instead of silently discarded', async t => {
  const original = { projectKind: 'local', projectId: 'source', future: { keep: true } };
  const f = await fixture(t, { 'local-projects': { '/source': { id: 'source', rootPaths: ['/source'] },
    '/target': { id: 'target', rootPaths: ['/target'] } }, 'remote-projects': [],
    'thread-project-assignments': { $codexYardThreadProjects: 1, legacy: {}, hosts: { local: { same: original } }, future: 'envelope' } });
  const p = await f.page(), generation = await p.connect(); await p.connect(remoteId);
  const identity = { hostId: 'local', threadId: 'same' };
  const snapshot = await p.host('thread-project-state', { hostId: 'local', daemonConnectionGeneration: generation, resolveThreadIds: ['same'] });
  const expected = captureThreadProjectMembershipExpected(snapshot.body, identity, source, target);
  const rejected = await p.host('thread-projects', { hostId: 'local', daemonConnectionGeneration: generation, operation: 'setMembership',
    value: { ...identity, assignment: { projectKind: 'local', projectId: 'target' }, projectless: false, expected } });
  assert.equal(rejected.responseType, 'error'); assert.match(rejected.error, /unknown fields/);
  const retained = (await p.host('get-global-state', { key: 'thread-project-assignments' })).body.value;
  assert.deepEqual(retained.hosts.local.same, original); assert.equal(retained.future, 'envelope');
});

test('an inventory connection that expires after the snapshot cannot authorize a later move', async t => {
  const f = await fixture(t, { 'local-projects': { '/target': { id: 'target', rootPaths: ['/target'] } }, 'remote-projects': [] });
  const p = await f.page(), generation = await p.connect(); await p.connect(remoteId);
  let remoteSocket: WebSocket | undefined;
  f.remote.handlers.set('thread/read', (params, context) => { remoteSocket = context.socket; return f.remote.defaultResult('thread/read', params); });
  await p.rpc('thread/read', { threadId: 'same' }, remoteId);
  const snapshot = await p.host('thread-project-state', { hostId: 'local', daemonConnectionGeneration: generation, resolveThreadIds: ['same'] });
  const identity = { hostId: 'local', threadId: 'same' };
  const expected = captureThreadProjectMembershipExpected(snapshot.body, identity, null, target);
  assert.ok(remoteSocket); const closed = once(remoteSocket!, 'close'); remoteSocket!.terminate(); await closed;
  const rejected = await p.host('thread-projects', { hostId: 'local', daemonConnectionGeneration: generation, operation: 'setMembership',
    value: { ...identity, assignment: { projectKind: 'local', projectId: 'target' }, projectless: false, expected } });
  assert.equal(rejected.responseType, 'error'); assert.match(rejected.error, /会话目录已失效/);
  const after = (await p.host('get-global-state', { key: 'thread-project-assignments' })).body;
  const raw = snapshot.body.membershipSources.find((item: Message) => item.hostId === 'local' && item.threadId === 'same');
  assert.equal(raw.assignment.qualified.state, 'missing');
  assert.equal(after.value?.hosts?.local?.same, undefined);
});

test('a queued project transaction refuses the original page connection after its daemon socket is lost', async t => {
  const f = await fixture(t, { 'local-projects': { '/target': { id: 'target', rootPaths: ['/target'] } }, 'remote-projects': [] });
  const a = await f.page(), b = await f.page(); await a.connect(); const generation = await b.connect(); await b.connect(remoteId);
  let sourceSocket: WebSocket | undefined;
  f.local.handlers.set('thread/read', (params, context) => { sourceSocket = context.socket; return f.local.defaultResult('thread/read', params); });
  await b.rpc('thread/read', { threadId: 'same' }, 'local', generation);
  const snapshot = await b.host('thread-project-state', { hostId: 'local', daemonConnectionGeneration: generation, resolveThreadIds: ['same'] });
  const identity = { hostId: 'local', threadId: 'same' };
  const expected = captureThreadProjectMembershipExpected(snapshot.body, identity, null, target);
  const before = (await b.host('get-global-state', { key: 'thread-project-assignments' })).body;
  const gate = f.gateNextCommit();
  const blocking = a.host('set-global-state', { key: 'unrelated', value: { retained: true } });
  await gate.entered.promise;
  const pending = b.host('thread-projects', { hostId: 'local', daemonConnectionGeneration: generation, operation: 'setMembership',
    value: { ...identity, assignment: { projectKind: 'local', projectId: 'target' }, projectless: false, expected } });
  await b.host('app-server-connection-state', { hostId: 'local' });
  assert.ok(sourceSocket); const closed = once(sourceSocket!, 'close'); sourceSocket!.terminate(); await closed;
  gate.release.resolve(); assert.equal((await blocking).responseType, 'success');
  const rejected = await pending;
  assert.equal(rejected.responseType, 'error'); assert.equal(rejected.uncertain, false); assert.equal(rejected.sendPhase, 'before-send');
  const saved = JSON.parse(await readFile(join(f.root, 'data', 'native-state.json'), 'utf8'));
  assert.equal(Object.hasOwn(saved.globals, 'thread-project-assignments'), before.exists);
  assert.deepEqual(saved.globals['thread-project-assignments'], before.value);
  assert.deepEqual(saved.globals.unrelated, { retained: true });
});

test('read-state update uses the original host, generation, revision and write queue', async t => {
  const f = await fixture(t), a = await f.page(), b = await f.page();
  const aGeneration = await a.connect(), bGeneration = await b.connect();
  let revision = 'revision-1';
  const held = deferred(), entered = deferred();
  f.releaseOnCleanup(held.resolve);
  let first = true, bSocket: WebSocket | undefined;
  f.local.handlers.set('thread/read', (params, context) => { bSocket = context.socket; return f.local.defaultResult('thread/read', params); });
  await b.rpc('thread/read', { threadId: 'same' }, 'local', bGeneration);
  f.local.handlers.set('thread/readState/update', async params => {
    if (params.expectedRevision !== revision) throw new Error('read state revision conflict');
    if (first) { first = false; entered.resolve(); await held.promise; }
    revision = 'revision-2'; return { readState: { revision, firstUnread: null } };
  });
  const operation = { threadId: 'same', expectedRevision: 'revision-1', operation: { type: 'read' } };
  const firstWrite = a.rpc('thread/readState/update', operation, 'local', aGeneration);
  await entered.promise;
  const queued = b.rpc('thread/readState/update', operation, 'local', bGeneration);
  await b.host('app-server-connection-state', { hostId: 'local' });
  assert.ok(bSocket); const closed = once(bSocket!, 'close'); bSocket!.terminate(); await closed;
  held.resolve(); assert.ok((await firstWrite).message.result);
  const rejected = await queued; assert.ok(rejected.message.error); assert.equal(rejected.message.error.data?.uncertain, false);
  assert.equal(f.local.calls('thread/readState/update').length, 1);
  assert.deepEqual(f.local.calls('thread/readState/update')[0]!.params, operation);
  const conflict = await a.rpc('thread/readState/update', operation, 'local', aGeneration);
  assert.match(conflict.message.error.message, /revision conflict/);
  assert.equal(f.local.calls('thread/readState/update').length, 2);
  const wrongHost = await a.rpc('thread/readState/update', operation, remoteId, aGeneration);
  assert.ok(wrongHost.message.error); assert.equal(f.remote.calls('thread/readState/update').length, 0);
  f.local.handlers.delete('thread/readState/update');
  const unsupported = await a.rpc('thread/readState/update', { ...operation, expectedRevision: 'revision-2' }, 'local', aGeneration);
  assert.match(unsupported.message.error.message, /Unexpected fixture RPC/);
});

test('read-state update retains the native child-write fence and host-qualified identity', async t => {
  const sideChats = { version: 1, prepared: {}, operations: {
    operation: { operationId: 'operation', parent: { hostId: 'local' }, childId: 'child' },
  } };
  const f = await fixture(t, {}, { sideChats }), p = await f.page();
  const localGeneration = await p.connect(), remoteGeneration = await p.connect(remoteId);
  f.local.handlers.set('thread/readState/update', () => ({ accepted: true }));
  f.remote.handlers.set('thread/readState/update', () => ({ accepted: true }));
  const params = { threadId: 'child', expectedRevision: 'original-revision', operation: { type: 'unread' } };
  const denied = await p.rpc('thread/readState/update', params, 'local', localGeneration);
  assert.ok(denied.message.error); assert.equal(denied.message.error.data?.sendPhase, 'before-send');
  assert.equal(f.local.calls('thread/readState/update').length, 0);
  const otherHost = await p.rpc('thread/readState/update', params, remoteId, remoteGeneration);
  assert.deepEqual(otherHost.message.result, { accepted: true });
  assert.deepEqual(f.remote.calls('thread/readState/update')[0]!.params, params);
});
