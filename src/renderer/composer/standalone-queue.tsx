import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/index.tsx';
import type { I18n } from '../i18n/index.tsx';
import { subscribeBrowserAtoms } from '../storage/ui-atoms.ts';
import type { WorkbenchClient } from '../workbench-contract.ts';
import { createId } from './standalone-draft.ts';
import { addUnknownQueueStart, queueUnknownAtomKey, readUnknownQueueStarts, removeUnknownQueueStart } from './standalone-queue-storage.ts';
import type { UnknownQueueStart } from './standalone-queue-storage.ts';

interface QueueEntry { id: string; clientUserMessageId: string; input: Record<string, unknown>[] }
interface QueueProps { client: WorkbenchClient; hostId: string; threadId: string; busy: boolean; refreshVersion: number; onStartQueued?: (id: string) => Promise<void> }
function record(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
async function list(client: WorkbenchClient, hostId: string, threadId: string): Promise<QueueEntry[]> {
  const entries: QueueEntry[] = [], cursors = new Set<string>(), ids = new Set<string>();
  let cursor: string | null = null;
  do {
    const page = record(await client.rpc('thread/queue/list', { threadId, limit: 100, ...(cursor !== null ? { cursor } : {}) }, hostId));
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
    if (page.nextCursor !== null && typeof page.nextCursor !== 'string') throw new Error('队列分页响应无效');
    cursor = page.nextCursor;
    if (cursor !== null && cursors.has(cursor)) throw new Error('队列列表分页重复');
    if (cursor !== null) cursors.add(cursor);
  } while (cursor !== null);
  return entries;
}
function editableText(entry: QueueEntry): string | null {
  const text = entry.input.find(item => item.type === 'text');
  if (!text || typeof text.text !== 'string' || !Array.isArray(text.text_elements) || text.text_elements.length) return null;
  return text.text;
}
function summary(entry: QueueEntry, t: I18n['t']): string {
  const text = entry.input.filter(item => item.type === 'text' && typeof item.text === 'string').map(item => item.text).join(' ');
  return text || t(entry.input.length ? 'Attachment message' : 'Empty message');
}
async function historyClientIds(client: WorkbenchClient, hostId: string, threadId: string, wanted: Set<string>): Promise<Set<string>> {
  const found = new Set<string>(), cursors = new Set<string>();
  let cursor: string | null = null;
  for (let pageNumber = 0; pageNumber < 20 && found.size < wanted.size; pageNumber++) {
    const page = record(await client.rpc('thread/items/list', { threadId, limit: 100, sortDirection: 'desc', ...(cursor !== null ? { cursor } : {}) }, hostId));
    if (!Array.isArray(page.data)) throw new Error('会话历史响应无效');
    for (const entry of page.data) {
      const item = record(record(entry).item);
      if (item.type === 'userMessage' && typeof item.clientId === 'string' && wanted.has(item.clientId)) found.add(item.clientId);
    }
    if (page.nextCursor !== null && typeof page.nextCursor !== 'string') throw new Error('会话历史分页响应无效');
    cursor = page.nextCursor;
    if (cursor === null) break;
    if (cursors.has(cursor)) throw new Error('会话历史分页重复');
    cursors.add(cursor);
  }
  return found;
}
export function StandaloneQueue({ client, hostId, threadId, busy, refreshVersion, onStartQueued }: QueueProps) {
  return <QueueSession key={JSON.stringify([hostId, threadId])} {...{ client, hostId, threadId, busy, refreshVersion, onStartQueued }} />;
}
function QueueSession({ client, hostId, threadId, busy, refreshVersion, onStartQueued }: QueueProps) {
  const { t, locale } = useI18n('zh-CN');
  const [unknown, setUnknown] = useState<UnknownQueueStart[]>([]);
  const unknownRef = useRef<UnknownQueueStart[]>([]);
  const [storageState, setStorageState] = useState<'loading' | 'ready' | 'error'>('loading');
  const storageReady = useRef(false);
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [edit, setEdit] = useState<{ id: string; clientUserMessageId: string; baseInput: string; text: string } | null>(null);
  const generation = useRef(0);
  const storageGeneration = useRef(0);
  const mounted = useRef(false);
  const mutation = useRef(false);
  const loadUnknown = useCallback(async (): Promise<boolean> => {
    const current = ++storageGeneration.current;
    try {
      const next = await readUnknownQueueStarts(hostId, threadId);
      if (!mounted.current || current !== storageGeneration.current) return false;
      unknownRef.current = next; setUnknown(next); storageReady.current = true; setStorageState('ready');
      return true;
    } catch {
      if (mounted.current && current === storageGeneration.current) { storageReady.current = false; setStorageState('error'); }
      return false;
    }
  }, [hostId, threadId]);
  const removeMarker = useCallback(async (marker: UnknownQueueStart) => {
    try { return await removeUnknownQueueStart(hostId, threadId, marker); }
    catch (reason) {
      if (mounted.current) { storageReady.current = false; setStorageState('error'); }
      throw reason;
    }
  }, [hostId, threadId]);
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
          for (const item of confirmed) {
            const result = await removeMarker(item);
            if (result.removed) void client.host('queued-follow-up-send-lock-release', {
              hostId, conversationId: threadId, messageId: item.id, lockId: item.lockId, sent: true,
            }).catch(() => {});
          }
          if (confirmed.length) void loadUnknown();
        } catch { /* A missing or unavailable history cannot prove the outcome. */ }
      }
    } catch (reason) { if (current === generation.current) setError(t('Could not read queue:') + message(reason)); }
  }, [client, hostId, threadId, loadUnknown, removeMarker, t]);
  useEffect(() => {
    mounted.current = true;
    void loadUnknown().then(ready => { if (ready) void refresh(); });
    void refresh();
    const unsubscribe = client.subscribe(event => {
      if (event.type === 'mcp-notification' && event.hostId === hostId && event.method === 'thread/queue/changed'
        && record(event.params).threadId === threadId) void refresh();
      if (event.type === 'codex-app-server-connection-changed' && event.hostId === hostId && event.state === 'connected') void refresh();
    });
    const unsubscribeAtoms = subscribeBrowserAtoms(keys => {
      if (keys.includes(queueUnknownAtomKey)) void loadUnknown().then(ready => { if (ready) void refresh(); });
    });
    return () => { mounted.current = false; generation.current++; storageGeneration.current++; unsubscribe(); unsubscribeAtoms(); };
  }, [client, hostId, threadId, loadUnknown, refresh, refreshVersion]);
  const run = async (action: () => Promise<void>) => {
    if (mutation.current) return;
    mutation.current = true; setPending(true); setError('');
    try { await action(); await refresh(); }
    catch (reason) { await refresh(); setError(t('Action unconfirmed; check the queue before retrying:') + message(reason)); }
    finally { mutation.current = false; setPending(false); }
  };
  const start = (entry: QueueEntry) => run(async () => {
    if (!onStartQueued) throw new Error('会话控制器尚未提供队列发送');
    if (!storageReady.current || unknownRef.current.some(item => item.id === entry.id)) throw new Error('无法确认先前的发送结果');
    const request = { hostId, conversationId: threadId, messageId: entry.id, lockId: createId() };
    const result = await client.host<{ acquired: boolean }>('queued-follow-up-send-lock-acquire', request);
    if (!result.acquired) throw new Error('另一页面正在发送这条会话的消息');
    const marker = { id: entry.id, clientUserMessageId: entry.clientUserMessageId, lockId: request.lockId };
    if (!mounted.current) { await client.host('queued-follow-up-send-lock-release', { ...request, sent: false }); return; }
    try {
      await addUnknownQueueStart(hostId, threadId, marker);
      void loadUnknown();
    } catch {
      if (mounted.current) { storageReady.current = false; setStorageState('error'); }
      await client.host('queued-follow-up-send-lock-release', { ...request, sent: false });
      throw new Error('无法保存发送状态，未启动队列消息');
    }
    if (!mounted.current) {
      await removeMarker(marker);
      await client.host('queued-follow-up-send-lock-release', { ...request, sent: false });
      return;
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
        await removeMarker(marker);
        void loadUnknown();
        await client.host('queued-follow-up-send-lock-release', { ...request, sent });
      }
    }
  });
  const reorder = (index: number, target: number) => run(async () => {
    const ids = entries.map(item => item.id);
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    await client.rpc('thread/queue/reorder', { threadId, queuedSubmissionIds: ids }, hostId);
  });
  if (!entries.length && !error && !unknown.length && !edit && storageState === 'ready') return null;
  return <section className="standalone-queue" aria-label={t('Queued messages')}>
    <div className="standalone-queue__heading">{t('Queued messages')} <span>{new Intl.NumberFormat(locale).format(entries.length)}</span></div>
    {entries.map((entry, index) => {
      const editConflict = edit?.id === entry.id && (edit.clientUserMessageId !== entry.clientUserMessageId || edit.baseInput !== JSON.stringify(entry.input));
      return <div className="standalone-queue__row" key={entry.id}>
      {edit?.id === entry.id ? <div className="standalone-queue__edit">
        <textarea aria-label={t('Edit queued message')} value={edit.text} onChange={event => setEdit({ ...edit, text: event.target.value })} />
        {editConflict ? <div role="alert">{t('The queued message changed; cancel and edit again. Your edits are retained.')}</div> : null}
        <button type="button" disabled={pending || storageState !== 'ready' || unknown.some(item => item.id === entry.id) || editConflict || !edit.text.trim()} onClick={() => void run(async () => {
          const input = entry.input.map(item => item === entry.input.find(part => part.type === 'text') ? { ...item, text: edit.text } : item);
          await client.rpc('thread/queue/update', { threadId, queuedSubmissionId: entry.id, input }, hostId);
          setEdit(null);
        })}>{t('Save')}</button><button type="button" disabled={pending} onClick={() => setEdit(null)}>{t('Cancel')}</button>
      </div> : <span className="standalone-queue__text">{summary(entry, t)}</span>}
      <div className="standalone-queue__actions">
        <button type="button" title={t('Move up')} aria-label={t('Move queued message up')} disabled={pending || storageState !== 'ready' || !!unknown.length || index === 0} onClick={() => void reorder(index, index - 1)}>↑</button>
        <button type="button" title={t('Move down')} aria-label={t('Move queued message down')} disabled={pending || storageState !== 'ready' || !!unknown.length || index === entries.length - 1} onClick={() => void reorder(index, index + 1)}>↓</button>
        <button type="button" title={t('Edit')} aria-label={t('Edit queued message')} disabled={pending || storageState !== 'ready' || unknown.some(item => item.id === entry.id) || editableText(entry) == null} onClick={() => setEdit({ id: entry.id, clientUserMessageId: entry.clientUserMessageId, baseInput: JSON.stringify(entry.input), text: editableText(entry) ?? '' })}>{t('Edit')}</button>
        <button type="button" title={t('Delete')} aria-label={t('Delete queued message')} disabled={pending || storageState !== 'ready' || unknown.some(item => item.id === entry.id)} onClick={() => void run(async () => {
          const result = await client.rpc<{ deleted: boolean }>('thread/queue/delete', { threadId, queuedSubmissionId: entry.id }, hostId);
          if (!result.deleted) throw new Error('消息已不存在');
        })}>{t('Delete')}</button>
        <button type="button" title={t(busy ? 'Wait for current task' : 'Send now')} aria-label={t('Send queued message now')} disabled={pending || busy || !onStartQueued || storageState !== 'ready' || unknown.some(item => item.id === entry.id)} onClick={() => void start(entry)}>{t('Send')}</button>
      </div>
    </div>; })}
    {edit && !entries.some(entry => entry.id === edit.id) ? <div className="standalone-queue__edit" role="status">
      {t('This message is no longer in the queue; your unsaved edits are retained.')}
      <textarea aria-label={t('Edit queued message')} value={edit.text} onChange={event => setEdit({ ...edit, text: event.target.value })} />
      <button type="button" onClick={() => setEdit(null)}>{t('Close editing')}</button>
    </div> : null}
    {unknown.length ? <div role="status">{t('{count} messages have an unknown send outcome. Check the conversation; they will not be resent automatically.').replace('{count}', new Intl.NumberFormat(locale).format(unknown.length))}<button type="button" onClick={() => void refresh()}>{t('Check again')}</button></div> : null}
    {storageState === 'loading' ? <div role="status">{t('Loading queue send status...')}</div> : null}
    {storageState === 'error' ? <div role="alert">{t('Queue send status could not be read or saved; queue actions are paused.')}<button type="button" onClick={() => void loadUnknown().then(ready => { if (ready) void refresh(); })}>{t('Retry reading')}</button></div> : null}
    {error ? <div role="alert">{error}</div> : null}
  </section>;
}
