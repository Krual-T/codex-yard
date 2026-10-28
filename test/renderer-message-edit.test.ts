import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ThreadSummary } from '../lib/codex-protocol.ts';
import { applyTextEdits, editSourceSignature, latestEditTarget, textEdits } from '../src/renderer/messages/message-edit.ts';
import { editableDraft, parseUserContent } from '../src/renderer/messages/message-data.ts';

test('only a complete, idle latest user turn can be edited', () => {
  const history = { order: 'ascending', tailComplete: true } as const;
  const thread: ThreadSummary = { id: 'thread', name: null, cwd: '/work', status: { type: 'idle' }, turns: [
    { id: 'first', status: 'completed', itemsView: 'full', items: [{ id: 'old', type: 'userMessage', content: [] }] },
    { id: 'second', status: 'completed', itemsView: 'full', items: [{ id: 'new', type: 'userMessage', content: [] }] },
    { id: 'third', status: 'completed', itemsView: 'full', items: [{ id: 'tool', type: 'commandExecution' }] },
  ] };
  assert.deepEqual(latestEditTarget(thread, history), { turnId: 'second', itemId: 'new', restriction: null });
  assert.match(latestEditTarget(thread)!.restriction!, /unconfirmed/);
  assert.match(latestEditTarget(thread, { order: 'ascending', tailComplete: false })!.restriction!, /unconfirmed/);
  assert.match(latestEditTarget({ ...thread, turns: [...thread.turns].reverse() }, { order: 'descending', tailComplete: true })!.restriction!, /unconfirmed/);
  const reversedDates = thread.turns.map((turn, index) => ({ ...turn, startedAt: 300 - index * 100 }));
  assert.match(latestEditTarget({ ...thread, turns: reversedDates }, history)!.restriction!, /unconfirmed/);
  assert.match(latestEditTarget({ ...thread, status: { type: 'active', activeFlags: [] } }, history)!.restriction!, /active turn/);
  assert.match(latestEditTarget({ ...thread, status: { type: 'notLoaded' } }, history)!.restriction!, /status is unavailable/);
  const turns = thread.turns.map((turn) => ({ ...turn }));
  turns[2]!.itemsView = 'summary';
  assert.match(latestEditTarget({ ...thread, turns }, history)!.restriction!, /history is incomplete/);
  turns[2]!.itemsView = 'notLoaded';
  assert.match(latestEditTarget({ ...thread, turns }, history)!.restriction!, /history is incomplete/);
  delete turns[2]!.itemsView;
  assert.match(latestEditTarget({ ...thread, turns }, history)!.restriction!, /history is incomplete/);
  turns[2]!.itemsView = 'full';
  turns[2]!.status = 'inProgress';
  assert.match(latestEditTarget({ ...thread, turns }, history)!.restriction!, /active turn/);
  turns[2]!.status = 'completed';
  turns[1]!.items = [...turns[1]!.items, { id: 'steer', type: 'userMessage', content: [] }];
  assert.match(latestEditTarget({ ...thread, turns }, history)!.restriction!, /multiple user messages/);
});

test('serialized file context survives replacing the complete request', () => {
  const prefix = '# Files mentioned by the user:\n\n## Notes: /work/notes%20draft.md (lines 3-5)\nLibrary file metadata: {"fileId":"f"}\n\n## My request for Codex:\n';
  const item = { id: 'file', type: 'userMessage', content: [
    { type: 'text', text: prefix + 'Old request\n', text_elements: [] },
    { type: 'image', fileId: 'opaque', detail: 'high' },
    { type: 'mention', name: 'project', path: '/work' },
  ] };
  const draft = editableDraft(item)!;
  assert.deepEqual(draft.files, []);
  assert.deepEqual(textEdits(draft), [{ index: 0, text: prefix + 'Old request\n' }]);
  const updated = applyTextEdits(draft, [{ index: 0, text: prefix + 'Replacement' }], '');
  assert.deepEqual(updated.draft?.input, [{ ...item.content[0], text: prefix + 'Replacement\n' }, ...item.content.slice(1)]);
  assert.match(applyTextEdits(draft, [{ index: 0, text: 'Replacement' }], '').error!, /message context changed/i);
  assert.deepEqual(draft.input, item.content);
  const incomplete = editableDraft({ id: 'bad', type: 'userMessage', content: [
    { type: 'text', text: '# Files mentioned by the user:\n## Notes: /work/a', text_elements: [] },
  ] })!;
  assert.match(applyTextEdits(incomplete, [{ index: 0, text: 'New' }], '').error!, /no recognized request boundary/);
  const unc = parseUserContent({ id: 'unc', type: 'userMessage', content: [{ type: 'text', text:
    '# Files pasted by the user:\n## "Notes": \\\\server\\share\\note.txt\n## My request:\nRead it', text_elements: [] }] });
  assert.deepEqual(unc[0]?.kind === 'text' ? unc[0].context?.files : null, [{ name: 'Notes', path: '\\\\server\\share\\note.txt' }]);
});

