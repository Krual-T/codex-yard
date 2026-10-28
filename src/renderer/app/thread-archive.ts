import type { WorkbenchClient } from '../workbench-contract.ts';

/** The URL and saved tabs are hints; the selected host owns archive status. */
export async function readThreadArchived(client: WorkbenchClient, identity: { hostId: string; threadId: string }): Promise<boolean> {
  let cursor: string | null = null;
  const seen = new Set<string>();
  do {
    const page: { data: { id: string }[]; nextCursor?: string | null } = await client.rpc('thread/list',
      { archived: true, limit: 100, cursor, sortKey: 'updated_at' }, identity.hostId);
    if (!Array.isArray(page.data) || page.data.some(row => typeof row?.id !== 'string')
      || page.nextCursor != null && typeof page.nextCursor !== 'string') throw new Error('归档列表回执无效，未猜测会话状态。');
    if (page.data.some(row => row.id === identity.threadId)) return true;
    cursor = page.nextCursor ?? null;
    if (cursor && seen.has(cursor)) throw new Error('归档列表分页游标重复，未猜测会话状态。');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return false;
}
