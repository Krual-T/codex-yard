import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  clearRequestActivity, insertRequestActivity, isPendingActivity, placeRequestActivity, readDisplayAnswers,
  readRequestActivity, recordRequestActivity, settleRequestActivity,
} from '../src/workspace/turn-request-activity.ts';

test('an MCP request keeps its original place between tool calls and its first recorded outcome', () => {
  const request = { hostId: 'local', threadId: 'receipt-thread', turnId: 'turn', id: 7 };
  recordRequestActivity(request, { type: 'yardMcpRequest', serverName: 'report-fixture', message: 'Review the report.' });
  placeRequestActivity(request, 'before');
  const pending = readRequestActivity(request);
  placeRequestActivity(request, 'after');
  assert.equal(readRequestActivity(request), pending);
  assert.equal(pending[0]?.afterItemId, 'before');
  assert.equal(pending[0]?.outcome, undefined);
  settleRequestActivity(request, 'accept');
  settleRequestActivity(request, 'cancel');
  const done = readRequestActivity(request);
  assert.equal(done[0]?.id, pending[0]?.id);
  assert.equal(done[0]?.outcome, 'accept');
  assert.equal(pending[0]?.outcome, undefined);
  const items = [{ id: 'before', type: 'commandExecution' }, { id: 'after', type: 'commandExecution' }];
  assert.deepEqual(insertRequestActivity(items, done).map(item => item.id), ['before', done[0]!.id, 'after']);
  clearRequestActivity(request.hostId, request.threadId);
});

test('host, thread and turn isolate receipts even when the backend reuses request IDs', () => {
  const local = { hostId: 'local', threadId: 'scope-thread', turnId: 'turn', id: 7 };
  const remote = { ...local, hostId: 'remote' };
  const otherTurn = { ...local, turnId: 'other-turn' };
  recordRequestActivity(local, { type: 'yardMcpRequest', serverName: 'Local', message: 'A' });
  recordRequestActivity(remote, { type: 'yardMcpRequest', serverName: 'Remote', message: 'B' });
  recordRequestActivity(otherTurn, { type: 'yardMcpRequest', serverName: 'Local', message: 'C' });
  settleRequestActivity(local, 'decline');
  assert.equal(readRequestActivity(remote)[0]?.outcome, undefined);
  assert.equal(readRequestActivity(otherTurn)[0]?.outcome, undefined);
  settleRequestActivity(remote);
  assert.equal(readRequestActivity(remote)[0]?.outcome, 'resolved');
  clearRequestActivity(local.hostId, local.threadId);
  assert.equal(readRequestActivity(local).length, 0);
  assert.equal(readRequestActivity(otherTurn).length, 0);
  assert.equal(readRequestActivity(remote).length, 1);
  clearRequestActivity(remote.hostId, remote.threadId);
});

test('question receipts retain their order and only display non-secret answers', () => {
  const scope = { hostId: 'local', threadId: 'question-thread', turnId: 'turn', id: 7 };
  const questions = [{ id: 'choice', question: 'Which option?', secret: false },
    { id: 'secret', question: 'Enter your secret', secret: true },
    { id: 'missing', question: 'Any notes?', secret: false }];
  const items = [{ id: 'before', type: 'commandExecution' }, { id: 'after', type: 'commandExecution' }];
  recordRequestActivity(scope, { type: 'yardInputRequest', questions });
  placeRequestActivity(scope, 'before');
  const pending = readRequestActivity(scope);
  assert.equal(isPendingActivity(pending[0]!), true);
  const submitted = readDisplayAnswers(questions, { choice: { answers: ['First', 'Second'] },
    secret: { answers: ['private-fixture-only'] } });
  settleRequestActivity(scope, submitted);
  settleRequestActivity(scope);
  const settled = readRequestActivity(scope);
  assert.equal(isPendingActivity(settled[0]!), false);
  assert.equal(isPendingActivity(pending[0]!), true);
  assert.deepEqual(settled[0]?.answers, ['First, Second', '\u2022\u2022\u2022\u2022\u2022\u2022', null]);
  assert.equal(JSON.stringify(settled).includes('private-fixture-only'), false);
  assert.deepEqual(insertRequestActivity(items, settled).map(item => item.id), ['before', pending[0]!.id, 'after']);
  clearRequestActivity(scope.hostId, scope.threadId);
});

test('clearing a question without a reply settles the receipt without any answer', () => {
  const input = { hostId: 'remote', threadId: 'request-clear-thread', turnId: 'turn', id: 8 };
  recordRequestActivity(input, { type: 'yardInputRequest', questions: [{ id: 'q', question: 'Continue?', secret: false }] });
  settleRequestActivity(input);
  const rows = readRequestActivity(input);
  assert.equal(rows.length, 1);
  assert.equal(isPendingActivity(rows[0]!), false);
  assert.deepEqual(rows[0]?.answers, []);
  clearRequestActivity(input.hostId, input.threadId);
});
