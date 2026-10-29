import { isDeepStrictEqual } from 'node:util';
import type { CodexConnection } from '../../lib/codex.ts';
import { record } from './protocol.ts';

export interface QueueEditEntry { id: string; clientUserMessageId: string; input: Record<string, unknown>[] }
const validEntry = (value: unknown): value is QueueEditEntry => {
  const entry = record(value);
  return typeof entry.id === 'string' && !!entry.id && typeof entry.clientUserMessageId === 'string'
    && Array.isArray(entry.input) && entry.input.every(item => !!item && typeof item === 'object' && !Array.isArray(item));
};

/** Caller holds Yard's existing host/thread write interval. External CLI clients remain independent. */
export async function removeQueuedOriginal(connection: CodexConnection, threadId: string, expected: unknown,
  assertOriginal: () => void): Promise<'deleted' | 'changed'> {
  let candidate: QueueEditEntry | undefined;
  try {
    if (!threadId || !validEntry(expected)) throw new Error('原队列内容无效，未删除。');
    let cursor: string | null = null;
    const cursors = new Set<string>(), ids = new Set<string>();
    do {
      assertOriginal();
      const page = record(await connection.request('thread/queue/list', { threadId, limit: 100, cursor }));
      assertOriginal();
      if (!Array.isArray(page.data) || page.nextCursor !== null && typeof page.nextCursor !== 'string') throw new Error('队列读取无效，未删除。');
      for (const item of page.data) {
        if (!validEntry(item) || ids.has(item.id)) throw new Error('队列条目无效，未删除。');
        ids.add(item.id);
        if (item.id === expected.id) candidate = item;
      }
      cursor = page.nextCursor as string | null;
      if (cursor !== null && cursors.has(cursor)) throw new Error('队列游标没有前进，未删除。');
      if (cursor !== null) cursors.add(cursor);
    } while (cursor !== null);
    if (!candidate || !isDeepStrictEqual({ id: candidate.id, clientUserMessageId: candidate.clientUserMessageId, input: candidate.input }, expected)) return 'changed';
    assertOriginal();
  } catch (cause) {
    throw Object.assign(new Error(cause instanceof Error ? cause.message : String(cause), { cause }), { uncertain: false, sendPhase: 'before-send' });
  }
  const reply = record(await connection.request('thread/queue/delete', { threadId, queuedSubmissionId: candidate.id }, { mutating: true }));
  if (typeof reply.deleted !== 'boolean') throw Object.assign(new Error('队列删除回执无效，请保留原内容并核对。'), { uncertain: true });
  return reply.deleted ? 'deleted' : 'changed';
}
