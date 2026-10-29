import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import WebSocket from 'ws';
import { createNativeWorkbench } from '../src/native/server.ts';
import type { NativeStateCheckpoint } from '../src/native/native-state.ts';
import { createFakeCodex } from './fake-codex.ts';
import { nativeFixture } from './native-fixture.ts';

type Message = Record<string, any>;

async function connect(url: string) {
  const socket = new WebSocket(url.replace('http', 'ws') + '/native-host', { origin: url });
  const messages: Message[] = [];
  socket.on('message', bytes => { messages.push(JSON.parse(String(bytes))); socket.emit('received'); });
  await once(socket, 'open');
  let sequence = 0;
  const send = (message: unknown) => socket.send(JSON.stringify(message));
  async function until(predicate: (message: Message) => boolean, start = 0) {
    const signal = AbortSignal.timeout(5000);
    while (!messages.slice(start).some(predicate)) await once(socket, 'received', { signal });
    return messages.slice(start).find(predicate)!;
  }
  async function host(endpoint: string, params: Record<string, unknown> = {}) {
    const requestId = 'native-parent-' + ++sequence;
    send({ type: 'fetch', requestId, url: 'vscode://codex/' + endpoint, body: JSON.stringify(params) });
    return until(message => message.type === 'fetch-response' && message.requestId === requestId);
  }
  return { socket, messages, send, until, host };
}

test('startup commits legacy roots before accepting requests, even when a real rename fails', async t => {
  const root = await mkdtemp('/tmp/aw-d-owner-'), dataDir = join(root, 'data');
  const fake = await createFakeCodex(root), { renderer, adapterPath } = await nativeFixture(root);
  let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined;
  const sockets: WebSocket[] = [];
  t.after(async () => {
    await chmod(dataDir, 0o700).catch(() => {});
    for (const socket of sockets) socket.terminate();
    await app?.close(); await fake.close(); await rm(root, { recursive: true, force: true });
  });
  await mkdir(dataDir);
  const oldFile = '{"globals":{"preserved":"old"},"settings":{},"future":{"keep":true}}\n';
  await writeFile(join(dataDir, 'native-state.json'), oldFile);
  const projectA = join(root, 'old-project'), projectB = join(root, 'new-project');
  await writeFile(join(dataDir, 'projects.json'), JSON.stringify([{ path: projectA, name: 'Old project' }]));
  const hostId = 'remote-ssh-fixture';
  const catalog = { hosts: [{ hostId, displayName: 'Fixture', sshAlias: 'fixture', sshHost: 'fixture', sshPort: null, identity: null }],
    projects: [{ id: 'remote-project', hostId, label: 'Remote', remotePath: '/fixture' }],
    assignments: { oldThread: { projectKind: 'remote', projectId: 'remote-project', hostId } } };
  let denyRename = true;
  const options = { port: 0, socketPath: fake.socketPath, codexHome: join(root, 'codex'), dataDir, workspace: root,
    renderer, adapterPath, hostCatalog: catalog, async nativeStateCheckpoint(step: NativeStateCheckpoint) {
      if (step === 'file-sync' && denyRename) { denyRename = false; await chmod(dataDir, 0o500); }
    } };
  const startupFailure = await createNativeWorkbench(options).then(async unexpected => { await unexpected.close(); return null; }, error => error);
  assert.ok(startupFailure?.uncertain === true && startupFailure.cause?.code === 'EACCES', 'startup must reject the real rename failure');
  assert.equal(await readFile(join(dataDir, 'native-state.json'), 'utf8'), oldFile);
  await chmod(dataDir, 0o700);
  app = await createNativeWorkbench(options);
  const startup = JSON.parse(await readFile(join(dataDir, 'native-state.json'), 'utf8'));
  assert.equal(startup.globals['local-projects'][projectA].name, 'Old project');
  assert.deepEqual(startup.globals['remote-projects'], catalog.projects);
  assert.deepEqual(startup.globals['thread-project-assignments'], catalog.assignments);
  assert.equal(startup.settings['default-workspace-full-view'], true);
  assert.deepEqual(startup.future, { keep: true });

  const page = await connect(app.url); sockets.push(page.socket);
  denyRename = true;
  const lost = await page.host('project-add', { path: projectB, name: 'New project' });
  assert.equal(lost.responseType, 'error'); assert.equal(lost.uncertain, true);
  await chmod(dataDir, 0o700);
  assert.deepEqual(JSON.parse(await readFile(join(dataDir, 'native-state.json'), 'utf8')), startup);
  const recovered = await page.host('get-global-state', { key: 'local-projects' });
  assert.equal(recovered.responseType, 'success');
  assert.equal(recovered.body.value[projectA].name, 'Old project');
  assert.equal((await page.host('project-add', { path: projectB, name: 'New project' })).responseType, 'success');
  const final = JSON.parse(await readFile(join(dataDir, 'native-state.json'), 'utf8'));
  assert.equal(final.globals['local-projects'][projectA].name, 'Old project');
  assert.equal(final.globals['local-projects'][projectB].name, 'New project');
  assert.deepEqual(final.globals['thread-project-assignments'], catalog.assignments);
  page.socket.terminate(); await app.close(); app = await createNativeWorkbench(options);
  const restarted = await connect(app.url); sockets.push(restarted.socket);
  const afterRestart = await restarted.host('get-global-state', { key: 'local-projects' });
  assert.equal(afterRestart.body.value[projectA].name, 'Old project');
  assert.equal(afterRestart.body.value[projectB].name, 'New project');

  assert.equal((await restarted.host('set-global-state', { key: 'thread-project-assignments', value: {} })).responseType, 'success');
  denyRename = true;
  assert.equal((await restarted.host('set-setting', { key: 'test-recovery', value: true })).uncertain, true);
  await chmod(dataDir, 0o700);
  const assignments = await restarted.host('get-global-state', { key: 'thread-project-assignments' });
  assert.equal(assignments.responseType, 'success');
  assert.deepEqual(assignments.body.value, {}, 'runtime recovery must not re-import the startup catalog');
});

