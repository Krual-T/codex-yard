import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { X } from 'lucide-react';
import { StandaloneComposer } from '../composer/StandaloneComposer.tsx';
import type { ComposerDraftController, ComposerSubmissionDescription, StandaloneComposerRuntimeProps } from '../composer/StandaloneComposer.tsx';
import { StandaloneMessages } from '../messages/StandaloneMessages.tsx';
import { isThreadBusy } from '../app/thread-state.ts';
import type { ComposerDraft, StandaloneMessagesProps, SubmitAction, SubmitOptions, WorkbenchClient } from '../workbench-contract.ts';
import type { SideChatController } from './controller.ts';
import { useSideThread } from './use-side-thread.ts';
import type { RestoreSideChatSubscription } from './use-side-thread.ts';
import './side-chat.css';

export interface SideChatPanelProps {
  client: WorkbenchClient;
  controller: SideChatController;
  open: boolean;
  onClose(): void;
  onSubmit(description: ComposerSubmissionDescription, draft: ComposerDraft, options: SubmitOptions,
    action: SubmitAction, controller: ComposerDraftController): Promise<void>;
  onRestoreSubscription?: RestoreSideChatSubscription;
  onReplaceExpired?(scope: { hostId: string; parentThreadId: string; childThreadId: string; draftId: string }): void;
  onStartQueued?(id: string, scope: { hostId: string; threadId: string }): Promise<void>;
  messages?: Omit<StandaloneMessagesProps, 'client' | 'hostId' | 'thread'>;
  prefill?: StandaloneComposerRuntimeProps['prefill'];
  onPrefillConsumed?: StandaloneComposerRuntimeProps['onPrefillConsumed'];
  onDraftChange?: StandaloneComposerRuntimeProps['onDraftChange'];
  onRemoveReference?: StandaloneComposerRuntimeProps['onRemoveReference'];
  confirmBeforeClose?: boolean;
}

export function SideChatPanel(props: SideChatPanelProps) {
  if (!props.open) return null;
  const { parent, draftId } = props.controller.getSnapshot();
  return <SideChatSession key={JSON.stringify([parent.hostId, parent.threadId, draftId])} {...props} />;
}

