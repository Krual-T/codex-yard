import { readBrowserAtom, updateBrowserAtom } from '../storage/ui-atoms.ts';
import type { ComposerContext, ComposerDraft } from '../workbench-contract.ts';
import { activatePending, createId, draftKey, emptyDraft, isPristine, isStoredDraft, legacyBlockedMessage,
  legacyDraftCandidates, loadDraft, parseStoredDraft } from './standalone-draft.ts';
import type { StoredDraft } from './standalone-draft.ts';

export interface ComposerDraftOwner { hostId: string; threadId: string | null; draftId: string }
export interface ComposerDraftSnapshot { owner: ComposerDraftOwner; draft: ComposerDraft; revision: string }
export interface ComposerSubmissionDescription { owner: ComposerDraftOwner; revision: string; overrides: Partial<import('../workbench-contract.ts').SubmitOptions> }

interface Version extends StoredDraft { owner: ComposerDraftOwner; placeholder?: boolean }
interface Entry { versions: Version[]; retained: Version[] }
interface Repository { version: 1; archive: Record<string, string>; claims: Record<string, string>; initialized: Record<string, boolean>; entries: Record<string, Entry> }
export const composerDraftAtomKey = 'codex-yard.composer-drafts.v3';

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const sameOwner = (a: ComposerDraftOwner, b: ComposerDraftOwner) => a.hostId === b.hostId && a.threadId === b.threadId && a.draftId === b.draftId;
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
    && Array.isArray(value.retained) && value.retained.every(isVersion);
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
function snapshot(value: Version): ComposerDraftSnapshot {
  return structuredClone({ owner: value.owner, draft: value.draft, revision: value.revision });
}
export interface ComposerDraftVersions { versions: StoredDraft[]; retained: StoredDraft[] }
function versionsFor(store: Repository, owner: ComposerDraftOwner): ComposerDraftVersions {
  const entry = entryFor(store, owner);
  return structuredClone({ versions: entry.versions.filter(value => sameOwner(value.owner, owner)),
    retained: entry.retained.filter(value => sameOwner(value.owner, owner)) });
}
function legacyArchiveKey(context: ComposerContext, archive: Record<string, string>): string | undefined {
  const key = draftKey(context);
  if (Object.hasOwn(archive, key)) return key;
  const oldKey = 'codex-yard.composer.v1:' + JSON.stringify([context.hostId, context.threadId, context.threadId == null ? context.cwd : null]);
  const matchingThread = context.threadId && (context.draftId === context.threadId || context.draftId === 'local:' + context.threadId
    || context.legacyDraftKey === context.threadId || context.legacyDraftKey === 'local:' + context.threadId);
  return (matchingThread || context.legacyDraftKey === oldKey) && Object.hasOwn(archive, oldKey) ? oldKey : undefined;
}

/** Establish this owner's first version and import old bytes in the same transaction. */
export async function openComposerDraft(context: ComposerContext, atoms: Record<string, unknown>, currentOwner: () => boolean = () => true): Promise<ComposerDraftVersions> {
  const owner: ComposerDraftOwner = { hostId: context.hostId, threadId: context.threadId, draftId: context.draftId };
  const store = await mutate(current => {
    if (!currentOwner()) return current;
    const entry = entryFor(current, owner);
    if (current.initialized[ownerKey(owner)]) return current;
    const key = legacyArchiveKey(context, current.archive);
    const claimed = key && current.claims[key];
    const saved = key && (!claimed || claimed === ownerKey(owner)) ? parseStoredDraft(current.archive[key]!) : null;
    const legacy = !saved || saved.legacyPending ? legacyDraftCandidates(context, atoms) : [];
    let initial = saved;
    if (saved?.legacyPending) {
      const { legacyPending: _pending, ...settled } = saved;
      initial = settled;
    } else if (saved?.draft.blocked === legacyBlockedMessage) initial = loadDraft(context, atoms, saved);
    const replacePendingEmpty = saved?.legacyPending && isPristine(saved.draft) && legacy.length > 0;
    const values = replacePendingEmpty
      ? [{ ...legacy[0]!, prefills: saved.prefills }, ...legacy.slice(1)]
      : [...initial ? [initial] : [], ...legacy];
    const placeholder = values.length === 0 && !entry.versions.some(value => sameOwner(value.owner, owner));
    if (placeholder) values.push({ revision: createId(), draft: emptyDraft(), prefills: [] });
    const claims = key && saved ? { ...current.claims, [key]: ownerKey(owner) } : current.claims;
    const initialized = { ...current.initialized, [ownerKey(owner)]: true };
    return replaceEntry({ ...current, claims, initialized }, owner, { ...entry, versions: [...entry.versions, ...values.map(value => asVersion(owner, value, placeholder))] });
  });
  return versionsFor(store, owner);
}

