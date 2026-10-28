import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WorkbenchClient } from '../src/renderer/workbench-contract.ts';
import { SettingsConfigOperations, SettingsWriteError } from '../src/renderer/settings/config-operations.ts';
import type { SettingsDraftRecord, SettingsWriteRecord, SettingsWriteStorage } from '../src/renderer/settings/config-operations.ts';
import { fixtureSource } from './renderer-settings-sections-config-fixture.ts';

class Storage implements SettingsWriteStorage {
  value: unknown;
  async read() { return structuredClone(this.value); }
  async update(change: (value: unknown) => unknown) {
    this.value = structuredClone(change(structuredClone(this.value)));
    return structuredClone(this.value);
  }
  subscribe() { return () => {}; }
  get data() { return this.value as { operations: SettingsWriteRecord[]; drafts: SettingsDraftRecord[] }; }
}
const source = fixtureSource();
const params = { edits: [{ keyPath: 'model', value: 'beta' }] };
const clientFor = (handler: (input: Record<string, unknown>) => Promise<unknown>): WorkbenchClient => ({
  subscribe: () => () => {}, reply: async () => {}, rpc: async () => { throw new Error('Unexpected RPC'); },
  host: async <T>(_endpoint: string, input?: Record<string, unknown>) => await handler(input!) as T,
});
const success = (input: Record<string, unknown>) => ({ outcome: 'success', result: { status: 'ok' }, operation: {
  operationId: input.operationId, hostId: input.hostId, method: input.method, state: 'succeeded', terminal: { kind: 'ok' },
} });

test('independent editors survive submit and only the exact successful revision is retired', async () => {
  const storage = new Storage(), calls: Record<string, unknown>[] = [];
  const client = clientFor(async input => { calls.push(input); return success(input); });
  const a = new SettingsConfigOperations(client, storage, () => 'original'), b = new SettingsConfigOperations(client, storage);
  await b.saveDraft('local', 'models', undefined, 'page-b', { model: 'gamma', baseline: 'alpha' });
  const revision = await a.saveDraft('local', 'models', undefined, 'page-a', { model: 'beta', baseline: 'alpha' });
  assert.ok(revision);
  assert.equal(storage.data.operations.length, 0);
  const submitted = await a.submit('local', 'config/batchWrite', params,
    { section: 'models', editorId: 'page-a', revision, source, draft: { model: 'beta' } });
  assert.equal(storage.data.operations[0]?.origin.revision, storage.data.drafts.find(d => d.editorId === 'page-a')?.revision);
  await a.finish(submitted.operationId, { consumeSubmittedDraft: true });
  assert.deepEqual(storage.data.drafts.map(d => d.editorId), ['page-b']);
  assert.deepEqual(calls[0]?.source, source);
  assert.equal(storage.data.operations.length, 0);
});

test('newer revisions and another page survive late completion and a queued draft cannot recreate an operation', async () => {
  const storage = new Storage(), client = clientFor(async input => success(input));
  const a = new SettingsConfigOperations(client, storage, () => 'original'), b = new SettingsConfigOperations(client, storage);
  const revision = await a.saveDraft('local', 'agent', undefined, 'page-a', { approval: 'never' });
  assert.ok(revision);
  await b.saveDraft('local', 'agent', undefined, 'page-b', { sandbox: 'read-only' });
  const submitted = await a.submit('local', 'config/batchWrite', params,
    { section: 'agent', editorId: 'page-a', revision, source, draft: { approval: 'never' } });
  await a.saveDraft('local', 'agent', undefined, 'page-a', { approval: 'on-request' });
  let release = () => {}, entered = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; }), waiting = new Promise<void>(resolve => { entered = resolve; });
  const originalUpdate = storage.update.bind(storage); let delay = true;
  storage.update = async change => { if (delay) { delay = false; entered(); await gate; } return originalUpdate(change); };
  const late = b.saveDraft('local', 'agent', undefined, 'page-b', { sandbox: 'workspace-write' });
  await waiting; await a.finish(submitted.operationId, { consumeSubmittedDraft: true }); release(); await late;
  assert.equal(storage.data.operations.length, 0);
  assert.deepEqual(storage.data.drafts.map(d => [d.editorId, d.draft]).sort(), [
    ['page-a', { approval: 'on-request' }], ['page-b', { sandbox: 'workspace-write' }],
  ]);
});

