import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ThreadSummary } from '../lib/codex-protocol.ts';
import { applyTextEdits, editSourceSignature, latestEditTarget, textEdits } from '../src/renderer/messages/message-edit.ts';
import { editableDraft } from '../src/renderer/messages/message-data.ts';

test('only a complete, idle latest user turn can be edited', () => {
  const thread: ThreadSummary = { id: 'thread', name: null, cwd: '/work', status: { type: 'idle' }, turns: [
    { id: 'first', status: 'completed', itemsView: 'full', items: [{ id: 'old', type: 'userMessage', content: [] }] },
    { id: 'second', status: 'completed', itemsView: 'full', items: [{ id: 'new', type: 'userMessage', content: [] }] },
    { id: 'third', status: 'completed', itemsView: 'full', items: [{ id: 'tool', type: 'commandExecution' }] },
  ] };
  assert.deepEqual(latestEditTarget(thread), { turnId: 'second', itemId: 'new', restriction: null });
  assert.match(latestEditTarget({ ...thread, status: { type: 'active', activeFlags: [] } })!.restriction!, /active turn/);
  assert.match(latestEditTarget({ ...thread, status: { type: 'notLoaded' } })!.restriction!, /status is unavailable/);
  const turns = thread.turns.map((turn) => ({ ...turn }));
  turns[2]!.itemsView = 'summary';
  assert.match(latestEditTarget({ ...thread, turns })!.restriction!, /history is incomplete/);
  turns[2]!.itemsView = 'notLoaded';
  assert.match(latestEditTarget({ ...thread, turns })!.restriction!, /history is incomplete/);
  delete turns[2]!.itemsView;
  assert.match(latestEditTarget({ ...thread, turns })!.restriction!, /history is incomplete/);
  turns[2]!.itemsView = 'full';
  turns[2]!.status = 'inProgress';
  assert.match(latestEditTarget({ ...thread, turns })!.restriction!, /active turn/);
  turns[2]!.status = 'completed';
  turns[1]!.items = [...turns[1]!.items, { id: 'steer', type: 'userMessage', content: [] }];
  assert.match(latestEditTarget({ ...thread, turns })!.restriction!, /multiple user messages/);
});

test('edits retain ordered inputs and adjust UTF-8 reference ranges without dropping context', () => {
  const item = { id: 'user', type: 'userMessage', content: [
    { type: 'text', text: 'Before after', text_elements: [
      { byteRange: { start: 0, end: 6 }, placeholder: 'Before', context: { browser: { selector: '#target' } } },
    ] },
    { type: 'image', fileId: 'image-id', detail: 'high' },
    { type: 'text', text: 'Second', text_elements: [] },
    { type: 'skill', name: 'review', path: '/skills/review' },
    { type: 'mention', name: 'project', path: '/work' },
    { type: 'localAudio', path: '/audio.wav' },
  ], hints: ['search', { context: 'browser' }] };
  const draft = editableDraft(item)!;
  const result = applyTextEdits(draft, [{ index: 0, text: '中Before after' }, { index: 2, text: 'Second edit' }], '');
  assert.ok(result.draft);
  assert.equal(result.draft.text, '中Before after\nSecond edit');
  assert.deepEqual(result.draft.input, [
    { type: 'text', text: '中Before after', text_elements: [
      { byteRange: { start: 3, end: 9 }, placeholder: 'Before', context: { browser: { selector: '#target' } } },
    ] },
    ...item.content.slice(1, 2), { type: 'text', text: 'Second edit', text_elements: [] }, ...item.content.slice(3),
  ]);
  assert.deepEqual(result.draft.images, [{ id: 'image-1', src: '', fileId: 'image-id', name: 'Image' }]);
  assert.deepEqual(result.draft.hints, item.hints);
  assert.deepEqual(draft.input, item.content);
  assert.match(applyTextEdits(draft, [{ index: 0, text: 'Changed after' }, { index: 2, text: 'Second' }], '').error!, /overlaps a reference/);
  assert.deepEqual(draft.input, item.content);
  assert.notEqual(editSourceSignature(item), editSourceSignature({ ...item, hints: [] }));
});

test('marked documents are updated only within a provably matching text span', () => {
  const item = { id: 'rich', type: 'userMessage', content: [{ type: 'text', text: 'Hello world', text_elements: [] }],
    document: { type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'Hello', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' world', marks: [{ type: 'link', attrs: { href: 'https://example.test' } }] },
    ] }] } };
  const draft = editableDraft(item)!;
  const updated = applyTextEdits(draft, [{ index: 0, text: 'Hella world' }], '');
  assert.ok(updated.draft);
  assert.deepEqual(updated.draft.document, { type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'text', text: 'Hella', marks: [{ type: 'bold' }] },
    { type: 'text', text: ' world', marks: [{ type: 'link', attrs: { href: 'https://example.test' } }] },
  ] }] });
  assert.deepEqual(draft.document, item.document);
  assert.match(applyTextEdits(draft, [{ index: 0, text: 'Hi earth' }], '').error!, /formatting boundaries/);
  assert.equal(editableDraft({ ...item, document: { type: 'doc', marks: [42] } }), null);
  assert.equal(editableDraft({ ...item, hints: 'unexpected' }), null);
});

test('unknown input and invalid references are retained rather than silently rewritten', () => {
  const unknown = editableDraft({ id: 'x', type: 'userMessage', content: [
    { type: 'text', text: 'A', text_elements: [] }, { type: 'futureInput', value: 1 },
  ] })!;
  assert.match(applyTextEdits(unknown, [{ index: 0, text: 'B' }], '').error!, /unrecognized input/);
  assert.deepEqual(applyTextEdits(unknown, textEdits(unknown), '').draft?.input, unknown.input);
  const invalid = editableDraft({ id: 'y', type: 'userMessage', content: [
    { type: 'text', text: '中', text_elements: [{ byteRange: { start: 1, end: 3 }, placeholder: '中' }] },
  ] })!;
  assert.match(applyTextEdits(invalid, [{ index: 0, text: '中!' }], '').error!, /invalid reference range/);
  const unknownText = editableDraft({ id: 'y2', type: 'userMessage', content: [
    { type: 'text', text: 'A', text_elements: [], futureRanges: [{ start: 0, end: 1 }] },
  ] })!;
  assert.match(applyTextEdits(unknownText, [{ index: 0, text: 'AB' }], '').error!, /unrecognized metadata/);
  const attachment = editableDraft({ id: 'z', type: 'userMessage', content: [{ type: 'image', fileId: 'id', detail: 'low' }] })!;
  assert.deepEqual(applyTextEdits(attachment, [], 'Added').draft?.input,
    [{ type: 'text', text: 'Added', text_elements: [] }, { type: 'image', fileId: 'id', detail: 'low' }]);
});
