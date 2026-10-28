import { sendThreadKey } from './send-recovery.ts';

const key = 'yard-current-new-draft';
interface Identities { version: 1; legacyId: string | null; hosts: Record<string, string> }
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
function identities(storage: Storage): Identities {
  const raw = storage.getItem(key);
  if (!raw) return { version: 1, legacyId: null, hosts: {} };
  // The previous entry used one opaque UUID for every host. Keep it available
  // for hosts whose draft has not yet acquired a dedicated pointer.
  if (/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(raw)) return { version: 1, legacyId: raw, hosts: {} };
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('首页草稿身份无法读取，原记录已保留。'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('首页草稿身份无效，原记录已保留。');
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || !(record.legacyId === null || typeof record.legacyId === 'string')
    || !record.hosts || typeof record.hosts !== 'object' || Array.isArray(record.hosts)
    || Object.values(record.hosts).some(id => typeof id !== 'string' || !id)) throw new Error('首页草稿身份无效，原记录已保留。');
  return record as unknown as Identities;
}
function consumed(hostId: string, id: string, bindings: Record<string, string>) {
  return Object.entries(bindings).some(([thread, draft]) => {
    if (draft !== id) return false;
    try { const identity: unknown = JSON.parse(thread); return Array.isArray(identity) && identity.length === 2
      && typeof identity[1] === 'string' && thread === sendThreadKey(hostId, identity[1]); } catch { return false; }
  });
}
export function homeDraftIdentity(hostId: string, bindings: Record<string, string> = {}, storage: Storage = sessionStorage): string {
  const state = identities(storage), previous = Object.hasOwn(state.hosts, hostId) ? state.hosts[hostId] : state.legacyId;
  const id = previous && !consumed(hostId, previous, bindings) ? previous : crypto.randomUUID();
  if (state.hosts[hostId] !== id) storage.setItem(key, JSON.stringify({ ...state, hosts: { ...state.hosts, [hostId]: id } }));
  return id;
}
export function selectHomeDraftIdentity(hostId: string, id: string, storage: Storage = sessionStorage) {
  if (!hostId || !id) throw new Error('首页草稿身份不完整。');
  const state = identities(storage);
  storage.setItem(key, JSON.stringify({ ...state, hosts: { ...state.hosts, [hostId]: id } }));
}
