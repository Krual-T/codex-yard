import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { ThreadSummary } from '../../../lib/codex-protocol.ts';
import type { ComposerDraft, MessageEditOrigin, SubmitAction, SubmitOptions, WorkbenchClient } from '../workbench-contract.ts';
import { StandaloneComposer, bindComposerDraftToThread } from '../composer/StandaloneComposer.tsx';
import type { ComposerDraftController, ComposerDraftExternalOperation, ComposerDraftLease, ComposerDraftOwner, ComposerDraftSnapshot, ComposerReference, ComposerSubmissionDescription } from '../composer/StandaloneComposer.tsx';
import type { ComposerHost } from '../composer/standalone-target.tsx';
import { StandaloneMessages } from '../messages/StandaloneMessages.tsx';
import type { MessageEditNavigationController, MessageEditNavigationLease } from '../messages/StandaloneMessages.tsx';
import { useConversationSession } from '../app/conversation-sessions.ts';
import type { ConversationSessions } from '../app/conversation-sessions.ts';
import { sendConversationDraft, finishConversationSend } from '../app/conversation-send.ts';
import type { ConversationSendCleanup, ConversationWriteDispatch } from '../app/conversation-send.ts';
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
  /** Immediately before a committed unmount/navigation, after all barriers have flushed. */
  handoff(): void;
  release(): void;
}
export interface MiniConversationController {
  target(): MiniConversationTarget;
  freeze(): MiniConversationLease | null;
  switchTarget(target: MiniConversationTarget): Promise<boolean>;
  retry(intentId: string): Promise<void>;
  finish(intentId: string): Promise<void>;
  retryRecovery(): void;
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
  /** Capture this view's current connection and owner grant, including their generations. */
  captureEditAuthority(owner: ComposerDraftOwner): () => void;
  /** Preserve the original connection and assert immediately before the actual write. */
  dispatchSubmission: ConversationWriteDispatch;
  onController(controller: MiniConversationController | null): void;
  onTargetChanged(target: MiniConversationTarget): void;
  onRecoveryChanged(): void;
  onError(error: string): void;
  onOpenThread(identity: { hostId: string; threadId: string }): void;
  onOpenFile?(location: { hostId: string; threadId: string; path: string; cwd?: string; line?: number; column?: number }): void;
  onOpenVisualization?(value: { hostId: string; threadId: string; path: string }): void;
  onOpenBrowser?(value: { hostId: string; threadId: string; url?: string }): void;
  /** Reconcile actual project membership; do not blindly replay an uncertain association. */
  onAssignCreatedProject?(target: MiniConversationTarget, thread: ThreadSummary, assertAuthority: () => void): Promise<void>;
  /** The mounted controller used to reconcile the parent's retained browser before/after receipt. */
  onDraftController?(controller: ComposerDraftController | null): void;
  onDraftChange?(snapshot: ComposerDraftSnapshot): void;
  onRemoveReference?(owner: ComposerDraftOwner, reference: ComposerReference, operation: ComposerDraftExternalOperation): Promise<'handled' | void>;
}

const targetKey = (target: MiniConversationTarget) => JSON.stringify([target.hostId, target.threadId, target.draftId,
  target.cwd, target.projectId ?? null, target.readOnly === true]);
const ownerOf = (target: MiniConversationTarget): ComposerDraftOwner => ({ hostId: target.hostId, threadId: target.threadId, draftId: target.draftId });
const ownerKey = (target: MiniConversationTarget) => JSON.stringify([target.hostId, target.threadId, target.draftId]);
const messageViewKey = (target: MiniConversationTarget) => JSON.stringify([target.hostId, target.threadId]);
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const notSent = (message: string) => Object.assign(new Error(message), { uncertain: false });
function requireSynchronous(value: unknown, message: string) {
  if (value && (typeof value === 'object' || typeof value === 'function') && 'then' in value
    && typeof value.then === 'function') {
    void Promise.resolve(value).catch(() => {});
    throw notSent(message);
  }
}
function validTarget(target: MiniConversationTarget) {
  return !!target.hostId && target.threadId !== '' && target.draftId.startsWith('mini:') && !!target.cwd;
}
interface SubmissionAuthority {
  acceptCreated(target: MiniConversationTarget): void;
}

