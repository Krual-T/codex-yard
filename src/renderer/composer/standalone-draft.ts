import type { ComposerContext, ComposerDocument, ComposerDraft, ComposerImage } from '../workbench-contract.ts';
import { applyTextEdits, canRemoveImageAttachment, textEdits } from '../messages/message-edit.ts';
import { composerSchema, isOrdinaryRichText, readRichDocument, richDocumentSkills, serializePlainDocument, serializeRichDocument } from './rich-document.ts';
import type { Node as ProseMirrorNode } from 'prosemirror-model';

export interface DraftImage extends ComposerImage { previewSrc: string }
export interface DraftSkill { name: string; path: string }
export interface Draft extends ComposerDraft {
  images: DraftImage[];
  references: NonNullable<ComposerDraft['references']>;
  skills: DraftSkill[];
  /** Original data remains available when this editor cannot represent it. */
  preserved?: unknown;
  pendingDrafts?: ComposerDraft[];
  blocked?: string;
}
export interface StoredDraft { revision: string; draft: Draft; prefills: string[]; legacyPending?: boolean }
export const legacyBlockedMessage = '此草稿包含格式或上下文，当前编辑器不能无损编辑。';
export const structuredEditIssue = '此消息包含格式化或分段内容，当前编辑器不能无损编辑。';

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');

export function createId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 15) | 64;
  bytes[8] = (bytes[8]! & 63) | 128;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export const emptyDraft = (): Draft => ({ text: '', images: [], files: [], references: [], skills: [] });
export function normalizeDraft(draft: ComposerDraft): Draft {
  return {
    ...draft,
    images: draft.images.map(image => ({ ...image, previewSrc: image.previewSrc ?? image.src })),
    files: draft.files.map(file => ({ ...file })),
    references: (draft.references ?? []).map(reference => ({ ...reference })),
    skills: (draft.skills ?? []).map(skill => ({ ...skill })),
  };
}
export function draftKey(context: ComposerContext): string {
  if (!context.draftId) throw new Error('Composer draftId is required');
  return 'codex-yard.composer.v2:' + JSON.stringify([context.hostId, context.draftId]);
}
function isDocument(value: unknown): value is ComposerDocument {
  if (!record(value) || typeof value.type !== 'string' || (value.text !== undefined && typeof value.text !== 'string')
    || (value.attrs !== undefined && !record(value.attrs))) return false;
  if (value.marks !== undefined && (!Array.isArray(value.marks) || !value.marks.every(mark => record(mark)
    && typeof mark.type === 'string' && (mark.attrs === undefined || record(mark.attrs))))) return false;
  return value.content === undefined || Array.isArray(value.content) && value.content.every(isDocument);
}
function isComposerDraft(value: unknown): value is ComposerDraft {
  if (!record(value) || typeof value.text !== 'string' || !Array.isArray(value.images) || !Array.isArray(value.files)) return false;
  return value.images.every(image => record(image) && typeof image.id === 'string' && typeof image.src === 'string'
      && (image.previewSrc === undefined || typeof image.previewSrc === 'string')
      && (image.name === undefined || typeof image.name === 'string') && (image.path === undefined || typeof image.path === 'string')
      && (image.fileId === undefined || typeof image.fileId === 'string'))
    && value.files.every(file => record(file) && typeof file.path === 'string' && typeof file.name === 'string')
    && (value.references === undefined || Array.isArray(value.references) && value.references.every(reference => record(reference)
      && typeof reference.id === 'string' && typeof reference.text === 'string'
      && (reference.kind === undefined || typeof reference.kind === 'string') && (reference.context === undefined || record(reference.context))))
    && (value.skills === undefined || Array.isArray(value.skills) && value.skills.every(skill => record(skill) && typeof skill.name === 'string' && typeof skill.path === 'string'))
    && (value.document === undefined || isDocument(value.document))
    && (value.input === undefined || Array.isArray(value.input) && value.input.every(record))
    && (value.hints === undefined || Array.isArray(value.hints))
    && (value.pendingDrafts === undefined || Array.isArray(value.pendingDrafts) && value.pendingDrafts.every(isComposerDraft))
    && (value.blocked === undefined || typeof value.blocked === 'string');
}
function isDraft(value: unknown): value is Draft {
  return isComposerDraft(value) && Array.isArray(value.references) && Array.isArray(value.skills)
    && value.images.every(image => typeof image.previewSrc === 'string');
}
export function isStoredDraft(value: unknown): value is StoredDraft {
  return record(value) && typeof value.revision === 'string' && strings(value.prefills) && isDraft(value.draft)
    && (value.legacyPending === undefined || typeof value.legacyPending === 'boolean');
}
function invalidStored(value: unknown): StoredDraft {
  return { revision: createId(), prefills: [], draft: { ...emptyDraft(), preserved: value,
    blocked: '保存的草稿包含无法读取的内容，已保留原始数据。' } };
}
export function parseStoredDraft(raw: string): StoredDraft {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return invalidStored(raw); }
  if (!record(value) || typeof value.revision !== 'string' || !strings(value.prefills) || !record(value.draft)
    || value.legacyPending !== undefined && typeof value.legacyPending !== 'boolean'
    || Object.keys(value).some(key => !['revision', 'draft', 'prefills', 'legacyPending'].includes(key))) return invalidStored(value);
  const draft = { ...value.draft, skills: value.draft.skills ?? [] };
  if (!isDraft(draft)) return invalidStored(value);
  return { revision: value.revision, draft, prefills: value.prefills,
    ...(value.legacyPending === true ? { legacyPending: true } : {}) };
}
function emptyMetadata(value: unknown): boolean {
  return value == null || value === false || value === '' || Array.isArray(value) && value.length === 0;
}
function legacyPlainTextMode(draft: ComposerDraft): boolean | undefined {
  if (!('preserved' in draft) || !record(draft.preserved)) return undefined;
  const preserved = draft.preserved;
  if (typeof preserved.promptKey !== 'string' && typeof preserved.retainedKey !== 'string') return undefined;
  const raw = preserved.draft;
  const saved = record(raw) && 'draft' in raw ? raw.draft : raw;
  const prompt = record(saved) && 'prompt' in saved ? saved.prompt : saved;
  const source = record(preserved.retained) && 'document' in preserved.retained ? preserved.retained : prompt;
  return record(source) && typeof source.plainTextMode === 'boolean' ? source.plainTextMode : undefined;
}
function plainParagraphs(document: ComposerDocument): string[] | null {
  const only = (node: ComposerDocument, keys: string[]) => Object.keys(node).every(key => keys.includes(key));
  if (document.type !== 'doc' || !only(document, ['type', 'content']) || !Array.isArray(document.content)) return null;
  const paragraphs: string[] = [];
  for (const paragraph of document.content) {
    if (paragraph.type !== 'paragraph' || !only(paragraph, ['type', 'content']) || (paragraph.content != null && !Array.isArray(paragraph.content))) return null;
    let text = '';
    for (const child of paragraph.content ?? []) {
      if (child.type === 'text' && typeof child.text === 'string' && only(child, ['type', 'text'])) text += child.text;
      else if ((child.type === 'hard_break' || child.type === 'hardBreak') && only(child, ['type'])) text += '\n';
      else return null;
    }
    paragraphs.push(text);
  }
  return paragraphs;
}
function plainDocument(document: ComposerDocument, expected?: string): string | null {
  const paragraphs = plainParagraphs(document);
  if (!paragraphs) return null;
  if (paragraphs.length <= 1) return paragraphs[0] ?? '';
  const choices = [paragraphs.join('\n\n'), paragraphs.join('\n')];
  return expected !== undefined && choices.includes(expected) ? expected : null;
}
function editedPlainDocument(document: ComposerDocument, previous: ComposerDocument, text: string): string | null {
  const before = plainParagraphs(previous), after = plainParagraphs(document);
  if (!before || !after || plainDocument(previous, text) !== text) return null;
  const separator = before.join('\n\n') === text && before.join('\n') !== text ? '\n\n' : '\n';
  return after.join(separator);
}
export function documentFromText(text: string): ComposerDocument {
  return { type: 'doc', content: text.split('\n').map(line => ({ type: 'paragraph',
    ...(line ? { content: [{ type: 'text', text: line }] } : {}) })) };
}

