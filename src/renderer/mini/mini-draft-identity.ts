import { sendThreadKey } from '../app/send-recovery.ts';

const storageKey = 'codex-yard.mini-draft-identities.v1';
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
const key = (hostId: string, threadId: string | null) => JSON.stringify([hostId, threadId]);

function read(storage: Storage): Record<string, string> {
  const raw = storage.getItem(storageKey);
  if (!raw) return {};
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('Mini 草稿身份无法读取，原记录已保留。'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.values(value).some(id => typeof id !== 'string' || !id.startsWith('mini:'))) {
    throw new Error('Mini 草稿身份无效，原记录已保留。');
  }
  return value as Record<string, string>;
}

/** Independent of the main composer's home and thread pointers. */
export function miniDraftIdentity(hostId: string, threadId: string | null, bindings: Record<string, string> = {}, storage: Storage = sessionStorage) {
  if (!hostId || threadId === '') throw new Error('Mini 草稿目标不完整。');
  const identities = read(storage), id = identities[key(hostId, threadId)];
  const consumed = threadId === null && id && Object.entries(bindings).some(([entry, draft]) => {
    if (draft !== id) return false;
    try { const value: unknown = JSON.parse(entry); return Array.isArray(value) && value[0] === hostId
      && typeof value[1] === 'string' && entry === sendThreadKey(hostId, value[1]); } catch { return false; }
  });
  if (id && !consumed) return id;
  const next = 'mini:' + crypto.randomUUID();
  storage.setItem(storageKey, JSON.stringify({ ...identities, [key(hostId, threadId)]: next }));
  return next;
}

/** Persist the original new-draft identity before exposing its created thread. */
export function rememberMiniCreatedDraft(hostId: string, threadId: string, draftId: string, storage: Storage = sessionStorage) {
  if (!hostId || !threadId || !draftId.startsWith('mini:')) throw new Error('Mini 新会话草稿身份无效。');
  const identities = read(storage), entry = key(hostId, threadId), previous = identities[entry];
  if (previous && previous !== draftId) throw new Error('Mini 会话已有另一份草稿，原输入已保留。');
  if (!previous) storage.setItem(storageKey, JSON.stringify({ ...identities, [entry]: draftId }));
}