test('closing a receipt without confirming effective values preserves the submitted edit', async () => {
  const storage = new Storage(), client = clientFor(async input => ({ outcome: 'success', result: { status: 'okOverridden' }, operation: {
    operationId: input.operationId, hostId: input.hostId, method: input.method, state: 'succeeded', terminal: { kind: 'okOverridden' },
  } }));
  const ops = new SettingsConfigOperations(client, storage, () => 'overridden');
  const revision = await ops.saveDraft('local', 'models', undefined, 'editor', { model: 'beta', baseline: 'alpha' });
  assert.ok(revision);
  await ops.submit('local', 'config/batchWrite', params, { section: 'models', editorId: 'editor', revision, source, draft: { model: 'beta' } });
  await ops.finish('overridden');
  assert.equal(storage.data.operations.length, 0);
  assert.deepEqual(storage.data.drafts[0]?.draft, { model: 'beta', baseline: 'alpha' });
});

test('legacy operation and all old editor copies migrate without auto-selection', async () => {
  const storage = new Storage();
  storage.value = [{ operationId: 'old', hostId: 'local', method: 'config/batchWrite', params,
    origin: { section: 'models', draft: { model: 'beta' } }, phase: 'unknown',
    workingDrafts: [{ editorId: 'a', revision: 1, draft: { model: 'one' } }, { editorId: 'b', revision: 2, draft: { model: 'two' } }] }];
  const ops = new SettingsConfigOperations(clientFor(async () => ({ operation: null })), storage);
  await ops.refresh();
  assert.equal(ops.getSnapshot().drafts.length, 3);
  await ops.saveDraft('local', 'models', undefined, 'new', { model: 'three' });
  assert.equal(storage.data.operations[0]?.operationId, 'old');
  assert.equal(storage.data.drafts.length, 4);
  assert.deepEqual(storage.data.drafts.map(d => (d.draft as { model: string }).model), ['beta', 'one', 'two', 'three']);
});

test('original observed not-sent survives host restart and requires explicit local confirmation', async () => {
  const storage = new Storage(), calls: Record<string, unknown>[] = [];
  const client = clientFor(async input => {
    calls.push(input);
    if (input.action === 'submit') return { outcome: 'not-started', error: { message: 'prepare failed', uncertain: false }, operation: {
      operationId: input.operationId, hostId: input.hostId, method: input.method, state: 'preparing', storageError: true,
      observedTerminal: { kind: 'not-sent' },
    } };
    return { operation: null };
  });
  const first = new SettingsConfigOperations(client, storage, () => 'original');
  const revision = await first.saveDraft('local', 'models', undefined, 'page-a', { model: 'beta', baseline: 'alpha' });
  assert.ok(revision);
  await assert.rejects(first.submit('local', 'config/batchWrite', params,
    { section: 'models', editorId: 'page-a', revision, source, draft: { model: 'beta' } }), /host.*receipt/i);
  assert.equal(storage.data.operations[0]?.notSentEvidence?.terminal.kind, 'not-sent');
  const resumed = new SettingsConfigOperations(client, storage);
  await assert.rejects(resumed.confirmNotSent('original'), /Check the original/);
  await resumed.check('original');
  assert.equal(storage.data.operations[0]?.phase, 'unknown');
  await resumed.confirmNotSent('original');
  assert.equal(storage.data.operations[0]?.phase, 'not-started');
  await resumed.finish('original');
  assert.equal(storage.data.drafts.length, 1);
  assert.deepEqual(calls.map(call => call.action), ['submit', 'status']);
});

test('only a trusted before-send classification is definite; ordinary false and null status remain unknown', async () => {
  for (const marked of [false, true]) {
    const storage = new Storage(), calls: string[] = [];
    const client = clientFor(async input => {
      calls.push(String(input.action));
      if (input.action === 'submit') throw Object.assign(new Error('fixture failure'), { uncertain: false, ...(marked ? { sendPhase: 'before-send' } : {}) });
      return { operation: null };
    });
    const ops = new SettingsConfigOperations(client, storage, () => 'original');
    await assert.rejects(ops.submit('local', 'config/batchWrite', params, { section: 'models', source, draft: {} }),
      (error: unknown) => error instanceof SettingsWriteError && error.uncertain === !marked);
    assert.equal(storage.data.operations[0]?.phase, marked ? 'not-started' : 'unknown');
    if (!marked) {
      await ops.check('original');
      await assert.rejects(ops.confirmNotSent('original'), /not-sent evidence/);
      assert.equal(storage.data.operations[0]?.phase, 'unknown');
    }
    assert.equal(calls.filter(call => call === 'submit').length, 1);
  }
});