function legacyKeys(context: ComposerContext, atoms: Record<string, unknown>): string[] {
  const keys: string[] = [];
  const add = (key: unknown) => { if (typeof key === 'string' && key && !keys.includes(key)) keys.push(key); };
  const bindings = record(atoms['client-thread-bindings-v1']) ? atoms['client-thread-bindings-v1'] : {};
  const identities = record(atoms['draft-thread-identities-v1']) ? atoms['draft-thread-identities-v1'] : {};
  if (context.hostId !== 'local') {
    const qualified = (key: string) => key.startsWith(context.hostId + ':')
      || record(bindings[key]) && bindings[key].hostId === context.hostId && bindings[key].threadId === context.threadId;
    if (context.legacyDraftKey && qualified(context.legacyDraftKey)) add(context.legacyDraftKey);
    if (qualified(context.draftId)) add(context.draftId);
    for (const [key, binding] of Object.entries(bindings)) {
      if (record(binding) && binding.hostId === context.hostId && binding.threadId === context.threadId) add(key);
    }
    return keys;
  }
  add(context.legacyDraftKey);
  add(context.draftId);
  if (context.threadId) {
    if (context.legacyDraftKey || context.draftId === context.threadId || context.draftId === 'local:' + context.threadId
      || bindings[context.draftId] === context.threadId) {
      add('local:' + context.threadId);
      add(context.threadId);
    }
    for (const [alias, threadId] of Object.entries(bindings)) if (threadId === context.threadId) add(alias);
  } else {
    const location = context.placement === 'side-chat' || context.placement === 'mini' ? 'panel-new-conversation' : 'new-conversation';
    const identity = identities[location];
    const matchesIdentity = typeof identity === 'string' && (context.draftId === identity || context.legacyDraftKey === identity);
    if (context.draftId === location || context.legacyDraftKey === location || matchesIdentity) {
      add(location);
      if (typeof identity === 'string' && bindings[identity] == null) add(identity);
    }
  }
  return keys;
}
function readLegacy(atoms: Record<string, unknown>, promptKey: string | undefined, retainedKey: string | undefined, useV1 = false): StoredDraft | null {
  const v2 = record(atoms['composer-prompt-drafts-v2']) ? atoms['composer-prompt-drafts-v2'] : {};
  const v1 = record(atoms['composer-prompt-drafts-v1']) ? atoms['composer-prompt-drafts-v1'] : {};
  const retained = record(atoms['composer-retained-documents-v1']) ? atoms['composer-retained-documents-v1'] : {};
  if (promptKey === undefined && retainedKey === undefined) return null;
  const raw = promptKey === undefined ? undefined : useV1 ? v1[promptKey] : v2[promptKey] ?? v1[promptKey];
  const draft = record(raw) && 'draft' in raw ? raw.draft : raw;
  const value = record(draft) && 'prompt' in draft ? draft.prompt : draft;
  const retainedValue = retainedKey === undefined ? undefined : retained[retainedKey];
  const source = record(retainedValue) && 'document' in retainedValue ? retainedValue : value;
  const savedPrompt = record(retainedValue) && typeof retainedValue.prompt === 'string' ? retainedValue.prompt : undefined;
  const promptText = typeof value === 'string' ? value : savedPrompt;
  let text = promptText ?? '';
  let document: ComposerDocument | undefined;
  let blocked: string | undefined;
  if (record(source) && 'document' in source) {
    if (isDocument(source.document)) {
      document = source.document;
      const plain = plainDocument(document, promptText);
      if (source.plainTextMode !== true && plain !== null && (promptText === undefined || plain === promptText)) text = plain;
      else {
        const rich = readRichDocument(document);
        if (rich === null) blocked = '此草稿包含尚不支持的文档内容，已保留原始数据。';
        else if (promptText === undefined) text = source.plainTextMode === true ? serializePlainDocument(rich, true) : serializeRichDocument(rich);
        else if ((source.plainTextMode === true || plain !== promptText)
          && (source.plainTextMode === true ? serializePlainDocument(rich, true) : serializeRichDocument(rich)) !== promptText) {
          blocked = '此草稿的文档与保存的文本不一致，已保留两个版本。';
        }
      }
    } else blocked = '此草稿的文档格式无法读取，已保留原始数据。';
  } else if (value !== undefined && typeof value !== 'string') blocked = '此草稿包含未识别的内容，已保留原始数据。';
  if (record(value) && 'document' in value && source !== value && record(source)
    && (JSON.stringify(value.document) !== JSON.stringify(source.document)
      || typeof value.plainTextMode === 'boolean' && typeof source.plainTextMode === 'boolean' && value.plainTextMode !== source.plainTextMode)) {
    blocked = '此草稿包含不同版本的文档，均已保留。';
  }
  if (record(source) && 'plainTextMode' in source && typeof source.plainTextMode !== 'boolean'
    || record(value) && 'plainTextMode' in value && typeof value.plainTextMode !== 'boolean') {
    blocked = '此草稿包含未识别的内容，已保留原始数据。';
  }
  if (record(value) && Object.entries(value).some(([key, item]) => key !== 'document' && key !== 'plainTextMode' && !emptyMetadata(item))
    || record(retainedValue) && Object.entries(retainedValue).some(([key, item]) => key !== 'document' && key !== 'plainTextMode' && key !== 'prompt' && !emptyMetadata(item))) {
    blocked = '此草稿包含额外文档信息，当前编辑器不能无损编辑。';
  }
  if (record(draft) && Object.entries(draft).some(([key, item]) => key !== 'prompt' && !emptyMetadata(item))) {
    blocked = '此草稿包含额外上下文，当前编辑器不能无损编辑。';
  }
  return { revision: createId(), prefills: [], draft: { ...emptyDraft(), text, document, blocked,
    preserved: { promptKey, retainedKey, draft: raw, retained: retainedValue } } };
}

