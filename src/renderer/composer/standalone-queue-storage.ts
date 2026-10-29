import { readBrowserAtom, updateBrowserAtom, updateBrowserAtoms } from '../storage/ui-atoms.ts';
import { editableDraft } from '../messages/message-data.ts';
import type { ComposerDraft } from '../workbench-contract.ts';
import { composerDraftAtomKey, replaceComposerDraftWithQueuedInRoot, sameComposerDraftValue,
  updateComposerDraftVersionInRoot } from './composer-draft-store.ts';
import type { ComposerDraftOwner, ComposerDraftSnapshot } from './composer-draft-store.ts';
import { createId, draftToInput, normalizeDraft } from './standalone-draft.ts';

export interface UnknownQueueStart { id: string; clientUserMessageId: string; lockId: string }
export interface QueueReleaseIntent { marker: UnknownQueueStart; sent: boolean }
export interface QueueEditEntry { id: string; clientUserMessageId: string; input: Record<string, unknown>[] }
export type QueueEditStage = 'prepared' | 'deleting' | 'not-sent' | 'conflict' | 'deleted' | 'committed';
export interface QueueEditRecovery {
  kind: 'queue-edit-v1'; operationId: string; hostId: string; threadId: string;
  owner: ComposerDraftOwner; entry: QueueEditEntry; stage: QueueEditStage;
  before?: ComposerDraftSnapshot; after?: ComposerDraftSnapshot;
}
interface Repository { version: 1; archive: Record<string, string>; queues: Record<string, unknown>; releaseIntents?: unknown; editIntents?: unknown }
export const queueUnknownAtomKey = 'codex-yard.queue-unknown.v2';
const legacyPrefix = 'codex-yard.queue-unknown.v1:';
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const keyFor = (hostId: string, threadId: string) => legacyPrefix + JSON.stringify([hostId, threadId]);
const same = (a: UnknownQueueStart, b: UnknownQueueStart) => a.id === b.id && a.clientUserMessageId === b.clientUserMessageId && a.lockId === b.lockId;
const releaseKey = (hostId: string, threadId: string, marker: UnknownQueueStart) =>
  JSON.stringify([hostId, threadId, marker.id, marker.clientUserMessageId, marker.lockId]);
const sameOwner = (a: ComposerDraftOwner, b: ComposerDraftOwner) => a.hostId === b.hostId && a.threadId === b.threadId && a.draftId === b.draftId;
function isOwner(value: unknown): value is ComposerDraftOwner {
  return record(value) && typeof value.hostId === 'string' && !!value.hostId && typeof value.threadId === 'string' && !!value.threadId
    && typeof value.draftId === 'string' && !!value.draftId;
}
function isEntry(value: unknown): value is QueueEditEntry {
  return record(value) && typeof value.id === 'string' && !!value.id && typeof value.clientUserMessageId === 'string'
    && Array.isArray(value.input) && value.input.every(record);
}
function isSnapshot(value: unknown, owner: ComposerDraftOwner): value is ComposerDraftSnapshot {
  return record(value) && isOwner(value.owner) && sameOwner(value.owner, owner) && typeof value.revision === 'string'
    && !!value.revision && record(value.draft);
}
function editMap(store: Repository): Record<string, QueueEditRecovery> {
  if (store.editIntents === undefined) return {};
  if (!record(store.editIntents)) throw new Error('队列编辑恢复记录无法识别；原始记录已保留。');
  for (const [key, value] of Object.entries(store.editIntents)) {
    if (!record(value) || value.kind !== 'queue-edit-v1' || value.operationId !== key || !key
      || typeof value.hostId !== 'string' || typeof value.threadId !== 'string' || !isOwner(value.owner)
      || value.owner.hostId !== value.hostId || value.owner.threadId !== value.threadId || !isEntry(value.entry)
      || !['prepared', 'deleting', 'not-sent', 'conflict', 'deleted', 'committed'].includes(String(value.stage))
      || (value.before !== undefined && !isSnapshot(value.before, value.owner))
      || (value.after !== undefined && !isSnapshot(value.after, value.owner))
      || value.stage === 'committed' && (!isSnapshot(value.before, value.owner) || !isSnapshot(value.after, value.owner))) {
      throw new Error('队列编辑恢复记录无法识别；原始记录已保留。');
    }
  }
  return store.editIntents as Record<string, QueueEditRecovery>;
}

