import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { ThreadSettingsResponse, ThreadSummary } from '../../../lib/codex-protocol.ts';
import type { ComposerDraft, MessageEditOrigin, SubmitAction, SubmitOptions, WorkbenchClient } from '../workbench-contract.ts';
import { StandaloneComposer, bindComposerDraftToThread } from '../composer/StandaloneComposer.tsx';
import type { ComposerDraftController, ComposerDraftExternalOperation, ComposerDraftLease, ComposerDraftOwner, ComposerDraftSnapshot, ComposerReference, ComposerSubmissionDescription } from '../composer/StandaloneComposer.tsx';
import type { ComposerHost } from '../composer/standalone-target.tsx';
import { StandaloneMessages } from '../messages/StandaloneMessages.tsx';
import type { MessageEditNavigationController, MessageEditNavigationLease } from '../messages/StandaloneMessages.tsx';
import { useConversationSession } from '../app/conversation-sessions.ts';
import type { ConversationSessions } from '../app/conversation-sessions.ts';
import { sendConversationDraft, finishConversationSend } from '../app/conversation-send.ts';
import type { ConversationSendCleanup } from '../app/conversation-send.ts';
import { messageEditChanged, messageEditRebaseMarker, messageEditsAtom } from '../app/message-edit-recovery.ts';
import type { MessageEditRecoveryStore, StoredMessageEdit } from '../app/message-edit-recovery.ts';
import { sendsAtom, sendThreadKey } from '../app/send-recovery.ts';
import type { SendIntent, SendRecoveryStore } from '../app/send-recovery.ts';
import { submitDraft } from '../app/submission.ts';
import { isThreadBusy } from '../app/thread-state.ts';
import { miniDraftIdentity, rememberMiniCreatedDraft } from './mini-draft-identity.ts';
import './mini-conversation.css';

export { miniDraftIdentity } from './mini-draft-identity.ts';

export interface MiniConversationTarget extends ComposerDraftOwner {
  cwd: string;
  projectId?: string;
  readOnly?: boolean;
}
export interface MiniConversationLease {
  flush(): Promise<boolean>;
  release(): void;
}
export interface MiniConversationController {
  target(): MiniConversationTarget;
  freeze(): MiniConversationLease | null;
  switchTarget(target: MiniConversationTarget): Promise<boolean>;
  retry(intentId: string): Promise<void>;
  finish(intentId: string): Promise<void>;
}
export interface MiniConversationProps {
  client: WorkbenchClient;
  sessions: ConversationSessions;
  sends: SendRecoveryStore;
  edits: MessageEditRecoveryStore;
  initialTarget: MiniConversationTarget;
  initialOptions?: SubmitOptions;
  hosts?: ComposerHost[];
  /** Synchronous projections of the parent's actual connection and exclusive owner state, including created-thread aliases. */
  isConnected(hostId: string): boolean;
  canUseOwner(owner: ComposerDraftOwner): boolean;
  onController(controller: MiniConversationController | null): void;
  onTargetChanged(target: MiniConversationTarget): void;
  onRecoveryChanged(): void;
  onError(error: string): void;
  onOpenThread(identity: { hostId: string; threadId: string }): void;
  onOpenFile?(location: { hostId: string; threadId: string; path: string; cwd?: string; line?: number; column?: number }): void;
  onOpenVisualization?(value: { hostId: string; threadId: string; path: string }): void;
  onOpenBrowser?(value: { hostId: string; threadId: string; url?: string }): void;
  onAssignCreatedProject?(target: MiniConversationTarget, thread: ThreadSummary): Promise<void>;
  /** The mounted controller used to reconcile the parent's retained browser before/after receipt. */
  onDraftController?(controller: ComposerDraftController | null): void;
  onDraftChange?(snapshot: ComposerDraftSnapshot): void;
  onRemoveReference?(owner: ComposerDraftOwner, reference: ComposerReference, operation: ComposerDraftExternalOperation): Promise<'handled' | void>;
}

