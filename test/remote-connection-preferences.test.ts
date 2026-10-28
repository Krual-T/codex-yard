import assert from 'node:assert/strict';
import test from 'node:test';
import { createRemoteConnectionPreferences } from '../src/native/remote-connection-preferences.ts';
import { createPreferenceWrites } from '../src/native/preference-writes.ts';
import { createStateMutations } from '../src/native/state-mutations.ts';
import type { SshHost } from '../src/native/ssh.ts';

const host: SshHost = { hostId: 'remote-ssh-fixture', displayName: 'Fixture', sshHost: 'fixture', sshAlias: 'fixture', sshPort: null, identity: null };
const key = 'remote-connection-auto-connect-by-host-id';

test('remote views wait for a pending native write and never publish its rolled-back value', async () => {
  const globals: Record<string, unknown> = {}, mutations = createStateMutations(), events: unknown[] = [];
  let rejectWrite: (cause: Error) => void = () => {};
  const preferences = createRemoteConnectionPreferences([host], globals, mutations,
    () => new Promise<void>((_resolve, reject) => { rejectWrite = reject; }), event => events.push(event));
  const failed = assert.rejects(preferences.setAutoConnect(host.hostId, true), /disk full/);
  let readFinished = false;
  const view = preferences.read().then(result => { readFinished = true; return result; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(readFinished, false); assert.deepEqual(events, []);
  rejectWrite(new Error('disk full')); await failed;
  assert.equal((await view)[0]!.autoConnect, false);
  assert.equal(Object.hasOwn(globals, key), false); assert.deepEqual(events, []);
});

test('remote views and notifications contain detached committed snapshots', async () => {
  const globals: Record<string, unknown> = { [key]: { unknownHost: 'retain' } }, mutations = createStateMutations();
  const events: { value: { autoConnect: boolean }[] }[] = [];
  let finishWrite: () => void = () => {};
  const preferences = createRemoteConnectionPreferences([host], globals, mutations,
    () => new Promise<void>(resolve => { finishWrite = resolve; }), event => events.push(event as typeof events[number]));
  const write = preferences.setAutoConnect(host.hostId, true);
  const read = preferences.read();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(events.length, 0);
  finishWrite(); await write;
  const view = await read;
  assert.equal(view[0]!.autoConnect, true); assert.equal(events[0]!.value[0]!.autoConnect, true);
  (globals[key] as Record<string, unknown>)[host.hostId] = false;
  view[0]!.autoConnect = false;
  assert.equal(events[0]!.value[0]!.autoConnect, true);
  assert.equal((globals[key] as Record<string, unknown>).unknownHost, 'retain');
});

test('remote reads share the commit interval of other native preference writes', async () => {
  const globals: Record<string, unknown> = {}, settings: Record<string, unknown> = {}, mutations = createStateMutations();
  let rejectWrite: (cause: Error) => void = () => {};
  const persist = () => new Promise<void>((_resolve, reject) => { rejectWrite = reject; });
  const write = createPreferenceWrites(settings, globals, persist, () => {}, () => {}, mutations);
  const remote = createRemoteConnectionPreferences([host], globals, mutations, persist, () => {});
  const failed = assert.rejects(write('global', key, { [host.hostId]: true }), /disk full/);
  const view = remote.read();
  await new Promise(resolve => setImmediate(resolve));
  rejectWrite(new Error('disk full')); await failed;
  assert.equal((await view)[0]!.autoConnect, false);
});
