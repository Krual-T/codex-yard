import assert from 'node:assert/strict';
import { test } from 'node:test';
import { browserOwnerKey, browserReferences, reconcileBrowserReferences, removeExplicitlyDeletedBrowserReferences } from '../src/renderer/browser/comments.ts';

test('browser references preserve unknown data and reconcile only unchanged draft snapshots', () => {
  const owner = { hostId: 'local', threadId: 'same-id', draftId: 'home' };
  const remote = { ...owner, hostId: 'ssh' };
  const comment = { type: 'comment', origin: 'browser', content: [{ content_type: 'text', text: 'Edited', extra: 1 }],
    localBrowserContext: { pageUrl: 'https://fixture.invalid', targetDescription: 'Button', framePath: ['a'],
      elementMetadata: { unknown: 3 }, extra: { value: true } },
    localBrowserCommentMetadata: { commentId: 'same-comment', kind: 'element', unknown: 4 }, unknown: ['kept'] };
  const reference = browserReferences(owner, [comment])[0]!;
  const panelOwner = { ...owner, browserTabId: 'panel' };
  assert.deepEqual(browserReferences(panelOwner, [comment]), [reference], 'Panel-only fields do not alter draft references');
  assert.notEqual(browserOwnerKey(owner), browserOwnerKey(remote));
  assert.notEqual(reference.id, browserReferences(remote, [comment])[0]!.id);
  assert.deepEqual(reference.original, comment);
  assert.match(reference.text, /"unknown":3/);
  assert.match(reference.text, /"framePath":\["a"\]/);
  assert.deepEqual(browserReferences(owner, [comment, comment, { unknown: true }]), [], 'Duplicate and unknown entries are not guessed');
  const draft = { text: 'Prompt', images: [], files: [], references: [reference, { id: 'unrelated', text: 'Other' }] };
  const changed = { ...reference, text: 'A newer composer edit' };
  assert.deepEqual(reconcileBrowserReferences({ ...draft, references: [changed, draft.references[1]!] }, [reference], []).references,
    [changed, draft.references[1]], 'A later draft edit is not cleared');
  assert.deepEqual(reconcileBrowserReferences(draft, [reference], []).references, [draft.references[1]], 'An unchanged removed reference is cleared');
  assert.deepEqual(reconcileBrowserReferences({ ...draft, references: [] }, [reference], [reference]).references, [], 'A removed draft reference is not silently reinserted');
  assert.deepEqual(reconcileBrowserReferences({ ...draft, references: [] }, [], [reference]).references, [],
    'A stale comment snapshot cannot automatically reinsert a submitted reference');
  assert.deepEqual(removeExplicitlyDeletedBrowserReferences(draft, [reference]).references, [draft.references[1]], 'An explicit deletion is durable');
  assert.deepEqual(removeExplicitlyDeletedBrowserReferences({ ...draft, references: [changed] }, [reference]).references, [changed],
    'An independently edited reference is not removed by an older deletion');
});
