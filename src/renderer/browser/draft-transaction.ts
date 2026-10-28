import { composerDraftAtomKey } from '../composer/composer-draft-store.ts';
import type { ComposerDraftSnapshot } from '../composer/composer-draft-store.ts';
import { createId, draftKey, isStoredDraft } from '../composer/standalone-draft.ts';
import type { ComposerDraft } from '../workbench-contract.ts';
import type { BrowserOwner } from './comments.ts';

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Compare complete structured data, including fields unknown to this renderer. */
export function sameBrowserValue(a: unknown, b: unknown): boolean {
  const visited = new WeakMap<object, WeakSet<object>>();
  const compare = (left: unknown, right: unknown): boolean => {
    if (Object.is(left, right)) return true;
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
    if (Array.isArray(left) !== Array.isArray(right)) return false;
    if (Array.isArray(left) && Array.isArray(right) && left.length !== right.length) return false;
    const prototype = Object.getPrototypeOf(left);
    if (prototype !== Object.getPrototypeOf(right) || prototype !== Object.prototype && prototype !== null && prototype !== Array.prototype) return false;
    if (visited.get(left)?.has(right)) return true;
    const matches = visited.get(left) ?? new WeakSet<object>();
    matches.add(right); visited.set(left, matches);
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key)
      && compare((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
  };
  return compare(a, b);
}

const isOwner = (value: unknown) => record(value) && typeof value.hostId === 'string'
  && (value.threadId === null || typeof value.threadId === 'string') && typeof value.draftId === 'string' && value.draftId.length > 0;
const isVersion = (value: unknown) => isStoredDraft(value) && record(value) && isOwner(value.owner)
  && (value.placeholder === undefined || typeof value.placeholder === 'boolean');
const isEntry = (value: unknown) => record(value) && Array.isArray(value.versions) && value.versions.every(isVersion)
  && Array.isArray(value.retained) && value.retained.every(isVersion)
  && (value.createdThreadId === undefined || typeof value.createdThreadId === 'string' && !!value.createdThreadId.trim());

export function updateBrowserDraftVersion(atoms: Readonly<Record<string, unknown>>, owner: BrowserOwner,
  snapshot: ComposerDraftSnapshot, change: (draft: ComposerDraft) => ComposerDraft): { repository: unknown; snapshot: ComposerDraftSnapshot } {
  const source = snapshot.owner;
  if (!snapshot.revision || source.hostId !== owner.hostId || source.draftId !== owner.draftId) throw new Error('草稿身份已改变，请重新核对。');
  if (source.threadId !== owner.threadId) {
    const sends = atoms['codex-yard.send-recovery.v1'];
    if (owner.threadId !== null || source.threadId === null || !record(sends) || !record(sends.bindings)
      || sends.bindings[JSON.stringify([source.hostId, source.threadId])] !== source.draftId) {
      throw new Error('草稿与浏览器引用的会话关联无法核实。');
    }
  }
  const root = atoms[composerDraftAtomKey];
  if (!record(root) || root.version !== 1 || !record(root.archive) || !record(root.claims)
    || !Object.values(root.archive).every(value => typeof value === 'string')
    || !Object.values(root.claims).every(value => typeof value === 'string')
    || !record(root.initialized) || !Object.values(root.initialized).every(value => typeof value === 'boolean')
    || !record(root.entries) || !Object.values(root.entries).every(isEntry)) throw new Error('草稿事务记录无法识别，原数据已保留。');
  const key = draftKey({ ...source, cwd: '' }), entry = root.entries[key];
  if (!record(entry) || !Array.isArray(entry.versions) || !Array.isArray(entry.retained)
    || entry.createdThreadId !== undefined && typeof entry.createdThreadId !== 'string') throw new Error('草稿版本记录无法识别，原数据已保留。');
  const matches = entry.versions.flatMap((value: unknown, index: number) => {
    if (!isStoredDraft(value) || !record(value) || !record(value.owner)) throw new Error('草稿版本记录无法识别，原数据已保留。');
    const candidate = value.owner;
    const sameOwner = candidate.hostId === source.hostId && candidate.draftId === source.draftId
      && (candidate.threadId === source.threadId || typeof entry.createdThreadId === 'string'
        && (candidate.threadId === null && source.threadId === entry.createdThreadId
          || source.threadId === null && candidate.threadId === entry.createdThreadId));
    return sameOwner && value.revision === snapshot.revision ? [index] : [];
  });
  if (matches.length !== 1) throw new Error('草稿版本已改变，请核对后重试。');
  const index = matches[0]!, version = entry.versions[index] as Record<string, unknown>;
  if (!sameBrowserValue(version.draft, snapshot.draft)) throw new Error('草稿内容已改变，请核对后重试。');
  const draft = change(snapshot.draft);
  if (sameBrowserValue(draft, snapshot.draft)) return { repository: root, snapshot };
  const used = new Set([...entry.versions, ...entry.retained].map((value: { revision: string }) => value.revision));
  let revision = createId();
  for (let attempt = 0; used.has(revision) && attempt < 10; attempt++) revision = createId();
  if (used.has(revision)) throw new Error('无法分配独立草稿版本，原内容已保留。');
  const next = { ...version, revision, draft, placeholder: false };
  if (!isStoredDraft(next)) throw new Error('草稿更新无法无损保存。');
  const versions = [...entry.versions]; versions[index] = next;
  return { repository: { ...root, entries: { ...root.entries, [key]: { ...entry, versions } } },
    snapshot: { owner: source, revision, draft } };
}
