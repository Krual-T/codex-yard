import { findSentMessage } from './message-edit.ts';
import { record } from './protocol.ts';
import type { ObjectValue } from './protocol.ts';

interface Connection { request(method: string, params: ObjectValue): Promise<unknown> }

/** Queue entries may be consumed before the browser receives their add receipt. */
export async function findSubmission(connection: Connection, threadId: string, clientUserMessageId: string, action: 'send' | 'queue' | 'steer') {
  if (!threadId || !clientUserMessageId) throw new Error('核对提交需要原会话及请求身份。');
  if (action === 'queue') {
    const cursors = new Set<string>();
    let cursor: string | null = null;
    do {
      const page = record(await connection.request('thread/queue/list', { threadId, cursor, limit: 100 }));
      if (!Array.isArray(page.data) || page.data.some(value => typeof record(value).id !== 'string' || !record(value).id
        || typeof record(value).clientUserMessageId !== 'string' || !record(value).clientUserMessageId)) throw new Error('无法核对队列，原提交状态已保留。');
      const queued = page.data.find(value => record(value).clientUserMessageId === clientUserMessageId);
      if (queued) return { turnId: null, queuedSubmissionId: record(queued).id as string };
      if (page.nextCursor != null && typeof page.nextCursor !== 'string') throw new Error('队列游标无效，原提交状态已保留。');
      cursor = page.nextCursor as string | null | undefined ?? null;
      if (cursor !== null && cursors.has(cursor)) throw new Error('队列分页未前进，原提交状态已保留。');
      if (cursor !== null) cursors.add(cursor);
    } while (cursor !== null);
  }
  // Absence still cannot prove an in-flight add/steer/start was rejected.
  return findSentMessage(connection, threadId, clientUserMessageId);
}
