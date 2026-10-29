import test from 'node:test';
import assert from 'node:assert/strict';
import { submitDraft } from '../src/renderer/app/submission.ts';
import type { SubmissionContext } from '../src/renderer/app/submission.ts';
import type { WorkbenchClient } from '../src/renderer/workbench-contract.ts';
import type { ThreadSummary } from '../lib/codex-protocol.ts';
import { sessionOptions } from '../src/renderer/app/session-options.ts';

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

test('send, queue and steer use the document mode captured by the original submission', async () => {
  const rich = { text: '**original**', images: [], files: [], document: { type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'original', marks: [{ type: 'strong' }] }] },
  ] } };
  for (const action of [{ type: 'send' as const }, { type: 'queue' as const }, { type: 'steer' as const, turnId: 'active' }]) {
    for (const plainTextMode of [true, false]) {
      const h = fixture();
      await submitDraft(h.client, { ...base, documentPlainTextMode: plainTextMode,
        activeTurnId: action.type === 'steer' ? 'active' : null }, rich, {}, action, async () => {});
      const method = action.type === 'queue' ? 'thread/queue/add' : action.type === 'steer' ? 'turn/steer' : 'turn/start';
      assert.equal((h.calls.find(call => call.method === method)?.params.input as { text: string }[])[0]?.text,
        plainTextMode ? 'original' : '**original**');
    }
  }
});

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

test('unchanged session controls do not reconstruct a custom sandbox or collaboration instructions', async () => {
  const h = fixture();
  const initialOptions = sessionOptions({ model: 'custom', reasoningEffort: 'high',
    sandbox: { type: 'workspaceWrite', writableRoots: ['/extra'], networkAccess: true, excludeSlashTmp: true, excludeTmpdirEnvVar: true },
    collaborationMode: { mode: 'plan' } });
  assert.deepEqual(initialOptions.sandboxPolicy, { type: 'workspaceWrite', writableRoots: ['/extra'], networkAccess: true,
    excludeSlashTmp: true, excludeTmpdirEnvVar: true });
  await submitDraft(h.client, { ...base, initialOptions }, draft, initialOptions, { type: 'send' }, async () => {});
  const params = h.calls[0].params;
  for (const key of ['sandboxPolicy', 'permissions', 'collaborationMode', 'model', 'effort']) assert.equal(Object.hasOwn(params, key), false, key);
  h.calls.length = 0;
  await submitDraft(h.client, { ...base, initialOptions }, draft, { ...initialOptions, effort: null }, { type: 'send' }, async () => {});
  assert.equal(h.calls[0].params.effort, null);
  assert.equal(Object.hasOwn(h.calls[0].params, 'sandboxPolicy'), false);
  assert.equal(Object.hasOwn(h.calls[0].params, 'collaborationMode'), false);
});

test('a selected complete sandbox reaches both new thread and turn without discarding its restrictions', async () => {
  const h = fixture();
  const policy = { type: 'workspaceWrite' as const, writableRoots: ['/extra', '/other'], networkAccess: true,
    excludeTmpdirEnvVar: true, excludeSlashTmp: true };
  const options = { permissionProfileId: undefined, sandboxMode: 'workspace-write' as const, sandboxPolicy: policy };
  await submitDraft(h.client, { ...base, threadId: null, overrides: options }, draft, options, { type: 'send' }, async () => {});
  const start = h.calls.find(call => call.method === 'thread/start')!.params;
  const turn = h.calls.find(call => call.method === 'turn/start')!.params;
  assert.equal(start.sandbox, 'workspace-write');
  assert.deepEqual(start.config, { sandbox_workspace_write: { writable_roots: ['/extra', '/other'], network_access: true,
    exclude_tmpdir_env_var: true, exclude_slash_tmp: true } });
  assert.equal(start.permissions, null);
  assert.deepEqual(turn.sandboxPolicy, policy);
  assert.equal(turn.permissions, null);
  policy.writableRoots.push('/later');
  assert.deepEqual((turn.sandboxPolicy as typeof policy).writableRoots, ['/extra', '/other']);
  assert.deepEqual((start.config as { sandbox_workspace_write: { writable_roots: string[] } }).sandbox_workspace_write.writable_roots, ['/extra', '/other']);
});

test('explicit policy changes preserve all fields, and a named profile stays mutually exclusive', async () => {
  const h = fixture();
  const previous = sessionOptions({ sandbox: { type: 'readOnly', networkAccess: true } });
  const selected = { type: 'externalSandbox' as const, networkAccess: 'enabled' as const };
  await submitDraft(h.client, { ...base, initialOptions: previous, overrides: { permissionProfileId: undefined, sandboxPolicy: selected } },
    draft, { ...previous, permissionProfileId: undefined, sandboxPolicy: selected }, { type: 'send' }, async () => {});
  assert.deepEqual(h.calls[0].params.sandboxPolicy, selected);
  assert.equal(h.calls[0].params.permissions, null);
  h.calls.length = 0;
  await submitDraft(h.client, { ...base, initialOptions: previous, overrides: { permissionProfileId: 'team', sandboxPolicy: undefined } },
    draft, { ...previous, permissionProfileId: 'team', sandboxPolicy: undefined }, { type: 'send' }, async () => {});
  assert.equal(h.calls[0].params.permissions, 'team');
  assert.equal(Object.hasOwn(h.calls[0].params, 'sandboxPolicy'), false);
});

test('unrepresentable new-thread policies fail before creation or any RPC', async () => {
  for (const sandboxPolicy of [{ type: 'readOnly' as const, networkAccess: true },
    { type: 'externalSandbox' as const, networkAccess: 'restricted' as const },
    { type: 'readOnly' as const, networkAccess: false, futureRule: true }]) {
    const h = fixture(); let creating = false;
    await assert.rejects(submitDraft(h.client, { ...base, threadId: null, send: { clientUserMessageId: 'fixture',
      async creating() { creating = true; }, async created() { throw new Error('unexpected creation'); },
      async sending() { throw new Error('unexpected send'); }, async confirmed() { throw new Error('unexpected confirmation'); } } },
      draft, { sandboxPolicy }, { type: 'send' }, async () => {}), /cannot be safely represented/);
    assert.equal(creating, false);
    assert.deepEqual(h.calls, []);
  }
});

test('an explicit sandbox selection clears its former permission profile and leaves unrelated controls intact', async () => {
  const h = fixture(), initialOptions = { permissionProfileId: 'existing-profile', sandboxMode: 'read-only' as const, mode: 'plan' as const, model: 'custom' };
  await submitDraft(h.client, { ...base, initialOptions }, draft, { ...initialOptions, permissionProfileId: undefined, sandboxMode: 'workspace-write' }, { type: 'send' }, async () => {});
  const params = h.calls[0].params;
  assert.equal(params.permissions, null);
  assert.deepEqual(params.sandboxPolicy, { type: 'workspaceWrite', writableRoots: ['/fixture'], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false });
  assert.equal(Object.hasOwn(params, 'collaborationMode'), false);
});
