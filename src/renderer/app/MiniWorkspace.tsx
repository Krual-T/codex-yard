import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ThreadSummary } from '../../../lib/codex-protocol.ts';
import type { ComposerDraftExternalOperation, ComposerDraftController, ComposerDraftOwner, ComposerDraftSnapshot, ComposerReference } from '../composer/StandaloneComposer.tsx';
import type { ComposerHost } from '../composer/standalone-target.tsx';
import { StandaloneMini } from '../mini/index.tsx';
import type { MiniActionRunner, MiniActivity, MiniCommand, MiniHostConnection, MiniIdentity, MiniQuickChatOpen, MiniQuickChatState } from '../mini/index.tsx';
import { MiniConversation } from '../mini/MiniConversation.tsx';
import type { MiniConversationController, MiniConversationLease, MiniConversationTarget } from '../mini/MiniConversation.tsx';
import { existingMiniDraftIdentity, miniDraftIdentity, readMiniTarget, rememberMiniTarget } from '../mini/mini-draft-identity.ts';
import { miniApprovalRequests, miniPendingApprovalRefs, respondFromMini, updateMiniApprovalDraft } from '../mini/approval-projection.ts';
import type { ServerRequestRef, SubmitOptions, WorkbenchClient } from '../workbench-contract.ts';
import type { ApprovalRequestsController } from './approval-requests.ts';
import type { ConversationSessions } from './conversation-sessions.ts';
import type { ConversationWriteDispatch } from './conversation-send.ts';
import type { MessageEditRecoveryStore } from './message-edit-recovery.ts';
import { sendsAtom, sendThreadKey } from './send-recovery.ts';
import type { SendRecoverySnapshot, SendRecoveryStore } from './send-recovery.ts';
import { SendRecoveryNotice } from './SendRecoveryNotice.tsx';

export type MiniWorkspaceDefaultTarget = Omit<MiniConversationTarget, 'draftId'>;
export type MiniConnectionAuthority = (() => void) & { daemonConnectionGeneration: string };
export interface MiniWorkspaceLease { flush(): Promise<boolean>; handoff(): void; release(): void }
export interface MiniWorkspaceController { freeze(): MiniWorkspaceLease | null }
export interface MiniWorkspaceProps {
  client: WorkbenchClient;
  sessions: ConversationSessions;
  sends: SendRecoveryStore;
  edits: MessageEditRecoveryStore;
  approvals: ApprovalRequestsController;
  activities: readonly MiniActivity[];
  bridgeState: 'connected' | 'connecting' | 'disconnected';
  hostConnections: Readonly<Record<string, MiniHostConnection | undefined>>;
  defaultTarget: MiniWorkspaceDefaultTarget;
  resolveTarget(identity: { hostId: string; threadId: string | null }): Promise<MiniWorkspaceDefaultTarget>;
  captureConnection(hostId: string): MiniConnectionAuthority;
  freezeMain(): MiniWorkspaceLease;
  onController?(controller: MiniWorkspaceController | null): void;
  onOpenThread(identity: MiniIdentity): void;
  onOpenRequest(identity: MiniIdentity, ref: ServerRequestRef): void;
  onOpenSettings(): void;
  onExpand(): void;
  onError(message: string): void;
  onAssignCreatedProject(target: MiniConversationTarget, thread: ThreadSummary, assertAuthority: () => void): Promise<void>;
  initialOptions?: SubmitOptions;
  hosts?: ComposerHost[];
  onNotificationAction?: MiniActionRunner;
  onOpenFile?(location: { hostId: string; threadId: string; path: string; cwd?: string; line?: number; column?: number }): void;
  onOpenVisualization?(value: { hostId: string; threadId: string; path: string }): void;
  onOpenBrowser?(value: { hostId: string; threadId: string; url?: string }): void;
  onDraftController?(controller: ComposerDraftController | null): void;
  onDraftChange?(snapshot: ComposerDraftSnapshot): void;
  onRemoveReference?(owner: ComposerDraftOwner, reference: ComposerReference, operation: ComposerDraftExternalOperation): Promise<'handled' | void>;
  shortcut?: boolean;
}

type Owner = Pick<MiniConversationTarget, 'hostId' | 'threadId' | 'draftId'>;
type Grant = { epoch: number; assertConnection: MiniConnectionAuthority; connections: ReadonlyMap<string, MiniConnectionAuthority>; original: Owner; alias?: Owner };
type Opening = { epoch: number; original: MiniConversationTarget; requested: { hostId: string; threadId: string | null };
  assertOriginal: MiniConnectionAuthority; assertRequested: MiniConnectionAuthority; connections: ReadonlyMap<string, MiniConnectionAuthority>;
  previous: Grant | null; acquiredMain: boolean;
  candidate?: MiniConversationTarget; ready: boolean };