test('startup does not serve when the imported root lacks directory confirmation', async t => {
  const root = await mkdtemp('/tmp/aw-d-start-'), dataDir = join(root, 'data');
  const fake = await createFakeCodex(root), { renderer, adapterPath } = await nativeFixture(root);
  let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined;
  t.after(async () => { await app?.close(); await fake.close(); await rm(root, { recursive: true, force: true }); });
  await mkdir(dataDir);
  const project = join(root, 'legacy');
  await writeFile(join(dataDir, 'native-state.json'), JSON.stringify({ globals: {}, settings: {}, future: { keep: true } }));
  await writeFile(join(dataDir, 'projects.json'), JSON.stringify([{ path: project, name: 'Legacy' }]));
  let loseConfirmation = true, commits = 0;
  const options = { port: 0, socketPath: fake.socketPath, codexHome: join(root, 'codex'), dataDir, workspace: root,
    renderer, adapterPath, hostCatalog: { hosts: [], projects: [], assignments: {} }, nativeStateCheckpoint(step: NativeStateCheckpoint) {
      if (step === 'file-sync') commits++;
      if (step === 'directory-sync' && loseConfirmation) { loseConfirmation = false; throw new Error('startup directory sync failed'); }
    } };
  const failure = await createNativeWorkbench(options).then(async unexpected => { await unexpected.close(); return null; }, error => error);
  assert.equal(failure?.uncertain, true);
  const saved = JSON.parse(await readFile(join(dataDir, 'native-state.json'), 'utf8'));
  assert.equal(saved.globals['local-projects'][project].name, 'Legacy');
  assert.deepEqual(saved.future, { keep: true });
  assert.equal(commits, 1);
  app = await createNativeWorkbench(options);
  assert.equal(commits, 1, 'the already confirmed startup root must not be rewritten');
  const page = await connect(app.url);
  try { assert.equal((await page.host('get-global-state', { key: 'local-projects' })).body.value[project].name, 'Legacy'); }
  finally { page.socket.terminate(); }
});