/** Offer recovery of an already-imported legacy version without discarding its raw envelope. */
export function recoverLegacyDraft(draft: Draft): Draft | null {
  const unsupported = '此草稿包含尚不支持的文档内容，已保留原始数据。';
  const mismatch = '此草稿的文档与保存的文本不一致，已保留两个版本。';
  if (![legacyBlockedMessage, unsupported, mismatch].includes(draft.blocked ?? '') || !record(draft.preserved)) return null;
  const preserved = draft.preserved;
  const promptKey = typeof preserved.promptKey === 'string' ? preserved.promptKey : undefined;
  const retainedKey = typeof preserved.retainedKey === 'string' ? preserved.retainedKey : undefined;
  if (!promptKey && !retainedKey) return null;
  const atoms = {
    'composer-prompt-drafts-v2': promptKey && 'draft' in preserved ? { [promptKey]: preserved.draft } : {},
    'composer-retained-documents-v1': retainedKey && 'retained' in preserved ? { [retainedKey]: preserved.retained } : {},
  };
  const recovered = readLegacy(atoms, promptKey, retainedKey);
  if (!recovered || recovered.draft.blocked || JSON.stringify(recovered.draft.document) !== JSON.stringify(draft.document)
    || JSON.stringify(recovered.draft.preserved) !== JSON.stringify(preserved)) return null;
  const raw = preserved.draft, saved = record(raw) && 'draft' in raw ? raw.draft : raw;
  const prompt = record(saved) && 'prompt' in saved ? saved.prompt : saved;
  const hadSavedText = typeof prompt === 'string' || record(preserved.retained) && typeof preserved.retained.prompt === 'string';
  if (draft.text !== recovered.draft.text && !(draft.blocked === unsupported && draft.text === '' && !draft.input && !hadSavedText)) return null;
  const candidate = { ...draft, text: recovered.draft.text, blocked: undefined };
  return richEditIssue(candidate) ? null : candidate;
}
export function legacyDraftCandidates(context: ComposerContext, atoms: Record<string, unknown>): StoredDraft[] {
  const keys = legacyKeys(context, atoms);
  const v2 = record(atoms['composer-prompt-drafts-v2']) ? atoms['composer-prompt-drafts-v2'] : {};
  const v1 = record(atoms['composer-prompt-drafts-v1']) ? atoms['composer-prompt-drafts-v1'] : {};
  const retained = record(atoms['composer-retained-documents-v1']) ? atoms['composer-retained-documents-v1'] : {};
  const prompts = keys.filter(key => Object.hasOwn(v2, key) || Object.hasOwn(v1, key));
  const retainedKeys = keys.filter(key => Object.hasOwn(retained, key));
  const used = new Set<string>();
  const result: StoredDraft[] = [];
  for (const key of prompts) {
    let retainedKey = retainedKeys.find(candidate => candidate === key && !used.has(candidate));
    if (!retainedKey && prompts.length === 1) retainedKey = retainedKeys.find(candidate => !used.has(candidate));
    if (!retainedKey && prompts.length > 1) {
      const raw = Object.hasOwn(v2, key) ? v2[key] : v1[key];
      const value = record(raw) && 'draft' in raw ? raw.draft : raw;
      const prompt = record(value) && 'prompt' in value ? value.prompt : value;
      retainedKey = retainedKeys.find(candidate => !used.has(candidate) && record(retained[candidate])
        && typeof prompt === 'string' && retained[candidate].prompt === prompt);
    }
    if (retainedKey) used.add(retainedKey);
    const value = readLegacy(atoms, key, retainedKey);
    if (value) result.push(value);
    if (v2[key] != null && Object.hasOwn(v1, key) && JSON.stringify(v1[key]) !== JSON.stringify(v2[key])) {
      const older = readLegacy(atoms, key, undefined, true);
      if (older) result.push(older);
    }
  }
  for (const key of retainedKeys) {
    if (!used.has(key)) {
      const value = readLegacy(atoms, undefined, key);
      if (value) result.push(value);
    }
  }
  return result;
}
export function isPristine(draft: Draft): boolean {
  return draft.text === '' && !draft.images.length && !draft.files.length && !draft.references.length && !draft.skills.length
    && Object.keys(draft).every(key => ['text', 'images', 'files', 'references', 'skills'].includes(key));
}

/** Reconcile a transactional legacy snapshot with the latest in-memory draft. */
export function loadDraft(context: ComposerContext, atoms: Record<string, unknown>, saved: StoredDraft | null): StoredDraft {
  const legacyVersions = () => legacyDraftCandidates(context, atoms);
  if (saved?.legacyPending) {
    const versions = legacyVersions(), legacy = versions.shift();
    const { legacyPending: _pending, ...settled } = saved;
    if (!legacy) return settled;
    const first = isPristine(saved.draft) ? legacy.draft : {
      ...saved.draft, pendingDrafts: [...saved.draft.pendingDrafts ?? [], legacy.draft],
    };
    const draft = versions.length ? { ...first, pendingDrafts: [...first.pendingDrafts ?? [], ...versions.map(version => version.draft)] } : first;
    return { ...settled, draft };
  }
  if (saved?.draft.blocked === legacyBlockedMessage) {
    const legacy = legacyVersions().find(version => JSON.stringify(version.draft.preserved) === JSON.stringify(saved.draft.preserved));
    const candidate = { ...saved.draft, blocked: undefined };
    if (legacy && !legacy.draft.blocked && JSON.stringify(candidate.document) === JSON.stringify(legacy.draft.document)
      && candidate.text === legacy.draft.text && JSON.stringify(candidate.preserved) === JSON.stringify(legacy.draft.preserved)
      && !richEditIssue(candidate)) return { ...saved, draft: candidate };
  }
  if (saved) return saved;
  const versions = legacyVersions(), first = versions.shift();
  if (!first) return { revision: createId(), draft: emptyDraft(), prefills: [] };
  return versions.length ? { ...first, draft: { ...first.draft, pendingDrafts: versions.map(version => version.draft) } } : first;
}
export function textEditIssue(draft: Draft): string | null {
  if (draft.blocked) return draft.blocked;
  if (draft.document && plainDocument(draft.document, draft.text) !== draft.text) return '此草稿包含格式，当前编辑器不能无损编辑。';
  if (draft.hints?.length) return '此草稿包含提示信息，当前编辑器不能无损编辑。';
  if (draft.input) {
    const text = draft.input.filter(item => item.type === 'text');
    if (text.length > 1 || text.some(item => typeof item.text !== 'string' || !Array.isArray(item.text_elements)
      || item.text_elements.length || item.text !== draft.text) || !text.length && draft.text) {
      return structuredEditIssue;
    }
  }
  return null;
}
export function richEditIssue(draft: Draft): string | null {
  if (draft.blocked) return draft.blocked;
  const document = draft.document && readRichDocument(draft.document);
  if (!document) return '此草稿包含尚不支持的文档内容，已保留原始数据。';
  const serialized = legacyPlainTextMode(draft) === true ? serializePlainDocument(document, true) : serializeRichDocument(document);
  if (serialized !== draft.text && (legacyPlainTextMode(draft) === true || plainDocument(draft.document!, draft.text) !== draft.text)
    && !(draft.input && serializePlainDocument(document) === draft.text)) {
    return '此草稿的文档与保存的文本不一致，已保留两个版本。';
  }
  if (draft.hints?.length) return '此草稿包含提示信息，当前编辑器不能无损编辑。';
  if (draft.input) {
    const text = draft.input.filter(item => item.type === 'text');
    if (text.length > 1 || text.some(item => typeof item.text !== 'string' || !Array.isArray(item.text_elements)
      || item.text_elements.length || item.text !== draft.text) || !text.length && draft.text) {
      return structuredEditIssue;
    }
    const skills = richDocumentSkills(document);
    if (draft.input.some(item => item.type === 'skill' && skills.some(skill => skill.name === item.name && skill.path === item.path)
      && Object.keys(item).some(key => !['type', 'name', 'path'].includes(key)))) {
      return '此技能引用包含额外信息，当前编辑器不能无损编辑。';
    }
  }
  return null;
}

