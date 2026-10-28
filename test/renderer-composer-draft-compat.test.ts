import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activatePending, draftKey, draftToInput, emptyDraft, loadDraft, mergePrefill, normalizeDraft, textEditIssue, updateDraftText, writeDraft } from '../src/renderer/composer/standalone-draft.ts';
import type { ComposerContext, ComposerDraft, StandaloneComposerProps, WorkbenchClient } from '../src/renderer/workbench-contract.ts';

function contractTypeChecks(submit: StandaloneComposerProps['onSubmit'], client: WorkbenchClient) {
  // @ts-expect-error Draft identity is mandatory.
  const missingIdentity: ComposerContext = { hostId: 'local', threadId: null, cwd: '/workspace' };
  // @ts-expect-error Every submit must say which action is intended.
  void submit(emptyDraft(), {});
  // @ts-expect-error Steer must identify its target turn.
  void submit(emptyDraft(), {}, { type: 'steer' });
  const { reply, ...withoutReply } = client;
  // @ts-expect-error Workbench clients must be able to reply to approvals.
  const incomplete: WorkbenchClient = withoutReply;
  void [missingIdentity, reply, incomplete];
}
void contractTypeChecks;

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}
function storage(): Storage {
  const result = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { value: result, configurable: true });
  return result;
}
const context: ComposerContext = { hostId: 'local', threadId: 'thread-1', cwd: '/workspace', draftId: 'draft-1' };

test('draft identity is stable across cwd changes and distinct across drafts and hosts', () => {
  assert.equal(draftKey(context), draftKey({ ...context, cwd: '/other' }));
  assert.notEqual(draftKey(context), draftKey({ ...context, draftId: 'draft-2' }));
  assert.notEqual(draftKey(context), draftKey({ ...context, hostId: 'remote' }));
  assert.notEqual(draftKey({ ...context, threadId: null, draftId: 'new-1' }), draftKey({ ...context, threadId: null, draftId: 'new-2' }));
});

test('legacy binding and retained plain document restore without modifying native atoms', () => {
  const saved = storage();
  const document = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Saved draft' }] }] };
  const atoms = { 'client-thread-bindings-v1': { 'client-1': 'thread-1' },
    'composer-prompt-drafts-v2': { 'client-1': { draft: { prompt: 'Saved draft', pullRequestChecks: [] } } },
    'composer-retained-documents-v1': { 'local:thread-1': { document, plainTextMode: true, prompt: 'Saved draft' } }, unrelated: { keep: true } };
  const raw = JSON.stringify(atoms);
  saved.setItem('native-atoms', raw);
  const draft = loadDraft({ ...context, legacyDraftKey: 'client-1' }).draft;
  assert.equal(draft.text, 'Saved draft');
  assert.deepEqual(draft.document, document);
  assert.equal(textEditIssue(draft), null);
  const changed = updateDraftText(draft, 'Changed\nline');
  assert.equal(changed.text, 'Changed\nline');
  assert.deepEqual(changed.document, { type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Changed' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'line' }] },
  ] });
  assert.deepEqual(changed.preserved, draft.preserved);
  assert.equal(writeDraft(draftKey(context), { revision: 'new', draft: changed, prefills: [] }), true);
  assert.equal(saved.getItem('native-atoms'), raw);
  assert.equal(loadDraft({ ...context, cwd: '/other' }).draft.text, 'Changed\nline');
});

test('original hard_break nodes are editable only when their text is unambiguous', () => {
  const draft = normalizeDraft({ text: 'first\nsecond', images: [], files: [], document: { type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'first' }, { type: 'hard_break' }, { type: 'text', text: 'second' }] },
  ] } });
  assert.equal(textEditIssue(draft), null);
  assert.equal(updateDraftText(draft, 'next').text, 'next');
});

