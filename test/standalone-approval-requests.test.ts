import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ServerRequestRef, WorkbenchClient, WorkbenchEvent } from '../src/renderer/workbench-contract.ts';
import { ApprovalRequestsController } from '../src/renderer/app/approval-requests.ts';
import { miniApprovalRequests, miniPendingApprovalRefs, projectMiniApproval, respondFromMini, updateMiniApprovalDraft } from '../src/renderer/mini/approval-projection.ts';

class FakeClient implements WorkbenchClient {
  listeners = new Set<(event: WorkbenchEvent) => void>();
  replies: { ref: ServerRequestRef; response: unknown }[] = [];
  replyAction: () => Promise<void> = async () => {};
  subscribe(listener: (event: WorkbenchEvent) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  emit(event: WorkbenchEvent) { for (const listener of this.listeners) listener(event); }
  async reply(ref: ServerRequestRef, response: { result: unknown } | { error: { code: number; message: string } }) {
    this.replies.push({ ref: structuredClone(ref), response: structuredClone(response) });
    await this.replyAction();
  }
  async rpc<T = unknown>(): Promise<T> { throw new Error('unexpected RPC'); }
  async host<T = unknown>(): Promise<T> { throw new Error('unexpected host request'); }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

function request(client: FakeClient, ref: ServerRequestRef, method = 'item/tool/requestUserInput', params: Record<string, unknown> = {}) {
  client.emit({ type: 'mcp-request', hostId: ref.hostId, requestRef: ref,
    request: { id: ref.id, method, params: { threadId: 'thread-a', turnId: 'turn-a', ...params } } });
}
function resolved(client: FakeClient, ref: ServerRequestRef, withGeneration = true, threadId = 'thread-a') {
  client.emit({ type: 'mcp-notification', hostId: ref.hostId, method: 'serverRequest/resolved',
    params: { threadId, requestId: ref.id }, ...(withGeneration ? { requestRef: ref } : {}) });
}
function state(controller: ApprovalRequestsController, ref: ServerRequestRef) {
  const result = controller.getSnapshot().find(entry => entry.request.ref.hostId === ref.hostId
    && entry.request.ref.id === ref.id && entry.request.ref.generation === ref.generation);
  assert.ok(result);
  return result;
}

const ref = (generation: string, hostId = 'host-a', id: string | number = 1): ServerRequestRef => ({ hostId, id, generation });
const questions = [{ id: 'q', header: 'Choose', question: 'Which one?', isOther: false, isSecret: false,
  options: [{ label: 'First', description: 'One' }, { label: 'Second', description: 'Two' }] }];

test('dialog and Mini read one parent-owned draft across surface subscriptions', async () => {
  const client = new FakeClient(), controller = new ApprovalRequestsController(client), original = ref('a');
  request(client, original, 'item/tool/requestUserInput', { questions });
  const dialog = controller.dialog(original)!;
  let notifications = 0;
  const leave = controller.subscribe(() => { notifications++; });
  dialog.onInputDraftChange!(original, { q: { selected: 'Second', other: 'keep hidden draft' } });
  leave();
  assert.equal(notifications, 1);
  const mini = miniApprovalRequests(controller, 'host-a', 'thread-a')[0]!;
  assert.equal(mini.kind, 'question');
  if (mini.kind !== 'question') throw new Error('expected question');
  assert.equal(mini.request.inputDraft.q?.selected, 'Second');
  updateMiniApprovalDraft(controller, original, { q: { selected: 'First', other: 'keep hidden draft' } });
  assert.deepEqual(controller.dialog(original)?.inputDraft, { q: { selected: 'First', other: 'keep hidden draft' } });
  assert.deepEqual(miniPendingApprovalRefs(controller), [original]);
  await assert.rejects(respondFromMini(controller, original, { answers: { q: { answers: ['Second'] } } }));
  assert.equal(client.replies.length, 0);
  await respondFromMini(controller, original, { answers: { q: { answers: ['First'] } } });
  assert.deepEqual(client.replies[0], { ref: original, response: { result: { answers: { q: { answers: ['First'] } } } } });
  assert.equal(state(controller, original).outcome, 'sent');
  assert.deepEqual(miniPendingApprovalRefs(controller), []);
  controller.dispose();
});

test('disconnect during reply remains unknown and cannot be replayed on reconnect or late acknowledgement', async () => {
  const client = new FakeClient(), controller = new ApprovalRequestsController(client), original = ref('a');
  const pending = deferred<void>(); client.replyAction = () => pending.promise;
  request(client, original, 'item/tool/requestUserInput', { questions });
  const binding = controller.dialog(original)!;
  assert.equal(binding.onBegin!(original), true);
  binding.onOutcome!(original, 'sending');
  const reply = binding.onRespond({ answers: { q: { answers: ['First'] } } });
  assert.equal(state(controller, original).outcome, 'sending');
  client.emit({ type: 'connection-state', state: 'disconnected' });
  assert.equal(state(controller, original).outcome, 'unknown');
  assert.equal(state(controller, original).current, false);
  client.emit({ type: 'connection-state', state: 'connected' });
  pending.resolve(); await assert.rejects(reply);
  binding.onOutcome!(original, 'sent');
  assert.equal(state(controller, original).outcome, 'unknown');
  await assert.rejects(controller.respond(original, { decision: 'accept' }));
  assert.equal(client.replies.length, 1);
  controller.dispose();
});

test('new generation never inherits a late reply or an uncorrelated resolved event', async () => {
  const client = new FakeClient(), controller = new ApprovalRequestsController(client);
  const first = ref('a'), next = ref('b'), held = deferred<void>(); client.replyAction = () => held.promise;
  request(client, first, 'item/tool/requestUserInput', { questions });
  const reply = controller.respond(first, { answers: { q: { answers: ['First'] } } });
  request(client, next, 'item/tool/requestUserInput', { questions });
  assert.equal(state(controller, first).outcome, 'unknown');
  assert.equal(state(controller, next).outcome, 'ready');
  held.resolve(); await assert.rejects(reply);
  assert.equal(state(controller, next).outcome, 'ready');
  resolved(client, first, true);
  assert.equal(controller.getSnapshot().length, 1);
  assert.equal(state(controller, next).outcome, 'ready');
  resolved(client, first, false);
  assert.equal(state(controller, next).outcome, 'unknown');
  assert.equal(state(controller, next).current, false);
  await assert.rejects(controller.respond(next, { decision: 'accept' }));
  assert.equal(client.replies.length, 1);
  resolved(client, next, true, 'wrong-thread');
  assert.equal(controller.getSnapshot().length, 1);
  resolved(client, next, true);
  assert.equal(controller.getSnapshot().length, 0);
  controller.dispose();
});

test('only a known undispatched reply plus a current exact-ref check can unlock retry', async () => {
  const client = new FakeClient(), check = deferred<boolean>(), original = ref('a');
  let checks = 0;
  const controller = new ApprovalRequestsController(client, { verifyPending: async candidate => {
    checks++; assert.deepEqual(candidate, original); return check.promise;
  } });
  client.replyAction = async () => { throw Object.assign(new Error('not dispatched'), { uncertain: false }); };
  request(client, original, 'item/tool/requestUserInput', { questions });
  const failed = controller.respond(original, { answers: {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(state(controller, original).outcome, 'unknown');
  assert.equal(checks, 1);
  check.resolve(true); await assert.rejects(failed);
  assert.equal(state(controller, original).outcome, 'ready');
  client.replyAction = async () => {};
  await controller.respond(original, { answers: { q: { answers: ['First'] } } });
  assert.equal(client.replies.length, 2);
  assert.equal(state(controller, original).outcome, 'sent');
  controller.dispose();
});

test('a late verification cannot revive a disconnected or superseded request', async () => {
  const client = new FakeClient(), check = deferred<boolean>(), original = ref('a');
  const controller = new ApprovalRequestsController(client, { verifyPending: () => check.promise });
  client.replyAction = async () => { throw Object.assign(new Error('not dispatched'), { uncertain: false }); };
  request(client, original, 'item/tool/requestUserInput', { questions });
  const failed = controller.respond(original, { answers: {} });
  await new Promise(resolve => setImmediate(resolve));
  client.emit({ type: 'codex-app-server-connection-changed', hostId: 'host-a', state: 'disconnected' });
  check.resolve(true); await assert.rejects(failed);
  assert.equal(state(controller, original).outcome, 'unknown');
  assert.equal(state(controller, original).current, false);
  await assert.rejects(controller.respond(original, { answers: {} }));
  controller.dispose();
});

test('an unknown reply cannot be rearmed by a later pending check', async () => {
  const client = new FakeClient(), original = ref('a');
  let checks = 0;
  const controller = new ApprovalRequestsController(client, { verifyPending: async () => { checks++; return true; } });
  client.replyAction = async () => { throw Object.assign(new Error('unknown'), { uncertain: true }); };
  request(client, original, 'item/tool/requestUserInput', { questions });
  const binding = controller.dialog(original)!;
  assert.equal(binding.onBegin!(original), true);
  await assert.rejects(binding.onRespond({ answers: {} }));
  assert.equal(await binding.onCheckRequestValidity!(original), false);
  binding.onOutcome!(original, 'ready');
  assert.equal(state(controller, original).outcome, 'unknown');
  assert.equal(checks, 0);
  controller.dispose();
});

test('a preflight check cannot unlock an operation that later became unknown', async () => {
  const client = new FakeClient(), controller = new ApprovalRequestsController(client, { verifyPending: async () => true });
  const original = ref('auth');
  request(client, original, 'mcpServer/elicitation/request', { mode: 'form' });
  const binding = controller.dialog(original)!;
  assert.equal(binding.onBegin!(original), true);
  assert.equal(await binding.onCheckRequestValidity!(original), true);
  binding.onOutcome!(original, 'unknown');
  binding.onOutcome!(original, 'ready');
  assert.equal(state(controller, original).outcome, 'unknown');
  controller.dispose();
});

test('per-answer updates preserve other surface edits and multi-question Mini opens the full request', () => {
  const client = new FakeClient(), controller = new ApprovalRequestsController(client), original = ref('multi');
  request(client, original, 'item/tool/requestUserInput', { questions: [...questions,
    { id: 'q2', question: 'Second question', options: [{ label: 'Yes' }, { label: 'No' }] }] });
  const main = controller.dialog(original)!;
  main.onInputAnswerChange!(original, 'q', { selected: 'Second', other: '' });
  controller.updateInputAnswer(original, 'q2', { selected: 'No', other: '' });
  main.onInputAnswerChange!(original, 'q', { selected: 'First', other: '' });
  assert.deepEqual(state(controller, original).inputDraft, {
    q: { selected: 'First', other: '' }, q2: { selected: 'No', other: '' },
  });
  assert.equal(projectMiniApproval(state(controller, original)).kind, 'open');
  controller.dispose();
});

test('two dialog surfaces cannot reserve the same request, including private host actions', () => {
  const client = new FakeClient(), controller = new ApprovalRequestsController(client), original = ref('one');
  request(client, original, 'mcpServer/elicitation/request', { mode: 'form' });
  const main = controller.dialog(original)!, duplicate = controller.dialog(original)!;
  assert.equal(main.onCheckRequestValidity, undefined);
  assert.equal(main.onBegin!(original), true);
  assert.equal(duplicate.onBegin!(original), false);
  duplicate.onOutcome!(original, 'sent');
  assert.equal(state(controller, original).outcome, 'sending');
  main.onOutcome!(original, 'sent');
  assert.equal(state(controller, original).outcome, 'sent');
  assert.equal(duplicate.onBegin!(original), false);
  controller.dispose();
});

test('a stale dialog snapshot cannot submit over a newer answer from another surface', () => {
  const client = new FakeClient(), controller = new ApprovalRequestsController(client), original = ref('one');
  request(client, original, 'item/tool/requestUserInput', { questions });
  const stale = controller.dialog(original)!;
  updateMiniApprovalDraft(controller, original, { q: { selected: 'Second', other: '' } });
  assert.equal(stale.onBegin!(original), false);
  const fresh = controller.dialog(original)!;
  assert.equal(fresh.onBegin!(original), true);
  assert.equal(state(controller, original).outcome, 'sending');
  controller.dispose();
});

test('resolved notification and stale bindings cannot complete a later request', async () => {
  const client = new FakeClient(), controller = new ApprovalRequestsController(client), original = ref('a');
  const pending = deferred<void>(); client.replyAction = () => pending.promise;
  request(client, original, 'item/tool/requestUserInput', { questions });
  const oldBinding = controller.dialog(original)!;
  assert.equal(oldBinding.onBegin!(original), true);
  const sent = oldBinding.onRespond({ answers: {} });
  resolved(client, original, true);
  assert.equal(controller.getSnapshot().length, 0);
  request(client, original, 'item/tool/requestUserInput', { questions });
  assert.equal(controller.getSnapshot().length, 0);
  const replacement = ref('b'); request(client, replacement, 'item/tool/requestUserInput', { questions });
  pending.resolve(); await assert.rejects(sent);
  oldBinding.onOutcome!(original, 'sent');
  oldBinding.onInputDraftChange!(original, { q: { selected: 'Second', other: '' } });
  assert.equal(state(controller, replacement).outcome, 'ready');
  assert.deepEqual(state(controller, replacement).inputDraft, {});
  assert.equal(oldBinding.onBegin!(original), false);
  controller.dispose();
});

test('an uncorrelated resolution does not erase a positively acknowledged reply', async () => {
  const client = new FakeClient(), controller = new ApprovalRequestsController(client), original = ref('one');
  request(client, original, 'item/tool/requestUserInput', { questions });
  await controller.respond(original, { answers: { q: { answers: ['First'] } } });
  resolved(client, original, false);
  assert.equal(state(controller, original).outcome, 'sent');
  assert.equal(state(controller, original).current, false);
  resolved(client, original, true);
  assert.equal(controller.getSnapshot().length, 0);
  controller.dispose();
});

test('Mini uses exact declared command decisions and leaves rich or secret requests for the main view', async () => {
  const client = new FakeClient(), controller = new ApprovalRequestsController(client), original = ref('cmd');
  request(client, original, 'item/commandExecution/requestApproval', { command: 'git status', cwd: '/work', availableDecisions: ['decline'] });
  const simple = projectMiniApproval(state(controller, original));
  assert.equal(simple.kind, 'approval');
  if (simple.kind !== 'approval') throw new Error('expected approval');
  assert.deepEqual(simple.request.choices, [{ label: 'Decline', result: { decision: 'decline' } }]);
  assert.match(simple.request.detail!, /git status/);
  await assert.rejects(respondFromMini(controller, original, { decision: 'accept' }));
  await respondFromMini(controller, original, { decision: 'decline' });
  assert.deepEqual(client.replies[0]?.response, { result: { decision: 'decline' } });

  const secret = ref('secret', 'host-a', 2);
  request(client, secret, 'item/tool/requestUserInput', { questions: [{ ...questions[0], isSecret: true }] });
  const rich = ref('rich', 'host-a', 3);
  request(client, rich, 'mcpServer/elicitation/request', { mode: 'form', requestedSchema: { type: 'object' } });
  const policy = ref('policy', 'host-a', 4);
  request(client, policy, 'item/commandExecution/requestApproval', { command: 'git status', cwd: '/work',
    availableDecisions: ['accept'], proposedExecpolicyAmendment: ['git'] });
  for (const value of [secret, rich, policy]) assert.equal(projectMiniApproval(state(controller, value)).kind, 'open');
  await assert.rejects(respondFromMini(controller, secret, { answers: {} }));
  assert.equal(client.replies.length, 1);
  controller.dispose();
});

test('host loss affects only its original requests, and duplicate events do not revive them', () => {
  const client = new FakeClient(), controller = new ApprovalRequestsController(client);
  const local = ref('a'), remote = ref('a', 'host-b');
  request(client, local, 'item/tool/requestUserInput', { questions });
  request(client, remote, 'item/tool/requestUserInput', { questions });
  client.emit({ type: 'codex-app-server-connection-changed', hostId: 'host-a', state: 'disconnected' });
  assert.equal(state(controller, local).outcome, 'expired');
  assert.equal(state(controller, remote).outcome, 'ready');
  client.emit({ type: 'codex-app-server-connection-changed', hostId: 'host-a', state: 'connected' });
  request(client, local, 'item/tool/requestUserInput', { questions });
  assert.equal(state(controller, local).outcome, 'expired');
  assert.equal(state(controller, remote).outcome, 'ready');
  controller.dispose();
});
