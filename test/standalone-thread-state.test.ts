import test from 'node:test';
import assert from 'node:assert/strict';
import { applyThreadEvent, isThreadBusy } from '../src/renderer/app/thread-state.ts';
import { loadThread, reconcileThreadSnapshot } from '../src/renderer/app/load-thread.ts';
import type { WorkbenchClient } from '../src/renderer/workbench-contract.ts';
import type { ThreadSummary, TurnSummary } from '../lib/codex-protocol.ts';

const empty = (): ThreadSummary => ({ id: 'thread', name: null, cwd: '/fixture', status: { type: 'idle' }, turns: [] });
const event = (method: string, params: Record<string, unknown>) => ({ type: 'mcp-notification', hostId: 'local', method, params: { threadId: 'thread', ...params } });

test('streamed items, final item and completion preserve one turn and authoritative text', () => {
  const original = empty();
  let value = applyThreadEvent(original, event('turn/started', { turn: { id: 'turn', items: [], status: 'inProgress' } }));
  value = applyThreadEvent(value, event('item/agentMessage/delta', { turnId: 'turn', itemId: 'message', delta: 'Hello ' }));
  value = applyThreadEvent(value, event('item/agentMessage/delta', { turnId: 'turn', itemId: 'message', delta: 'world' }));
  assert.equal(value.turns?.[0]?.items?.[0]?.text, 'Hello world');
  assert.equal(isThreadBusy(value), true);
  value = applyThreadEvent(value, event('item/completed', { turnId: 'turn', item: { id: 'message', type: 'agentMessage', text: 'Hello world!' } }));
  value = applyThreadEvent(value, event('turn/completed', { turn: { id: 'turn', status: 'completed' } }));
  assert.equal(value.turns?.length, 1);
  assert.equal(value.turns?.[0]?.items?.length, 1);
  assert.equal(value.turns?.[0]?.items?.[0]?.text, 'Hello world!');
  assert.equal(isThreadBusy(value), false);
  assert.deepEqual(original, empty());
});

test('host selection owner can ignore unrelated threads and tool output stays separate', () => {
  const original = empty();
  assert.equal(applyThreadEvent(original, event('turn/started', { threadId: 'other', turn: { id: 'x' } })), original);
  const value = applyThreadEvent(original, event('item/commandExecution/delta', { turnId: 'turn', itemId: 'cmd', delta: '$ pwd\n/project' }));
  assert.equal(value.turns?.[0]?.items?.[0]?.aggregatedOutput, '$ pwd\n/project');
  assert.equal(value.turns?.[0]?.items?.[0]?.text, undefined);
});

const key = JSON.stringify(['turn', 'agent']);
const start = event('item/started', { turnId: 'turn', item: { id: 'agent', type: 'agentMessage', text: '' } });
const delta = (text: string) => event('item/agentMessage/delta', { turnId: 'turn', itemId: 'agent', delta: text });
const user = { id: 'user', type: 'userMessage', content: [{ type: 'text', text: 'Scripted input', text_elements: [] }] };

test('CLI 0.164 summary completion preserves the user and streamed output', () => {
  // Shape captured from the isolated scripted-provider probe; no model inference.
  let thread = applyThreadEvent(empty(), event('turn/started', { turn: { id: 'turn', items: [user], itemsView: 'summary', status: 'inProgress' } }));
  thread = applyThreadEvent(thread, start);
  thread = applyThreadEvent(thread, delta('fixture-A'));
  thread = applyThreadEvent(thread, delta('-B'));
  assert.equal(isThreadBusy(thread), true);
  thread = applyThreadEvent(thread, event('item/completed', { turnId: 'turn', item: { type: 'agentMessage', id: 'agent', text: 'fixture-A-B' } }));
  thread = applyThreadEvent(thread, event('turn/completed', { turn: { id: 'turn', status: 'completed', itemsView: 'summary',
    items: [{ type: 'agentMessage', id: 'agent', text: 'fixture-A-B' }], error: null, startedAt: 1, completedAt: 2, durationMs: 82 } }));
  assert.deepEqual(thread.turns?.[0]?.items?.map(item => item.id), ['user', 'agent']);
  assert.equal(thread.turns?.[0]?.items?.[1]?.text, 'fixture-A-B');
  assert.equal(isThreadBusy(thread), false);
});

