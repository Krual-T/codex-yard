import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ComposerDraft, MessageEditOrigin, SubmitAction, SubmitOptions, WorkbenchClient, WorkbenchDispatchOptions } from '../workbench-contract.ts';
import type { ComposerDraftController, ComposerDraftLease, ComposerDraftOwner, ComposerSubmissionDescription, StandaloneComposerRuntimeProps } from '../composer/StandaloneComposer.tsx';
import { saveComposerDraftConflict } from '../composer/composer-draft-store.ts';
import { normalizeDraft } from '../composer/standalone-draft.ts';
import type { MessageEditNavigationController, MessageEditNavigationLease } from '../messages/StandaloneMessages.tsx';
import type { MessageOutputPreviewAuthority } from '../messages/MessageOutputPreviews.tsx';
import { SideChatPanel } from '../side-chat/SideChatPanel.tsx';
import type { SideChatActiveChildScope, SideChatCloseBarrier, SideChatChildScope, SideChatInterruptScope, SideChatQueueEntry, SideChatQueueMutation } from '../side-chat/SideChatPanel.tsx';
import type { SideChatBrowserIdentity, SideChatChildDispatchAuthority, SideChatSendLease } from '../side-chat/browser-authority.ts';
import type { SideChatHistory } from '../side-chat/types.ts';
import { ApprovalDialog } from './ApprovalDialog.tsx';
import type { ApprovalDialogProps } from './ApprovalDialog.tsx';
import { useConversationSession } from './conversation-sessions.ts';
import type { ConversationSessions } from './conversation-sessions.ts';
import { sendConversationDraft, finishConversationSend } from './conversation-send.ts';
import type { ConversationWriteMethod } from './conversation-send.ts';
import { messageEditChanged, messageEditRebaseMarker } from './message-edit-recovery.ts';
import type { MessageEditRecoveryStore, StoredMessageEdit } from './message-edit-recovery.ts';
import { SendRecoveryNotice } from './SendRecoveryNotice.tsx';
import { sendsAtom } from './send-recovery.ts';
import type { SendIntent, SendRecoverySnapshot, SendRecoveryStore } from './send-recovery.ts';
import type { SendInjectionAuthority } from './send-injection-client.ts';
import { submitDraft } from './submission.ts';
import { isThreadBusy } from './thread-state.ts';
import { SideChatWorkspaceRuntime } from './side-chat-workspace-runtime.ts';
import type { SideChatWorkspaceIdentity } from './side-chat-workspace-runtime.ts';
import type { ApprovalRequestsController } from './approval-requests.ts';
import type { VisualizationFollowUp } from '../visualizations/index.tsx';

export interface SideChatWorkspaceNavigationLease {
  flush(): Promise<boolean>;
  /** Confirm revocation before committing a route or owner change. */
  revoke(): Promise<void>;
  /** Call only after the route/owner change actually committed. */
  handoff(): void;
  /** Cancels navigation; an uncertain revocation must first be resolved. */
  release(): void;
}
export interface SideChatWorkspaceNavigationController {
  freeze(): SideChatWorkspaceNavigationLease | null;
  /** Reconfirm only this original live child after a completed local switch or cancelled navigation. */
  activate(): Promise<void>;
  /** Submit the confirmed widget request through this child's original sender. */
  submitVisualization(request: VisualizationFollowUp, signal: AbortSignal): Promise<void>;
}
export type { SideChatQueueMutation } from '../side-chat/SideChatPanel.tsx';
export type SideChatWriteDispatch = <T>(method: ConversationWriteMethod, params: Record<string, unknown>, hostId: string,
  assertBeforeSend: () => void, originalAuthority: (() => void) | null) => Promise<T>;
export interface SideChatWorkspaceProjection {
  childThreadId: string | null;
  title: string | null;
  working: boolean | null;
}
export interface SideChatWorkspaceProps {
  client: WorkbenchClient;
  identity: SideChatWorkspaceIdentity;
  open: boolean;
  /** The parent has already received an explicit open action. */
  startOnMount?: boolean;
  sessions: ConversationSessions;
  sends: SendRecoveryStore;
  edits: MessageEditRecoveryStore;
  approvals: ApprovalRequestsController;
  /** Fixed original page, parent, socket generation, and owner; synchronous and valid while its lease is held. */
  assertCurrent(): void;
  /** Checks the original mounted workspace independently of its daemon grant. */
  assertMounted?(): void;
  /** Blocks new same-draft owners and sends across views synchronously; drains their real pending work. */
  freezeSending(owner: ComposerDraftOwner, purpose?: 'cancel', disconnectedHandoff?: () => void): SideChatSendLease;
  /** Captures the original owner and connection synchronously at the input action. */
  captureSubmissionAuthority(owner: ComposerDraftOwner, childAuthority?: SideChatChildDispatchAuthority): () => void;
  /** Resolve the same synchronously captured grant, without obtaining a newer connection. */
  nativeInjectionAuthority?(originalAuthority: () => void, owner: ComposerDraftOwner): SendInjectionAuthority;
  /** SideChatRoot rejects a null legacy authority; writes require the grant captured at the original action. */
  dispatchSubmission: SideChatWriteDispatch;
  /** Serialize with all writes for this host/thread and guard the original daemon socket at dispatch. */
  dispatchQueueMutation<T>(method: SideChatQueueMutation, params: Record<string, unknown>, hostId: string,
    originalAuthority: () => void, assertAuthority: () => void, onLateTerminal?: WorkbenchDispatchOptions['onLateTerminal']): Promise<T>;
  /** Compare and delete the complete entry under the same Yard queue and the original connection. */
  removeQueuedOriginal?(scope: SideChatActiveChildScope, entry: SideChatQueueEntry, originalAuthority: () => void,
    assertBeforeSend: () => void): Promise<'deleted' | 'changed'>;
  /** Guard this exact operation, child, turn, and original daemon socket at dispatch. */
  interruptTurn(scope: SideChatInterruptScope, assertAuthority: () => void, originalAuthority: () => void): Promise<void>;
  /** The original captured grant and this cancellation's held owner lease must both remain current. */
  cancelSend(intent: SendIntent, assertAuthority: () => void, originalAuthority: () => void): Promise<void>;
  /** Local resources only; must not unsubscribe or change the draft association. */
  cleanupChild(identity: SideChatBrowserIdentity): Promise<void>;
  onNavigationController(controller: SideChatWorkspaceNavigationController | null): void;
  /** This is a notification, not permission to unmount without the navigation lease. */
  onClosed(): void;
  /** This page did not dispatch close; the host operation and its draft remain intact. */
  onExitObservation(): void;
  onOpenNew?(scope: SideChatChildScope): void | Promise<void>;
  onDraftController?: StandaloneComposerRuntimeProps['onDraftController'];
  onDraftChange?: StandaloneComposerRuntimeProps['onDraftChange'];
  /** Read-only metadata from this workspace's existing conversation projection. */
  onProjectionChange?(projection: SideChatWorkspaceProjection): void;
  onRemoveReference?: StandaloneComposerRuntimeProps['onRemoveReference'];
  onEditNavigationController?(controller: MessageEditNavigationController | null): void;
  onOpenFile?(location: { hostId: string; threadId: string; path: string; cwd?: string; line?: number; column?: number;
    assertCurrent?: () => void }): void;
  /** Read-only project facts and the original page/connection; the workspace adds its own child guard. */
  outputPreviewAuthority?(identity: SideChatWorkspaceIdentity, threadId: string, cwd: string): MessageOutputPreviewAuthority;
  onOpenBrowser?(value: { hostId: string; threadId: string; url?: string; source?: 'link' }): void;
  onOpenVisualization?(value: { hostId: string; threadId: string; path: string }): void;
  approvalOptions?: Partial<Omit<ApprovalDialogProps, 'request' | 'onRespond' | 'onUnsupported' | 'onCloseView' | 'onInputEscape'>>;
}

