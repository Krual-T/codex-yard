import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TurnSummary } from '../lib/codex-protocol.ts';
import { MessageNavigationHistory, NavigationTargetChanged, messageMarkers, turnMessageMarkers } from '../src/workspace/message-navigation-history.ts';
import { agentItem, fixtureTurn } from './fake-codex.ts';

const user = (id: string, text = id) => ({ id, type: 'userMessage', content: [{ type: 'text', text }] });
function fixture(count: number) {
  const turns = Array.from({ length: count }, (_, index) => fixtureTurn('turn-' + index, [user('prompt-' + index), agentItem('reply-' + index, 'Reply ' + index)]));
  const calls: Record<string, unknown>[] = [];
  const history = new MessageNavigationHistory(async params => {
    calls.push(params);
    const descending = turns.slice().reverse();
    const start = params.cursor == null ? 0 : descending.findIndex(turn => 'at:' + turn.id === params.cursor);
    assert.ok(start >= 0, 'Cursor anchors a real turn');
    const end = start + Number(params.limit);
    return { data: descending.slice(start, end).map(turn => ({ ...turn, itemsView: String(params.itemsView),
      items: params.itemsView === 'notLoaded' ? [] : turn.items })),
      backwardsCursor: 'at:' + descending[start]!.id, nextCursor: descending[end] ? 'at:' + descending[end]!.id : null };
  });
  return { history, turns, calls };
}
const signal = () => new AbortController().signal;

test('a complete metadata directory locates distant messages with an opaque anchored cursor and a nine-turn summary window', async () => {
  const { history, calls, turns } = fixture(237);
  const index = await history.index(signal());
  assert.equal(index.complete, true); assert.equal(index.locations.length, 237); assert.equal(calls.length, 3);
  assert.ok(calls.every(call => call.limit === 100 && call.itemsView === 'notLoaded'));
  turns.push(fixtureTurn('arrived-after-index', [user('new')]));
  const window = await history.around('turn-30', signal());
  assert.deepEqual(window.turns.map(turn => turn.id), Array.from({ length: 9 }, (_, index) => 'turn-' + (26 + index)));
  assert.equal(window.before, true); assert.equal(window.after, true);
  assert.equal(calls.at(-1)?.limit, 9); assert.equal(calls.at(-1)?.itemsView, 'summary');
  const extended = await history.extend(window, 'before', signal());
  assert.equal(extended.turns[0]?.id, 'turn-24'); assert.equal(extended.turns.length, 11);
  const later = await history.extend(extended, 'after', signal());
  assert.equal(later.turns.at(-1)?.id, 'turn-36'); assert.equal(later.turns.length, 13);
});

test('hover shares one pending preview, caches it, and never downloads tool history', async () => {
  const { history, calls } = fixture(132);
  await history.index(signal());
  const first = history.preview('turn-11', signal()), second = history.preview('turn-11', signal());
  assert.equal(first, second); await first;
  const count = calls.length;
  assert.equal((await history.preview('turn-11', signal())).id, 'turn-11');
  assert.equal(calls.length, count);
  assert.equal(calls.at(-1)?.limit, 1); assert.ok(calls.every(call => call.itemsView !== 'full'));
});

test('directory reads stop after ten pages and leave unknown turns out of the rail when incomplete', async () => {
  const { history, calls, turns } = fixture(1001);
  await history.index(signal());
  assert.equal(calls.length, 10); assert.equal(history.complete, false);
  assert.equal(messageMarkers(history.complete ? history.locations : [], turns.slice(-2), history.previews).length, 2);
});

test('one turn can contain multiple navigation keys; image-only prompts and async question replies remain readable', () => {
  const turn = fixtureTurn('turn', [user('first', '😀'.repeat(300)), agentItem('first-reply', 'Initial answer'),
    user('steer', 'Keep going'), agentItem('last-reply', 'Latest answer')]);
  const markers = turnMessageMarkers(turn);
  assert.equal(markers.length, 2); assert.notEqual(markers[0]!.id, markers[1]!.id);
  assert.equal(Array.from(markers[0]!.prompt).length, 240); assert.equal(markers[0]!.response, 'Initial answer');
  assert.equal(markers[1]!.response, 'Latest answer');
  const image = turnMessageMarkers(fixtureTurn('image', [{ id: 'image', type: 'userMessage', content: [{ type: 'localImage', path: '/tmp/cat.png' }] }]));
  assert.deepEqual(image[0]?.attachments, ['cat.png']);
  const reply = turnMessageMarkers(fixtureTurn('reply', [user('question', '<send_user_message_question_reply>\n' +
    JSON.stringify({ questionItemId: 'q', question: 'Proceed?', answer: 'Yes' }) + '\n</send_user_message_question_reply>')]));
  assert.equal(reply[0]?.prompt, 'Yes');
});

test('placeholder identity survives hydration and known live turns supersede cached summaries', async () => {
  const { history, turns } = fixture(5); await history.index(signal());
  const before = messageMarkers(history.locations, [], history.previews);
  await history.preview('turn-0', signal());
  const known: TurnSummary = { ...turns[0]!, items: [user('prompt-0', 'Live updated')] };
  const after = messageMarkers(history.locations, [known], history.previews);
  assert.equal(before[0]?.id, after[0]?.id); assert.equal(after[0]?.prompt, 'Live updated');
});

test('a reverted target fails explicitly and an aborted seek cannot publish an old window', async () => {
  const { history, turns, calls } = fixture(20); await history.index(signal());
  turns.splice(10, 1);
  await assert.rejects(history.around('turn-10', signal()), NavigationTargetChanged);
  const controller = new AbortController(); controller.abort();
  const count = calls.length;
  await assert.rejects(history.around('turn-9', controller.signal), { name: 'AbortError' });
  assert.equal(calls.length, count);
});
