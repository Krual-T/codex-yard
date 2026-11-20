import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activityRange, turnTimeline } from '../src/workspace/turn-timeline.ts';
import { mergeLiveTurns, TurnStream } from '../src/workspace/turn-stream.ts';
import type { ThreadItemSummary, TurnSummary } from '../lib/codex-protocol.ts';

const prompt = (id: string): ThreadItemSummary => ({ id, type: 'userMessage' });
const progress = (id: string): ThreadItemSummary => ({ id, type: 'agentMessage', phase: 'commentary', text: id });
const command = (id: string): ThreadItemSummary => ({ id, type: 'commandExecution' });
const answer = { id: 'answer', type: 'agentMessage', phase: 'final_answer', text: 'Done.' };

test('follow-ups split activity at their actual position and retain independent Work ranges', () => {
  const items = [prompt('first'), progress('before'), command('command-before'), prompt('follow-up'),
    progress('after'), command('command-after'), answer];
  const blocks = turnTimeline(items, false);
  assert.deepEqual(blocks.map(block => block.kind), ['prompt', 'activity', 'prompt', 'activity', 'answer']);
  const work = blocks.filter(block => block.kind === 'activity');
  assert.deepEqual(work.map(block => activityRange(items, block.after, block.before).map(item => item.id)),
    [['before', 'command-before'], ['after', 'command-after']]);
  const extended = turnTimeline([...items.slice(0, -1), prompt('second-follow-up')], true);
  assert.equal(extended[1]?.key, blocks[1]?.key, 'Streaming appends preserve the existing disclosure identity.');
});

test('saved summaries keep range boundaries for later full Work reads', () => {
  const summary = [prompt('first'), prompt('follow-up'), answer];
  const full = [summary[0]!, command('before'), summary[1]!, command('after'), answer];
  const blocks = turnTimeline(summary, false, true).filter(block => block.kind === 'activity');
  assert.deepEqual(blocks.map(block => activityRange(full, block.after, block.before).map(item => item.id)), [['before'], ['after']]);
});

test('a live full turn inserts missing activity between the user messages in a saved summary', () => {
  const first = prompt('first'), followUp = prompt('follow-up');
  const saved: TurnSummary = { id: 'turn', status: 'inProgress', itemsView: 'summary', items: [first, followUp] };
  const live: TurnSummary = { ...saved, itemsView: 'full', items: [first, progress('before'), followUp, progress('after')] };
  assert.deepEqual(mergeLiveTurns([saved], [live])[0]?.items.map(item => item.id), ['first', 'before', 'follow-up', 'after']);
  const partial: TurnSummary = { ...live, items: [followUp, progress('later')] };
  assert.deepEqual(mergeLiveTurns([live], [partial])[0]?.items.map(item => item.id),
    ['first', 'before', 'follow-up', 'after', 'later']);
});

test('async questions and image generations keep their positions among progress and replies', () => {
  const question = { id: 'question', type: 'agentMessage', phase: 'final_answer', delivery: 'async',
    questions: [{ title: 'Continue?', options: ['Yes', 'Wait'] }], text: 'Continue?' };
  const images = [{ id: 'image-one', type: 'imageGeneration' }, { id: 'image-two', type: 'imageGeneration' }];
  assert.deepEqual(turnTimeline([prompt('first'), progress('before'), question, command('after'), ...images, answer], true)
    .map(block => block.kind), ['prompt', 'activity', 'question', 'activity', 'images', 'answer']);
});

test('settled summaries preserve app frames on both sides of a follow-up until the full saved read', () => {
  const first = prompt('first'), followUp = prompt('follow-up');
  const app = (id: string): ThreadItemSummary => ({ id, type: 'mcpToolCall', server: 'fixture', status: 'completed',
    mcpAppResourceUri: 'ui://fixture/app', result: { content: [] } });
  const saved: TurnSummary = { id: 'turn', status: 'completed', itemsView: 'summary', items: [first, followUp, answer] };
  const live: TurnSummary = { ...saved, itemsView: 'full', items: [first, app('app-before'), followUp, app('app-after'), answer] };
  const merged = mergeLiveTurns([saved], [live])[0]!;
  const ranges = turnTimeline(merged.items, false, true).filter(block => block.kind === 'activity');
  assert.deepEqual(ranges.map(range => activityRange(merged.items, range.after, range.before).map(item => item.id)),
    [['app-before'], ['app-after']]);
  assert.deepEqual(mergeLiveTurns([{ ...saved, itemsView: 'full', items: live.items }], [live])[0]?.items, live.items);
});

test('Work ranges share an in-flight full read and a later explicit read can refresh it', async () => {
  const stream = new TurnStream('thread', 'remote');
  let reads = 0;
  let finish!: (items: ThreadItemSummary[]) => void;
  const load = (threadId: string, turnId: string, hostId: string) => {
    assert.deepEqual([threadId, turnId, hostId], ['thread', 'turn', 'remote']);
    reads++;
    return new Promise<ThreadItemSummary[]>(resolve => { finish = resolve; });
  };
  const first = stream.readActivity('turn', load), second = stream.readActivity('turn', load);
  assert.equal(reads, 1);
  finish([command('command')]);
  assert.deepEqual(await first, await second);
  const refresh = stream.readActivity('turn', load);
  assert.equal(reads, 2);
  finish([command('new-command')]);
  assert.equal((await refresh)[0]?.id, 'new-command');
});
