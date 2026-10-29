import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/index.tsx';
import type { I18n } from '../i18n/index.tsx';
import { subscribeBrowserAtoms } from '../storage/ui-atoms.ts';
import type { WorkbenchClient } from '../workbench-contract.ts';
import { createId } from './standalone-draft.ts';
import { addUnknownQueueStart, prepareUnknownQueueRelease, queueUnknownAtomKey, readUnknownQueueRecovery, removeUnknownQueueStart } from './standalone-queue-storage.ts';
import type { QueueReleaseIntent, UnknownQueueStart } from './standalone-queue-storage.ts';
import type { FinishComposerOperation } from './use-composer-draft.ts';

interface QueueEntry { id: string; clientUserMessageId: string; input: Record<string, unknown>[] }
interface QueueProps { client: WorkbenchClient; hostId: string; threadId: string; busy: boolean; refreshVersion: number; onStartQueued?: (id: string, assertAuthority?: () => void) => Promise<void>;
  captureAuthority?: () => () => void;
  beginOperation?: () => FinishComposerOperation | null; onEditStateChange?: (editing: boolean, pending: boolean) => void;
  onCompositionChange?: (composing: boolean) => void; frozen?: boolean }
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
export function StandaloneQueue({ client, hostId, threadId, busy, refreshVersion, onStartQueued, captureAuthority, beginOperation, onEditStateChange, onCompositionChange, frozen }: QueueProps) {
  return <QueueSession key={JSON.stringify([hostId, threadId])} {...{ client, hostId, threadId, busy, refreshVersion, onStartQueued, captureAuthority, beginOperation, onEditStateChange, onCompositionChange, frozen }} />;
}
function QueueSession({ client, hostId, threadId, busy, refreshVersion, onStartQueued, captureAuthority, beginOperation, onEditStateChange, onCompositionChange, frozen }: QueueProps) {
  const { t, locale } = useI18n('zh-CN');
  const [unknown, setUnknown] = useState<UnknownQueueStart[]>([]);
  const unknownRef = useRef<UnknownQueueStart[]>([]);
  const releaseRef = useRef<QueueReleaseIntent[]>([]);
  const [storageState, setStorageState] = useState<'loading' | 'ready' | 'error'>('loading');
  const storageReady = useRef(false);
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [listReady, setListReady] = useState(false);
  const listReadyRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [edit, setEdit] = useState<{ id: string; clientUserMessageId: string; baseInput: string; text: string } | null>(null);
  const editRef = useRef<typeof edit>(null);
  const editTextarea = useRef<HTMLTextAreaElement>(null);
  const frozenRef = useRef(frozen);
  frozenRef.current = frozen;
  const generation = useRef(0);
  const storageGeneration = useRef(0);
  const mounted = useRef(false);
  const mutation = useRef(false);
  const editing = useRef(false);
  const releases = useRef(new Map<string, { sent: boolean; pending: Promise<void> }>());
  const changeEdit = (next: typeof edit, fromMutation = false) => {
    if (mutation.current && !fromMutation) return;
    editRef.current = next;
    editing.current = next !== null;
    onEditStateChange?.(editing.current, mutation.current);
    setEdit(next);
  };
  const loadUnknown = useCallback(async (fromOperation = false): Promise<boolean> => {
    const finish = fromOperation ? undefined : beginOperation?.();
    if (beginOperation && !fromOperation && !finish) return false;
    const current = ++storageGeneration.current;
    let success = false;
    try {
      const next = await readUnknownQueueRecovery(hostId, threadId);
      if (!mounted.current) { success = true; return false; }
      if (current !== storageGeneration.current) { success = true; return true; }
      unknownRef.current = next.markers; releaseRef.current = next.releases; setUnknown(next.markers); storageReady.current = true; setStorageState('ready');
      success = true; return true;
    } catch {
      if (mounted.current) { storageReady.current = false; setStorageState('error'); }
      return false;
    }
    finally { finish?.(success); }
  }, [beginOperation, hostId, threadId]);
  const removeMarker = useCallback(async (marker: UnknownQueueStart) => {
    try { return await removeUnknownQueueStart(hostId, threadId, marker); }
    catch (reason) {
      if (mounted.current) { storageReady.current = false; setStorageState('error'); }
      throw reason;
    }
  }, [hostId, threadId]);
  const releaseMarker = useCallback((marker: UnknownQueueStart, sent: boolean): Promise<void> => {
    const key = JSON.stringify([marker.id, marker.clientUserMessageId, marker.lockId]);
    const existing = releases.current.get(key);
    if (existing) return existing.sent === sent ? existing.pending : Promise.reject(new Error('队列锁释放状态不一致。'));
    const pending = (async () => {
      let prepared: boolean;
      try { prepared = await prepareUnknownQueueRelease(hostId, threadId, marker, sent); }
      catch (reason) {
        if (mounted.current) { storageReady.current = false; setStorageState('error'); }
        throw reason;
      }
      if (!prepared) return;
      await client.host('queued-follow-up-send-lock-release', {
        hostId, conversationId: threadId, messageId: marker.id, lockId: marker.lockId, sent,
      });
      const result = await removeMarker(marker);
      if (mounted.current) {
        storageGeneration.current++;
        unknownRef.current = result.markers; setUnknown(result.markers);
        releaseRef.current = releaseRef.current.filter(item => item.marker.id !== marker.id
          || item.marker.clientUserMessageId !== marker.clientUserMessageId || item.marker.lockId !== marker.lockId);
        storageReady.current = true; setStorageState('ready');
      }
    })();
    releases.current.set(key, { sent, pending });
    void pending.then(() => { if (releases.current.get(key)?.pending === pending) releases.current.delete(key); },
      () => { if (releases.current.get(key)?.pending === pending) releases.current.delete(key); });
    return pending;
  }, [client, hostId, threadId, removeMarker]);
  const refresh = useCallback(async (fromOperation = false) => {
    const finish = fromOperation ? undefined : beginOperation?.();
    if (beginOperation && !fromOperation && !finish) return false;
    const current = ++generation.current;
    let success = false;
    try {
      const next = await list(client, hostId, threadId);
      if (current !== generation.current) { success = true; return true; }
      listReadyRef.current = true; setListReady(true);
      setEntries(next);
      for (const item of releaseRef.current) {
        await releaseMarker(item.marker, item.sent);
      }
      const unresolved = unknownRef.current.filter(marker => !next.some(entry => entry.id === marker.id));
      if (unresolved.length) {
        try {
          const found = await historyClientIds(client, hostId, threadId, new Set(unresolved.map(item => item.clientUserMessageId)));
          if (current !== generation.current) { success = true; return true; }
          const confirmed = unresolved.filter(item => found.has(item.clientUserMessageId));
          for (const item of confirmed) {
            await releaseMarker(item, true);
          }
        } catch (reason) {
          if (mounted.current) setError(t('Could not read queue:') + message(reason));
          return false;
        }
      }
      success = true;
      return true;
    } catch (reason) {
      if (mounted.current && current === generation.current) {
        listReadyRef.current = false; setListReady(false); setError(t('Could not read queue:') + message(reason));
      }
      return false;
    }
    finally { finish?.(success); }
  }, [beginOperation, client, hostId, threadId, releaseMarker, t]);
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
  useEffect(() => { if (!frozen) void loadUnknown().then(ready => { if (ready) void refresh(); }); }, [frozen, loadUnknown, refresh]);
  const run = async (action: () => Promise<void>) => {
    if (mutation.current || !listReadyRef.current) return;
    const finish = beginOperation?.();
    if (beginOperation && !finish) return;
    mutation.current = true; setPending(true); setError('');
    if (editTextarea.current) editTextarea.current.readOnly = true;
    onEditStateChange?.(editing.current, true);
    let success = false;
    try { await action(); success = await refresh(true); }
    catch (reason) { await refresh(true); setError(t('Action unconfirmed; check the queue before retrying:') + message(reason)); }
    finally {
      mutation.current = false;
      if (editTextarea.current) editTextarea.current.readOnly = !!frozenRef.current;
      onEditStateChange?.(editing.current, false); setPending(false); finish?.(success);
    }
  };
  const start = (entry: QueueEntry) => run(async () => {
    if (!onStartQueued) throw new Error('会话控制器尚未提供队列发送');
    const captured = captureAuthority?.();
    const assertAuthority = () => {
      try { captured?.(); }
      catch (cause) { throw Object.assign(new Error('原队列点击的连接或权限已改变，未启动消息。', { cause }), { uncertain: false }); }
    };
    assertAuthority();
    if (!storageReady.current || unknownRef.current.some(item => item.id === entry.id)) throw new Error('无法确认先前的发送结果');
    const request = { hostId, conversationId: threadId, messageId: entry.id, lockId: createId() };
    const result = await client.host<{ acquired: boolean }>('queued-follow-up-send-lock-acquire', request);
    if (!result.acquired) throw new Error('另一页面正在发送这条会话的消息');
    const marker = { id: entry.id, clientUserMessageId: entry.clientUserMessageId, lockId: request.lockId };
    if (!mounted.current) { await client.host('queued-follow-up-send-lock-release', { ...request, sent: false }); return; }
    try {
      const markers = await addUnknownQueueStart(hostId, threadId, marker);
      if (mounted.current) {
        storageGeneration.current++;
        unknownRef.current = markers; setUnknown(markers); storageReady.current = true; setStorageState('ready');
      }
    } catch {
      if (mounted.current) { storageReady.current = false; setStorageState('error'); }
      await client.host('queued-follow-up-send-lock-release', { ...request, sent: false });
      throw new Error('无法保存发送状态，未启动队列消息');
    }
    if (!mounted.current) {
      await releaseMarker(marker, false);
      return;
    }
    let sent = false, release = false;
    try {
      assertAuthority();
      await onStartQueued(entry.id, assertAuthority);
      sent = true; release = true;
    } catch (reason) {
      const error = record(reason), data = record(error.data);
      release = error.uncertain === false || data.uncertain === false
        || typeof error.code === 'number' && error.uncertain !== true && data.uncertain !== true;
      if (!release) throw new Error('发送结果未知，请检查会话和队列；不会自动重发。', { cause: reason });
      throw reason;
    } finally {
      if (release) {
        await releaseMarker(marker, sent);
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
        <textarea ref={editTextarea} readOnly={pending || frozen} aria-label={t('Edit queued message')} value={edit.text} onChange={event => {
          if (mutation.current) { event.currentTarget.value = editRef.current?.text ?? ''; return; }
          changeEdit({ ...edit, text: event.target.value });
        }}
          onCompositionStart={() => onCompositionChange?.(true)} onCompositionEnd={() => { requestAnimationFrame(() => onCompositionChange?.(false)); }} />
        {editConflict ? <div role="alert">{t('The queued message changed; cancel and edit again. Your edits are retained.')}</div> : null}
        <button type="button" disabled={pending || !listReady || storageState !== 'ready' || unknown.some(item => item.id === entry.id) || editConflict || !edit.text.trim()} onClick={() => void run(async () => {
          const input = entry.input.map(item => item === entry.input.find(part => part.type === 'text') ? { ...item, text: edit.text } : item);
          await client.rpc('thread/queue/update', { threadId, queuedSubmissionId: entry.id, input }, hostId);
          if (editRef.current === edit) changeEdit(null, true);
        })}>{t('Save')}</button><button type="button" disabled={pending} onClick={() => changeEdit(null)}>{t('Cancel')}</button>
      </div> : <span className="standalone-queue__text">{summary(entry, t)}</span>}
      <div className="standalone-queue__actions">
        <button type="button" title={t('Move up')} aria-label={t('Move queued message up')} disabled={pending || !listReady || storageState !== 'ready' || !!unknown.length || index === 0} onClick={() => void reorder(index, index - 1)}>↑</button>
        <button type="button" title={t('Move down')} aria-label={t('Move queued message down')} disabled={pending || !listReady || storageState !== 'ready' || !!unknown.length || index === entries.length - 1} onClick={() => void reorder(index, index + 1)}>↓</button>
        <button type="button" title={t('Edit')} aria-label={t('Edit queued message')} disabled={pending || !listReady || storageState !== 'ready' || unknown.some(item => item.id === entry.id) || editableText(entry) == null} onClick={() => changeEdit({ id: entry.id, clientUserMessageId: entry.clientUserMessageId, baseInput: JSON.stringify(entry.input), text: editableText(entry) ?? '' })}>{t('Edit')}</button>
        <button type="button" title={t('Delete')} aria-label={t('Delete queued message')} disabled={pending || !listReady || storageState !== 'ready' || unknown.some(item => item.id === entry.id)} onClick={() => void run(async () => {
          const result = await client.rpc<{ deleted: boolean }>('thread/queue/delete', { threadId, queuedSubmissionId: entry.id }, hostId);
          if (!result.deleted) throw new Error('消息已不存在');
        })}>{t('Delete')}</button>
        <button type="button" title={t(busy ? 'Wait for current task' : 'Send now')} aria-label={t('Send queued message now')} disabled={pending || !listReady || busy || !onStartQueued || storageState !== 'ready' || unknown.some(item => item.id === entry.id)} onClick={() => void start(entry)}>{t('Send')}</button>
      </div>
    </div>; })}
    {edit && !entries.some(entry => entry.id === edit.id) ? <div className="standalone-queue__edit" role="status">
      {t('This message is no longer in the queue; your unsaved edits are retained.')}
      <textarea ref={editTextarea} readOnly={pending || frozen} aria-label={t('Edit queued message')} value={edit.text} onChange={event => {
        if (mutation.current) { event.currentTarget.value = editRef.current?.text ?? ''; return; }
        changeEdit({ ...edit, text: event.target.value });
      }}
        onCompositionStart={() => onCompositionChange?.(true)} onCompositionEnd={() => { requestAnimationFrame(() => onCompositionChange?.(false)); }} />
      <button type="button" onClick={() => changeEdit(null)}>{t('Close editing')}</button>
    </div> : null}
    {unknown.length ? <div role="status">{t('{count} messages have an unknown send outcome. Check the conversation; they will not be resent automatically.').replace('{count}', new Intl.NumberFormat(locale).format(unknown.length))}<button type="button" onClick={() => void refresh()}>{t('Check again')}</button></div> : null}
    {storageState === 'loading' ? <div role="status">{t('Loading queue send status...')}</div> : null}
    {storageState === 'error' ? <div role="alert">{t('Queue send status could not be read or saved; queue actions are paused.')}<button type="button" onClick={() => void loadUnknown().then(ready => { if (ready) void refresh(); })}>{t('Retry reading')}</button></div> : null}
    {error ? <div role="alert">{error} {!listReady ? <button type="button" onClick={() => void refresh().then(ok => { if (ok) setError(''); })}>{t('Retry reading')}</button> : null}</div> : null}
  </section>;
}