test('actual reasoning and command output event names maintain separate indexed parts', () => {
  let thread = applyThreadEvent(empty(), event('item/reasoning/summaryTextDelta', { turnId: 'turn', itemId: 'reasoning', summaryIndex: 1, delta: 'summary' }));
  thread = applyThreadEvent(thread, event('item/reasoning/textDelta', { turnId: 'turn', itemId: 'reasoning', contentIndex: 0, delta: 'details' }));
  thread = applyThreadEvent(thread, event('item/commandExecution/outputDelta', { turnId: 'turn', itemId: 'cmd', delta: '$ pwd\n/project' }));
  assert.equal((thread.turns?.[0]?.items?.[0]?.summary as string[])[1], 'summary');
  assert.deepEqual(thread.turns?.[0]?.items?.[0]?.content, ['details']);
  assert.equal(thread.turns?.[0]?.items?.[1]?.aggregatedOutput, '$ pwd\n/project');
});

test('a completed AB snapshot does not append buffered B a second time', () => {
  const snapshot = { thread: { ...empty(), turns: [{ id: 'turn', status: 'completed' as const, itemsView: 'full' as const, items: [user, { id: 'agent', type: 'agentMessage', text: 'AB' }] }] } };
  const thread = reconcileThreadSnapshot(snapshot, null, [start, delta('A'), delta('B')], new Set([key]));
  assert.equal(thread.turns?.[0]?.items?.[1]?.text, 'AB');
  assert.equal(thread.turns?.[0]?.status, 'completed');
});

test('running history without assistant prefix never erases observed output', () => {
  const snapshot = { thread: { ...empty(), turns: [{ id: 'turn', status: 'inProgress' as const, itemsView: 'full' as const, items: [user] }] } };
  let previous = applyThreadEvent(empty(), start);
  previous = applyThreadEvent(previous, delta('A'));
  const thread = reconcileThreadSnapshot(snapshot, previous, [delta('B')], new Set([key]));
  assert.equal(thread.turns?.[0]?.items?.find(item => item.id === 'agent')?.text, 'AB');
  assert.equal(thread.turns?.[0]?.items?.find(item => item.id === 'agent')?.partialStart, undefined);
});

test('joining an already streaming item marks its suffix until a full item arrives', () => {
  const thread = reconcileThreadSnapshot({ thread: empty() }, null, [delta('B')], new Set());
  assert.equal(thread.turns?.[0]?.items?.[0]?.text, 'B');
  assert.equal(thread.turns?.[0]?.items?.[0]?.partialStart, true);
  const complete = applyThreadEvent(thread, event('item/completed', { turnId: 'turn', item: { id: 'agent', type: 'agentMessage', text: 'AB' } }));
  assert.equal(complete.turns?.[0]?.items?.[0]?.text, 'AB');
  assert.equal(complete.turns?.[0]?.items?.[0]?.partialStart, undefined);
});

test('history reads all turn and item pages using the selected host', async () => {
  const calls: { method: string; params: Record<string, unknown>; hostId?: string }[] = [];
  const client = { async rpc(method: string, params: Record<string, unknown>, hostId?: string) {
    calls.push({ method, params, hostId });
    if (method === 'thread/read') return { thread: empty() };
    if (method === 'thread/turns/list') return { data: [{ id: params.cursor ? 'second' : 'first', items: [], itemsView: 'summary', status: 'completed' }], nextCursor: params.cursor ? null : 'turn-next' };
    return { data: [{ item: { id: params.cursor ? 'b' : 'a', type: 'agentMessage', text: 'saved' } }], nextCursor: params.cursor ? null : 'item-next' };
  } } as unknown as WorkbenchClient;
  const snapshot = await loadThread(client, 'ssh-fixture', 'thread');
  assert.equal(calls.length, 7);
  assert.ok(calls.every(call => call.hostId === 'ssh-fixture'));
  assert.deepEqual(snapshot.thread.turns?.map(turn => turn.id), ['first', 'second']);
  assert.deepEqual(snapshot.thread.turns?.[1]?.items?.map(item => item.id), ['a', 'b']);
});

