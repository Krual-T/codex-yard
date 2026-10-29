import { record } from './protocol.ts';
interface Connection { request(method: string, params: Record<string, unknown>): Promise<unknown>; assertCurrent?(): void }
/** Only complete current+archived inventories across all registered hosts resolve bare IDs. */
export function createThreadProjectInventory(hostIds: readonly string[], connectionFor: (hostId: string) => Promise<Connection>) {
  let known: Map<string, Set<string>> | null = null;
  let refreshing: Promise<{ complete: boolean; errors: Record<string, string> }> | null = null;
  let errors: Record<string, string> = Object.create(null);
  let sources: { hostId: string; connection: Connection }[] = [];
  const compatibility = { resolveLegacyThreadHosts: (id: string) => known ? [...known.get(id) ?? []] : undefined };
  function verify() {
    for (const { hostId, connection } of sources) try { connection.assertCurrent?.(); }
    catch (error) { errors[hostId] = error instanceof Error ? error.message : String(error); }
    if (Object.keys(errors).length) known = null;
    return { complete: known !== null, errors: { ...errors } };
  }
  function refresh() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const candidate = new Map<string, Set<string>>();
      errors = Object.create(null); sources = []; known = null;
      await Promise.all(hostIds.map(async hostId => {
        try {
          const connection = await connectionFor(hostId);
          sources.push({ hostId, connection });
          for (const archived of [false, true]) {
            let cursor: string | null = null;
            const seen = new Set<string>();
            do {
              connection.assertCurrent?.();
              const page = record(await connection.request('thread/list', { archived, limit: 100, cursor }));
              connection.assertCurrent?.();
              if (!Array.isArray(page.data)) throw new Error('会话目录响应无效');
              for (const value of page.data) {
                const id = record(value).id;
                if (typeof id !== 'string') throw new Error('会话目录缺少身份');
                const hosts = candidate.get(id) ?? new Set<string>(); hosts.add(hostId); candidate.set(id, hosts);
              }
              if (page.nextCursor !== undefined && page.nextCursor !== null && typeof page.nextCursor !== 'string') throw new Error('会话目录游标无效');
              cursor = typeof page.nextCursor === 'string' && page.nextCursor ? page.nextCursor : null;
              if (cursor && seen.has(cursor)) throw new Error('会话目录分页未前进');
              if (cursor) seen.add(cursor);
            } while (cursor);
          }
        } catch (error) { errors[hostId] = error instanceof Error ? error.message : String(error); }
      }));
      known = Object.keys(errors).length ? null : candidate;
      return verify();
    })().finally(() => { refreshing = null; });
    return refreshing;
  }
  return { compatibility, refresh, verify };
}
