import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageEditRecoveryStore } from '../src/renderer/app/message-edit-recovery.ts';
import type { EditRecoveryStorage } from '../src/renderer/app/message-edit-recovery.ts';
import type { MessageEditRecovery } from '../src/renderer/messages/use-message-editing.ts';
import type { WorkbenchClient } from '../src/renderer/workbench-contract.ts';

const origin = { hostId: 'ssh-test', threadId: 'same', turnId: 'original', itemId: 'user' };
const recovery: MessageEditRecovery = { origin, draft: { text: 'edited', input: [{ type: 'text', text: 'edited', text_elements: [] }], images: [], files: [] },
  editor: { sessionId: 'editor', revision: 1, baseDraft: { text: 'original', images: [], files: [] }, edits: [], addedText: 'edited', sourceSignature: 'original',
    snapshot: { id: 'user', type: 'userMessage' }, turnIndex: 0, itemIndex: 0 } };
const version = { sessionId: 'editor', revision: 1 };
const params = { input: recovery.draft.input };
function fixture(respond: (params: Record<string, unknown>) => unknown | Promise<unknown>) {
  let saved: unknown, fail = false;
  const storage: EditRecoveryStorage = { read: () => structuredClone(saved), update: async change => {
    const next = change(structuredClone(saved));
    if (fail) throw new Error('storage unavailable');
    saved = structuredClone(next); return next;
  }, changed() {} };
  const calls: Record<string, unknown>[] = [];
  const client: WorkbenchClient = { rpc: async () => { throw new Error('unexpected direct RPC'); },
    host: async <T>(endpoint: string, value: Record<string, unknown> = {}) => {
      assert.equal(endpoint, 'message-edit'); calls.push(structuredClone(value)); return await respond(value) as T;
    }, subscribe: () => () => {}, reply: async () => {} };
  return { storage, calls, client, store: new MessageEditRecoveryStore(client, storage), fail: () => { fail = true; } };
}

test('reload after a known start failure retries only start and keeps the original history expectation', async () => {
  const h = fixture(value => value.operation === 'submit' ? { stage: 'reverted', error: 'start rejected' }
    : { stage: 'started', turn: { id: 'new', status: 'inProgress', items: [] } });
  await h.store.save(recovery, origin, version);
  await assert.rejects(h.store.submit(origin, ['original', 'tool-followup'], params), /start rejected/);
  await assert.rejects(h.store.save(null, origin, version), /草稿已保留/);
  const restored = new MessageEditRecoveryStore(h.client, h.storage);
  assert.equal((await restored.read(origin.hostId, origin.threadId))?.recovery.editor?.addedText, 'edited');
  const result = await restored.submit(origin, [], params);
  assert.equal(result.turn?.id, 'new');
  assert.deepEqual(h.calls.map(call => call.operation), ['submit', 'retry-start']);
  assert.deepEqual(h.calls[1]!.expectedTurnIds, ['original', 'tool-followup']);
  assert.equal(h.calls[1]!.clientUserMessageId, h.calls[0]!.clientUserMessageId);
  assert.deepEqual(h.calls[1]!.turnParams, h.calls[0]!.turnParams);
  await restored.save(null, origin, version);
  assert.equal(await restored.read(origin.hostId, origin.threadId), null);
});

test('a lost browser response checks clientId after reload without replaying a write', async () => {
  const h = fixture(value => {
    if (value.operation === 'submit') throw new Error('response lost after host may have applied');
    assert.equal(value.operation, 'check'); return { stage: 'started', turn: { id: 'applied', status: 'completed', items: [] } };
  });
  await h.store.save(recovery, origin, version);
  await assert.rejects(h.store.submit(origin, ['original'], params), /response lost/);
  const restored = new MessageEditRecoveryStore(h.client, h.storage);
  await restored.read(origin.hostId, origin.threadId);
  assert.equal((await restored.submit(origin, [], params)).turn?.id, 'applied');
  assert.deepEqual(h.calls.map(call => call.operation), ['submit', 'check']);
  assert.equal(h.calls[0]!.clientUserMessageId, h.calls[1]!.clientUserMessageId);
});

test('an older host cannot make an uncertain rollback retryable from a snapshot', async () => {
  const h = fixture(value => ({ stage: value.operation === 'submit' ? 'revertUnknown' : h.calls.length === 2 ? 'reverted' : 'prepared' }));
  await h.store.save(recovery, origin, version);
  await assert.rejects(h.store.submit(origin, ['original'], params), /尚未确认/);
  await assert.rejects(h.store.submit(origin, [], params), /尚未确认/);
  await assert.rejects(h.store.submit(origin, [], params), /尚未确认/);
  assert.deepEqual(h.calls.map(call => call.operation), ['submit', 'check', 'check']);
  assert.equal(h.calls[1]!.unknownPhase, 'revertUnknown');
  assert.equal(h.calls[2]!.clientUserMessageId, h.calls[0]!.clientUserMessageId);
  assert.equal((await h.store.read(origin.hostId, origin.threadId))?.submission?.stage, 'revertUnknown');
});