function SideChatSession({ client, controller, open, onClose, onSubmit, onRestoreSubscription, onReplaceExpired, onStartQueued, messages, prefill,
  onPrefillConsumed, onDraftChange, onRemoveReference, confirmBeforeClose = true }: SideChatPanelProps) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => { controller.watchConnection(client); }, [client, controller]);
  const projection = useSideThread(client, controller, state.phase === 'ready' ? state.thread : null, onRestoreSubscription);
  const [confirm, setConfirm] = useState(false);
  const [replaceStarted, setReplaceStarted] = useState(false), [replaceError, setReplaceError] = useState<string | null>(null);
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null), draftController = useRef<ComposerDraftController | null>(null), replacing = useRef(false);
  const closed = useRef(false);
  useEffect(() => {
    if (state.phase === 'closed' && !closed.current) { closed.current = true; onClose(); }
  }, [state.phase, onClose]);
  useEffect(() => {
    if (!confirm || !dialog.current) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    element.showModal();
    return () => { if (element.open) element.close(); previous?.focus(); };
  }, [confirm]);
  if (!open) return null;
  const activeTurn = projection.thread?.turns?.find(turn => turn.status === 'inProgress')?.id ?? null;
  const requestClose = () => {
    if (state.kind === 'temporary' && confirmBeforeClose && state.hasActivity && !state.closeRequested) setConfirm(true);
    else void controller.close(activeTurn);
  };
  const busy = isThreadBusy(projection.thread);
  const error = state.error || projection.error;
  const unknown = state.phase.endsWith('-unknown');
  const failed = state.phase.endsWith('-failed');
  return <section className="yard-side-chat" aria-label="侧聊">
    <header className="yard-side-chat__header"><strong>侧聊</strong><button type="button" className="yard-side-chat__icon"
      title="关闭侧聊" aria-label="关闭侧聊" onClick={requestClose}><X size={16} /></button></header>
    {state.phase === 'idle' ? <div className="yard-side-chat__status"><button type="button" onClick={() => void controller.start()}>打开侧聊</button></div> : null}
    {state.phase === 'forked' ? <div className="yard-side-chat__status" role="status">{state.closeRequested ? '侧聊已创建，关闭尚未完成。' : '侧聊已创建，尚未设置隔离边界。'}
      <button type="button" onClick={() => void controller.retry()}>{state.closeRequested ? '继续关闭' : '继续设置'}</button></div> : null}
    {['creating', 'boundary', 'preparing-close', 'discarding', 'interrupting', 'cleaning'].includes(state.phase)
      ? <div className="yard-side-chat__status" role="status">{state.closeRequested ? '正在关闭侧聊…' : '正在准备侧聊…'}</div> : null}
    {error ? <div className="yard-side-chat__status" role="alert">{error}
      {unknown ? <><p>操作结果未知，已保留原请求。核对后才能继续。</p>
        {controller.canReconcile ? <button type="button" onClick={() => void controller.reconcile()}>核对结果</button> : <p>宿主尚未提供原请求核对能力。</p>}</> : null}
      {failed ? <button type="button" onClick={() => void controller.retry()}>重试</button> : null}
      {['close-failed', 'discard-failed'].includes(state.phase) ? <button type="button" onClick={() => controller.reopen()}>继续侧聊</button> : null}
      {state.phase === 'ready' && projection.error && !projection.expired ? <button type="button" onClick={projection.retry}>重试加载</button> : null}
      {projection.expired && state.thread ? onReplaceExpired ? <button type="button" disabled={replaceStarted} onClick={() => {
        if (replacing.current) return;
        replacing.current = true; setReplaceStarted(true); setReplaceError(null);
        try { onReplaceExpired({ hostId: state.parent.hostId, parentThreadId: state.parent.threadId, childThreadId: state.thread!.id, draftId: state.draftId }); }
        catch (error) { replacing.current = false; setReplaceStarted(false); setReplaceError(error instanceof Error ? error.message : String(error)); }
      }}>开始新侧聊</button> : <p>宿主尚未接入新侧聊入口。</p> : null}
      {replaceError ? <p role="alert">{replaceError}</p> : null}
    </div> : null}
    {state.phase === 'ready' && !state.closeRequested && projection.thread ? <>
      {projection.loading ? <div className="yard-side-chat__notice" role="status">正在加载会话历史…</div> : null}
      {projection.streamGap ? <div className="yard-side-chat__notice" role="status">部分进行中的内容尚未收到，完成后将重新加载。</div> : null}
      <div className="yard-side-chat__messages">{projection.complete || projection.thread.turns.length > 0
        ? <StandaloneMessages client={client} hostId={state.parent.hostId} thread={projection.thread} {...messages} /> : null}</div>
      {projection.complete || busy && !projection.error ? <StandaloneComposer client={client}
        context={{ hostId: state.parent.hostId, threadId: state.thread!.id, cwd: state.parent.cwd, draftId: state.draftId, placement: 'side-chat' }}
        busy={busy} activeTurnId={activeTurn} initialOptions={state.childOptions}
        onDraftController={value => { draftController.current = value; }} onDraftChange={onDraftChange}
        onRemoveReference={onRemoveReference} prefill={prefill} onPrefillConsumed={onPrefillConsumed}
        onStartQueued={onStartQueued ? id => onStartQueued(id, { hostId: state.parent.hostId, threadId: state.thread!.id }) : undefined}
        onInterrupt={async () => { if (!activeTurn) throw new Error('当前任务没有可确认的 turn ID。');
          await client.rpc('turn/interrupt', { threadId: state.thread!.id, turnId: activeTurn }, state.parent.hostId); }}
        onSubmit={async (draft, options, action, description) => {
          const owner = description?.owner, draftSession = draftController.current;
          const current = controller.getSnapshot();
          if (current.phase !== 'ready' || current.closeRequested || current.thread?.id !== state.thread!.id || !projection.canSubmit())
            throw new Error('侧聊正在关闭，草稿已保留。');
          if (!description || !draftSession || owner?.hostId !== state.parent.hostId || owner.threadId !== state.thread!.id || owner.draftId !== state.draftId)
            throw new Error('侧聊草稿身份尚未就绪。');
          controller.markActivity();
          await onSubmit(description, draft, options, action, draftSession);
        }} /> : null}
    </> : null}
    {confirm ? <dialog className="yard-side-chat__dialog" ref={dialog} onCancel={event => { event.preventDefault(); setConfirm(false); }}
      aria-labelledby={titleId}><h2 id={titleId}>关闭侧聊？</h2>
      <p>{state.kind === 'durable' ? '关闭侧聊面板？' : '关闭后此临时侧聊将无法恢复。'}</p><div className="yard-side-chat__dialog-actions">
        <button type="button" autoFocus onClick={() => setConfirm(false)}>取消</button>
        <button type="button" onClick={() => { setConfirm(false); void controller.close(activeTurn); }}>关闭侧聊</button>
      </div></dialog> : null}
  </section>;
}