test('native-state isolation and recovery notify both real WebSocket subscribers and reject unverified Mini writes', async t => {
  const root = await mkdtemp('/tmp/aw-d-events-'), dataDir = join(root, 'data');
  const fake = await createFakeCodex(root), { renderer, adapterPath } = await nativeFixture(root);
  const hostId = 'remote-ssh-fixture';
  const catalog = { hosts: [{ hostId, displayName: 'Fixture', sshAlias: 'fixture', sshHost: 'fixture', sshPort: null, identity: null }],
    projects: [], assignments: {} };
  let failCommit = false, blockRecovery = true;
  const app = await createNativeWorkbench({ port: 0, socketPath: fake.socketPath, codexHome: join(root, 'codex'), dataDir, workspace: root,
    renderer, adapterPath, hostCatalog: catalog, nativeStateCheckpoint(step) {
      if (step === 'directory-sync' && failCommit) { failCommit = false; throw new Error('fixture directory sync'); }
      if (step === 'recovery-file-sync' && blockRecovery) throw new Error('fixture recovery blocked');
    } });
  const a = await connect(app.url), b = await connect(app.url);
  t.after(async () => { a.socket.terminate(); b.socket.terminate(); await app.close(); await fake.close(); await rm(root, { recursive: true, force: true }); });
  failCommit = true;
  const failed = await a.host('set-setting', { key: 'composerEnterBehavior', value: 'cmdAlways' });
  assert.equal(failed.responseType, 'error'); assert.equal(failed.uncertain, true);
  for (const page of [a, b]) {
    await page.until(message => message.type === 'settings-changed' && !Object.hasOwn(message, 'keys'));
    await page.until(message => message.type === 'global-state-updated' && !Object.hasOwn(message, 'keys'));
    await page.until(message => message.type === 'shared-object-updated' && message.key === 'remote_ssh_connections' && !Object.hasOwn(message, 'value'));
    await page.until(message => message.type === 'workbench-pet-error' && message.stateUnconfirmed === true);
    assert.equal(page.messages.some(message => message.type === 'workbench-pet-state'), false);
  }
  assert.equal((await b.host('get-setting', { key: 'composerEnterBehavior' })).responseType, 'error');
  const readStart = b.messages.length;
  b.send({ type: 'avatar-overlay-open-state-request' });
  const readError = await b.until(message => message.type === 'workbench-pet-error', readStart);
  assert.equal(readError.stateUnconfirmed, true);
  const committed = await readFile(join(dataDir, 'native-state.json'), 'utf8');
  for (const message of [{ type: 'avatar-overlay-open', isOpen: false }, { type: 'avatar-overlay-close' },
    { type: 'avatar-overlay-hide' }, { type: 'workbench-pet-position', position: { x: 0.2, y: 0.3 } }]) {
    const start = b.messages.length; b.send(message);
    const response = await b.until(item => item.type === 'workbench-pet-error', start);
    assert.match(response.error, /核实/); assert.equal(response.stateUnconfirmed, true);
  }
  assert.equal(await readFile(join(dataDir, 'native-state.json'), 'utf8'), committed);
  const aStart = a.messages.length, bStart = b.messages.length;
  blockRecovery = false;
  const actual = await b.host('get-setting', { key: 'composerEnterBehavior' });
  assert.equal(actual.responseType, 'success'); assert.equal(actual.body.value, 'cmdAlways');
  for (const [page, start] of [[a, aStart], [b, bStart]] as const) {
    await page.until(message => message.type === 'settings-changed' && !Object.hasOwn(message, 'keys'), start);
    await page.until(message => message.type === 'global-state-updated' && !Object.hasOwn(message, 'keys'), start);
    const hosts = await page.until(message => message.type === 'shared-object-updated' && message.key === 'remote_ssh_connections' && Array.isArray(message.value), start);
    assert.equal(hosts.value[0].hostId, hostId); assert.equal(hosts.value[0].autoConnect, false);
    const pet = await page.until(message => message.type === 'workbench-pet-state', start);
    assert.equal(pet.state.isOpen, false);
    for (const key of ['selected-avatar-id', 'avatar-overlay-mascot-width-px', 'avatar-overlay-pet-visible', 'pet-visibility']) {
      await page.until(message => message.type === 'workbench-mini-setting' && message.key === key, start);
    }
  }
  const project = join(root, 'recovered-project');
  failCommit = true;
  assert.equal((await a.host('project-add', { path: project, name: 'Recovered project' })).uncertain, true);
  const projectStart = b.messages.length;
  const projectState = await b.host('thread-project-state');
  assert.equal(projectState.responseType, 'success');
  assert.equal(projectState.body.catalog.local[project].name, 'Recovered project');
  await b.until(message => message.type === 'global-state-updated' && !Object.hasOwn(message, 'keys'), projectStart);
  assert.equal((await b.host('get-global-state', { key: 'local-projects' })).body.value[project].name, 'Recovered project');

  failCommit = true;
  const remoteWrite = await a.host('set-remote-connection-auto-connect', { hostId, autoConnect: true });
  assert.equal(remoteWrite.responseType, 'error'); assert.equal(remoteWrite.uncertain, true);
  const remoteStart = b.messages.length;
  const remote = await b.host('refresh-remote-connections');
  assert.equal(remote.responseType, 'success'); assert.equal(remote.body.remoteConnections[0].autoConnect, true);
  const remoteEvent = await b.until(message => message.type === 'shared-object-updated' && Array.isArray(message.value), remoteStart);
  assert.equal(remoteEvent.value[0].hostId, hostId); assert.equal(remoteEvent.value[0].autoConnect, true);
  assert.equal(fake.calls('turn/start').length, 0);
});

