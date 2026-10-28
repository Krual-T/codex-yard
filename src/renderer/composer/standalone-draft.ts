import type { ComposerContext, ComposerDocument, ComposerDraft, ComposerImage } from '../workbench-contract.ts';
import { readRichDocument, richDocumentSkills, serializeRichDocument } from './rich-document.ts';

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
export interface StoredDraft { revision: string; draft: Draft; prefills: string[] }

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
function invalidStored(value: unknown): StoredDraft {
  return { revision: createId(), prefills: [], draft: { ...emptyDraft(), preserved: value,
    blocked: '保存的草稿包含无法读取的内容，已保留原始数据。' } };
}
export function readDraft(key: string): StoredDraft | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    let value: unknown;
    try { value = JSON.parse(raw); } catch { return invalidStored(raw); }
    if (!record(value) || typeof value.revision !== 'string' || !strings(value.prefills) || !record(value.draft)) return invalidStored(value);
    // v1 drafts predate skills and the optional structured fields.
    const draft = { ...value.draft, skills: value.draft.skills ?? [] };
    if (!isDraft(draft)) return invalidStored(value);
    return { revision: value.revision, draft, prefills: value.prefills };
  } catch { return invalidStored('Browser storage is unavailable'); }
}
export function writeDraft(key: string, value: StoredDraft): boolean {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

function emptyMetadata(value: unknown): boolean {
  return value == null || value === false || value === '' || Array.isArray(value) && value.length === 0;
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
  add(context.legacyDraftKey);
  if (context.hostId !== 'local' && !context.legacyDraftKey) return keys;
  const bindings = record(atoms['client-thread-bindings-v1']) ? atoms['client-thread-bindings-v1'] : {};
  const identities = record(atoms['draft-thread-identities-v1']) ? atoms['draft-thread-identities-v1'] : {};
  add(context.draftId);
  if (context.threadId) {
    if (context.legacyDraftKey || context.draftId === context.threadId || context.draftId === 'local:' + context.threadId
      || bindings[context.draftId] === context.threadId) {
      add('local:' + context.threadId);
      add(context.threadId);
    }
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
function readLegacy(context: ComposerContext): StoredDraft | null {
  let rawAtoms: string | null;
  try {
    rawAtoms = localStorage.getItem('native-atoms');
    if (rawAtoms === null) return null;
    const atoms: unknown = JSON.parse(rawAtoms);
    if (!record(atoms)) return invalidStored(atoms);
    const keys = legacyKeys(context, atoms);
    const v2 = record(atoms['composer-prompt-drafts-v2']) ? atoms['composer-prompt-drafts-v2'] : {};
    const v1 = record(atoms['composer-prompt-drafts-v1']) ? atoms['composer-prompt-drafts-v1'] : {};
    const retained = record(atoms['composer-retained-documents-v1']) ? atoms['composer-retained-documents-v1'] : {};
    const promptKey = keys.find(key => key in v2) ?? keys.find(key => key in v1);
    const retainedKey = keys.find(key => key in retained);
    if (promptKey === undefined && retainedKey === undefined) return null;
    const raw = promptKey === undefined ? undefined : v2[promptKey] ?? v1[promptKey];
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
        if (plain !== null && (promptText === undefined || plain === promptText)) text = plain;
        else {
          const rich = readRichDocument(document);
          if (rich === null) blocked = '此草稿包含尚不支持的文档内容，已保留原始数据。';
          else if (promptText === undefined) text = serializeRichDocument(rich);
          else if (plain !== promptText && serializeRichDocument(rich) !== promptText) {
            blocked = '此草稿的文档与保存的文本不一致，已保留两个版本。';
          }
        }
      } else blocked = '此草稿的文档格式无法读取，已保留原始数据。';
    } else if (value !== undefined && typeof value !== 'string') blocked = '此草稿包含未识别的内容，已保留原始数据。';
    if (record(value) && 'document' in value && source !== value && record(source)
      && JSON.stringify(value.document) !== JSON.stringify(source.document)) {
      blocked = '此草稿包含不同版本的文档，均已保留。';
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
  } catch { return invalidStored('无法读取旧版草稿存储。'); }
}
export function loadDraft(context: ComposerContext): StoredDraft {
  const key = draftKey(context);
  const oldKey = 'codex-yard.composer.v1:' + JSON.stringify([context.hostId, context.threadId, context.threadId == null ? context.cwd : null]);
  const oldThreadId = context.threadId && (context.draftId === context.threadId || context.draftId === 'local:' + context.threadId
    || context.legacyDraftKey === context.threadId || context.legacyDraftKey === 'local:' + context.threadId);
  const old = oldThreadId || context.legacyDraftKey === oldKey ? readDraft(oldKey) : null;
  const saved = readDraft(key) ?? old;
  if (saved?.draft.blocked === '此草稿包含格式或上下文，当前编辑器不能无损编辑。') {
    const legacy = readLegacy(context);
    const candidate = { ...saved.draft, blocked: undefined };
    if (legacy && !legacy.draft.blocked && JSON.stringify(candidate.document) === JSON.stringify(legacy.draft.document)
      && candidate.text === legacy.draft.text && JSON.stringify(candidate.preserved) === JSON.stringify(legacy.draft.preserved)
      && !richEditIssue(candidate)) return { ...saved, draft: candidate };
  }
  return saved ?? readLegacy(context) ?? { revision: createId(), draft: emptyDraft(), prefills: [] };
}
export function textEditIssue(draft: Draft): string | null {
  if (draft.blocked) return draft.blocked;
  if (draft.document && plainDocument(draft.document, draft.text) !== draft.text) return '此草稿包含格式，当前编辑器不能无损编辑。';
  if (draft.hints?.length) return '此草稿包含提示信息，当前编辑器不能无损编辑。';
  if (draft.input) {
    const text = draft.input.filter(item => item.type === 'text');
    if (text.length > 1 || text.some(item => typeof item.text !== 'string' || !Array.isArray(item.text_elements) || item.text_elements.length)) {
      return '此消息包含格式化或分段内容，当前编辑器不能无损编辑。';
    }
  }
  return null;
}
export function richEditIssue(draft: Draft): string | null {
  if (draft.blocked) return draft.blocked;
  const document = draft.document && readRichDocument(draft.document);
  if (!document) return '此草稿包含尚不支持的文档内容，已保留原始数据。';
  if (serializeRichDocument(document) !== draft.text && plainDocument(draft.document!, draft.text) !== draft.text) {
    return '此草稿的文档与保存的文本不一致，已保留两个版本。';
  }
  if (draft.hints?.length) return '此草稿包含提示信息，当前编辑器不能无损编辑。';
  if (draft.input) {
    const text = draft.input.filter(item => item.type === 'text');
    if (text.length > 1 || text.some(item => typeof item.text !== 'string' || !Array.isArray(item.text_elements)
      || item.text_elements.length || item.text !== draft.text) || !text.length && draft.text) {
      return '此消息包含格式化或分段内容，当前编辑器不能无损编辑。';
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
  const text = editedPlainDocument(document, draft.document!, draft.text) ?? serializeRichDocument(next);
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
  const parked = keepCurrent && hasContent(current) ? [...remaining, current] : remaining;
  return { ...normalizeDraft(next!), ...(parked.length ? { pendingDrafts: parked } : {}) };
}

export function draftToInput(draft: ComposerDraft, hostId: string): Record<string, unknown>[] {
  const rich = draft.document && readRichDocument(draft.document);
  if (draft.document && (!rich || serializeRichDocument(rich) !== draft.text && plainDocument(draft.document, draft.text) !== draft.text)) {
    throw new Error('草稿文档无法与待发送文本无损对应，已保留原始草稿。');
  }
  const input: Record<string, unknown>[] = draft.input?.map(item => ({ ...item })) ?? [];
  if (draft.input) {
    const text = input.filter(item => item.type === 'text');
    if (text.length === 0 && draft.text || text.length === 1 && Array.isArray(text[0]!.text_elements)
      && text[0]!.text_elements.length === 0 && text[0]!.text !== draft.text) {
      throw new Error('草稿文本与原始消息不一致，已保留原始消息。');
    }
  }
  const original = input.slice(), matched = new Set<number>();
  const parts = draft.input
    ? [...draft.files.filter(file => !input.some(item => item.type === 'mention' && item.path === file.path)).map(file => file.path),
      ...(draft.references ?? []).map(reference => reference.text)].filter(Boolean)
    : [draft.text, ...draft.files.map(file => file.path), ...(draft.references ?? []).map(reference => reference.text)].filter(Boolean);
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
export function hasContent(draft: Draft): boolean {
  const document = draft.document && readRichDocument(draft.document);
  return !!(draft.text.trim() || draft.images.length || draft.files.length || draft.references.length || draft.skills.length
    || draft.input?.length || draft.document && (!document || serializeRichDocument(document).trim()) || draft.blocked);
}