test('explicit attachment removals preserve ordered input, file metadata and reference offsets', () => {
  const first = '## Notes: /work/a%20b#L12.md (line 4)\nLibrary file metadata: {"fileId":"f","libraryFileId":"l"}\n';
  const second = '## Diagram: /work/diagram.png\nImage attachment: true\n';
  const prefix = `# Files mentioned by the user:\n\n${first}\n${second}\n## My request:\n`;
  const text = `${prefix}Please review @file\n`;
  const start = new TextEncoder().encode(`${prefix}Please review `).length;
  const item = { id: 'user', type: 'userMessage', hints: ['search'], content: [
    { type: 'text', text, text_elements: [{ byteRange: { start, end: start + 5 }, placeholder: '@file', context: { id: 'reference' } }] },
    { type: 'image', fileId: 'opaque', detail: 'high' },
    { type: 'localImage', path: '/work/keep.png', detail: 'low' },
    { type: 'mention', name: 'project', path: '/work' },
  ] };
  const draft = editableDraft(item)!;
  const updated = applyTextEdits(draft, [{ index: 0, text: `${prefix}Please review @file now\n` }], '', [
    { kind: 'file', inputIndex: 0, fileIndex: 0 }, { kind: 'image', inputIndex: 1 },
  ]);
  assert.ok(updated.draft);
  const remainingText = `# Files mentioned by the user:\n\n\n${second}\n## My request:\nPlease review @file now\n`;
  const nextStart = new TextEncoder().encode(remainingText.slice(0, remainingText.indexOf('@file'))).length;
  assert.deepEqual(updated.draft.input, [
    { type: 'text', text: remainingText, text_elements: [{ byteRange: { start: nextStart, end: nextStart + 5 }, placeholder: '@file', context: { id: 'reference' } }] },
    item.content[2], item.content[3],
  ]);
  assert.deepEqual(updated.draft.images, [{ id: 'image-2', src: '/work/keep.png', path: '/work/keep.png', name: 'keep.png' }]);
  assert.deepEqual(updated.draft.hints, item.hints);
  assert.deepEqual(draft.input, item.content);
  assert.match(applyTextEdits(draft, textEdits(draft), '', [
    { kind: 'file', inputIndex: 0, fileIndex: 0 }, { kind: 'file', inputIndex: 0, fileIndex: 0 },
  ]).error!, /selected more than once/);
  assert.match(applyTextEdits(draft, textEdits(draft), '', [{ kind: 'image', inputIndex: 3 }]).error!, /image no longer matches/i);
  const mismatched = structuredClone(draft);
  mismatched.images[0]!.fileId = 'different-file';
  assert.match(applyTextEdits(mismatched, textEdits(mismatched), '', [{ kind: 'image', inputIndex: 1 }]).error!, /image no longer matches/i);
  const duplicate = structuredClone(draft);
  duplicate.images.push(structuredClone(duplicate.images[0]!));
  assert.match(applyTextEdits(duplicate, textEdits(duplicate), '', [{ kind: 'image', inputIndex: 1 }]).error!, /image no longer matches/i);
});

test('file removals reject unknown metadata and keep CRLF context intact', () => {
  const prefix = '# Files mentioned by the user:\r\n\r\n## Notes: /work/a.txt\r\nFuture metadata: keep\r\n\r\n## My request:\r\n';
  const draft = editableDraft({ id: 'file', type: 'userMessage', content: [{ type: 'text', text: prefix + 'request', text_elements: [] }] })!;
  const context = parseUserContent({ id: 'file', type: 'userMessage', content: draft.input })[0];
  assert.equal(context?.kind === 'text' && context.context?.fileSpans[0]?.removable, false);
  assert.match(applyTextEdits(draft, textEdits(draft), '', [{ kind: 'file', inputIndex: 0, fileIndex: 0 }]).error!, /unrecognized context/);
  assert.equal(draft.input?.[0]?.text, prefix + 'request');
  assert.match(applyTextEdits(draft, textEdits(draft), '', [{ kind: 'image', inputIndex: -1 }]).error!, /unrecognized/);
});

