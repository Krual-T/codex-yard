import { readBrowserAtom, updateBrowserAtom } from '../storage/ui-atoms.ts';
import type { ComposerContext, ComposerDraft } from '../workbench-contract.ts';
import { activatePending, createId, draftKey, emptyDraft, isPristine, isStoredDraft, legacyBlockedMessage,
  legacyDraftCandidates, loadDraft, parseStoredDraft } from './standalone-draft.ts';
import type { StoredDraft } from './standalone-draft.ts';

export interface ComposerDraftOwner { hostId: string; threadId: string | null; draftId: string }
export interface ComposerDraftSnapshot { owner: ComposerDraftOwner; draft: ComposerDraft; revision: string }
export interface ComposerSubmissionDescription {
  owner: ComposerDraftOwner;
  revision: string;
  overrides: Partial<import('../workbench-contract.ts').SubmitOptions>;
  /** Captured at submission so the parent can serialize and recover the same document mode. */
  documentPlainTextMode?: boolean;
}

interface Version extends StoredDraft { owner: ComposerDraftOwner; placeholder?: boolean }
interface Entry { versions: Version[]; retained: Version[]; createdThreadId?: string }
interface Repository { version: 1; archive: Record<string, string>; claims: Record<string, string>; initialized: Record<string, boolean>; entries: Record<string, Entry> }
export const composerDraftAtomKey = 'codex-yard.composer-drafts.v3';
const legacyHomeClaim = 'native-atoms:home:new-conversation';
const legacyHomeKeyPrefix = 'native-atoms:home:key:';
const legacyDraftAtoms = ['composer-prompt-drafts-v2', 'composer-prompt-drafts-v1', 'composer-retained-documents-v1'] as const;

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const sameOwner = (entry: Entry, a: ComposerDraftOwner, b: ComposerDraftOwner) => a.hostId === b.hostId && a.draftId === b.draftId
  && (a.threadId === b.threadId || entry.createdThreadId !== undefined
    && (a.threadId === null && b.threadId === entry.createdThreadId || b.threadId === null && a.threadId === entry.createdThreadId));
const ownerKey = (owner: ComposerDraftOwner) => JSON.stringify([owner.hostId, owner.threadId, owner.draftId]);
function isOwner(value: unknown): value is ComposerDraftOwner {
  return record(value) && typeof value.hostId === 'string' && (value.threadId === null || typeof value.threadId === 'string')
    && typeof value.draftId === 'string' && value.draftId.length > 0;
}
function isVersion(value: unknown): value is Version {
  return isStoredDraft(value) && record(value) && isOwner(value.owner)
    && (value.placeholder === undefined || typeof value.placeholder === 'boolean');
}
function isEntry(value: unknown): value is Entry {
  return record(value) && Array.isArray(value.versions) && value.versions.every(isVersion)
    && Array.isArray(value.retained) && value.retained.every(isVersion)
    && (value.createdThreadId === undefined || typeof value.createdThreadId === 'string' && value.createdThreadId.trim().length > 0);
}
function repository(value: unknown): Repository {
  if (!record(value) || value.version !== 1 || !record(value.archive) || !Object.values(value.archive).every(item => typeof item === 'string')
    || !record(value.claims) || !Object.values(value.claims).every(item => typeof item === 'string')
    || !record(value.initialized) || !Object.values(value.initialized).every(item => typeof item === 'boolean')
    || !record(value.entries) || !Object.values(value.entries).every(isEntry)) {
    throw new Error('草稿事务记录无法识别；原始数据已保留。');
  }
  return value as unknown as Repository;
}

/** Compare persisted structured values without discarding unknown fields. */
export function sameComposerDraftValue(left: unknown, right: unknown): boolean {
  const leftSeen = new WeakMap<object, object>(), rightSeen = new WeakMap<object, object>();
  function same(a: unknown, b: unknown): boolean {
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return Object.is(a, b);
    const prototype = Object.getPrototypeOf(a);
    if (prototype !== Object.getPrototypeOf(b) || prototype !== Object.prototype && prototype !== null && prototype !== Array.prototype) return false;
    if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length) return false;
    if (leftSeen.has(a) || rightSeen.has(b)) return leftSeen.get(a) === b && rightSeen.get(b) === a;
    leftSeen.set(a, b); rightSeen.set(b, a);
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key)
      && same((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
  }
  return same(left, right);
}

