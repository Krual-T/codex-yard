import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WorkbenchClient } from '../src/renderer/workbench-contract.ts';
import { SettingsConfigOperations, SettingsWriteError } from '../src/renderer/settings/config-operations.ts';
import type { SettingsWriteRecord, SettingsWriteStorage, WriteReceipt, WriteStatus, WriteTerminal } from '../src/renderer/settings/config-operations.ts';
import { fixtureSource } from './renderer-settings-sections-config-fixture.ts';

class Storage implements SettingsWriteStorage {
  value: unknown;
  failNext = false;
  listeners = new Set<() => void>();
  async read() { return structuredClone(this.value); }
  async update(change: (value: unknown) => unknown) {
    if (this.failNext) { this.failNext = false; throw new Error('fixture storage failure'); }
    this.value = structuredClone(change(structuredClone(this.value)));
    for (const listener of this.listeners) listener();
    return structuredClone(this.value);
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  get list() { return (Array.isArray(this.value) ? this.value : (this.value as { operations?: SettingsWriteRecord[] } | undefined)?.operations ?? []) as SettingsWriteRecord[]; }
}
const origin = { section: 'models' as const, source: fixtureSource(), draft: { model: 'beta' } };
const params = { edits: [{ keyPath: 'model', value: 'beta' }] };
type Handler = (input: Record<string, unknown>) => Promise<unknown>;
function fixture(handler: Handler) {
  const store = new Storage(), calls: Record<string, unknown>[] = [];
  let nextId = 0;
  const client: WorkbenchClient = {
    subscribe: () => () => {}, reply: async () => { throw new Error('Unexpected approval'); },
    rpc: async () => { throw new Error('Unexpected direct RPC'); },
    host: async <T>(endpoint: string, input?: Record<string, unknown>) => {
      assert.equal(endpoint, 'configuration-write'); assert.ok(input);
      calls.push(structuredClone(input)); return await handler(input) as T;
    },
  };
  return { store, calls, make: () => new SettingsConfigOperations(client, store, () => `operation-${++nextId}`) };
}
function receipt(id: string, hostId: string, method: WriteReceipt['method'], terminal: WriteTerminal): WriteReceipt {
  return { operationId: id, hostId, method, terminal, signature: 'fixture-signature' };
}
function observed(input: Record<string, unknown>, terminal: WriteTerminal): WriteStatus {
  const operationId = String(input.operationId), hostId = String(input.hostId), method = input.method as WriteReceipt['method'];
  return { operationId, hostId, method, state: 'pending', storageError: true, observedTerminal: terminal,
    recoveryReceipt: receipt(operationId, hostId, method, terminal) };
}
const succeeded = (r: WriteReceipt): WriteStatus => ({ operationId: r.operationId, hostId: r.hostId, method: r.method, state: 'succeeded', terminal: r.terminal });

test('interrupted preparation stays fenced until the original host persists not-sent', async () => {
  const f = fixture(async input => {
    const base = { operationId: input.operationId, hostId: input.hostId, method: 'config/batchWrite' };
    if (input.action === 'submit') return { outcome: 'existing', operation: { ...base, state: 'preparing' } };
    if (input.action === 'status') return { operation: { ...base, state: 'preparing', interrupted: true } };
    return { operation: { ...base, state: 'failed', terminal: { kind: 'not-sent' } } };
  });
  const ops = f.make();
  await assert.rejects(ops.submit('removed-host', 'config/batchWrite', params, { ...origin, source: fixtureSource('removed-host') }), /unknown result/);
  assert.equal(f.store.list[0]?.operation?.state, 'preparing');
  await ops.check('operation-1');
  assert.equal(f.store.list[0]?.operation?.interrupted, true);
  await assert.rejects(ops.submit('local', 'config/batchWrite', params, origin), /earlier configuration save/);
  await ops.check('operation-1', true);
  assert.equal(f.store.list[0]?.phase, 'finished');
  assert.deepEqual(f.store.list[0]?.operation?.terminal, { kind: 'not-sent' });
  assert.deepEqual(f.calls.map(call => [call.action, call.hostId, call.operationId]), [
    ['submit', 'removed-host', 'operation-1'], ['status', 'removed-host', 'operation-1'], ['retry-persistence', 'removed-host', 'operation-1'],
  ]);
});

test('signed original receipt survives reload and a removed host, and only retries host persistence', async () => {
  let signed: WriteReceipt | undefined;
  const f = fixture(async input => {
    if (input.action === 'submit') {
      const operation = observed(input, { kind: 'okOverridden' }); signed = operation.recoveryReceipt;
      return { outcome: 'success', operation, result: { status: 'okOverridden' } };
    }
    if (input.action === 'status') return { operation: null };
    assert.deepEqual(input.receipt, signed);
    return { operation: succeeded(signed!) };
  });
  await assert.rejects(f.make().submit('ssh-removed', 'config/batchWrite', params, { ...origin, source: fixtureSource('ssh-removed') }), /host.*receipt/i);
  assert.deepEqual(f.store.list[0]?.recoveryReceipt, signed);
  assert.deepEqual(f.store.list[0]?.result, { status: 'okOverridden' });
  const resumed = f.make(); await resumed.check('operation-1');
  assert.equal(f.store.list[0]?.phase, 'unknown');
  assert.deepEqual(f.store.list[0]?.recoveryReceipt, signed);
  await resumed.check('operation-1', true);
  assert.equal(f.store.list[0]?.phase, 'finished');
  assert.deepEqual(f.store.list[0]?.operation?.terminal, { kind: 'okOverridden' });
  assert.deepEqual(f.calls.map(call => call.action), ['submit', 'status', 'retry-persistence']);
  assert.equal(f.calls[2]?.hostId, 'ssh-removed');
});

test('browser receipt failure cannot be replaced by later status before explicit local retry', async () => {
  let signed: WriteReceipt | undefined;
  const f = fixture(async input => {
    if (input.action === 'submit') {
      const operation = observed(input, { kind: 'effectiveEnabled', value: false }); signed = operation.recoveryReceipt;
      f.store.failNext = true;
      return { outcome: 'success', operation, result: { effectiveEnabled: false } };
    }
    assert.deepEqual(input.receipt, signed);
    return { operation: succeeded(signed!) };
  });
  const ops = f.make();
  await assert.rejects(ops.submit('ssh-removed', 'skills/config/write', { path: '/fixture', enabled: false },
    { section: 'skills-settings', source: fixtureSource('ssh-removed'), scope: ['/fixture'], draft: [{ enabled: false }] }), /browser.*receipt/i);
  assert.deepEqual(ops.getSnapshot().localRetry, ['operation-1']);
  await assert.rejects(ops.check('operation-1'), /browser receipt/);
  await assert.rejects(ops.check('operation-1', true), /browser receipt/);
  assert.equal(f.calls.length, 1);
  await ops.retryLocal('operation-1');
  assert.deepEqual(f.store.list[0]?.recoveryReceipt, signed);
  await f.make().check('operation-1', true);
  assert.deepEqual(f.store.list[0]?.operation?.terminal, { kind: 'effectiveEnabled', value: false });
  assert.equal(f.calls.filter(call => call.action === 'submit').length, 1);
});

test('a concurrent old status cannot discard a receipt whose browser transaction failed', async () => {
  let release = () => {}, entered = () => {}, checks = 0;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  let signed: WriteReceipt | undefined;
  const f = fixture(async input => {
    if (input.action === 'submit') throw new Error('lost reply');
    if (++checks === 1) { entered(); await gate; return { operation: null }; }
    const operation = observed({ ...input, method: 'config/batchWrite' }, { kind: 'ok' });
    signed = operation.recoveryReceipt; f.store.failNext = true;
    return { operation };
  });
  const ops = f.make();
  await assert.rejects(ops.submit('local', 'config/batchWrite', params, origin), /lost reply/);
  const oldStatus = ops.check('operation-1'); await waiting;
  await assert.rejects(ops.check('operation-1'), /browser.*receipt/i);
  release(); await assert.rejects(oldStatus, /browser receipt/);
  assert.deepEqual(ops.getSnapshot().localRetry, ['operation-1']);
  await ops.retryLocal('operation-1');
  assert.deepEqual(f.store.list[0]?.recoveryReceipt, signed);
  assert.equal(f.store.list[0]?.phase, 'unknown');
  assert.equal(f.calls.filter(call => call.action === 'submit').length, 1);
});

test('mismatched identity or terminal cannot turn an unverified receipt into a terminal', async () => {
  for (const invalid of ['id', 'host', 'method', 'terminal', 'signature'] as const) {
    const f = fixture(async input => {
      const operation = observed(input, { kind: 'ok' });
      if (invalid === 'id') operation.recoveryReceipt!.operationId = 'another';
      if (invalid === 'host') operation.recoveryReceipt!.hostId = 'another';
      if (invalid === 'method') operation.recoveryReceipt!.method = 'skills/config/write';
      if (invalid === 'terminal') operation.recoveryReceipt!.terminal = { kind: 'okOverridden' };
      if (invalid === 'signature') operation.recoveryReceipt!.signature = '';
      return { outcome: 'success', operation, result: { status: 'ok' } };
    });
    const ops = f.make();
    await assert.rejects(ops.submit('local', 'config/batchWrite', params, origin), /unknown result/);
    assert.equal(f.store.list[0]?.phase, 'unknown', invalid);
    assert.equal(f.store.list[0]?.recoveryReceipt, undefined, invalid);
    await assert.rejects(ops.submit('local', 'config/batchWrite', params, origin), /earlier configuration save/);
    assert.equal(f.calls.length, 1);
  }
});

test('a terminal with no original method cannot release the write fence', async () => {
  const f = fixture(async input => {
    if (input.action === 'submit') throw new Error('lost reply');
    return { operation: { operationId: input.operationId, hostId: input.hostId, state: 'failed', terminal: { kind: 'rejected' } } };
  });
  const ops = f.make();
  await assert.rejects(ops.submit('local', 'config/batchWrite', params, origin), /lost reply/);
  await ops.check('operation-1');
  assert.equal(f.store.list[0]?.phase, 'unknown');
  await assert.rejects(ops.submit('local', 'config/batchWrite', params, origin), /earlier configuration save/);
  assert.equal(f.calls.filter(call => call.action === 'submit').length, 1);
});

test('a persisted receipt rejects a conflicting terminal and does not release the fence', async () => {
  const f = fixture(async input => {
    if (input.action === 'submit') return { outcome: 'success', operation: observed(input, { kind: 'ok' }), result: { status: 'ok' } };
    return { operation: { operationId: input.operationId, hostId: input.hostId, method: 'config/batchWrite', state: 'succeeded', terminal: { kind: 'okOverridden' } } };
  });
  const ops = f.make();
  await assert.rejects(ops.submit('local', 'config/batchWrite', params, origin), /host.*receipt/i);
  await assert.rejects(ops.check('operation-1'), /does not match/);
  assert.equal(f.store.list[0]?.phase, 'unknown');
  assert.deepEqual(f.store.list[0]?.recoveryReceipt?.terminal, { kind: 'ok' });
  assert.equal(ops.getSnapshot().localRetry.length, 0);
  f.store.list[0]!.phase = 'finished';
  f.store.list[0]!.operation = { operationId: 'operation-1', hostId: 'local', method: 'config/batchWrite', state: 'succeeded', terminal: { kind: 'okOverridden' } };
  await assert.rejects(ops.submit('local', 'config/batchWrite', params, origin), /terminal does not match/);
});

test('a successful response with a result different from its observed terminal is not saved as fact', async () => {
  const f = fixture(async input => {
    if (input.action === 'submit') return { outcome: 'success', operation: observed(input, { kind: 'ok' }), result: { status: 'okOverridden' } };
    return { operation: { operationId: input.operationId, hostId: input.hostId, method: 'config/batchWrite', state: 'succeeded', terminal: { kind: 'ok' } } };
  });
  const ops = f.make();
  await assert.rejects(ops.submit('local', 'config/batchWrite', params, origin), /host.*receipt/i);
  assert.equal(f.store.list[0]?.phase, 'unknown');
  assert.equal(f.store.list[0]?.result, undefined);
  await ops.check('operation-1', true);
  assert.equal(f.store.list[0]?.phase, 'finished');
  assert.deepEqual(f.store.list[0]?.operation?.terminal, { kind: 'ok' });
  assert.equal(f.calls.filter(call => call.action === 'submit').length, 1);
});

test('blocking operation receipt is stored and retried under its own original host and ID', async () => {
  const blocker = observed({ operationId: 'blocker', hostId: 'removed-host', method: 'skills/config/write' }, { kind: 'effectiveEnabled', value: true });
  const f = fixture(async input => {
    if (input.action === 'submit') return { outcome: 'blocked', operation: blocker };
    assert.equal(input.hostId, 'removed-host'); assert.equal(input.operationId, 'blocker');
    assert.deepEqual(input.receipt, blocker.recoveryReceipt);
    return { operation: succeeded(blocker.recoveryReceipt!) };
  });
  const ops = f.make();
  await assert.rejects(ops.submit('local', 'config/batchWrite', params, origin), /blocking operation/);
  assert.deepEqual(f.store.list[0]?.blockerReceipt, blocker.recoveryReceipt);
  await f.make().check('operation-1', true);
  assert.equal(f.store.list[0]?.phase, 'not-started');
  assert.equal(f.calls.filter(call => call.action === 'submit').length, 1);
});

test('safe terminal categories give actionable errors and preserve the original draft', async () => {
  for (const [category, expected] of [
    ['configVersionConflict', /changed.*Reload/], ['configValidationError', /invalid.*Review/], ['configLayerReadonly', /read-only.*writable/],
    [undefined, /rejected.*Review/],
  ] as const) {
    const f = fixture(async input => ({ outcome: 'error', error: { message: 'untrusted fixture detail', uncertain: false },
      operation: { operationId: input.operationId, hostId: input.hostId, method: input.method, state: 'failed',
        terminal: { kind: 'rejected', ...(category ? { category } : {}) } } }));
    const ops = f.make();
    await assert.rejects(ops.submit('local', 'config/batchWrite', params, origin), (error: unknown) =>
      error instanceof SettingsWriteError && !error.uncertain && expected.test(error.message) && !error.message.includes('untrusted'));
    assert.deepEqual(f.store.list[0]?.origin.draft, origin.draft);
    assert.equal(f.store.list[0]?.phase, 'finished');
  }
});

test('late status cannot overwrite a new submission from another page', async () => {
  let release = () => {}, entered = () => {};
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  let checks = 0;
  const f = fixture(async input => {
    if (input.action === 'submit') throw new Error('lost reply');
    if (++checks === 1) { entered(); await gate; return { operation: { operationId: 'operation-1', hostId: 'local', method: 'config/batchWrite', state: 'pending' } }; }
    return { operation: { operationId: 'operation-1', hostId: 'local', method: 'config/batchWrite', state: 'failed', terminal: { kind: 'rejected' } } };
  });
  const first = f.make(), second = f.make();
  await assert.rejects(first.submit('local', 'config/batchWrite', params, origin), /lost reply/);
  const late = first.check('operation-1'); await waiting;
  await second.check('operation-1');
  await assert.rejects(second.submit('local', 'config/batchWrite', { edits: ['new'] }, { section: 'models', source: fixtureSource(), draft: { model: 'new' } }), /lost reply/);
  release(); await late;
  assert.equal(f.store.list[0]?.phase, 'finished');
  assert.equal(f.store.list[1]?.operationId, 'operation-2');
  assert.equal(f.store.list[1]?.phase, 'unknown');
  assert.deepEqual(f.store.list[1]?.origin.draft, { model: 'new' });
});

test('late status cannot recreate a closed original after another page starts a new operation', async () => {
  let release = () => {}, entered = () => {}, checks = 0;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const f = fixture(async input => {
    if (input.action === 'submit') throw new Error('lost reply');
    if (++checks === 1) { entered(); await gate; return { operation: { operationId: 'operation-1', hostId: 'local', method: 'config/batchWrite', state: 'pending' } }; }
    return { operation: { operationId: 'operation-1', hostId: 'local', method: 'config/batchWrite', state: 'failed', terminal: { kind: 'rejected' } } };
  });
  const first = f.make(), second = f.make();
  await assert.rejects(first.submit('local', 'config/batchWrite', params, origin), /lost reply/);
  const late = first.check('operation-1'); await waiting;
  await second.check('operation-1'); await second.finish('operation-1');
  await assert.rejects(second.submit('local', 'config/batchWrite', { edits: ['new'] }, { section: 'models', source: fixtureSource(), draft: { model: 'new' } }), /lost reply/);
  release(); await assert.rejects(late, /already closed/);
  assert.equal(f.store.list.length, 1);
  assert.equal(f.store.list[0]?.operationId, 'operation-2');
  assert.equal(f.store.list[0]?.phase, 'unknown');
  assert.deepEqual(f.store.list[0]?.origin.draft, { model: 'new' });
});

test('late observed result cannot contradict an already confirmed terminal', async () => {
  let release = () => {}, entered = () => {};
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const f = fixture(async input => {
    if (input.action === 'submit') {
      entered(); await gate;
      return { outcome: 'success', operation: observed(input, { kind: 'okOverridden' }), result: { status: 'okOverridden' } };
    }
    return { operation: { operationId: input.operationId, hostId: input.hostId, method: 'config/batchWrite', state: 'succeeded', terminal: { kind: 'ok' } } };
  });
  const first = f.make(), second = f.make();
  const saving = first.submit('local', 'config/batchWrite', params, origin); await waiting;
  await second.check('operation-1');
  release(); await assert.rejects(saving, /conflicting terminal/);
  assert.equal(f.store.list[0]?.phase, 'finished');
  assert.deepEqual(f.store.list[0]?.operation?.terminal, { kind: 'ok' });
  assert.equal(f.store.list[0]?.result, undefined);
  assert.equal(f.calls.filter(call => call.action === 'submit').length, 1);
});
