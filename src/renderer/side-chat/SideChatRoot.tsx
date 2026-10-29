import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { SideChatWorkspace } from '../app/SideChatWorkspace.tsx';
import type { SideChatWorkspaceNavigationController, SideChatWorkspaceNavigationLease, SideChatWorkspaceProjection, SideChatWorkspaceProps } from '../app/SideChatWorkspace.tsx';
import type { SideChatWorkspaceIdentity } from '../app/side-chat-workspace-runtime.ts';
import type { BrowserWorkbenchClient } from '../app/client.ts';
import type { ConversationSessions } from '../app/conversation-sessions.ts';
import type { SendIntent, SendRecoveryStore } from '../app/send-recovery.ts';
import type { MessageEditRecoveryStore } from '../app/message-edit-recovery.ts';
import type { ApprovalRequestsController } from '../app/approval-requests.ts';
import type { ComposerDraftController, ComposerDraftOwner, ComposerDraftSnapshot, StandaloneComposerRuntimeProps } from '../composer/StandaloneComposer.tsx';
import { composerDraftAtomKey } from '../composer/composer-draft-store.ts';
import type { MessageEditNavigationController } from '../messages/StandaloneMessages.tsx';
import { readBrowserAtoms } from '../storage/ui-atoms.ts';
import { readSideChatDraftAssociation } from './browser-authority.ts';
import type { SideChatBrowserIdentity, SideChatChildDispatchAuthority, SideChatDraftAssociation, SideChatDraftIdentity, SideChatSendLease } from './browser-authority.ts';
import type { WorkbenchDispatchOptions } from '../workbench-contract.ts';
import type { VisualizationFollowUp } from '../visualizations/index.tsx';

export interface SideChatRootParent {
  hostId: string;
  threadId: string;
  cwd: string;
  archived: boolean;
}
/** Captured synchronously by Main, including its original route and navigation grant. */
export interface SideChatRootParentGrant {
  parent: SideChatRootParent;
  assertCurrent(): void;
}
export interface SideChatRootChild {
  identity: SideChatWorkspaceIdentity;
  owner: ComposerDraftOwner;
  draft: ComposerDraftController;
  snapshot: ComposerDraftSnapshot;
  editNavigation: MessageEditNavigationController | null;
  navigation: SideChatWorkspaceNavigationController | null;
}
export interface SideChatMountedEntry {
  readonly identity: Readonly<SideChatWorkspaceIdentity>;
  readonly owner: Readonly<ComposerDraftOwner> | null;
  readonly title: string | null;
  readonly working: boolean | null;
  readonly active: boolean;
}
export interface SideChatRootController {
  /** Explicit user action; captures Main and the current daemon before scheduling React work. */
  open(): Promise<SideChatWorkspaceIdentity>;
  /** Observe an existing durable association; never grants its old operation dispatch rights. */
  restore(identity: SideChatDraftIdentity): Promise<SideChatWorkspaceIdentity>;
  listRecoverable(): Promise<SideChatDraftAssociation[]>;
  /** Read mounted UI projections without acquiring or changing an operation's authority. */
  listMounted(): readonly SideChatMountedEntry[];
  show(draftId: string): Promise<void>;
  activeChild(): SideChatRootChild | null;
  submitVisualization(request: VisualizationFollowUp, signal: AbortSignal): Promise<void>;
  freeze(): SideChatWorkspaceNavigationLease | null;
}
export interface SideChatRootProps {
  client: BrowserWorkbenchClient;
  sessions: ConversationSessions;
  sends: SendRecoveryStore;
  edits: MessageEditRecoveryStore;
  approvals: ApprovalRequestsController;
  visible: boolean;
  captureParent(): SideChatRootParentGrant;
  onController(controller: SideChatRootController | null): void;
  onActiveChild(child: SideChatRootChild | null): void;
  onClosed(identity: SideChatWorkspaceIdentity): void;
  onExitObservation(identity: SideChatWorkspaceIdentity): void;
  cleanupChild(identity: SideChatBrowserIdentity): Promise<void>;
  /** Freeze and drain the existing shared owner/attachment authority for this exact draft. */
  freezeChildOwner(owner: ComposerDraftOwner, identity: SideChatWorkspaceIdentity,
    draft: ComposerDraftController | null, assertOriginal: () => void): SideChatSendLease;
  /** Compare owner, attempt, revision and stage and run the guard in the same shared IDB transaction. */
  cancelSend(intent: SendIntent, assertCurrent: () => void): Promise<void>;
  onRemoveReference(child: SideChatRootChild, ...args: Parameters<NonNullable<StandaloneComposerRuntimeProps['onRemoveReference']>>): Promise<'handled' | void>;
  onOpenFile: NonNullable<SideChatWorkspaceProps['onOpenFile']>;
  onOpenBrowser: NonNullable<SideChatWorkspaceProps['onOpenBrowser']>;
  onOpenVisualization: NonNullable<SideChatWorkspaceProps['onOpenVisualization']>;
  approvalOptions?: SideChatWorkspaceProps['approvalOptions'];
}