export function updateRichDraft(draft: Draft, document: ComposerDocument): Draft {
  if (richEditIssue(draft)) return draft;
  const next = readRichDocument(document), previous = draft.document && readRichDocument(draft.document);
  if (!next || !previous) return draft;
  const text = legacyPlainTextMode(draft) === true ? serializePlainDocument(next, true)
    : editedPlainDocument(document, draft.document!, draft.text) ?? serializeRichDocument(next);
  const oldSkills = richDocumentSkills(previous), newSkills = richDocumentSkills(next);
  const removed = oldSkills.filter(old => !newSkills.some(skill => skill.name === old.name && skill.path === old.path));
  const input = draft.input?.filter(item => !removed.some(skill => item.type === 'skill'
    && item.name === skill.name && item.path === skill.path)).map(item => item.type === 'text' ? { ...item, text } : item);
  if (input && !input.some(item => item.type === 'text') && text) input.unshift({ type: 'text', text, text_elements: [] });
  return { ...draft, text, document, ...(input ? { input } : {}) };
}
export function updateDraftText(draft: Draft, text: string): Draft {
  if (textEditIssue(draft)) return draft;
  const input = draft.input?.map(item => item.type === 'text' ? { ...item, text } : item);
  if (input && !input.some(item => item.type === 'text') && text) input.unshift({ type: 'text', text, text_elements: [] });
  return { ...draft, text, ...(input ? { input } : {}), ...(draft.document ? { document: documentFromText(text) } : {}) };
}

export type StructuredDraftEdit = { draft: Draft; error?: never } | { draft?: never; error: string };

export function isStructuredAppInput(entry: Record<string, unknown>): boolean {
  return Array.isArray(entry.text_elements) && entry.text_elements.some(element => record(element)
    && typeof element.placeholder === 'string' && element.placeholder.startsWith('codex-untrusted-app-input:'));
}

/** This is a projection of the existing draft, not another editable draft store. */
export function canEditStructuredDraft(draft: Draft): boolean {
  if (draft.blocked || draft.hints?.length || !draft.input
    || draft.input.some(entry => entry.type === 'text' && typeof entry.text !== 'string')) return false;
  const edits = textEdits(draft);
  if (!edits.length || edits.map(item => item.text).join('\n') !== draft.text) return false;
  if (draft.document) {
    const document = readRichDocument(draft.document);
    if (!document) return false;
    const saved = legacyPlainTextMode(draft) === true ? serializePlainDocument(document, true) : serializeRichDocument(document);
    if (saved !== draft.text && plainDocument(draft.document, draft.text) !== draft.text
      && serializePlainDocument(document) !== draft.text) return false;
  }
  return true;
}

/** Update one original protocol text item without flattening the surrounding ordered input. */
export function editStructuredDraftText(draft: Draft, index: number, expectedText: string, text: string): StructuredDraftEdit {
  if (!canEditStructuredDraft(draft) || !draft.input) {
    return { error: 'This draft contains context that cannot be edited as separate text segments.' };
  }
  const edits = textEdits(draft);
  const entry = draft.input[index];
  if (!entry || entry.type !== 'text' || entry.text !== expectedText) {
    return { error: 'This input segment changed. Review the current draft before editing.' };
  }
  if (expectedText === text) return { draft };
  if (isStructuredAppInput(entry)) {
    return { error: 'This app input contains retained context and cannot be edited here.' };
  }
  if (Array.isArray(entry.text_elements) && entry.text_elements.some(element => !record(element)
    || Object.keys(element).some(key => key !== 'byteRange' && key !== 'placeholder')
    || !record(element.byteRange) || Object.keys(element.byteRange).some(key => key !== 'start' && key !== 'end')
    || element.placeholder !== null && typeof element.placeholder !== 'string')) {
    return { error: 'This input contains unrecognized reference metadata. The original content was retained.' };
  }
  try {
    const result = applyTextEdits(draft, edits.map(item => item.index === index ? { ...item, text } : item), '');
    return result.draft ? { draft: normalizeDraft(result.draft) } : { error: result.error };
  } catch {
    return { error: 'This input could not be copied without losing its original content.' };
  }
}

function removeOrderedInput(draft: Draft, index: number, removedImageId?: string): StructuredDraftEdit {
  if (!draft.input?.[index]) return { error: 'The original input no longer matches this attachment.' };
  const images: DraftImage[] = [];
  for (const image of draft.images) {
    if (image.id === removedImageId) continue;
    const match = /^image-(\d+)$/.exec(image.id);
    if (!match) { images.push(image); continue; }
    const original = Number(match[1]);
    if (!Number.isSafeInteger(original) || image.id !== `image-${original}` || !canRemoveImageAttachment(draft, original)) {
      return { error: 'An image no longer matches its original attachment. The original content was retained.' };
    }
    images.push(original > index ? { ...image, id: `image-${original - 1}` } : image);
  }
  return { draft: { ...draft, images, input: draft.input.filter((_item, position) => position !== index) } };
}

/** Remove an image from its original ordered input only when the association is unambiguous. */
export function removeStructuredImage(draft: Draft, id: string): StructuredDraftEdit {
  const images = draft.images.filter(image => image.id === id);
  if (images.length !== 1) return { error: 'This image no longer has a unique draft identity.' };
  // Message editing creates these projection IDs from the original input index.
  // Uploads have independent IDs and must never remove a matching original item.
  if (!/^image-\d+$/.test(id)) return { draft: { ...draft, images: draft.images.filter(item => item.id !== id) } };
  const index = Number(id.slice(6));
  if (!Number.isSafeInteger(index) || id !== `image-${index}` || !canRemoveImageAttachment(draft, index)) {
    return { error: 'This image no longer matches its original attachment. The original content was retained.' };
  }
  return removeOrderedInput(draft, index, id);
}

export function removeStructuredSkill(draft: Draft, name: string, path: string): StructuredDraftEdit {
  const skills = draft.skills.filter(skill => skill.name === name && skill.path === path);
  const indexes = (draft.input ?? []).flatMap((item, index) =>
    item.type === 'skill' && item.name === name && item.path === path ? [index] : []);
  const document = draft.document && readRichDocument(draft.document);
  if (skills.length !== 1 || indexes.length > 1 || document && richDocumentSkills(document).some(skill => skill.name === name && skill.path === path)) {
    return { error: 'This skill cannot be removed without changing other retained content.' };
  }
  const result = indexes.length ? removeOrderedInput(draft, indexes[0]!) : { draft };
  return result.draft ? { draft: { ...result.draft, skills: result.draft.skills.filter(skill => skill.name !== name || skill.path !== path) } } : result;
}
export function mergePrefill(current: Draft, incoming: ComposerDraft): Draft {
  const next = normalizeDraft(incoming);
  if (!hasContent(current) && !current.pendingDrafts?.length && !current.blocked) return next;
  const conflict = <T,>(left: T[], right: T[], id: (value: T) => string): boolean => {
    const seen = new Map<string, string>();
    try {
      for (const value of [...left, ...right]) {
        const key = id(value), serialized = JSON.stringify(value);
        if (seen.has(key) && seen.get(key) !== serialized) return true;
        seen.set(key, serialized);
      }
      return false;
    } catch { return true; }
  };
  if (next.input || next.document || next.hints?.length || current.input || current.document || current.hints?.length || current.blocked || current.pendingDrafts?.length
    || conflict(current.images, next.images, value => value.id) || conflict(current.files, next.files, value => value.path)
    || conflict(current.references, next.references, value => value.id) || conflict(current.skills, next.skills, value => value.path)) {
    return { ...current, pendingDrafts: [...current.pendingDrafts ?? [], incoming] };
  }
  const merge = <T,>(left: T[], right: T[], id: (value: T) => string): T[] => {
    const seen = new Set(left.map(id));
    return [...left, ...right.filter(value => { const key = id(value); if (seen.has(key)) return false; seen.add(key); return true; })];
  };
  return { ...current, text: current.text && next.text ? current.text + '\n' + next.text : current.text || next.text,
    images: merge(current.images, next.images, value => value.id), files: merge(current.files, next.files, value => value.path),
    references: merge(current.references, next.references, value => value.id), skills: merge(current.skills, next.skills, value => value.path) };
}