/** Project the original ordered protocol input using the existing message editor rules. */
export function queueEntryDraft(entry: QueueEditEntry, hostId: string): ComposerDraft {
  const projected = editableDraft({ id: entry.id, type: 'userMessage', content: entry.input });
  if (!projected) throw new Error('队列内容无法无损读取，原消息未删除。');
  const draft = normalizeDraft(projected);
  if (!sameComposerDraftValue(draftToInput(draft, hostId), entry.input)) {
    throw new Error('队列内容无法无损转入输入区，原消息未删除。');
  }
  return draft;
}
function intentMap(store: Repository): Record<string, unknown> {
  if (store.releaseIntents === undefined) return {};
  if (!record(store.releaseIntents)) throw new Error('队列锁释放记录无法识别；原始记录已保留。');
  return store.releaseIntents;
}
function intent(value: unknown, marker: UnknownQueueStart): boolean | undefined {
  if (value === undefined) return undefined;
  if (!record(value) || value.kind !== 'queue-lock-release-v1' || typeof value.sent !== 'boolean'
    || value.id !== marker.id || value.clientUserMessageId !== marker.clientUserMessageId || value.lockId !== marker.lockId
    || Object.keys(value).some(key => !['kind', 'id', 'clientUserMessageId', 'lockId', 'sent'].includes(key))) {
    throw new Error('队列锁释放记录与原始消息不一致。');
  }
  return value.sent;
}

function repository(value: unknown): Repository {
  if (!record(value) || value.version !== 1 || !record(value.archive)
    || !Object.values(value.archive).every(raw => typeof raw === 'string') || !record(value.queues)) {
    throw new Error('队列发送状态无法识别；原始记录已保留。');
  }
  return value as unknown as Repository;
}
function importLegacy(): Repository {
  const archive: Record<string, string> = {}, queues: Record<string, unknown> = {};
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (!key?.startsWith(legacyPrefix)) continue;
    const raw = localStorage.getItem(key);
    if (raw === null) continue;
    archive[key] = raw;
    try { queues[key] = JSON.parse(raw); } catch { queues[key] = null; }
  }
  return { version: 1, archive, queues };
}
function markers(store: Repository, key: string): UnknownQueueStart[] {
  if (!Object.hasOwn(store.queues, key)) return [];
  const value = store.queues[key];
  if (!Array.isArray(value) || !value.every(item => record(item) && typeof item.id === 'string'
    && typeof item.clientUserMessageId === 'string' && typeof item.lockId === 'string')) {
    throw new Error('旧队列发送状态无法转换；原始记录已保留。');
  }
  return value;
}
async function current(): Promise<Repository> {
  const existing = await readBrowserAtom(queueUnknownAtomKey);
  if (existing !== undefined) return repository(existing);
  return repository(await updateBrowserAtom(queueUnknownAtomKey, previous => previous === undefined ? importLegacy() : repository(previous)));
}
export async function readUnknownQueueStarts(hostId: string, threadId: string): Promise<UnknownQueueStart[]> {
  return structuredClone(markers(await current(), keyFor(hostId, threadId)));
}
export async function readUnknownQueueRecovery(hostId: string, threadId: string): Promise<{ markers: UnknownQueueStart[]; releases: QueueReleaseIntent[]; edits: QueueEditRecovery[] }> {
  const store = await current(), items = markers(store, keyFor(hostId, threadId)), intents = intentMap(store);
  const releases = items.flatMap(marker => {
    const sent = intent(intents[releaseKey(hostId, threadId, marker)], marker);
    return sent === undefined ? [] : [{ marker, sent }];
  });
  const edits = Object.values(editMap(store)).filter(item => item.hostId === hostId && item.threadId === threadId);
  return structuredClone({ markers: items, releases, edits });
}
export async function addUnknownQueueStart(hostId: string, threadId: string, marker: UnknownQueueStart): Promise<UnknownQueueStart[]> {
  const key = keyFor(hostId, threadId);
  const result = await updateBrowserAtom(queueUnknownAtomKey, previous => {
    const store = previous === undefined ? importLegacy() : repository(previous);
    const existing = markers(store, key);
    if (existing.some(item => item.id === marker.id)) throw new Error('此消息已有未确认的发送记录。');
    if (Object.values(editMap(store)).some(item => item.hostId === hostId && item.threadId === threadId && item.entry.id === marker.id)) {
      throw new Error('此消息已有未完成的队列编辑恢复。');
    }
    return { ...store, queues: { ...store.queues, [key]: [...existing, marker] } };
  });
  return structuredClone(markers(repository(result), key));
}

