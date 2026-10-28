import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkbenchClient } from '../workbench-contract.ts';
import { createId } from './standalone-draft.ts';

interface QueueEntry { id: string; clientUserMessageId: string; input: Record<string, unknown>[] }
interface UnknownStart { id: string; clientUserMessageId: string; lockId: string }
interface QueueProps { client: WorkbenchClient; hostId: string; threadId: string; busy: boolean; refreshVersion: number; onStartQueued?: (id: string) => Promise<void> }
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
      if (typeof item.id !== 'string' || typeof item.clientUserMessageId !== 'string' || !Array.isArray(item.input) || item.input.some(input => !input || typeof input !== 'object' || Array.isArray(input))) {
        throw new Error('队列条目响应无效');
      }
      if (ids.has(item.id)) throw new Error('队列列表包含重复条目');
      ids.add(item.id);
      entries.push({ id: item.id, clientUserMessageId: item.clientUserMessageId, input: item.input.map(record) });
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
function unknownKey(hostId: string, threadId: string): string {
  return 'codex-yard.queue-unknown.v1:' + JSON.stringify([hostId, threadId]);
}
function readUnknown(key: string): UnknownStart[] | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const values: unknown = JSON.parse(raw);
    if (!Array.isArray(values)) return null;
    const result: UnknownStart[] = [];
    for (const value of values) {
      const item = record(value);
      if (typeof item.id !== 'string' || typeof item.clientUserMessageId !== 'string' || typeof item.lockId !== 'string') return null;
      result.push({ id: item.id, clientUserMessageId: item.clientUserMessageId, lockId: item.lockId });
    }
    return result;
  } catch { return null; }
}
async function historyClientIds(client: WorkbenchClient, hostId: string, threadId: string, wanted: Set<string>): Promise<Set<string>> {
  const found = new Set<string>(), cursors = new Set<string>();
  let cursor: string | null = null;
  for (let pageNumber = 0; pageNumber < 20 && found.size < wanted.size; pageNumber++) {
    const page = record(await client.rpc('thread/items/list', { threadId, limit: 100, sortDirection: 'desc', ...(cursor ? { cursor } : {}) }, hostId));
    if (!Array.isArray(page.data)) throw new Error('会话历史响应无效');
    for (const entry of page.data) {
      const item = record(record(entry).item);
      if (item.type === 'userMessage' && typeof item.clientId === 'string' && wanted.has(item.clientId)) found.add(item.clientId);
    }
    cursor = typeof page.nextCursor === 'string' && page.nextCursor ? page.nextCursor : null;
    if (!cursor) break;
    if (cursors.has(cursor)) throw new Error('会话历史分页重复');
    cursors.add(cursor);
  }
  return found;
}
export function StandaloneQueue({ client, hostId, threadId, busy, refreshVersion, onStartQueued }: QueueProps) {
  const markerKey = unknownKey(hostId, threadId);
  const [initialUnknown] = useState(() => readUnknown(markerKey));
  const [unknown, setUnknown] = useState<UnknownStart[]>(initialUnknown ?? []);
  const unknownRef = useRef<UnknownStart[]>(unknown);
  const storageAvailable = useRef(initialUnknown !== null);
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [edit, setEdit] = useState<{ id: string; text: string } | null>(null);
  const generation = useRef(0);
  const mutation = useRef(false);
  const saveUnknown = useCallback((next: UnknownStart[]): boolean => {
    try {
      localStorage.setItem(markerKey, JSON.stringify(next));
      unknownRef.current = next; setUnknown(next); storageAvailable.current = true;
      return true;
    } catch { storageAvailable.current = false; return false; }
  }, [markerKey]);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    try {
      const next = await list(client, hostId, threadId);
      if (current !== generation.current) return;
      setEntries(next);
      const unresolved = unknownRef.current.filter(marker => !next.some(entry => entry.id === marker.id));
      if (unresolved.length) {
        try {
          const found = await historyClientIds(client, hostId, threadId, new Set(unresolved.map(item => item.clientUserMessageId)));
          if (current !== generation.current) return;
          const confirmed = unresolved.filter(item => found.has(item.clientUserMessageId));
          if (confirmed.length && saveUnknown(unknownRef.current.filter(item => !confirmed.some(done => done.id === item.id)))) {
            for (const item of confirmed) void client.host('queued-follow-up-send-lock-release', {
              hostId, conversationId: threadId, messageId: item.id, lockId: item.lockId, sent: true,
            }).catch(() => {});
          }
        } catch { /* A missing or unavailable history cannot prove the outcome. */ }
      }
    } catch (reason) { if (current === generation.current) setError('无法读取队列：' + message(reason)); }
  }, [client, hostId, threadId, saveUnknown]);
  useEffect(() => {
    void refresh();
    const unsubscribe = client.subscribe(event => {
      if (event.type === 'mcp-notification' && event.hostId === hostId && event.method === 'thread/queue/changed'
        && record(event.params).threadId === threadId) void refresh();
      if (event.type === 'codex-app-server-connection-changed' && event.hostId === hostId && event.state === 'connected') void refresh();
    });
    const storageChanged = (event: StorageEvent) => {
      if (event.key !== markerKey) return;
      const next = readUnknown(markerKey);
      if (next === null) { storageAvailable.current = false; return; }
      storageAvailable.current = true; unknownRef.current = next; setUnknown(next); void refresh();
    };
    window.addEventListener('storage', storageChanged);
    return () => { generation.current++; unsubscribe(); window.removeEventListener('storage', storageChanged); };
  }, [client, hostId, threadId, markerKey, refresh, refreshVersion]);
  const run = async (action: () => Promise<void>) => {
    if (mutation.current) return;
    mutation.current = true; setPending(true); setError('');
    try { await action(); await refresh(); }
    catch (reason) { await refresh(); setError('操作未确认，请检查队列后再试：' + message(reason)); }
    finally { mutation.current = false; setPending(false); }
  };
  const start = (entry: QueueEntry) => run(async () => {
    if (!onStartQueued) throw new Error('会话控制器尚未提供队列发送');
    if (!storageAvailable.current || unknownRef.current.some(item => item.id === entry.id)) throw new Error('无法确认先前的发送结果');
    const request = { hostId, conversationId: threadId, messageId: entry.id, lockId: createId() };
    const result = await client.host<{ acquired: boolean }>('queued-follow-up-send-lock-acquire', request);
    if (!result.acquired) throw new Error('另一页面正在发送这条会话的消息');
    const marker = { id: entry.id, clientUserMessageId: entry.clientUserMessageId, lockId: request.lockId };
    if (!saveUnknown([...unknownRef.current, marker])) {
      await client.host('queued-follow-up-send-lock-release', { ...request, sent: false });
      throw new Error('无法保存发送状态，未启动队列消息');
    }
    let sent = false, release = false;
    try {
      await onStartQueued(entry.id);
      sent = true; release = true;
    } catch (reason) {
      const error = record(reason), data = record(error.data);
      release = error.uncertain === false || data.uncertain === false
        || typeof error.code === 'number' && error.uncertain !== true && data.uncertain !== true;
      if (!release) throw new Error('发送结果未知，请检查会话和队列；不会自动重发。', { cause: reason });
      throw reason;
    } finally {
      if (release) {
        saveUnknown(unknownRef.current.filter(item => item.id !== entry.id));
        await client.host('queued-follow-up-send-lock-release', { ...request, sent });
      }
    }
  });
  const reorder = (index: number, target: number) => run(async () => {
    const ids = entries.map(item => item.id);
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    await client.rpc('thread/queue/reorder', { threadId, queuedSubmissionIds: ids }, hostId);
  });
  if (!entries.length && !error && !unknown.length && storageAvailable.current) return null;
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
        <button type="button" title="上移" aria-label="上移待发送消息" disabled={pending || !!unknown.length || index === 0} onClick={() => void reorder(index, index - 1)}>↑</button>
        <button type="button" title="下移" aria-label="下移待发送消息" disabled={pending || !!unknown.length || index === entries.length - 1} onClick={() => void reorder(index, index + 1)}>↓</button>
        <button type="button" title="编辑" aria-label="编辑待发送消息" disabled={pending || unknown.some(item => item.id === entry.id) || editableText(entry) == null} onClick={() => setEdit({ id: entry.id, text: editableText(entry) ?? '' })}>编辑</button>
        <button type="button" title="删除" aria-label="删除待发送消息" disabled={pending || unknown.some(item => item.id === entry.id)} onClick={() => void run(async () => {
          const result = await client.rpc<{ deleted: boolean }>('thread/queue/delete', { threadId, queuedSubmissionId: entry.id }, hostId);
          if (!result.deleted) throw new Error('消息已不存在');
        })}>删除</button>
        <button type="button" title={busy ? '等待当前任务完成' : '立即发送'} aria-label="立即发送待发送消息" disabled={pending || busy || !onStartQueued || !storageAvailable.current || unknown.some(item => item.id === entry.id)} onClick={() => void start(entry)}>发送</button>
      </div>
    </div>)}
    {unknown.length ? <div role="status">{unknown.length} 条消息的发送结果未知。请检查会话；不会自动重发。<button type="button" onClick={() => void refresh()}>重新核对</button></div> : null}
    {!storageAvailable.current ? <div role="alert">无法读取或保存队列发送状态，已暂停发送。</div> : null}
    {error ? <div role="alert">{error}</div> : null}
  </section>;
}
