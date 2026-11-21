import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TurnSummary } from '../lib/codex-protocol.ts';
import { conversationScope, PendingMessages, withPendingMessages } from '../src/workspace/pending-messages.ts';

const turn: TurnSummary = { id: 'active', status: 'inProgress', itemsView: 'full', items: [
  { id: 'first', type: 'userMessage', content: [] },
  { id: 'before', type: 'agentMessage', phase: 'commentary', text: 'Before.' },
] };
const pending = { id: 'client-id', input: [{ type: 'text', text: 'Follow up.' }], turnId: turn.id, after: 'before', startedAt: 1 };

test('optimistic follow-ups stay at the click position while new work arrives', () => {
  const updated = { ...turn, items: [...turn.items, { id: 'after', type: 'commandExecution' }] };
  const merged = withPendingMessages([updated], [pending]);
  assert.deepEqual(merged[0]?.items.map(item => item.id), ['first', 'before', 'preparing:client-id', 'after']);
  assert.equal(updated.items.length, 3, 'Preparing messages do not change the canonical turn.');
});

test('canonical receipts replace preparations by client ID, including receipts before the RPC reply', () => {
  const message = { id: 'saved', type: 'userMessage', clientId: pending.id, content: pending.input };
  const saved = { ...turn, items: [...turn.items, message] };
  assert.deepEqual(withPendingMessages([saved], [pending])[0]?.items, saved.items);
  const store = new PendingMessages();
  let updates = 0;
  const scope = conversationScope('thread', 'remote');
  store.subscribe(scope, () => { updates++; });
  store.add(scope, pending);
  store.confirm('thread', [saved]);
  assert.equal(store.read(scope).length, 1, 'Another host cannot confirm a submission.');
  store.confirm(scope, [{ ...saved, items: [{ ...message, clientId: 'other-id' }] }]);
  assert.equal(store.read(scope).length, 1, 'Equal text is not a receipt.');
  store.confirm(scope, [saved]);
  assert.equal(store.read(scope).length, 0);
  assert.equal(updates, 2);
});

test('new turns and rejected submissions do not alter saved conversation history', () => {
  const store = new PendingMessages(), message = { ...pending, turnId: undefined, afterTurnId: turn.id };
  store.add('thread', message);
  const shown = withPendingMessages([turn], store.read('thread'));
  assert.equal(shown.length, 2);
  assert.equal(shown[1]?.items[0]?.preparing, true);
  store.remove('thread', message.id);
  assert.deepEqual(withPendingMessages([turn], store.read('thread')), [turn]);
});

test('new prompts retain their send position when turn notifications precede the user receipt', () => {
  const previous: TurnSummary = { ...turn, status: 'completed' };
  const started: TurnSummary = { id: 'next', status: 'inProgress', items: [] };
  const message = { ...pending, turnId: undefined, afterTurnId: previous.id };
  const shown = withPendingMessages([previous, started], [message]);
  assert.deepEqual(shown.map(turn => turn.id), [previous.id, 'preparing:' + message.id, started.id]);
  assert.equal(shown[1]?.items[0]?.preparing, true);
  assert.deepEqual(started.items, [], 'The placeholder does not change the canonical turn.');
  const receipt = { ...started, items: [{ id: 'saved', type: 'userMessage', clientId: message.id }] };
  assert.deepEqual(withPendingMessages([previous, receipt], [message]), [previous, receipt]);
});

test('prompts sent without a prior turn stay ahead of incoming work and retain submission order', () => {
  const started: TurnSummary = { id: 'next', status: 'inProgress', items: [] };
  const first = { ...pending, turnId: undefined }, second = { ...first, id: 'second-id' };
  assert.deepEqual(withPendingMessages([started], [first, second]).map(turn => turn.id),
    ['preparing:' + first.id, 'preparing:' + second.id, started.id]);
});
