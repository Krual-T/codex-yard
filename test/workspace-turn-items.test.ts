import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyTurnItemEvent } from '../src/workspace/turn-item-events.ts';
import { mergeLiveTurns, TurnStream, type WorkspaceTurn } from '../src/workspace/turn-stream.ts';
import { turnChanges } from '../src/workspace/turn-changes.ts';
import type { ThreadItemSummary, TurnSummary } from '../lib/codex-protocol.ts';

test('early command output and commentary survive a later item start, and persisted output replaces the live text', () => {
  let output = applyTurnItemEvent('item/commandExecution/outputDelta', { itemId: 'cmd', delta: 'first\n' });
  output = applyTurnItemEvent('item/started', { item: { id: 'cmd', type: 'commandExecution', command: 'fixture', aggregatedOutput: null } }, output);
  output = applyTurnItemEvent('item/commandExecution/outputDelta', { itemId: 'cmd', delta: 'second' }, output);
  assert.deepEqual(output, { id: 'cmd', type: 'commandExecution', command: 'fixture', aggregatedOutput: 'first\nsecond' });
  assert.equal(applyTurnItemEvent('item/completed', {
    item: { id: 'cmd', type: 'commandExecution', aggregatedOutput: 'authoritative', exitCode: 0 },
  }, output)?.aggregatedOutput, 'authoritative');
  const early = applyTurnItemEvent('item/agentMessage/delta', { itemId: 'comment', delta: 'Working on it' });
  const started = applyTurnItemEvent('item/started', { item: { id: 'comment', type: 'agentMessage', phase: 'commentary', text: '' } }, early);
  assert.deepEqual(started, { id: 'comment', type: 'agentMessage', phase: 'commentary', text: 'Working on it' });
});

test('reasoning summaries, tool progress and patch revisions update only their corresponding item', () => {
  const initial = { id: 'reason', type: 'reasoning', summary: ['Opening files'] };
  assert.equal(applyTurnItemEvent('item/reasoning/textDelta', { itemId: initial.id, delta: 'unpublished content' }, initial), undefined);
  assert.equal(applyTurnItemEvent('item/reasoning/summaryTextDelta', { itemId: initial.id, summaryIndex: -1, delta: 'invalid' }, initial), undefined);
  assert.equal(applyTurnItemEvent('item/reasoning/summaryTextDelta', { itemId: 'other', summaryIndex: 0, delta: 'invalid' }, initial), undefined);
  const second = applyTurnItemEvent('item/reasoning/summaryPartAdded', { itemId: initial.id, summaryIndex: 1 }, initial);
  const combined = applyTurnItemEvent('item/reasoning/summaryTextDelta', { itemId: initial.id, summaryIndex: 1, delta: 'Reading results' }, second);
  assert.deepEqual(combined?.summary, ['Opening files', 'Reading results']);
  assert.deepEqual(initial.summary, ['Opening files']);
  const tool = applyTurnItemEvent('item/mcpToolCall/progress', { itemId: 'tool', message: 'Opening fixture' });
  assert.equal(tool?.activityProgress, 'Opening fixture');
  assert.equal(applyTurnItemEvent('item/plan/delta', { itemId: 'tool', delta: 'wrong type' }, tool), undefined);
  const changes = [{ path: 'demo.ts', kind: { type: 'add' }, diff: '+sample' }];
  const patch = applyTurnItemEvent('item/fileChange/patchUpdated', { itemId: 'patch', changes });
  assert.deepEqual(patch?.changes, changes);
});