/** Persist the exact selected entry before any delete is dispatched. */
export async function prepareQueueEdit(hostId: string, threadId: string, operationId: string,
  entry: QueueEditEntry, before: ComposerDraftSnapshot, isCurrent: () => boolean): Promise<QueueEditRecovery> {
  if (!operationId || !isEntry(entry) || !isOwner(before.owner) || before.owner.hostId !== hostId || before.owner.threadId !== threadId) {
    throw new Error('队列编辑身份无效。');
  }
  const captured = structuredClone({ entry, before });
  return updateBrowserAtoms(atoms => {
    if (!isCurrent()) throw new Error('原输入区已改变，队列消息未删除。');
    const store = atoms[queueUnknownAtomKey] === undefined ? importLegacy() : repository(atoms[queueUnknownAtomKey]);
    const edits = editMap(store);
    if (Object.hasOwn(edits, operationId) || Object.values(edits).some(item => item.hostId === hostId
      && item.threadId === threadId && item.entry.id === captured.entry.id)) throw new Error('此消息已有队列编辑恢复记录。');
    if (markers(store, keyFor(hostId, threadId)).some(item => item.id === captured.entry.id)) throw new Error('此消息已有未确认的发送记录。');
    updateComposerDraftVersionInRoot(atoms[composerDraftAtomKey], captured.before, draft => draft, operationId);
    const value: QueueEditRecovery = { kind: 'queue-edit-v1', operationId, hostId, threadId, owner: captured.before.owner,
      entry: captured.entry, stage: 'prepared' };
    return { value, updates: { [queueUnknownAtomKey]: { ...store, editIntents: { ...edits, [operationId]: value } } } };
  });
}

export async function advanceQueueEdit(hostId: string, threadId: string, operationId: string,
  from: 'prepared' | 'deleting', to: 'deleting' | 'not-sent' | 'conflict' | 'deleted'): Promise<QueueEditRecovery> {
  if (!(from === 'prepared' && ['deleting', 'not-sent', 'conflict'].includes(to)
    || from === 'deleting' && ['not-sent', 'conflict', 'deleted'].includes(to))) throw new Error('队列编辑恢复阶段无效。');
  return updateBrowserAtoms(atoms => {
    const store = repository(atoms[queueUnknownAtomKey]), edits = editMap(store), old = edits[operationId];
    if (!old || old.hostId !== hostId || old.threadId !== threadId || old.stage !== from) throw new Error('队列编辑恢复记录已改变。');
    const value: QueueEditRecovery = { ...old, stage: to };
    return { value, updates: { [queueUnknownAtomKey]: { ...store, editIntents: { ...edits, [operationId]: value } } } };
  });
}