test('removing the last file removes only an otherwise empty file envelope', () => {
  const prefix = '# Files mentioned by the user:\n\n## Notes: /work/a.txt\n\n## My request:\n';
  const draft = editableDraft({ id: 'file', type: 'userMessage', content: [{ type: 'text', text: prefix + 'request', text_elements: [] }] })!;
  assert.equal(applyTextEdits(draft, textEdits(draft), '', [{ kind: 'file', inputIndex: 0, fileIndex: 0 }]).draft?.input?.[0]?.text, 'request');
  const extra = '# Worktree instructions:\nKeep this context.\n\n' + prefix;
  const withContext = editableDraft({ id: 'file', type: 'userMessage', content: [{ type: 'text', text: extra + 'request', text_elements: [] }] })!;
  const result = applyTextEdits(withContext, textEdits(withContext), '', [{ kind: 'file', inputIndex: 0, fileIndex: 0 }]);
  assert.match(String(result.draft?.input?.[0]?.text), /^# Worktree instructions:\nKeep this context\./);
});

test('independent edits on both sides preserve the same UTF-8 reference', () => {
  const original = { id: 'ref', type: 'userMessage', content: [{ type: 'text', text: 'a @foo b', text_elements: [
    { byteRange: { start: 2, end: 6 }, placeholder: '@foo', context: { id: 'browser' } },
  ] }] };
  const draft = editableDraft(original)!;
  const result = applyTextEdits(draft, [{ index: 0, text: '中 @foo B!' }], '');
  assert.deepEqual(result.draft?.input?.[0]?.text_elements, [
    { byteRange: { start: 4, end: 8 }, placeholder: '@foo', context: { id: 'browser' } },
  ]);
  assert.match(applyTextEdits(draft, [{ index: 0, text: '中 @foo @foo B' }], '').error!, /ambiguous/);
  assert.deepEqual(draft.input, original.content);
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
  const both = applyTextEdits(draft, [{ index: 0, text: 'Hi earth' }], '');
  assert.deepEqual(both.draft?.document?.content?.[0]?.content, [
    { type: 'text', text: 'Hi', marks: [{ type: 'bold' }] },
    { type: 'text', text: ' earth', marks: [{ type: 'link', attrs: { href: 'https://example.test' } }] },
  ]);
  assert.match(applyTextEdits(draft, [{ index: 0, text: 'changed' }], '').error!, /formatting boundaries/);
  assert.equal(editableDraft({ ...item, document: { type: 'doc', marks: [42] } }), null);
  assert.equal(editableDraft({ ...item, hints: 'unexpected' }), null);
});

test('hard_break and independent marked spans survive editing and keep the original draft', () => {
  const item = { id: 'hard', type: 'userMessage', content: [
    { type: 'text', text: 'Hello\nworld', text_elements: [] }, { type: 'mention', name: 'project', path: '/work' },
  ], document: { type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'text', text: 'Hello', marks: [{ type: 'bold' }] }, { type: 'hard_break' },
    { type: 'text', text: 'world', marks: [{ type: 'link', attrs: { href: 'https://example.test' } }] },
  ] }] } };
  const draft = editableDraft(item)!;
  const changed = applyTextEdits(draft, [{ index: 0, text: 'Hella\nworle' }], '');
  assert.deepEqual(changed.draft?.document, { type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'text', text: 'Hella', marks: [{ type: 'bold' }] }, { type: 'hard_break' },
    { type: 'text', text: 'worle', marks: [{ type: 'link', attrs: { href: 'https://example.test' } }] },
  ] }] });
  assert.deepEqual(changed.draft?.input?.[1], item.content[1]);
  assert.deepEqual(draft.document, item.document);
  assert.match(applyTextEdits(draft, [{ index: 0, text: 'Hello world' }], '').error!, /formatting boundaries/);
});

test('recognized mention atoms remain intact while text on either side changes', () => {
  const item = { id: 'mention', type: 'userMessage', content: [{ type: 'text', text: 'a [file](src/file.ts) b', text_elements: [] }],
    document: { type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'a ', marks: [{ type: 'strong' }] },
      { type: 'atMention', attrs: { label: 'file', path: 'src/file.ts', fsPath: '/work/src/file.ts' } },
      { type: 'text', text: ' b' },
    ] }] } };
  const draft = editableDraft(item)!;
  const result = applyTextEdits(draft, [{ index: 0, text: 'A [file](src/file.ts) B' }], '');
  assert.deepEqual(result.draft?.document?.content?.[0]?.content, [
    { type: 'text', text: 'A ', marks: [{ type: 'strong' }] },
    { type: 'atMention', attrs: { label: 'file', path: 'src/file.ts', fsPath: '/work/src/file.ts' } },
    { type: 'text', text: ' B' },
  ]);
  assert.match(applyTextEdits(draft, [{ index: 0, text: 'A [other](src/file.ts) B' }], '').error!, /formatting boundaries/);
  assert.deepEqual(draft.document, item.document);
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
