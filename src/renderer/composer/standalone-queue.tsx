import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/index.tsx';
import type { I18n } from '../i18n/index.tsx';
import { subscribeBrowserAtoms } from '../storage/ui-atoms.ts';
import type { WorkbenchClient } from '../workbench-contract.ts';
import { createId } from './standalone-draft.ts';
import { addUnknownQueueStart, advanceQueueEdit, commitQueueEdit, dismissQueueEdit, prepareQueueEdit, prepareUnknownQueueRelease,
  queueEntryDraft, queueUnknownAtomKey, readUnknownQueueRecovery, removeUnknownQueueStart } from './standalone-queue-storage.ts';
import type { QueueEditEntry, QueueEditRecovery, QueueReleaseIntent, UnknownQueueStart } from './standalone-queue-storage.ts';
import { sameComposerDraftValue } from './composer-draft-store.ts';
import type { ComposerDraftOwner, ComposerDraftSnapshot } from './composer-draft-store.ts';
import type { ComposerDraftExternalOperation, FinishComposerOperation } from './use-composer-draft.ts';

type QueueEntry = QueueEditEntry;
export interface QueueEditBinding {
  owner: ComposerDraftOwner;
  operation: ComposerDraftExternalOperation;
  assertAuthority(): void;
  /** Compare the complete entry and delete within the host/thread Yard write queue.
   * Check at dispatch, do not retry, and return changed only when no deletion occurred.
   * Independent daemon clients are not serialized by this queue. */
  removeQueuedOriginal(entry: QueueEditEntry, assertBeforeSend: () => void): Promise<'deleted' | 'changed'>;
}
export interface QueueProps { client: WorkbenchClient; hostId: string; threadId: string; busy: boolean; refreshVersion: number; onStartQueued?: (id: string, assertAuthority?: () => void) => Promise<void>;
  captureAuthority?: () => () => void;
  beginQueueEdit?: () => QueueEditBinding | null;
  onQueueDraftCommitted?: (before: ComposerDraftSnapshot, after: ComposerDraftSnapshot) => Promise<boolean>;
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
export function StandaloneQueue({ client, hostId, threadId, busy, refreshVersion, onStartQueued, captureAuthority, beginQueueEdit, onQueueDraftCommitted, beginOperation, onEditStateChange, onCompositionChange, frozen }: QueueProps) {
  return <QueueSession key={JSON.stringify([hostId, threadId])} {...{ client, hostId, threadId, busy, refreshVersion, onStartQueued, captureAuthority, beginQueueEdit, onQueueDraftCommitted, beginOperation, onEditStateChange, onCompositionChange, frozen }} />;
}
function QueueSession({ client, hostId, threadId, busy, refreshVersion, onStartQueued, captureAuthority, beginQueueEdit, onQueueDraftCommitted, beginOperation, onEditStateChange, frozen }: QueueProps) {
  const { t, locale } = useI18n('zh-CN');
  const [unknown, setUnknown] = useState<UnknownQueueStart[]>([]);
  const unknownRef = useRef<UnknownQueueStart[]>([]);
  const releaseRef = useRef<QueueReleaseIntent[]>([]);
  const [editRecoveries, setEditRecoveries] = useState<QueueEditRecovery[]>([]);
  const editsRef = useRef<QueueEditRecovery[]>([]);
  const [volatileEdit, setVolatileEdit] = useState<{ entry: QueueEntry; operationId: string; confirmed: boolean } | null>(null);
  const [storageState, setStorageState] = useState<'loading' | 'ready' | 'error'>('loading');
  const storageReady = useRef(false);
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [listReady, setListReady] = useState(false);
  const listReadyRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const frozenRef = useRef(frozen);
  frozenRef.current = frozen;
  const generation = useRef(0);
  const storageGeneration = useRef(0);
  const mounted = useRef(false);
  const mutation = useRef(false);
  const queueChanges = useRef(0);
  const releases = useRef(new Map<string, { sent: boolean; pending: Promise<void> }>());
  const loadUnknown = useCallback(async (fromOperation = false): Promise<boolean> => {
    const finish = fromOperation ? undefined : beginOperation?.();
    if (beginOperation && !fromOperation && !finish) return false;
    const current = ++storageGeneration.current;
    let success = false;
    try {
      const next = await readUnknownQueueRecovery(hostId, threadId);
      if (!mounted.current) { success = true; return false; }
      if (current !== storageGeneration.current) { success = true; return true; }
      unknownRef.current = next.markers; releaseRef.current = next.releases; editsRef.current = next.edits;
      setUnknown(next.markers); setEditRecoveries(next.edits); storageReady.current = true; setStorageState('ready');
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
        && record(event.params).threadId === threadId) { queueChanges.current++; void refresh(); }
      if (event.type === 'codex-app-server-connection-changed' && event.hostId === hostId) {
        queueChanges.current++; if (event.state === 'connected') void refresh();
      }
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
    onEditStateChange?.(!!volatileEdit, true);
    let success = false;
    try { await action(); success = await refresh(true); }
    catch (reason) { await refresh(true); setError(t('Action unconfirmed; check the queue before retrying:') + message(reason)); }
    finally {
      mutation.current = false;
      onEditStateChange?.(!!volatileEdit, false); setPending(false); finish?.(success);
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
    if (editsRef.current.length) throw new Error('请先处理队列编辑恢复记录。');
    const ids = entries.map(item => item.id);
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    await client.rpc('thread/queue/reorder', { threadId, queuedSubmissionIds: ids }, hostId);
  });
  const setVolatile = (value: typeof volatileEdit) => {
    setVolatileEdit(value);
    onEditStateChange?.(!!value, mutation.current);
  };
  const beginEdit = (): QueueEditBinding | null => {
    if (mutation.current || frozenRef.current || !beginQueueEdit) return null;
    const binding = beginQueueEdit();
    if (!binding) return null;
    if (binding.owner.hostId !== hostId || binding.owner.threadId !== threadId || !binding.owner.draftId
      || typeof binding.removeQueuedOriginal !== 'function') {
      binding.operation.finish(false);
      throw new Error('原队列和输入区身份不一致。');
    }
    return { ...binding, owner: structuredClone(binding.owner) };
  };
  const moveToComposer = async (selected: QueueEntry) => {
    if (mutation.current || !listReadyRef.current || !storageReady.current || volatileEdit
      || unknownRef.current.some(item => item.id === selected.id) || editsRef.current.some(item => item.entry.id === selected.id)) return;
    let binding: QueueEditBinding | null;
    try { binding = beginEdit(); }
    catch (reason) { setError(message(reason)); return; }
    if (!binding) { setError('主输入区尚未准备好接收队列消息。'); return; }
    const entry = structuredClone(selected), operationId = createId();
    mutation.current = true; setPending(true); setError(''); onEditStateChange?.(false, true);
    let prepared = false;
    const progress: { stage: 'prepared' | 'deleting' | 'deleted' | 'committed' } = { stage: 'prepared' };
    let dispatched = false, confirmed = false, success = false;
    try {
      const receipt = await binding.operation.transaction(async (before, isCurrent) => {
        const stillAuthorized = () => {
          if (!mounted.current || !isCurrent()) return false;
          try { binding!.assertAuthority(); return true; } catch { return false; }
        };
        const check = () => {
          if (!stillAuthorized()) throw new Error('原页面、连接或输入区已改变，队列操作已停止。');
        };
        check();
        if (!sameComposerDraftValue(binding!.owner, before.owner)) throw new Error('原队列和输入区身份不一致。');
        await prepareQueueEdit(hostId, threadId, operationId, entry, before, stillAuthorized);
        prepared = true;
        try { queueEntryDraft(entry, hostId); }
        catch (reason) { await advanceQueueEdit(hostId, threadId, operationId, 'prepared', 'conflict'); throw reason; }
        check();
        const changes = queueChanges.current;
        const current = await list(client, hostId, threadId);
        check();
        const match = current.find(item => item.id === entry.id);
        if (queueChanges.current !== changes || !match || !sameComposerDraftValue(match, entry)) {
          await advanceQueueEdit(hostId, threadId, operationId, 'prepared', 'conflict');
          throw new Error('队列消息已改变，原内容保留在恢复记录中。');
        }
        await advanceQueueEdit(hostId, threadId, operationId, 'prepared', 'deleting'); progress.stage = 'deleting';
        const beforeSend = () => {
          try {
            check();
            if (queueChanges.current !== changes) throw new Error('队列消息已改变，未发送删除请求。');
          } catch (cause) {
            throw Object.assign(new Error(message(cause), { cause }), { sendPhase: 'before-send' });
          }
        };
        beforeSend();
        dispatched = true;
        let result: 'deleted' | 'changed';
        try {
          result = await binding!.removeQueuedOriginal(structuredClone(entry), beforeSend);
        } catch (reason) {
          if (record(reason).sendPhase === 'before-send') { dispatched = false; await advanceQueueEdit(hostId, threadId, operationId, 'deleting', 'not-sent'); }
          throw reason;
        }
        if (result !== 'deleted') {
          if (result === 'changed') { dispatched = false; await advanceQueueEdit(hostId, threadId, operationId, 'deleting', 'conflict'); }
          throw new Error('队列删除未确认，原内容保留在恢复记录中。');
        }
        confirmed = true;
        await advanceQueueEdit(hostId, threadId, operationId, 'deleting', 'deleted'); progress.stage = 'deleted';
        check();
        const after = await commitQueueEdit(hostId, threadId, operationId, before, stillAuthorized);
        progress.stage = 'committed';
        return { after, value: undefined };
      });
      if (!receipt.accepted) throw new Error('队列消息已保存为草稿，请核对并接收该版本。');
      await dismissQueueEdit(hostId, threadId, operationId, 'committed');
      success = true;
    } catch (reason) {
      if (prepared && !dispatched && progress.stage === 'prepared') {
        try { await advanceQueueEdit(hostId, threadId, operationId, 'prepared', 'not-sent'); } catch { /* Preserve the prepared record. */ }
      } else if (prepared && !dispatched && progress.stage === 'deleting') {
        try { await advanceQueueEdit(hostId, threadId, operationId, 'deleting', 'not-sent'); } catch { /* Preserve the unknown record. */ }
      }
      if (mounted.current) {
        if (!prepared || confirmed && progress.stage === 'deleting') setVolatile({ entry, operationId, confirmed });
        setError(t('Action unconfirmed; check the queue before retrying:') + message(reason));
      }
    } finally {
      binding.operation.finish(success);
      mutation.current = false;
      if (mounted.current) {
        setPending(false); onEditStateChange?.(!prepared || confirmed && progress.stage === 'deleting', false);
        void loadUnknown().then(ready => { if (ready) void refresh(); });
      }
    }
  };
  const restoreDeleted = async (item: QueueEditRecovery) => {
    if (mutation.current || volatileEdit) return;
    let binding: QueueEditBinding | null;
    try { binding = beginEdit(); }
    catch (reason) { setError(message(reason)); return; }
    if (!binding) { setError('主输入区尚未准备好接收队列消息。'); return; }
    mutation.current = true; setPending(true); setError(''); onEditStateChange?.(false, true);
    let success = false;
    try {
      if (!sameComposerDraftValue(binding.owner, item.owner)) throw new Error('恢复记录属于其他输入区。');
      const receipt = await binding.operation.transaction(async (before, isCurrent) => {
        binding!.assertAuthority();
        if (!sameComposerDraftValue(binding!.owner, before.owner)) throw new Error('原队列和输入区身份不一致。');
        const after = await commitQueueEdit(hostId, threadId, item.operationId, before, () => {
          if (!mounted.current || !isCurrent()) return false;
          try { binding!.assertAuthority(); return true; } catch { return false; }
        });
        return { after, value: undefined };
      });
      if (!receipt.accepted) throw new Error('队列消息已保存为草稿，请核对并接收该版本。');
      await dismissQueueEdit(hostId, threadId, item.operationId, 'committed'); success = true;
    } catch (reason) { if (mounted.current) setError(message(reason)); }
    finally {
      binding.operation.finish(success); mutation.current = false;
      if (mounted.current) { setPending(false); onEditStateChange?.(false, false); void loadUnknown().then(ready => { if (ready) void refresh(); }); }
    }
  };
  const acceptCommitted = async (item: QueueEditRecovery) => {
    if (mutation.current || !item.before || !item.after || !onQueueDraftCommitted) return;
    mutation.current = true; setPending(true); setError(''); onEditStateChange?.(false, true);
    try {
      if (!await onQueueDraftCommitted(item.before, item.after)) throw new Error('当前输入区或保存版本已改变，原恢复内容已保留。');
      await dismissQueueEdit(hostId, threadId, item.operationId, 'committed');
    } catch (reason) { if (mounted.current) setError(message(reason)); }
    finally {
      mutation.current = false;
      if (mounted.current) { setPending(false); onEditStateChange?.(false, false); void loadUnknown().then(ready => { if (ready) void refresh(); }); }
    }
  };
  const retryConfirmedReceipt = async () => {
    if (!volatileEdit?.confirmed || mutation.current) return;
    mutation.current = true; setPending(true);
    let saved = false;
    try {
      await advanceQueueEdit(hostId, threadId, volatileEdit.operationId, 'deleting', 'deleted');
      saved = true; setVolatile(null); setError('');
    } catch (reason) { if (mounted.current) setError(message(reason)); }
    finally {
      mutation.current = false;
      if (mounted.current) { setPending(false); onEditStateChange?.(!saved, false); void loadUnknown().then(ready => { if (ready) void refresh(); }); }
    }
  };
  if (!entries.length && !error && !unknown.length && !editRecoveries.length && !volatileEdit && storageState === 'ready') return null;
  return <section className="standalone-queue" aria-label={t('Queued messages')}>
    <div className="standalone-queue__heading">{t('Queued messages')} <span>{new Intl.NumberFormat(locale).format(entries.length)}</span></div>
    {entries.map((entry, index) => {
      const recovering = editRecoveries.some(item => item.entry.id === entry.id);
      return <div className="standalone-queue__row" key={entry.id}>
      <span className="standalone-queue__text">{summary(entry, t)}</span>
      <div className="standalone-queue__actions">
        <button type="button" title={t('Move up')} aria-label={t('Move queued message up')} disabled={pending || !listReady || storageState !== 'ready' || !!unknown.length || !!editRecoveries.length || !!volatileEdit || index === 0} onClick={() => void reorder(index, index - 1)}>↑</button>
        <button type="button" title={t('Move down')} aria-label={t('Move queued message down')} disabled={pending || !listReady || storageState !== 'ready' || !!unknown.length || !!editRecoveries.length || !!volatileEdit || index === entries.length - 1} onClick={() => void reorder(index, index + 1)}>↓</button>
        <button type="button" title={t('Edit')} aria-label={t('Edit queued message')} disabled={pending || frozen || !beginQueueEdit || !listReady || storageState !== 'ready' || !!volatileEdit || recovering || unknown.some(item => item.id === entry.id)} onClick={() => void moveToComposer(entry)}>{t('Edit')}</button>
        <button type="button" title={t('Delete')} aria-label={t('Delete queued message')} disabled={pending || !listReady || storageState !== 'ready' || !!volatileEdit || recovering || unknown.some(item => item.id === entry.id)} onClick={() => void run(async () => {
          if (editsRef.current.some(item => item.entry.id === entry.id)) throw new Error('请先处理此消息的队列编辑恢复。');
          const result = await client.rpc<{ deleted: boolean }>('thread/queue/delete', { threadId, queuedSubmissionId: entry.id }, hostId);
          if (!result.deleted) throw new Error('消息已不存在');
        })}>{t('Delete')}</button>
        <button type="button" title={t(busy ? 'Wait for current task' : 'Send now')} aria-label={t('Send queued message now')} disabled={pending || !listReady || busy || !onStartQueued || storageState !== 'ready' || !!volatileEdit || recovering || unknown.some(item => item.id === entry.id)} onClick={() => void start(entry)}>{t('Send')}</button>
      </div>
    </div>; })}
    {editRecoveries.map(item => <div className="standalone-queue__edit" role="status" key={item.operationId}>
      <div>{item.stage === 'deleting' ? '队列删除结果未知，不会自动重试。' : item.stage === 'deleted'
        ? '队列删除已确认，原消息可恢复到输入区。' : item.stage === 'committed'
          ? '队列消息已保存为草稿，等待输入区接收。' : '队列消息未确认删除，原内容已保留。'}</div>
      <details><summary>{summary(item.entry, t)}</summary><textarea readOnly aria-label="队列消息原始内容" value={JSON.stringify(item.entry.input, null, 2)} /></details>
      {item.stage === 'committed' ? <details><summary>已保存的完整草稿版本</summary>
        <textarea readOnly aria-label="已保存的完整草稿版本" value={JSON.stringify({ before: item.before, after: item.after }, null, 2)} /></details> : null}
      {item.stage === 'deleted' ? <button type="button" disabled={pending || frozen || !beginQueueEdit || !!volatileEdit} onClick={() => void restoreDeleted(item)}>恢复到输入区</button> : null}
      {item.stage === 'committed' ? <button type="button" disabled={pending || !onQueueDraftCommitted || !!volatileEdit} onClick={() => void acceptCommitted(item)}>接收已保存草稿</button> : null}
      <button type="button" disabled={pending || !!volatileEdit} onClick={() => {
        if (!window.confirm('放弃此恢复记录？原始队列内容将不再保存在此处。')) return;
        void dismissQueueEdit(hostId, threadId, item.operationId, item.stage).then(() => loadUnknown()).catch(reason => setError(message(reason)));
      }}>放弃恢复记录</button>
    </div>)}
    {volatileEdit ? <div className="standalone-queue__edit" role="alert">
      {volatileEdit.confirmed ? '删除已确认，但回执尚未保存；请重试保存回执。' : '原消息尚未保存到恢复记录；请复制原内容或明确放弃。'}
      <textarea readOnly aria-label="未保存的队列原始内容" value={JSON.stringify(volatileEdit.entry.input, null, 2)} />
      {volatileEdit.confirmed ? <button type="button" disabled={pending} onClick={() => void retryConfirmedReceipt()}>重试保存回执</button>
        : <button type="button" disabled={pending} onClick={() => { if (window.confirm('放弃此未保存的原始内容？')) setVolatile(null); }}>放弃本地恢复内容</button>}
    </div> : null}
    {unknown.length ? <div role="status">{t('{count} messages have an unknown send outcome. Check the conversation; they will not be resent automatically.').replace('{count}', new Intl.NumberFormat(locale).format(unknown.length))}<button type="button" onClick={() => void refresh()}>{t('Check again')}</button></div> : null}
    {storageState === 'loading' ? <div role="status">{t('Loading queue send status...')}</div> : null}
    {storageState === 'error' ? <div role="alert">{t('Queue send status could not be read or saved; queue actions are paused.')}<button type="button" onClick={() => void loadUnknown().then(ready => { if (ready) void refresh(); })}>{t('Retry reading')}</button></div> : null}
    {error ? <div role="alert">{error} {!listReady ? <button type="button" onClick={() => void refresh().then(ok => { if (ok) setError(''); })}>{t('Retry reading')}</button> : null}</div> : null}
  </section>;
}