/** Commit the confirmed item and its receipt in the same existing UI-atom transaction. */
export async function commitQueueEdit(hostId: string, threadId: string, operationId: string,
  before: ComposerDraftSnapshot, isCurrent: () => boolean): Promise<ComposerDraftSnapshot> {
  return updateBrowserAtoms(atoms => {
    if (!isCurrent()) throw new Error('原输入区已改变，已删除消息仍保留在恢复记录中。');
    const store = repository(atoms[queueUnknownAtomKey]), edits = editMap(store), old = edits[operationId];
    if (!old || old.hostId !== hostId || old.threadId !== threadId || old.stage !== 'deleted'
      || !sameOwner(old.owner, before.owner)) throw new Error('原队列编辑或草稿身份已改变。');
    const changed = replaceComposerDraftWithQueuedInRoot(atoms[composerDraftAtomKey], before, queueEntryDraft(old.entry, hostId), createId());
    const value: QueueEditRecovery = { ...old, stage: 'committed', before: structuredClone(before), after: structuredClone(changed.after) };
    return { value: changed.after, updates: { [composerDraftAtomKey]: changed.root,
      [queueUnknownAtomKey]: { ...store, editIntents: { ...edits, [operationId]: value } } } };
  });
}

/** Remove only the exact recovery stage explicitly acknowledged by the caller. */
export async function dismissQueueEdit(hostId: string, threadId: string, operationId: string, stage: QueueEditStage): Promise<void> {
  await updateBrowserAtoms(atoms => {
    const store = repository(atoms[queueUnknownAtomKey]), edits = editMap(store), old = edits[operationId];
    if (!old || old.hostId !== hostId || old.threadId !== threadId || old.stage !== stage) throw new Error('队列编辑恢复记录已改变。');
    const remaining = { ...edits }; delete remaining[operationId];
    return { value: undefined, updates: { [queueUnknownAtomKey]: { ...store, editIntents: remaining } } };
  });
}
/** Record the intended release before calling the host; a failure leaves the marker recoverable. */
export async function prepareUnknownQueueRelease(hostId: string, threadId: string, marker: UnknownQueueStart, sent: boolean): Promise<boolean> {
  const key = keyFor(hostId, threadId), release = releaseKey(hostId, threadId, marker);
  let found = false;
  await updateBrowserAtom(queueUnknownAtomKey, previous => {
    const store = previous === undefined ? importLegacy() : repository(previous);
    found = markers(store, key).some(item => same(item, marker));
    if (!found) return store;
    const intents = intentMap(store), prior = intent(intents[release], marker);
    if (prior !== undefined && prior !== sent) throw new Error('队列发送状态与锁释放请求不一致。');
    if (prior !== undefined) return store;
    return { ...store, releaseIntents: { ...intents, [release]: { kind: 'queue-lock-release-v1',
      id: marker.id, clientUserMessageId: marker.clientUserMessageId, lockId: marker.lockId, sent } } };
  });
  return found;
}
export async function removeUnknownQueueStart(hostId: string, threadId: string, marker: UnknownQueueStart): Promise<{ removed: boolean; markers: UnknownQueueStart[] }> {
  const key = keyFor(hostId, threadId);
  let removed = false;
  const result = await updateBrowserAtom(queueUnknownAtomKey, previous => {
    const store = previous === undefined ? importLegacy() : repository(previous);
    const existing = markers(store, key), next = existing.filter(item => !same(item, marker));
    removed = next.length !== existing.length;
    const intents = intentMap(store), release = releaseKey(hostId, threadId, marker);
    const hasIntent = Object.hasOwn(intents, release) && intent(intents[release], marker) !== undefined;
    const remaining = { ...intents };
    if (removed && hasIntent) delete remaining[release];
    return { ...store, queues: { ...store.queues, [key]: next }, ...(removed && hasIntent ? { releaseIntents: remaining } : {}) };
  });
  return { removed, markers: structuredClone(markers(repository(result), key)) };
}
