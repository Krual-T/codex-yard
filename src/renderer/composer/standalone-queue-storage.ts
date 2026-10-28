import { readBrowserAtom, updateBrowserAtom } from '../storage/ui-atoms.ts';

export interface UnknownQueueStart { id: string; clientUserMessageId: string; lockId: string }
interface Repository { version: 1; archive: Record<string, string>; queues: Record<string, unknown> }
export const queueUnknownAtomKey = 'codex-yard.queue-unknown.v2';
const legacyPrefix = 'codex-yard.queue-unknown.v1:';
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const keyFor = (hostId: string, threadId: string) => legacyPrefix + JSON.stringify([hostId, threadId]);
const same = (a: UnknownQueueStart, b: UnknownQueueStart) => a.id === b.id && a.clientUserMessageId === b.clientUserMessageId && a.lockId === b.lockId;

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
export async function removeUnknownQueueStart(hostId: string, threadId: string, marker: UnknownQueueStart): Promise<{ removed: boolean; markers: UnknownQueueStart[] }> {
  const key = keyFor(hostId, threadId);
  let removed = false;
  const result = await updateBrowserAtom(queueUnknownAtomKey, previous => {
    const store = previous === undefined ? importLegacy() : repository(previous);
    const existing = markers(store, key), next = existing.filter(item => !same(item, marker));
    removed = next.length !== existing.length;
    return { ...store, queues: { ...store.queues, [key]: next } };
  });
  return { removed, markers: structuredClone(markers(repository(result), key)) };
}
