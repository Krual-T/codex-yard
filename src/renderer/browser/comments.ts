import type { ChromeElementContext } from '../../browser-reuse/protocol.ts';
import type { ComposerDraft } from '../workbench-contract.ts';

const storageKey = 'workbench.browser-comments.v1';
const lockName = 'codex-yard:browser-comments:v1';
const changedEvent = 'codex-yard:browser-comments-changed';
const ownerPrefix = 'codex-yard.browser-owner.v1:';

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

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function browserOwnerKey(owner: BrowserOwner): string {
  if (!owner.hostId || !owner.draftId || (owner.threadId !== null && !owner.threadId)) throw new Error('浏览器草稿身份无效');
  return ownerPrefix + JSON.stringify([owner.hostId, owner.threadId, owner.draftId]);
}

function readMap(): Record<string, unknown> {
  const raw = localStorage.getItem(storageKey);
  if (raw === null) return {};
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('浏览器批注存储无法解析，原数据已保留'); }
  if (!record(value)) throw new Error('浏览器批注存储格式无效，原数据已保留');
  return value;
}

function ownerComments(map: Record<string, unknown>, key: string): unknown[] {
  if (!Object.hasOwn(map, key)) return [];
  if (!Array.isArray(map[key])) throw new Error('当前草稿的浏览器批注格式无效，原数据已保留');
  return map[key] as unknown[];
}

export function readBrowserComments(owner: BrowserOwner): unknown[] {
  return ownerComments(readMap(), browserOwnerKey(owner));
}

export function subscribeBrowserComments(listener: () => void): () => void {
  const storage = (event: StorageEvent) => { if (event.key === storageKey || event.key === null) listener(); };
  window.addEventListener('storage', storage);
  window.addEventListener(changedEvent, listener);
  return () => { window.removeEventListener('storage', storage); window.removeEventListener(changedEvent, listener); };
}

async function updateMap<T>(update: (map: Record<string, unknown>) => T, isCurrent?: () => boolean): Promise<T> {
  if (!navigator.locks) throw new Error('浏览器不支持跨页面批注锁，原数据已保留');
  return navigator.locks.request(lockName, () => {
    if (isCurrent && !isCurrent()) throw new Error('草稿已切换，未保存浏览器引用');
    const map = readMap();
    const result = update(map);
    if (isCurrent && !isCurrent()) throw new Error('草稿已切换，未保存浏览器引用');
    localStorage.setItem(storageKey, JSON.stringify(map));
    window.dispatchEvent(new Event(changedEvent));
    return result;
  });
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

export async function addBrowserComment(owner: BrowserOwner, anchor: ChromeElementContext, isCurrent?: () => boolean): Promise<void> {
  const key = browserOwnerKey(owner);
  await updateMap(map => { const comments = ownerComments(map, key); map[key] = [...comments, createBrowserComment(anchor, comments.length + 1)]; }, isCurrent);
}

export async function changeBrowserComment(owner: BrowserOwner, expected: Record<string, unknown>, text: string | null): Promise<void> {
  const key = browserOwnerKey(owner), id = commentId(expected);
  if (!id) throw new Error('无法编辑未识别的浏览器批注');
  await updateMap(map => {
    const comments = ownerComments(map, key);
    const indices = comments.flatMap((value, index) => commentId(value) === id ? [index] : []);
    if (indices.length !== 1 || !same(comments[indices[0]!], expected)) throw new Error('批注已在其他页面修改，请检查后重试');
    const index = indices[0]!;
    if (text === null) { map[key] = comments.filter((_, i) => i !== index); return; }
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

/** Call only after confirmed submission, while the parent can still verify its latest draft. */
export async function acknowledgeBrowserReferences(owner: BrowserOwner, submitted: readonly BrowserReference[],
  isCurrent: (reference: BrowserReference) => boolean): Promise<void> {
  const key = browserOwnerKey(owner);
  await updateMap(map => {
    const comments = ownerComments(map, key), references = browserReferences(owner, comments);
    const acknowledged = new Set(submitted.filter(reference => isCurrent(reference) && references.some(current => same(current, reference))).map(reference => reference.id));
    const originals = references.filter(reference => acknowledged.has(reference.id)).map(reference => reference.original);
    map[key] = comments.filter(comment => !originals.some(original => same(original, comment)));
  });
}

/** Merge only snapshots which the parent draft has not independently changed. */
export function reconcileBrowserReferences(draft: ComposerDraft, previous: readonly BrowserReference[], current: readonly BrowserReference[]): ComposerDraft {
  const old = new Map(previous.map(reference => [reference.id, reference]));
  const next = new Map(current.map(reference => [reference.id, reference]));
  const references = (draft.references ?? []).flatMap(reference => {
    const before = old.get(reference.id);
    if (!before || !same(reference, before)) return [reference];
    const after = next.get(reference.id);
    return after ? [after] : [];
  });
  for (const reference of current) {
    if (!old.has(reference.id) && !references.some(item => item.id === reference.id)) references.push(reference);
  }
  return { ...draft, references };
}
