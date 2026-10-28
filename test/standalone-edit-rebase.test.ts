import assert from 'node:assert/strict';
import test from 'node:test';
import type { ThreadSummary } from '../lib/codex-protocol.ts';
import { MessageEditRecoveryStore, messageEditRebaseMarker } from '../src/renderer/app/message-edit-recovery.ts';
import type { EditRecoveryStorage } from '../src/renderer/app/message-edit-recovery.ts';
import { editableDraft } from '../src/renderer/messages/message-data.ts';
import { applyTextEdits, editSourceSignature } from '../src/renderer/messages/message-edit.ts';
import type { MessageEditRecovery } from '../src/renderer/messages/use-message-editing.ts';
import type { WorkbenchClient } from '../src/renderer/workbench-contract.ts';

const origin = { hostId: 'host-a', threadId: 'thread-a', turnId: 'source', itemId: 'source-user', format: 'markdown', hints: [] };
const source = { id: 'source-user', type: 'userMessage', format: 'markdown', hints: [], content: [
  { type: 'text', text: 'Original @item', text_elements: [{ byteRange: { start: 9, end: 14 }, placeholder: '@item', context: { browser: 'synthetic' } }] },
  { type: 'image', fileId: 'fixture-file', detail: 'high' },
  { type: 'mention', name: 'workspace', path: '/work' },
], document: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original @item' }] }] } };
function recovery(text: string, revision: number, original = source): MessageEditRecovery {
  const base = editableDraft(original)!;
  const edits = [{ index: 0, text }], result = applyTextEdits(base, edits, '');
  assert.ok(result.draft, result.error ?? 'The synthetic draft must be convertible.');
  return { origin, draft: result.draft, editor: { sessionId: 'editor-a', revision, baseDraft: base, edits, addedText: '',
    sourceSignature: editSourceSignature(original), snapshot: original, turnIndex: 1, itemIndex: 0 } };
}
const version = (revision: number) => ({ sessionId: 'editor-a', revision });

function fixture() {
  let saved: unknown, first = true, rejectNext = false, gate: Promise<void> | null = null, notify: (() => void) | null = null;
  const operations: Record<string, unknown>[] = [], reads: string[] = [];
  const storage: EditRecoveryStorage = { read: () => structuredClone(saved), update: async change => {
    saved = structuredClone(change(structuredClone(saved))); return saved;
  }, changed() {} };
  let thread: ThreadSummary = { id: origin.threadId, name: null, cwd: '/work', status: { type: 'idle' }, turns: [] };
  const client: WorkbenchClient = {
    host: async <T>(endpoint: string, params: Record<string, unknown> = {}) => {
      assert.equal(endpoint, 'message-edit'); operations.push(structuredClone(params));
      if (params.operation === 'submit' && first) { first = false; throw new Error('synthetic lost response'); }
      if (params.operation === 'submit') {
        const item = thread.turns.find(turn => turn.id === (params.origin as { turnId: string }).turnId)?.items
          .find(value => value.id === (params.origin as { itemId: string }).itemId);
        assert.ok(item);
        assert.deepEqual(params.expectedSource, { clientUserMessageId: item.clientId, signature: editSourceSignature(item) });
        if (rejectNext) { rejectNext = false; return { stage: 'prepared', error: 'synthetic rejection before revert' } as T; }
      }
      return { stage: 'started', turn: { id: params.operation === 'check' ? 'sent-a' : 'sent-b', status: 'completed', items: [] } } as T;
    },
    rpc: async <T>(method: string, params: Record<string, unknown> = {}, hostId?: string) => {
      assert.equal(hostId, origin.hostId); assert.equal(params.threadId, origin.threadId); reads.push(method);
      if (method === 'thread/read') return { thread: { ...thread, turns: [] } } as T;
      if (method === 'thread/turns/list') {
        if (gate) { const waiting = gate; gate = null; notify?.(); notify = null; await waiting; }
        if (!params.cursor) return { data: thread.turns.slice(0, 1), nextCursor: 'second' } as T;
        assert.equal(params.cursor, 'second');
        return { data: thread.turns.slice(1).map(turn => ({ ...turn, itemsView: 'summary', items: [] })), nextCursor: null } as T;
      }
      if (method === 'thread/items/list') {
        const turn = thread.turns.find(value => value.id === params.turnId);
        assert.ok(turn); return { data: turn.items.map(item => ({ item })), nextCursor: null } as T;
      }
      throw new Error(`unexpected RPC: ${method}`);
    },
    subscribe: () => () => {}, reply: async () => {},
  };
  const store = new MessageEditRecoveryStore(client, storage, { hostChecksRebasedSourceBeforeRevert: true });
  return { storage, client, store, operations, reads,
    rejectNextSubmit() { rejectNext = true; },
    setThread(value: ThreadSummary) { thread = structuredClone(value); }, getThread: () => structuredClone(thread),
    holdHistory() { let release!: () => void; const entered = new Promise<void>(resolve => { notify = resolve; });
      gate = new Promise<void>(resolve => { release = resolve; }); return { entered, release: () => release() }; } };
}

async function confirmedOlder(original = source) {
  const h = fixture(), a = recovery('A @item', 1, original), b = recovery('B @item', 2, original);
  await h.store.save(a, origin, version(1));
  await assert.rejects(h.store.submit(origin, ['before', 'source'], { input: a.draft.input }), /lost response/);
  await h.store.save(b, origin, version(2));
  const state = (await h.store.read(origin.hostId, origin.threadId))!;
  const sentItem = { ...original, id: 'sent-user', clientId: state.submission!.request.clientUserMessageId,
    content: structuredClone(a.draft.input), document: structuredClone(a.draft.document) };
  h.setThread({ id: origin.threadId, name: null, cwd: '/work', status: { type: 'idle' }, turns: [
    { id: 'before', status: 'completed', itemsView: 'full', items: [] },
    { id: 'sent-a', status: 'completed', itemsView: 'full', items: [sentItem] },
  ] });
  await assert.rejects(h.store.submit(origin, [], { input: b.draft.input }), /较早版本已发送.*较新草稿未发送/);
  return { ...h, a, b, sentItem };
}

test('confirmed A explicitly rebases B and only a later submit sends the preserved edit', async () => {
  const h = await confirmedOlder();
  const restored = new MessageEditRecoveryStore(h.client, h.storage, { hostChecksRebasedSourceBeforeRevert: true });
  const state = (await restored.read(origin.hostId, origin.threadId))!;
  assert.deepEqual(messageEditRebaseMarker(state), { origin, submittedVersion: version(1) });
  const candidate = await restored.prepareRebase(origin, version(2));
  assert.deepEqual(h.operations.map(call => call.operation), ['submit', 'check']);
  assert.ok(h.reads.includes('thread/items/list'), 'summary pages must be expanded');
  const next = await restored.commitRebase(candidate);
  assert.deepEqual(h.operations.map(call => call.operation), ['submit', 'check'], 'rebasing does not write to the daemon');
  assert.deepEqual(next.origin, { ...origin, turnId: 'sent-a', itemId: 'sent-user' });
  assert.deepEqual(next.draft, h.b.draft);
  assert.deepEqual(next.editor?.edits, h.b.editor?.edits);
  assert.deepEqual(next.draft.input?.[1], { type: 'image', fileId: 'fixture-file', detail: 'high' });
  assert.deepEqual(next.draft.document, h.b.draft.document);
  assert.equal(next.editor?.revision, 3);
  const reload = new MessageEditRecoveryStore(h.client, h.storage, { hostChecksRebasedSourceBeforeRevert: true });
  const persisted = await reload.read(origin.hostId, origin.threadId);
  assert.deepEqual(persisted?.recovery, next); assert.equal(persisted?.submission, undefined);
  const result = await reload.submit(next.origin, ['before', 'sent-a'], { input: next.draft.input });
  assert.equal(result.turn?.id, 'sent-b');
  assert.deepEqual(h.operations.map(call => call.operation), ['submit', 'check', 'submit']);
  assert.notEqual(h.operations[2]!.clientUserMessageId, h.operations[0]!.clientUserMessageId);
  assert.deepEqual(h.operations[2]!.turnParams, { input: h.b.draft.input });
  assert.deepEqual(h.operations[2]!.origin, next.origin);
  assert.deepEqual(h.operations[2]!.expectedSource, { clientUserMessageId: h.sentItem.clientId, signature: editSourceSignature(h.sentItem) });
});

test('changed, active, mismatched or ambiguous history refuses rebasing without a write', async () => {
  for (const kind of ['new-user', 'new-turn', 'running', 'input', 'attachment', 'client-id', 'metadata', 'duplicate'] as const) {
    const h = await confirmedOlder(), thread = h.getThread(), item = thread.turns[1]!.items[0]!;
    if (kind === 'new-user') thread.turns.push({ id: 'later', status: 'completed', itemsView: 'full', items: [{ id: 'later-user', type: 'userMessage', content: [] }] });
    if (kind === 'new-turn') thread.turns.push({ id: 'later', status: 'completed', itemsView: 'full', items: [{ id: 'later-info', type: 'agentMessage', text: 'later output' }] });
    if (kind === 'running') thread.turns[1]!.status = 'inProgress';
    if (kind === 'input') item.content = [{ type: 'text', text: 'different', text_elements: [] }];
    if (kind === 'attachment') (item.content as Record<string, unknown>[])[1]!.detail = 'low';
    if (kind === 'client-id') item.clientId = 'different';
    if (kind === 'metadata') delete item.format;
    if (kind === 'duplicate') thread.turns.push({ id: 'other', status: 'completed', itemsView: 'full', items: [{ ...item, id: 'duplicate' }] });
    h.setThread(thread);
    await assert.rejects(h.store.prepareRebase(origin, version(2)), /草稿已保留/, kind);
    assert.deepEqual((await h.store.read(origin.hostId, origin.threadId))?.recovery, h.b, kind);
    assert.deepEqual(h.operations.map(call => call.operation), ['submit', 'check'], kind);
  }
});

test('a late history read cannot replace C saved by another page during prepare or commit', async () => {
  for (const when of ['prepare', 'commit'] as const) {
    const h = await confirmedOlder(), other = new MessageEditRecoveryStore(h.client, h.storage);
    await other.read(origin.hostId, origin.threadId);
    const candidate = when === 'commit' ? await h.store.prepareRebase(origin, version(2)) : null;
    const gate = h.holdHistory();
    const pending = candidate ? h.store.commitRebase(candidate) : h.store.prepareRebase(origin, version(2));
    await gate.entered;
    const c = recovery('C @item', 3);
    await other.save(c, origin, version(3));
    gate.release();
    if (candidate) await assert.rejects(pending, /另一页面|较新编辑/);
    else {
      const stale = await pending;
      await assert.rejects(h.store.commitRebase(stale as Awaited<ReturnType<typeof h.store.prepareRebase>>), /较新编辑|另一页面/);
    }
    assert.deepEqual((await other.read(origin.hostId, origin.threadId))?.recovery, c);
    assert.deepEqual(h.operations.map(call => call.operation), ['submit', 'check']);
  }
});

test('history changing between prepare and commit leaves the original B untouched', async () => {
  const h = await confirmedOlder(), candidate = await h.store.prepareRebase(origin, version(2));
  const thread = h.getThread();
  thread.turns.push({ id: 'later', status: 'completed', itemsView: 'full', items: [{ id: 'later-user', type: 'userMessage', content: [] }] });
  h.setThread(thread);
  await assert.rejects(h.store.commitRebase(candidate), /草稿已保留/);
  assert.deepEqual((await h.store.read(origin.hostId, origin.threadId))?.recovery, h.b);
  assert.deepEqual(h.operations.map(call => call.operation), ['submit', 'check']);
});

test('an unknown request or an unsafe newer edit cannot be rebased', async () => {
  const unknown = fixture(), a = recovery('A @item', 1), b = recovery('B @item', 2);
  await unknown.store.save(a, origin, version(1));
  await assert.rejects(unknown.store.submit(origin, ['before', 'source'], { input: a.draft.input }), /lost response/);
  await unknown.store.save(b, origin, version(2));
  assert.equal(messageEditRebaseMarker(await unknown.store.read(origin.hostId, origin.threadId)), null);
  await assert.rejects(unknown.store.prepareRebase(origin, version(2)), /草稿已保留/);
  assert.deepEqual(unknown.operations.map(call => call.operation), ['submit']);

  const h = await confirmedOlder();
  const unsafe = structuredClone(h.b);
  unsafe.editor!.revision = 3;
  unsafe.editor!.edits[0]!.text = 'Reference removed';
  await h.store.save(unsafe, origin, version(3));
  await assert.rejects(h.store.prepareRebase(origin, version(3)), /无法无损重建/);
  assert.deepEqual((await h.store.read(origin.hostId, origin.threadId))?.recovery, unsafe);
  assert.deepEqual(h.operations.map(call => call.operation), ['submit', 'check']);
});

test('a rebased edit rechecks the source and complete history before any later send', async () => {
  for (const kind of ['extra-user', 'extra-turn', 'content', 'client-id'] as const) {
    const h = await confirmedOlder(), candidate = await h.store.prepareRebase(origin, version(2));
    const rebased = await h.store.commitRebase(candidate), thread = h.getThread();
    if (kind === 'extra-user') thread.turns.push({ id: 'later', status: 'completed', itemsView: 'full', items: [{ id: 'later-user', type: 'userMessage', content: [] }] });
    if (kind === 'extra-turn') thread.turns.push({ id: 'later', status: 'completed', itemsView: 'full', items: [{ id: 'later-info', type: 'agentMessage', text: 'later output' }] });
    if (kind === 'content') thread.turns[1]!.items[0]!.content = [{ type: 'text', text: 'changed', text_elements: [] }];
    if (kind === 'client-id') thread.turns[1]!.items[0]!.clientId = 'another-client';
    h.setThread(thread);
    await assert.rejects(h.store.submit(rebased.origin, thread.turns.map(turn => turn.id), { input: rebased.draft.input }), /草稿已保留/);
    assert.deepEqual((await h.store.read(origin.hostId, origin.threadId))?.recovery, rebased);
    assert.deepEqual(h.operations.map(call => call.operation), ['submit', 'check']);
  }
});

test('rebased sends require the host guard and recheck after a known pre-revert rejection', async () => {
  const h = await confirmedOlder();
  const oldHost = new MessageEditRecoveryStore(h.client, h.storage);
  await assert.rejects(oldHost.prepareRebase(origin, version(2)), /宿主尚未支持/);
  assert.deepEqual((await oldHost.read(origin.hostId, origin.threadId))?.recovery, h.b);
  const candidate = await h.store.prepareRebase(origin, version(2));
  await assert.rejects(oldHost.commitRebase(candidate), /宿主尚未支持/);
  assert.deepEqual((await oldHost.read(origin.hostId, origin.threadId))?.recovery, h.b);
  const rebased = await h.store.commitRebase(candidate);
  const reopenedOldHost = new MessageEditRecoveryStore(h.client, h.storage);
  await assert.rejects(reopenedOldHost.submit(rebased.origin, ['before', 'sent-a'], { input: rebased.draft.input }), /宿主尚未支持/);
  assert.deepEqual(h.operations.map(call => call.operation), ['submit', 'check']);
  assert.deepEqual((await reopenedOldHost.read(origin.hostId, origin.threadId))?.recovery, rebased);

  h.rejectNextSubmit();
  await assert.rejects(h.store.submit(rebased.origin, ['before', 'sent-a'], { input: rebased.draft.input }), /synthetic rejection/);
  const changed = h.getThread();
  changed.turns[1]!.items[0]!.content = [{ type: 'text', text: 'changed', text_elements: [] }];
  h.setThread(changed);
  await assert.rejects(h.store.submit(rebased.origin, ['before', 'sent-a'], { input: rebased.draft.input }), /草稿已保留/);
  assert.deepEqual(h.operations.map(call => call.operation), ['submit', 'check', 'submit']);
  assert.deepEqual((await h.store.read(origin.hostId, origin.threadId))?.recovery, rebased);
});

test('a rebased send cannot substitute input from another editor version', async () => {
  const h = await confirmedOlder(), candidate = await h.store.prepareRebase(origin, version(2));
  const rebased = await h.store.commitRebase(candidate);
  await assert.rejects(h.store.submit(rebased.origin, ['before', 'sent-a'], { input: h.a.draft.input }), /发送内容与保存的编辑版本不一致/);
  assert.deepEqual((await h.store.read(origin.hostId, origin.threadId))?.recovery, rebased);
  assert.deepEqual(h.operations.map(call => call.operation), ['submit', 'check']);
});

test('a marked document the current parent converter cannot send is retained without rebasing', async () => {
  const marked = { ...source, document: { type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'text', text: 'Original @item', marks: [{ type: 'bold' }] },
  ] }] } };
  const h = await confirmedOlder(marked);
  await assert.rejects(h.store.prepareRebase(origin, version(2)), /无法无损重建或转换/);
  const retained = (await h.store.read(origin.hostId, origin.threadId))!;
  assert.deepEqual(retained.recovery, h.b);
  assert.deepEqual(retained.recovery.draft.document?.content?.[0]?.content?.[0]?.marks, [{ type: 'bold' }]);
  assert.deepEqual(h.operations.map(call => call.operation), ['submit', 'check']);
});
