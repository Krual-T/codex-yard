import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WorkbenchClient } from '../src/renderer/workbench-contract.ts';
import { SettingsConfigOperations, SettingsWriteError } from '../src/renderer/settings/config-operations.ts';
import type { SettingsWriteRecord, SettingsWriteStorage, WriteStatus } from '../src/renderer/settings/config-operations.ts';
import { fixtureSource } from './renderer-settings-sections-config-fixture.ts';

class Storage implements SettingsWriteStorage {
  value: unknown;
  fail = false;
  listeners = new Set<() => void>();
  async read() { return structuredClone(this.value); }
  async update(change: (value: unknown) => unknown) {
    if (this.fail) throw new Error('fixture storage failure');
    this.value = structuredClone(change(structuredClone(this.value)));
    for (const listener of this.listeners) listener();
    return structuredClone(this.value);
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  get list() { return (Array.isArray(this.value) ? this.value : (this.value as { operations?: SettingsWriteRecord[] } | undefined)?.operations ?? []) as SettingsWriteRecord[]; }
  get drafts() { return (this.value as { drafts?: { editorId: string; draft: unknown }[] } | undefined)?.drafts ?? []; }
}
function fixture() {
  const store = new Storage(), calls: Record<string, unknown>[] = [], operations = new Map<string, WriteStatus>();
  let sequence = 0, behavior: 'success' | 'lost' | 'storage-error' | 'rejected' | 'blocked' | 'not-started' = 'success';
  const client: WorkbenchClient = {
    subscribe: () => () => {}, reply: async () => { throw new Error('Unexpected approval'); },
    rpc: async () => { throw new Error('Unexpected direct RPC'); },
    host: async <T>(endpoint: string, params?: Record<string, unknown>) => {
      assert.equal(endpoint, 'configuration-write'); assert.ok(params); calls.push(structuredClone(params));
      const id = String(params.operationId), hostId = String(params.hostId);
      if (params.action === 'status' || params.action === 'retry-persistence') {
        const operation = operations.get(id) ?? null;
        if (params.action === 'retry-persistence' && operation?.storageError) {
          const next = { ...operation, state: 'succeeded' as const, terminal: operation.observedTerminal, storageError: undefined, observedTerminal: undefined };
          operations.set(id, next); return { operation: next } as T;
        }
        return { operation } as T;
      }
      assert.equal(params.action, 'submit');
      assert.ok(store.list.some(item => item.operationId === id), 'ID must be persisted before submit');
      if (behavior === 'not-started') return { outcome: 'not-started', error: { message: 'not sent', uncertain: false } } as T;
      if (behavior === 'blocked') return { outcome: 'blocked', operation: { operationId: 'other', hostId, method: params.method, state: 'unknown' } } as T;
      const method = params.method as WriteStatus['method'];
      const terminal = method === 'skills/config/write' ? { kind: 'effectiveEnabled' as const, value: false } : { kind: 'okOverridden' as const };
      const operation: WriteStatus = behavior === 'rejected' ? { operationId: id, hostId, method, state: 'failed', terminal: { kind: 'rejected', code: -32000 } }
        : behavior === 'storage-error' ? { operationId: id, hostId, method, state: 'pending', storageError: true, observedTerminal: terminal }
        : { operationId: id, hostId, method, state: 'succeeded', terminal };
      operations.set(id, operation);
      if (behavior === 'lost') throw new Error('reply lost');
      if (behavior === 'rejected') return { outcome: 'error', operation, error: { message: 'rejected', uncertain: false } } as T;
      return { outcome: 'success', operation, result: method === 'skills/config/write' ? { effectiveEnabled: false }
        : { status: 'okOverridden', overriddenMetadata: { message: 'policy' } } } as T;
    },
  };
  const make = () => new SettingsConfigOperations(client, store, () => `fixture-${++sequence}`);
  return { store, calls, operations, make, behavior(value: typeof behavior) { behavior = value; } };
}
const origin = { section: 'models' as const, source: fixtureSource(), draft: { model: 'beta' } };
const params = { edits: [{ keyPath: 'model', value: 'beta' }] };

test('lost reply survives reload and only checks the original ID', async () => {
  const f = fixture(), first = f.make(); f.behavior('lost');
  await assert.rejects(first.submit('local', 'config/batchWrite', params, origin), (error: unknown) => error instanceof SettingsWriteError && error.uncertain);
  assert.equal(f.store.list[0]?.phase, 'unknown');
  const resumed = f.make();
  assert.equal((await resumed.find('local', 'models'))?.operationId, 'fixture-1');
  f.operations.delete('fixture-1'); await resumed.check('fixture-1');
  assert.equal(f.store.list[0]?.phase, 'unknown');
  await assert.rejects(resumed.submit('local', 'config/batchWrite', params, origin), /earlier configuration save/);
  f.operations.set('fixture-1', { operationId: 'fixture-1', hostId: 'local', method: 'config/batchWrite', state: 'succeeded', terminal: { kind: 'ok' } });
  await resumed.check('fixture-1');
  assert.equal(f.store.list[0]?.phase, 'finished');
  assert.equal(f.calls.filter(call => call.action === 'submit').length, 1);
  assert.ok(f.calls.filter(call => call.action === 'status').every(call => call.operationId === 'fixture-1'));
});

test('the submitted parameters and origin are immutable and preserve the original result', async () => {
  const f = fixture(), ops = f.make(), draft = { model: 'beta' }, submitted = { edits: [{ keyPath: 'model', value: 'beta' }] };
  const saving = ops.submit('local', 'config/batchWrite', submitted, { section: 'models', source: fixtureSource(), draft });
  submitted.edits[0]!.value = 'newer'; draft.model = 'newer';
  const result = await saving;
  assert.deepEqual(f.store.list[0]?.params, params);
  assert.deepEqual(f.store.list[0]?.origin.draft, { model: 'beta' });
  assert.deepEqual(result.result, { status: 'okOverridden', overriddenMetadata: { message: 'policy' } });
  assert.deepEqual(f.store.list[0]?.result, result.result);
});

test('host receipt persistence retry does not resend and retains the observed result', async () => {
  const f = fixture(), ops = f.make(); f.behavior('storage-error');
  await assert.rejects(ops.submit('local', 'skills/config/write', { path: '/fixture', enabled: false }, { section: 'skills-settings', source: fixtureSource(), scope: ['/project'], draft: [] }), /host.*receipt/i);
  assert.equal(f.store.list[0]?.phase, 'unknown');
  assert.deepEqual(f.store.list[0]?.result, { effectiveEnabled: false });
  await assert.rejects(ops.finish('fixture-1'), /not ready/);
  await ops.check('fixture-1', true);
  assert.equal(f.store.list[0]?.phase, 'finished');
  assert.deepEqual(f.store.list[0]?.operation?.terminal, { kind: 'effectiveEnabled', value: false });
  assert.deepEqual(f.calls.map(call => call.action), ['submit', 'retry-persistence']);
});

test('not-started, rejection, and a separate blocker remain distinct', async () => {
  const f = fixture(), ops = f.make(); f.behavior('not-started');
  await assert.rejects(ops.submit('local', 'config/batchWrite', params, origin), /not sent/);
  assert.equal(f.store.list[0]?.phase, 'not-started');
  f.behavior('rejected');
  await assert.rejects(ops.submit('local', 'config/batchWrite', params, origin), /rejected/);
  assert.deepEqual(f.store.list[1]?.operation?.terminal, { kind: 'rejected', code: -32000 });
  f.behavior('blocked');
  await assert.rejects(ops.submit('local', 'config/batchWrite', params, origin), /blocking operation/);
  assert.equal(f.store.list[2]?.blocker?.operationId, 'other');
  await ops.check('fixture-3');
  assert.equal(f.store.list[2]?.phase, 'blocked');
  f.operations.set('other', { operationId: 'other', hostId: 'local', method: 'config/batchWrite', state: 'failed', terminal: { kind: 'rejected' } });
  await ops.check('fixture-3');
  assert.equal(f.store.list[2]?.phase, 'not-started');
  assert.equal(f.calls.filter(call => call.action === 'submit').length, 3);
});

test('storage failure prevents submit, and receipt failure remains retryable locally', async () => {
  const f = fixture(), ops = f.make(); f.store.fail = true;
  await assert.rejects(ops.submit('local', 'config/batchWrite', params, origin), /storage failure/);
  assert.equal(f.calls.length, 0);
  f.store.fail = false;
  const original = f.store.update.bind(f.store);
  let writes = 0;
  f.store.update = async change => { if (++writes === 2) throw new Error('receipt failure'); return original(change); };
  await assert.rejects(ops.submit('local', 'config/batchWrite', params, origin), /browser.*receipt/i);
  assert.equal(f.store.list[0]?.phase, 'pending');
  assert.deepEqual(ops.getSnapshot().localRetry, ['fixture-2']);
  await assert.rejects(ops.dismissClosedLocal('fixture-2'), /still present/);
  f.store.value = [{ operationId: 'fixture-3', hostId: 'local', method: 'config/batchWrite',
    params: { edits: ['newer'] }, origin, phase: 'unknown' }];
  await assert.rejects(ops.retryLocal('fixture-2'), /already closed/);
  assert.deepEqual(f.store.list.map(item => item.operationId), ['fixture-3']);
  await ops.dismissClosedLocal('fixture-2');
  assert.deepEqual(ops.getSnapshot().localRetry, []);
  assert.deepEqual(f.store.list.map(item => item.operationId), ['fixture-3']);
  assert.equal(f.calls.length, 1);
});

test('a suspended source never dispatches and its original scope is retained', async () => {
  const f = fixture(), ops = f.make();
  await assert.rejects(ops.submit('ssh:one', 'skills/config/write', { path: '/project/a', enabled: false },
    { section: 'skills-settings', source: fixtureSource('ssh:one'), scope: ['/project'], draft: [{ id: 'a', enabled: false }] }, () => false), /interrupted/);
  assert.equal(f.calls.length, 0);
  assert.equal((await ops.find('ssh:one', 'skills-settings', ['/other'])), null);
  assert.deepEqual((await ops.find('ssh:one', 'skills-settings', ['/project']))?.origin.draft, [{ id: 'a', enabled: false }]);
});

test('a failed newer-draft write stays retryable even after the saved copy is removed elsewhere', async () => {
  const f = fixture(), ops = f.make(); f.behavior('lost');
  await assert.rejects(ops.submit('local', 'config/batchWrite', params, origin), /reply lost/);
  f.store.fail = true;
  await assert.rejects(ops.saveDraft('local', 'models', undefined, 'editor', { model: 'newer' }), /storage failure/);
  assert.deepEqual(ops.getSnapshot().draftRetry, ['editor']);
  f.store.fail = false; f.store.value = [];
  await ops.retryDraft('editor');
  assert.equal(f.store.list.length, 0);
  assert.deepEqual(f.store.drafts[0]?.draft, { model: 'newer' });
  assert.deepEqual(ops.getSnapshot().draftRetry, []);
  assert.equal(f.calls.filter(call => call.action === 'submit').length, 1);
});

test('an in-flight newer draft prevents local receipt closure until its browser transaction finishes', async () => {
  const f = fixture(), ops = f.make();
  await ops.submit('local', 'config/batchWrite', params, origin);
  let release = () => {}, entered = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const original = f.store.update.bind(f.store);
  let first = true;
  f.store.update = async change => { if (first) { first = false; entered(); await gate; } return original(change); };
  const saving = ops.saveDraft('local', 'models', undefined, 'editor', { model: 'newer' });
  await waiting;
  assert.equal(ops.getSnapshot().draftPending, 1);
  await assert.rejects(ops.finish('fixture-1'), /not ready/);
  release(); await saving;
  assert.equal(ops.getSnapshot().draftPending, 0);
  assert.deepEqual(f.store.drafts[0]?.draft, { model: 'newer' });
});

test('an incomplete not-started response does not prove that the original write was unsent', async () => {
  const store = new Storage(), calls: Record<string, unknown>[] = [];
  const client: WorkbenchClient = {
    subscribe: () => () => {}, reply: async () => {}, rpc: async () => { throw new Error('Unexpected direct RPC'); },
    host: async <T>(_endpoint: string, input?: Record<string, unknown>) => {
      assert.ok(input); calls.push(input); return { outcome: 'not-started' } as T;
    },
  };
  const ops = new SettingsConfigOperations(client, store, () => 'original');
  await assert.rejects(ops.submit('local', 'config/batchWrite', params, origin), (error: unknown) => error instanceof SettingsWriteError && error.uncertain);
  assert.equal(store.list[0]?.phase, 'unknown');
  await assert.rejects(ops.submit('local', 'config/batchWrite', params, origin), /earlier configuration save/);
  assert.equal(calls.length, 1);
});

test('a damaged local terminal cannot release the configuration fence', async () => {
  const f = fixture(), ops = f.make(); f.behavior('lost');
  await assert.rejects(ops.submit('local', 'config/batchWrite', params, origin), /reply lost/);
  f.store.list[0]!.phase = 'finished';
  await assert.rejects(ops.submit('local', 'config/batchWrite', params, origin), /receipt cannot be verified/);
  assert.equal(f.calls.filter(call => call.action === 'submit').length, 1);
});

test('a late pending status cannot replace a confirmed original terminal', async () => {
  const store = new Storage(); let checks = 0, release = () => {}, entered = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const client: WorkbenchClient = {
    subscribe: () => () => {}, reply: async () => {}, rpc: async () => { throw new Error('Unexpected direct RPC'); },
    host: async <T>(_endpoint: string, input?: Record<string, unknown>) => {
      if (input?.action === 'submit') throw new Error('reply lost');
      const operation = { operationId: 'original', hostId: 'local', method: 'config/batchWrite' };
      if (++checks === 1) { entered(); await gate; return { operation: { ...operation, state: 'pending' } } as T; }
      return { operation: { ...operation, state: 'succeeded', terminal: { kind: 'ok' } } } as T;
    },
  };
  const ops = new SettingsConfigOperations(client, store, () => 'original');
  await assert.rejects(ops.submit('local', 'config/batchWrite', params, origin), /reply lost/);
  const first = ops.check('original'); await waiting;
  await ops.check('original'); release(); await first;
  assert.equal(store.list[0]?.phase, 'finished');
  assert.deepEqual(store.list[0]?.operation?.terminal, { kind: 'ok' });
});