/** Prepare one exact active-version replacement for an existing root atom transaction. */
export function updateComposerDraftVersionInRoot(root: unknown, before: ComposerDraftSnapshot,
  change: (draft: ComposerDraft) => ComposerDraft, nextRevision: string): { root: unknown; after: ComposerDraftSnapshot; changed: boolean } {
  if (!before || !isOwner(before.owner) || typeof before.revision !== 'string' || !before.revision
    || typeof nextRevision !== 'string' || !nextRevision) throw new Error('草稿版本或身份无效。');
  const store = repository(root), entry = entryFor(store, before.owner);
  const matches = entry.versions.flatMap((version, index) =>
    sameOwner(entry, version.owner, before.owner) && version.revision === before.revision ? [index] : []);
  if (matches.length !== 1) throw new Error('草稿版本已改变，请核对后重试。');
  const index = matches[0]!, previous = entry.versions[index]!;
  if (!sameComposerDraftValue(previous.draft, before.draft)) throw new Error('草稿内容已改变，请核对后重试。');
  const changed = change(structuredClone(previous.draft));
  if (!record(changed)) throw new Error('草稿更新无法无损保存。');
  const draft = { ...previous.draft, ...structuredClone(changed) };
  const candidate = { ...previous, draft };
  if (!isVersion(candidate)) throw new Error('草稿更新无法无损保存。');
  if (sameComposerDraftValue(previous.draft, draft)) return { root, after: snapshot(previous, before.owner), changed: false };
  if ([...entry.versions, ...entry.retained].some(version => version.revision === nextRevision)) {
    throw new Error('草稿新版本已存在，请重新核对。');
  }
  const next: Version = { ...candidate, revision: nextRevision, placeholder: false };
  const versions = [...entry.versions]; versions[index] = next;
  return { root: replaceEntry(store, before.owner, { ...entry, versions }), after: snapshot(next, before.owner), changed: true };
}

function importArchive(): Repository {
  const archive: Record<string, string> = {};
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key && (key.startsWith('codex-yard.composer.v1:') || key.startsWith('codex-yard.composer.v2:'))) {
      const raw = localStorage.getItem(key);
      if (raw !== null) archive[key] = raw;
    }
  }
  return { version: 1, archive, claims: {}, initialized: {}, entries: {} };
}
async function mutate(update: (store: Repository) => Repository): Promise<Repository> {
  const result = await updateBrowserAtom(composerDraftAtomKey, previous => update(previous === undefined ? importArchive() : repository(previous)));
  return repository(result);
}
function entryFor(store: Repository, owner: ComposerDraftOwner): Entry {
  return store.entries[draftKey({ ...owner, cwd: '' })] ?? { versions: [], retained: [] };
}
function replaceEntry(store: Repository, owner: ComposerDraftOwner, entry: Entry): Repository {
  return { ...store, entries: { ...store.entries, [draftKey({ ...owner, cwd: '' })]: entry } };
}
function asVersion(owner: ComposerDraftOwner, stored: StoredDraft, placeholder = false): Version {
  return { ...stored, owner: { ...owner }, placeholder };
}
function snapshot(value: Version, owner: ComposerDraftOwner): ComposerDraftSnapshot {
  return structuredClone({ owner, draft: value.draft, revision: value.revision });
}
export interface ComposerDraftVersions { versions: StoredDraft[]; retained: StoredDraft[] }
function versionsFor(store: Repository, owner: ComposerDraftOwner): ComposerDraftVersions {
  const entry = entryFor(store, owner);
  return structuredClone({ versions: entry.versions.filter(value => sameOwner(entry, value.owner, owner)),
    retained: entry.retained.filter(value => sameOwner(entry, value.owner, owner)) });
}
function legacyArchiveKey(context: ComposerContext, archive: Record<string, string>): string | undefined {
  const key = draftKey(context);
  if (Object.hasOwn(archive, key)) return key;
  const oldKey = 'codex-yard.composer.v1:' + JSON.stringify([context.hostId, context.threadId, context.threadId == null ? context.cwd : null]);
  const matchingThread = context.threadId && (context.draftId === context.threadId || context.draftId === 'local:' + context.threadId
    || context.legacyDraftKey === context.threadId || context.legacyDraftKey === 'local:' + context.threadId);
  return (matchingThread || context.legacyDraftKey === oldKey) && Object.hasOwn(archive, oldKey) ? oldKey : undefined;
}

