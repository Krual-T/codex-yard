import { record } from './protocol.ts';
import type { ObjectValue } from './protocol.ts';

const keys = ['unified-sidebar-project-order-v1', 'app-server-pinned-thread-order-v1', 'unified-sidebar-pinned-order-v1'];
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
interface Snapshot { projects: { id: string; hostId: string }[]; pins: { id: string; hostId: string }[]; aliases: Record<string, Record<string, string>> }
export class BrowserSidebarOrders {
  private storage: StorageLike;
  private request: (params: ObjectValue) => Promise<unknown>;
  private snapshot: Snapshot = { projects: [], pins: [], aliases: {} };
  private current: ObjectValue = {};
  private pending: Promise<unknown> = Promise.resolve();
  constructor(storage: StorageLike, request: (params: ObjectValue) => Promise<unknown>) { this.storage = storage; this.request = request; }
  owns(key: string) { return keys.includes(key); }
  value(key: string) { return this.current[key]; }
  private read(key: string): unknown { try { return JSON.parse(this.storage.getItem(key) || 'null'); } catch { return null; } }
  load(): Promise<ObjectValue> { return this.enqueue(async () => {
    this.snapshot = await this.request({ operation: 'snapshot' }) as Snapshot;
    const atoms = record(this.read('native-atoms'));
    for (const key of keys) this.current[key] = this.canonical(key, this.current[key] ?? atoms[key] ?? this.read('codex:persisted-atom:' + key));
    this.save(); return { ...this.current };
  }); }
  update(key: string, value: unknown): Promise<unknown> { return this.enqueue(async () => {
    if (key === keys[0]) {
      const values = this.strings(value).filter(key => key.startsWith('codex:project:')).map(key => key.slice('codex:project:'.length));
      await this.request({ operation: 'project-order', ids: values });
      this.snapshot = await this.request({ operation: 'snapshot' }) as Snapshot;
    }
    this.current[key] = this.canonical(key, value); this.save(); return this.current[key];
  }); }
  private enqueue<T>(action: () => Promise<T>): Promise<T> { const next = this.pending.catch(() => {}).then(action); this.pending = next; return next; }
  private strings(value: unknown): string[] { return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []; }
  private rows(key: string) { return key === keys[0] ? this.snapshot.projects : this.snapshot.pins; }
  private encode(key: string, id: string) { return key === keys[0] ? 'codex:project:' + id : key === keys[1] ? id : 'codex:thread:local:' + id; }
  private canonical(key: string, value: unknown): string[] {
    const rows = this.rows(key), owners = new Map(rows.map(row => [this.encode(key, row.id), row.hostId]));
    const aliases = new Map(Object.values(this.snapshot.aliases).flatMap(map => Object.entries(map)));
    const input = this.strings(value).map(item => key === keys[0] && item.startsWith('codex:project:')
      ? 'codex:project:' + (aliases.get(item.slice(14)) ?? item.slice(14)) : item);
    const remaining = new Map([...new Set(rows.map(row => row.hostId))].map(host => [host, rows.filter(row => row.hostId === host).map(row => this.encode(key, row.id))]));
    const result = input.map(item => { const host = owners.get(item); return host ? remaining.get(host)?.shift() : item; }).filter((v): v is string => !!v);
    result.push(...[...remaining.values()].flat());
    return [...new Set(result)];
  }
  private save() {
    const atoms = record(this.read('native-atoms'));
    for (const key of keys) {
      const rows = this.rows(key), owners = new Map(rows.map(row => [this.encode(key, row.id), row.hostId]));
      const values = this.strings(this.current[key]);
      const independent = new Set(values.map(value => owners.get(value) ?? 'navigation')).size > 1 || values.some(value => !owners.has(value));
      if (independent && values.length) atoms[key] = values; else delete atoms[key];
      this.storage.removeItem('codex:persisted-atom:' + key);
    }
    this.storage.setItem('native-atoms', JSON.stringify(atoms));
  }
}
