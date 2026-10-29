import type { ChromeElementContext } from '../../browser-reuse/protocol.ts';
import type { ComposerDraft } from '../workbench-contract.ts';
import { readBrowserAtom, subscribeBrowserAtoms, updateBrowserAtom, updateBrowserAtoms } from '../storage/ui-atoms.ts';
import { composerDraftAtomKey, readComposerDraftVersionsInRoot } from '../composer/composer-draft-store.ts';
import type { ComposerDraftSnapshot } from '../composer/composer-draft-store.ts';
import { sameBrowserValue, updateBrowserDraftVersion } from './draft-transaction.ts';

const storageKey = 'workbench.browser-comments.v1';
export const browserCommentsAtomKey = 'codex-yard.browser-comments.v1';
const ownerPrefix = 'codex-yard.browser-owner.v1:';

interface CommentStore {
  version: 1;
  legacyRaw: string | null;
  entries?: Record<string, unknown>;
  importError?: string;
  'codex-yard.browser-consumption.v1'?: unknown;
  'codex-yard.browser-deletions.v1'?: unknown;
}

export interface BrowserOwner {
  hostId: string;
  threadId: string | null;
  draftId: string;
}

export interface BrowserReference {
  id: string;
  text: string;
  kind: 'browser';
  context: Record<string, unknown>;
  original: Record<string, unknown>;
}

export interface BrowserSubmission {
  intentId: string;
  owner: BrowserOwner;
  revision: string;
  references: readonly BrowserReference[];
}