test('legacy new-draft identity and v1 fallback are supported without sharing cwd identity', () => {
  const saved = storage();
  saved.setItem('native-atoms', JSON.stringify({ 'draft-thread-identities-v1': { 'new-conversation': 'client-new' },
    'client-thread-bindings-v1': {}, 'composer-prompt-drafts-v1': { 'client-new': 'Legacy new message' } }));
  const value = loadDraft({ hostId: 'local', threadId: null, cwd: '/workspace', draftId: 'client-new' });
  assert.equal(value.draft.text, 'Legacy new message');
  assert.equal(textEditIssue(value.draft), null);
  assert.equal(loadDraft({ hostId: 'local', threadId: null, cwd: '/workspace', draftId: 'other-new' }).draft.text, '');
});

test('an absent legacy identity does not claim the shared new-conversation draft', () => {
  const saved = storage();
  saved.setItem('native-atoms', JSON.stringify({ 'composer-prompt-drafts-v1': { 'new-conversation': 'Legacy draft' } }));
  const fresh: ComposerContext = { hostId: 'local', threadId: null, cwd: '/workspace', draftId: 'new-unique' };
  assert.equal(loadDraft(fresh).draft.text, '');
  assert.equal(loadDraft({ ...fresh, legacyDraftKey: 'new-conversation' }).draft.text, 'Legacy draft');
});

test('rich documents and opaque legacy metadata remain preserved and cannot be overwritten by text editing', () => {
  const saved = storage();
  const document = { type: 'doc', attrs: { version: 1 }, content: [{ type: 'paragraph', content: [
    { type: 'text', text: 'Bold', marks: [{ type: 'strong', attrs: { source: 'original' } }] },
  ] }] };
  const record = { draft: { prompt: { document, plainTextMode: false }, pullRequestChecks: [{ id: 'keep' }] } };
  saved.setItem('native-atoms', JSON.stringify({ 'composer-prompt-drafts-v2': { 'local:thread-1': record } }));
  const draft = loadDraft({ ...context, legacyDraftKey: 'local:thread-1' }).draft;
  assert.ok(textEditIssue(draft));
  assert.deepEqual(draft.document, document);
  assert.deepEqual(updateDraftText(draft, 'replacement'), draft);
  assert.deepEqual((draft.preserved as { draft: unknown }).draft, record);
});

test('a previously retained rich draft is unlocked only when its legacy source still matches', () => {
  const saved = storage();
  const document = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bold', marks: [{ type: 'strong' }] }] }] };
  const retained = { document, plainTextMode: false, prompt: '**Bold**' };
  saved.setItem('native-atoms', JSON.stringify({ 'composer-retained-documents-v1': { 'local:thread-1': retained } }));
  const matching = loadDraft({ ...context, legacyDraftKey: 'local:thread-1' });
  const blocked = { ...matching, draft: { ...matching.draft, blocked: '此草稿包含格式或上下文，当前编辑器不能无损编辑。' } };
  writeDraft(draftKey(context), blocked);
  assert.equal(loadDraft({ ...context, legacyDraftKey: 'local:thread-1' }).draft.blocked, undefined);
  const changed = { ...retained, prompt: 'different version' };
  saved.setItem('native-atoms', JSON.stringify({ 'composer-retained-documents-v1': { 'local:thread-1': changed } }));
  assert.equal(loadDraft({ ...context, legacyDraftKey: 'local:thread-1' }).draft.blocked, blocked.draft.blocked);
});

test('conflicting retained and prompt documents remain distinct and block editing', () => {
  const saved = storage();
  const document = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
  const prompt = { document: document('Draft version'), plainTextMode: true };
  const retained = { document: document('Retained version'), plainTextMode: true, prompt: 'Retained version' };
  saved.setItem('native-atoms', JSON.stringify({ 'client-thread-bindings-v1': { client: 'thread-1' },
    'composer-prompt-drafts-v2': { client: { prompt, pullRequestChecks: [] } },
    'composer-retained-documents-v1': { 'local:thread-1': retained } }));
  const draft = loadDraft({ ...context, legacyDraftKey: 'client' }).draft;
  assert.match(textEditIssue(draft) ?? '', /不同版本/);
  assert.deepEqual((draft.preserved as { draft: { prompt: unknown } }).draft.prompt, prompt);
  assert.deepEqual((draft.preserved as { retained: unknown }).retained, retained);
});