/** Switch drafts without flattening a structured prefill into the active draft. */
export function activatePending(draft: Draft, keepCurrent: boolean): Draft {
  if (!draft.pendingDrafts?.length) return keepCurrent ? draft : emptyDraft();
  const [next, ...remaining] = draft.pendingDrafts;
  const { pendingDrafts: _pending, ...current } = draft;
  const parked = keepCurrent && !isPristine(current) ? [...remaining, current] : remaining;
  return { ...normalizeDraft(next!), ...(parked.length ? { pendingDrafts: parked } : {}) };
}

export interface DraftInputOptions { plainTextMode?: boolean }

export type UntrustedAppOutput = { type: 'input_text'; text: string } | { type: 'input_image'; image_url: string };
export type UntrustedAppResponseItem =
  | { type: 'function_call'; call_id: string; name: 'untrusted_input'; arguments: '{}' }
  | { type: 'function_call_output'; call_id: string; output: UntrustedAppOutput[] };
export interface PrepareDraftInputOptions extends DraftInputOptions { callId?: string }
export interface PreparedDraftInput { input: Record<string, unknown>[]; responseItems: UntrustedAppResponseItem[] }

/** Map ranges only where the formatted and plain strings share one unambiguous character alignment. */
function remapFormattedRanges(item: Record<string, unknown>, before: string, after: string): Record<string, unknown> {
  if (before === after) return item;
  if (isStructuredAppInput(item) || Object.keys(item).some(key => !['type', 'text', 'text_elements'].includes(key))) {
    throw new Error('格式化文本包含无法安全转换的原始上下文，已保留原始草稿。');
  }
  if (item.text_elements === undefined || Array.isArray(item.text_elements) && !item.text_elements.length) return { ...item, text: after };
  const source = Array.from(before), target = Array.from(after);
  const short = source.length <= target.length ? source : target, long = source.length <= target.length ? target : source;
  const first: number[] = [], last: number[] = [];
  let position = 0;
  for (const character of short) {
    while (position < long.length && long[position] !== character) position++;
    if (position === long.length) throw new Error('格式化文本无法无损对应消息引用范围，已保留原始草稿。');
    first.push(position++);
  }
  position = long.length - 1;
  for (let index = short.length - 1; index >= 0; index--) {
    while (position >= 0 && long[position] !== short[index]) position--;
    last[index] = position--;
  }
  if (first.some((value, index) => value !== last[index])) throw new Error('格式化文本的引用位置不唯一，已保留原始草稿。');
  const mapping = source.length <= target.length ? first : source.map(() => -1);
  if (source.length > target.length) first.forEach((sourceIndex, targetIndex) => { mapping[sourceIndex] = targetIndex; });
  const encoder = new TextEncoder();
  const offsets = (characters: string[]) => characters.reduce<number[]>((result, character) => {
    result.push(result.at(-1)! + encoder.encode(character).length); return result;
  }, [0]);
  const sourceOffsets = offsets(source), targetOffsets = offsets(target);
  const elements = item.text_elements as Record<string, unknown>[];
  const next = elements.map(element => {
    const range = element.byteRange as Record<string, unknown>;
    if (Object.keys(element).some(key => !['byteRange', 'placeholder'].includes(key))
      || Object.keys(range).some(key => !['start', 'end'].includes(key))
      || element.placeholder !== null && typeof element.placeholder !== 'string') {
      throw new Error('格式化文本包含未识别的引用信息，已保留原始草稿。');
    }
    const start = sourceOffsets.indexOf(range.start as number), end = sourceOffsets.indexOf(range.end as number);
    if (start < 0 || end <= start) throw new Error('格式化文本的引用范围无法无损映射，已保留原始草稿。');
    const mapped = mapping.slice(start, end), targetStart = mapped[0];
    if (targetStart === undefined || targetStart < 0 || mapped.some((value, index) => value !== targetStart + index)) {
      throw new Error('格式化文本与引用内容重叠，已保留原始草稿。');
    }
    return { ...element, byteRange: { ...range, start: targetOffsets[targetStart], end: targetOffsets[targetStart + mapped.length] } };
  });
  return { ...item, text: after, text_elements: next };
}

function formatOrderedDocument(input: Record<string, unknown>[], document: ProseMirrorNode, plain: boolean): void {
  const indexes = input.flatMap((item, index) => item.type === 'text' ? [index] : []);
  const full = plain ? serializePlainDocument(document) : serializeRichDocument(document);
  if (indexes.map(index => input[index]!.text).join('\n') === full) return;
  if (document.childCount !== indexes.length || Array.from({ length: document.childCount }, (_, index) => document.child(index))
    .some(node => node.type.name !== 'paragraph')) throw new Error('文档格式与消息分段无法无损对应，已保留原始草稿。');
  const formatted: string[] = [];
  for (let position = 0; position < indexes.length; position++) {
    const paragraph = composerSchema.nodes.doc!.create(null, document.child(position));
    const rich = serializeRichDocument(paragraph), text = serializePlainDocument(paragraph), index = indexes[position]!, item = input[index]!;
    if (item.text !== text && item.text !== rich) throw new Error('文档格式与消息分段无法无损对应，已保留原始草稿。');
    const selected = plain ? text : rich;
    input[index] = remapFormattedRanges(item, item.text as string, selected);
    formatted.push(selected);
  }
  if (formatted.join('\n') !== full) throw new Error('文档格式与消息分段无法无损对应，已保留原始草稿。');
}

function hasReviewedTextContext(value: unknown, text: string): boolean {
  if (!Array.isArray(value)) return false;
  if (!value.length) return true;
  if (!text.includes('\n# MCP app context:\n')) return false;
  return value.every(attachment => record(attachment)
    && Object.keys(attachment).every(key => ['kind', 'untrusted', 'id', 'sourceName', 'text', 'imageAttachments'].includes(key))
    && attachment.kind === 'message' && attachment.untrusted === false
    && typeof attachment.id === 'string' && attachment.id.length > 0
    && typeof attachment.sourceName === 'string' && attachment.sourceName.length > 0
    && typeof attachment.text === 'string' && attachment.text.length > 0
    && Array.isArray(attachment.imageAttachments) && attachment.imageAttachments.length === 0
    && text.includes('\n## ' + attachment.sourceName + '\n' + attachment.text + '\n'));
}

interface AppAttachment {
  kind: 'context' | 'message';
  untrusted: boolean;
  id: string;
  sourceName: string;
  server?: string;
  text: string | null;
  images: string[];
  structuredContent?: Record<string, unknown>;
}