test('a newer edit after a known rejected start sends B with a new CID without reverting twice', async () => {
  const h = fixture(value => value.operation === 'submit' ? { stage: 'reverted', error: 'start rejected' }
    : { stage: 'started', turn: { id: 'old-start', status: 'completed', items: [] } });
  await h.store.save(recovery, origin, version);
  await assert.rejects(h.store.submit(origin, ['original'], params), /start rejected/);
  const newer = { ...recovery, draft: { ...recovery.draft, text: 'newer' }, editor: { ...recovery.editor!, revision: 2 } };
  await h.store.save(newer, origin, { ...version, revision: 2 });
  const newerParams = { input: [{ type: 'text', text: 'newer' }] };
  assert.equal((await h.store.submit(origin, [], newerParams)).turn?.id, 'old-start');
  assert.equal(h.calls[1]!.operation, 'retry-start');
  assert.deepEqual(h.calls.map(call => call.operation), ['submit', 'retry-start']);
  assert.deepEqual(h.calls[1]!.expectedTurnIds, ['original']);
  assert.notEqual(h.calls[1]!.clientUserMessageId, h.calls[0]!.clientUserMessageId);
  assert.deepEqual(h.calls[1]!.turnParams, newerParams);
  const saved = await h.store.read(origin.hostId, origin.threadId);
  assert.equal(saved?.recovery.draft.text, 'newer');
  assert.deepEqual(saved?.submission?.editorVersion, { ...version, revision: 2 });
  await h.store.save(null, origin, { ...version, revision: 2 });
  assert.equal(await h.store.read(origin.hostId, origin.threadId), null);
});

test('storage failure and another page edit both stop before a destructive host call', async () => {
  const h = fixture(() => { throw new Error('must not write'); });
  await h.store.save(recovery, origin, version);
  const other = new MessageEditRecoveryStore(h.client, h.storage);
  await other.read(origin.hostId, origin.threadId);
  await h.store.save({ ...recovery, draft: { ...recovery.draft, text: 'newer' }, editor: { ...recovery.editor!, revision: 2 } }, origin,
    { ...version, revision: 2 });
  await assert.rejects(other.submit(origin, ['original'], params), /另一页面/);
  h.fail();
  await assert.rejects(h.store.submit(origin, ['original'], params), /storage unavailable/);
  assert.deepEqual(h.calls, []);
  assert.equal((await h.store.read(origin.hostId, origin.threadId))?.recovery.draft.text, 'newer');
});

test('checking an older successful request preserves a newer draft across reload without reporting it sent', async () => {
  const h = fixture(value => {
    if (value.operation === 'submit') throw new Error('response lost after older draft started');
    return { stage: 'started', turn: { id: 'older-applied', status: 'completed', items: [] } };
  });
  await h.store.save(recovery, origin, version);
  await assert.rejects(h.store.submit(origin, ['original'], params), /response lost/);
  const newer = { ...recovery, draft: { ...recovery.draft, text: 'newer unsent draft' }, editor: { ...recovery.editor!, revision: 2 } };
  await h.store.save(newer, origin, { ...version, revision: 2 });
  const restored = new MessageEditRecoveryStore(h.client, h.storage);
  await restored.read(origin.hostId, origin.threadId);
  await assert.rejects(restored.submit(origin, [], { input: [{ type: 'text', text: 'newer unsent draft' }] }), /较早版本已发送.*较新草稿未发送/);
  assert.deepEqual(h.calls.map(call => call.operation), ['submit', 'check']);
  assert.equal(h.calls[1]!.clientUserMessageId, h.calls[0]!.clientUserMessageId);
  assert.deepEqual(h.calls[1]!.turnParams, params);
  const kept = (await restored.read(origin.hostId, origin.threadId))!;
  assert.equal(kept.recovery.draft.text, 'newer unsent draft');
  assert.equal(kept.submission?.stage, 'started');
  assert.deepEqual(kept.submission?.editorVersion, version);
  await assert.rejects(restored.submit(origin, [], params), /较新草稿未发送/);
  assert.equal(h.calls.length, 2, 'A known old success must not replay a mutation or check.');
  await assert.rejects(restored.save(null, origin, version), /编辑版本已改变/);
  assert.equal((await restored.read(origin.hostId, origin.threadId))?.recovery.draft.text, 'newer unsent draft', 'Clearing the sent revision cannot clear its newer editor.');
});

test('a newer draft saved during an in-flight request survives its successful completion', async () => {
  let finish!: (value: unknown) => void, started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const h = fixture(() => { started(); return new Promise(resolve => { finish = resolve; }); });
  await h.store.save(recovery, origin, version);
  const sending = h.store.submit(origin, ['original'], params);
  await entered;
  await h.store.save({ ...recovery, draft: { ...recovery.draft, text: 'typed while pending' }, editor: { ...recovery.editor!, revision: 2 } }, origin, { ...version, revision: 2 });
  finish({ stage: 'started', turn: { id: 'older-applied', status: 'inProgress', items: [] } });
  await assert.rejects(sending, /较新草稿未发送/);
  assert.equal((await h.store.read(origin.hostId, origin.threadId))?.recovery.draft.text, 'typed while pending');
});
