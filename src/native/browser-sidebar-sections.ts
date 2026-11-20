import { record } from './protocol.ts';
import type { ObjectValue } from './protocol.ts';

export const sectionAtom = 'sidebar-custom-sections-v3';
const preferencesKey = 'yard-sidebar-section-preferences-v1';
const legacyKey = 'codex:persisted-atom:' + sectionAtom;
const defaultAccount = 'yard-app-server';
interface Section { id: string; name: string; itemKeys: string[]; hostSectionIds?: Record<string, string>;
  pendingDeletionHostIdsByItemKey?: Record<string, string[]> }
interface Shape { sections: Section[]; collapsedSectionIds: string[]; sectionOrder: string[]; threadHostIds?: Record<string, string>;
  appServerMigratedHostIds?: string[]; appServerLegacySectionIds?: string[]; appServerDeletedSectionIds?: string[] }
interface Link { id: string; hostSectionIds: Record<string, string>; mixedItemKeys: string[]; name?: string;
  pendingDeletionHostIdsByItemKey?: Record<string, string[]>; legacyHostIds?: string[]; itemHostSlots?: (string | null)[] }
interface Preferences { links: Link[]; collapsedSectionIds: string[]; sectionOrder: string[] }
interface NativeSection { id: string; name: string; appearance: unknown; threadIds: string[] }
export interface ProjectSection { id: string; name: string; projectIds: string[] }
export type ProjectSectionDestination = { id: string } | { name: string } | null;
const projectKeyPrefix = 'codex:project:';
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
const threadId = (key: string) => key.startsWith('codex:thread:local:') ? key.slice('codex:thread:local:'.length) : null;
function shape(value: unknown): Shape {
  const item = record(value);
  return { sections: (Array.isArray(item.sections) ? item.sections : []).flatMap(value => {
    const section = record(value);
    return typeof section.id === 'string' && typeof section.name === 'string' ? [{ id: section.id, name: section.name,
      itemKeys: strings(section.itemKeys), hostSectionIds: record(section.hostSectionIds) as Record<string, string>,
      ...(section.pendingDeletionHostIdsByItemKey == null ? {} : { pendingDeletionHostIdsByItemKey:
        Object.fromEntries(Object.entries(record(section.pendingDeletionHostIdsByItemKey)).map(([key, hosts]) => [key, strings(hosts)])) }) }] : [];
  }), collapsedSectionIds: strings(item.collapsedSectionIds), sectionOrder: strings(item.sectionOrder),
  threadHostIds: record(item.threadHostIds) as Record<string, string>,
  // These fields control the renderer's native migration/deletion protocol.
  // Dropping them makes a confirmed projection look like fresh legacy input.
  ...(item.appServerMigratedHostIds == null ? {} : { appServerMigratedHostIds: strings(item.appServerMigratedHostIds) }),
  ...(item.appServerLegacySectionIds == null ? {} : { appServerLegacySectionIds: strings(item.appServerLegacySectionIds) }),
  ...(item.appServerDeletedSectionIds == null ? {} : { appServerDeletedSectionIds: strings(item.appServerDeletedSectionIds) }) };
}
function sectionLink(section: Section): Link {
  const hostSectionIds = section.hostSectionIds ?? {}, mixedItemKeys = section.itemKeys.filter(key => threadId(key) === null);
  const pending = Object.fromEntries(Object.entries(section.pendingDeletionHostIdsByItemKey ?? {}).filter(([key, hosts]) => section.itemKeys.includes(key) && hosts.length));
  return { id: section.id, hostSectionIds, mixedItemKeys,
    ...(Object.keys(pending).length ? { pendingDeletionHostIdsByItemKey: pending } : {}),
    ...(mixedItemKeys.some(key => key.startsWith(projectKeyPrefix)) ||
        !Object.keys(hostSectionIds).length && (mixedItemKeys.length || Object.keys(pending).length) ? { name: section.name } : {}) };
}
function legacyShape(value: Shape, nativeHosts: Set<string>, links: Link[]): Shape {
  const sections = value.sections.flatMap(section => {
    const itemKeys = section.itemKeys.filter(key => { const id = threadId(key); return id && !nativeHosts.has(value.threadHostIds?.[id] ?? 'local') &&
      !Object.hasOwn(section.pendingDeletionHostIdsByItemKey ?? {}, key); });
    const hostSectionIds = Object.fromEntries(Object.entries(section.hostSectionIds ?? {}).filter(([host]) => !nativeHosts.has(host)));
    const pendingHosts = strings(links.find(link => link.id === section.id)?.legacyHostIds).filter(host => !nativeHosts.has(host));
    const empty = !section.itemKeys.length && !Object.keys(section.hostSectionIds ?? {}).length;
    return itemKeys.length || Object.keys(hostSectionIds).length || pendingHosts.length || empty ? [{ id: section.id, name: section.name, itemKeys, hostSectionIds }] : [];
  });
  const members = new Set(sections.flatMap(section => section.itemKeys.flatMap(key => { const id = threadId(key); return id ? [id] : []; })));
  const visible = new Set(sections.map(section => section.id));
  return { ...value, sections, threadHostIds: Object.fromEntries(Object.entries(value.threadHostIds ?? {}).filter(([id]) => members.has(id))),
    collapsedSectionIds: value.collapsedSectionIds.filter(id => visible.has(id)),
    sectionOrder: value.sectionOrder.filter(key => !key.startsWith('custom:') || visible.has(key.slice(7))),
    appServerMigratedHostIds: strings(value.appServerMigratedHostIds).filter(host => nativeHosts.has(host)) };
}
function legacyLinks(sections: Section[], legacy: Shape, previous: Link[], nativeHosts: Set<string>, threadHosts: Record<string, string> = {}): Link[] {
  return sections.map(section => {
    const link = sectionLink(section), pending = legacy.sections.find(value => value.id === section.id);
    const slots = section.itemKeys.map(key => { const id = threadId(key); return id ? threadHosts[id] ?? 'local' : null; });
    // Cross-host/navigation placement is independent of each backend's member
    // order. Store host slots, never another list of native thread identities.
    if (new Set(slots).size > 1) link.itemHostSlots = slots;
    if (!pending) return link;
    const hosts = new Set([...Object.keys(pending.hostSectionIds ?? {}), ...strings(previous.find(value => value.id === section.id)?.legacyHostIds),
      ...pending.itemKeys.flatMap(key => { const id = threadId(key); return id ? [legacy.threadHostIds?.[id] ?? 'local'] : []; })].filter(host => !nativeHosts.has(host)));
    if (hosts.size) link.legacyHostIds = [...hosts];
    return link;
  });
}
function mergeAnonymous<T>(values: Record<string, T>, merge: (old: T, current: T) => T) {
  if (Object.hasOwn(values, '')) {
    values[defaultAccount] = Object.hasOwn(values, defaultAccount) ? merge(values['']!, values[defaultAccount]!) : values['']!;
    delete values[''];
  }
  return values;
}
function mergeShapes(oldValue: unknown, currentValue: unknown): Shape {
  const old = shape(oldValue), current = shape(currentValue);
  const sections = new Map(old.sections.map(section => [section.id, section]));
  for (const section of current.sections) {
    const previous = sections.get(section.id);
    sections.set(section.id, { ...section, itemKeys: [...new Set([...section.itemKeys, ...(previous?.itemKeys ?? [])])],
      hostSectionIds: { ...previous?.hostSectionIds, ...section.hostSectionIds } });
  }
  return { sections: [...sections.values()], collapsedSectionIds: [...new Set([...current.collapsedSectionIds, ...old.collapsedSectionIds])],
    sectionOrder: [...new Set([...current.sectionOrder, ...old.sectionOrder])], threadHostIds: { ...old.threadHostIds, ...current.threadHostIds },
    appServerMigratedHostIds: strings(old.appServerMigratedHostIds).filter(host => strings(current.appServerMigratedHostIds).includes(host)),
    ...(old.appServerLegacySectionIds == null && current.appServerLegacySectionIds == null ? {} : {
      appServerLegacySectionIds: [...new Set([...(old.appServerLegacySectionIds ?? []), ...(current.appServerLegacySectionIds ?? [])])] }),
    ...(old.appServerDeletedSectionIds == null && current.appServerDeletedSectionIds == null ? {} : {
      appServerDeletedSectionIds: [...new Set([...(old.appServerDeletedSectionIds ?? []), ...(current.appServerDeletedSectionIds ?? [])])] }) };
}
function mergePreferences(old: Preferences, current: Preferences): Preferences {
  const links = new Map(old.links.map(link => [link.id, link]));
  for (const link of current.links) {
    const previous = links.get(link.id);
    links.set(link.id, { ...link, hostSectionIds: { ...previous?.hostSectionIds, ...link.hostSectionIds },
      mixedItemKeys: [...new Set([...link.mixedItemKeys, ...(previous?.mixedItemKeys ?? [])])], name: link.name ?? previous?.name,
      ...(previous?.pendingDeletionHostIdsByItemKey || link.pendingDeletionHostIdsByItemKey ? {
        pendingDeletionHostIdsByItemKey: { ...previous?.pendingDeletionHostIdsByItemKey, ...link.pendingDeletionHostIdsByItemKey } } : {}),
      ...(previous?.legacyHostIds || link.legacyHostIds ? { legacyHostIds: [...new Set([...strings(previous?.legacyHostIds), ...strings(link.legacyHostIds)])] } : {}),
      ...(previous?.itemHostSlots || link.itemHostSlots ? { itemHostSlots: link.itemHostSlots ?? previous?.itemHostSlots } : {}) });
  }
  return { links: [...links.values()], collapsedSectionIds: [...new Set([...current.collapsedSectionIds, ...old.collapsedSectionIds])],
    sectionOrder: [...new Set([...current.sectionOrder, ...old.sectionOrder])] };
}