function legacyHomeKeys(atoms: Record<string, unknown>): Set<string> {
  const keys = new Set(['new-conversation']);
  const identities = record(atoms['draft-thread-identities-v1']) ? atoms['draft-thread-identities-v1'] : {};
  const bindings = record(atoms['client-thread-bindings-v1']) ? atoms['client-thread-bindings-v1'] : {};
  const identity = identities['new-conversation'];
  if (typeof identity === 'string' && identity && bindings[identity] == null) keys.add(identity);
  return keys;
}
function withoutLegacyHome(atoms: Record<string, unknown>, keys: Set<string>): Record<string, unknown> {
  const filtered = { ...atoms };
  for (const name of legacyDraftAtoms) {
    const source = atoms[name];
    if (record(source)) filtered[name] = Object.fromEntries(Object.entries(source).filter(([key]) => !keys.has(key)));
  }
  return filtered;
}
function containsLegacyHome(draft: unknown, keys: Set<string>): boolean {
  if (!record(draft)) return false;
  const preserved = draft.preserved;
  if (record(preserved) && (typeof preserved.promptKey === 'string' && keys.has(preserved.promptKey)
    || typeof preserved.retainedKey === 'string' && keys.has(preserved.retainedKey))) return true;
  return Array.isArray(draft.pendingDrafts) && draft.pendingDrafts.some(value => containsLegacyHome(value, keys));
}
function rememberLegacyHomeKeys(draft: unknown, keys: Set<string>, claims: Record<string, string>, owner: string): void {
  if (!record(draft)) return;
  const preserved = draft.preserved;
  if (record(preserved)) {
    for (const key of [preserved.promptKey, preserved.retainedKey]) {
      if (typeof key === 'string' && keys.has(key)) claims[legacyHomeKeyPrefix + key] = owner;
    }
  }
  if (Array.isArray(draft.pendingDrafts)) for (const value of draft.pendingDrafts) rememberLegacyHomeKeys(value, keys, claims, owner);
}
function previousHomeOwner(store: Repository, keys: Set<string>): string | undefined {
  for (const entry of Object.values(store.entries)) {
    for (const value of [...entry.versions, ...entry.retained]) {
      if (value.owner.hostId === 'local' && containsLegacyHome(value.draft, keys)) return ownerKey(value.owner);
    }
  }
  return undefined;
}

/** Bind an initialized new-conversation draft to its authoritative created thread. */
export async function bindComposerDraftToThread(owner: ComposerDraftOwner, threadId: string): Promise<void> {
  if (!isOwner(owner) || !owner.hostId || owner.threadId !== null || typeof threadId !== 'string' || !threadId.trim()) {
    throw new Error('草稿关联需要原始新会话身份和已创建的线程 ID。');
  }
  await mutate(current => {
    if (!current.initialized[ownerKey(owner)]) throw new Error('原始草稿尚未初始化，不能关联线程。');
    const entry = entryFor(current, owner);
    if (entry.createdThreadId !== undefined && entry.createdThreadId !== threadId) {
      throw new Error('此草稿已关联其他线程，未更改关联。');
    }
    return entry.createdThreadId === threadId ? current : replaceEntry(current, owner, { ...entry, createdThreadId: threadId });
  });
}