const notSent = (message: string) => Object.assign(new Error(message), { uncertain: false as const });
const text = (error: unknown) => error instanceof Error ? error.message : String(error);
const sameOwner = (a: ComposerDraftOwner, b: ComposerDraftOwner) => a.hostId === b.hostId && a.threadId === b.threadId && a.draftId === b.draftId;
function sync(value: unknown): void {
  if (value && (typeof value === 'object' || typeof value === 'function') && 'then' in value
    && typeof value.then === 'function') {
    void Promise.resolve(value).catch(() => {});
    throw notSent('原权限检查必须同步完成。');
  }
}

/** One instance must remain mounted for its original draft until the parent commits a fenced handoff. */
export function SideChatWorkspace(props: SideChatWorkspaceProps) {
  const latest = useRef(props); latest.current = props;
  const identity = useRef(structuredClone(props.identity));
  const draft = useRef<ComposerDraftController | null>(null);
  const retryInitialization = useRef<(() => void) | null>(null);
  const [runtime, setRuntime] = useState<SideChatWorkspaceRuntime | null>(null);
  const [failure, setFailure] = useState(''), [initializing, setInitializing] = useState(true);
  useEffect(() => {
    let active = true;
    const fixed = identity.current, initial = latest.current;
    const assertIdentity = () => {
      const now = latest.current;
      if (!active || now.client !== initial.client || now.sessions !== initial.sessions || now.sends !== initial.sends || now.edits !== initial.edits
        || now.approvals !== initial.approvals || now.identity.hostId !== fixed.hostId || now.identity.parentThreadId !== fixed.parentThreadId
        || now.identity.draftId !== fixed.draftId || now.identity.prepareId !== fixed.prepareId || now.identity.cwd !== fixed.cwd
        || now.identity.mode !== fixed.mode) throw notSent('原侧聊工作区已改变。');
    };
    const assertMounted = () => {
      assertIdentity(); const now = latest.current;
      if (!now.assertMounted) throw notSent('原侧聊挂载身份尚未确认。');
      sync(now.assertMounted());
    };
    const assertCurrent = () => {
      const now = latest.current;
      if (initial.assertMounted) assertMounted(); else assertIdentity();
      sync(now.assertCurrent());
    };
    const source = new SideChatWorkspaceRuntime({ client: initial.client, identity: fixed, sessions: initial.sessions, sends: initial.sends,
      assertCurrent, ...(initial.assertMounted ? { assertMounted } : {}),
      draftController: () => draft.current, freezeSending: owner => latest.current.freezeSending(owner),
      cleanupChild: async child => {
        assertCurrent();
        const view = source.controller?.getSnapshot().view, receipt = view?.fork.receipt;
        if (!view || view.operationId !== child.operationId || view.childId !== child.childThreadId || !receipt) throw new Error('原侧聊清理身份无法确认。');
        await latest.current.cleanupChild(child); assertCurrent();
        if (!initial.sessions.invalidateEphemeral({ hostId: child.hostId, parentThreadId: child.parentThreadId, parentCwd: child.parentCwd,
          operationId: child.operationId, connectionGeneration: child.connectionGeneration, forkDispatchId: receipt.attemptId }, child.childThreadId!)) {
          throw new Error('原侧聊会话投影无法确认清理。');
        }
      } });
    let inFlight = false;
    const initialize = () => {
      if (!active || inFlight) return;
      inFlight = true; setInitializing(true); setFailure('');
      void source.initialize().then(() => { if (active) setRuntime(source); })
        .catch(error => { if (active) setFailure(text(error)); })
        .finally(() => { inFlight = false; if (active) setInitializing(false); });
    };
    retryInitialization.current = initialize; initialize();
    return () => {
      active = false; retryInitialization.current = null;
      try { source.dispose(); } catch { /* A forced unmount cannot confer a handoff or erase IDB. */ }
    };
  }, []);
  if (!runtime || !runtime.controller) return <section aria-label="侧聊">{failure ? <div role="alert"><p>{failure} 原草稿已保留。</p>
    <button type="button" disabled={initializing} onClick={() => retryInitialization.current?.()}>重试读取草稿</button></div>
    : <p role="status">正在读取侧聊草稿…</p>}</section>;
  return <SideChatWorkspaceSession {...props} runtime={runtime} original={identity.current} draft={draft} />;
}

