import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sameComposerDraftValue, updateComposerDraftVersionInRoot } from '../src/renderer/composer/composer-draft-store.ts';
import type { ComposerDraftOwner, ComposerDraftSnapshot } from '../src/renderer/composer/composer-draft-store.ts';
import { draftKey, emptyDraft } from '../src/renderer/composer/standalone-draft.ts';

const owner: ComposerDraftOwner = { hostId: 'local', threadId: null, draftId: 'fixture-draft' };
const key = draftKey({ ...owner, cwd: '' });
function fixture() {
  const draft = { ...emptyDraft(), text: 'editable', references: [{ id: 'ref', text: 'A', original: { opaque: true } }],
    document: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'editable', marks: [{ type: 'strong' }] }] }] },
    hints: [{ nested: ['preserved'] }], unknownField: { retain: true } };
  const before: ComposerDraftSnapshot = { owner, revision: 'one', draft };
  const root = { version: 1, archive: { raw: '{unparsed' }, claims: {}, initialized: {}, extraRoot: { keep: 1 },
    entries: { [key]: { createdThreadId: 'created', extraEntry: ['keep'], versions: [
      { owner, revision: 'one', draft, prefills: ['first'], extraVersion: { keep: 2 } },
      { owner, revision: 'other', draft: { ...draft, text: 'other' }, prefills: [] },
    ], retained: [{ owner, revision: 'retained', draft, prefills: ['first'] }] } } };
  return { before, root };
}

test('composer root transaction changes one complete active version without touching branches or metadata', () => {
  const { root, before } = fixture(), original = structuredClone(root);
  const result = updateComposerDraftVersionInRoot(root, before, draft => ({ ...draft, references: [] }), 'next');
  assert.equal(result.changed, true);
  assert.deepEqual(root, original);
  assert.equal(result.after.revision, 'next');
  assert.deepEqual(result.after.owner, owner);
  assert.deepEqual(result.after.draft.references, []);
  const next = result.root as typeof root;
  assert.deepEqual(next.extraRoot, original.extraRoot);
  assert.deepEqual(next.archive, original.archive);
  assert.deepEqual(next.entries[key]!.extraEntry, original.entries[key]!.extraEntry);
  assert.deepEqual(next.entries[key]!.versions[0]!.extraVersion, { keep: 2 });
  assert.deepEqual(next.entries[key]!.versions[0]!.prefills, ['first']);
  assert.deepEqual(next.entries[key]!.versions[0]!.draft.unknownField, { retain: true });
  assert.deepEqual(next.entries[key]!.versions[1], original.entries[key]!.versions[1]);
  assert.deepEqual(next.entries[key]!.retained, original.entries[key]!.retained);
  assert.deepEqual(result.after.draft.document, before.draft.document);
  assert.deepEqual(result.after.draft.hints, before.draft.hints);
  result.after.draft.text = 'mutated receipt';
  assert.equal(next.entries[key]!.versions[0]!.draft.text, 'editable');
});

test('composer root transaction rejects stale, ambiguous, mismatched or invalid versions', () => {
  const { root, before } = fixture(), original = structuredClone(root);
  const update = (snapshot: ComposerDraftSnapshot, revision = 'next') =>
    updateComposerDraftVersionInRoot(root, snapshot, draft => ({ ...draft, text: 'changed' }), revision);
  assert.throws(() => update({ ...before, owner: { ...owner, hostId: 'remote' } }), /版本已改变/);
  assert.throws(() => update({ ...before, revision: 'retained' }), /版本已改变/);
  assert.throws(() => update({ ...before, draft: { ...before.draft, hints: [] } }), /内容已改变/);
  assert.throws(() => update(before, 'retained'), /新版本已存在/);
  assert.throws(() => update(before, ''), /无效/);
  assert.throws(() => updateComposerDraftVersionInRoot(root, before, draft => ({ ...draft, images: [{ id: 'broken', src: 5 }] } as any), 'next'), /无法无损保存/);
  const duplicate = structuredClone(root);
  duplicate.entries[key]!.versions.push(structuredClone(duplicate.entries[key]!.versions[0]!));
  assert.throws(() => updateComposerDraftVersionInRoot(duplicate, before, draft => draft, 'next'), /版本已改变/);
  assert.throws(() => updateComposerDraftVersionInRoot({ version: 1 }, before, draft => draft, 'next'), /无法识别/);
  assert.deepEqual(root, original);
});

test('no-op and a previously bound created thread preserve version identity', () => {
  const { root, before } = fixture();
  const noChange = updateComposerDraftVersionInRoot(root, before, draft => draft, 'unused');
  assert.equal(noChange.root, root);
  assert.equal(noChange.changed, false);
  assert.deepEqual(noChange.after, before);
  const created = { ...before, owner: { ...owner, threadId: 'created' } };
  const adopted = updateComposerDraftVersionInRoot(root, created, draft => ({ ...draft, text: 'edited' }), 'next');
  assert.deepEqual(adopted.after.owner, created.owner);
  assert.equal((adopted.root as typeof root).entries[key]!.versions[0]!.owner.threadId, null);
  assert.throws(() => updateComposerDraftVersionInRoot(root, { ...created, owner: { ...owner, threadId: 'unbound' } }, draft => draft, 'next'), /版本已改变/);
  assert.equal(sameComposerDraftValue({ keep: undefined }, {}), false);
  assert.equal(sameComposerDraftValue({ a: 1, b: 2 }, { b: 2, a: 1 }), true);
});