/** Establish this owner's first version and import old bytes in the same transaction. */
export async function openComposerDraft(context: ComposerContext, atoms: Record<string, unknown>, currentOwner: () => boolean = () => true): Promise<ComposerDraftVersions> {
  const owner: ComposerDraftOwner = { hostId: context.hostId, threadId: context.threadId, draftId: context.draftId };
  const store = await mutate(current => {
    if (!currentOwner()) return current;
    const entry = entryFor(current, owner);
    const initialized = current.initialized[ownerKey(owner)] || owner.threadId === entry.createdThreadId
      && current.initialized[ownerKey({ ...owner, threadId: null })];
    const homeKeys = legacyHomeKeys(atoms);
    for (const key of Object.keys(current.claims)) if (key.startsWith(legacyHomeKeyPrefix)) homeKeys.add(key.slice(legacyHomeKeyPrefix.length));
    const previousClaim = current.claims[legacyHomeClaim] ?? previousHomeOwner(current, homeKeys);
    const homeContext = context.hostId === 'local' && context.threadId === null
      && (context.placement === undefined || context.placement === 'main')
      && (!context.legacyDraftKey || homeKeys.has(context.legacyDraftKey));
    const home = homeContext && !previousClaim
      ? legacyDraftCandidates({ ...context, draftId: 'new-conversation', legacyDraftKey: 'new-conversation' }, atoms) : [];
    if (initialized && !home.length && (current.claims[legacyHomeClaim] || !previousClaim)) return current;
    const key = legacyArchiveKey(context, current.archive);
    const claimed = key && current.claims[key];
    const saved = !initialized && key && (!claimed || claimed === ownerKey(owner)) ? parseStoredDraft(current.archive[key]!) : null;
    const savedHome = context.hostId === 'local' && !!saved && containsLegacyHome(saved.draft, homeKeys);
    const legacy = !initialized && (!saved || saved.legacyPending)
      ? legacyDraftCandidates(context, context.hostId === 'local' ? withoutLegacyHome(atoms, homeKeys) : atoms) : [];
    if (!savedHome) legacy.push(...home);
    let initial = saved;
    if (saved?.legacyPending) {
      const { legacyPending: _pending, ...settled } = saved;
      initial = settled;
    } else if (saved?.draft.blocked === legacyBlockedMessage) initial = loadDraft(context, atoms, saved);
    const replacePendingEmpty = saved?.legacyPending && isPristine(saved.draft) && legacy.length > 0;
    const values = replacePendingEmpty
      ? [{ ...legacy[0]!, prefills: saved.prefills }, ...legacy.slice(1)]
      : [...initial ? [initial] : [], ...legacy];
    const existing = home.length && initialized ? entry.versions.filter(value => !(sameOwner(entry, value.owner, owner)
      && value.placeholder && isPristine(value.draft) && !value.prefills.length
      && !entry.retained.some(item => sameOwner(entry, item.owner, owner) && item.revision === value.revision))) : entry.versions;
    const placeholder = !initialized && values.length === 0 && !existing.some(value => sameOwner(entry, value.owner, owner));
    if (placeholder) values.push({ revision: createId(), draft: emptyDraft(), prefills: [] });
    const claims = { ...current.claims };
    if (key && saved) claims[key] = ownerKey(owner);
    if (previousClaim || home.length || savedHome) claims[legacyHomeClaim] = previousClaim ?? ownerKey(owner);
    if (home.length && !savedHome) for (const value of home) rememberLegacyHomeKeys(value.draft, homeKeys, claims, ownerKey(owner));
    if (savedHome) rememberLegacyHomeKeys(saved.draft, homeKeys, claims, ownerKey(owner));
    if (previousClaim && !current.claims[legacyHomeClaim]) {
      for (const item of Object.values(current.entries)) for (const value of [...item.versions, ...item.retained]) {
        if (ownerKey(value.owner) === previousClaim) rememberLegacyHomeKeys(value.draft, homeKeys, claims, previousClaim);
      }
    }
    return replaceEntry({ ...current, claims, initialized: { ...current.initialized, [ownerKey(owner)]: true } }, owner,
      { ...entry, versions: [...existing, ...values.map(value => asVersion(owner, value, placeholder))] });
  });
  return versionsFor(store, owner);
}

