import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkbenchClient } from '../workbench-contract.ts';
import { createId } from './standalone-draft.ts';

interface QueueEntry { id: string; input: Record<string, unknown>[] }
interface QueueProps { client: WorkbenchClient; hostId: string; threadId: string; busy: boolean; refreshVersion: number }
function record(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
async function list(client: WorkbenchClient, hostId: string, threadId: string): Promise<QueueEntry[]> {
  const entries: QueueEntry[] = [], cursors = new Set<string>(), ids = new Set<string>();
  let cursor: string | null = null;
  do {
    const page = record(await client.rpc('thread/queue/list', { threadId, limit: 100, ...(cursor ? { cursor } : {}) }, hostId));
    if (!Array.isArray(page.data)) throw new Error('队列列表响应无效');
    for (const value of page.data) {
      const item = record(value);
      if (typeof item.id !== 'string' || !Array.isArray(item.input) || item.input.some(input => !input || typeof input !== 'object' || Array.isArray(input))) {
        throw new Error('队列条目响应无效');
      }
      if (ids.has(item.id)) throw new Error('队列列表包含重复条目');
      ids.add(item.id);
      entries.push({ id: item.id, input: item.input.map(record) });
    }
    cursor = typeof page.nextCursor === 'string' && page.nextCursor ? page.nextCursor : null;
    if (cursor && cursors.has(cursor)) throw new Error('队列列表分页重复');
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return entries;
}
function editableText(entry: QueueEntry): string | null {
  const text = entry.input.find(item => item.type === 'text');
  if (!text || typeof text.text !== 'string' || !Array.isArray(text.text_elements) || text.text_elements.length) return null;
  return text.text;
}
function summary(entry: QueueEntry): string {
  const text = entry.input.filter(item => item.type === 'text' && typeof item.text === 'string').map(item => item.text).join(' ');
  return text || (entry.input.length ? '附件消息' : '空消息');
}
export function StandaloneQueue({ client, hostId, threadId, busy, refreshVersion }: QueueProps) {
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [edit, setEdit] = useState<{ id: string; text: string } | null>(null);
  const generation = useRef(0);
  const mutation = useRef(false);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    try {
      const next = await list(client, hostId, threadId);
      if (current === generation.current) { setEntries(next); setError(''); }
    } catch (reason) { if (current === generation.current) setError('无法读取队列：' + message(reason)); }
  }, [client, hostId, threadId]);
  useEffect(() => {
    void refresh();
    const unsubscribe = client.subscribe(event => {
      if (event.type === 'mcp-notification' && event.hostId === hostId && event.method === 'thread/queue/changed'
        && record(event.params).threadId === threadId) void refresh();
      if (event.type === 'codex-app-server-connection-changed' && event.hostId === hostId && event.state === 'connected') void refresh();
    });
    return () => { generation.current++; unsubscribe(); };
  }, [client, hostId, threadId, refresh, refreshVersion]);
  const run = async (action: () => Promise<void>) => {
    if (mutation.current) return;
    mutation.current = true; setPending(true); setError('');
    try { await action(); await refresh(); }
    catch (reason) { await refresh(); setError('操作未确认，请检查队列后再试：' + message(reason)); }
    finally { mutation.current = false; setPending(false); }
  };
  const start = (id: string) => run(async () => {
    const request = { conversationId: threadId, messageId: id, lockId: createId() };
    const result = await client.host<{ acquired: boolean }>('queued-follow-up-send-lock-acquire', request);
    if (!result.acquired) throw new Error('另一页面正在发送这条会话的消息');
    let sent = false, release = false;
    try {
      await client.rpc('thread/queue/start', { threadId, queuedSubmissionId: id }, hostId);
      sent = true; release = true;
    } catch (reason) {
      const error = record(reason), data = record(error.data);
      release = error.uncertain === false || data.uncertain === false
        || typeof error.code === 'number' && error.uncertain !== true && data.uncertain !== true;
      if (!release) throw new Error('发送结果未知，锁将在超时后释放；请先检查会话。', { cause: reason });
      throw reason;
    } finally {
      if (release) await client.host('queued-follow-up-send-lock-release', { ...request, sent });
    }
  });
  const reorder = (index: number, target: number) => run(async () => {
    const ids = entries.map(item => item.id);
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    await client.rpc('thread/queue/reorder', { threadId, queuedSubmissionIds: ids }, hostId);
  });
  if (!entries.length && !error) return null;
  return <section className="standalone-queue" aria-label="待发送消息">
    <div className="standalone-queue__heading">待发送消息 <span>{entries.length}</span></div>
    {entries.map((entry, index) => <div className="standalone-queue__row" key={entry.id}>
      {edit?.id === entry.id ? <div className="standalone-queue__edit">
        <textarea aria-label="编辑待发送消息" value={edit.text} onChange={event => setEdit({ ...edit, text: event.target.value })} />
        <button type="button" disabled={pending || !edit.text.trim()} onClick={() => void run(async () => {
          const input = entry.input.map(item => item === entry.input.find(part => part.type === 'text') ? { ...item, text: edit.text } : item);
          await client.rpc('thread/queue/update', { threadId, queuedSubmissionId: entry.id, input }, hostId);
          setEdit(null);
        })}>保存</button><button type="button" disabled={pending} onClick={() => setEdit(null)}>取消</button>
      </div> : <span className="standalone-queue__text">{summary(entry)}</span>}
      <div className="standalone-queue__actions">
        <button type="button" title="上移" aria-label="上移待发送消息" disabled={pending || index === 0} onClick={() => void reorder(index, index - 1)}>↑</button>
        <button type="button" title="下移" aria-label="下移待发送消息" disabled={pending || index === entries.length - 1} onClick={() => void reorder(index, index + 1)}>↓</button>
        <button type="button" title="编辑" aria-label="编辑待发送消息" disabled={pending || editableText(entry) == null} onClick={() => setEdit({ id: entry.id, text: editableText(entry) ?? '' })}>编辑</button>
        <button type="button" title="删除" aria-label="删除待发送消息" disabled={pending} onClick={() => void run(async () => {
          const result = await client.rpc<{ deleted: boolean }>('thread/queue/delete', { threadId, queuedSubmissionId: entry.id }, hostId);
          if (!result.deleted) throw new Error('消息已不存在');
        })}>删除</button>
        <button type="button" title={busy ? '等待当前任务完成' : '立即发送'} aria-label="立即发送待发送消息" disabled={pending || busy} onClick={() => void start(entry.id)}>发送</button>
      </div>
    </div>)}
    {error ? <div role="alert">{error}</div> : null}
  </section>;
}