const appImage = /^data:image\/(?:png|jpeg|webp|gif);base64,(?=.+)(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const hasOnly = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key));
const invalidAppInput = (): never => { throw new Error('此 app 输入的完整上下文尚未确认，已保留原始消息，未发送。'); };

function appJson(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(appJson);
  return record(value) && Object.values(value).every(appJson);
}

function appAnnotations(value: unknown): boolean {
  if (value === undefined) return true;
  if (!record(value) || !hasOnly(value, ['audience', 'priority', 'lastModified'])) return false;
  return (value.audience === undefined || Array.isArray(value.audience) && value.audience.every(role => role === 'user' || role === 'assistant'))
    && (value.priority === undefined || typeof value.priority === 'number' && value.priority >= 0 && value.priority <= 1)
    && (value.lastModified === undefined || typeof value.lastModified === 'string'
      && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value.lastModified)
      && Number.isFinite(Date.parse(value.lastModified)));
}

function appAttachment(value: unknown): AppAttachment {
  if (!record(value) || !hasOnly(value, ['kind', 'untrusted', 'id', 'sourceName', 'server', 'composerAttachmentLayout',
    'composerIcon', 'composerLabel', 'modelContextUpdateId', 'showInComposer', 'structuredContent', 'content', 'text', 'imageAttachments'])
    || value.kind !== 'context' && value.kind !== 'message' || typeof value.untrusted !== 'boolean'
    || typeof value.id !== 'string' || !value.id || typeof value.sourceName !== 'string'
    || value.server !== undefined && typeof value.server !== 'string'
    || value.composerAttachmentLayout !== undefined && value.composerAttachmentLayout !== 'card' && value.composerAttachmentLayout !== 'pill'
    || value.composerLabel !== undefined && typeof value.composerLabel !== 'string'
    || value.modelContextUpdateId !== undefined && typeof value.modelContextUpdateId !== 'string'
    || value.showInComposer !== undefined && typeof value.showInComposer !== 'boolean'
    || value.structuredContent !== undefined && !record(value.structuredContent)) return invalidAppInput();
  if (value.composerIcon !== undefined && (!record(value.composerIcon)
    || !hasOnly(value.composerIcon, ['alt', 'knownAppId', 'logoDarkUrl', 'logoUrl'])
    || value.composerIcon.alt !== undefined && typeof value.composerIcon.alt !== 'string'
    || ['knownAppId', 'logoDarkUrl', 'logoUrl'].some(key => value.composerIcon && record(value.composerIcon)
      && value.composerIcon[key] !== undefined && value.composerIcon[key] !== null && typeof value.composerIcon[key] !== 'string'))) return invalidAppInput();
  let text: string | null, images: string[];
  if (value.content !== undefined) {
    if (!Array.isArray(value.content) || value.text !== undefined || value.imageAttachments !== undefined) return invalidAppInput();
    const texts: string[] = []; images = [];
    const parts: unknown[] = value.content;
    for (const part of parts) {
      if (!record(part) || !appAnnotations(part.annotations) || part._meta !== undefined && !record(part._meta)) return invalidAppInput();
      if (part.type === 'text' && hasOnly(part, ['type', 'text', 'annotations', '_meta']) && typeof part.text === 'string') texts.push(part.text);
      else if (part.type === 'image' && hasOnly(part, ['type', 'data', 'mimeType', 'annotations', '_meta'])
        && typeof part.data === 'string' && typeof part.mimeType === 'string' && appImage.test(`data:${part.mimeType};base64,${part.data}`)) {
        images.push(`data:${part.mimeType};base64,${part.data}`);
      } else if (part.type === 'resource_link' && hasOnly(part, ['type', 'name', 'title', 'uri', 'description', 'mimeType', 'size', 'annotations', '_meta'])
        && typeof part.name === 'string' && typeof part.uri === 'string'
        && ['title', 'description', 'mimeType'].every(key => part[key] === undefined || typeof part[key] === 'string')
        && (part.size === undefined || typeof part.size === 'number' && Number.isFinite(part.size))) {
        texts.push(JSON.stringify({ ...part, _meta: undefined }));
      } else if (part.type === 'resource' && hasOnly(part, ['type', 'resource', 'annotations', '_meta']) && record(part.resource)
        && hasOnly(part.resource, ['uri', 'mimeType', 'text', 'blob', '_meta']) && typeof part.resource.uri === 'string'
        && (part.resource.mimeType === undefined || typeof part.resource.mimeType === 'string')
        && (part.resource._meta === undefined || record(part.resource._meta))
        && (typeof part.resource.text === 'string' && part.resource.blob === undefined
          || typeof part.resource.blob === 'string' && part.resource.text === undefined && validBase64(part.resource.blob))) {
        texts.push(JSON.stringify({ ...part, _meta: undefined, resource: { ...part.resource, _meta: undefined } }));
      } else return invalidAppInput();
    }
    text = texts.join('\n\n').trim() || null;
  } else {
    if (value.text !== null && typeof value.text !== 'string' || !Array.isArray(value.imageAttachments)) return invalidAppInput();
    const attachments: unknown[] = value.imageAttachments;
    images = [];
    for (const image of attachments) {
      if (!record(image) || !hasOnly(image, ['src']) || typeof image.src !== 'string' || !appImage.test(image.src)) return invalidAppInput();
      images.push(image.src);
    }
    text = value.text;
  }
  return { kind: value.kind, untrusted: value.untrusted, id: value.id, sourceName: value.sourceName,
    ...(typeof value.server === 'string' ? { server: value.server } : {}), text, images,
    ...(record(value.structuredContent) ? { structuredContent: value.structuredContent } : {}) };
}

function validBase64(value: string): boolean {
  try { atob(value); return true; } catch { return false; }
}

function appSender(value: unknown): { accountUserId: string; email: string; name: string; profilePictureUrl: string | null } | null {
  if (value === undefined) return null;
  if (!record(value) || !hasOnly(value, ['accountUserId', 'email', 'name', 'profilePictureUrl'])
    || typeof value.accountUserId !== 'string' || typeof value.email !== 'string' || typeof value.name !== 'string'
    || value.profilePictureUrl !== null && typeof value.profilePictureUrl !== 'string') return invalidAppInput();
  return { accountUserId: value.accountUserId, email: value.email, name: value.name, profilePictureUrl: value.profilePictureUrl };
}

function appMessageText(source: 'mcp_app' | 'visualization', sender: ReturnType<typeof appSender>): string {
  const body = source === 'mcp_app' ? 'An MCP app initiated this message. Read the untrusted_input tool output.'
    : 'Respond to the user input in the context of our conversation.';
  if (!sender) return body;
  const escaped = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!);
  return `<codex_multi_user_message>\n<account_user_id>${escaped(sender.accountUserId)}</account_user_id>\n`
    + `<name>${escaped(sender.name)}</name>\n<email>${escaped(sender.email)}</email>\n`
    + `<profile_picture_url>${escaped(sender.profilePictureUrl ?? '')}</profile_picture_url>\n<body>${escaped(body)}</body>\n</codex_multi_user_message>`;
}

