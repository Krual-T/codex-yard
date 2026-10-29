import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { X } from 'lucide-react';
import { StandaloneComposer } from '../composer/StandaloneComposer.tsx';
import type { ComposerDraftController, ComposerSubmissionDescription, StandaloneComposerRuntimeProps } from '../composer/StandaloneComposer.tsx';
import { readComposerDraftVersions } from '../composer/composer-draft-store.ts';
import type { ComposerDraftOwner, ComposerDraftSnapshot, ComposerDraftVersions } from '../composer/composer-draft-store.ts';
import { StandaloneMessages } from '../messages/StandaloneMessages.tsx';
import type { MessageEditHistory, StandaloneMessagesRecoveryProps } from '../messages/StandaloneMessages.tsx';
import { isThreadBusy } from '../app/thread-state.ts';
import type { ComposerDraft, StandaloneMessagesProps, SubmitAction, SubmitOptions, WorkbenchClient } from '../workbench-contract.ts';
import type { SideChatController } from './controller.ts';
import type { SideChatHistory, SideChatScope } from './types.ts';
import './side-chat.css';

export interface SideChatCloseBarrier {
  hostId: string;
  parentThreadId: string;
  childThreadId: string | null;
  operationId: string | null;
  draftId: string;
  draftController: ComposerDraftController | null;
}
export interface SideChatChildScope extends SideChatScope { childThreadId: string | null }
export interface SideChatActiveChildScope extends SideChatChildScope { childThreadId: string }
export interface SideChatInterruptScope extends SideChatActiveChildScope { turnId: string }
export interface SideChatQueueEntry { id: string; clientUserMessageId: string; input: Record<string, unknown>[] }
export type SideChatQueueMutation = 'thread/queue/reorder' | 'thread/queue/update' | 'thread/queue/delete';
export interface SideChatPanelProps {
  client: WorkbenchClient;
  controller: SideChatController;
  open: boolean;
  history: SideChatHistory | null;
  onClose(): void;
  /** Check the shared send ledger and guarantee that pending composer edits have quiesced. */
  onBeforeClose(scope: SideChatCloseBarrier): Promise<void>;
  /** Release a successful barrier only if the parent proves close was not dispatched. */
  onCloseBarrierAborted?(scope: SideChatCloseBarrier): void;
  /** Exit a read-only observer without reporting that the host operation closed. */
  canExitObservation?(scope: SideChatCloseBarrier): boolean;
  onExitObservation?(): void;
  prepareResultUnknown?: boolean;
  onSubmit(description: ComposerSubmissionDescription, draft: ComposerDraft, options: SubmitOptions,
    action: SubmitAction, controller: ComposerDraftController, assertAuthority?: () => void): Promise<void>;
  /** Capture the real shared owner and connection at the original input action. */
  captureSubmissionAuthority?: StandaloneComposerRuntimeProps['captureSubmissionAuthority'];
  onDraftController?: StandaloneComposerRuntimeProps['onDraftController'];
  /** Parent verifies the original connection generation and the current child turn atomically. */
  onInterrupt(scope: SideChatInterruptScope): Promise<void>;
  /** Preserve this mounted instance; create a separate operation and draft without replaying it. */
  onOpenNew?(scope: SideChatChildScope): void | Promise<void>;
  onStartQueued?(id: string, scope: SideChatActiveChildScope, assertAuthority?: () => void, originalAuthority?: () => void): Promise<void>;
  removeQueuedOriginal?(entry: SideChatQueueEntry, scope: SideChatActiveChildScope, originalAuthority: () => void,
    assertBeforeSend: () => void): Promise<'deleted' | 'changed'>;
  dispatchQueueMutation?<T>(method: SideChatQueueMutation, params: Record<string, unknown>, hostId: string,
    originalAuthority: () => void, assertBeforeSend: () => void): Promise<T>;
  messages?: Omit<StandaloneMessagesProps, 'client' | 'hostId' | 'thread'> & StandaloneMessagesRecoveryProps & { editHistory?: MessageEditHistory };
  prefill?: StandaloneComposerRuntimeProps['prefill'];
  onPrefillConsumed?: StandaloneComposerRuntimeProps['onPrefillConsumed'];
  onDraftChange?: StandaloneComposerRuntimeProps['onDraftChange'];
  onRemoveReference?: StandaloneComposerRuntimeProps['onRemoveReference'];
  confirmBeforeClose?: boolean;
}

