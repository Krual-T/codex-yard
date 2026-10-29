import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import WebSocket from 'ws';
import { createNativeWorkbench } from '../src/native/server.ts';
import { createFakeCodex } from './fake-codex.ts';
import { nativeFixture } from './native-fixture.ts';

type Message = Record<string, any>;

async function page(url: string) {
  const socket = new WebSocket(url.replace('http', 'ws') + '/native-host', { origin: url });
  const messages: Message[] = [];
  socket.on('message', bytes => { messages.push(JSON.parse(String(bytes))); socket.emit('received'); });
  await once(socket, 'open');
  async function until(predicate: (message: Message) => boolean, from = 0) {
    const signal = AbortSignal.timeout(5000);
    while (!messages.slice(from).some(predicate)) await once(socket, 'received', { signal });
    return messages.slice(from).find(predicate)!;
  }
  let nextId = 0;
  const send = (message: unknown) => socket.send(JSON.stringify(message));
  async function host(message: unknown, hostId?: string) {
    const requestId = 'pet-' + ++nextId;
    send({ type: 'fetch', requestId, url: 'vscode://codex/pet-overlay', body: JSON.stringify({ message, ...(hostId ? { hostId } : {}) }) });
    return until(item => item.type === 'fetch-response' && item.requestId === requestId);
  }
  return { socket, messages, send, until, host };
}

test('the Mini host endpoint shares the original overlay, validates commands and reports blocked recovery', async t => {
  const root = await mkdtemp('/tmp/aw-mini-host-');
  const fake = await createFakeCodex(root), { renderer, adapterPath } = await nativeFixture(root);
  let failCommit = false, blockRecovery = false;
  const app = await createNativeWorkbench({ port: 0, socketPath: fake.socketPath, codexHome: join(root, 'codex'),
    dataDir: join(root, 'data'), workspace: root, renderer, adapterPath,
    hostCatalog: { hosts: [], projects: [], assignments: {} }, nativeStateCheckpoint(step) {
      if (step === 'directory-sync' && failCommit) { failCommit = false; throw new Error('fixture commit confirmation'); }
      if (step === 'recovery-file-sync' && blockRecovery) throw new Error('fixture recovery');
    } });
  const a = await page(app.url), b = await page(app.url);
  t.after(async () => { a.socket.terminate(); b.socket.terminate(); await app.close(); await fake.close(); await rm(root, { recursive: true, force: true }); });

  let from = a.messages.length;
  assert.equal((await a.host({ type: 'avatar-overlay-open-state-request' })).responseType, 'success');
  assert.equal((await a.until(item => item.type === 'workbench-pet-state', from)).state.isOpen, false);
  from = b.messages.length;
  assert.equal((await a.host({ type: 'avatar-overlay-open', isOpen: false })).responseType, 'success');
  assert.equal((await b.until(item => item.type === 'workbench-pet-state', from)).state.isOpen, true);
  const path = join(root, 'data', 'native-state.json'), opened = await readFile(path, 'utf8');
  from = a.messages.length;
  assert.equal((await a.host({ type: 'avatar-overlay-open', isOpen: false })).responseType, 'success');
  assert.equal((await a.until(item => item.type === 'workbench-pet-state', from)).state.isOpen, true);
  assert.equal(await readFile(path, 'utf8'), opened, 'stale toggle must not write');

  for (const message of [{ type: 'avatar-overlay-open' }, { type: 'avatar-overlay-open', isOpen: 'false' },
    { type: 'avatar-overlay-close', extra: true }, { type: 'workbench-pet-position', position: { x: 2, y: 0 } },
    { type: 'workbench-pet-position', position: { x: 0, y: 0, extra: true } }, { type: 'fetch' }, null]) {
    assert.equal((await a.host(message)).responseType, 'error');
  }
  assert.equal(await readFile(path, 'utf8'), opened);

  from = b.messages.length;
  a.send({ type: 'workbench-pet-position', position: { x: 0.2, y: 0.8 } });
  assert.deepEqual((await b.until(item => item.type === 'workbench-pet-state' && item.state.position !== null, from)).state.position, { x: 0.2, y: 0.8 });
  failCommit = true; blockRecovery = true;
  from = a.messages.length;
  const failed = await a.host({ type: 'avatar-overlay-close' });
  assert.equal(failed.responseType, 'error'); assert.equal(failed.uncertain, true);
  assert.equal((await a.until(item => item.type === 'workbench-pet-error', from)).stateUnconfirmed, true);
  from = b.messages.length;
  const blocked = await b.host({ type: 'avatar-overlay-open-state-request' });
  assert.equal(blocked.responseType, 'error'); assert.equal(blocked.uncertain, true);
  assert.equal((await b.until(item => item.type === 'workbench-pet-error', from)).stateUnconfirmed, true);
  blockRecovery = false;
  from = b.messages.length;
  assert.equal((await b.host({ type: 'avatar-overlay-open-state-request' })).responseType, 'success');
  assert.equal((await b.until(item => item.type === 'workbench-pet-state' && item.state.isOpen === false, from)).state.isOpen, false);
  assert.equal(fake.calls('turn/start').length, 0);
});