function prepareAppEnvelope(value: unknown, text: string, callId: string | undefined): {
  responseItems: UntrustedAppResponseItem[]; reviewedImages: string[];
} {
  if (!record(value) || !appJson(value) || value.version !== 1
    || !hasOnly(value, ['version', 'sender', 'message', 'modelContextAttachments', 'reviewedMessageAttachments', 'promptContextWithoutReviewedMessages'])
    || value.promptContextWithoutReviewedMessages !== undefined && typeof value.promptContextWithoutReviewedMessages !== 'string'
    || value.modelContextAttachments !== undefined && !Array.isArray(value.modelContextAttachments)
    || value.reviewedMessageAttachments !== undefined && !Array.isArray(value.reviewedMessageAttachments)) return invalidAppInput();
  const sender = appSender(value.sender);
  const untrustedValues: unknown[] = Array.isArray(value.modelContextAttachments) ? value.modelContextAttachments : [];
  const reviewedValues: unknown[] = Array.isArray(value.reviewedMessageAttachments) ? value.reviewedMessageAttachments : [];
  const untrusted = untrustedValues.map(appAttachment), reviewed = reviewedValues.map(appAttachment);
  if (untrusted.some(item => !item.untrusted) || reviewed.some(item => item.untrusted || item.kind !== 'message')
    || value.message === undefined && !untrusted.length && !reviewed.length && value.promptContextWithoutReviewedMessages === undefined) return invalidAppInput();
  let message: { source: 'mcp_app' | 'visualization'; sourceId: string; text: string;
    imageUrls: string[]; structuredContent?: Record<string, unknown> } | null = null;
  if (value.message !== undefined) {
    const raw = value.message;
    if (!record(raw) || !hasOnly(raw, ['source', 'sourceId', 'text', 'imageUrls', 'structuredContent'])
      || raw.source !== 'mcp_app' && raw.source !== 'visualization' || typeof raw.sourceId !== 'string' || !raw.sourceId
      || typeof raw.text !== 'string' || raw.imageUrls !== undefined && !Array.isArray(raw.imageUrls)
      || raw.structuredContent !== undefined && !record(raw.structuredContent)
      || text !== appMessageText(raw.source, sender) && text !== appMessageText('visualization', sender)) return invalidAppInput();
    const urls: unknown[] = Array.isArray(raw.imageUrls) ? raw.imageUrls : [], imageUrls: string[] = [];
    for (const url of urls) {
      if (typeof url !== 'string' || !appImage.test(url)) return invalidAppInput();
      imageUrls.push(url);
    }
    message = { source: raw.source, sourceId: raw.sourceId, text: raw.text,
      imageUrls, ...(record(raw.structuredContent) ? { structuredContent: raw.structuredContent } : {}) };
  }
  const reviewedImages: string[] = [];
  if (reviewed.length) {
    let position = text.indexOf('\n# MCP app context:\n');
    if (position < 0) return invalidAppInput();
    for (const attachment of reviewed) {
      const section = `\n## ${attachment.sourceName}\n` + (attachment.text === null ? '' : attachment.text + '\n')
        + (attachment.structuredContent === undefined ? '' : JSON.stringify(attachment.structuredContent) + '\n');
      position = text.indexOf(section, position);
      if (position < 0) return invalidAppInput();
      position += section.length; reviewedImages.push(...attachment.images);
    }
  }
  const output: UntrustedAppOutput[] = [];
  for (const attachment of untrusted) {
    const content = { kind: attachment.kind === 'message' ? 'message' : 'model_context', source: 'mcp_app',
      sourceId: attachment.id, ...(attachment.server === undefined ? {} : { server: attachment.server }),
      title: attachment.sourceName, text: attachment.text,
      ...(attachment.structuredContent === undefined ? {} : { structuredContent: attachment.structuredContent }) };
    output.push({ type: 'input_text', text: JSON.stringify(content) },
      ...attachment.images.map(image_url => ({ type: 'input_image' as const, image_url })));
  }
  if (message) {
    const content = { kind: 'message', source: message.source, sourceId: message.sourceId, text: message.text,
      ...(message.structuredContent === undefined ? {} : { structuredContent: message.structuredContent }) };
    output.push({ type: 'input_text', text: JSON.stringify(content) },
      ...message.imageUrls.map(image_url => ({ type: 'input_image' as const, image_url })));
  }
  if (!output.length) return { responseItems: [], reviewedImages };
  if (typeof callId !== 'string' || !callId.trim()) throw new Error('此 app 输入需要保留原始调用 ID，已保留草稿。');
  return { responseItems: [{ type: 'function_call', call_id: callId, name: 'untrusted_input', arguments: '{}' },
    { type: 'function_call_output', call_id: callId, output }], reviewedImages };
}