function DraftInspection({ owner, getCurrent }: { owner: ComposerDraftOwner; getCurrent(): ComposerDraftSnapshot | null }) {
  const [versions, setVersions] = useState<ComposerDraftVersions | null>(null);
  const [error, setError] = useState<string | null>(null), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setVersions(null); setError(null);
    void readComposerDraftVersions(owner).then(value => { if (live) setVersions(value); })
      .catch(reason => { if (live) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { live = false; };
  }, [owner.hostId, owner.threadId, owner.draftId, attempt]);
  const snapshot = getCurrent();
  const current = snapshot && snapshot.owner.hostId === owner.hostId && snapshot.owner.threadId === owner.threadId
    && snapshot.owner.draftId === owner.draftId ? snapshot : null;
  const stored = [...(versions?.versions ?? []), ...(versions?.retained ?? [])];
  const unique = stored.filter((item, index) => item.revision !== current?.revision
    && stored.findIndex(other => other.revision === item.revision) === index);
  const drafts = [...current ? [{ revision: current.revision, draft: current.draft }] : [], ...unique];
  return <section className="yard-side-chat__draft" aria-label="保留的侧聊草稿">
    <strong>保留的草稿</strong>
    {error ? <p role="alert">无法读取已保存的草稿：{error}</p> : null}
    {!versions && !error ? <p role="status">正在读取已保存的草稿…</p> : null}
    {versions && !drafts.length ? <p>没有找到已保存的草稿。</p> : null}
    {drafts.map((item, index) => <div key={item.revision} className="yard-side-chat__draft-version">
      <label>草稿{drafts.length > 1 ? ` ${index + 1}` : ''}
        <textarea readOnly value={item.draft.text} aria-label={drafts.length > 1 ? `草稿 ${index + 1}` : '草稿'} />
      </label>
      <details><summary>查看草稿完整内容</summary><pre>{JSON.stringify(item.draft, null, 2)}</pre></details>
    </div>)}
    <button type="button" onClick={() => setAttempt(value => value + 1)}>刷新草稿</button>
  </section>;
}

const localRejection = (text: string) => Object.assign(new Error(text), { uncertain: false as const });

export function SideChatPanel(props: SideChatPanelProps) {
  const { hostId, parentThreadId, draftId } = props.controller.getSnapshot();
  return <SideChatSession key={JSON.stringify([hostId, parentThreadId, draftId])} {...props} />;
}