type Daemon = ReturnType<BrowserWorkbenchClient['captureDaemonConnection']>;
interface Entry {
  identity: SideChatWorkspaceIdentity;
  parent: SideChatRootParentGrant;
  daemon: Daemon;
  client: BrowserWorkbenchClient;
  sessions: ConversationSessions;
  sends: SendRecoveryStore;
  edits: MessageEditRecoveryStore;
  approvals: ApprovalRequestsController;
  navigation: SideChatWorkspaceNavigationController | null;
  draft: ComposerDraftController | null;
  editNavigation: MessageEditNavigationController | null;
  projection: SideChatWorkspaceProjection | null;
  frozen: { purpose?: 'cancel' } | null;
  pending: Set<Promise<unknown>>;
  activation: number;
}
interface Grant { entry: Entry; owner: ComposerDraftOwner; daemon: Daemon; childAuthority?: SideChatChildDispatchAuthority;
  check(): void; checkWithFreeze(lease: object): void }
const beforeSend = (message: string) => Object.assign(new Error(message), { uncertain: false as const, sendPhase: 'before-send' as const });
const nonempty = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
const sameOwner = (a: ComposerDraftOwner, b: ComposerDraftOwner) => a.hostId === b.hostId && a.threadId === b.threadId && a.draftId === b.draftId;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function synchronous(value: unknown): void {
  if (value && (typeof value === 'object' || typeof value === 'function') && 'then' in value && typeof value.then === 'function') {
    void Promise.resolve(value).catch(() => {});
    throw beforeSend('原侧聊授权必须同步检查。');
  }
}

