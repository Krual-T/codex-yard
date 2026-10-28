import type { ChromeElementContext } from '../../browser-reuse/protocol.ts';
import type { ComposerDraft } from '../workbench-contract.ts';
import { readBrowserAtom, subscribeBrowserAtoms, updateBrowserAtom } from '../storage/ui-atoms.ts';

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
  deleted: BrowserReference[];
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

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
  return { comments, consumed: browserReferences(owner, comments).filter(reference => consumed.some(value =>
    record(value) && same(value.reference, reference))), deleted };
}

/** Apply inside the transaction that checks the immutable confirmed send. */
export function recordSubmittedBrowserComments(value: unknown, owner: BrowserOwner, submission: BrowserSubmission): unknown {
  const store = commentStore(value), key = browserOwnerKey(owner);
  const old = ownerRecords(store, 'codex-yard.browser-consumption.v1', key), references = browserReferences(owner, ownerComments(store.entries, key));
  const additions: unknown[] = [];
  for (const reference of submission.references) {
    if (!references.some(current => same(current, reference))) continue;
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

function commentId(value: unknown): string | undefined {
  if (!record(value) || value.type !== 'comment' || value.origin !== 'browser' || !Array.isArray(value.content) ||
      !record(value.localBrowserContext) || !record(value.localBrowserCommentMetadata)) return;
  const id = value.localBrowserCommentMetadata.commentId;
  return typeof id === 'string' && id ? id : undefined;
}

function commentText(comment: Record<string, unknown>): string {
  return (comment.content as unknown[]).filter(record).filter(item => item.content_type === 'text' && typeof item.text === 'string')
    .map(item => item.text).join('\n');
}

export function browserReferences(owner: BrowserOwner, comments: unknown[]): BrowserReference[] {
  const counts = new Map<string, number>();
  for (const comment of comments) {
    const id = commentId(comment);
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

export async function addBrowserComment(owner: BrowserOwner, anchor: ChromeElementContext, isCurrent?: () => boolean): Promise<BrowserReference> {
  const key = browserOwnerKey(owner);
  return updateMap(map => {
    const comments = ownerComments(map, key), comment = createBrowserComment(anchor, comments.length + 1);
    const reference = browserReferences(owner, [comment])[0];
    if (!reference) throw new Error('无法创建浏览器引用');
    map[key] = [...comments, comment];
    return reference;
  }, isCurrent);
}

export async function changeBrowserComment(owner: BrowserOwner, expected: Record<string, unknown>, text: string | null): Promise<void> {
  const key = browserOwnerKey(owner), id = commentId(expected);
  if (!id) throw new Error('无法编辑未识别的浏览器批注');
  await updateMap((map, store) => {
    const comments = ownerComments(map, key);
    const indices = comments.flatMap((value, index) => commentId(value) === id ? [index] : []);
    if (indices.length !== 1 || !same(comments[indices[0]!], expected)) throw new Error('批注已在其他页面修改，请检查后重试');
    const index = indices[0]!;
    if (text === null) {
      const reference = browserReferences(owner, comments).find(value => same(value.original, expected));
      if (!reference) throw new Error('无法核对要删除的浏览器引用，原批注已保留');
      const field = 'codex-yard.browser-deletions.v1', old = ownerRecords(store, field, key);
      const previous = store[field], marker = { reference };
      store[field] = { ...(record(previous) ? previous : {}), [key]: old.some(value => same(value, marker)) ? old : [...old, marker] };
      map[key] = comments.filter((_, i) => i !== index);
      return;
    }
    const content = [...expected.content as unknown[]];
    const textIndex = content.findIndex(item => record(item) && item.content_type === 'text' && typeof item.text === 'string');
    if (textIndex < 0) content.push({ content_type: 'text', text });
    else for (let i = textIndex; i < content.length; i++) {
      const item = content[i];
      if (record(item) && item.content_type === 'text' && typeof item.text === 'string') content[i] = { ...item, text: i === textIndex ? text : '' };
    }
    map[key] = comments.map((value, i) => i === index ? { ...expected, content } : value);
  });
}

/** A caller must establish the legacy owner's host and draft from external evidence. */
export async function adoptLegacyBrowserComments(owner: BrowserOwner, legacyOwner: string, expected: unknown[]): Promise<void> {
  const key = browserOwnerKey(owner);
  if (!legacyOwner || legacyOwner.startsWith(ownerPrefix)) throw new Error('旧批注身份无效');
  await updateMap(map => {
    if (Object.hasOwn(map, key) || !Object.hasOwn(map, legacyOwner) || !same(map[legacyOwner], expected) || !Array.isArray(map[legacyOwner])) {
      throw new Error('旧批注已变化或目标已有批注，原数据已保留');
    }
    map[key] = map[legacyOwner];
    delete map[legacyOwner];
  });
}

/** Update existing references only; inserting a comment requires a user action. */
export function reconcileBrowserReferences(draft: ComposerDraft, previous: readonly BrowserReference[], current: readonly BrowserReference[]): ComposerDraft {
  const old = new Map(previous.map(reference => [reference.id, reference]));
  const next = new Map(current.map(reference => [reference.id, reference]));
  const references = (draft.references ?? []).flatMap(reference => {
    const before = old.get(reference.id);
    if (!before || !same(reference, before)) return [reference];
    const after = next.get(reference.id);
    return after ? [after] : [];
  });
  return { ...draft, references };
}

export function removeExplicitlyDeletedBrowserReferences(draft: ComposerDraft, deleted: readonly BrowserReference[]): ComposerDraft {
  return { ...draft, references: (draft.references ?? []).filter(reference => !deleted.some(value => same(value, reference))) };
}

/** Check inside the same transaction that reserves a send intent. */
export function assertBrowserDraftReferencesNotDeleted(value: unknown, owner: BrowserOwner, draft: ComposerDraft): void {
  const store = commentStore(value), deleted = ownerRecords(store, 'codex-yard.browser-deletions.v1', browserOwnerKey(owner));
  if ((draft.references ?? []).some(reference => deleted.some(item => record(item) && same(item.reference, reference)))) {
    throw new Error('浏览器引用已在其他页面删除，请先更新原草稿。');
  }
}

export function addBrowserDraftReference(draft: ComposerDraft, reference: BrowserReference): ComposerDraft {
  const references = draft.references ?? [];
  return references.some(item => item.id === reference.id) ? draft : { ...draft, references: [...references, reference] };
}
