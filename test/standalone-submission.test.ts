import test from 'node:test';
import assert from 'node:assert/strict';
import { submitDraft } from '../src/renderer/app/submission.ts';
import type { SubmissionContext } from '../src/renderer/app/submission.ts';
import type { WorkbenchClient } from '../src/renderer/workbench-contract.ts';
import type { ThreadSummary } from '../lib/codex-protocol.ts';

const draft = { text: 'message', images: [], files: [] };
const thread: ThreadSummary = { id: 'thread', name: null, cwd: '/fixture', status: { type: 'idle' }, turns: [] };
const base: SubmissionContext = { hostId: 'ssh-fixture', threadId: 'thread', cwd: '/fixture', activeTurnId: null, readOnly: false, thread };
function fixture() {
  const calls: { method: string; params: Record<string, unknown>; hostId?: string }[] = [];
  const client: WorkbenchClient = {
    async rpc<T>(method: string, params: Record<string, unknown> = {}, hostId?: string) {
      calls.push({ method, params, hostId });
      return (method === 'config/read' ? { config: {} } : method === 'thread/start' ? { thread, model: 'resolved-model' }
        : { turn: { id: 'new-turn', items: [], status: 'inProgress', itemsView: 'notLoaded' } }) as T;
    },
    async host<T>() { throw new Error('Unexpected host operation'); return undefined as T; },
    subscribe: () => () => {}, reply: async () => { throw new Error('Unexpected approval'); },
  };
  return { client, calls };
}

test('a new thread installs its selected subscription before sending and retains explicit nullable options', async () => {
  const h = fixture();
  let finishSelection: () => void = () => {};
  const waiting = new Promise<void>(resolve => { finishSelection = resolve; });
  const pending = submitDraft(h.client, { ...base, threadId: null }, draft, { mode: 'plan', effort: null, serviceTier: null,
    permissionProfileId: 'profile', approvalsReviewer: 'guardian_subagent' }, { type: 'send' }, () => waiting);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.calls.map(call => call.method), ['thread/start']);
  finishSelection(); await pending;
  const sent = h.calls[1];
  assert.equal(sent.params.serviceTier, null); assert.equal(sent.params.effort, null);
  assert.equal(sent.params.permissions, 'profile'); assert.equal(sent.params.sandboxPolicy, undefined);
  assert.equal(sent.params.approvalsReviewer, 'guardian_subagent');
  assert.equal((sent.params.collaborationMode as any).settings.model, 'resolved-model');
  assert.ok(h.calls.every(call => call.hostId === 'ssh-fixture'));
});

test('queue and steer use distinct operations and steer rejects a stale turn before writing', async () => {
  const h = fixture();
  await submitDraft(h.client, base, draft, {}, { type: 'queue' }, async () => {});
  await submitDraft(h.client, { ...base, activeTurnId: 'active' }, draft, {}, { type: 'steer', turnId: 'active' }, async () => {});
  await assert.rejects(submitDraft(h.client, { ...base, activeTurnId: 'changed' }, draft, {}, { type: 'steer', turnId: 'active' }, async () => {}), /任务已改变/);
  assert.deepEqual(h.calls.map(call => call.method), ['thread/queue/add', 'turn/steer']);
  assert.equal(h.calls[1].params.expectedTurnId, 'active');
  assert.ok(h.calls.every(call => typeof call.params.clientUserMessageId === 'string'));
});

test('edit delegates destructive operations to durable recovery and read-only views cannot mutate', async () => {
  const h = fixture();
  const source = { id: 'source', status: 'completed' as const, items: [{ id: 'user', type: 'userMessage' }] };
  const context = { ...base, thread: { ...thread, turns: [source] } };
  const editCalls: unknown[] = [];
  await submitDraft(h.client, context, draft, {}, { type: 'send' }, async () => {}, { hostId: base.hostId, threadId: 'thread', turnId: 'source', itemId: 'user', format: 'markdown', hints: [] },
    async (origin, expected, params) => { editCalls.push({ origin, expected, params }); return {}; });
  assert.deepEqual(h.calls, []);
  assert.deepEqual((editCalls[0] as any).expected, ['source']);
  assert.equal((editCalls[0] as any).params.turnTrigger, 'edit_user_message');
  assert.deepEqual((editCalls[0] as any).params.input, [{ type: 'text', text: 'message', text_elements: [] }]);
  await assert.rejects(submitDraft(h.client, { ...context, readOnly: true }, draft, {}, { type: 'send' }, async () => {}), /只读/);
  assert.equal(editCalls.length, 1);
});

test('edit preflight failure never reverts stored history and false reference context is not dropped', async () => {
  const h = fixture();
  const context = { ...base, thread: { ...thread, turns: [{ id: 'source', status: 'completed' as const,
    items: [{ id: 'user', type: 'userMessage' }] }] } };
  await assert.rejects(submitDraft(h.client, context, draft, { mode: 'plan' }, { type: 'send' }, async () => {},
    { hostId: base.hostId, threadId: 'thread', turnId: 'source', itemId: 'user', format: 'markdown', hints: [] }, async () => ({})), /无法确定/);
  assert.deepEqual(h.calls.map(call => call.method), ['config/read']);
  h.calls.length = 0;
  const referenced = { ...draft, references: [{ id: 'context', text: 'reference', original: false }] };
  await assert.rejects(submitDraft(h.client, base, referenced, {}, { type: 'queue' }, async () => {}), /队列协议/);
  await submitDraft(h.client, base, referenced, {}, { type: 'send' }, async () => {});
  assert.deepEqual(h.calls[0]?.params.additionalContext, { context: { kind: 'untrusted', value: 'false' } });
});

test('an active turn still allows the recovery controller to check an uncertain edit without a direct write', async () => {
  const h = fixture();
  const checked: unknown[] = [];
  await assert.rejects(submitDraft(h.client, { ...base, activeTurnId: 'already-started' }, draft, {}, { type: 'send' }, async () => {},
    { hostId: base.hostId, threadId: 'thread', turnId: 'source', itemId: 'user' }, async (...request) => {
      checked.push(request); throw new Error('Old draft started; newer draft retained');
    }), /newer draft retained/);
  assert.equal(checked.length, 1);
  assert.deepEqual(h.calls, []);
  await assert.rejects(submitDraft(h.client, { ...base, activeTurnId: 'already-started' }, draft, {}, { type: 'send' }, async () => {}), /仍在运行/);
});