/** Compare and write one edit within the atom transaction; divergence creates a recoverable branch. */
export async function writeComposerDraftVersion(owner: ComposerDraftOwner, expectedRevision: string, next: StoredDraft): Promise<ComposerDraftVersions> {
  const store = await mutate(current => {
    const entry = entryFor(current, owner), versions = [...entry.versions];
    const existing = versions.findIndex(value => sameOwner(entry, value.owner, owner) && value.revision === expectedRevision);
    const duplicate = versions.findIndex(value => sameOwner(entry, value.owner, owner) && value.revision === next.revision);
    if (duplicate >= 0) return current;
    if (existing >= 0) versions.splice(existing, 1);
    else {
      const blank = versions.findIndex(value => sameOwner(entry, value.owner, owner) && value.placeholder && isPristine(value.draft)
        && !value.prefills.length && !entry.retained.some(item => sameOwner(entry, item.owner, owner) && item.revision === value.revision));
      if (blank >= 0) versions.splice(blank, 1);
    }
    versions.unshift(asVersion(owner, next));
    return replaceEntry(current, owner, { ...entry, versions });
  });
  return versionsFor(store, owner);
}

/** Explicitly preserve an unresolved projection without replacing another active version. */
export async function saveComposerDraftConflict(owner: ComposerDraftOwner, value: StoredDraft): Promise<ComposerDraftVersions> {
  const store = await mutate(current => {
    const entry = entryFor(current, owner);
    if ([...entry.versions, ...entry.retained].some(version => version.revision === value.revision)) {
      throw new Error('草稿新版本已存在，请重新核对。');
    }
    return replaceEntry(current, owner, { ...entry, versions: [...entry.versions, asVersion(owner, value)] });
  });
  return versionsFor(store, owner);
}

/** Freeze the exact submitted version while later edits continue on their own revision. */
export async function retainComposerDraftVersion(owner: ComposerDraftOwner, value: StoredDraft): Promise<void> {
  await mutate(current => {
    const entry = entryFor(current, owner);
    const matches = (version: Version) => sameOwner(entry, version.owner, owner) && version.revision === value.revision;
    const versions = entry.versions.some(matches) ? entry.versions : [...entry.versions, asVersion(owner, value)];
    const retained = entry.retained.some(matches) ? entry.retained : [...entry.retained, asVersion(owner, value)];
    return replaceEntry(current, owner, { ...entry, versions, retained });
  });
}

/** Read the current owner or one retained submission without creating a new draft. */
export async function readComposerDraft(owner: ComposerDraftOwner, revision?: string): Promise<ComposerDraftSnapshot | null> {
  const raw = await readBrowserAtom(composerDraftAtomKey);
  if (raw === undefined) return null;
  const entry = entryFor(repository(raw), owner);
  const versions = [...entry.versions, ...entry.retained];
  const found = versions.find(value => sameOwner(entry, value.owner, owner) && (revision === undefined || value.revision === revision));
  return found ? snapshot(found, owner) : null;
}
export async function readComposerDraftVersions(owner: ComposerDraftOwner): Promise<ComposerDraftVersions> {
  const raw = await readBrowserAtom(composerDraftAtomKey);
  return raw === undefined ? { versions: [], retained: [] } : versionsFor(repository(raw), owner);
}

/** Remove only the confirmed version; newer branches and pending drafts remain recoverable. */
export async function clearComposerDraftRevision(owner: ComposerDraftOwner, revision: string, guard?: () => boolean): Promise<boolean> {
  let cleared = false;
  await mutate(current => {
    if (guard && !guard()) throw new Error('当前草稿冲突尚未处理。');
    const entry = entryFor(current, owner);
    const matches = (value: Version) => sameOwner(entry, value.owner, owner) && value.revision === revision;
    const target = entry.versions.find(matches), retained = entry.retained.filter(value => !matches(value));
    cleared = !!target || retained.length !== entry.retained.length;
    if (!cleared) return current;
    const versions = entry.versions.filter(value => !matches(value));
    if (target?.draft.pendingDrafts?.length) versions.push(asVersion(owner, { ...target, revision: createId(), draft: activatePending(target.draft, false) }));
    if (!versions.some(value => sameOwner(entry, value.owner, owner))) {
      versions.push(asVersion(owner, { revision: createId(), draft: emptyDraft(), prefills: target?.prefills ?? [] }, true));
    }
    return replaceEntry(current, owner, { ...entry, versions, retained });
  });
  return cleared;
}
