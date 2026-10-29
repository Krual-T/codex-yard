import assert from 'node:assert/strict';
import { test } from 'node:test';
import { replaceComposerDraftWithQueuedInRoot } from '../src/renderer/composer/composer-draft-store.ts';
import { draftKey, draftToInput, emptyDraft } from '../src/renderer/composer/standalone-draft.ts';
import { queueEntryDraft } from '../src/renderer/composer/standalone-queue-storage.ts';

test('ordered queue input round trips with ranges, images, skills and mentions', () => {
  const entry = { id: 'queue', clientUserMessageId: 'client', input: [
    { type: 'text', text: 'hello', text_elements: [{ byteRange: { start: 0, end: 5 }, placeholder: 'hello' }] },
    { type: 'image', fileId: 'image-id', detail: 'high' },
    { type: 'localImage', path: '/fixture/image.png' },
    { type: 'skill', name: 'skill', path: '/fixture/skill' },
    { type: 'mention', name: 'file', path: '/fixture/file' },
    { type: 'text', text: 'end', text_elements: [] },
  ] };
  const draft = queueEntryDraft(entry, 'local');
  assert.deepEqual(draftToInput(draft, 'local'), entry.input);
  assert.equal(draft.images.length, 2);
  assert.deepEqual(draft.skills, [{ name: 'skill', path: '/fixture/skill' }]);
  assert.deepEqual(entry.input[0]!.text_elements, [{ byteRange: { start: 0, end: 5 }, placeholder: 'hello' }]);
});

test('invalid UTF-8 range cannot be moved or silently repaired', () => {
  const entry = { id: 'queue', clientUserMessageId: 'client', input: [
    { type: 'text', text: '中', text_elements: [{ byteRange: { start: 1, end: 3 }, placeholder: null }] },
  ] };
  assert.throws(() => queueEntryDraft(entry, 'local'), /范围无效/);
});

test('the exact draft version is replaced while prior versions and opaque data remain', () => {
  const owner = { hostId: 'local', threadId: 'thread', draftId: 'draft' };
  const key = draftKey({ ...owner, cwd: '' });
  const draft = { ...emptyDraft(), text: 'current', references: [{ id: 'a', text: 'keep', original: { keep: true } }],
    pendingDrafts: [{ text: 'older', images: [], files: [] }], unknown: { nested: [1, 2] } };
  const before = { owner, revision: 'revision-a', draft };
  const root = { version: 1, archive: { legacy: 'raw' }, claims: {}, initialized: {}, unknownRoot: true,
    entries: { [key]: { unknownEntry: true, versions: [{ owner, revision: 'revision-a', draft, prefills: [], unknownVersion: true }], retained: [] } } };
  const oldRoot = structuredClone(root);
  const queued = queueEntryDraft({ id: 'q', clientUserMessageId: 'c', input: [{ type: 'text', text: 'queued', text_elements: [] }] }, 'local');
  const changed = replaceComposerDraftWithQueuedInRoot(root, before, queued, 'revision-b');
  assert.equal(changed.after.draft.text, 'queued');
  const pending = (changed.after.draft as typeof draft).pendingDrafts;
  assert.equal(pending[0]!.text, 'older');
  assert.equal(pending[1]!.text, 'current');
  const parked = pending[1] as unknown as { unknown: unknown; references: { original: unknown }[] };
  assert.deepEqual(parked.unknown, { nested: [1, 2] });
  assert.deepEqual(parked.references[0]!.original, { keep: true });
  assert.deepEqual(root, oldRoot);
  const next = changed.root as typeof root;
  assert.equal(next.unknownRoot, true);
  assert.equal(next.entries[key]!.unknownEntry, true);
  assert.equal(next.entries[key]!.versions[0]!.unknownVersion, true);
  assert.throws(() => replaceComposerDraftWithQueuedInRoot(changed.root, before, queued, 'revision-c'), /版本已改变/);
});
