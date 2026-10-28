import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activatePending, draftKey, draftToInput, emptyDraft, loadDraft, mergePrefill, normalizeDraft, textEditIssue, updateDraftText, writeDraft } from '../src/renderer/composer/standalone-draft.ts';
import type { ComposerContext, ComposerDraft } from '../src/renderer/workbench-contract.ts';

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
  const draft = loadDraft(context).draft;
  assert.equal(draft.text, 'Saved draft');
  assert.deepEqual(draft.document, document);
  assert.equal(textEditIssue(draft), null);
  const changed = updateDraftText(draft, 'Changed\nline');
  assert.equal(changed.text, 'Changed\nline');
  assert.deepEqual(changed.preserved, draft.preserved);
  assert.equal(writeDraft(draftKey(context), { revision: 'new', draft: changed, prefills: [] }), true);
  assert.equal(saved.getItem('native-atoms'), raw);
  assert.equal(loadDraft({ ...context, cwd: '/other' }).draft.text, 'Changed\nline');
});

test('legacy new-draft identity and v1 fallback are supported without sharing cwd identity', () => {
  const saved = storage();
  saved.setItem('native-atoms', JSON.stringify({ 'draft-thread-identities-v1': { 'new-conversation': 'client-new' },
    'client-thread-bindings-v1': {}, 'composer-prompt-drafts-v1': { 'client-new': 'Legacy new message' } }));
  const value = loadDraft({ hostId: 'local', threadId: null, cwd: '/workspace', draftId: 'new-1' });
  assert.equal(value.draft.text, 'Legacy new message');
  assert.equal(textEditIssue(value.draft), null);
});

test('rich documents and opaque legacy metadata remain preserved and cannot be overwritten by text editing', () => {
  const saved = storage();
  const document = { type: 'doc', attrs: { version: 1 }, content: [{ type: 'paragraph', content: [
    { type: 'text', text: 'Bold', marks: [{ type: 'strong', attrs: { source: 'original' } }] },
  ] }] };
  const record = { draft: { prompt: { document, plainTextMode: false }, pullRequestChecks: [{ id: 'keep' }] } };
  saved.setItem('native-atoms', JSON.stringify({ 'composer-prompt-drafts-v2': { 'local:thread-1': record } }));
  const draft = loadDraft(context).draft;
  assert.ok(textEditIssue(draft));
  assert.deepEqual(draft.document, document);
  assert.deepEqual(updateDraftText(draft, 'replacement'), draft);
  assert.deepEqual((draft.preserved as { draft: unknown }).draft, record);
});

test('conflicting retained and prompt documents remain distinct and block editing', () => {
  const saved = storage();
  const document = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
  const prompt = { document: document('Draft version'), plainTextMode: true };
  const retained = { document: document('Retained version'), plainTextMode: true, prompt: 'Retained version' };
  saved.setItem('native-atoms', JSON.stringify({ 'client-thread-bindings-v1': { client: 'thread-1' },
    'composer-prompt-drafts-v2': { client: { prompt, pullRequestChecks: [] } },
    'composer-retained-documents-v1': { 'local:thread-1': retained } }));
  const draft = loadDraft(context).draft;
  assert.match(textEditIssue(draft) ?? '', /不同版本/);
  assert.deepEqual((draft.preserved as { draft: { prompt: unknown } }).draft.prompt, prompt);
  assert.deepEqual((draft.preserved as { retained: unknown }).retained, retained);
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