/** Owns only mounted UI leases; durable operations and drafts remain in the existing stores. */
export function SideChatRoot(props: SideChatRootProps) {
  const latest = useRef(props); latest.current = props;
  const entries = useRef<Entry[]>([]), active = useRef<string | null>(null), alive = useRef(true), navigating = useRef(false);
  const switching = useRef<{ lease: SideChatWorkspaceNavigationLease; commit(): unknown; flushed: boolean; running: boolean } | null>(null);
  const [switchError, setSwitchError] = useState('');
  const grants = useRef(new WeakMap<() => void, Grant>());
  const [, render] = useState(0);
  const refresh = () => render(value => value + 1);
  const child = (entry: Entry): SideChatRootChild | null => {
    const snapshot = entry.draft?.snapshot();
    if (!entry.draft || !snapshot?.owner.threadId || snapshot.owner.hostId !== entry.identity.hostId
      || snapshot.owner.draftId !== entry.identity.draftId) return null;
    return { identity: structuredClone(entry.identity), owner: structuredClone(snapshot.owner), draft: entry.draft,
      snapshot: structuredClone(snapshot), editNavigation: entry.editNavigation, navigation: entry.navigation };
  };
  const publish = () => latest.current.onActiveChild(entries.current.find(item => item.identity.draftId === active.current)
    ? child(entries.current.find(item => item.identity.draftId === active.current)!) : null);
  const assertEntry = (entry: Entry) => {
    const now = latest.current;
    if (!alive.current || !entries.current.includes(entry) || now.client !== entry.client || now.sessions !== entry.sessions
      || now.sends !== entry.sends || now.edits !== entry.edits || now.approvals !== entry.approvals) throw beforeSend('原侧聊工作区已改变。');
    synchronous(entry.parent.assertCurrent()); entry.daemon.assertOriginal();
  };
  const captureParent = () => {
    const grant = latest.current.captureParent();
    if (!grant || !grant.parent || !nonempty(grant.parent.hostId) || !nonempty(grant.parent.threadId)
      || !nonempty(grant.parent.cwd) || typeof grant.parent.archived !== 'boolean' || typeof grant.assertCurrent !== 'function') {
      throw beforeSend('原父会话身份尚未确认。');
    }
    const parent = structuredClone(grant.parent), assert = grant.assertCurrent.bind(grant);
    synchronous(assert());
    const daemon = latest.current.client.captureDaemonConnection(parent.hostId);
    daemon.assertOriginal();
    return { parent: { parent, assertCurrent: assert }, daemon };
  };
  const assertSwitch = (draftId: string | null) => {
    const selected = entries.current.find(entry => entry.identity.draftId === active.current);
    if (selected?.frozen?.purpose === 'cancel' && draftId !== active.current) {
      throw beforeSend('原侧聊取消尚未完成。');
    }
  };
  const add = (identity: SideChatWorkspaceIdentity, parent: SideChatRootParentGrant, daemon: Daemon) => {
    if (!alive.current || navigating.current) throw beforeSend('侧聊正在移交，不能打开新实例。');
    assertSwitch(identity.draftId);
    if (entries.current.some(entry => entry.identity.draftId === identity.draftId || entry.identity.prepareId === identity.prepareId)) {
      throw beforeSend('原侧聊草稿已在本页挂载。');
    }
    const now = latest.current;
    const entry: Entry = { identity: structuredClone(identity), parent, daemon, client: now.client, sessions: now.sessions,
      sends: now.sends, edits: now.edits, approvals: now.approvals, navigation: null, draft: null, editNavigation: null, projection: null,
      frozen: null, pending: new Set(), activation: 0 };
    entries.current.push(entry); select(identity.draftId);
    return structuredClone(identity);
  };
  const select = (draftId: string | null) => {
    if (active.current !== draftId) {
      const old = entries.current.find(entry => entry.identity.draftId === active.current);
      if (old) old.activation++;
      const next = entries.current.find(entry => entry.identity.draftId === draftId);
      if (next) next.activation++;
      active.current = draftId;
    }
    refresh(); publish();
  };
  const resumeSwitch = async (): Promise<unknown> => {
    const transition = switching.current;
    if (!transition || transition.running) throw beforeSend('原侧聊切换正在处理。');
    transition.running = true;
    try {
      if (!transition.flushed) {
        if (!await transition.lease.flush()) {
          transition.lease.release(); switching.current = null; navigating.current = false;
          throw beforeSend('原侧聊尚未排空，未切换。');
        }
        transition.flushed = true;
      }
      await transition.lease.revoke();
      navigating.current = false;
      let result: unknown;
      try { result = transition.commit(); }
      catch (cause) {
        transition.lease.release(); switching.current = null;
        const original = entries.current.find(entry => entry.identity.draftId === active.current);
        if (original?.navigation) void original.navigation.activate().catch(() => {});
        throw cause;
      }
      transition.lease.release(); switching.current = null;
      setSwitchError('');
      const selected = entries.current.find(entry => entry.identity.draftId === active.current);
      if (selected?.navigation) void selected.navigation.activate().catch(() => {});
      return result;
    } catch (cause) {
      if (switching.current === transition) setSwitchError('原侧聊撤权尚未确认，原稿保持冻结。');
      throw cause;
    } finally { transition.running = false; refresh(); }
  };
  const switchTo = <T,>(draftId: string, commit: () => T, allowFrozen = false): Promise<T> => {
    if (!alive.current || navigating.current || switching.current) throw beforeSend('侧聊正在移交。');
    assertSwitch(draftId);
    const selected = entries.current.find(entry => entry.identity.draftId === active.current);
    if (!selected || active.current === draftId || allowFrozen && selected.frozen) return Promise.resolve(commit());
    const lease = selected.navigation?.freeze();
    if (!lease) throw beforeSend('原侧聊尚不能冻结，未切换。');
    navigating.current = true;
    switching.current = { lease, commit, flushed: false, running: false };
    refresh();
    return resumeSwitch() as Promise<T>;
  };
  const open = () => {
    if (navigating.current || !alive.current) throw beforeSend('侧聊正在移交。');
    const { parent, daemon } = captureParent();
    if (parent.parent.archived) throw beforeSend('归档会话不能打开侧聊。');
    const identity: SideChatWorkspaceIdentity = { hostId: parent.parent.hostId, parentThreadId: parent.parent.threadId, cwd: parent.parent.cwd,
      draftId: crypto.randomUUID(), prepareId: crypto.randomUUID(), mode: 'new' };
    return switchTo(identity.draftId, () => { synchronous(parent.assertCurrent()); daemon.assertOriginal(); return add(identity, parent, daemon); });
  };
  const track = <T,>(entry: Entry, action: () => Promise<T>): Promise<T> => {
    let result: Promise<T>;
    try { result = Promise.resolve(action()); } catch (error) { return Promise.reject(error); }
    entry.pending.add(result);
    void result.then(() => entry.pending.delete(result), () => entry.pending.delete(result));
    return result;
  };
  const freezeSending = (entry: Entry, owner: ComposerDraftOwner, purpose?: 'cancel'): SideChatSendLease => {
    assertEntry(entry);
    const snapshot = entry.draft?.snapshot();
    if (entry.frozen || owner.hostId !== entry.identity.hostId || owner.draftId !== entry.identity.draftId
      || snapshot && !sameOwner(snapshot.owner, owner) || !snapshot && owner.threadId !== null) throw beforeSend('原侧聊输入租约不可用。');
    const lease = { purpose }; entry.frozen = lease;
    let parentLease: SideChatSendLease;
    try { parentLease = latest.current.freezeChildOwner(structuredClone(owner), structuredClone(entry.identity), entry.draft, () => assertEntry(entry)); }
    catch (error) { entry.frozen = null; throw error; }
    if (!parentLease || typeof parentLease.drain !== 'function' || typeof parentLease.assertCurrent !== 'function'
      || typeof parentLease.release !== 'function') {
      entry.frozen = null; throw beforeSend('原侧聊跨视图输入租约不可用。');
    }
    if (purpose === 'cancel') refresh();
    return {
      async drain() {
        synchronous(parentLease.assertCurrent()); await parentLease.drain();
        while (entry.pending.size) await Promise.allSettled([...entry.pending]);
        synchronous(parentLease.assertCurrent());
      },
      assertCurrent() {
        assertEntry(entry); if (entry.frozen !== lease) throw beforeSend('原侧聊输入租约已改变。');
        synchronous(parentLease.assertCurrent());
      },
      release() { if (entry.frozen === lease) { parentLease.release(); entry.frozen = null; if (purpose === 'cancel' && alive.current) refresh(); } },
    };
  };
  const capture = (entry: Entry, owner: ComposerDraftOwner, childAuthority?: SideChatChildDispatchAuthority): (() => void) => {
    assertEntry(entry);
    const snapshot = entry.draft?.snapshot();
    if (navigating.current || entry.frozen || entry.identity.mode !== 'new' || active.current !== entry.identity.draftId
      || !snapshot || !owner.threadId || !sameOwner(snapshot.owner, owner)) throw beforeSend('原侧聊输入权限不可用。');
    const daemon = latest.current.client.captureDaemonConnection(owner.hostId);
    if (daemon.generation !== entry.daemon.generation) throw beforeSend('原侧聊连接代次已改变。');
    const fixed = structuredClone(owner), activation = entry.activation;
    if (childAuthority && (childAuthority.proof.identity.hostId !== fixed.hostId || childAuthority.proof.identity.childThreadId !== fixed.threadId
      || childAuthority.proof.identity.draftId !== fixed.draftId || childAuthority.proof.identity.connectionGeneration !== daemon.generation)) {
      throw beforeSend('原侧聊子会话授权身份已改变。');
    }
    const checkFor = (lease: object | null) => {
      assertEntry(entry); daemon.assertOriginal();
      const current = entry.draft?.snapshot();
      if (navigating.current || entry.activation !== activation || entry.frozen !== lease || active.current !== entry.identity.draftId
        || !current || !sameOwner(current.owner, fixed)) throw beforeSend('原侧聊输入权限已改变。');
      childAuthority?.assertCurrent();
    };
    const check = () => checkFor(null);
    check(); grants.current.set(check, { entry, owner: fixed, daemon, childAuthority, check, checkWithFreeze: lease => checkFor(lease) }); return check;
  };
  const grantFor = (entry: Entry, original: (() => void) | null, hostId: string, threadId: unknown) => {
    const grant = original && grants.current.get(original);
    if (!grant || !grant.childAuthority || grant.entry !== entry || grant.owner.hostId !== hostId || grant.owner.threadId !== threadId) {
      throw beforeSend('原侧聊操作授权或目标已改变。');
    }
    grant.check(); return grant;
  };
  const api = useMemo<SideChatRootController>(() => ({
    open,
    async restore(identity) {
      if (navigating.current || !alive.current) throw beforeSend('侧聊正在移交。');
      const { parent, daemon } = captureParent(), fixed = structuredClone(identity);
      assertSwitch(fixed.draftId);
      if (fixed.hostId !== parent.parent.hostId || fixed.parentThreadId !== parent.parent.threadId) throw beforeSend('原侧聊父会话已改变。');
      const existing = entries.current.find(entry => entry.identity.draftId === fixed.draftId && entry.identity.prepareId === fixed.prepareId);
      if (existing) {
        if (existing.identity.hostId !== fixed.hostId || existing.identity.parentThreadId !== fixed.parentThreadId
          || existing.identity.cwd !== parent.parent.cwd) throw beforeSend('已挂载侧聊的原父会话已改变。');
        return switchTo(fixed.draftId, () => { select(fixed.draftId); return structuredClone(existing.identity); });
      }
      const saved = await readSideChatDraftAssociation(fixed);
      synchronous(parent.assertCurrent()); daemon.assertOriginal();
      if (!saved || saved.parentCwd && saved.parentCwd !== parent.parent.cwd) throw beforeSend('原侧聊草稿或父工作目录无法确认。');
      return switchTo(fixed.draftId, () => { synchronous(parent.assertCurrent()); daemon.assertOriginal();
        return add({ ...fixed, cwd: parent.parent.cwd, mode: 'restore' }, parent, daemon); });
    },
    async listRecoverable() {
      const { parent, daemon } = captureParent(), atoms = await readBrowserAtoms();
      synchronous(parent.assertCurrent()); daemon.assertOriginal();
      const root = atoms[composerDraftAtomKey], found: SideChatDraftAssociation[] = [];
      if (root === undefined) return found;
      if (!object(root) || !object(root.entries)) throw new Error('侧聊草稿存储无法识别，原记录已保留。');
      for (const value of Object.values(root.entries)) {
        if (!object(value) || value.sideChat === undefined) continue;
        if (!object(value.sideChat)) throw new Error('侧聊草稿关联无法识别，原记录已保留。');
        const association = value.sideChat;
        if (association.hostId !== parent.parent.hostId || association.parentThreadId !== parent.parent.threadId) continue;
        if (!nonempty(association.draftId) || !nonempty(association.prepareId)) throw new Error('原侧聊草稿关联无法识别。');
        const saved = await readSideChatDraftAssociation({ hostId: parent.parent.hostId, parentThreadId: parent.parent.threadId,
          draftId: association.draftId, prepareId: association.prepareId });
        synchronous(parent.assertCurrent()); daemon.assertOriginal();
        if (saved) found.push(saved);
      }
      return found;
    },
    listMounted() {
      return entries.current.map(entry => {
        const snapshot = entry.draft?.snapshot();
        const owned = snapshot?.owner.hostId === entry.identity.hostId && snapshot.owner.draftId === entry.identity.draftId ? snapshot : null;
        const projection = !owned?.owner.threadId || !entry.projection?.childThreadId
          || owned.owner.threadId === entry.projection.childThreadId ? entry.projection : null;
        const title = projection?.title || owned?.draft.text.split(/\r?\n/, 1)[0]?.trim() || null;
        return { identity: structuredClone(entry.identity), owner: owned ? structuredClone(owned.owner) : null,
          title, working: projection?.working ?? null, active: active.current === entry.identity.draftId };
      });
    },
    show(draftId) {
      if (navigating.current || !entries.current.some(entry => entry.identity.draftId === draftId)) throw beforeSend('原侧聊未挂载。');
      assertSwitch(draftId);
      return switchTo(draftId, () => { select(draftId); });
    },
    activeChild() { const entry = entries.current.find(item => item.identity.draftId === active.current); return entry ? child(entry) : null; },
    submitVisualization(request, signal) {
      const entry = entries.current.find(item => item.identity.draftId === active.current);
      if (!entry || navigating.current || entry.frozen || !entry.navigation) throw beforeSend('原侧聊不可接收可视化输入。');
      assertEntry(entry);
      return entry.navigation.submitVisualization(request, signal);
    },
    freeze() {
      if (!alive.current || navigating.current) return null;
      navigating.current = true;
      const leases: SideChatWorkspaceNavigationLease[] = [];
      try {
        for (const entry of entries.current) {
          const lease = entry.navigation?.freeze();
          if (!lease) throw beforeSend('原侧聊尚不能冻结。');
          leases.push(lease);
        }
      } catch {
        for (const prior of leases.reverse()) prior.release();
        navigating.current = false; return null;
      }
      let valid = true, flushed = false, attempted = false, revoked = 0, handedOff = false;
      return {
        async flush() {
          if (!valid || attempted) return false;
          flushed = false;
          for (const lease of leases) if (!await lease.flush()) return false;
          flushed = true; return true;
        },
        async revoke() {
          if (!valid || !flushed || handedOff) throw new Error('侧聊尚未排空。');
          attempted = true;
          while (revoked < leases.length) { await leases[revoked]!.revoke(); revoked++; }
        },
        handoff() {
          if (!valid || !flushed || revoked !== leases.length || handedOff) throw new Error('侧聊撤权尚未确认。');
          for (const lease of leases) lease.handoff();
          handedOff = true;
        },
        release() {
          if (!valid) return;
          if (attempted && revoked !== leases.length) throw new Error('侧聊撤权尚未确认，原稿保持冻结。');
          for (const lease of leases) lease.release();
          valid = false; navigating.current = false;
          if (handedOff) { entries.current = []; active.current = null; refresh(); publish(); }
          else {
            const selected = entries.current.find(entry => entry.identity.draftId === active.current);
            if (selected?.navigation) void selected.navigation.activate().catch(() => {});
          }
        },
      };
    },
  }), []);
  const controllerCallback = useRef(props.onController); controllerCallback.current = props.onController;
  useLayoutEffect(() => {
    alive.current = true; controllerCallback.current(api);
    return () => { alive.current = false; controllerCallback.current(null); };
  }, [api]);

  return <section aria-label="侧聊工作区" hidden={!props.visible}>
    {switchError && <div role="alert">{switchError}{switching.current && <button type="button" onClick={() => void resumeSwitch().catch(() => {})}>重试撤销权限</button>}</div>}
    {entries.current.length > 1 && <nav aria-label="侧聊实例">{entries.current.map((entry, index) =>
      <button key={entry.identity.draftId} type="button" aria-current={active.current === entry.identity.draftId ? 'page' : undefined}
        disabled={entry.identity.draftId !== active.current && entries.current.find(item => item.identity.draftId === active.current)?.frozen?.purpose === 'cancel'}
        onClick={() => { try { void api.show(entry.identity.draftId).catch(() => {}); } catch (cause) { setSwitchError(cause instanceof Error ? cause.message : String(cause)); } }}>侧聊 {index + 1}</button>)}</nav>}
    {entries.current.map(entry => <div key={entry.identity.draftId} hidden={active.current !== entry.identity.draftId}>
      <SideChatWorkspace client={entry.client} identity={entry.identity}
      open={props.visible && active.current === entry.identity.draftId} startOnMount={entry.identity.mode === 'new'}
      sessions={entry.sessions} sends={entry.sends} edits={entry.edits} approvals={entry.approvals}
      assertCurrent={() => assertEntry(entry)} freezeSending={(owner, purpose) => freezeSending(entry, owner, purpose)}
      captureSubmissionAuthority={(owner, authority) => capture(entry, owner, authority)}
      nativeInjectionAuthority={(original, owner) => {
        const grant = grantFor(entry, original, owner.hostId, owner.threadId);
        return { daemonConnectionGeneration: grant.daemon.generation, sideChat: structuredClone(grant.childAuthority!.proof), assertBeforeSend(threadId) {
          if (threadId !== grant.owner.threadId) throw beforeSend('原侧聊注入目标已改变。'); grant.check();
        } };
      }}
      dispatchSubmission={(method, params, hostId, check, original) => {
        const grant = grantFor(entry, original, hostId, params.threadId);
        const options: WorkbenchDispatchOptions & { sideChat: SideChatChildDispatchAuthority['proof'] } = {
          daemonConnectionGeneration: grant.daemon.generation, sideChat: structuredClone(grant.childAuthority!.proof),
          assertBeforeSend: () => { grant.check(); check(); } };
        return track(entry, () => entry.client.rpc(method, params, hostId, options));
      }}
      dispatchQueueMutation={(method, params, hostId, original, check, onLateTerminal) => {
        const grant = grantFor(entry, original, hostId, params.threadId);
        const options: WorkbenchDispatchOptions & { sideChat: SideChatChildDispatchAuthority['proof'] } = {
          daemonConnectionGeneration: grant.daemon.generation, sideChat: structuredClone(grant.childAuthority!.proof),
          assertBeforeSend: () => { grant.check(); check(); }, onLateTerminal };
        return track(entry, () => entry.client.rpc(method, params, hostId, options));
      }}
      removeQueuedOriginal={(scope, queued, original, check) => {
        const grant = grantFor(entry, original, scope.hostId, scope.childThreadId);
        return track(entry, () => entry.client.host<'deleted' | 'changed'>('queue-edit', { hostId: scope.hostId,
          threadId: scope.childThreadId, entry: queued, daemonConnectionGeneration: grant.daemon.generation,
          sideChat: structuredClone(grant.childAuthority!.proof) },
        { assertBeforeSend: () => { grant.check(); check(); } }));
      }}
      interruptTurn={(scope, check, original) => {
        const grant = grantFor(entry, original, scope.hostId, scope.childThreadId);
        const options: WorkbenchDispatchOptions & { sideChat: SideChatChildDispatchAuthority['proof'] } = {
          daemonConnectionGeneration: grant.daemon.generation, sideChat: structuredClone(grant.childAuthority!.proof),
          assertBeforeSend: () => { grant.check(); check(); } };
        return track(entry, () => entry.client.rpc('turn/interrupt', { threadId: scope.childThreadId, turnId: scope.turnId }, scope.hostId, options));
      }}
      cancelSend={(intent, check, original) => {
        const grant = grants.current.get(original), lease = entry.frozen;
        if (!grant || grant.entry !== entry || lease?.purpose !== 'cancel' || !sameOwner(grant.owner, intent.owner)
          || intent.threadId !== grant.owner.threadId) throw beforeSend('原侧聊取消授权或目标已改变。');
        const guard = () => { grant.checkWithFreeze(lease); synchronous(check()); };
        guard(); return track(entry, () => latest.current.cancelSend(structuredClone(intent), guard));
      }}
      cleanupChild={identity => latest.current.cleanupChild(identity)}
      onNavigationController={value => { entry.navigation = value; if (active.current === entry.identity.draftId) publish(); }}
      onClosed={() => latest.current.onClosed(structuredClone(entry.identity))}
      onExitObservation={() => { if (active.current === entry.identity.draftId) { assertSwitch(null); select(null); }
        latest.current.onExitObservation(structuredClone(entry.identity)); }}
      onOpenNew={scope => {
        if (!alive.current || !entries.current.includes(entry) || scope.hostId !== entry.identity.hostId
          || scope.parentThreadId !== entry.identity.parentThreadId || scope.draftId !== entry.identity.draftId) throw beforeSend('原侧聊实例已改变。');
        const { parent, daemon } = captureParent();
        if (parent.parent.archived || parent.parent.hostId !== entry.identity.hostId || parent.parent.threadId !== entry.identity.parentThreadId
          || parent.parent.cwd !== entry.identity.cwd) throw beforeSend('当前父会话无法打开新的侧聊。');
        const identity: SideChatWorkspaceIdentity = { hostId: parent.parent.hostId, parentThreadId: parent.parent.threadId, cwd: parent.parent.cwd,
          draftId: crypto.randomUUID(), prepareId: crypto.randomUUID(), mode: 'new' };
        return switchTo(identity.draftId, () => { synchronous(parent.assertCurrent()); daemon.assertOriginal(); add(identity, parent, daemon); }, true);
      }}
      onDraftController={value => { entry.draft = value; publish(); }}
      onDraftChange={() => publish()}
      onProjectionChange={value => { entry.projection = value; publish(); }}
      onEditNavigationController={value => { entry.editNavigation = value; if (active.current === entry.identity.draftId) publish(); }}
      onRemoveReference={(owner, reference, operation) => {
        assertEntry(entry); const current = child(entry);
        if (navigating.current || entry.frozen || active.current !== entry.identity.draftId
          || !current || !sameOwner(current.owner, owner)) throw beforeSend('原侧聊草稿已改变。');
        return latest.current.onRemoveReference(current, owner, reference, operation);
      }}
      onOpenFile={value => { assertEntry(entry); if (navigating.current || entry.frozen || active.current !== entry.identity.draftId
        || value.hostId !== entry.identity.hostId || value.threadId !== child(entry)?.owner.threadId)
        throw beforeSend('原侧聊文件目标已改变。'); latest.current.onOpenFile(value); }}
      onOpenBrowser={value => { assertEntry(entry); if (navigating.current || entry.frozen || active.current !== entry.identity.draftId
        || value.hostId !== entry.identity.hostId || value.threadId !== child(entry)?.owner.threadId)
        throw beforeSend('原侧聊浏览器目标已改变。'); latest.current.onOpenBrowser(value); }}
      onOpenVisualization={value => { assertEntry(entry); if (navigating.current || entry.frozen || active.current !== entry.identity.draftId
        || value.hostId !== entry.identity.hostId || value.threadId !== child(entry)?.owner.threadId)
        throw beforeSend('原侧聊可视化目标已改变。'); latest.current.onOpenVisualization(value); }}
      approvalOptions={props.approvalOptions} /></div>)}
  </section>;
}