const targetKey = (target: MiniConversationTarget) => JSON.stringify(target);
const ownerOf = (target: MiniConversationTarget): ComposerDraftOwner => ({ hostId: target.hostId, threadId: target.threadId, draftId: target.draftId });
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const notSent = (message: string) => Object.assign(new Error(message), { uncertain: false });
function validTarget(target: MiniConversationTarget) {
  return !!target.hostId && target.threadId !== '' && target.draftId.startsWith('mini:') && !!target.cwd;
}

export function MiniConversation(props: MiniConversationProps) {
  const latest = useRef(props); latest.current = props;
  const [target, setTarget] = useState(() => structuredClone(props.initialTarget));
  const targetRef = useRef(target); targetRef.current = target;
  const [readyKey, setReadyKey] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const [editState, setEditState] = useState<{ key: string; value: StoredMessageEdit | null } | null>(null);
  const composer = useRef<ComposerDraftController | null>(null);
  const mountedComposerKey = useRef<string | null>(null);
  const messageEditor = useRef<MessageEditNavigationController | null>(null);
  const locked = useRef(false), inFlight = useRef(false), mounted = useRef(false);
  const provisionalRelease = useRef<(() => void) | null>(null);
  const key = targetKey(target), usable = validTarget(target) && props.canUseOwner(ownerOf(target));
  const initialized = readyKey === key && (usable || mountedComposerKey.current === key);
  const conversation = useConversationSession(props.sessions, target.threadId ? { hostId: target.hostId, threadId: target.threadId } : null,
    target.readOnly === true, initialized, 0);
  const report = useCallback((cause: unknown) => {
    const text = errorText(cause); if (mounted.current) setError(text); latest.current.onError(text);
  }, []);
  const changed = useCallback(() => latest.current.onRecoveryChanged(), []);
  const receiveComposer = useCallback((value: ComposerDraftController | null) => {
    composer.current = value;
    mountedComposerKey.current = value ? targetKey(targetRef.current) : null;
    latest.current.onDraftController?.(value);
  }, []);
  const receiveEditor = useCallback((value: MessageEditNavigationController | null) => { messageEditor.current = value; }, []);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; provisionalRelease.current?.(); provisionalRelease.current = null; };
  }, []);
  useEffect(() => {
    let active = true;
    setReadyKey('');
    if (!validTarget(target)) { report('Mini 草稿目标无效，原输入已保留。'); return; }
    void props.sends.read().then(async state => {
      if (target.threadId) {
        const receipt = state.creations[sendThreadKey(target.hostId, target.threadId)];
        if (receipt && receipt.owner.draftId === target.draftId) await bindComposerDraftToThread(receipt.owner, target.threadId);
      }
      if (active) setReadyKey(key);
    }).catch(cause => { if (active) report(cause); });
    return () => { active = false; };
  }, [props.sends, key, report]);
  useEffect(() => {
    if (initialized && target.threadId && provisionalRelease.current) {
      provisionalRelease.current(); provisionalRelease.current = null;
    }
  }, [initialized, target.threadId]);
  useEffect(() => {
    let active = true, generation = 0;
    const read = () => {
      const sequence = ++generation;
      void (target.threadId ? props.edits.read(target.hostId, target.threadId) : Promise.resolve(null)).then(value => {
        if (active && sequence === generation) setEditState({ key, value });
      }).catch(cause => { if (active && sequence === generation) report(cause); });
    };
    read();
    window.addEventListener(messageEditChanged, read);
    const unsubscribe = props.client.subscribe(event => {
      if (event.type === 'persisted-atom-updated' && (!Array.isArray(event.keys) || !event.keys.length || event.keys.includes(messageEditsAtom))) read();
      if (event.type === 'persisted-atom-updated' && (!Array.isArray(event.keys) || !event.keys.length || event.keys.includes(sendsAtom))) changed();
    });
    return () => { active = false; window.removeEventListener(messageEditChanged, read); unsubscribe(); };
  }, [props.client, props.edits, key, report, changed]);

  const freeze = useCallback((): MiniConversationLease | null => {
    if (!mounted.current || locked.current || inFlight.current) return null;
    locked.current = true;
    let draftLease: ComposerDraftLease | null = null, editLease: MessageEditNavigationLease | null = null;
    try {
      const current = composer.current, snapshot = current?.snapshot();
      if (current && (!snapshot || targetKey({ ...targetRef.current, ...snapshot.owner }) !== targetKey(targetRef.current)
        || !(draftLease = current.freeze(snapshot.owner)))) throw new Error('Mini 草稿尚不能冻结，内容已保留。');
      editLease = messageEditor.current?.freeze() ?? null;
      flushSync(() => setFrozen(true));
    } catch (cause) {
      draftLease?.release(); editLease?.release(); locked.current = false; report(cause); return null;
    }
    let active = true;
    return {
      async flush() {
        if (!active || !mounted.current) return false;
        try {
          await editLease?.flush();
          if (draftLease && !await draftLease.flush()) return false;
          await editLease?.flush();
          return active && mounted.current && (!draftLease || await draftLease.flush());
        } catch (cause) { report(cause); return false; }
      },
      release() {
        if (!active) return;
        active = false; draftLease?.release(); editLease?.release(); locked.current = false;
        if (mounted.current) flushSync(() => setFrozen(false));
      },
    };
  }, [report]);

  const commitTarget = useCallback((next: MiniConversationTarget) => {
    if (!validTarget(next) || !latest.current.canUseOwner(ownerOf(next))) throw new Error('Mini 目标或草稿 owner 不可用，原输入已保留。');
    const value = structuredClone(next);
    latest.current.onTargetChanged(structuredClone(value));
    targetRef.current = value;
    flushSync(() => { setTarget(value); setError(''); });
  }, []);

  const switchTarget = useCallback(async (next: MiniConversationTarget) => {
    const lease = freeze();
    if (!lease) { report('Mini 正在处理输入，请稍后再切换。'); return false; }
    try {
      if (!await lease.flush()) throw new Error('Mini 草稿未能保存，当前输入已保留。');
      commitTarget(next); return true;
    } catch (cause) { report(cause); return false; }
    finally { lease.release(); }
  }, [freeze, commitTarget, report]);

  const cleanupFor = useCallback((scope: MiniConversationTarget): ConversationSendCleanup => {
    const scopeKey = targetKey(scope);
    return { controller(intent) {
      if (!mounted.current || locked.current || targetKey(targetRef.current) !== scopeKey || !latest.current.canUseOwner(ownerOf(scope))
        || intent.owner.hostId !== scope.hostId || intent.owner.draftId !== scope.draftId
        || scope.threadId !== intent.owner.threadId && !(intent.owner.threadId === null && scope.threadId === intent.threadId)) {
        throw new Error('原 Mini 草稿的所有权已改变，已发送记录和输入已保留。');
      }
      const current = composer.current;
      if (current && mountedComposerKey.current !== scopeKey) throw new Error('原 Mini 输入区尚未确认。');
      return current;
    } };
  }, []);

  const runSend = useCallback(async (draft: ComposerDraft, options: SubmitOptions, action: SubmitAction,
    description: ComposerSubmissionDescription, retry?: SendIntent) => {
    if (inFlight.current || locked.current) throw notSent('Mini 正在处理其他操作，原输入已保留。');
    const original = structuredClone(targetRef.current), originalKey = targetKey(original);
    inFlight.current = true; setWorking(true); setError('');
    const creation: { target: MiniConversationTarget | null; lease: ComposerDraftLease | null; release: (() => void) | null } =
      { target: null, lease: null, release: null };
    const guard = (threadId: string | null, allowFirstTurn: boolean) => {
      const owner = threadId && creation.target?.threadId === threadId ? ownerOf(creation.target) : ownerOf(original);
      if (!mounted.current || targetKey(targetRef.current) !== originalKey || original.readOnly
        || !latest.current.isConnected(original.hostId) || !latest.current.canUseOwner(owner)
        || threadId !== original.threadId && threadId !== creation.target?.threadId) throw notSent('Mini 会话或连接已改变，原输入已保留。');
      if (threadId) {
        const view = latest.current.sessions.view({ hostId: original.hostId, threadId }).snapshot();
        if (!(view.canSubmit || allowFirstTurn && view.canStartFirstTurn)) throw notSent('Mini 会话尚未确认可写，原输入已保留。');
        if (action.type === 'send' && isThreadBusy(view.thread)) throw notSent('当前任务仍在运行，原输入已保留。');
        if (action.type === 'steer' && !view.thread?.turns.some(turn => turn.id === action.turnId && turn.status === 'inProgress')) {
          throw notSent('当前任务已改变，原输入已保留。');
        }
      }
    };
    try {
      await sendConversationDraft({ client: latest.current.client, sessions: latest.current.sessions, sends: latest.current.sends, guard,
        cleanup: cleanupFor(original),
        recoveryChanged: changed,
        assignCreatedProject: async intent => {
          if (!intent.created || !latest.current.onAssignCreatedProject) throw notSent('项目关联尚未接入，原输入已保留。');
          await latest.current.onAssignCreatedProject({ ...intent.owner, cwd: intent.cwd, projectId: intent.projectId }, intent.created.thread);
        },
        prepareCreated: async () => {
          guard(null, true);
          const controller = composer.current, snapshot = controller?.snapshot();
          if (!controller || !snapshot || JSON.stringify(snapshot.owner) !== JSON.stringify(ownerOf(original))
            || !(creation.lease = controller.freeze(snapshot.owner))) throw notSent('原 Mini 草稿尚不能冻结，会话创建回执已保留。');
          if (!await creation.lease.flush()) throw notSent('原 Mini 草稿未能保存，会话创建回执已保留。');
          guard(null, true);
        },
        selectCreated: async (thread, _settings: ThreadSettingsResponse) => {
          rememberMiniCreatedDraft(original.hostId, thread.id, original.draftId);
          creation.target = { ...original, threadId: thread.id, cwd: thread.cwd || original.cwd };
          if (!latest.current.canUseOwner(ownerOf(creation.target))) throw notSent('新会话草稿正由另一编辑器使用，原输入已保留。');
          creation.release = latest.current.sessions.acquire({ hostId: original.hostId, threadId: thread.id }, false);
          if (original.projectId) {
            if (!latest.current.onAssignCreatedProject) throw notSent('项目关联尚未接入，原输入已保留。');
            await latest.current.onAssignCreatedProject(structuredClone(original), thread);
          }
          await latest.current.sessions.ready({ hostId: original.hostId, threadId: thread.id }, true);
          guard(thread.id, true);
        },
      }, original, draft, options, action, description, retry);
    } catch (cause) { report(cause); throw cause; }
    finally {
      if (creation.target && creation.lease && mounted.current && targetKey(targetRef.current) === originalKey) {
        try {
          commitTarget(creation.target);
          provisionalRelease.current?.(); provisionalRelease.current = creation.release; creation.release = null;
        } catch (cause) { report(cause); }
      }
      creation.release?.(); creation.lease?.release();
      inFlight.current = false; if (mounted.current) setWorking(false);
    }
  }, [changed, cleanupFor, commitTarget, report]);

  const retry = useCallback(async (id: string) => {
    const current = (await latest.current.sends.read()).requests[id], scope = targetRef.current;
    if (!current || current.owner.hostId !== scope.hostId || current.owner.draftId !== scope.draftId || current.threadId !== scope.threadId
      || !['prepared', 'ready', 'failed'].includes(current.stage)) throw notSent('此 Mini 原发送不可重试，恢复记录已保留。');
    await runSend(current.draft, current.options, current.action ?? { type: 'send' },
      { owner: current.owner, revision: current.revision, overrides: current.overrides,
        ...(current.documentPlainTextMode !== undefined ? { documentPlainTextMode: current.documentPlainTextMode } : {}) }, current);
  }, [runSend]);
  const finish = useCallback(async (id: string) => {
    const scope = structuredClone(targetRef.current), current = (await latest.current.sends.read()).requests[id];
    if (!current || current.owner.hostId !== scope.hostId || current.owner.draftId !== scope.draftId) throw new Error('此 Mini 原发送记录不可用。');
    try { await finishConversationSend(latest.current.sends, current, cleanupFor(scope)); }
    finally { changed(); }
  }, [changed, cleanupFor]);
  const controller = useMemo<MiniConversationController>(() => ({ target: () => structuredClone(targetRef.current), freeze, switchTarget, retry, finish }),
    [freeze, switchTarget, retry, finish]);
  useLayoutEffect(() => { props.onController(controller); return () => props.onController(null); }, [props.onController, controller]);

  const onEdit = async (draft: ComposerDraft, origin: MessageEditOrigin) => {
    const current = structuredClone(targetRef.current), identity = current.threadId && { hostId: current.hostId, threadId: current.threadId };
    if (!identity || origin.hostId !== identity.hostId || origin.threadId !== identity.threadId || current.readOnly || inFlight.current || locked.current) {
      throw notSent('消息编辑目标已改变，原输入已保留。');
    }
    inFlight.current = true; setWorking(true);
    try {
      await props.sessions.ready(identity);
      const view = props.sessions.view(identity).snapshot();
      if (targetKey(targetRef.current) !== targetKey(current) || !latest.current.isConnected(identity.hostId)
        || !latest.current.canUseOwner(ownerOf(current)) || !view.canSubmit) throw notSent('会话连接已改变，编辑已保留。');
      const result = await submitDraft(props.client, { ...identity, cwd: view.thread?.cwd || current.cwd, readOnly: false,
        activeTurnId: view.thread?.turns.find(turn => turn.status === 'inProgress')?.id ?? null, thread: view.thread,
        initialOptions: view.options ?? undefined }, draft, view.options ?? {}, { type: 'send' }, async () => {}, origin,
      (source, expected, params) => props.edits.submit(source, expected, params));
      if (result.turn) props.sessions.started(identity, result.turn);
    } catch (cause) { report(cause); throw cause; }
    finally { inFlight.current = false; if (mounted.current) setWorking(false); }
  };

  const startQueued = async (id: string) => {
    const current = structuredClone(targetRef.current), identity = current.threadId && { hostId: current.hostId, threadId: current.threadId };
    if (!identity || current.readOnly || inFlight.current || locked.current) throw notSent('Mini 会话暂时无法启动队列。');
    inFlight.current = true; setWorking(true);
    try {
      await props.sessions.ready(identity);
      const view = props.sessions.view(identity).snapshot();
      if (targetKey(targetRef.current) !== targetKey(current) || !latest.current.isConnected(identity.hostId)
        || !latest.current.canUseOwner(ownerOf(current)) || !view.canSubmit || isThreadBusy(view.thread)) throw notSent('会话目标或状态已改变，队列未启动。');
      await props.client.rpc('thread/queue/start', { threadId: identity.threadId, queuedSubmissionId: id }, identity.hostId);
    } finally { inFlight.current = false; if (mounted.current) setWorking(false); }
  };
  const interrupt = async () => {
    const current = targetRef.current;
    if (!current.threadId || current.readOnly || !latest.current.isConnected(current.hostId)
      || !latest.current.canUseOwner(ownerOf(current)) || locked.current) throw notSent('Mini 会话连接不可用。');
    const view = props.sessions.view({ hostId: current.hostId, threadId: current.threadId }).snapshot();
    const turn = view.thread?.turns.find(item => item.status === 'inProgress');
    if (!turn || !view.canSubmit) throw notSent('当前任务已改变，未停止其他任务。');
    await props.client.rpc('turn/interrupt', { threadId: current.threadId, turnId: turn.id }, current.hostId);
  };
  const edit = editState?.key === key ? editState.value : null;
  const thread = conversation.thread?.id === target.threadId ? conversation.thread : null;
  return <div className="yard-mini-conversation" inert={frozen}>
    {target.threadId && <button type="button" className="yard-mini-conversation-open" disabled={!usable} onClick={() => props.onOpenThread({ hostId: target.hostId, threadId: target.threadId! })}>
      {thread?.name || 'Open conversation'}
    </button>}
    {error && <p role="alert">{error}</p>}
    {!usable && <p role="status">Mini 草稿正在其他编辑器中使用，原内容已保留。</p>}
    {conversation.error && <p role="status">{conversation.error}</p>}
    {conversation.streamGap && <p role="status">会话内容正在核对。</p>}
    {target.threadId && <div className="yard-mini-conversation-messages" inert={!usable}>
      {conversation.loading ? <p role="status">Loading conversation...</p> : <StandaloneMessages client={props.client} hostId={target.hostId} thread={thread}
        editRecovery={edit?.recovery ?? null} editRebase={messageEditRebaseMarker(edit)} editHistory={{ order: 'ascending', tailComplete: conversation.historyComplete }}
        onEditNavigationController={receiveEditor} onEditDraftChange={(value, origin, version) => props.edits.save(value, origin, version)}
        onPrepareEditRebase={(origin, version) => props.edits.prepareRebase(origin, version)} onCommitEditRebase={async candidate => {
          const recovered = await props.edits.commitRebase(candidate); void props.sessions.refresh(recovered.origin).catch(report); return recovered;
        }} onEdit={target.readOnly ? undefined : onEdit}
        onOpenFileAt={location => { if (target.threadId) props.onOpenFile?.({ ...location, threadId: target.threadId }); }}
        onOpenFile={path => { if (target.threadId) props.onOpenFile?.({ hostId: target.hostId, threadId: target.threadId, path, cwd: target.cwd }); }}
        onOpenVisualization={props.onOpenVisualization} onOpenBrowser={props.onOpenBrowser} />}
    </div>}
    {target.readOnly && <p role="status">此会话已归档，原输入已保留。</p>}
    <div inert={target.readOnly === true || !usable}>
    {initialized && (!target.threadId || !conversation.loading && conversation.options || composer.current) && <StandaloneComposer
      client={props.client} context={{ ...ownerOf(target), cwd: thread?.cwd || target.cwd, placement: 'mini' }}
      busy={working || isThreadBusy(thread)} activeTurnId={thread?.turns.find(turn => turn.status === 'inProgress')?.id ?? null}
      initialOptions={conversation.options ?? props.initialOptions} hosts={props.hosts} onDraftController={receiveComposer}
      onDraftChange={props.onDraftChange} onRemoveReference={async (owner, reference, operation) => {
        if (reference.kind === 'browser' && !latest.current.onRemoveReference) throw new Error('浏览器引用恢复尚未接入，原引用已保留。');
        const result = await latest.current.onRemoveReference?.(owner, reference, operation);
        if (reference.kind === 'browser' && result !== 'handled') throw new Error('浏览器引用尚未完成删除，原引用已保留。');
        return result;
      }}
      onTargetChange={target.threadId ? undefined : async (next, lease) => {
        if (locked.current || inFlight.current) throw new Error('Mini 正在处理其他操作。');
        locked.current = true;
        const original = targetKey(targetRef.current);
        try {
          const state = await props.sends.read();
          if (targetKey(targetRef.current) !== original || !await lease.flush()) throw new Error('Mini 草稿未能保存。');
          const draftId = miniDraftIdentity(next.hostId, null, state.bindings);
          commitTarget({ hostId: next.hostId, threadId: null, draftId, cwd: next.cwd });
        } finally { locked.current = false; }
      }}
      onSubmit={(draft, options, action, description) => {
        if (!description) return Promise.reject(notSent('缺少原草稿版本，未发送。'));
        return runSend(draft, options, action, description);
      }} onInterrupt={interrupt} onStartQueued={startQueued} />}
    </div>
  </div>;
}