function SideChatSession({ client, controller, open, history, onClose, onBeforeClose, onCloseBarrierAborted, canExitObservation, onExitObservation, prepareResultUnknown, onSubmit, onInterrupt, onOpenNew, onStartQueued, removeQueuedOriginal, dispatchQueueMutation, messages, prefill,
  onPrefillConsumed, onDraftChange, onRemoveReference, captureSubmissionAuthority, onDraftController, confirmBeforeClose = true }: SideChatPanelProps) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [confirm, setConfirm] = useState(false), [frozen, setFrozen] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null), [newStarted, setNewStarted] = useState(false);
  const [, refreshDraft] = useState(0);
  const titleId = useId(), dialog = useRef<HTMLDialogElement>(null), composer = useRef<HTMLDivElement>(null);
  const draftController = useRef<ComposerDraftController | null>(null), freezing = useRef(false), gatePassed = useRef(false), openingNew = useRef(false);
  const activeBarrier = useRef<SideChatCloseBarrier | null>(null);
  const closed = useRef(false), mountedComposer = useRef(false), historyRef = useRef(history);
  const draftCallback = useRef(onDraftController); draftCallback.current = onDraftController;
  const receiveDraft = useCallback((value: ComposerDraftController | null) => {
    draftController.current = value; draftCallback.current?.(value);
  }, []);
  historyRef.current = history;
  const view = state.view, child = view?.child ?? null, childId = view?.childId ?? null;
  const ownedHistory = childId && history?.hostId === state.hostId && history.threadId === childId
    && (!history.thread || history.thread.id === childId) ? history : null;
  const ready = view?.fork.status === 'received' && view.inject.status === 'received' && !!child;
  if (ready && !mountedComposer.current && view?.close.status !== 'closed'
    && (!view?.close.requested && !state.pendingClose || ['prepare-failed', 'not-sent', 'rejected', 'unknown', 'cleanup-pending'].includes(view!.close.status)))
    mountedComposer.current = true;
  const showComposer = mountedComposer.current && !!child;
  const finishClose = () => { if (!closed.current) { closed.current = true; onClose(); } };

  useEffect(() => { if (!open) setConfirm(false); }, [open]);
  useEffect(() => {
    if (ownedHistory?.thread?.turns.some(turn => turn.items.length > 0)) controller.markActivity();
  }, [controller, ownedHistory]);
  useEffect(() => {
    if (state.phase === 'closed' && !closed.current && gatePassed.current) {
      finishClose();
    }
  }, [state.phase, onClose]);
  useEffect(() => {
    if (!state.view && state.phase === 'idle' && state.pendingClose && gatePassed.current && !closed.current) {
      finishClose();
    }
  }, [state.view, state.phase, state.pendingClose, onClose]);
  useEffect(() => {
    if (!confirm || !dialog.current) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    element.showModal();
    return () => { if (element.open) element.close(); previous?.focus(); };
  }, [confirm]);

  const restoreInputState = () => {
    const current = controller.getSnapshot(), currentView = current.view;
    const editable = currentView?.fork.status === 'received' && currentView.inject.status === 'received'
      && !!currentView.child && !current.pendingClose && !currentView.close.requested && current.phase !== 'closed';
    if (composer.current) composer.current.inert = !editable;
  };
  const barrier = async (): Promise<SideChatCloseBarrier> => {
    if (freezing.current) throw new Error('正在检查草稿。');
    freezing.current = true; gatePassed.current = false;
    if (composer.current) composer.current.inert = true;
    setFrozen(true); setLocalError(null);
    const current = controller.getSnapshot(), currentView = current.view, draft = draftController.current;
    const owner = { hostId: current.hostId, threadId: currentView?.childId ?? null, draftId: current.draftId };
    const scope: SideChatCloseBarrier = { hostId: current.hostId, parentThreadId: current.parentThreadId,
      childThreadId: currentView?.childId ?? null, operationId: currentView?.operationId ?? null, draftId: current.draftId, draftController: draft };
    try {
      // The parent's lease must freeze all owners before the first asynchronous drain.
      await onBeforeClose(scope);
      if (mountedComposer.current) {
        const snapshot = draft?.snapshot();
        if (!snapshot || snapshot.owner.hostId !== owner.hostId || snapshot.owner.threadId !== owner.threadId
          || snapshot.owner.draftId !== owner.draftId) throw new Error('侧聊草稿身份尚未就绪。');
        if (!await draft!.flush(owner)) throw new Error('侧聊草稿未能保存。');
      }
      if (mountedComposer.current && draftController.current !== draft) throw new Error('侧聊草稿身份已改变。');
      activeBarrier.current = scope; gatePassed.current = true;
      return scope;
    } catch (error) {
      try { onCloseBarrierAborted?.(scope); }
      catch { throw new Error('关闭屏障尚未解除；原侧聊和草稿已保留。', { cause: error }); }
      freezing.current = false; restoreInputState(); setFrozen(false);
      throw error;
    }
  };
  const releaseUndispatched = () => {
    const scope = activeBarrier.current;
    if (!scope || !onCloseBarrierAborted || !controller.cancelUndispatchedClose()) return;
    const exit = !!onExitObservation && canExitObservation?.(scope) === true;
    onCloseBarrierAborted(scope);
    activeBarrier.current = null; gatePassed.current = false; freezing.current = false;
    restoreInputState(); setFrozen(false);
    if (exit) onExitObservation?.();
  };
  const close = async () => {
    if (freezing.current) return;
    try {
      await barrier();
      const current = controller.getSnapshot();
      if (current.phase === 'closed') { finishClose(); return; }
      if (!current.view && current.phase !== 'preparing') { finishClose(); return; }
      await controller.close();
      if (controller.getSnapshot().phase === 'closed') finishClose(); else releaseUndispatched();
    } catch (error) { setLocalError('无法关闭侧聊，草稿已保留：' + (error instanceof Error ? error.message : String(error))); }
  };
  const requestClose = () => {
    if (confirmBeforeClose && state.hasActivity && !state.pendingClose && !view?.close.requested) setConfirm(true);
    else void close();
  };
  const continueOperation = async (persistence = false) => {
    const current = controller.getSnapshot();
    try {
      if ((current.pendingClose || current.view?.close.requested) && !gatePassed.current) await barrier();
      if (controller.getSnapshot().phase === 'closed') { finishClose(); return; }
      if (persistence) await controller.retryPersistence(); else await controller.retry();
      if (controller.getSnapshot().phase === 'closed') finishClose(); else releaseUndispatched();
    } catch (error) { setLocalError('无法继续关闭，草稿已保留：' + (error instanceof Error ? error.message : String(error))); }
  };
  const openNew = async () => {
    const current = controller.getSnapshot();
    if (openingNew.current || !onOpenNew || !current.view) return;
    openingNew.current = true;
    setNewStarted(true); setLocalError(null);
    try {
      await onOpenNew({ hostId: current.hostId, parentThreadId: current.parentThreadId,
        operationId: current.view.operationId, draftId: current.draftId, childThreadId: current.view.childId });
    } catch (error) {
      const unsent = error && typeof error === 'object' && 'uncertain' in error && error.uncertain === false;
      if (unsent) { openingNew.current = false; setNewStarted(false); }
      setLocalError((unsent ? '新侧聊尚未打开，原侧聊和草稿已保留：' : '无法确认新侧聊是否已打开，原侧聊和草稿已保留：')
        + (error instanceof Error ? error.message : String(error)));
    }
  };
  const thread = ownedHistory?.thread ?? null, activeTurn = thread?.turns?.find(turn => turn.status === 'inProgress')?.id ?? null;
  const busy = isThreadBusy(thread);
  const canEdit = !!ready && !state.pendingClose && !view?.close.requested && state.phase !== 'closed' && !frozen;
  const retryable = controller.canRetry;
  const errors = [localError, state.error, view?.recoveryError, view?.close.error, view?.inject.error, view?.fork.error, ownedHistory?.error]
    .filter((value, index, all): value is string => !!value && all.indexOf(value) === index);
  const hasError = errors.length > 0;
  return <section className="yard-side-chat" aria-label="侧聊" hidden={!open}>
    <header className="yard-side-chat__header"><strong>侧聊</strong><button type="button" className="yard-side-chat__icon"
      title="关闭侧聊" aria-label="关闭侧聊" onClick={requestClose} disabled={frozen}><X size={16} /></button></header>
    {state.phase === 'idle' ? <div className="yard-side-chat__status"><button type="button" onClick={() => void controller.start()}>{prepareResultUnknown ? '核对准备结果' : '打开侧聊'}</button></div> : null}
    {['preparing', 'starting', 'forking', 'injecting', 'closing'].includes(state.phase)
      ? <div className="yard-side-chat__status" role="status">{state.pendingClose || view?.close.requested ? '正在关闭侧聊…' : '正在准备侧聊…'}</div> : null}
    {state.phase === 'closing' && state.pendingClose && !view?.close.requested && retryable
      ? <div className="yard-side-chat__status"><button type="button" onClick={() => void continueOperation()}>继续关闭</button></div> : null}
    {state.phase === 'closing' && view?.close.status === 'cleanup-pending' && retryable && !hasError
      ? <div className="yard-side-chat__status"><button type="button" onClick={() => void continueOperation()}>继续清理</button></div> : null}
    {state.phase === 'waiting' ? <div className="yard-side-chat__status">侧聊尚未创建。
      {retryable && !hasError ? <button type="button" onClick={() => void continueOperation()}>继续操作</button> : null}</div> : null}
    {state.phase === 'injecting' && view?.inject.status === 'waiting' && retryable && !hasError
      ? <div className="yard-side-chat__status"><button type="button" onClick={() => void continueOperation()}>继续设置</button></div> : null}
    {hasError || state.phase.endsWith('-unknown') || ['fork-failed', 'inject-failed', 'close-failed', 'link-failed'].includes(state.phase) ?
      <div className="yard-side-chat__status" role="alert">{hasError ? errors.map(error => <p key={error}>{error}</p>) : '宿主未能完成此侧聊操作。'}
        {state.phase.endsWith('-unknown') ? <p>原操作结果未知，记录和草稿已保留。</p> : null}
        {view ? <button type="button" onClick={() => void controller.read()}>核对结果</button> : null}
        {retryable ? <button type="button" onClick={() => void continueOperation()}>继续操作</button> : null}
        {ownedHistory?.error ? <button type="button" onClick={() => void ownedHistory.retry()}>重试加载</button> : null}
      </div> : null}
    {view && (hasError || ['forking', 'injecting', 'closing', 'close-unknown', 'fork-unknown', 'inject-unknown'].includes(state.phase))
      ? <div className="yard-side-chat__status"><button type="button" disabled={!controller.canRetryPersistence}
        onClick={() => void continueOperation(true)}>重试保存回执</button></div> : null}
    {view && onOpenNew ? <div className="yard-side-chat__status"><button type="button" disabled={newStarted}
      onClick={() => void openNew()}>另开侧聊</button></div> : null}
    {state.phase === 'closed' && !gatePassed.current
      ? <div className="yard-side-chat__status" role="alert">宿主已关闭此侧聊。请检查保留的草稿后关闭面板。</div> : null}
    {child && !ownedHistory ? <div className="yard-side-chat__notice" role="status">正在等待该侧聊的会话投影。</div> : null}
    {ownedHistory?.loading ? <div className="yard-side-chat__notice" role="status">正在加载会话历史…</div> : null}
    {ownedHistory?.streamGap ? <div className="yard-side-chat__notice" role="status">部分进行中的内容尚未收到。</div> : null}
    {child ? <div className="yard-side-chat__messages">{thread && (ownedHistory?.historyComplete || thread.turns.length > 0)
      ? <StandaloneMessages client={client} hostId={state.hostId} thread={thread} {...messages} /> : null}</div> : null}
    {!canEdit && view ? <DraftInspection owner={{ hostId: state.hostId, threadId: childId, draftId: state.draftId }}
      getCurrent={() => draftController.current?.snapshot() ?? null} /> : null}
    {showComposer && child ? <div className="yard-side-chat__composer" ref={composer} inert={!canEdit} hidden={!canEdit} aria-busy={frozen || undefined}>
      <StandaloneComposer client={client}
        context={{ hostId: state.hostId, threadId: child.thread.id, cwd: view!.parent.cwd, draftId: state.draftId, placement: 'side-chat' }}
        busy={busy} activeTurnId={activeTurn} initialOptions={ownedHistory?.options ?? child.options}
        onDraftController={receiveDraft} onDraftChange={value => { refreshDraft(revision => revision + 1); onDraftChange?.(value); }}
        captureSubmissionAuthority={captureSubmissionAuthority}
        onRemoveReference={onRemoveReference} prefill={prefill} onPrefillConsumed={onPrefillConsumed}
        {...(dispatchQueueMutation ? { dispatchQueueMutation } : {})}
        {...(removeQueuedOriginal ? { removeQueuedOriginal: (entry: SideChatQueueEntry, authority: () => void, beforeSend: () => void) => {
          const current = controller.getSnapshot();
          if (current.phase !== 'ready' || current.pendingClose || current.view?.childId !== child.thread.id)
            throw localRejection('侧聊队列目标已改变。');
          return removeQueuedOriginal(entry, { hostId: current.hostId, parentThreadId: current.parentThreadId,
            operationId: current.view.operationId, draftId: current.draftId, childThreadId: child.thread.id }, authority, beforeSend);
        } } : {})}
        onStartQueued={onStartQueued ? async (id, authority, originalAuthority?: () => void) => {
          const latest = controller.getSnapshot(), currentHistory = historyRef.current;
          if (freezing.current || latest.phase !== 'ready' || latest.pendingClose || latest.view?.childId !== child.thread.id
            || currentHistory?.hostId !== state.hostId || currentHistory.threadId !== child.thread.id || !currentHistory.canSubmit
            || currentHistory.thread?.id !== child.thread.id || currentHistory.error || currentHistory.loading
            || !(currentHistory.liveReady ?? currentHistory.historyComplete) || currentHistory.streamGap
            || currentHistory.thread.status?.type !== 'idle' || isThreadBusy(currentHistory.thread)) throw localRejection('侧聊尚未就绪或正在运行。');
          await onStartQueued(id, { hostId: latest.hostId, parentThreadId: latest.parentThreadId,
            operationId: latest.view.operationId, draftId: latest.draftId, childThreadId: child.thread.id }, authority, originalAuthority);
        } : undefined}
        onInterrupt={async () => { const latest = historyRef.current, current = controller.getSnapshot();
          if (!activeTurn || freezing.current || current.phase !== 'ready' || current.pendingClose || current.view?.childId !== child.thread.id
            || latest?.hostId !== state.hostId || latest.threadId !== child.thread.id || latest.thread?.id !== child.thread.id
            || latest.loading || latest.error || !latest.canInterrupt
            || !latest.thread.turns.some(turn => turn.id === activeTurn && turn.status === 'inProgress'))
            throw localRejection('当前连接没有可确认的运行任务。');
          await onInterrupt({ hostId: current.hostId, parentThreadId: current.parentThreadId, operationId: current.view.operationId,
            draftId: current.draftId, childThreadId: child.thread.id, turnId: activeTurn }); }}
        onSubmit={async (draft, options, action, description, authority) => {
          const current = controller.getSnapshot(), latestHistory = historyRef.current, owner = description?.owner, draftSession = draftController.current;
          if (freezing.current || current.phase !== 'ready' || current.pendingClose || current.view?.childId !== child.thread.id
            || !latestHistory || latestHistory.hostId !== current.hostId || latestHistory.threadId !== child.thread.id
            || latestHistory.thread?.id !== child.thread.id || !latestHistory.canSubmit || latestHistory.error || latestHistory.loading
            || !(latestHistory.liveReady ?? (latestHistory.historyComplete || isThreadBusy(latestHistory.thread))) || latestHistory.streamGap
            || action.type === 'send' && (isThreadBusy(latestHistory.thread) || latestHistory.thread.status?.type !== 'idle')
            || action.type === 'steer' && !latestHistory.thread.turns.some(turn => turn.id === action.turnId && turn.status === 'inProgress')
            || action.type === 'queue' && !isThreadBusy(latestHistory.thread)) throw localRejection('侧聊尚未就绪或正在关闭，草稿已保留。');
          if (!description || !draftSession || owner?.hostId !== current.hostId || owner.threadId !== child.thread.id || owner.draftId !== current.draftId)
            throw localRejection('侧聊草稿身份尚未就绪。');
          controller.markActivity();
          await onSubmit(description, draft, options, action, draftSession, authority);
        }} />
    </div> : null}
    {confirm ? <dialog className="yard-side-chat__dialog" ref={dialog} onCancel={event => { event.preventDefault(); setConfirm(false); }}
      aria-labelledby={titleId}><h2 id={titleId}>关闭侧聊？</h2><p>关闭后此临时侧聊可能无法恢复。</p><div className="yard-side-chat__dialog-actions">
        <button type="button" autoFocus onClick={() => setConfirm(false)}>取消</button>
        <button type="button" onClick={() => { setConfirm(false); void close(); }}>关闭侧聊</button>
      </div></dialog> : null}
  </section>;
}