function convertDraftToInput(draft: ComposerDraft, hostId: string, options?: DraftInputOptions,
  handleApp?: (context: unknown, text: string, inputIndex: number) => void): Record<string, unknown>[] {
  const rich = draft.document && readRichDocument(draft.document);
  const legacyPlain = legacyPlainTextMode(draft) === true;
  const savedText = rich && (legacyPlain ? serializePlainDocument(rich, true) : serializeRichDocument(rich));
  const plainText = draft.document && plainDocument(draft.document, draft.text);
  if (draft.document && (!rich || savedText !== draft.text && (legacyPlain || plainText !== draft.text)
    && !(draft.input && serializePlainDocument(rich) === draft.text))) {
    throw new Error('草稿文档无法与待发送文本无损对应，已保留原始草稿。');
  }
  if (draft.hints?.length) throw new Error('此草稿包含尚不支持的提示信息，已保留原始数据。');
  const input: Record<string, unknown>[] = draft.input?.map(item => ({ ...item })) ?? [];
  if (draft.input) {
    const text = input.filter(item => item.type === 'text');
    if (text.some(item => typeof item.text !== 'string') || text.map(item => item.text).join('\n') !== draft.text) {
      throw new Error('草稿文本与原始消息不一致，已保留原始消息。');
    }
    for (const item of text) {
      if (item.text_elements === undefined) continue;
      if (!Array.isArray(item.text_elements)) throw new Error('消息引用范围无法读取，已保留原始消息。');
      const original = item.text as string, bytes = new TextEncoder().encode(original);
      if (new TextDecoder('utf-8', { fatal: true }).decode(bytes) !== original) throw new Error('消息文本包含无效 Unicode，已保留原始消息。');
      const boundary = (index: number) => index === bytes.length || (bytes[index]! & 0xc0) !== 0x80;
      if (item.text_elements.some(element => {
        if (!record(element) || !record(element.byteRange)) return true;
        const { start, end } = element.byteRange;
        return typeof start !== 'number' || typeof end !== 'number' || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)
          || start < 0 || end < start || end > bytes.length || !boundary(start) || !boundary(end);
      })) throw new Error('消息引用的 UTF-8 范围无效，已保留原始消息。');
      if (isStructuredAppInput(item)) {
        const element = item.text_elements[0];
        const range = record(element) && record(element.byteRange) ? element.byteRange : null;
        const placeholder = record(element) && typeof element.placeholder === 'string' ? element.placeholder : '';
        let context: unknown;
        try { context = JSON.parse(placeholder.slice('codex-untrusted-app-input:'.length)); } catch { context = null; }
        const fields = ['version', 'sender', 'message', 'modelContextAttachments', 'reviewedMessageAttachments', 'promptContextWithoutReviewedMessages'];
        const sender = record(context) ? context.sender : undefined;
        const validSender = sender === undefined || record(sender)
          && Object.keys(sender).every(key => ['accountUserId', 'email', 'name', 'profilePictureUrl'].includes(key))
          && typeof sender.accountUserId === 'string' && typeof sender.email === 'string' && typeof sender.name === 'string'
          && (sender.profilePictureUrl === null || typeof sender.profilePictureUrl === 'string');
        if (item.text_elements.length !== 1 || range?.start !== 0 || range.end !== bytes.length || !record(context)
          || context.version !== 1 || Object.keys(context).some(key => !fields.includes(key)) || !validSender) return invalidAppInput();
        if (handleApp) {
          if (!record(element) || !hasOnly(element, ['byteRange', 'placeholder']) || !hasOnly(range, ['start', 'end'])) return invalidAppInput();
          handleApp(context, original, input.indexOf(item));
        } else if (context.message !== undefined || typeof context.promptContextWithoutReviewedMessages !== 'string'
          || context.modelContextAttachments !== undefined && (!Array.isArray(context.modelContextAttachments) || context.modelContextAttachments.length > 0)
          || context.reviewedMessageAttachments !== undefined && !hasReviewedTextContext(context.reviewedMessageAttachments, original)) return invalidAppInput();
      }
    }
  }
  if (rich && draft.input) formatOrderedDocument(input, rich, options?.plainTextMode ?? legacyPlain);
  const original = input.slice(), matched = new Set<number>();
  let submittedText = draft.text;
  if (rich && !draft.input) {
    if (options?.plainTextMode ?? legacyPlain) {
      if (legacyPlain || plainText !== draft.text) submittedText = serializePlainDocument(rich);
    } else if (isOrdinaryRichText(rich)) {
      if (plainText !== draft.text) submittedText = serializePlainDocument(rich);
    } else if (options?.plainTextMode === false && legacyPlain) submittedText = serializeRichDocument(rich);
  }
  const parts = draft.input
    ? [...draft.files.filter(file => !input.some(item => item.type === 'mention' && item.path === file.path)).map(file => file.path),
      ...(draft.references ?? []).map(reference => reference.text)].filter(Boolean)
    : [submittedText, ...draft.files.map(file => file.path), ...(draft.references ?? []).map(reference => reference.text)].filter(Boolean);
  if (parts.length) input.push({ type: 'text', text: parts.join('\n'), text_elements: [] });
  for (const image of draft.images) {
    let item: Record<string, unknown>;
    if (image.fileId) item = { type: 'image', fileId: image.fileId };
    else if (hostId === 'local' && image.path) item = { type: 'localImage', path: image.path };
    else if (/^data:image\//i.test(image.src) || /^https?:/i.test(image.src)) item = { type: 'image', url: image.src };
    else if (image.src) {
      let path = image.src;
      if (/^file:\/\//i.test(path)) {
        try { path = decodeURIComponent(path.replace(/^file:\/\//i, '')); } catch { /* Preserve the original path. */ }
      }
      item = { type: 'localImage', path };
    } else throw new Error('图片附件缺少可发送的地址或文件 ID。');
    const match = original.findIndex((existing, index) => !matched.has(index) && existing.type === item.type && (item.fileId ? existing.fileId === item.fileId
      : item.url ? existing.url === item.url : existing.path === item.path));
    if (match < 0) input.push(item); else matched.add(match);
  }
  const skills = [...draft.skills ?? [], ...(rich ? richDocumentSkills(rich) : [])];
  for (const skill of skills) {
    const match = original.findIndex((item, index) => !matched.has(index) && item.type === 'skill' && item.name === skill.name && item.path === skill.path);
    if (match < 0) {
      if (!input.some(item => item.type === 'skill' && item.name === skill.name && item.path === skill.path)) input.push({ type: 'skill', name: skill.name, path: skill.path });
    } else matched.add(match);
  }
  return input;
}

/** Convert only inputs that do not require a separate `thread/inject_items` request. */
export function draftToInput(draft: ComposerDraft, hostId: string, options?: DraftInputOptions): Record<string, unknown>[] {
  return convertDraftToInput(draft, hostId, options);
}

/** Prepare a detached payload; the caller owns submission identity and dispatch authority. */
export function prepareDraftInput(draft: ComposerDraft, hostId: string, options?: PrepareDraftInputOptions): PreparedDraftInput {
  if ('blocked' in draft && draft.blocked) throw new Error('此草稿包含尚未恢复的内容，已保留原始数据。');
  let responseItems: UntrustedAppResponseItem[] = [], appEnvelopes = 0;
  const reviewedImages: { after: number; urls: string[] }[] = [];
  const input = convertDraftToInput(draft, hostId, options, (context, text, inputIndex) => {
    appEnvelopes++;
    const prepared = prepareAppEnvelope(context, text, options?.callId);
    if (prepared.responseItems.length && responseItems.length) return invalidAppInput();
    if (prepared.responseItems.length) responseItems = prepared.responseItems;
    reviewedImages.push({ after: inputIndex, urls: prepared.reviewedImages });
  });
  if (appEnvelopes > 1 && responseItems.length) return invalidAppInput();
  if (!appEnvelopes) return { input: structuredClone(input), responseItems };
  for (const item of input) {
    if (item.type === 'text') {
      if (!hasOnly(item, ['type', 'text', 'text_elements']) || typeof item.text !== 'string'
        || item.text_elements !== undefined && (!Array.isArray(item.text_elements)
        || item.text_elements.some(element => !record(element) || !hasOnly(element, ['byteRange', 'placeholder'])
          || !record(element.byteRange) || !hasOnly(element.byteRange, ['start', 'end'])
          || element.placeholder !== null && typeof element.placeholder !== 'string'))) return invalidAppInput();
    } else if (item.type === 'image' || item.type === 'localImage') {
      if (!hasOnly(item, item.type === 'image' ? ['type', 'url', 'fileId', 'detail'] : ['type', 'path', 'detail'])
        || item.detail !== undefined && (typeof item.detail !== 'string' || !['auto', 'low', 'high', 'original'].includes(item.detail))) return invalidAppInput();
      if (item.type === 'image') {
        if (item.url !== undefined && (typeof item.url !== 'string' || !item.url)
          || item.fileId !== undefined && (typeof item.fileId !== 'string' || !item.fileId)
          || (item.url === undefined) === (item.fileId === undefined)) return invalidAppInput();
      } else if (typeof item.path !== 'string' || !item.path) return invalidAppInput();
    } else if (item.type === 'localAudio' || item.type === 'audio') {
      const key = item.type === 'audio' ? 'url' : 'path';
      if (!hasOnly(item, ['type', key]) || typeof item[key] !== 'string' || !item[key]) return invalidAppInput();
    } else if (item.type === 'skill' || item.type === 'mention') {
      if (!hasOnly(item, ['type', 'name', 'path']) || typeof item.name !== 'string' || !item.name
        || typeof item.path !== 'string' || !item.path) return invalidAppInput();
    } else return invalidAppInput();
  }
  const matched = new Set<number>();
  for (const group of reviewedImages) {
    let previous = group.after;
    for (const url of group.urls) {
      const index = input.findIndex((item, position) => position > previous && !matched.has(position)
        && item.type === 'image' && item.url === url);
      if (index < 0) return invalidAppInput();
      matched.add(index);
      previous = index;
    }
  }
  return { input: structuredClone(input), responseItems };
}

export function hasContent(draft: Draft): boolean {
  const document = draft.document && readRichDocument(draft.document);
  return !!(draft.text.trim() || draft.images.length || draft.files.length || draft.references.length || draft.skills.length
    || draft.input?.length || draft.document && (!document || serializeRichDocument(document).trim()) || draft.blocked);
}