type Phase = 'idle' | 'opening' | 'active' | 'closing' | 'blocked' | 'navigation';
const owner = (target: MiniConversationTarget): Owner => ({ hostId: target.hostId, threadId: target.threadId, draftId: target.draftId });
const sameOwner = (a: Owner, b: Owner) => a.hostId === b.hostId && a.threadId === b.threadId && a.draftId === b.draftId;
const sameIdentity = (a: { hostId: string; threadId: string | null }, b: { hostId: string; threadId: string | null }) =>
  a.hostId === b.hostId && a.threadId === b.threadId;
const validMetadata = (target: MiniWorkspaceDefaultTarget) => typeof target.hostId === 'string' && !!target.hostId
  && (target.threadId === null || typeof target.threadId === 'string' && !!target.threadId)
  && typeof target.cwd === 'string' && !!target.cwd
  && (target.projectId === undefined || typeof target.projectId === 'string' && !!target.projectId)
  && (target.readOnly === undefined || typeof target.readOnly === 'boolean');
const errorText = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);
const missingAuthority = () => Object.assign(new Error('Mini 原连接或输入权限已改变，原内容已保留。'), { uncertain: false });
const daemonGeneration = (authority: () => void) => {
  const value = (authority as Partial<MiniConnectionAuthority>).daemonConnectionGeneration;
  if (typeof value !== 'string' || !value) throw missingAuthority();
  return value;
};