test('a stale or missing Mini toggle observation cannot reverse recovered state', async t => {
  const root = await mkdtemp('/tmp/aw-d-toggle-'), dataDir = join(root, 'data');
  const fake = await createFakeCodex(root), { renderer, adapterPath } = await nativeFixture(root);
  let failCommit = false, fileWrites = 0;
  const app = await createNativeWorkbench({ port: 0, socketPath: fake.socketPath, codexHome: join(root, 'codex'), dataDir, workspace: root,
    renderer, adapterPath, hostCatalog: { hosts: [], projects: [], assignments: {} }, nativeStateCheckpoint(step) {
      if (step === 'file-sync') fileWrites++;
      if (step === 'directory-sync' && failCommit) { failCommit = false; throw new Error('fixture directory sync'); }
    } });
  const page = await connect(app.url);
  t.after(async () => { page.socket.terminate(); await app.close(); await fake.close(); await rm(root, { recursive: true, force: true }); });
  page.send({ type: 'avatar-overlay-open-state-request' });
  assert.equal((await page.until(message => message.type === 'workbench-pet-state')).state.isOpen, false);
  failCommit = true;
  let start = page.messages.length;
  page.send({ type: 'avatar-overlay-open', isOpen: false });
  await page.until(message => message.type === 'workbench-pet-error', start);
  assert.equal(JSON.parse(await readFile(join(dataDir, 'native-state.json'), 'utf8')).globals['electron-avatar-overlay-open'], true);
  const writesAfterFailure = fileWrites;
  start = page.messages.length;
  page.send({ type: 'avatar-overlay-open', isOpen: false });
  await page.until(message => message.type === 'workbench-pet-state' && message.state.isOpen === true, start);
  assert.equal(fileWrites, writesAfterFailure);
  assert.equal(JSON.parse(await readFile(join(dataDir, 'native-state.json'), 'utf8')).globals['electron-avatar-overlay-open'], true);
  start = page.messages.length;
  page.send({ type: 'avatar-overlay-open' });
  await page.until(message => message.type === 'workbench-pet-error', start);
  assert.equal(fileWrites, writesAfterFailure);
  start = page.messages.length;
  page.send({ type: 'avatar-overlay-close' });
  await page.until(message => message.type === 'workbench-pet-state' && message.state.isOpen === false, start);
  start = page.messages.length;
  page.send({ type: 'avatar-overlay-open', isOpen: false });
  await page.until(message => message.type === 'workbench-pet-state' && message.state.isOpen === true, start);
  start = page.messages.length;
  page.send({ type: 'avatar-overlay-hide' });
  await page.until(message => message.type === 'workbench-pet-state' && message.state.isOpen === false, start);
});
