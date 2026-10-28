import assert from 'node:assert/strict';
import { test } from 'node:test';
import { composerDraftAtomKey } from '../src/renderer/composer/composer-draft-store.ts';
import { draftKey, emptyDraft } from '../src/renderer/composer/standalone-draft.ts';
import { sameBrowserValue, updateBrowserDraftVersion } from '../src/renderer/browser/draft-transaction.ts';
import { browserReferences } from '../src/renderer/browser/comments.ts';
import type { ComposerDraftSnapshot } from '../src/renderer/composer/composer-draft-store.ts';

const owner = { hostId: 'local', threadId: 'thread', draftId: 'draft' };
const key = draftKey({ ...owner, cwd: '' });
const originalDraft = { ...emptyDraft(), text: 'original', preserved: { future: true } };
const snapshot: ComposerDraftSnapshot = { owner, revision: 'r1', draft: originalDraft };
const stored = { revision: snapshot.revision, owner, draft: snapshot.draft, prefills: ['prefill'], placeholder: false, futureVersion: 'keep' };
const repository = { version: 1, archive: {}, claims: {}, initialized: {}, futureRoot: 'keep',
  entries: { [key]: { versions: [stored], retained: [stored], futureEntry: 'keep' } } };
const atoms = { [composerDraftAtomKey]: repository };

test('comment transaction checks the complete version and preserves other stored data', () => {
  const result = updateBrowserDraftVersion(atoms, owner, structuredClone(snapshot), draft => ({ ...draft, text: 'changed' }));
  const next = result.repository as typeof repository;
  assert.notEqual(result.snapshot.revision, 'r1');
  assert.equal(result.snapshot.draft.text, 'changed');
  assert.equal(next.futureRoot, 'keep'); assert.equal(next.entries[key]!.futureEntry, 'keep');
  assert.equal(next.entries[key]!.versions[0]!.futureVersion, 'keep');
  assert.deepEqual(next.entries[key]!.retained, [stored]); assert.equal(repository.entries[key]!.versions[0]!.draft.text, 'original');
  assert.throws(() => updateBrowserDraftVersion(atoms, owner, { ...snapshot, revision: 'stale' }, draft => draft), /版本已改变/);
  const modifiedDraft = { ...snapshot.draft, preserved: { future: false } };
  assert.throws(() => updateBrowserDraftVersion(atoms, owner, { ...snapshot, draft: modifiedDraft }, draft => draft), /内容已改变/);
  assert.throws(() => updateBrowserDraftVersion(atoms, { ...owner, hostId: 'ssh' }, snapshot, draft => draft), /身份已改变/);
  assert.throws(() => updateBrowserDraftVersion({ [composerDraftAtomKey]: { ...repository, entries: {
    [key]: { ...repository.entries[key], versions: [stored, stored] },
  } } }, owner, snapshot, draft => draft), /版本已改变/);
  assert.throws(() => updateBrowserDraftVersion({ [composerDraftAtomKey]: { ...repository, entries: {
    [key]: { ...repository.entries[key], retained: [{ future: 'unknown' }] },
  } } }, owner, snapshot, draft => draft), /记录无法识别/);
});

test('home browser owner requires the existing exact created-thread binding', () => {
  const home = { ...owner, threadId: null };
  assert.throws(() => updateBrowserDraftVersion(atoms, home, snapshot, draft => draft), /关联无法核实/);
  const bound = { ...atoms, 'codex-yard.send-recovery.v1': { bindings: { [JSON.stringify(['local', 'thread'])]: 'draft' } } };
  assert.equal(updateBrowserDraftVersion(bound, home, snapshot, draft => draft).snapshot.revision, 'r1');
  assert.throws(() => updateBrowserDraftVersion({ ...bound, 'codex-yard.send-recovery.v1': { bindings: {
    [JSON.stringify(['other', 'thread'])]: 'draft',
  } } }, home, snapshot, draft => draft), /关联无法核实/);
});

test('complete comparison distinguishes absent fields and handles cyclic structured data', () => {
  assert.equal(sameBrowserValue({ a: undefined }, {}), false);
  assert.equal(sameBrowserValue({ a: 1, b: 2 }, { b: 2, a: 1 }), true);
  assert.equal(sameBrowserValue([, 1], [undefined, 1]), false);
  const shared = { text: 'same' };
  assert.equal(sameBrowserValue({ first: shared, second: shared }, { first: { text: 'same' }, second: { text: 'same' } }), true);
  const a: Record<string, unknown> = { value: 1 }, b: Record<string, unknown> = { value: 1 };
  a.self = a; b.self = b;
  assert.equal(sameBrowserValue(a, b), true); b.value = 2;
  assert.equal(sameBrowserValue(a, b), false);
});

test('an unrecognized record sharing a comment ID is not silently ignored', () => {
  const comment = { type: 'comment', origin: 'browser', content: [{ content_type: 'text', text: 'visible' }],
    localBrowserContext: {}, localBrowserCommentMetadata: { commentId: 'duplicate' } };
  assert.equal(browserReferences(owner, [comment]).length, 1);
  assert.deepEqual(browserReferences(owner, [comment, { localBrowserCommentMetadata: { commentId: 'duplicate' }, future: true }]), []);
});