export function MiniWorkspace(props: MiniWorkspaceProps) {
  const latest = useRef(props); latest.current = props;
  const alive = useRef(false);
  const [target, setTarget] = useState<MiniConversationTarget | null>(null);
  const targetRef = useRef<MiniConversationTarget | null>(null);
  const [snapshot, setSnapshot] = useState<SendRecoverySnapshot | null>(null);
  const snapshotRef = useRef<SendRecoverySnapshot | null>(null);
  const [initialError, setInitialError] = useState('');
  const [accessError, setAccessError] = useState('');
  const [reload, setReload] = useState(0);
  const [interactive, setInteractive] = useState(false);
  const [shellInteractive, setShellInteractive] = useState(false);
  const epoch = useRef(0), readSequence = useRef(0);
  const phase = useRef<Phase>('idle');
  const grant = useRef<Grant | null>(null);
  const opening = useRef<Opening | null>(null);
  const closing = useRef<{ epoch: number; previous: Grant | null } | null>(null);
  const main = useRef<MiniWorkspaceLease | null>(null);
  const mainHandedOff = useRef(false);
  const mini = useRef<MiniConversationController | null>(null);
  const miniContent = useRef<HTMLDivElement | null>(null);
  const miniLease = useRef<MiniConversationLease | null>(null);
  const leaseFlushed = useRef(false);
  const priorOwner = useRef<Owner | null>(null);
  const shell = useRef<MiniQuickChatState>({ mounted: false, visible: false, interactive: false, transitioning: false, target: null });
  const observedBridge = useRef<string | null>(null);
  const observedHosts = useRef(new Map<string, string>());
  const barriers = useRef(new Map<string, string | null>());
  const petConfirmed = useRef(false);
  const petRead = useRef<{ expires: number; observed: boolean; needsConfirmation: boolean } | null>(null);
  const wakeShell = useRef<((value: MiniQuickChatState) => void) | null>(null);

  const report = useCallback((cause: unknown) => {
    const message = errorText(cause);
    if (alive.current) setAccessError(message);
    try { latest.current.onError(message); } catch { /* A notification cannot decide ownership. */ }
  }, []);
  const sendPet = useCallback(async (message: MiniCommand) => {
    const read = message.type === 'avatar-overlay-open-state-request'
      ? { expires: Date.now() + 9_000, observed: false, needsConfirmation: !petConfirmed.current } : null;
    if (read) petRead.current = read;
    try {
      await latest.current.client.host('pet-overlay', { message });
      if (read && petRead.current === read) {
        petRead.current = null;
        if (read.needsConfirmation) {
          petConfirmed.current = read.observed && Date.now() <= read.expires
            && observedBridge.current !== 'disconnected' && observedBridge.current !== 'connecting';
          if (!petConfirmed.current) report('Mini 状态尚未确认，请重试。');
          wakeShell.current?.(shell.current);
        }
      }
    }
    catch (cause) {
      if (read && petRead.current === read) { petRead.current = null; petConfirmed.current = false; }
      throw cause;
    }
  }, [report]);
  const connected = useCallback((hostId: string) => {
    const source = latest.current, host = source.hostConnections[hostId], observed = observedHosts.current.get(hostId);
    return source.bridgeState === 'connected' && observedBridge.current !== 'disconnected' && observedBridge.current !== 'connecting'
      && !!host && host.state === 'connected' && host.fresh && observed !== 'disconnected' && observed !== 'connecting'
      && (!barriers.current.has(hostId) || barriers.current.get(hostId) !== host.revision);
  }, []);
  const captureAvailableConnections = useCallback((initial: ReadonlyMap<string, MiniConnectionAuthority>) => {
    const captured = new Map(initial);
    for (const hostId of Object.keys(latest.current.hostConnections)) {
      if (captured.has(hostId) || !connected(hostId)) continue;
      try {
        const authority = latest.current.captureConnection(hostId);
        daemonGeneration(authority); authority(); captured.set(hostId, authority);
      } catch { /* A different unavailable host must not prevent the current grant. */ }
    }
    return captured;
  }, [connected]);
  const refreshSends = useCallback(async () => {
    const sequence = ++readSequence.current, source = latest.current.sends;
    try {
      const value = await source.read();
      if (alive.current && sequence === readSequence.current && source === latest.current.sends) {
        snapshotRef.current = value; setSnapshot(value);
      }
      return value;
    } catch (cause) { if (alive.current && sequence === readSequence.current) report(cause); throw cause; }
  }, [report]);
  const notifyRecovery = useCallback(() => { void refreshSends().catch(() => {}); }, [refreshSends]);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; epoch.current++; readSequence.current++; };
  }, []);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const value = await latest.current.sends.read(), pointer = readMiniTarget();
        const metadata = pointer ? await latest.current.resolveTarget(pointer) : structuredClone(latest.current.defaultTarget);
        if (!validMetadata(metadata) || pointer && (!sameIdentity(pointer, metadata)
          || pointer.cwd !== metadata.cwd || (pointer.projectId ?? null) !== (metadata.projectId ?? null))) {
          throw new Error('Mini 原目标无法确认，草稿已保留。');
        }
        const selected = { ...metadata, draftId: pointer?.draftId ?? miniDraftIdentity(metadata.hostId, metadata.threadId, value.bindings) };
        if (active && alive.current) {
          rememberMiniTarget(selected);
          snapshotRef.current = value; setSnapshot(value); targetRef.current = selected; setTarget(selected); setInitialError('');
        }
      } catch (cause) { if (active && alive.current) { setInitialError(errorText(cause)); report(cause); } }
    })();
    return () => { active = false; };
  }, [reload, report]);

  const validAlias = useCallback((current: MiniConversationTarget, next: Owner) => {
    if (current.threadId !== null || !next.threadId || next.hostId !== current.hostId || next.draftId !== current.draftId) return false;
    const state = snapshotRef.current, receipt = state?.creations[sendThreadKey(next.hostId, next.threadId)];
    return !!receipt && receipt.thread.id === next.threadId && sameOwner(receipt.owner, owner(current))
      && state?.bindings[sendThreadKey(next.hostId, next.threadId)] === next.draftId;
  }, []);
  const canUseOwner = useCallback((candidate: ComposerDraftOwner) => {
    const current = targetRef.current, op = opening.current;
    if (!current || !connected(candidate.hostId) || !['active', 'opening'].includes(phase.current)
      || phase.current === 'active' && !petConfirmed.current) return false;
    try {
      if (phase.current === 'active') { if (!grant.current) return false; grant.current.assertConnection(); }
      else { op?.assertOriginal(); op?.assertRequested(); }
    } catch { return false; }
    if (sameOwner(candidate, owner(current)) || priorOwner.current && sameOwner(candidate, priorOwner.current)) return true;
    if (op?.candidate && sameOwner(candidate, owner(op.candidate))) return true;
    if (validAlias(current, candidate)) return true;
    if (phase.current === 'active' && current.threadId === null && candidate.threadId === null) {
      try { return existingMiniDraftIdentity(candidate.hostId, null) === candidate.draftId; } catch { return false; }
    }
    return false;
  }, [connected, validAlias]);
  const captureAuthority = useCallback((requested: ComposerDraftOwner) => {
    const current = targetRef.current, held = grant.current;
    if (phase.current !== 'active' || !current || !held || !petConfirmed.current
      || !sameOwner(requested, owner(current)) || !connected(current.hostId)) throw missingAuthority();
    held.assertConnection();
    const captured = held.epoch, original = structuredClone(requested), source = latest.current;
    return Object.assign(() => {
      const now = targetRef.current, active = grant.current;
      if (!alive.current || phase.current !== 'active' || !now || !active || !petConfirmed.current || active.epoch !== captured
        || active.assertConnection !== held.assertConnection
        || latest.current.client !== source.client || latest.current.sessions !== source.sessions || latest.current.sends !== source.sends
        || latest.current.edits !== source.edits || !connected(now.hostId)
        || !(sameOwner(original, owner(now)) || active.alias && sameOwner(original, active.original) && sameOwner(owner(now), active.alias))) throw missingAuthority();
      held.assertConnection();
    }, { daemonConnectionGeneration: daemonGeneration(held.assertConnection) });
  }, [connected]);

  const releaseMini = useCallback(() => {
    const lease = miniLease.current; miniLease.current = null; leaseFlushed.current = false; lease?.release();
  }, []);
  const releaseMain = useCallback(() => {
    const lease = main.current; main.current = null; mainHandedOff.current = false; lease?.release();
  }, []);
  const restoreGrant = useCallback((previous: Grant | null) => {
    const current = targetRef.current;
    if (!previous || !current || !petConfirmed.current || !connected(current.hostId)
      || !sameOwner(owner(current), previous.alias ?? previous.original)) return false;
    try { previous.assertConnection(); } catch { return false; }
    grant.current = { ...previous, epoch: epoch.current };
    phase.current = 'active';
    if (alive.current) { setAccessError(''); setInteractive(true); }
    return true;
  }, [connected]);
  const abortOpening = useCallback((op: Opening, cause?: unknown) => {
    if (opening.current !== op) return;
    opening.current = null;
    if (cause) report(cause);
    if (op.previous && restoreGrant(op.previous)) { releaseMini(); return; }
    if (op.acquiredMain && !op.previous && !miniLease.current) { phase.current = 'idle'; releaseMain(); return; }
    if (op.acquiredMain && !op.previous && leaseFlushed.current && !shell.current.visible) {
      try { miniLease.current?.handoff(); releaseMini(); phase.current = 'idle'; releaseMain(); return; }
      catch (error) { report(error); }
    }
    phase.current = 'blocked';
  }, [releaseMain, releaseMini, report, restoreGrant]);

  const beforeOpen = useCallback((request: MiniQuickChatOpen): Promise<boolean> => {
    const current = targetRef.current;
    if (!current || !request.target || ['opening', 'closing', 'navigation'].includes(phase.current)) return Promise.resolve(false);
    const previous = grant.current, acquiredMain = !main.current;
    let op: Opening;
    try {
      if (!connected(current.hostId) || !connected(request.target.hostId)) throw missingAuthority();
      const assertOriginal = latest.current.captureConnection(current.hostId);
      const assertRequested = current.hostId === request.target.hostId ? assertOriginal : latest.current.captureConnection(request.target.hostId);
      daemonGeneration(assertOriginal); daemonGeneration(assertRequested); assertOriginal(); assertRequested();
      const connections = captureAvailableConnections(new Map([[current.hostId, assertOriginal], [request.target.hostId, assertRequested]]));
      ++epoch.current; grant.current = null; phase.current = 'opening'; setInteractive(false);
      if (acquiredMain) { main.current = latest.current.freezeMain(); mainHandedOff.current = false; }
      if (shell.current.mounted && !mini.current) throw new Error('Mini 输入控制器尚未就绪，原内容已保留。');
      if (mini.current && !miniLease.current) miniLease.current = mini.current.freeze();
      if (mini.current && !miniLease.current) throw new Error('Mini 输入正在处理，请稍后重试。');
      op = { epoch: epoch.current, original: structuredClone(current), requested: { ...request.target }, assertOriginal, assertRequested, connections,
        previous, acquiredMain, ready: false };
      opening.current = op;
    } catch (cause) {
      report(cause);
      if (acquiredMain && main.current) releaseMain();
      if (!restoreGrant(previous)) phase.current = main.current ? 'blocked' : 'idle';
      return Promise.resolve(false);
    }
    return (async () => {
      try {
        if (acquiredMain && !await main.current!.flush()) throw new Error('主输入未能保存，Mini 未打开。');
        if (miniLease.current) {
          leaseFlushed.current = await miniLease.current.flush();
          if (!leaseFlushed.current) {
            if (request.source !== 'recover' || !mainHandedOff.current || op.previous || !sameIdentity(op.original, op.requested)) {
              throw new Error('Mini 原输入未能保存。');
            }
            releaseMini();
            report('Mini 原输入尚未保存，请在原编辑器重试。');
          }
        }
        if (opening.current !== op || epoch.current !== op.epoch) throw missingAuthority();
        op.assertOriginal(); op.assertRequested();
        if (!connected(op.original.hostId) || !connected(op.requested.hostId)) throw missingAuthority();
        if (request.source === 'follow-up' && miniLease.current) releaseMini();
        op.ready = true; return true;
      } catch (cause) { abortOpening(op, cause); return false; }
    })();
  }, [abortOpening, captureAvailableConnections, connected, releaseMain, releaseMini, report, restoreGrant]);

  const changeTarget = useCallback((next: MiniConversationTarget) => {
    const current = targetRef.current, op = opening.current;
    if (!current || !canUseOwner(owner(next))) throw missingAuthority();
    const alias = validAlias(current, owner(next));
    const same = sameOwner(owner(current), owner(next));
    let nextConnection: MiniConnectionAuthority | null = null;
    if (!same && !alias && phase.current === 'active') {
      nextConnection = grant.current?.connections.get(next.hostId) ?? null;
      if (!nextConnection) throw Object.assign(new Error('目标宿主的原连接尚未确认，请关闭并重新打开 Mini；原输入已保留。'), { uncertain: false });
      try { nextConnection(); }
      catch (cause) { throw Object.assign(new Error('目标宿主的原连接已改变，请关闭并重新打开 Mini；原输入已保留。', { cause }), { uncertain: false }); }
    }
    rememberMiniTarget(next);
    priorOwner.current = owner(current);
    targetRef.current = structuredClone(next); setTarget(structuredClone(next));
    if (phase.current === 'active' && grant.current) {
      if (alias) grant.current = { ...grant.current, alias: owner(next) };
      else if (!same || JSON.stringify(current) !== JSON.stringify(next)) {
        ++epoch.current;
        grant.current = { ...grant.current, epoch: epoch.current, original: owner(next), alias: undefined,
          assertConnection: nextConnection ?? grant.current.assertConnection };
      }
    }
    if (op && sameIdentity(next, op.requested)) op.candidate = structuredClone(next);
    queueMicrotask(() => { priorOwner.current = null; });
  }, [canUseOwner, validAlias]);
  const switchTarget = useCallback(async (identity: MiniIdentity) => {
    const op = opening.current, current = targetRef.current;
    if (!op || !op.ready || !current || !sameIdentity(identity, op.requested)) return false;
    try {
      const [metadata, recovery] = await Promise.all([latest.current.resolveTarget(identity), latest.current.sends.read()]);
      if (opening.current !== op || op.epoch !== epoch.current || !validMetadata(metadata) || !sameIdentity(identity, metadata)) throw missingAuthority();
      op.assertOriginal(); op.assertRequested();
      snapshotRef.current = recovery; setSnapshot(recovery);
      const draftId = sameIdentity(current, metadata) ? current.draftId : miniDraftIdentity(metadata.hostId, metadata.threadId, recovery.bindings);
      const next = { ...metadata, draftId }; op.candidate = next;
      if (mini.current) {
        if (!await mini.current.switchTarget(next)) throw new Error('Mini 目标未能切换，原输入已保留。');
      } else {
        rememberMiniTarget(next); targetRef.current = next; setTarget(next);
      }
      return true;
    } catch (cause) { abortOpening(op, cause); return false; }
  }, [abortOpening]);

  const beforeClose = useCallback((): Promise<boolean> => {
    if (phase.current === 'opening' || phase.current === 'closing' || phase.current === 'navigation') return Promise.resolve(false);
    const previous = grant.current;
    ++epoch.current; closing.current = { epoch: epoch.current, previous }; grant.current = null; phase.current = 'closing'; setInteractive(false);
    if (mini.current && !miniLease.current) miniLease.current = mini.current.freeze();
    if (mini.current && !miniLease.current) { phase.current = 'blocked'; report('Mini 正在处理输入，未关闭。'); return Promise.resolve(false); }
    return (async () => {
      try {
        leaseFlushed.current = miniLease.current ? await miniLease.current.flush() : true;
        if (!leaseFlushed.current) throw new Error('Mini 原输入未能保存。');
        return true;
      } catch (cause) { report(cause); return false; }
    })();
  }, [report]);

  const finishHidden = useCallback(() => {
    if (!leaseFlushed.current || !petConfirmed.current || shell.current.visible || shell.current.transitioning) return;
    try {
      miniLease.current?.handoff(); releaseMini(); releaseMain(); phase.current = 'idle'; grant.current = null;
      if (alive.current) { setInteractive(false); setAccessError(''); }
    } catch (cause) { phase.current = 'blocked'; report(cause); }
  }, [releaseMain, releaseMini, report]);
  const stateChanged = useCallback((value: MiniQuickChatState) => {
    shell.current = value;
    queueMicrotask(() => {
      if (!alive.current || shell.current !== value) return;
      setShellInteractive(value.interactive);
      const op = opening.current, current = targetRef.current;
      if (op && op.ready && value.mounted && value.visible && !value.transitioning && current && value.target && sameIdentity(value.target, op.requested)
        && sameIdentity(current, op.requested) && mini.current && sameOwner(owner(mini.current.target()), owner(current))) {
        if (!petConfirmed.current && petRead.current) return;
        try {
          if (epoch.current !== op.epoch || !connected(current.hostId) || !petConfirmed.current) throw missingAuthority();
          op.assertOriginal(); op.assertRequested();
          if (!main.current) throw new Error('主输入的移交租约不存在。');
          if (!mainHandedOff.current) { main.current.handoff(); mainHandedOff.current = true; }
          releaseMini(); opening.current = null; phase.current = 'active';
          grant.current = { epoch: epoch.current, assertConnection: op.assertRequested, connections: op.connections, original: owner(current) };
          setAccessError(''); setInteractive(true);
        } catch (cause) { opening.current = null; phase.current = 'blocked'; report(cause); }
      } else if (phase.current === 'closing' && !value.transitioning) {
        const close = closing.current; closing.current = null;
        if (!value.visible) finishHidden();
        else {
          try {
            const current = targetRef.current;
            if (!close || close.epoch !== epoch.current || !current || !connected(current.hostId) || !petConfirmed.current
              || !restoreGrant(close.previous)) throw missingAuthority();
            releaseMini();
          } catch (cause) { phase.current = 'blocked'; report(cause); }
        }
      } else if (phase.current === 'blocked' && !value.visible && !value.transitioning) finishHidden();
    });
  }, [connected, finishHidden, releaseMini, report, restoreGrant]);
  wakeShell.current = stateChanged;

  const suspend = useCallback((message: string) => {
    if (!main.current || phase.current === 'idle' || phase.current === 'navigation') return;
    ++epoch.current; grant.current = null; setInteractive(false);
    if (phase.current === 'closing') return;
    opening.current = null; phase.current = 'blocked';
    if (mini.current && !miniLease.current) miniLease.current = mini.current.freeze();
    if (mini.current && !miniLease.current) { report(message); return; }
    void (async () => {
      try {
        leaseFlushed.current = miniLease.current ? await miniLease.current.flush() : true;
        if (!leaseFlushed.current) throw new Error(message);
        finishHidden();
      } catch (cause) { report(cause); }
    })();
    report(message);
  }, [finishHidden, report]);
  useLayoutEffect(() => props.client.subscribe(event => {
    const current = targetRef.current;
    if (event.type === 'persisted-atom-updated' && (!Array.isArray(event.keys) || !event.keys.length || event.keys.includes(sendsAtom))) notifyRecovery();
    if (event.type === 'connection-state' && typeof event.state === 'string') {
      observedBridge.current = event.state;
      if (event.state === 'disconnected' || event.state === 'connecting') {
        petConfirmed.current = false; petRead.current = null;
        for (const id of Object.keys(latest.current.hostConnections)) barriers.current.set(id, latest.current.hostConnections[id]?.revision ?? null);
        suspend('连接已断开，Mini 原输入已保留。');
      }
    } else if (event.type === 'codex-app-server-connection-changed' && typeof event.hostId === 'string' && typeof event.state === 'string') {
      observedHosts.current.set(event.hostId, event.state);
      if (event.state === 'disconnected' || event.state === 'connecting') {
        barriers.current.set(event.hostId, latest.current.hostConnections[event.hostId]?.revision ?? null);
        if (event.hostId === current?.hostId || event.hostId === opening.current?.requested.hostId) suspend('宿主连接已断开，Mini 原输入已保留。');
      }
    } else if (event.type === 'workbench-pet-error' && event.stateUnconfirmed === true) {
      petConfirmed.current = false; petRead.current = null;
      suspend('Mini 状态尚未确认，原输入已保留。');
    } else if (event.type === 'workbench-pet-state' || event.type === 'avatar-overlay-open-state-changed') {
      const open = event.type === 'workbench-pet-state' && event.state && typeof event.state === 'object' && 'isOpen' in event.state
        ? event.state.isOpen : event.type === 'avatar-overlay-open-state-changed' ? event.isOpen : undefined;
      if (petRead.current && Date.now() > petRead.current.expires) petRead.current = null;
      if (typeof open !== 'boolean' || !petConfirmed.current && !petRead.current
        || observedBridge.current === 'disconnected' || observedBridge.current === 'connecting') return;
      if (petRead.current) petRead.current.observed = true;
      if (!petRead.current?.needsConfirmation) petConfirmed.current = true;
      if (!open && phase.current !== 'closing') suspend('Mini 已隐藏，正在保存原输入。');
    }
  }), [props.client, notifyRecovery, suspend]);
  useLayoutEffect(() => {
    const current = targetRef.current;
    if (!main.current || !current || !['active', 'opening'].includes(phase.current)) return;
    let valid = connected(current.hostId);
    try {
      if (phase.current === 'active') grant.current?.assertConnection();
      else { opening.current?.assertOriginal(); opening.current?.assertRequested(); }
    } catch { valid = false; }
    if (valid) return;
    ++epoch.current; grant.current = null; setInteractive(false);
    queueMicrotask(() => { if (alive.current) suspend('连接已改变，Mini 原输入已保留。'); });
  }, [props.bridgeState, props.hostConnections, connected, suspend]);

  const retryAccess = useCallback(() => {
    const current = targetRef.current;
    if (phase.current !== 'blocked' || !current || !connected(current.hostId)) return;
    if (!petConfirmed.current) {
      report('正在重新确认 Mini 状态，请再次重试。');
      if (!petRead.current || Date.now() > petRead.current.expires) {
        void sendPet({ type: 'avatar-overlay-open-state-request' }).catch(report);
      }
      return;
    }
    let assertConnection: MiniConnectionAuthority, connections: ReadonlyMap<string, MiniConnectionAuthority>;
    try {
      assertConnection = latest.current.captureConnection(current.hostId); daemonGeneration(assertConnection); assertConnection();
      connections = captureAvailableConnections(new Map([[current.hostId, assertConnection]]));
      if (mini.current && !miniLease.current) miniLease.current = mini.current.freeze();
      if (mini.current && !miniLease.current) throw new Error('Mini 仍在处理输入，请稍后重试。');
    } catch (cause) { report(cause); return; }
    const captured = ++epoch.current;
    void (async () => {
      try {
        leaseFlushed.current = miniLease.current ? await miniLease.current.flush() : true;
        if (epoch.current !== captured) throw missingAuthority();
        assertConnection();
        if (!shell.current.visible) {
          if (!leaseFlushed.current) throw new Error('Mini 原输入尚未保存。');
          finishHidden(); return;
        }
        if (shell.current.transitioning || !main.current || !mainHandedOff.current || !petConfirmed.current
          || !mini.current || !sameOwner(owner(mini.current.target()), owner(current))) throw missingAuthority();
        const saved = leaseFlushed.current;
        releaseMini(); phase.current = 'active';
        grant.current = { epoch: captured, assertConnection, connections, original: owner(current) };
        setInteractive(true);
        if (saved) setAccessError('');
        else report('Mini 原输入尚未保存，请在原编辑器重试。');
      } catch (cause) { report(cause); }
    })();
  }, [captureAvailableConnections, connected, finishHidden, releaseMini, report, sendPet]);

  const navigation = useMemo<MiniWorkspaceController>(() => ({ freeze() {
    if (['opening', 'closing', 'navigation'].includes(phase.current)) return null;
    const previous = grant.current, wasBlocked = phase.current === 'blocked', existing = !!miniLease.current;
    ++epoch.current; grant.current = null; setInteractive(false);
    if (mini.current && !miniLease.current) miniLease.current = mini.current.freeze();
    if (mini.current && !miniLease.current) { if (!restoreGrant(previous)) phase.current = 'blocked'; return null; }
    phase.current = 'navigation'; let active = true, flushed = false, handedOff = false;
    return {
      async flush() { if (!active) return false; flushed = miniLease.current ? await miniLease.current.flush() : true; return flushed; },
      handoff() {
        if (!active || !flushed) throw new Error('Mini 输入尚未保存，不能离开。');
        miniLease.current?.handoff(); handedOff = true; releaseMini(); releaseMain(); phase.current = 'idle';
      },
      release() {
        if (!active) return; active = false;
        if (handedOff) return;
        if (!existing) releaseMini();
        if (!restoreGrant(previous)) phase.current = wasBlocked || main.current ? 'blocked' : 'idle';
      },
    };
  } }), [releaseMain, releaseMini, restoreGrant]);
  useLayoutEffect(() => { props.onController?.(navigation); return () => props.onController?.(null); }, [props.onController, navigation]);

  const approvals = useSyncExternalStore(props.approvals.subscribe, props.approvals.getSnapshot, props.approvals.getSnapshot);
  const activities = useMemo(() => props.activities.map(activity => ({ ...activity,
    requests: miniApprovalRequests(props.approvals, activity.hostId, activity.threadId) })), [props.activities, props.approvals, approvals]);
  const pending = useMemo(() => miniPendingApprovalRefs(props.approvals), [props.approvals, approvals]);
  const dispatch = useCallback<ConversationWriteDispatch>(async (method, params, hostId, assertAuthority) => {
    const daemonConnectionGeneration = daemonGeneration(assertAuthority);
    assertAuthority();
    const active = grant.current;
    if (method === 'turn/start' && active?.alias && active.alias.hostId === hostId && active.alias.threadId === params.threadId) {
      let recovery: SendRecoverySnapshot;
      try { recovery = await latest.current.sends.read(); }
      catch (cause) { throw Object.assign(new Error('新会话原回执无法读取，首条消息未发送。', { cause }), { uncertain: false }); }
      const threadId = active.alias.threadId!;
      const receipt = recovery.creations[sendThreadKey(hostId, threadId)];
      const intent = Object.values(recovery.requests).find(value => value.clientUserMessageId === params.clientUserMessageId);
      if (recovery.bindings[sendThreadKey(hostId, threadId)] !== active.alias.draftId || !intent
        || intent.owner.hostId !== hostId || intent.owner.draftId !== active.alias.draftId || intent.threadId !== threadId
        || intent.owner.threadId === null && (!receipt || !sameOwner(receipt.owner, active.original) || receipt.thread.id !== threadId)
        || intent.owner.threadId !== null && intent.owner.threadId !== threadId) throw missingAuthority();
      assertAuthority();
    }
    return latest.current.client.rpc(method, params, hostId, { assertBeforeSend: assertAuthority, daemonConnectionGeneration });
  }, []);
  const receiveController = useCallback((controller: MiniConversationController | null) => { mini.current = controller; }, []);
  const requests = Object.values(snapshot?.requests ?? {}).filter(intent => target && intent.owner.hostId === target.hostId
    && intent.owner.draftId === target.draftId);

  return <>
    {initialError && !target && <div role="alert">{initialError} <button type="button" onClick={() => setReload(value => value + 1)}>Retry Mini recovery</button></div>}
    {accessError && <div role="status">{accessError} {phase.current === 'blocked' && <button type="button" onClick={retryAccess}>Retry Mini access</button>}</div>}
    <StandaloneMini client={props.client} send={sendPet} activities={activities} bridgeState={props.bridgeState}
      hostConnections={props.hostConnections} pendingRequests={pending} onOpenThread={props.onOpenThread} onOpenRequest={props.onOpenRequest}
      onExpand={props.onExpand} onOpenSettings={props.onOpenSettings} onNotificationAction={props.onNotificationAction}
      onRespond={(ref, result) => respondFromMini(props.approvals, ref, result)}
      onInputDraftChange={(ref, draft) => updateMiniApprovalDraft(props.approvals, ref, draft)}
      quickChatTarget={target ?? undefined} quickChatInteractive={interactive} onBeforeQuickChatOpen={beforeOpen}
      onQuickChatStateChange={stateChanged} onBeforeQuickChatClose={beforeClose} onQuickChatTarget={switchTarget} shortcut={props.shortcut}>
      {target && <div ref={miniContent}>
        {requests.map(intent => <SendRecoveryNotice key={intent.id} intent={intent} canRetry={interactive}
          canCheckInjectionReceipt={props.sends.hasConfirmedInjectionReceipt(intent)}
          onOpen={async () => {
            if (intent.threadId) { latest.current.onOpenThread({ hostId: intent.owner.hostId, threadId: intent.threadId }); return; }
            const input = miniContent.current?.querySelector<HTMLElement>('.standalone-composer textarea:not(:disabled), .standalone-composer [contenteditable="true"]');
            if (!interactive || !input) throw new Error('原 Mini 输入区尚不可用，草稿已保留。');
            input.focus();
          }}
          onCheck={async () => { await latest.current.sends.check(intent.id); await refreshSends(); }}
          onRetry={async () => { if (!mini.current || !interactive) throw missingAuthority(); await mini.current.retry(intent.id); await refreshSends(); }}
          onFinish={async () => { if (!mini.current || !interactive) throw missingAuthority(); await mini.current.finish(intent.id); await refreshSends(); }}
          onCancel={async () => { const assert = captureAuthority(owner(target)); assert(); await latest.current.sends.cancel(intent.id); await refreshSends(); }} />)}
        <MiniConversation client={props.client} sessions={props.sessions} sends={props.sends} edits={props.edits} initialTarget={target}
          initialOptions={props.initialOptions} hosts={props.hosts} editEnabled={interactive && shellInteractive} isConnected={connected} canUseOwner={canUseOwner}
          captureEditAuthority={captureAuthority} getDaemonConnectionGeneration={daemonGeneration} dispatchSubmission={dispatch}
          onController={receiveController} onTargetChanged={changeTarget}
          onRecoveryChanged={notifyRecovery} onError={report} onOpenThread={props.onOpenThread} onOpenFile={props.onOpenFile}
          onOpenVisualization={props.onOpenVisualization} onOpenBrowser={props.onOpenBrowser} onAssignCreatedProject={props.onAssignCreatedProject}
          onDraftController={props.onDraftController} onDraftChange={props.onDraftChange} onRemoveReference={props.onRemoveReference} />
      </div>}
    </StandaloneMini>
  </>;
}