test('reconnection restores ordered activity and canonical timing without losing deltas received during the read', context => {
  const browser = new EventTarget();
  let frame: FrameRequestCallback | undefined;
  Object.assign(browser, { requestAnimationFrame(callback: FrameRequestCallback) { frame = callback; return 1; },
    cancelAnimationFrame() { frame = undefined; } });
  const stream = new TurnStream('thread');
  context.after(() => stream.disconnect());
  for (const [key, value] of Object.entries({ window: browser, location: { origin: 'http://workspace.test' } })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    context.after(() => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  }
  stream.connect();
  const flush = () => { const callback = frame; frame = undefined; callback?.(0); };
  function notify(method: string, params: Record<string, unknown>) {
    const event = new MessageEvent('message', { origin: 'http://workspace.test', data: {
      type: 'mcp-notification', hostId: 'local', method, params: { threadId: 'thread', turnId: 'turn', ...params },
    } });
    Object.defineProperty(event, 'source', { value: browser });
    browser.dispatchEvent(event);
  }
  const reason = { id: 'reason', type: 'reasoning', summary: ['Checking files', 'Testing results'] };
  const command = { id: 'command', type: 'commandExecution', status: 'completed', aggregatedOutput: 'done', exitCode: 0 };
  notify('turn/started', { turn: { id: 'turn', status: 'inProgress', items: [] } });
  notify('item/started', { item: reason });
  notify('item/completed', { item: command });
  flush();
  assert.equal(typeof stream.read()[0]?.startedAt, 'number', 'a live turn starts timing even before its saved timestamp is available');
  stream.recover([{ id: 'turn', status: 'inProgress', startedAt: 100, itemsView: 'full', items: [
    { id: 'prompt', type: 'userMessage' }, { ...reason, summary: ['Checking'] },
    { ...command, status: 'inProgress', aggregatedOutput: 'do', exitCode: undefined },
  ] }]);
  flush();
  assert.equal(stream.read()[0]?.startedAt, 100);
  assert.deepEqual(stream.read()[0]?.items.map(item => item.id), ['prompt', 'reason', 'command']);
  assert.deepEqual(stream.read()[0]?.items[1]?.summary, reason.summary);
  assert.deepEqual(stream.read()[0]?.items[2], command);
  notify('turn/started', { turn: { id: 'turn', status: 'inProgress', items: [] } });
  flush();
  assert.equal(stream.read()[0]?.startedAt, 100, 'reattachment must preserve the saved start time');
  notify('turn/completed', { turn: { id: 'turn', status: 'completed', items: [] } });
  stream.recover([{ id: 'turn', status: 'inProgress', startedAt: 100, items: [] }]);
  flush();
  assert.equal(stream.read()[0]?.status, 'completed', 'a stale read must not reopen an already completed turn');
});

test('a saved active summary keeps live tools and a saved terminal turn replaces transient activity', () => {
  const item = (id: string, type: string, attributes = {}): ThreadItemSummary => ({ id, type, ...attributes });
  const history: TurnSummary = { id: 'turn', status: 'inProgress', items: [item('user', 'userMessage')] };
  const live: TurnSummary = { id: 'turn', status: 'inProgress', items: [item('tool', 'commandExecution', { aggregatedOutput: 'live' })] };
  assert.deepEqual(mergeLiveTurns([history], [live])[0]?.items.map(row => row.id), ['user', 'tool']);
  const saved: TurnSummary = { ...history, status: 'completed', itemsView: 'summary', items: [...history.items, item('answer', 'agentMessage')] };
  assert.deepEqual(mergeLiveTurns([saved], [live]), [saved]);
  assert.deepEqual(mergeLiveTurns([saved], [{ ...live, diff: 'canonical turn patch' }]),
    [{ ...saved, diff: 'canonical turn patch' }]);
});

test('the renderer keeps the retry notice without replacing a saved terminal error or reopening the turn', () => {
  const saved: TurnSummary = { id: 'turn', status: 'failed', itemsView: 'summary',
    error: { message: 'Provider failed' }, items: [{ id: 'user', type: 'userMessage' }] };
  const late: WorkspaceTurn = { id: saved.id, status: 'inProgress', items: [{ id: 'tool', type: 'commandExecution' }],
    retryMessage: 'Reconnecting 1/5' };
  assert.deepEqual(mergeLiveTurns([saved], [late]),
    [{ ...saved, retryMessage: late.retryMessage }]);
});

test('interrupted summaries keep observed activity until full history replaces it', () => {
  const prompt = { id: 'user', type: 'userMessage' };
  const liveProgress = { id: 'progress', type: 'agentMessage', phase: 'commentary', text: 'Checking…' };
  const lateReply = { id: 'live-answer', type: 'agentMessage', phase: 'final_answer', text: 'Uncommitted reply' };
  const savedReply = { id: 'saved-answer', type: 'agentMessage', phase: 'final_answer', text: 'Saved reply' };
  const live: WorkspaceTurn = { id: 'turn', status: 'interrupted', items: [prompt, liveProgress, lateReply] };
  const summary: TurnSummary = { id: live.id, status: 'interrupted', itemsView: 'summary', items: [prompt, savedReply] };
  assert.deepEqual(mergeLiveTurns([summary], [live]), [{ ...summary, items: [prompt, liveProgress, savedReply] }]);
  const full: TurnSummary = { ...summary, itemsView: 'full', items: [prompt, { ...liveProgress, text: 'Checked.' }, savedReply] };
  assert.deepEqual(mergeLiveTurns([full], [live]), [full]);
});

test('a completed summary only carries over activity for the inspected turn', () => {
  const command = { id: 'cmd', type: 'commandExecution', aggregatedOutput: 'Observed command result' };
  const answer = { id: 'saved-answer', type: 'agentMessage', phase: 'final_answer', text: 'Saved reply' };
  const observed = [{ id: 'turn', status: 'completed', items: [command,
    { ...answer, id: 'activity-answer', text: 'Stale reply' }] }] satisfies WorkspaceTurn[];
  const saved: TurnSummary = { id: 'turn', status: 'completed', itemsView: 'summary', items: [answer] };
  assert.deepEqual(mergeLiveTurns([saved], observed, 'another-turn'), [saved]);
  assert.deepEqual(mergeLiveTurns([saved], observed, saved.id), [{ ...saved, items: [command, answer] }]);
  const full: TurnSummary = { ...saved, itemsView: 'full', items: [{ ...command, aggregatedOutput: 'Saved command result' }, answer] };
  assert.deepEqual(mergeLiveTurns([full], observed, saved.id), [full]);
});

test('the latest turn diff wins over item patches and reports files and line counts', () => {
  const diff = 'diff --git a/report.md b/report.md\n--- a/report.md\n+++ b/report.md\n@@ -1 +1,2 @@\n-old\n+new\n++++ heading\n' +
    'diff --git a/old.md b/new.md\nsimilarity index 100%\nrename from old.md\nrename to new.md\n' +
    'diff --git a/deleted.md b/deleted.md\ndeleted file mode 100644\n--- a/deleted.md\n+++ /dev/null\n@@ -1 +0,0 @@\n-removed\n';
  const turn = { id: 'turn', status: 'inProgress', items: [
    { id: 'file', type: 'fileChange', status: 'completed', changes: [{ path: 'item-only', diff: '+older' }] },
  ], diff } satisfies TurnSummary & { diff: string };
  const { files, added, removed } = turnChanges(turn);
  assert.deepEqual(files.map(({ path, added, removed }) => ({ path, added, removed })), [
    { path: 'report.md', added: 2, removed: 1 },
    { path: 'new.md', added: 0, removed: 0 },
    { path: 'deleted.md', added: 0, removed: 1 },
  ]);
  assert.equal(added, 2);
  assert.equal(removed, 2);
  assert.equal(turnChanges({ ...turn, diff: '' }).files.length, 0, 'The backend can report a net-zero diff.');
});

test('history and interrupted turns show applied edits without proposals or declined patches', () => {
  const file = (status: string, path: string, diff = '@@ -1 +1 @@\n-old\n+new') =>
    ({ id: path, type: 'fileChange', status, changes: [{ path: '/fixture/project/' + path, diff }] });
  const items = [file('inProgress', 'pending'), file('declined', 'declined'), file('failed', 'failed'),
    file('completed', 'report.md'), file('completed', 'report.md', '@@ -1 +1,2 @@\n-new\n+updated\n+second')];
  const changes = turnChanges({ id: 'turn', status: 'interrupted', items }, '/fixture/project');
  assert.deepEqual(changes.files.map(file => file.path), ['report.md']);
  assert.equal(changes.files[0]?.patches.length, 2);
  assert.equal(changes.added, 3);
  assert.equal(changes.removed, 2);
});
