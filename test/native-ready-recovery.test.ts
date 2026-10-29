import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import WebSocket from 'ws';
import { createNativeWorkbench } from '../src/native/server.ts';
import { createFakeCodex } from './fake-codex.ts';
import { nativeFixture } from './native-fixture.ts';

type Message = Record<string, any>;

async function connect(url: string) {
  const socket = new WebSocket(url.replace('http', 'ws') + '/native-host', { origin: url });
  const messages: Message[] = [];
  socket.on('message', bytes => { messages.push(JSON.parse(String(bytes))); socket.emit('received'); });
  await once(socket, 'open');
  async function until(predicate: (message: Message) => boolean, from = 0) {
    const signal = AbortSignal.timeout(5000);
    while (!messages.slice(from).some(predicate)) await once(socket, 'received', { signal });
    return messages.slice(from).find(predicate)!;
  }
  let sequence = 0;
  const send = (message: unknown) => socket.send(JSON.stringify(message));
  async function host(endpoint: string, body: unknown) {
    const requestId = 'ready-' + ++sequence;
    send({ type: 'fetch', requestId, url: 'vscode://codex/' + endpoint, body: JSON.stringify(body) });
    return until(message => message.type === 'fetch-response' && message.requestId === requestId);
  }
  return { socket, messages, send, until, host };
}

test('a page reconnecting during native-state isolation receives invalidation and local initialization', async t => {
  const root = await mkdtemp('/tmp/aw-ready-');
  const fake = await createFakeCodex(root), { renderer, adapterPath } = await nativeFixture(root);
  let failCommit = false, blockRecovery = true;
  const app = await createNativeWorkbench({ port: 0, socketPath: fake.socketPath, codexHome: join(root, 'codex'),
    dataDir: join(root, 'data'), workspace: root, renderer, adapterPath,
    hostCatalog: { hosts: [], projects: [], assignments: {} }, nativeStateCheckpoint(step) {
      if (step === 'directory-sync' && failCommit) { failCommit = false; throw new Error('fixture commit confirmation'); }
      if (step === 'recovery-file-sync' && blockRecovery) throw new Error('fixture recovery blocked');
    } });
  const sockets: WebSocket[] = [];
  t.after(async () => { for (const socket of sockets) socket.terminate(); await app.close(); await fake.close(); await rm(root, { recursive: true, force: true }); });
  const original = await connect(app.url); sockets.push(original.socket);
  original.send({ type: 'ready' });
  await original.until(item => item.type === 'codex-app-server-initialized' && item.hostId === 'local');
  original.socket.close(); await once(original.socket, 'close');

  const writer = await connect(app.url); sockets.push(writer.socket);
  failCommit = true;
  const failed = await writer.host('set-setting', { key: 'composerEnterBehavior', value: 'cmdAlways' });
  assert.equal(failed.responseType, 'error'); assert.equal(failed.uncertain, true);
  const restoredPage = await connect(app.url); sockets.push(restoredPage.socket);
  restoredPage.send({ type: 'ready' });
  await restoredPage.until(item => item.type === 'settings-changed' && !Object.hasOwn(item, 'keys'));
  await restoredPage.until(item => item.type === 'global-state-updated' && !Object.hasOwn(item, 'keys'));
  await restoredPage.until(item => item.type === 'shared-object-updated' && item.key === 'remote_ssh_connections' && !Object.hasOwn(item, 'value'));
  await restoredPage.until(item => item.type === 'workbench-pet-error' && item.stateUnconfirmed === true);
  await restoredPage.until(item => item.type === 'codex-app-server-initialized' && item.hostId === 'local');
  assert.equal(restoredPage.messages.some(item => item.type === 'shared-object-updated' && item.key === 'remote_ssh_connections'
    && Object.hasOwn(item, 'value')), false);
  assert.equal((await restoredPage.host('get-setting', { key: 'composerEnterBehavior' })).responseType, 'error');

  blockRecovery = false;
  const from = restoredPage.messages.length;
  const recovered = await restoredPage.host('get-setting', { key: 'composerEnterBehavior' });
  assert.equal(recovered.responseType, 'success'); assert.equal(recovered.body.value, 'cmdAlways');
  await restoredPage.until(item => item.type === 'shared-object-updated' && item.key === 'remote_ssh_connections' && Array.isArray(item.value), from);
  assert.equal(fake.calls('turn/start').length, 0);
});