test('a missing or wrong read source prevents creating and sending a configuration operation', async () => {
  const storage = new Storage(), calls: unknown[] = [], client = clientFor(async input => { calls.push(input); return success(input); });
  const ops = new SettingsConfigOperations(client, storage, () => 'original');
  for (const invalid of [undefined, fixtureSource('other')]) {
    await assert.rejects(ops.submit('local', 'config/batchWrite', params, { section: 'models', source: invalid, draft: {} }), /source is unavailable/);
  }
  assert.equal(storage.value, undefined);
  assert.equal(calls.length, 0);
});

test('a stale retry cannot replace or clear a later failed edit', async () => {
  const storage = new Storage(), ops = new SettingsConfigOperations(clientFor(async input => success(input)), storage);
  const update = storage.update.bind(storage);
  let writes = 0, entered = () => {}, release = () => {};
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  storage.update = async change => {
    const write = ++writes;
    if (write === 2) { entered(); await gate; }
    if (write === 1 || write === 3) throw new Error('fixture storage failure');
    return update(change);
  };
  await assert.rejects(ops.saveDraft('local', 'models', undefined, 'editor', { model: 'x' }), /storage failure/);
  const retryX = ops.retryDraft('editor'); await waiting;
  const saveY = ops.saveDraft('local', 'models', undefined, 'editor', { model: 'y' });
  release(); await retryX;
  await assert.rejects(saveY, /storage failure/);
  assert.deepEqual(ops.getSnapshot().draftRetry, ['editor']);
  assert.notEqual(storage.data?.drafts?.[0]?.draft && (storage.data.drafts[0]!.draft as { model: string }).model, 'x');
  await ops.retryDraft('editor');
  assert.deepEqual(storage.data.drafts.map(item => item.draft), [{ model: 'y' }]);
  assert.deepEqual(ops.getSnapshot().draftRetry, []);
});

test('submission compares the controller revision with the transaction value', async () => {
  const storage = new Storage(), calls: unknown[] = [], client = clientFor(async input => { calls.push(input); return success(input); });
  const editor = new SettingsConfigOperations(client, storage, () => 'fixture-original');
  const revision = await editor.saveDraft('local', 'models', undefined, 'editor', { model: 'x' });
  assert.ok(revision);
  await editor.saveDraft('local', 'models', undefined, 'editor', { model: 'y' });
  await assert.rejects(editor.submit('local', 'config/batchWrite', params,
    { section: 'models', editorId: 'editor', revision, source, draft: { model: 'x' } }), /revision changed/);
  assert.deepEqual(storage.data.drafts.map(item => item.draft), [{ model: 'y' }]);
  assert.deepEqual(storage.data.operations, []); assert.equal(calls.length, 0);
});

test('closed not-sent evidence is available only to the exact original identity', async () => {
  const storage = new Storage(), calls: Record<string, unknown>[] = [];
  const client = clientFor(async input => {
    calls.push(input);
    return input.action === 'submit' ? { outcome: 'not-started', error: { uncertain: false, message: 'not sent' } } : { operation: null };
  });
  const ops = new SettingsConfigOperations(client, storage, () => 'not-sent-id');
  await assert.rejects(ops.submit('local', 'config/batchWrite', params, { section: 'models', source, draft: {} }), /not sent/);
  await ops.finish('not-sent-id');
  const resumed = new SettingsConfigOperations(client, storage);
  assert.equal(await resumed.originalFinished('local', 'not-sent-id', 'config/batchWrite'), true);
  assert.equal(await resumed.originalFinished('other', 'not-sent-id', 'config/batchWrite'), false);
  assert.equal(await resumed.originalFinished('local', 'not-sent-id', 'skills/config/write'), false);
  assert.deepEqual(calls.map(item => item.action), ['submit', 'status', 'status']);
  assert.equal(storage.data.operations.length, 0);
});