export interface BrowserCommentsSnapshot {
  comments: unknown[];
  consumed: BrowserReference[];
  consumptionRecords: unknown[];
  deleted: BrowserReference[];
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const same = sameBrowserValue;

export function browserOwnerKey(owner: BrowserOwner): string {
  if (!owner.hostId || !owner.draftId || (owner.threadId !== null && !owner.threadId)) throw new Error('浏览器草稿身份无效');
  return ownerPrefix + JSON.stringify([owner.hostId, owner.threadId, owner.draftId]);
}

function importLegacy(): CommentStore {
  const legacyRaw = localStorage.getItem(storageKey);
  try {
    const entries: unknown = JSON.parse(legacyRaw ?? '{}');
    if (!record(entries)) throw new Error('Invalid comment root');
    return { version: 1, legacyRaw, entries };
  } catch {
    return { version: 1, legacyRaw, importError: '旧浏览器批注无法转换，原始数据已保留，未改写。' };
  }
}

function commentStore(value: unknown): CommentStore & { entries: Record<string, unknown> } {
  if (!record(value) || value.version !== 1 || !(value.legacyRaw === null || typeof value.legacyRaw === 'string')) {
    throw new Error('浏览器批注存储格式无法识别，原数据已保留。');
  }
  if (value.importError || !record(value.entries)) {
    throw new Error(typeof value.importError === 'string' ? value.importError : '浏览器批注存储格式无效，原数据已保留。');
  }
  return value as unknown as CommentStore & { entries: Record<string, unknown> };
}

async function readStore(): Promise<CommentStore & { entries: Record<string, unknown> }> {
  let value = await readBrowserAtom(browserCommentsAtomKey);
  if (value === undefined) value = await updateBrowserAtom(browserCommentsAtomKey, previous => previous === undefined ? importLegacy() : previous);
  return commentStore(value);
}

export async function ensureBrowserCommentStore(): Promise<void> { await readStore(); }

/** Recover the imported bytes without treating a malformed archive as writable state. */
export async function readBrowserCommentArchive(): Promise<string | null> {
  let value = await readBrowserAtom(browserCommentsAtomKey);
  if (value === undefined) {
    try { await readStore(); } catch { /* Read the original bytes from the imported record. */ }
    value = await readBrowserAtom(browserCommentsAtomKey);
  }
  return record(value) && typeof value.legacyRaw === 'string' ? value.legacyRaw : null;
}

function ownerComments(map: Record<string, unknown>, key: string): unknown[] {
  if (!Object.hasOwn(map, key)) return [];
  if (!Array.isArray(map[key])) throw new Error('当前草稿的浏览器批注格式无效，原数据已保留');
  return map[key] as unknown[];
}

export async function readBrowserComments(owner: BrowserOwner): Promise<unknown[]> {
  return ownerComments((await readStore()).entries, browserOwnerKey(owner));
}

function ownerRecords(store: CommentStore, field: 'codex-yard.browser-consumption.v1' | 'codex-yard.browser-deletions.v1', key: string): unknown[] {
  const value = store[field];
  if (value === undefined) return [];
  if (!record(value)) throw new Error('浏览器引用操作记录无法识别，原数据已保留。');
  if (!Object.hasOwn(value, key)) return [];
  if (!Array.isArray(value[key])) throw new Error('当前草稿的浏览器引用操作记录无法识别，原数据已保留。');
  return value[key] as unknown[];
}

export async function readBrowserCommentsSnapshot(owner: BrowserOwner): Promise<BrowserCommentsSnapshot> {
  const store = await readStore(), key = browserOwnerKey(owner), comments = ownerComments(store.entries, key);
  const consumed = ownerRecords(store, 'codex-yard.browser-consumption.v1', key);
  const deleted = ownerRecords(store, 'codex-yard.browser-deletions.v1', key).flatMap(value =>
    record(value) && record(value.reference) ? [value.reference as unknown as BrowserReference] : []);
  return { comments, consumptionRecords: consumed, consumed: consumed.flatMap(value =>
    record(value) && record(value.reference) ? [value.reference as unknown as BrowserReference] : []), deleted };
}

/** Apply inside the transaction that checks the immutable confirmed send. */
export function recordSubmittedBrowserComments(value: unknown, owner: BrowserOwner, submission: BrowserSubmission): unknown {
  const store = commentStore(value), key = browserOwnerKey(owner);
  const old = ownerRecords(store, 'codex-yard.browser-consumption.v1', key);
  const additions: unknown[] = [];
  for (const reference of submission.references) {
    const marker = { intentId: submission.intentId, owner: submission.owner, revision: submission.revision, reference };
    if (!old.some(item => same(item, marker)) && !additions.some(item => same(item, marker))) additions.push(marker);
  }
  if (!additions.length) return store;
  const previous = store['codex-yard.browser-consumption.v1'];
  return { ...store, 'codex-yard.browser-consumption.v1': { ...(record(previous) ? previous : {}), [key]: [...old, ...additions] } };
}

/** A bare legacy key requires independent evidence before it can be adopted. */
export async function readLegacyBrowserComments(legacyOwner: string): Promise<unknown[] | null> {
  if (!legacyOwner || legacyOwner.startsWith(ownerPrefix)) throw new Error('旧批注身份无效');
  const entries = (await readStore()).entries;
  return Object.hasOwn(entries, legacyOwner) ? ownerComments(entries, legacyOwner) : null;
}

export interface LegacyBrowserComments { owner: string; value: unknown }
export type ResolveLegacyBrowserOwner = (atoms: Readonly<Record<string, unknown>>, legacyOwner: string) => BrowserOwner | null;

export async function listLegacyBrowserComments(): Promise<LegacyBrowserComments[]> {
  const entries = (await readStore()).entries;
  return Object.entries(entries).filter(([key]) => !key.startsWith(ownerPrefix)).map(([owner, value]) => ({ owner, value }));
}

export function subscribeBrowserComments(listener: () => void): () => void {
  return subscribeBrowserAtoms(keys => { if (keys.includes(browserCommentsAtomKey)) listener(); });
}

async function updateMap<T>(update: (map: Record<string, unknown>, store: CommentStore) => T, isCurrent?: () => boolean): Promise<T> {
  await readStore();
  let result!: T;
  await updateBrowserAtom(browserCommentsAtomKey, previous => {
    if (isCurrent && !isCurrent()) throw new Error('草稿已切换，未保存浏览器引用');
    const original = commentStore(previous), map = { ...original.entries }, store = { ...original, entries: map };
    result = update(map, store);
    if (isCurrent && !isCurrent()) throw new Error('草稿已切换，未保存浏览器引用');
    return store;
  });
  return result;
}

function metadataId(value: unknown): string | undefined {
  if (!record(value) || !record(value.localBrowserCommentMetadata)) return;
  const id = value.localBrowserCommentMetadata.commentId;
  return typeof id === 'string' && id ? id : undefined;
}

function commentId(value: unknown): string | undefined {
  if (!record(value) || value.type !== 'comment' || value.origin !== 'browser' || !Array.isArray(value.content) ||
      !record(value.localBrowserContext) || !record(value.localBrowserCommentMetadata)) return;
  return metadataId(value);
}

function commentText(comment: Record<string, unknown>): string {
  return (comment.content as unknown[]).filter(record).filter(item => item.content_type === 'text' && typeof item.text === 'string')
    .map(item => item.text).join('\n');
}

export function browserReferences(owner: BrowserOwner, comments: unknown[]): BrowserReference[] {
  const counts = new Map<string, number>();
  for (const comment of comments) {
    const id = metadataId(comment);
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return comments.flatMap(value => {
    const id = commentId(value);
    if (!id || counts.get(id) !== 1 || !record(value)) return [];
    const context = value.localBrowserContext as Record<string, unknown>;
    const metadata = value.localBrowserCommentMetadata as Record<string, unknown>;
    const description = typeof context.targetDescription === 'string' ? context.targetDescription : 'Selected element';
    const text = ['Browser selection: ' + description, 'Comment: ' + commentText(value),
      'Page and element context: ' + JSON.stringify(context), 'Selection metadata: ' + JSON.stringify(metadata)].join('\n');
    return [{ id: 'browser:' + JSON.stringify([owner.hostId, owner.threadId, owner.draftId, id]), text, kind: 'browser' as const,
      context: { hostId: owner.hostId, threadId: owner.threadId, draftId: owner.draftId,
        localBrowserContext: context, localBrowserCommentMetadata: metadata, position: value.position }, original: value }];
  });
}

export function createBrowserComment(anchor: ChromeElementContext, line: number): Record<string, unknown> {
  const id = crypto.randomUUID();
  const description = anchor.title || anchor.pageUrl;
  return { type: 'comment', origin: 'browser', content: [{ content_type: 'text', text: 'Chrome 中所选元素' }],
    position: { side: 'right', path: 'browser:' + description, line },
    localBrowserContext: { pageUrl: anchor.pageUrl, framePath: anchor.framePath, ...(anchor.frameUrl ? { frameUrl: anchor.frameUrl } : {}),
      targetDescription: description, targetImmediateText: anchor.immediateText, targetRole: anchor.role, targetName: anchor.name,
      targetSelector: anchor.selector, targetPath: anchor.elementPath, nearbyText: anchor.nearbyText,
      targetRect: anchor.rect, elementMetadata: anchor.elementMetadata },
    localBrowserCommentMetadata: { commentId: id, kind: anchor.kind, hasAnnotationFeatures: true } };
}

async function updateVersion<T>(owner: BrowserOwner, snapshot: ComposerDraftSnapshot, isCurrent: (() => boolean) | undefined,
  change: (map: Record<string, unknown>, store: CommentStore, draft: ComposerDraft) => { draft: ComposerDraft; value: T }): Promise<{ value: T; snapshot: ComposerDraftSnapshot }> {
  const captured = structuredClone(snapshot);
  await readStore();
  return updateBrowserAtoms(atoms => {
    if (isCurrent && !isCurrent()) throw new Error('草稿已切换，未保存浏览器引用。');
    const original = commentStore(atoms[browserCommentsAtomKey]);
    const map = { ...original.entries }, store = { ...original, entries: map };
    let result!: T;
    const next = updateBrowserDraftVersion(atoms, owner, captured, draft => {
      const updated = change(map, store, draft); result = updated.value; return updated.draft;
    });
    if (isCurrent && !isCurrent()) throw new Error('草稿已切换，未保存浏览器引用。');
    return { value: { value: result, snapshot: next.snapshot }, updates: {
      [browserCommentsAtomKey]: store, [composerDraftAtomKey]: next.repository,
    } };
  });
}

function matchingDraftReference(draft: ComposerDraft, reference: BrowserReference): boolean {
  const matches = (draft.references ?? []).filter(value => value.id === reference.id);
  if (matches.length > 1 || matches.length === 1 && !same(matches[0], reference)) {
    throw new Error('草稿与已保存批注的完整版本不同，请先核对；两份内容均已保留。');
  }
  return matches.length === 1;
}

export async function attachBrowserComment(owner: BrowserOwner, reference: BrowserReference, snapshot: ComposerDraftSnapshot,
  isCurrent?: () => boolean): Promise<ComposerDraftSnapshot> {
  owner = { hostId: owner.hostId, threadId: owner.threadId, draftId: owner.draftId };
  const key = browserOwnerKey(owner), expected = structuredClone(reference);
  const result = await updateVersion(owner, snapshot, isCurrent, (map, _store, draft) => {
    if (!browserReferences(owner, ownerComments(map, key)).some(value => same(value, expected))) {
      throw new Error('批注已在其他页面修改，请核对后重试。');
    }
    if (matchingDraftReference(draft, expected)) return { value: undefined, draft };
    return { value: undefined, draft: { ...draft, references: [...(draft.references ?? []), expected] } };
  });
  return result.snapshot;
}

export async function addBrowserCommentToDraft(owner: BrowserOwner, anchor: ChromeElementContext, snapshot: ComposerDraftSnapshot,
  isCurrent?: () => boolean): Promise<{ reference: BrowserReference; snapshot: ComposerDraftSnapshot }> {
  owner = { hostId: owner.hostId, threadId: owner.threadId, draftId: owner.draftId }; anchor = structuredClone(anchor);
  const key = browserOwnerKey(owner);
  const result = await updateVersion(owner, snapshot, isCurrent, (map, _store, draft) => {
    const comments = ownerComments(map, key), comment = createBrowserComment(anchor, comments.length + 1);
    const reference = browserReferences(owner, [comment])[0];
    if (!reference || comments.some(value => metadataId(value) === metadataId(comment))
      || (draft.references ?? []).some(value => value.id === reference.id)) throw new Error('浏览器引用身份冲突，请重试。');
    map[key] = [...comments, comment];
    return { value: reference, draft: { ...draft, references: [...(draft.references ?? []), reference] } };
  });
  return { reference: result.value, snapshot: result.snapshot };
}

export async function changeBrowserComment(owner: BrowserOwner, expected: Record<string, unknown>, text: string | null,
  snapshot?: ComposerDraftSnapshot, isCurrent?: () => boolean): Promise<ComposerDraftSnapshot> {
  owner = { hostId: owner.hostId, threadId: owner.threadId, draftId: owner.draftId };
  expected = structuredClone(expected);
  const key = browserOwnerKey(owner), id = commentId(expected);
  if (!id) throw new Error('无法编辑未识别的浏览器批注');
  if (!snapshot) throw new Error('缺少草稿版本，浏览器批注未更改。');
  const result = await updateVersion(owner, snapshot, isCurrent, (map, store, draft) => {
    const comments = ownerComments(map, key);
    const indices = comments.flatMap((value, index) => metadataId(value) === id ? [index] : []);
    if (indices.length !== 1 || !same(comments[indices[0]!], expected)) throw new Error('批注已在其他页面修改，请检查后重试');
    const index = indices[0]!;
    const reference = browserReferences(owner, comments).find(value => same(value.original, expected));
    if (!reference) throw new Error('无法核对浏览器引用，原批注已保留。');
    const attached = matchingDraftReference(draft, reference);
    if (text === null) {
      const field = 'codex-yard.browser-deletions.v1', old = ownerRecords(store, field, key);
      const previous = store[field], marker = { reference };
      store[field] = { ...(record(previous) ? previous : {}), [key]: old.some(value => same(value, marker)) ? old : [...old, marker] };
      map[key] = comments.filter((_, i) => i !== index);
      return { value: undefined, draft: attached ? { ...draft, references: (draft.references ?? []).filter(value => !same(value, reference)) } : draft };
    }
    const content = [...expected.content as unknown[]];
    const textIndex = content.findIndex(item => record(item) && item.content_type === 'text' && typeof item.text === 'string');
    if (textIndex < 0) content.push({ content_type: 'text', text });
    else for (let i = textIndex; i < content.length; i++) {
      const item = content[i];
      if (record(item) && item.content_type === 'text' && typeof item.text === 'string') content[i] = { ...item, text: i === textIndex ? text : '' };
    }
    const edited = { ...expected, content }, replacement = browserReferences(owner, [edited])[0];
    if (!replacement) throw new Error('无法保存浏览器批注，原数据已保留。');
    map[key] = comments.map((value, i) => i === index ? edited : value);
    return { value: undefined, draft: attached ? { ...draft, references: (draft.references ?? []).map(value => same(value, reference) ? replacement : value) } : draft };
  });
  return result.snapshot;
}

/** Delete only the exact browser reference selected in the current composer. */
export async function removeBrowserReferenceFromDraft(owner: BrowserOwner, reference: BrowserReference, snapshot: ComposerDraftSnapshot,
  isCurrent?: () => boolean): Promise<ComposerDraftSnapshot> {
  owner = { hostId: owner.hostId, threadId: owner.threadId, draftId: owner.draftId };
  const clicked = structuredClone(reference), captured = structuredClone(snapshot);
  const matches = (captured.draft.references ?? []).filter(value => value.id === clicked.id);
  const canonical = record(clicked.original) ? browserReferences(owner, [clicked.original])[0] : undefined;
  if (!canonical || !same(clicked, canonical) || matches.length !== 1 || !same(matches[0], clicked)) {
    throw new Error('所选浏览器引用或草稿版本已改变，请核对后重试。');
  }
  const key = browserOwnerKey(owner), id = commentId(clicked.original)!;
  const result = await updateVersion(owner, captured, isCurrent, (map, store, draft) => {
    const current = (draft.references ?? []).filter(value => value.id === clicked.id);
    if (current.length !== 1 || !same(current[0], clicked)) throw new Error('所选浏览器引用或草稿版本已改变，请核对后重试。');
    const comments = ownerComments(map, key), indices = comments.flatMap((value, index) => metadataId(value) === id ? [index] : []);
    if (indices.length === 1 && same(comments[indices[0]!], clicked.original)) {
      const field = 'codex-yard.browser-deletions.v1', old = ownerRecords(store, field, key), marker = { reference: clicked };
      const previous = store[field];
      store[field] = { ...(record(previous) ? previous : {}), [key]: old.some(value => same(value, marker)) ? old : [...old, marker] };
      map[key] = comments.filter((_, index) => index !== indices[0]);
    }
    return { value: undefined, draft: { ...draft, references: (draft.references ?? []).filter(value => !same(value, clicked)) } };
  });
  return result.snapshot;
}

export async function claimLegacyBrowserComment(owner: BrowserOwner, legacyOwner: string, expected: unknown[], index: number,
  keepBoth: boolean, isCurrent?: () => boolean): Promise<void> {
  expected = structuredClone(expected);
  const key = browserOwnerKey(owner);
  if (!legacyOwner || legacyOwner.startsWith(ownerPrefix) || !Number.isInteger(index) || index < 0) throw new Error('旧批注身份无效。');
  await updateMap((map, store) => {
    if (!same(map[legacyOwner], expected) || !Array.isArray(map[legacyOwner]) || index >= expected.length) throw new Error('旧批注已变化，请重新核对。');
    const value = expected[index], id = commentId(value), existing = ownerComments(map, key);
    if (!id || !record(value)) throw new Error('此旧批注格式无法识别，原数据已保留。');
    const collision = existing.some(item => metadataId(item) === id);
    if (collision && !keepBoth) throw new Error('目标已有相同 ID 的批注，请核对两份内容并选择保留两份。');
    const deleted = ownerRecords(store, 'codex-yard.browser-deletions.v1', key);
    const candidate = browserReferences(owner, [value])[0];
    const deletedConflict = candidate && deleted.some(marker => record(marker) && same(marker.reference, candidate));
    let replacementId = id;
    if (collision || deletedConflict) {
      const deletedIds = deleted.flatMap(marker => record(marker) && record(marker.reference) && record(marker.reference.original)
        ? [metadataId(marker.reference.original)] : []);
      const used = new Set([...existing.map(metadataId), ...deletedIds].filter(Boolean));
      for (let attempt = 0; used.has(replacementId) && attempt < 10; attempt++) replacementId = crypto.randomUUID();
      if (used.has(replacementId)) throw new Error('无法分配独立批注身份，原数据已保留。');
    }
    const adopted = replacementId !== id ? { ...value, localBrowserCommentMetadata: { ...(value.localBrowserCommentMetadata as Record<string, unknown>), commentId: replacementId } } : value;
    map[key] = [...existing, adopted];
    const remaining = expected.filter((_, i) => i !== index);
    if (remaining.length) map[legacyOwner] = remaining; else delete map[legacyOwner];
  }, isCurrent);
}

/** Only an externally proven complete identity permits automatic adoption. */
export async function claimProvenLegacyBrowserComments(owner: BrowserOwner, resolve: ResolveLegacyBrowserOwner,
  isCurrent?: () => boolean): Promise<void> {
  owner = { hostId: owner.hostId, threadId: owner.threadId, draftId: owner.draftId };
  const key = browserOwnerKey(owner);
  await readStore();
  await updateBrowserAtoms(atoms => {
    if (isCurrent && !isCurrent()) throw new Error('草稿已切换，未认领旧批注。');
    const original = commentStore(atoms[browserCommentsAtomKey]), map = { ...original.entries };
    let existing = ownerComments(map, key), changed = false;
    const deleted = ownerRecords(original, 'codex-yard.browser-deletions.v1', key);
    for (const [legacyOwner, value] of Object.entries(map)) {
      if (legacyOwner.startsWith(ownerPrefix) || !Array.isArray(value) || !same(resolve(atoms, legacyOwner), owner)) continue;
      if (browserReferences(owner, value).some(reference => deleted.some(marker => record(marker) && same(marker.reference, reference)))) continue;
      const ids = new Set(existing.map(metadataId).filter(Boolean));
      let conflict = false;
      for (const item of value) { const id = metadataId(item); if (id && ids.has(id)) { conflict = true; break; } if (id) ids.add(id); }
      if (conflict) continue;
      existing = [...existing, ...value]; delete map[legacyOwner]; changed = true;
    }
    if (isCurrent && !isCurrent()) throw new Error('草稿已切换，未认领旧批注。');
    if (!changed) return { value: undefined };
    map[key] = existing;
    return { value: undefined, updates: { [browserCommentsAtomKey]: { ...original, entries: map } } };
  });
}

export function removeExplicitlyDeletedBrowserReferences(draft: ComposerDraft, deleted: readonly BrowserReference[]): ComposerDraft {
  return { ...draft, references: (draft.references ?? []).filter(reference => !deleted.some(value => same(value, reference))) };
}

/** Apply explicit deletions to one still-current draft revision in the same root transaction. */
export async function pruneBrowserDraftDeletions(owner: BrowserOwner, snapshot: ComposerDraftSnapshot,
  isCurrent?: () => boolean): Promise<ComposerDraftSnapshot> {
  owner = { hostId: owner.hostId, threadId: owner.threadId, draftId: owner.draftId };
  const key = browserOwnerKey(owner), captured = structuredClone(snapshot);
  await readStore();
  return updateBrowserAtoms(atoms => {
    if (isCurrent && !isCurrent()) throw new Error('草稿已切换，未同步浏览器引用。');
    const store = commentStore(atoms[browserCommentsAtomKey]);
    const deleted = ownerRecords(store, 'codex-yard.browser-deletions.v1', key).flatMap(value =>
      record(value) && record(value.reference) ? [value.reference as unknown as BrowserReference] : []);
    const versions = readComposerDraftVersionsInRoot(atoms[composerDraftAtomKey], captured.owner).versions;
    if (!versions.some(version => version.revision === captured.revision) && versions.length === 1) {
      const expected = removeExplicitlyDeletedBrowserReferences(captured.draft, deleted), version = versions[0]!;
      if (!same(expected, captured.draft) && same(version.draft, expected)) {
        // Another page already applied exactly these deletions. Adopt only that
        // unique full version; do not create another write or merge independent text.
        const next = updateBrowserDraftVersion(atoms, owner, { ...captured, revision: version.revision, draft: version.draft }, draft => draft);
        if (isCurrent && !isCurrent()) throw new Error('草稿已切换，未同步浏览器引用。');
        return { value: next.snapshot };
      }
    }
    const next = updateBrowserDraftVersion(atoms, owner, captured, draft => removeExplicitlyDeletedBrowserReferences(draft, deleted));
    if (isCurrent && !isCurrent()) throw new Error('草稿已切换，未同步浏览器引用。');
    return next.snapshot.revision === captured.revision ? { value: next.snapshot }
      : { value: next.snapshot, updates: { [composerDraftAtomKey]: next.repository } };
  });
}

/** Check inside the same transaction that reserves a send intent. */
export function assertBrowserDraftReferencesNotDeleted(value: unknown, owner: BrowserOwner, draft: ComposerDraft): void {
  const store = commentStore(value), deleted = ownerRecords(store, 'codex-yard.browser-deletions.v1', browserOwnerKey(owner));
  if ((draft.references ?? []).some(reference => deleted.some(item => record(item) && same(item.reference, reference)))) {
    throw new Error('浏览器引用已在其他页面删除，请先更新原草稿。');
  }
}