function SideChatWorkspaceSession(props: SideChatWorkspaceProps & { runtime: SideChatWorkspaceRuntime; original: SideChatWorkspaceIdentity;
  draft: React.RefObject<ComposerDraftController | null> }) {
  const latest = useRef(props); latest.current = props;
  const { runtime, original, client, sessions, sends, edits, approvals, draft } = props;
  const controller = runtime.controller!;
  const autoStarted = useRef(false);
  useEffect(() => {
    if (props.startOnMount && original.mode === 'new' && !autoStarted.current) {
      autoStarted.current = true; void controller.start();
    }
  }, [controller, original.mode, props.startOnMount]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const childId = state.view?.childId ?? null;
  const identity = childId ? { hostId: original.hostId, threadId: childId } : null;
  useSyncExternalStore(runtime.subscribeProjection, runtime.projectionSnapshot, runtime.projectionSnapshot);
  const conversation = useConversationSession(sessions, identity, false, !!childId && runtime.bridge.hasLiveChild(childId), 0);
  const projectedThread = conversation.thread?.id === childId ? conversation.thread : null;
  const receiptThread = state.view?.child?.thread.id === childId ? state.view.child.thread : null;
  const threadName = (projectedThread ?? receiptThread)?.name?.trim() || null;
  const working = projectedThread && conversation.liveReady && !conversation.loading && !conversation.error && !conversation.streamGap
    && (projectedThread.status?.type === 'idle' || projectedThread.status?.type === 'active') ? isThreadBusy(projectedThread) : null;
  useEffect(() => { latest.current.onProjectionChange?.({ childThreadId: childId, title: threadName, working }); }, [childId, threadName, working]);
  const editAccess = useMemo(() => edits.createAccess(), [edits]);
  const editor = useRef<MessageEditNavigationController | null>(null);
  const locked = useRef(false), mounted = useRef(true), active = useRef(0), waiters = useRef<Set<() => void>>(new Set());
  const approvalNode = useRef<HTMLDivElement>(null), approvalActions = useRef(new Set<string>());
  const closeEdit = useRef<{ lease: MessageEditNavigationLease | null; releaseAcquisition: () => void } | null>(null);
  const closeHostFreeze = useRef<(() => void) | null>(null);
  const closeScope = useRef<SideChatCloseBarrier | null>(null), finishingClose = useRef(false), closedNotified = useRef(false);
  const authorizationLease = useRef<SideChatWorkspaceNavigationLease | null>(null), authorizing = useRef(false);
  const authorities = useRef(new WeakMap<() => void, () => void>());
  const [error, setError] = useState(''), [sendState, setSendState] = useState<SendRecoverySnapshot | null>(null);
  const [closeCompletionPending, setCloseCompletionPending] = useState(false);
  const [authorizationRecovery, setAuthorizationRecovery] = useState(false);
  const [edit, setEdit] = useState<{ childId: string; value: StoredMessageEdit | null } | null>(null);
  const [revision, setRevision] = useState(0), [hiddenApproval, setHiddenApproval] = useState<string | null>(null);
  const requests = useSyncExternalStore(approvals.subscribe, approvals.getSnapshot, approvals.getSnapshot);
  const request = requests.find(item => item.request.hostId === original.hostId && item.request.params.threadId === childId && item.current);
  const requestKey = request && JSON.stringify(request.request.ref);
  const approval = request && requestKey !== hiddenApproval ? approvals.dialog(request.request.ref) : null;
  const report = useCallback((cause: unknown) => { if (mounted.current) setError(text(cause)); }, []);
  const changed = useCallback(() => { if (mounted.current) setRevision(value => value + 1); }, []);
  const drain = () => active.current ? new Promise<void>(resolve => { waiters.current.add(resolve); }) : Promise.resolve();
  const setLocked = (value: boolean) => { locked.current = value; if (approvalNode.current) approvalNode.current.inert = value; };
  const endTask = () => { if (--active.current === 0) { for (const resolve of waiters.current) resolve(); waiters.current.clear(); } };
  const task = async <T,>(work: () => Promise<T>): Promise<T> => {
    if (locked.current) throw notSent('侧聊正在冻结，原输入已保留。');
    active.current++;
    try { return await work(); }
    finally { endTask(); }
  };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let current = true;
    void sends.read().then(value => { if (current) setSendState(value); }).catch(report);
    return () => { current = false; };
  }, [sends, revision, report]);
  useEffect(() => {
    if (!childId) { setEdit(null); return; }
    let current = true, sequence = 0;
    const read = () => { const version = ++sequence; void edits.read(original.hostId, childId).then(value => {
      if (current && version === sequence) setEdit({ childId, value });
    }).catch(report); };
    read(); window.addEventListener(messageEditChanged, read);
    return () => { current = false; window.removeEventListener(messageEditChanged, read); };
  }, [edits, original.hostId, childId, revision, report]);
  useEffect(() => client.subscribe(event => {
    if (event.type === 'persisted-atom-updated' && (!Array.isArray(event.keys) || !event.keys.length || event.keys.includes(sendsAtom))) changed();
  }), [client, changed]);

  const currentOwner = (): ComposerDraftOwner => ({ hostId: original.hostId, threadId: controller.getSnapshot().view?.childId ?? null, draftId: original.draftId });
  const assertOriginal = () => { runtime.assertScope(); if (!mounted.current) throw notSent('原侧聊工作区已卸载。'); };
  const parentOutputAuthority = childId && props.outputPreviewAuthority?.(original, childId, conversation.thread?.cwd ?? original.cwd);
  const outputPreviewAuthority: MessageOutputPreviewAuthority | undefined = parentOutputAuthority ? {
    ...parentOutputAuthority,
    sourceKey: JSON.stringify([parentOutputAuthority.sourceKey, original.prepareId, original.draftId, childId]),
    assertCurrent() {
      parentOutputAuthority.assertCurrent(); assertOriginal();
      if (locked.current || currentOwner().threadId !== childId) throw notSent('原侧聊文件来源已改变。');
    },
  } : undefined;
  const capture = (owner: ComposerDraftOwner, write = true): (() => void) => {
    if (locked.current || !sameOwner(owner, currentOwner()) || !owner.threadId) throw notSent('侧聊输入目标已改变。');
    assertOriginal();
    const childAuthority = write ? runtime.captureChildDispatch(owner.threadId) : undefined;
    const parent: unknown = latest.current.captureSubmissionAuthority(structuredClone(owner), childAuthority);
    if (typeof parent !== 'function') { sync(parent); throw notSent('原发送权限尚未确认。'); }
    const check = () => { assertOriginal(); sync(parent()); childAuthority?.assertCurrent();
      if (locked.current || !sameOwner(owner, currentOwner())) throw notSent('侧聊输入权限已改变。'); };
    check(); authorities.current.set(check, parent as () => void); return check;
  };
  const guardSession = (owner: ComposerDraftOwner, action: SubmitAction) => {
    const view = owner.threadId && sessions.view({ hostId: owner.hostId, threadId: owner.threadId }).snapshot();
    if (!view || !view.liveReady || !view.canSubmit || view.loading || view.error || view.streamGap || view.thread?.id !== owner.threadId
      || action.type === 'send' && (view.thread.status.type !== 'idle' || isThreadBusy(view.thread))
      || action.type === 'queue' && !isThreadBusy(view.thread)
      || action.type === 'steer' && !view.thread.turns.some(turn => turn.id === action.turnId && turn.status === 'inProgress')) {
      throw notSent('侧聊会话或任务状态尚未确认。');
    }
  };
  const guard = (owner: ComposerDraftOwner, action: SubmitAction, authority: () => void) => {
    if (!authorities.current.has(authority)) throw notSent('缺少原发送权限。');
    authority(); guardSession(owner, action);
  };
  const dispatchQueue = <T,>(method: SideChatQueueMutation, params: Record<string, unknown>, hostId: string,
    authority: () => void, beforeSend?: () => void, onLateTerminal?: WorkbenchDispatchOptions['onLateTerminal']): Promise<T> => {
    const owner = currentOwner(), operationId = controller.getSnapshot().view?.operationId;
    const originalAuthority = authorities.current.get(authority);
    if (!originalAuthority || !owner.threadId || hostId !== owner.hostId || params.threadId !== owner.threadId || !operationId) {
      throw notSent('原侧聊队列目标或授权已改变。');
    }
    const capturedParams = structuredClone(params);
    const check = () => {
      authority(); beforeSend?.();
      const view = sessions.view({ hostId: owner.hostId, threadId: owner.threadId! }).snapshot();
      if (controller.getSnapshot().view?.operationId !== operationId || !view.liveReady || !view.canSubmit
        || view.loading || view.error || view.streamGap || view.thread?.id !== owner.threadId) {
        throw notSent('原侧聊队列会话尚未确认。');
      }
    };
    check();
    return latest.current.dispatchQueueMutation<T>(method, capturedParams, owner.hostId, originalAuthority, check, onLateTerminal);
  };
  const scopedClient = useMemo<WorkbenchClient>(() => ({
    async rpc<T = unknown>(method: string, params?: Record<string, unknown>, hostId?: string, options?: WorkbenchDispatchOptions): Promise<T> {
      if (method !== 'thread/queue/reorder' && method !== 'thread/queue/update' && method !== 'thread/queue/delete') {
        return client.rpc<T>(method, params, hostId, options);
      }
      throw notSent('原侧聊队列写入缺少点击时捕获的授权。');
    },
    host: (endpoint, params, options) => client.host(endpoint, params, options),
    subscribe: listener => client.subscribe(listener),
    reply: (request, response) => client.reply(request, response),
  }), [client, controller, original, runtime, sessions]);
  const runSend = async (description: ComposerSubmissionDescription, value: ComposerDraft, options: SubmitOptions, action: SubmitAction,
    authority: (() => void) | undefined, retry?: SendIntent, assertSource?: () => void) => {
    if (!authority) throw notSent('缺少原发送权限。');
    const owner = structuredClone(description.owner);
    const assertSend = () => { sync(assertSource?.()); guard(owner, action, authority); };
    assertSend();
    const originalAuthority = authorities.current.get(authority)!;
    const capturedNative = latest.current.nativeInjectionAuthority?.(originalAuthority, owner);
    const nativeInjectionAuthority = capturedNative && { daemonConnectionGeneration: capturedNative.daemonConnectionGeneration,
      ...(capturedNative.sideChat ? { sideChat: structuredClone(capturedNative.sideChat) } : {}),
      assertBeforeSend(threadId: string) {
        if (threadId !== owner.threadId) throw notSent('原侧聊注入目标已改变。');
        assertSend(); sync(capturedNative.assertBeforeSend(threadId));
      } };
    return task(async () => {
      const cleanup = { controller(intent: SendIntent) {
        assertOriginal();
        if (!sameOwner(intent.owner, owner) || draft.current?.snapshot() && !sameOwner(draft.current.snapshot()!.owner, owner)) throw new Error('原侧聊草稿身份已改变。');
        if (!draft.current) throw new Error('原侧聊输入区未挂载，恢复记录已保留。');
        return draft.current;
      } };
      await sendConversationDraft({ client, sessions, sends, cleanup,
        nativeInjectionAuthority,
        dispatch: (method, params, hostId, beforeSend) => latest.current.dispatchSubmission(method, params, hostId, beforeSend, originalAuthority),
        guard(threadId) { if (threadId !== owner.threadId) throw notSent('原侧聊目标已改变。'); assertSend(); },
        prepareCreated: async () => { throw notSent('临时侧聊没有可创建的新会话。'); },
        selectCreated: async () => { throw notSent('临时侧聊没有可移交的新会话。'); },
        assignCreatedProject: async () => { throw notSent('临时侧聊项目归属不可变。'); }, recoveryChanged: changed,
      }, { ...owner, cwd: original.cwd }, value, options, action, description, retry);
    });
  };

  const freezeEdits = () => {
    const id = controller.getSnapshot().view?.childId;
    const releaseAcquisition = id ? editAccess.freezeAcquisition({ hostId: original.hostId, threadId: id }) : () => {};
    try { return { lease: editor.current?.freeze() ?? null, releaseAcquisition }; }
    catch (error) { releaseAcquisition(); throw error; }
  };
  const beforeClose = (scope: SideChatCloseBarrier): Promise<void> => {
    if (locked.current || scope.draftId !== original.draftId || scope.hostId !== original.hostId || scope.parentThreadId !== original.parentThreadId
      || scope.childThreadId !== currentOwner().threadId || scope.draftController !== draft.current) throw notSent('原侧聊关闭身份已改变。');
    if (!scope.operationId) runtime.assertUnpreparedClose();
    setLocked(true); closeScope.current = scope;
    closeHostFreeze.current = runtime.freezeHostOperations('close');
    closeEdit.current = freezeEdits();
    const frozen = runtime.bridge.freezeClose();
    return (async () => {
      await frozen; await closeEdit.current?.lease?.flush(); await drain(); await closeEdit.current?.lease?.flush(); assertOriginal();
    })();
  };
  const abortClose = (scope: SideChatCloseBarrier) => {
    if (closeScope.current !== scope) return;
    runtime.bridge.releaseUndispatchedClose(() => {
      if (!mounted.current || closeScope.current !== scope) throw notSent('原侧聊关闭实例已改变。');
    });
    closeEdit.current?.lease?.release(); closeEdit.current?.releaseAcquisition(); closeEdit.current = null;
    closeHostFreeze.current?.(); closeHostFreeze.current = null; closeScope.current = null; setLocked(false);
  };
  const finishClosed = async () => {
    if (finishingClose.current || closedNotified.current) return;
    finishingClose.current = true;
    setCloseCompletionPending(true);
    try {
      await runtime.finishClosed();
      closeEdit.current?.lease?.release(); closeEdit.current?.releaseAcquisition(); closeEdit.current = null;
      closeHostFreeze.current?.(); closeHostFreeze.current = null; closeScope.current = null; setLocked(false);
      closedNotified.current = true;
      latest.current.onClosed(); setError(''); setCloseCompletionPending(false);
    } catch (cause) { report(cause); }
    finally { finishingClose.current = false; }
  };

  const navigation = useMemo<SideChatWorkspaceNavigationController>(() => ({
    submitVisualization(request, signal) {
      const owner = currentOwner(), source = structuredClone(request);
      if (!owner.threadId || source.hostId !== owner.hostId || source.threadId !== owner.threadId || !source.path || signal.aborted) {
        throw notSent('可视化来源已改变，未发送新的输入。');
      }
      const authority = capture(owner), view = sessions.view({ hostId: owner.hostId, threadId: owner.threadId }).snapshot();
      const turn = view.thread?.turns.find(item => item.status === 'inProgress');
      const action: SubmitAction = turn ? { type: 'steer', turnId: turn.id } : { type: 'send' };
      const options = structuredClone(view.options ?? controller.getSnapshot().view?.child?.options ?? {});
      const value = normalizeDraft(source.draft), revision = crypto.randomUUID();
      const checkSource = () => {
        if (signal.aborted || source.hostId !== owner.hostId || source.threadId !== owner.threadId || !source.path) {
          throw notSent('可视化来源已改变，未发送新的输入。');
        }
      };
      guard(owner, action, authority); checkSource();
      const operation = draft.current?.beginExternalOperation(owner);
      if (!operation) throw notSent('原侧聊草稿正在处理，未发送可视化输入。');
      return task(async () => {
        let accepted = false;
        try {
          const result = await operation.transaction(async (before, isCurrent) => {
            guard(owner, action, authority); checkSource();
            if (!isCurrent()) throw notSent('原侧聊草稿已改变。');
            await saveComposerDraftConflict(owner, { revision, draft: value, prefills: [] });
            if (!isCurrent()) throw notSent('原侧聊草稿已改变，可视化输入已保留。');
            return { after: before, value: undefined };
          });
          accepted = result.accepted;
          if (!accepted) throw notSent('原侧聊草稿无法核对，可视化输入已保留。');
        } finally { operation.finish(accepted); }
        await runSend({ owner, revision, overrides: {} }, value, options, action, authority, undefined, checkSource);
      });
    },
    async activate() {
      if (authorizing.current) throw notSent('原侧聊确认正在处理中。');
      authorizing.current = true;
      try {
        const held = authorizationLease.current;
        if (held) {
          if (!await held.flush()) throw new Error('原侧聊尚未排空，确认撤销无法继续。');
          await held.revoke(); held.release(); authorizationLease.current = null; setAuthorizationRecovery(false);
        }
        await runtime.authorizeChild();
      } catch (cause) {
        if (runtime.bridge.hasRegistration && !authorizationLease.current && !locked.current) {
          const lease = navigation.freeze();
          if (lease) { authorizationLease.current = lease; setAuthorizationRecovery(true); }
        }
        report(cause); throw cause;
      } finally { authorizing.current = false; }
    },
    freeze() {
    if (!mounted.current || locked.current) return null;
    setLocked(true);
    let draftLease: ComposerDraftLease | null = null, sendLease: SideChatSendLease | null = null;
    let releaseHost: (() => void) | null = null;
    let editLease: ReturnType<typeof freezeEdits> | null = null;
    let disconnectedHandoff: (() => void) | null = null;
    const assertNavigation = () => { if (disconnectedHandoff) disconnectedHandoff(); else assertOriginal();
      if (!mounted.current) throw notSent('原侧聊工作区已卸载。'); };
    try {
      disconnectedHandoff = runtime.captureDisconnectedHandoff();
      assertNavigation(); releaseHost = runtime.freezeHostOperations('navigation', disconnectedHandoff);
      const owner = currentOwner(), snapshot = draft.current?.snapshot();
      if (draft.current && (!snapshot || !sameOwner(snapshot.owner, owner) || !(draftLease = draft.current.freeze(owner)))) throw new Error('原侧聊草稿无法冻结。');
      sendLease = latest.current.freezeSending(owner, undefined, disconnectedHandoff ?? undefined); editLease = freezeEdits();
    } catch (cause) {
      editLease?.lease?.release(); editLease?.releaseAcquisition(); sendLease?.release(); draftLease?.release(); releaseHost?.(); setLocked(false); report(cause); return null;
    }
    let valid = true, flushed = false, revoked = false, revocationAttempted = false, handedOff = false;
    return {
      async flush() {
        if (!valid || !mounted.current) return false;
        try {
          flushed = false; await editLease?.lease?.flush(); if (draftLease && !await draftLease.flush()) return false;
          await sendLease!.drain(); await drain(); await editLease?.lease?.flush();
          if (draftLease && !await draftLease.flush()) return false;
          assertNavigation(); sendLease!.assertCurrent(); flushed = valid; return flushed;
        } catch (cause) { report(cause); return false; }
      },
      async revoke() {
        if (!valid || !flushed) throw new Error('原侧聊尚未排空。');
        runtime.assertHandoffReady(disconnectedHandoff);
        revocationAttempted = true; await runtime.revokeForHandoff(disconnectedHandoff); assertNavigation(); sendLease!.assertCurrent(); revoked = true;
      },
      handoff() {
        if (!valid || !flushed || !revoked || handedOff) throw new Error('原侧聊尚未确认撤权。');
        editLease?.lease?.handoff(); handedOff = true;
      },
      release() {
        if (!valid) return;
        if (revocationAttempted && !revoked) throw new Error('侧聊撤权尚未确认，原稿保持冻结。');
        valid = false; if (!handedOff) editLease?.lease?.release(); editLease?.releaseAcquisition();
        sendLease?.release(); draftLease?.release(); releaseHost?.(); setLocked(false);
      },
    };
  } }), [runtime, original, editAccess, report]);
  const navigationCallback = useRef(props.onNavigationController); navigationCallback.current = props.onNavigationController;
  useLayoutEffect(() => { navigationCallback.current(navigation); return () => navigationCallback.current(null); }, [navigation]);

  const history: SideChatHistory | null = childId && state.view?.child ? { hostId: original.hostId, threadId: childId,
    ...conversation, options: conversation.options ?? state.view.child.options, canInterrupt: conversation.liveReady && conversation.canSubmit,
    retry: () => sessions.refresh({ hostId: original.hostId, threadId: childId }) } : null;
  const scopedIntents = Object.values(sendState?.requests ?? {}).filter(intent => intent.owner.hostId === original.hostId
    && intent.owner.draftId === original.draftId && intent.owner.threadId === childId && intent.threadId === childId);
  const reloadIntent = async (intent: SendIntent) => {
    const current = (await sends.read()).requests[intent.id];
    if (!current || current.owner.hostId !== original.hostId || current.owner.threadId !== childId || current.owner.draftId !== original.draftId
      || current.attemptId !== intent.attemptId || current.revision !== intent.revision) throw new Error('原发送记录已改变。');
    return current;
  };
  const cancelIntent = async (intent: SendIntent) => {
    const captured = structuredClone(intent), owner = currentOwner(), authority = capture(owner, false);
    const originalAuthority = authorities.current.get(authority);
    if (!originalAuthority || !sameOwner(captured.owner, owner) || captured.threadId !== owner.threadId) {
      throw notSent('原发送记录或取消权限已改变。');
    }
    setLocked(true);
    let draftLease: ComposerDraftLease | null = null, sendLease: SideChatSendLease | null = null;
    let editLease: ReturnType<typeof freezeEdits> | null = null;
    const originalDraft = draft.current;
    try {
      const snapshot = originalDraft?.snapshot();
      if (!originalDraft || !snapshot || !sameOwner(snapshot.owner, owner) || !(draftLease = originalDraft.freeze(owner))) {
        throw notSent('原侧聊草稿无法冻结，取消未执行。');
      }
      sendLease = latest.current.freezeSending(owner, 'cancel'); editLease = freezeEdits();
      const check = () => {
        assertOriginal();
        const current = originalDraft.snapshot();
        if (!locked.current || draft.current !== originalDraft || !current || !sameOwner(current.owner, owner)
          || !sameOwner(currentOwner(), owner)) throw notSent('原侧聊取消身份已改变。');
        sendLease!.assertCurrent();
      };
      check();
      await editLease.lease?.flush();
      if (!await draftLease.flush()) throw notSent('原侧聊草稿未能排空，取消未执行。');
      await sendLease.drain(); await drain(); await editLease.lease?.flush();
      if (!await draftLease.flush()) throw notSent('原侧聊草稿未能排空，取消未执行。');
      check();
      await latest.current.cancelSend(captured, check, originalAuthority);
    } finally {
      editLease?.lease?.release(); editLease?.releaseAcquisition();
      sendLease?.release(); draftLease?.release(); setLocked(false); changed();
    }
  };
  const onEdit = async (value: ComposerDraft, origin: MessageEditOrigin, prepare: () => Promise<void>) => {
    const owner = currentOwner();
    if (!owner.threadId || origin.hostId !== owner.hostId || origin.threadId !== owner.threadId) throw notSent('消息编辑目标已改变。');
    const access = editAccess.capture(origin);
    let authority: (() => void) | undefined, capturedNative: SendInjectionAuthority | undefined;
    try {
      authority = capture(owner);
      capturedNative = latest.current.nativeInjectionAuthority?.(authorities.current.get(authority)!, owner);
    } catch { /* An already-issued edit may still be checked without a new write grant. */ }
    await task(async () => {
      await prepare(); await sessions.ready({ hostId: owner.hostId, threadId: owner.threadId! });
      const current = sessions.view({ hostId: owner.hostId, threadId: owner.threadId! }).snapshot();
      if (!current.historyComplete || !current.thread || !current.canSubmit) throw notSent('侧聊完整历史尚未确认，编辑已保留。');
      const result = await submitDraft(client, { hostId: owner.hostId, threadId: owner.threadId, cwd: original.cwd, readOnly: false,
        activeTurnId: current.thread.turns.find(turn => turn.status === 'inProgress')?.id ?? null, thread: current.thread,
        initialOptions: current.options ?? undefined }, value, {}, { type: 'send' }, async () => {}, origin,
      (actual, expected, params) => {
        const assertRead = () => {
          assertOriginal(); access();
          if (locked.current || !sameOwner(owner, currentOwner())
            || !sessions.view({ hostId: owner.hostId, threadId: owner.threadId! }).snapshot().historyComplete) throw notSent('原消息编辑目标或历史已改变。');
        };
        const childDispatch = capturedNative?.sideChat && authority ? { proof: structuredClone(capturedNative.sideChat), assertCurrent() {
          guard(owner, { type: 'send' }, authority!); sync(capturedNative!.assertBeforeSend(owner.threadId!));
        } } : undefined;
        return edits.submit(actual, expected, params, assertRead, capturedNative?.daemonConnectionGeneration, childDispatch);
      });
      if (result.turn) sessions.started({ hostId: owner.hostId, threadId: owner.threadId! }, result.turn);
    });
  };
  const receiveEditController = useCallback((value: MessageEditNavigationController | null) => {
    editor.current = value; latest.current.onEditNavigationController?.(value);
  }, []);
  return <>
    {error && <div role="alert">{error}{closeCompletionPending ? <button type="button" onClick={() => void finishClosed()}>继续完成关闭</button> : null}</div>}
    {(runtime.needsChildAuthorization || authorizationRecovery) && <button type="button" onClick={() => void navigation.activate().catch(() => {})}>恢复侧聊写入权限</button>}
    {scopedIntents.map(intent => <SendRecoveryNotice key={intent.id} intent={intent} canRetry={!!history?.canSubmit && history.liveReady === true}
      canCheckInjectionReceipt={sends.hasConfirmedInjectionReceipt(intent)}
      onOpen={async () => { assertOriginal(); }} onCheck={() => task(async () => {
        const current = await reloadIntent(intent); await sends.check(current.id); changed(); })}
      onRetry={async () => { const authority = capture(currentOwner()), current = await reloadIntent(intent);
        if (!['prepared', 'ready', 'failed'].includes(current.stage)) throw new Error('原发送尚不可重试。');
        await runSend({ owner: current.owner, revision: current.revision, overrides: current.overrides,
          ...(current.documentPlainTextMode !== undefined ? { documentPlainTextMode: current.documentPlainTextMode } : {}) },
        current.draft, current.options, current.action ?? { type: 'send' }, authority, current); }}
      onFinish={() => task(async () => { const current = await reloadIntent(intent); await finishConversationSend(sends, current, { controller() {
        assertOriginal(); if (!draft.current || !sameOwner(draft.current.snapshot()?.owner ?? currentOwner(), current.owner)) throw new Error('原草稿未挂载。'); return draft.current;
      } }); changed(); })}
      onRetryInjectionPersistence={() => task(async () => { const current = await reloadIntent(intent);
        await sends.retryNativePersistence(current.id); changed(); })}
      onCancel={() => cancelIntent(intent)} />)}
    <SideChatPanel client={scopedClient} controller={controller} open={props.open} history={history} onClose={() => void finishClosed()}
      onBeforeClose={beforeClose} onCloseBarrierAborted={abortClose} prepareResultUnknown={runtime.needsPrepareReconciliation}
      canExitObservation={scope => !!scope.operationId && runtime.canExitObservation({ ...scope, operationId: scope.operationId })}
      onExitObservation={() => latest.current.onExitObservation()}
      onOpenNew={props.onOpenNew ? scope => {
        const current = controller.getSnapshot(), now = latest.current.identity, openNew = latest.current.onOpenNew;
        if (!mounted.current || !openNew || now.hostId !== original.hostId || now.parentThreadId !== original.parentThreadId
          || now.draftId !== original.draftId || now.prepareId !== original.prepareId || now.cwd !== original.cwd || now.mode !== original.mode)
          throw notSent('原侧聊工作区已改变。');
        if (scope.hostId !== original.hostId || scope.parentThreadId !== original.parentThreadId || scope.draftId !== original.draftId
          || current.view?.operationId !== scope.operationId || current.view.childId !== scope.childThreadId) throw notSent('原侧聊已改变。');
        let captured: SideChatChildScope;
        try { captured = structuredClone(scope); } catch { throw notSent('原侧聊身份无法复制。'); }
        return openNew(captured);
      } : undefined}
      onDraftController={value => { draft.current = value; latest.current.onDraftController?.(value); }}
      onDraftChange={props.onDraftChange} onRemoveReference={props.onRemoveReference} captureSubmissionAuthority={owner => capture(owner)}
      dispatchQueueMutation={(method, params, hostId, authority, beforeSend) => dispatchQueue(method, params, hostId, authority, beforeSend)}
      onSubmit={(description, value, options, action, _draft, authority) => runSend(description, value, options, action, authority)}
      onInterrupt={scope => task(async () => {
        const owner = currentOwner(), authority = capture(owner), guardTurn = () => {
          authority(); const view = sessions.view({ hostId: scope.hostId, threadId: scope.childThreadId }).snapshot();
          if (scope.hostId !== owner.hostId || scope.parentThreadId !== original.parentThreadId || scope.draftId !== owner.draftId
            || scope.childThreadId !== owner.threadId || controller.getSnapshot().view?.operationId !== scope.operationId
            || !view.liveReady || !view.canSubmit || view.loading || view.error || view.streamGap
            || !view.thread?.turns.some(turn => turn.id === scope.turnId && turn.status === 'inProgress')) throw notSent('原侧聊任务已改变。');
        };
        guardTurn(); await latest.current.interruptTurn(structuredClone(scope), guardTurn, authorities.current.get(authority)!);
      })}
      removeQueuedOriginal={props.removeQueuedOriginal ? (entry, scope, authority, beforeSend) => task(async () => {
        const owner = currentOwner(), originalAuthority = authorities.current.get(authority);
        if (!originalAuthority) throw notSent('缺少原队列权限。');
        const check = () => {
          authority(); beforeSend();
          const view = sessions.view({ hostId: owner.hostId, threadId: owner.threadId! }).snapshot();
          if (!sameOwner(owner, currentOwner()) || scope.hostId !== owner.hostId || scope.parentThreadId !== original.parentThreadId
            || scope.draftId !== owner.draftId || scope.childThreadId !== owner.threadId
            || controller.getSnapshot().view?.operationId !== scope.operationId || !view.liveReady || !view.canSubmit
            || view.loading || view.error || view.streamGap || view.thread?.id !== owner.threadId) throw notSent('原侧聊队列已改变。');
        };
        check(); return latest.current.removeQueuedOriginal!(structuredClone(scope), structuredClone(entry), originalAuthority, check);
      }) : undefined}
      onStartQueued={(id, scope, authority, originalAuthority) => task(async () => {
        const owner = currentOwner(); if (!authority) throw notSent('原队列权限尚未捕获。');
        const originalCaptured = originalAuthority ? authorities.current.get(originalAuthority) : null;
        if (originalAuthority && !originalCaptured) throw notSent('原队列授权身份已改变。');
        const check = () => {
          authority(); assertOriginal();
          if (!sameOwner(owner, currentOwner()) || scope.hostId !== owner.hostId || scope.parentThreadId !== original.parentThreadId
            || scope.draftId !== owner.draftId || scope.childThreadId !== owner.threadId
            || controller.getSnapshot().view?.operationId !== scope.operationId) throw notSent('原侧聊队列已改变。');
          guardSession(owner, { type: 'send' });
        };
        check(); await latest.current.dispatchSubmission('thread/queue/start', { threadId: scope.childThreadId, queuedSubmissionId: id }, scope.hostId, check, originalCaptured ?? null);
      })}
      messages={{ editAccess, outputPreviewAuthority, editRecovery: edit?.childId === childId ? edit.value?.recovery ?? null : null,
        editRebase: edit?.childId === childId ? messageEditRebaseMarker(edit.value) : null,
        editHistory: { order: 'ascending', tailComplete: conversation.historyComplete },
        onEditNavigationController: receiveEditController, onEditDraftChange: (value, origin, version, authority) => edits.save(value, origin, version, authority),
        onPrepareEditRebase: (origin, version) => edits.prepareRebase(origin, version), onCommitEditRebase: candidate => edits.commitRebase(candidate),
        onEdit: edit?.childId === childId ? onEdit : undefined,
        onOpenFile: path => { if (childId) props.onOpenFile?.({ hostId: original.hostId, threadId: childId, path, cwd: original.cwd }); },
        onOpenFileAt: location => { if (childId) props.onOpenFile?.({ ...location, threadId: childId }); },
        onOpenVisualization: props.onOpenVisualization, onOpenBrowser: props.onOpenBrowser }} />
    {approval && <div ref={approvalNode} inert={locked.current}><ApprovalDialog {...props.approvalOptions} {...approval}
      onBegin={ref => {
        if (locked.current || !childId || ref.hostId !== original.hostId) return false;
        try { assertOriginal(); } catch { return false; }
        const key = JSON.stringify(ref);
        if (!approval.onBegin?.(ref)) return false;
        approvalActions.current.add(key); active.current++; return true;
      }} onOutcome={(ref, outcome) => {
        try { approval.onOutcome?.(ref, outcome); }
        finally { if (outcome !== 'sending' && approvalActions.current.delete(JSON.stringify(ref))) endTask(); }
      }} onCloseView={() => setHiddenApproval(requestKey ?? null)}
      onInputEscape={async origin => {
        const owner = currentOwner(), authority = capture(owner);
        if (origin.hostId !== owner.hostId || origin.threadId !== owner.threadId) throw notSent('原审批会话已改变。');
        const originalAuthority = authorities.current.get(authority)!;
        const capturedNative = latest.current.nativeInjectionAuthority?.(originalAuthority, owner);
        if (!capturedNative?.sideChat) throw notSent('原侧聊审批停止权限尚未确认。');
        const sideChat = structuredClone(capturedNative.sideChat);
        await client.host('approval-request-interrupt', { ref: origin.ref, hostId: origin.hostId, threadId: origin.threadId,
          turnId: origin.turnId, daemonConnectionGeneration: capturedNative.daemonConnectionGeneration, sideChat },
        { assertBeforeSend: () => { authority(); sync(capturedNative.assertBeforeSend(owner.threadId!)); } });
      }} /></div>}
  </>;
}