export function MiniConversation(props: MiniConversationProps) {
  const latest = useRef(props); latest.current = props;
  const [target, setTarget] = useState(() => structuredClone(props.initialTarget));
  const targetRef = useRef(target); targetRef.current = target;
  const targetGeneration = useRef(0);
  const [readyKey, setReadyKey] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const [readVersion, setReadVersion] = useState(0);
  const [sendReadError, setSendReadError] = useState('');
  const [editState, setEditState] = useState<{ key: string; value: StoredMessageEdit | null; status: 'loading' | 'ready' | 'error' } | null>(null);
  const editRead = useRef<{ key: string; status: 'loading' | 'ready' | 'error'; pending?: Promise<void> } | null>(null);
  const composer = useRef<ComposerDraftController | null>(null);
  const mountedComposerKey = useRef<string | null>(null);
  const messageEditor = useRef<MessageEditNavigationController | null>(null);
  const editAccess = useMemo(() => props.edits.createAccess(), [props.edits]);
  const locked = useRef(false), inFlight = useRef(false), mounted = useRef(false);
  const submissionAuthorities = useRef(new WeakMap<() => void, SubmissionAuthority>());
  const provisionalRelease = useRef<(() => void) | null>(null);
  const key = ownerKey(target), usable = validTarget(target) && props.canUseOwner(ownerOf(target));
  const initialized = readyKey === key && (usable || mountedComposerKey.current === key);
  const conversation = useConversationSession(props.sessions, target.threadId ? { hostId: target.hostId, threadId: target.threadId } : null,
    target.readOnly === true, initialized, 0);
  const report = useCallback((cause: unknown) => {
    const text = errorText(cause); if (mounted.current) setError(text);
    try { latest.current.onError(text); } catch { /* The parent notification does not control recovery. */ }
  }, []);
  const changed = useCallback(() => { try { latest.current.onRecoveryChanged(); } catch { /* Notification only. */ } }, []);
  const receiveComposer = useCallback((value: ComposerDraftController | null) => {
    composer.current = value;
    mountedComposerKey.current = value ? ownerKey(targetRef.current) : null;
    latest.current.onDraftController?.(value);
  }, []);
  const receiveEditor = useCallback((value: MessageEditNavigationController | null) => { messageEditor.current = value; }, []);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; provisionalRelease.current?.(); provisionalRelease.current = null; };
  }, []);
  useEffect(() => {
    let active = true;
    setReadyKey(previous => previous === key ? previous : '');
    setSendReadError('');
    if (!validTarget(target)) { report('Mini 草稿目标无效，原输入已保留。'); return; }
    void props.sends.read().then(async state => {
      if (target.threadId) {
        const receipt = state.creations[sendThreadKey(target.hostId, target.threadId)];
        if (receipt && receipt.owner.draftId === target.draftId) await bindComposerDraftToThread(receipt.owner, target.threadId);
      }
      if (active) setReadyKey(key);
    }).catch(cause => { if (active) { setSendReadError(key); report(cause); } });
    return () => { active = false; };
  }, [props.sends, key, report, readVersion]);
  useEffect(() => {
    if (initialized && target.threadId && provisionalRelease.current) {
      provisionalRelease.current(); provisionalRelease.current = null;
    }
  }, [initialized, target.threadId]);
  useEffect(() => {
    let active = true, generation = 0;
    const read = () => {
      const sequence = ++generation;
      setEditState(previous => ({ key, value: previous?.key === key ? previous.value : null, status: 'loading' }));
      const pending = (target.threadId ? props.edits.read(target.hostId, target.threadId) : Promise.resolve(null)).then(value => {
        if (active && sequence === generation) { editRead.current = { key, status: 'ready' }; setEditState({ key, value, status: 'ready' }); }
      }).catch(cause => {
        if (active && sequence === generation) {
          editRead.current = { key, status: 'error' };
          setEditState(previous => ({ key, value: previous?.key === key ? previous.value : null, status: 'error' }));
          report(cause);
        }
      });
      editRead.current = { key, status: 'loading', pending };
    };
    read();
    window.addEventListener(messageEditChanged, read);
    const unsubscribe = props.client.subscribe(event => {
      if (event.type === 'persisted-atom-updated' && (!Array.isArray(event.keys) || !event.keys.length || event.keys.includes(messageEditsAtom))) read();
      if (event.type === 'persisted-atom-updated' && (!Array.isArray(event.keys) || !event.keys.length || event.keys.includes(sendsAtom))) changed();
    });
    return () => { active = false; window.removeEventListener(messageEditChanged, read); unsubscribe(); };
  }, [props.client, props.edits, key, report, changed, readVersion]);

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
      try { draftLease?.release(); } catch (releaseError) { report(releaseError); }
      try { editLease?.release(); } catch (releaseError) { report(releaseError); }
      locked.current = false;
      report(cause); return null;
    }
    let active = true, flushed = false, handedOff = false;
    return {
      async flush() {
        if (!active || !mounted.current) return false;
        flushed = false;
        try {
          await editLease?.flush();
          if (draftLease && !await draftLease.flush()) return false;
          await editLease?.flush();
          flushed = active && mounted.current && (!draftLease || await draftLease.flush());
          return flushed;
        } catch (cause) { report(cause); return false; }
      },
      handoff() {
        if (!active || !flushed || handedOff) throw new Error('Mini 编辑尚未完成保存，不能移交。');
        editLease?.handoff(); handedOff = true;
      },
      release() {
        if (!active) return;
        active = false;
        try { draftLease?.release(); } catch (cause) { report(cause); }
        if (!handedOff) try { editLease?.release(); } catch (cause) { report(cause); }
        locked.current = false; if (mounted.current) flushSync(() => setFrozen(false));
      },
    };
  }, [report]);

  const commitTarget = useCallback((next: MiniConversationTarget, handoff?: () => void) => {
    if (!validTarget(next) || !latest.current.canUseOwner(ownerOf(next))) throw new Error('Mini 目标或草稿 owner 不可用，原输入已保留。');
    const value = structuredClone(next), previous = structuredClone(targetRef.current);
    if (!latest.current.canUseOwner(ownerOf(previous))) throw new Error('Mini 原草稿的所有权已改变，未切换目标。');
    const persist = (target: MiniConversationTarget) => requireSynchronous(latest.current.onTargetChanged(structuredClone(target)),
      'Mini 目标必须同步持久化，未切换或发送。');
    let committed = false;
    try {
      persist(value);
      if (!mounted.current || targetKey(targetRef.current) !== targetKey(previous)
        || !latest.current.canUseOwner(ownerOf(previous)) || !latest.current.canUseOwner(ownerOf(value))) {
        throw new Error('Mini 草稿的所有权已改变，未切换目标。');
      }
      targetGeneration.current++;
      targetRef.current = value;
      committed = true;
      flushSync(() => { setTarget(value); setError(''); });
      handoff?.();
    } catch (cause) {
      if (committed) {
        targetGeneration.current++;
        targetRef.current = previous;
        flushSync(() => setTarget(previous));
      }
      try { persist(previous); }
      catch (restoreError) { throw new AggregateError([cause, restoreError], 'Mini 目标移交失败且原目标未能恢复，请核对保留的编辑：' + errorText(cause)); }
      throw cause;
    }
  }, []);

  const switchTarget = useCallback(async (next: MiniConversationTarget) => {
    const current = targetRef.current;
    if (targetKey(next) === targetKey(current)) return true;
    if (ownerKey(next) === ownerKey(current)) {
      if (locked.current || inFlight.current) { report('Mini 正在处理输入，请稍后再切换。'); return false; }
      try { commitTarget(next); return true; }
      catch (cause) { report(cause); return false; }
    }
    const lease = freeze();
    if (!lease) { report('Mini 正在处理输入，请稍后再切换。'); return false; }
    try {
      if (!await lease.flush()) throw new Error('Mini 草稿未能保存，当前输入已保留。');
      commitTarget(next, messageViewKey(next) === messageViewKey(current) ? undefined : () => lease.handoff()); return true;
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
      if (current && mountedComposerKey.current !== ownerKey(scope)) throw new Error('原 Mini 输入区尚未确认。');
      return current;
    } };
  }, []);

  const captureSubmissionAuthority = useCallback((owner: ComposerDraftOwner) => {
    const original = structuredClone(targetRef.current), source = latest.current;
    if (!mounted.current || locked.current || inFlight.current || original.readOnly
      || owner.hostId !== original.hostId || owner.threadId !== original.threadId || owner.draftId !== original.draftId
      || !source.isConnected(original.hostId)
      || !source.canUseOwner(owner)) throw notSent('Mini 会话或连接不可用，原输入已保留。');
    const parent: unknown = source.captureEditAuthority(structuredClone(owner));
    if (typeof parent !== 'function') {
      requireSynchronous(parent, 'Mini 发送权限必须同步捕获。');
      throw notSent('Mini 发送权限尚未同步确认，原输入已保留。');
    }
    let expected = targetKey(original), generation = targetGeneration.current;
    const checkParent = () => {
      try { requireSynchronous(parent(), 'Mini 发送权限检查必须同步完成。'); }
      catch (cause) { throw Object.assign(new Error('Mini 原连接或输入权限已改变，未发送。', { cause }), { uncertain: false }); }
      if (!mounted.current || latest.current.client !== source.client || latest.current.sessions !== source.sessions
        || latest.current.sends !== source.sends || !latest.current.isConnected(original.hostId)) {
        throw notSent('Mini 原连接或输入权限已改变，未发送。');
      }
    };
    const assert = () => {
      checkParent();
      if (targetGeneration.current !== generation || targetKey(targetRef.current) !== expected
        || !latest.current.canUseOwner(ownerOf(targetRef.current))) throw notSent('Mini 原输入目标或权限已改变，未发送。');
    };
    assert();
    submissionAuthorities.current.set(assert, { acceptCreated(next) {
      checkParent();
      if (original.threadId !== null || !next.threadId || next.hostId !== original.hostId || next.draftId !== original.draftId
        || targetGeneration.current !== generation + 1 || targetKey(targetRef.current) !== targetKey(next)) {
        throw notSent('Mini 新会话移交无法核对，原输入已保留。');
      }
      expected = targetKey(next); generation = targetGeneration.current;
      assert();
    } });
    return assert;
  }, []);

  const runSend = useCallback(async (draft: ComposerDraft, options: SubmitOptions, action: SubmitAction,
    description: ComposerSubmissionDescription, earlyAuthority: () => void, retry?: SendIntent) => {
    const authority = submissionAuthorities.current.get(earlyAuthority);
    if (!authority) throw notSent('Mini 原提交权限尚未捕获，未发送。');
    requireSynchronous(earlyAuthority(), 'Mini 发送权限检查必须同步完成。');
    if (inFlight.current || locked.current) throw notSent('Mini 正在处理其他操作，原输入已保留。');
    const original = structuredClone(targetRef.current), originalKey = targetKey(original);
    inFlight.current = true; setWorking(true); setError('');
    const creation: { target: MiniConversationTarget | null; lease: ComposerDraftLease | null; release: (() => void) | null; committed: boolean } =
      { target: null, lease: null, release: null, committed: false };
    const guard = (threadId: string | null, allowFirstTurn: boolean) => {
      requireSynchronous(earlyAuthority(), 'Mini 发送权限检查必须同步完成。');
      const owner = threadId && creation.target?.threadId === threadId ? ownerOf(creation.target) : ownerOf(original);
      const expectedKey = creation.committed && creation.target ? targetKey(creation.target) : originalKey;
      if (!mounted.current || targetKey(targetRef.current) !== expectedKey || original.readOnly
        || !latest.current.isConnected(original.hostId) || !latest.current.canUseOwner(owner)
        || !creation.committed && !latest.current.canUseOwner(ownerOf(original))
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
        dispatch: latest.current.dispatchSubmission,
        cleanup: { controller: intent => cleanupFor(creation.committed && creation.target ? creation.target : original).controller(intent) },
        recoveryChanged: changed,
        assignCreatedProject: async (value, assertAuthority) => {
          if (!latest.current.onAssignCreatedProject) throw notSent('项目关联尚未接入，原输入已保留。');
          await latest.current.onAssignCreatedProject({ ...value.owner, cwd: value.cwd, projectId: value.projectId }, value.thread, assertAuthority);
        },
        prepareCreated: async () => {
          guard(null, true);
          const controller = composer.current, snapshot = controller?.snapshot();
          if (!controller || !snapshot || snapshot.owner.hostId !== original.hostId || snapshot.owner.threadId !== original.threadId
            || snapshot.owner.draftId !== original.draftId
            || !(creation.lease = controller.freeze(snapshot.owner))) throw notSent('原 Mini 草稿尚不能冻结，会话创建回执已保留。');
          if (!await creation.lease.flush()) throw notSent('原 Mini 草稿未能保存，会话创建回执已保留。');
          guard(null, true);
        },
        selectCreated: async thread => {
          rememberMiniCreatedDraft(original.hostId, thread.id, original.draftId);
          creation.target = { ...original, threadId: thread.id, cwd: thread.cwd || original.cwd };
          if (!latest.current.canUseOwner(ownerOf(creation.target))) throw notSent('新会话草稿正由另一编辑器使用，原输入已保留。');
          creation.release = latest.current.sessions.acquire({ hostId: original.hostId, threadId: thread.id }, false);
          await latest.current.sessions.ready({ hostId: original.hostId, threadId: thread.id }, true);
          guard(thread.id, true);
          commitTarget(creation.target, () => authority.acceptCreated(creation.target!));
          creation.committed = true;
          provisionalRelease.current?.(); provisionalRelease.current = creation.release; creation.release = null;
          creation.lease?.release(); creation.lease = null;
        },
      }, original, draft, options, action, description, retry);
    } catch (cause) { report(cause); throw cause; }
    finally {
      try { creation.release?.(); } catch (cause) { report(cause); }
      try { creation.lease?.release(); } catch (cause) { report(cause); }
      inFlight.current = false; if (mounted.current) setWorking(false);
    }
  }, [changed, cleanupFor, commitTarget, report]);

  const retry = useCallback(async (id: string) => {
    const scope = structuredClone(targetRef.current), authority = captureSubmissionAuthority(ownerOf(scope));
    const state = await latest.current.sends.read();
    requireSynchronous(authority(), 'Mini 发送权限检查必须同步完成。');
    const current = state.requests[id];
    const resumingCreated = current && scope.threadId === null && current.owner.threadId === null && current.threadId
      && current.created?.thread.id === current.threadId && state.bindings[sendThreadKey(scope.hostId, current.threadId)] === scope.draftId;
    if (!current || current.owner.hostId !== scope.hostId || current.owner.draftId !== scope.draftId || current.threadId !== scope.threadId && !resumingCreated
      || !['prepared', 'ready', 'failed'].includes(current.stage)) throw notSent('此 Mini 原发送不可重试，恢复记录已保留。');
    await runSend(current.draft, current.options, current.action ?? { type: 'send' },
      { owner: current.owner, revision: current.revision, overrides: current.overrides,
        ...(current.documentPlainTextMode !== undefined ? { documentPlainTextMode: current.documentPlainTextMode } : {}) }, authority, current);
  }, [captureSubmissionAuthority, runSend]);
  const finish = useCallback(async (id: string) => {
    const scope = structuredClone(targetRef.current), current = (await latest.current.sends.read()).requests[id];
    if (!current || current.owner.hostId !== scope.hostId || current.owner.draftId !== scope.draftId) throw new Error('此 Mini 原发送记录不可用。');
    try { await finishConversationSend(latest.current.sends, current, cleanupFor(scope)); }
    finally { changed(); }
  }, [changed, cleanupFor]);
  const retryRecovery = useCallback(() => setReadVersion(value => value + 1), []);
  const controller = useMemo<MiniConversationController>(() => ({ target: () => structuredClone(targetRef.current), freeze, switchTarget, retry, finish, retryRecovery }),
    [freeze, switchTarget, retry, finish, retryRecovery]);
  useLayoutEffect(() => { props.onController(controller); return () => props.onController(null); }, [props.onController, controller]);

  const onEdit = async (draft: ComposerDraft, origin: MessageEditOrigin, prepare: () => Promise<void>) => {
    const current = structuredClone(targetRef.current), identity = current.threadId && { hostId: current.hostId, threadId: current.threadId };
    if (!identity || origin.hostId !== identity.hostId || origin.threadId !== identity.threadId || current.readOnly || inFlight.current || locked.current) {
      throw notSent('消息编辑目标已改变，原输入已保留。');
    }
    const generation = targetGeneration.current, source = structuredClone(origin), assertAccess = editAccess.capture(source);
    const assertParent: unknown = latest.current.captureEditAuthority(ownerOf(current));
    if (typeof assertParent !== 'function') {
      requireSynchronous(assertParent, '消息编辑权限必须同步捕获，未修改会话。');
      throw notSent('消息编辑权限尚未同步确认，原输入已保留。');
    }
    inFlight.current = true; setWorking(true);
    try {
      assertAccess();
      requireSynchronous(assertParent(), '消息编辑权限检查必须同步完成，未修改会话。');
      await prepare();
      while (mounted.current && editRead.current?.key === ownerKey(current) && editRead.current.status === 'loading') {
        const reading = editRead.current, pending = reading.pending;
        if (!pending) break;
        await pending;
        if (editRead.current === reading) break;
      }
      if (!mounted.current || editRead.current?.key !== ownerKey(current) || editRead.current.status !== 'ready') throw notSent('消息编辑恢复尚未读完，原输入已保留。');
      await props.sessions.ready(identity);
      const view = props.sessions.view(identity).snapshot();
      if (targetKey(targetRef.current) !== targetKey(current) || !latest.current.isConnected(identity.hostId)
        || !latest.current.canUseOwner(ownerOf(current)) || !view.canSubmit) throw notSent('会话连接已改变，编辑已保留。');
      const result = await submitDraft(props.client, { ...identity, cwd: view.thread?.cwd || current.cwd, readOnly: false,
        activeTurnId: view.thread?.turns.find(turn => turn.status === 'inProgress')?.id ?? null, thread: view.thread,
        initialOptions: view.options ?? undefined }, draft, {}, { type: 'send' }, async () => {}, origin,
      (actual, expected, params) => props.edits.submit(actual, expected, params, () => {
        assertAccess();
        requireSynchronous(assertParent(), '消息编辑权限检查必须同步完成，未修改会话。');
        const view = latest.current.sessions.view(identity).snapshot();
        if (!mounted.current || targetGeneration.current !== generation || targetKey(targetRef.current) !== targetKey(current)
          || actual.hostId !== source.hostId || actual.threadId !== source.threadId || actual.turnId !== source.turnId || actual.itemId !== source.itemId
          || latest.current.client !== props.client || latest.current.sessions !== props.sessions || latest.current.edits !== props.edits
          || !latest.current.isConnected(identity.hostId) || !latest.current.canUseOwner(ownerOf(current)) || !view.canSubmit || locked.current) {
          throw notSent('消息编辑来源或权限已改变，未修改会话。');
        }
      }));
      if (result.turn) props.sessions.started(identity, result.turn);
    } catch (cause) { report(cause); throw cause; }
    finally { inFlight.current = false; if (mounted.current) setWorking(false); }
  };

  const startQueued = async (id: string, earlyAuthority?: () => void) => {
    if (!earlyAuthority) throw notSent('Mini 队列原权限尚未捕获，未启动。');
    requireSynchronous(earlyAuthority(), 'Mini 队列权限检查必须同步完成。');
    const current = structuredClone(targetRef.current), identity = current.threadId && { hostId: current.hostId, threadId: current.threadId };
    if (!identity || current.readOnly || inFlight.current || locked.current) throw notSent('Mini 会话暂时无法启动队列。');
    inFlight.current = true; setWorking(true);
    let dispatched = false;
    try {
      await props.sessions.ready(identity);
      const assertAuthority = () => {
        try { requireSynchronous(earlyAuthority(), 'Mini 队列权限检查必须同步完成。'); }
        catch (cause) { throw Object.assign(new Error('Mini 队列原权限已改变，未启动。', { cause }), { uncertain: false }); }
        const view = props.sessions.view(identity).snapshot();
        if (targetKey(targetRef.current) !== targetKey(current) || !latest.current.isConnected(identity.hostId)
          || !latest.current.canUseOwner(ownerOf(current)) || !view.canSubmit || isThreadBusy(view.thread)) throw notSent('会话目标或状态已改变，队列未启动。');
      };
      assertAuthority();
      dispatched = true;
      await props.dispatchSubmission('thread/queue/start', { threadId: identity.threadId, queuedSubmissionId: id }, identity.hostId, assertAuthority);
    } catch (cause) {
      if (!dispatched) throw Object.assign(new Error(errorText(cause), { cause }), { uncertain: false });
      throw cause;
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
  const edit = editState?.key === key && editState.status === 'ready' ? editState.value : null;
  const thread = conversation.thread?.id === target.threadId ? conversation.thread : null;
  return <div className="yard-mini-conversation" inert={frozen}>
    {target.threadId && <button type="button" className="yard-mini-conversation-open" disabled={!usable} onClick={() => props.onOpenThread({ hostId: target.hostId, threadId: target.threadId! })}>
      {thread?.name || 'Open conversation'}
    </button>}
    {error && <p role="alert">{error}</p>}
    {(sendReadError === key || editState?.key === key && editState.status === 'error')
      && <button type="button" onClick={retryRecovery}>Retry recovery</button>}
    {!usable && <p role="status">Mini 草稿正在其他编辑器中使用，原内容已保留。</p>}
    {conversation.error && <p role="status">{conversation.error}</p>}
    {conversation.streamGap && <p role="status">会话内容正在核对。</p>}
    {target.threadId && <div className="yard-mini-conversation-messages" inert={!usable}>
      {conversation.loading ? <p role="status">Loading conversation...</p> : <StandaloneMessages client={props.client} hostId={target.hostId} thread={thread}
        editAccess={editAccess} editRecovery={edit?.recovery ?? null} editRebase={messageEditRebaseMarker(edit)} editHistory={{ order: 'ascending', tailComplete: conversation.historyComplete }}
        onEditNavigationController={receiveEditor} onEditDraftChange={(value, origin, version) => props.edits.save(value, origin, version)}
        onPrepareEditRebase={(origin, version) => props.edits.prepareRebase(origin, version)} onCommitEditRebase={async candidate => {
          const recovered = await props.edits.commitRebase(candidate); void props.sessions.refresh(recovered.origin).catch(report); return recovered;
        }} onEdit={target.readOnly || editState?.key !== key || editState.status !== 'ready' ? undefined : onEdit}
        onOpenFileAt={location => { if (target.threadId) props.onOpenFile?.({ ...location, threadId: target.threadId }); }}
        onOpenFile={path => { if (target.threadId) props.onOpenFile?.({ hostId: target.hostId, threadId: target.threadId, path, cwd: target.cwd }); }}
        onOpenVisualization={props.onOpenVisualization} onOpenBrowser={props.onOpenBrowser} />}
    </div>}
    {target.readOnly && <p role="status">此会话已归档，原输入已保留。</p>}
    <div inert={target.readOnly === true || !usable}>
    {initialized && (!target.threadId || !conversation.loading && conversation.options || composer.current) && <StandaloneComposer
      client={props.client} context={{ ...ownerOf(target), cwd: thread?.cwd || target.cwd, placement: 'mini' }}
      captureSubmissionAuthority={captureSubmissionAuthority}
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
      onSubmit={(draft, options, action, description, assertAuthority) => {
        if (!description) return Promise.reject(notSent('缺少原草稿版本，未发送。'));
        if (!assertAuthority) return Promise.reject(notSent('Mini 原提交权限尚未捕获，未发送。'));
        return runSend(draft, options, action, description, assertAuthority);
      }} onInterrupt={interrupt} onStartQueued={startQueued} />}
    </div>
  </div>;
}