/** Compare and write one edit within the atom transaction; divergence creates a recoverable branch. */
export async function writeComposerDraftVersion(owner: ComposerDraftOwner, expectedRevision: string, next: StoredDraft): Promise<ComposerDraftVersions> {
  const store = await mutate(current => {
    const entry = entryFor(current, owner), versions = [...entry.versions];
    const existing = versions.findIndex(value => sameOwner(value.owner, owner) && value.revision === expectedRevision);
    const duplicate = versions.findIndex(value => sameOwner(value.owner, owner) && value.revision === next.revision);
    if (duplicate >= 0) return current;
    if (existing >= 0) versions.splice(existing, 1);
    else {
      const blank = versions.findIndex(value => sameOwner(value.owner, owner) && value.placeholder && isPristine(value.draft)
        && !value.prefills.length && !entry.retained.some(item => sameOwner(item.owner, owner) && item.revision === value.revision));
      if (blank >= 0) versions.splice(blank, 1);
    }
    versions.unshift(asVersion(owner, next));
    return replaceEntry(current, owner, { ...entry, versions });
  });
  return versionsFor(store, owner);
}

/** Freeze the exact submitted version while later edits continue on their own revision. */
export async function retainComposerDraftVersion(owner: ComposerDraftOwner, value: StoredDraft): Promise<void> {
  await mutate(current => {
    const entry = entryFor(current, owner);
    const matches = (version: Version) => sameOwner(version.owner, owner) && version.revision === value.revision;
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
  const found = versions.find(value => sameOwner(value.owner, owner) && (revision === undefined || value.revision === revision));
  return found ? snapshot(found) : null;
}
export async function readComposerDraftVersions(owner: ComposerDraftOwner): Promise<ComposerDraftVersions> {
  const raw = await readBrowserAtom(composerDraftAtomKey);
  return raw === undefined ? { versions: [], retained: [] } : versionsFor(repository(raw), owner);
}

/** Remove only the confirmed version; newer branches and pending drafts remain recoverable. */
export async function clearComposerDraftRevision(owner: ComposerDraftOwner, revision: string): Promise<boolean> {
  let cleared = false;
  await mutate(current => {
    const entry = entryFor(current, owner);
    const matches = (value: Version) => sameOwner(value.owner, owner) && value.revision === revision;
    const target = entry.versions.find(matches), retained = entry.retained.filter(value => !matches(value));
    cleared = !!target || retained.length !== entry.retained.length;
    if (!cleared) return current;
    const versions = entry.versions.filter(value => !matches(value));
    if (target?.draft.pendingDrafts?.length) versions.push(asVersion(owner, { ...target, revision: createId(), draft: activatePending(target.draft, false) }));
    if (!versions.some(value => sameOwner(value.owner, owner))) {
      versions.push(asVersion(owner, { revision: createId(), draft: emptyDraft(), prefills: target?.prefills ?? [] }, true));
    }
    return replaceEntry(current, owner, { ...entry, versions, retained });
  });
  return cleared;
}