test('repeated history cursors fail visibly instead of looping or silently truncating', async () => {
  const client = { async rpc(method: string) {
    return method === 'thread/read' ? { thread: empty() } : { data: [], nextCursor: 'same' };
  } } as unknown as WorkbenchClient;
  await assert.rejects(loadThread(client, 'local', 'thread'), /分页游标重复/);
});

test('a late running read cannot undo a completion or erase a completed observed item', () => {
  let thread = applyThreadEvent(empty(), start);
  thread = applyThreadEvent(thread, event('item/completed', { turnId: 'turn', item: { id: 'agent', type: 'agentMessage', text: 'AB' } }));
  thread = applyThreadEvent(thread, event('turn/completed', { turn: { id: 'turn', status: 'completed', items: [], itemsView: 'summary' } }));
  const stale: TurnSummary = { id: 'turn', status: 'inProgress', itemsView: 'notLoaded', items: [user] };
  const result = reconcileThreadSnapshot({ thread: { ...empty(), status: { type: 'active', activeFlags: [] }, turns: [stale] } }, thread, [], new Set());
  assert.equal(result.turns[0]?.status, 'completed');
  assert.deepEqual(result.turns[0]?.items.map(item => item.id), ['user', 'agent']);
  assert.equal(result.turns[0]?.items[1]?.text, 'AB');
  assert.equal(isThreadBusy(result), false);
});

test('notLoaded and absent itemsView histories fetch their stored items before claiming fullness', async () => {
  const calls: string[] = [];
  const client = { async rpc(method: string, params: Record<string, unknown>) {
    calls.push(method);
    if (method === 'thread/read') return { thread: empty() };
    if (method === 'thread/turns/list') return { data: [{ id: 'one', status: 'completed', items: [], itemsView: 'notLoaded' },
      { id: 'two', status: 'completed', items: [] }], nextCursor: null };
    return { data: [{ item: { id: params.turnId, type: 'agentMessage', text: 'saved' } }], nextCursor: null };
  } } as unknown as WorkbenchClient;
  const { thread } = await loadThread(client, 'local', 'thread');
  assert.equal(calls.filter(method => method === 'thread/items/list').length, 2);
  assert.ok(thread.turns.every(turn => turn.itemsView === 'full' && turn.items.length === 1));
});

test('a revert invalidates an older snapshot and a complete empty history removes deleted turns', () => {
  const removed: TurnSummary = { id: 'removed', status: 'completed', itemsView: 'full', items: [user] };
  const previous = { ...empty(), turns: [removed] };
  const stale = reconcileThreadSnapshot({ thread: previous }, null, [event('thread/reverted', {})], new Set());
  assert.deepEqual(stale.turns, []);
  assert.deepEqual(reconcileThreadSnapshot({ thread: empty() }, previous, [], new Set()).turns, []);
  const started = event('turn/started', { turn: { id: 'new', status: 'inProgress', itemsView: 'notLoaded', items: [] } });
  const next = reconcileThreadSnapshot({ thread: previous }, previous, [event('thread/reverted', {}), started], new Set());
  assert.deepEqual(next.turns.map(turn => turn.id), ['new']);
});

test('a late start cannot reopen a terminal turn but activity after a history read remains', () => {
  const completed: TurnSummary = { id: 'turn', status: 'completed', itemsView: 'full', items: [user] };
  const previous = { ...empty(), turns: [completed] };
  assert.equal(applyThreadEvent(previous, event('turn/started', { turn: { id: 'turn', status: 'inProgress', items: [] } })), previous);
  const live = applyThreadEvent(empty(), start);
  const result = reconcileThreadSnapshot({ thread: empty() }, live, [delta('B')], new Set([key]));
  assert.equal(result.turns[0]?.items[0]?.text, 'B');
});