/** Thread groups live on each app-server. Only grouping across hosts, mixed
 * navigation items and display preferences need a browser storage contract. */
export class BrowserSidebarSections {
  private current: Record<string, Shape> = {};
  private preferences: Record<string, Preferences>;
  private legacy: Record<string, unknown>;
  private snapshots = new Map<string, NativeSection[]>();
  private pending: Promise<unknown> = Promise.resolve();
  private storage: StorageLike;
  private request: (params: ObjectValue) => Promise<unknown>;
  private hosts: () => string[];
  constructor(storage: StorageLike, request: (params: ObjectValue) => Promise<unknown>, hosts: () => string[]) {
    this.storage = storage; this.request = request; this.hosts = hosts;
    this.preferences = mergeAnonymous(record(this.read(preferencesKey)) as Record<string, Preferences>, mergePreferences);
    this.legacy = mergeAnonymous({ ...record(this.read(legacyKey)), ...record(record(this.read('native-atoms'))[sectionAtom]) }, mergeShapes);
    this.current = Object.fromEntries(Object.entries(this.legacy).map(([account, value]) => [account, shape(value)]));
  }
  private read(key: string): unknown { try { return JSON.parse(this.storage.getItem(key) || '{}'); } catch { return {}; } }
  value() {
    const value = structuredClone(this.current);
    // Temporary read compatibility for a renderer that has not resolved its
    // account identity yet. This alias is never persisted as another account.
    if (value[defaultAccount]) value[''] = structuredClone(value[defaultAccount]);
    return value;
  }
  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const task = this.pending.catch(() => {}).then(action); this.pending = task; return task;
  }
  load(): Promise<Record<string, Shape>> { return this.enqueue(() => this.hydrate()); }
  projectSections(): ProjectSection[] {
    const saved = this.current[defaultAccount];
    const preferences = this.preferences[defaultAccount];
    const keys = new Map(saved?.sections.map(section => [section.id, section]));
    // Browser-only project placements can be shown from disk before a host connects.
    for (const link of preferences?.links ?? []) if (!keys.has(link.id) && link.name) {
      keys.set(link.id, { id: link.id, name: link.name, itemKeys: link.mixedItemKeys });
    }
    const order = saved?.sectionOrder ?? preferences?.sectionOrder ?? [];
    const ids = new Set([...order.filter(key => key.startsWith('custom:')).map(key => key.slice(7)), ...keys.keys()]);
    return [...ids].flatMap(id => {
      const section = keys.get(id);
      return section ? [{ id, name: section.name, projectIds: section.itemKeys.flatMap(key =>
        key.startsWith(projectKeyPrefix) ? [key.slice(projectKeyPrefix.length)] : []) }] : [];
    });
  }
  moveProject(projectId: string, destination: ProjectSectionDestination): Promise<ProjectSection[]> {
    return this.enqueue(async () => {
      // Load the same projection used by the original renderer before changing its mixed entries.
      await this.hydrate();
      const state = this.current[defaultAccount] ?? shape(null);
      const key = projectKeyPrefix + projectId;
      const sections = state.sections.map(section => ({ ...section, itemKeys: section.itemKeys.filter(item => item !== key) }));
      let sectionId: string | undefined;
      if (destination && 'id' in destination) {
        const target = sections.find(section => section.id === destination.id);
        if (!target) throw new Error('This section no longer exists.');
        target.itemKeys.push(key);
      } else if (destination) {
        const name = destination.name.trim();
        if (!name || name.length > 120) throw new Error('Enter a valid section name.');
        sectionId = crypto.randomUUID();
        sections.push({ id: sectionId, name, itemKeys: [key] });
      }
      const sectionOrder = sectionId ? [...state.sectionOrder, 'custom:' + sectionId] : state.sectionOrder;
      this.replaceValue({ ...this.current, [defaultAccount]: { ...state, sections, sectionOrder } });
      return this.projectSections();
    });
  }
  retainHosts(hostIds: string[]): Promise<Record<string, Shape>> {
    return this.enqueue(async () => {
      const retained = new Set(['local', ...hostIds]);
      for (const host of this.snapshots.keys()) if (!retained.has(host)) this.snapshots.delete(host);
      const prune = (value: unknown): Shape => {
        const old = shape(value);
        const threadHosts = Object.fromEntries(Object.entries(old.threadHostIds ?? {}).filter(([, host]) => retained.has(host)));
        const sections = old.sections.flatMap(section => {
          const before = Object.keys(section.hostSectionIds ?? {});
          const hostSectionIds = Object.fromEntries(Object.entries(section.hostSectionIds ?? {}).filter(([host]) => retained.has(host)));
          const itemKeys = section.itemKeys.filter(key => { const id = threadId(key); return !id || retained.has(old.threadHostIds?.[id] ?? 'local'); });
          const pendingDeletionHostIdsByItemKey = section.pendingDeletionHostIdsByItemKey == null ? undefined : Object.fromEntries(
            Object.entries(section.pendingDeletionHostIdsByItemKey).flatMap(([key, hosts]) => {
              const pending = hosts.filter(host => retained.has(host));
              return itemKeys.includes(key) && pending.length ? [[key, pending]] : [];
            }));
          return before.some(host => !retained.has(host)) && !Object.keys(hostSectionIds).length && !itemKeys.length ? [] : [{ ...section, hostSectionIds, itemKeys,
            ...(pendingDeletionHostIdsByItemKey ? { pendingDeletionHostIdsByItemKey } : {}) }];
        });
        const visible = new Set(sections.map(section => section.id));
        return { ...old, sections, threadHostIds: threadHosts, collapsedSectionIds: old.collapsedSectionIds.filter(id => visible.has(id)),
          sectionOrder: old.sectionOrder.filter(key => !key.startsWith('custom:') || visible.has(key.slice(7))),
          appServerMigratedHostIds: strings(record(value).appServerMigratedHostIds).filter(host => retained.has(host)),
          appServerLegacySectionIds: strings(record(value).appServerLegacySectionIds).filter(id => visible.has(id)) };
      };
      for (const [account, value] of Object.entries(this.current)) this.current[account] = prune(value);
      for (const [account, value] of Object.entries(this.legacy)) {
        const next = prune(value);
        if (next.sections.length) this.legacy[account] = next; else delete this.legacy[account];
      }
      for (const [account, current] of Object.entries(this.current)) {
        const prefs = this.preferences[account] ??= { links: current.sections.map(sectionLink),
          collapsedSectionIds: current.collapsedSectionIds, sectionOrder: current.sectionOrder };
        for (const section of current.sections) if (!Object.keys(section.hostSectionIds ?? {}).length && section.itemKeys.some(key => threadId(key) === null) &&
          !prefs.links.some(link => link.id === section.id)) prefs.links.push(sectionLink(section));
      }
      for (const [account, prefs] of Object.entries(this.preferences)) {
        prefs.links = prefs.links.flatMap(link => {
          const before = Object.keys(link.hostSectionIds);
          const hostSectionIds = Object.fromEntries(Object.entries(link.hostSectionIds).filter(([host]) => retained.has(host)));
          const pending = Object.fromEntries(Object.entries(link.pendingDeletionHostIdsByItemKey ?? {}).flatMap(([key, hosts]) => {
            const pending = hosts.filter(host => retained.has(host)); return pending.length ? [[key, pending]] : [];
          }));
          const legacyHostIds = strings(link.legacyHostIds).filter(host => retained.has(host));
          if ((before.some(host => !retained.has(host)) || strings(link.legacyHostIds).some(host => !retained.has(host))) && !Object.keys(hostSectionIds).length &&
            !link.mixedItemKeys.length && !Object.keys(pending).length && !legacyHostIds.length) return [];
          const current = this.current[account]?.sections.find(section => section.id === link.id);
          const next = sectionLink({ id: link.id, name: current?.name ?? link.name ?? '', hostSectionIds,
            itemKeys: [...link.mixedItemKeys, ...Object.keys(pending)], pendingDeletionHostIdsByItemKey: pending });
          if (legacyHostIds.length) next.legacyHostIds = legacyHostIds;
          const slots = link.itemHostSlots?.filter(host => host === null || retained.has(host));
          if (slots && new Set(slots).size > 1) next.itemHostSlots = slots;
          return [next];
        });
        const visible = new Set(prefs.links.map(link => link.id));
        prefs.collapsedSectionIds = prefs.collapsedSectionIds.filter(id => visible.has(id));
        prefs.sectionOrder = prefs.sectionOrder.filter(key => !key.startsWith('custom:') || visible.has(key.slice(7)));
      }
      this.save();
      return this.value();
    });
  }
  private async hydrate() {
    const accounts = new Set([...Object.keys(this.preferences), ...Object.keys(this.legacy), ...Object.keys(this.current)]);
    // Also serve a shared projection before an account identity is available.
    accounts.add(defaultAccount);
    const hosts = [...new Set(this.hosts())];
    const refreshed = new Set<string>();
    for (const hostId of hosts) {
      const previousLegacy = structuredClone(this.legacy);
      try {
        const desired = [...accounts].flatMap(account => {
          const old = shape(this.legacy[account]);
          if (strings(record(this.legacy[account]).appServerMigratedHostIds).includes(hostId)) return [];
          return old.sections.flatMap(section => {
            const independent = this.preferences[account]?.links.find(link => link.id === section.id && link.name && !Object.keys(link.hostSectionIds).length);
            if (independent && section.itemKeys.every(key => threadId(key) === null || Object.hasOwn(independent.pendingDeletionHostIdsByItemKey ?? {}, key))) return [];
            const owners = section.itemKeys.flatMap(key => { const id = threadId(key); return id ? [old.threadHostIds?.[id] ?? 'local'] : []; });
            const pendingHosts = strings(this.preferences[account]?.links.find(link => link.id === section.id)?.legacyHostIds);
            const owns = owners.includes(hostId) || pendingHosts.includes(hostId) || Object.hasOwn(section.hostSectionIds ?? {}, hostId) ||
              !owners.length && !pendingHosts.length && !Object.keys(section.hostSectionIds ?? {}).length && hostId === 'local';
            return owns ? [{ id: section.hostSectionIds?.[hostId] ?? section.id, name: section.name, appearance: null,
              threadIds: section.itemKeys.flatMap(key => { const id = threadId(key); return id && (old.threadHostIds?.[id] ?? 'local') === hostId ? [id] : []; }) }] : [];
          });
        });
        // Backend snapshots always override an imported name/member projection.
        if (desired.length) {
          const result = record(await this.request({ hostId, operation: 'merge', sections: [...new Map(desired.map(s => [s.id, s])).values()] }));
          const mappings = record(result.sectionIds);
          for (const account of accounts) {
            const old = shape(this.legacy[account]);
            if (!Object.hasOwn(this.legacy, account)) continue;
            for (const section of old.sections) {
              const id = section.hostSectionIds?.[hostId] ?? section.id;
              if (typeof mappings[id] === 'string') section.hostSectionIds = { ...section.hostSectionIds, [hostId]: mappings[id] };
            }
            this.legacy[account] = { ...old, appServerMigratedHostIds: [...new Set([
              ...strings(record(this.legacy[account]).appServerMigratedHostIds), hostId])] };
          }
        }
        const snapshot = record(await this.request({ hostId, operation: 'snapshot' }));
        if (!Array.isArray(snapshot.sections)) throw new Error('后端未返回会话分组快照');
        this.snapshots.set(hostId, snapshot.sections as NativeSection[]);
        refreshed.add(hostId);
      } catch (error) {
        this.legacy = previousLegacy;
        if (hostId === 'local') throw error;
        console.warn('远端会话分组读取失败，保留已有视图', hostId, error);
      }
    }
    for (const account of accounts) {
      const old = shape(this.legacy[account]), prefs = this.preferences[account];
      const previous = this.current[account];
      const deleted = new Set(previous?.appServerDeletedSectionIds);
      const confirmed = new Set([...refreshed, ...strings(old.appServerMigratedHostIds).filter(host => this.snapshots.has(host))]);
      const links: Link[] = structuredClone(prefs?.links ?? old.sections.map(sectionLink));
      // Import can finish independently on each connected host.
      for (const section of old.sections) {
        let link = links.find(link => link.id === section.id);
        if (!link) { link = sectionLink(section); links.push(link); }
        Object.assign(link.hostSectionIds, section.hostSectionIds);
      }
      const sections: Section[] = [];
      const threadHosts: Record<string, string> = {};
      for (const [hostId, native] of this.snapshots) for (const section of native) {
        if (deleted.has(section.id)) continue;
        let link = links.find(link => link.hostSectionIds[hostId] === section.id);
        if (!link) { link = { id: section.id, hostSectionIds: { [hostId]: section.id }, mixedItemKeys: [] }; links.push(link); }
        let projected = sections.find(value => value.id === link!.id);
        if (!projected) { projected = { id: link.id, name: section.name, hostSectionIds: { ...link.hostSectionIds }, itemKeys: [...link.mixedItemKeys] }; sections.push(projected); }
        projected.itemKeys.push(...section.threadIds.map(id => { threadHosts[id] = hostId; return 'codex:thread:local:' + id; }));
      }
      for (const link of links) if (link.name && !Object.keys(link.hostSectionIds).length && (link.mixedItemKeys.length || Object.keys(link.pendingDeletionHostIdsByItemKey ?? {}).length) && !sections.some(section => section.id === link.id)) {
        sections.push({ id: link.id, name: link.name, hostSectionIds: {}, itemKeys: [...link.mixedItemKeys] });
      }
      for (const section of old.sections) {
        const pendingItems = section.itemKeys.filter(key => { const id = threadId(key); return id && !confirmed.has(old.threadHostIds?.[id] ?? 'local'); });
        const pendingHosts = [...Object.keys(section.hostSectionIds ?? {}), ...strings(links.find(link => link.id === section.id)?.legacyHostIds)].filter(host => !confirmed.has(host));
        if (!pendingItems.length && !pendingHosts.length && (section.itemKeys.length || Object.keys(section.hostSectionIds ?? {}).length)) continue;
        let projected = sections.find(value => value.id === section.id);
        if (!projected) { projected = { ...section, itemKeys: section.itemKeys.filter(key => threadId(key) === null) }; sections.push(projected); }
        else if (!Object.keys(projected.hostSectionIds ?? {}).some(host => refreshed.has(host))) projected.name = section.name;
        projected.itemKeys = [...new Set([...projected.itemKeys, ...pendingItems])];
        for (const key of pendingItems) { const id = threadId(key)!; threadHosts[id] = old.threadHostIds?.[id] ?? 'local'; }
      }
      for (const section of sections) {
        const link = links.find(link => link.id === section.id), pending = link?.pendingDeletionHostIdsByItemKey;
        if (pending) {
          section.pendingDeletionHostIdsByItemKey = structuredClone(pending);
          section.itemKeys = [...new Set([...section.itemKeys, ...Object.keys(pending)])];
        }
        if (link?.itemHostSlots) {
          const remaining = new Map<string | null, string[]>();
          for (const key of section.itemKeys) {
            const id = threadId(key), host = id ? threadHosts[id] ?? 'local' : null;
            remaining.set(host, [...(remaining.get(host) ?? []), key]);
          }
          const ordered = link.itemHostSlots.flatMap(host => { const key = remaining.get(host)?.shift(); return key ? [key] : []; });
          section.itemKeys = [...ordered, ...[...remaining.values()].flat()];
        }
      }
      const visible = new Set(sections.map(section => section.id));
      const order = prefs?.sectionOrder ?? old.sectionOrder;
      const collapsed = prefs?.collapsedSectionIds ?? old.collapsedSectionIds;
      this.current[account] = { sections, collapsedSectionIds: collapsed.filter(id => visible.has(id)),
        sectionOrder: [...order.filter(key => !key.startsWith('custom:') || visible.has(key.slice(7))),
          ...sections.map(s => 'custom:' + s.id).filter(key => !order.includes(key))], threadHostIds: threadHosts,
        appServerMigratedHostIds: [...new Set([...this.snapshots.keys(), ...(previous?.appServerMigratedHostIds ?? [])])], appServerLegacySectionIds: [],
        ...(previous?.appServerDeletedSectionIds == null ? {} : { appServerDeletedSectionIds: [...deleted] }) };
      const remaining = legacyShape({ ...old, sections: old.sections.filter(section => visible.has(section.id)).map(section => ({ ...section,
        name: sections.find(value => value.id === section.id)?.name ?? section.name })) }, confirmed, links);
      this.preferences[account] = { links: legacyLinks(sections, remaining, links, confirmed, threadHosts),
        collapsedSectionIds: this.current[account].collapsedSectionIds, sectionOrder: this.current[account].sectionOrder };
      // Leave unreachable hosts as migration input. Reconnect retries them.
      if (remaining.sections.length) this.legacy[account] = remaining; else delete this.legacy[account];
    }
    this.save();
    return this.value();
  }
  replace(value: unknown): Promise<Record<string, Shape>> {
    return this.enqueue(() => Promise.resolve(this.replaceValue(value)));
  }
  private replaceValue(value: unknown) {
    const input = record(value);
    const next = Object.fromEntries(Object.entries(input).filter(([account]) => account !== '' || !Object.hasOwn(input, defaultAccount))
      .map(([account, value]) => [account || defaultAccount, shape(value)]));
    for (const [account, wanted] of Object.entries(next)) {
      const nativeHosts = new Set(this.hosts().filter(host => this.snapshots.has(host)));
      const oldLinks = this.preferences[account]?.links ?? [];
      const unconfirmed = legacyShape(wanted, nativeHosts, oldLinks);
      this.preferences[account] = { links: legacyLinks(wanted.sections, unconfirmed, oldLinks, nativeHosts, wanted.threadHostIds),
        collapsedSectionIds: wanted.collapsedSectionIds, sectionOrder: wanted.sectionOrder };
      // Hosts without native snapshots still own browser grouping state,
      // including their members inside a group shared with native hosts.
      if (unconfirmed.sections.length) this.legacy[account] = unconfirmed;
      else delete this.legacy[account];
      this.current[account] = wanted;
    }
    this.save();
    return this.value();
  }
  private save() {
    this.storage.setItem(preferencesKey, JSON.stringify(this.preferences));
    const atoms = record(this.read('native-atoms'));
    if (Object.keys(this.legacy).length) atoms[sectionAtom] = this.legacy; else delete atoms[sectionAtom];
    this.storage.setItem('native-atoms', JSON.stringify(atoms));
    this.storage.removeItem(legacyKey);
  }
}