test('legacy thread drafts are restored only for an explicit matching identity', () => {
  const saved = storage();
  const legacyKey = 'codex-yard.composer.v1:' + JSON.stringify(['local', 'thread-1', null]);
  saved.setItem(legacyKey, JSON.stringify({ revision: 'old', draft: emptyDraft(), prefills: [] }));
  saved.setItem('native-atoms', JSON.stringify({ 'client-thread-bindings-v1': { 'original-client': 'thread-1' },
    'composer-prompt-drafts-v1': { 'original-client': 'Original client draft' } }));
  assert.equal(loadDraft({ ...context, draftId: 'new-client' }).draft.text, '');
  assert.equal(loadDraft({ ...context, draftId: 'original-client' }).draft.text, 'Original client draft');
  assert.equal(loadDraft({ ...context, legacyDraftKey: 'original-client' }).draft.text, 'Original client draft');
  assert.equal(loadDraft({ ...context, legacyDraftKey: legacyKey }).revision, 'old');
  assert.throws(() => draftKey({ ...context, draftId: '' }), /draftId is required/);
});

test('ordered input, hints, references and file IDs survive normalization and serialization', () => {
  const draft: ComposerDraft = { text: 'Original', images: [{ id: 'i', src: '', fileId: 'file-1' }], files: [],
    references: [{ id: 'r', text: 'selected', context: { line: 2 }, original: { opaque: true } }], hints: [{ range: [1, 2] }],
    input: [{ type: 'text', text: 'Original', text_elements: [] }, { type: 'image', fileId: 'file-1', detail: 'high' },
      { type: 'future-kind', payload: { preserved: true } }] };
  const normalized = normalizeDraft(draft);
  assert.deepEqual(draftToInput(normalized, 'local'), [...draft.input!, { type: 'text', text: 'selected', text_elements: [] }]);
  assert.deepEqual(normalized.references, draft.references);
  assert.deepEqual(normalized.hints, draft.hints);
  assert.ok(textEditIssue(normalized));
  const editable = normalizeDraft({ ...draft, hints: [] });
  const updated = updateDraftText(editable, 'Edited');
  assert.deepEqual(draftToInput(updated, 'local'), [{ type: 'text', text: 'Edited', text_elements: [] }, ...draft.input!.slice(1), { type: 'text', text: 'selected', text_elements: [] }]);
  assert.deepEqual(draftToInput({ text: '', images: [{ id: 'i', src: '', fileId: 'file-1' }], files: [] }, 'local'), [{ type: 'image', fileId: 'file-1' }]);
});

test('conflicting structured prefill retains both drafts instead of flattening either', () => {
  const current = { ...emptyDraft(), text: 'Existing' };
  const incoming: ComposerDraft = { text: 'New', images: [], files: [], input: [{ type: 'text', text: 'New', text_elements: [] }] };
  const merged = mergePrefill(current, incoming);
  assert.equal(merged.text, 'Existing');
  assert.deepEqual(merged.pendingDrafts, [incoming]);
  assert.equal(textEditIssue(merged), null);
  const switched = activatePending(merged, true);
  assert.equal(switched.text, 'New');
  assert.equal(switched.pendingDrafts?.[0]?.text, 'Existing');
  assert.equal(activatePending(switched, false).text, 'Existing');
});

test('colliding reference identities with different context retain both versions', () => {
  const current = { ...emptyDraft(), references: [{ id: 'same', text: 'first', context: { line: 1 } }] };
  const incoming: ComposerDraft = { text: '', images: [], files: [], references: [{ id: 'same', text: 'second', context: { line: 2 } }] };
  const merged = mergePrefill(current, incoming);
  assert.deepEqual(merged.references, current.references);
  assert.deepEqual(merged.pendingDrafts, [incoming]);
  const switched = activatePending(merged, true);
  assert.deepEqual(switched.references, incoming.references);
  assert.deepEqual(switched.pendingDrafts?.[0]?.references, current.references);
});
