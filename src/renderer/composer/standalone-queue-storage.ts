import { readBrowserAtom, updateBrowserAtom } from '../storage/ui-atoms.ts';

export interface UnknownQueueStart { id: string; clientUserMessageId: string; lockId: string }
export interface QueueReleaseIntent { marker: UnknownQueueStart; sent: boolean }
interface Repository { version: 1; archive: Record<string, string>; queues: Record<string, unknown>; releaseIntents?: unknown }
export const queueUnknownAtomKey = 'codex-yard.queue-unknown.v2';
const legacyPrefix = 'codex-yard.queue-unknown.v1:';
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const keyFor = (hostId: string, threadId: string) => legacyPrefix + JSON.stringify([hostId, threadId]);
const same = (a: UnknownQueueStart, b: UnknownQueueStart) => a.id === b.id && a.clientUserMessageId === b.clientUserMessageId && a.lockId === b.lockId;
const releaseKey = (hostId: string, threadId: string, marker: UnknownQueueStart) =>
  JSON.stringify([hostId, threadId, marker.id, marker.clientUserMessageId, marker.lockId]);
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
export async function readUnknownQueueRecovery(hostId: string, threadId: string): Promise<{ markers: UnknownQueueStart[]; releases: QueueReleaseIntent[] }> {
  const store = await current(), items = markers(store, keyFor(hostId, threadId)), intents = intentMap(store);
  const releases = items.flatMap(marker => {
    const sent = intent(intents[releaseKey(hostId, threadId, marker)], marker);
    return sent === undefined ? [] : [{ marker, sent }];
  });
  return structuredClone({ markers: items, releases });
}
export async function addUnknownQueueStart(hostId: string, threadId: string, marker: UnknownQueueStart): Promise<UnknownQueueStart[]> {
  const key = keyFor(hostId, threadId);
  const result = await updateBrowserAtom(queueUnknownAtomKey, previous => {
    const store = previous === undefined ? importLegacy() : repository(previous);
    const existing = markers(store, key);
    if (existing.some(item => item.id === marker.id)) throw new Error('此消息已有未确认的发送记录。');
    return { ...store, queues: { ...store.queues, [key]: [...existing, marker] } };
  });
  return structuredClone(markers(repository(result), key));
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
