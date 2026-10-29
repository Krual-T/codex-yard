import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StandaloneMini } from '../src/renderer/mini/index.tsx';
import type { MiniQuickChatOpen, MiniQuickChatState } from '../src/renderer/mini/index.tsx';
import { MiniConversation, miniDraftIdentity } from '../src/renderer/mini/MiniConversation.tsx';
import type { MiniConversationController, MiniConversationLease, MiniConversationTarget } from '../src/renderer/mini/MiniConversation.tsx';
import { StandaloneComposer } from '../src/renderer/composer/StandaloneComposer.tsx';
import { readComposerDraft, readComposerDraftVersions } from '../src/renderer/composer/composer-draft-store.ts';
import type { ComposerDraftController, ComposerDraftLease, ComposerDraftSnapshot } from '../src/renderer/composer/StandaloneComposer.tsx';
import { BrowserWorkbenchClient } from '../src/renderer/app/client.ts';
import { removeBrowserDraftReference } from '../src/renderer/app/browser-draft.ts';
import { addBrowserComment } from './browser-comment-fixture.ts';
import { readBrowserAtom, updateBrowserAtom } from '../src/renderer/storage/ui-atoms.ts';
import { readUnknownQueueRecovery } from '../src/renderer/composer/standalone-queue-storage.ts';
import { ConversationSessions, useConversationSession } from '../src/renderer/app/conversation-sessions.ts';
import { SendRecoveryStore, sendsAtom, sendThreadKey } from '../src/renderer/app/send-recovery.ts';
import { MessageEditRecoveryStore, messageEditChanged, messageEditsAtom } from '../src/renderer/app/message-edit-recovery.ts';
import type { EditRecoveryStorage, StoredMessageEdit } from '../src/renderer/app/message-edit-recovery.ts';
import { StandaloneMessages } from '../src/renderer/messages/StandaloneMessages.tsx';
import type { MessageEditNavigationController, MessageEditNavigationLease } from '../src/renderer/messages/StandaloneMessages.tsx';
import type { MessageEditAccess } from '../src/renderer/messages/use-message-editing.ts';
import type { WorkbenchClient, WorkbenchDispatchOptions, WorkbenchEvent } from '../src/renderer/workbench-contract.ts';
import type { ThreadSummary, TurnSummary } from '../lib/codex-protocol.ts';

const listeners = new Set<(event: WorkbenchEvent) => void>();
const emit = (event: WorkbenchEvent) => { for (const listener of listeners) listener(event); };
const calls: { method: string; hostId: string; params: Record<string, unknown> }[] = [];
const hostCalls: { endpoint: string; params: Record<string, unknown> }[] = [];
const opened: { hostId: string; threadId: string }[] = [];
const errors: string[] = [];
const targets: MiniConversationTarget[] = [];
const projectChecks: { target: MiniConversationTarget; threadId: string }[] = [];
const projectMembership: Record<string, string> = {};
const queues: Record<string, { id: string; clientUserMessageId: string; input: Record<string, unknown>[] }[]> = {};
const threads: Record<string, ThreadSummary> = {};
const threadKey = (hostId: string, id: string) => JSON.stringify([hostId, id]);
const thread = (hostId: string, id: string) => threads[threadKey(hostId, id)] ??= {
  id, name: hostId + ':' + id, cwd: '/fixture/' + hostId, status: { type: 'idle' }, turns: id === 'thread-b' ? [{
    id: 'original-turn', status: 'completed', itemsView: 'full', items: [{ id: 'original-item', type: 'userMessage',
      clientId: 'original-message', content: [{ type: 'text', text: 'remote original', text_elements: [] }] }],
  }] : [],
};
let connected = true, unknownNext = false, holdNext = false, rejectTarget = false, resolveHeld: (() => void) | undefined;
let rejectProject = false, rejectReady = false, unknownQueue = false, throwRecovery = false, throwError = false;
let rejectSendRead = false, rejectEditThread = '', rejectSendOnTarget = '';
let authorityEpoch = 0, holdEditPreparation = false, editPreparing = false, releaseEditPreparation: (() => void) | undefined;
let captures = 0, writesAfterCapture = 0;
let heldDispatch = '', dispatchWaiting = false, releaseDispatch: (() => void) | undefined;
let holdProject = false, projectWaiting = false, releaseProject: (() => void) | undefined;
let holdRetryRead = false, retryReadWaiting = false, releaseRetryRead: (() => void) | undefined;
let holdQueueLock = false, queueLockWaiting = false, releaseQueueLock: (() => void) | undefined;
let holdEditSnapshot = false, editSnapshotWaiting = false, releaseEditSnapshot: (() => void) | undefined;
let revokeOnTarget = false, asyncEditAssertion = false, asyncTarget = false, failTargetAfterWrite = false;
let controller: MiniConversationController | null = null, mainController: ComposerDraftController | null = null;
let miniController: ComposerDraftController | null = null;
let miniSnapshot: ComposerDraftSnapshot | null = null;
let browserReceipt: { before: ComposerDraftSnapshot; after: ComposerDraftSnapshot } | null = null;
let failAcceptance = false, acceptanceFailureStack = '';
let authorityGranted = true, revokeAtClear = false, revocationStack = '';
let switchAtClear: (() => void) | null = null, switching: Promise<boolean> | null = null;
let barrierLease: MiniConversationLease | null = null;
let peerController: MessageEditNavigationController | null = null, peerLease: MessageEditNavigationLease | null = null;
let mainRelease: (() => void) | undefined;
const quickRequests: MiniQuickChatOpen[] = [];
const quickStates: (MiniQuickChatState & { contentInert: boolean | null })[] = [];
let parentFence = false, miniFence = false, rejectOpen = false, holdOpen = false, openWaiting = false;
let releaseOpen: (() => void) | undefined, parentLease: ComposerDraftLease | null = null;
let miniOpenLease: MiniConversationLease | null = null;
let holdEditTransaction = false, editTransactionWaiting = false, releaseEditTransaction: (() => void) | undefined;
let editTransactionError = '', miniAccess: MessageEditAccess | null = null;
let realInterrupt: BrowserWorkbenchClient | null = null, interruptSocket: FixtureSocket | null = null;
let holdInterrupt = false, interruptWaiting = false, releaseInterrupt: (() => void) | undefined;
let dropInterrupt = false;
const originalWebSocket = Object.getOwnPropertyDescriptor(window, 'WebSocket');
class FixtureSocket {
  static OPEN = 1;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(_url: string) { interruptSocket = this; }
  open() { this.readyState = 1; this.onopen?.(); }
  close() { if (this.readyState !== 3) { this.readyState = 3; this.onclose?.(); } }
  send(value: string) {
    const message = JSON.parse(value);
    if (message.type !== 'mcp-request') return;
    calls.push({ method: message.request.method, hostId: message.hostId, params: structuredClone(message.request.params) });
    if (dropInterrupt) { dropInterrupt = false; this.close(); return; }
    complete(message.hostId, message.request.params.threadId);
    queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ type: 'mcp-response', hostId: message.hostId,
      message: { id: message.request.id, result: {} } }) }));
  }
}
const client: WorkbenchClient & { connected: boolean } = {
  get connected() { return connected; },
  async rpc<T>(method: string, params: Record<string, unknown> = {}, hostId = 'local', options?: WorkbenchDispatchOptions): Promise<T> {
    if (method === 'turn/interrupt' && realInterrupt) return realInterrupt.rpc<T>(method, params, hostId, options);
    calls.push({ method, hostId, params: structuredClone(params) });
    if (method === 'model/list') return { data: [{ id: 'fixture', model: 'fixture-model', displayName: 'Fixture', isDefault: true,
      supportedReasoningEfforts: [] }], nextCursor: null } as T;
    if (method === 'config/read') return { config: { model: 'fixture-model' }, layers: [] } as T;
    if (method === 'thread/list') return { data: [], nextCursor: null } as T;
    if (method === 'thread/resume') return { thread: structuredClone(thread(hostId, String(params.threadId))), model: 'fixture-model' } as T;
    if (method === 'thread/unsubscribe') return {} as T;
    if (method === 'thread/read') return { thread: { ...structuredClone(thread(hostId, String(params.threadId))), turns: [] } } as T;
    if (method === 'thread/turns/list') return { data: thread(hostId, String(params.threadId)).turns.map(turn => ({ ...turn, itemsView: 'full' })), nextCursor: null } as T;
    if (method === 'thread/items/list') return { data: [], nextCursor: null } as T;
    if (method === 'thread/queue/list') return { data: queues[threadKey(hostId, String(params.threadId))] ?? [], nextCursor: null } as T;
    if (method === 'thread/start') {
      const created = thread(hostId, 'created-' + calls.filter(call => call.method === 'thread/start').length);
      const result = { thread: structuredClone(created), model: 'fixture-model' };
      emit({ type: 'thread-created', hostId, result });
      return result as T;
    }
    if (method === 'turn/start') {
      if (holdNext) { holdNext = false; await new Promise<void>(resolve => { resolveHeld = resolve; }); }
      if (unknownNext) { unknownNext = false; throw Object.assign(new Error('synthetic lost reply'), { uncertain: true }); }
      const turn: TurnSummary = { id: 'turn-' + calls.filter(call => call.method === 'turn/start').length, status: 'inProgress', items: [] };
      const value = thread(hostId, String(params.threadId)); value.turns = [turn]; value.status = { type: 'active', activeFlags: [] };
      return { turn } as T;
    }
    if (method === 'turn/steer') return { turnId: params.expectedTurnId } as T;
    if (method === 'thread/queue/add') {
      const entry = { id: 'queue-' + calls.filter(call => call.method === 'thread/queue/add').length,
        clientUserMessageId: String(params.clientUserMessageId), input: params.input as Record<string, unknown>[] };
      (queues[threadKey(hostId, String(params.threadId))] ??= []).push(entry);
      return { queuedSubmission: entry } as T;
    }
    if (method === 'thread/queue/start') {
      if (unknownQueue) { unknownQueue = false; throw Object.assign(new Error('Synthetic queue lost reply'), { uncertain: true }); }
      queues[threadKey(hostId, String(params.threadId))] = (queues[threadKey(hostId, String(params.threadId))] ?? [])
        .filter(entry => entry.id !== params.queuedSubmissionId);
      return {} as T;
    }
    if (method === 'turn/interrupt') { complete(hostId, String(params.threadId)); return {} as T; }
    throw new Error('Unexpected synthetic RPC ' + method);
  },
  async host<T>(endpoint: string, params: Record<string, unknown> = {}): Promise<T> {
    if (endpoint === 'message-edit') {
      hostCalls.push({ endpoint, params: structuredClone(params) });
      return { stage: 'started', turn: { id: 'edited-turn', status: 'inProgress', items: [] } } as T;
    }
    if (endpoint === 'get-settings') return { values: {} } as T;
    if (endpoint === 'custom-avatars') return {} as T;
    if (endpoint === 'get-setting') return { exists: true, value: params.key === 'composerPlainTextMode' ? false
      : params.key === 'followUpQueueMode' ? 'queue' : 'cmdAlways' } as T;
    if (endpoint === 'workspace-root-options') return { roots: ['/fixture/local', '/fixture/other'] } as T;
    if (endpoint === 'codex-home') return { codexHome: '/fixture/.codex' } as T;
    if (endpoint === 'get-persisted-atom') return {} as T;
    if (endpoint === 'queued-follow-up-send-lock-acquire') {
      hostCalls.push({ endpoint, params: structuredClone(params) });
      if (holdQueueLock) { holdQueueLock = false; queueLockWaiting = true;
        await new Promise<void>(resolve => { releaseQueueLock = resolve; }); queueLockWaiting = false; }
      return { acquired: true } as T;
    }
    if (endpoint === 'queued-follow-up-send-lock-release') { hostCalls.push({ endpoint, params: structuredClone(params) }); return {} as T; }
    if (endpoint === 'message-send-status') return { turnId: null, queuedSubmissionId: null } as T;
    throw new Error('Unexpected synthetic host ' + endpoint);
  },
  subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  async reply() { throw new Error('Unexpected approval'); },
};
const sends = new SendRecoveryStore(client);
const sessions = new ConversationSessions(client, async identity => (await sends.read()).creations[sendThreadKey(identity.hostId, identity.threadId)]);
const editStorage: EditRecoveryStorage = {
  read: () => readBrowserAtom(messageEditsAtom),
  update: async change => {
    if (holdEditTransaction) {
      holdEditTransaction = false; editTransactionWaiting = true;
      await new Promise<void>(resolve => { releaseEditTransaction = resolve; }); editTransactionWaiting = false;
    }
    let result: unknown;
    try { result = await updateBrowserAtom(messageEditsAtom, change); }
    catch (reason) { editTransactionError = reason instanceof Error ? reason.message : String(reason); throw reason; }
    const entries = result as Record<string, StoredMessageEdit>;
    if (holdEditPreparation && Object.values(entries).some(value => value.submission?.stage === 'revertUnknown')) {
      holdEditPreparation = false; editPreparing = true;
      await new Promise<void>(resolve => { releaseEditPreparation = resolve; });
      editPreparing = false;
    }
    return result;
  },
  changed: () => window.dispatchEvent(new Event(messageEditChanged)),
};
const edits = new MessageEditRecoveryStore(client, editStorage, { hostChecksRebasedSourceBeforeRevert: true });
const realSaveEdit = edits.save.bind(edits);
edits.save = async (...args: Parameters<MessageEditRecoveryStore['save']>) => {
  if (holdEditSnapshot) { holdEditSnapshot = false; editSnapshotWaiting = true;
    await new Promise<void>(resolve => { releaseEditSnapshot = resolve; }); editSnapshotWaiting = false; }
  return realSaveEdit(...args);
};
const peerAccess = edits.createAccess();
const createEditAccess = edits.createAccess.bind(edits);
edits.createAccess = () => { const access = createEditAccess(); miniAccess = access; return access; };
const realReadSends = sends.read.bind(sends), realReadEdits = edits.read.bind(edits), realReady = sessions.ready.bind(sessions);
sends.read = async () => {
  if (holdRetryRead) { holdRetryRead = false; retryReadWaiting = true;
    await new Promise<void>(resolve => { releaseRetryRead = resolve; }); retryReadWaiting = false; }
  if (rejectSendRead) { rejectSendRead = false; throw new Error('Synthetic send recovery read failure'); }
  return realReadSends();
};
edits.read = async (hostId, threadId) => { if (rejectEditThread === threadId) throw new Error('Synthetic edit recovery read failure'); return realReadEdits(hostId, threadId); };
sessions.ready = async (identity, allowFirstTurn) => { if (rejectReady) { rejectReady = false; throw new Error('Synthetic session ready failure'); }
  return realReady(identity, allowFirstTurn); };
function complete(hostId: string, id: string) {
  const value = thread(hostId, id), active = value.turns.find(item => item.status === 'inProgress');
  if (!active) return;
  active.status = 'completed'; value.status = { type: 'idle' };
  emit({ type: 'mcp-notification', hostId, method: 'turn/completed', params: { threadId: id, turn: structuredClone(active) } });
}
function initialTarget(): MiniConversationTarget {
  const saved = sessionStorage.getItem('fixture-mini-target');
  return saved ? JSON.parse(saved) as MiniConversationTarget : {
    hostId: 'local', threadId: 'thread-a', draftId: miniDraftIdentity('local', 'thread-a'), cwd: '/fixture/local',
  };
}
function PeerMessages({ visible }: { visible: boolean }) {
  const view = useConversationSession(sessions, { hostId: 'remote', threadId: 'thread-b' }, false, visible, 0);
  const [recovery, setRecovery] = useState<StoredMessageEdit | null>(null);
  useEffect(() => {
    if (!visible) return;
    let active = true;
    const read = () => { void edits.read('remote', 'thread-b').then(value => { if (active) setRecovery(value); }); };
    read(); window.addEventListener(messageEditChanged, read);
    return () => { active = false; window.removeEventListener(messageEditChanged, read); };
  }, [visible]);
  if (!visible) return null;
  return <section id="peer-messages"><StandaloneMessages client={client} hostId="remote" thread={view.thread}
    editAccess={peerAccess} editRecovery={recovery?.recovery ?? null} editHistory={{ order: 'ascending', tailComplete: view.historyComplete }}
    onEditNavigationController={value => { peerController = value; }}
    onEditDraftChange={(value, origin, version, authority) => edits.save(value, origin, version, authority)} onEdit={async (_draft, origin, prepare) => {
      const assertAccess = peerAccess.capture(origin);
      await prepare();
      await edits.submit(origin, ['original-turn'], {}, assertAccess);
    }} /></section>;
}
function Fixture() {
  const [target, setTarget] = useState(initialTarget);
  const [online, setOnline] = useState(true);
  const [ownerAvailable, setOwnerAvailable] = useState(true);
  const [connectionRevision, setConnectionRevision] = useState(0);
  const [peerVisible, setPeerVisible] = useState(false);
  const [quickGrant, setQuickGrant] = useState(true);
  const [mainGrant, setMainGrant] = useState(true);
  const main = useConversationSession(sessions, { hostId: 'local', threadId: 'thread-a' }, false, true, 0);
  const targetRef = useRef(target); targetRef.current = target;
  useEffect(() => {
    fixture.renderConnection = value => { setOnline(value); if (value) setConnectionRevision(revision => revision + 1); };
    fixture.renderOwner = value => { authorityEpoch++; setOwnerAvailable(value); };
    fixture.renderPeer = setPeerVisible;
    fixture.renderQuickGrant = setQuickGrant;
    fixture.renderMainGrant = setMainGrant;
  }, []);
  return <>
    <div id="main" inert={!mainGrant}><StandaloneComposer client={client} context={{ hostId: 'local', threadId: 'thread-a', draftId: 'main-draft', cwd: '/fixture/local' }}
      busy={false} initialOptions={main.options ?? undefined} onDraftController={value => { mainController = value; }}
      onSubmit={async () => {}} onInterrupt={async () => {}} /></div>
    <PeerMessages visible={peerVisible} />
    <StandaloneMini client={client} send={async command => {
      if (command.type === 'avatar-overlay-open-state-request' || command.type === 'avatar-overlay-open') {
        emit({ type: 'workbench-pet-state', state: { isOpen: true, visibility: 'always-visible', position: null } });
      } else if (command.type === 'avatar-overlay-hide' || command.type === 'avatar-overlay-close') {
        emit({ type: 'workbench-pet-state', state: { isOpen: false, visibility: 'always-visible', position: null } });
      }
    }} activities={[{ hostId: 'remote', threadId: 'thread-b', title: 'Remote fixture', status: 'idle',
      actions: [{ id: 'follow-remote', kind: 'follow-up', label: 'Follow remote' }] }]} bridgeState={online ? 'connected' : 'disconnected'}
    hostConnections={{ local: { state: 'connected', fresh: true, revision: String(connectionRevision) },
      remote: { state: 'connected', fresh: true, revision: String(connectionRevision) } }} pendingRequests={[]}
    quickChatTarget={{ hostId: target.hostId, threadId: target.threadId }} onOpenThread={() => {}} onOpenRequest={() => {}}
    onExpand={() => {}} onRespond={async () => {}} onInputDraftChange={() => {}}
    quickChatInteractive={quickGrant} onQuickChatStateChange={value => {
      const element = document.querySelector<HTMLElement>('[data-mini-composer-content]');
      quickStates.push({ ...structuredClone(value), contentInert: element?.inert ?? null });
    }} onBeforeQuickChatOpen={request => {
      quickRequests.push(structuredClone(request));
      if (parentFence) {
        const current = mainController?.snapshot();
        parentLease = current ? mainController?.freeze(current.owner) ?? null : null;
        if (!parentLease) return Promise.resolve(false);
      }
      if (miniFence && controller) {
        miniOpenLease = controller.freeze();
        if (!miniOpenLease) { parentLease?.release(); parentLease = null; return Promise.resolve(false); }
      }
      return (async () => {
        if (holdOpen) { holdOpen = false; openWaiting = true;
          await new Promise<void>(resolve => { releaseOpen = resolve; }); openWaiting = false; }
        if (rejectOpen || parentLease && !await parentLease.flush() || miniOpenLease && !await miniOpenLease.flush()) {
          parentLease?.release(); parentLease = null; miniOpenLease?.release(); miniOpenLease = null; return false;
        }
        if (request.source === 'follow-up') { miniOpenLease?.release(); miniOpenLease = null; }
        return true;
      })();
    }} onQuickChatTarget={async identity => {
      if (controller) return fixture.target(identity.hostId, identity.threadId);
      if (rejectTarget) return false;
      const state = await sends.read();
      const next: MiniConversationTarget = { ...identity, draftId: miniDraftIdentity(identity.hostId, identity.threadId, state.bindings),
        cwd: '/fixture/' + identity.hostId };
      targets.push(next); sessionStorage.setItem('fixture-mini-target', JSON.stringify(next)); setTarget(next); return true;
    }}
    onBeforeQuickChatClose={async () => { const lease = controller?.freeze(); if (!lease) return false;
      try { return await lease.flush(); } finally { lease.release(); } }}>
      <MiniConversation client={client} sessions={sessions} sends={sends} edits={edits} initialTarget={target}
        initialOptions={{ model: 'fixture-model', approvalPolicy: 'on-request', sandboxMode: 'workspace-write' }}
        isConnected={() => connected} canUseOwner={owner => ownerAvailable && authorityGranted && owner.draftId !== 'main-draft'}
        captureEditAuthority={owner => {
          if (!connected || !ownerAvailable || !authorityGranted || owner.draftId === 'main-draft') throw new Error('Synthetic edit grant unavailable');
          captures++;
          const captured = authorityEpoch;
          return () => {
            if (captured !== authorityEpoch || !connected || !authorityGranted) throw new Error('Synthetic edit grant revoked');
            if (asyncEditAssertion) return Promise.resolve() as unknown as void;
          };
        }} dispatchSubmission={async (method, params, hostId, assertAuthority) => {
          if (heldDispatch === method) { heldDispatch = ''; dispatchWaiting = true;
            await new Promise<void>(resolve => { releaseDispatch = resolve; }); dispatchWaiting = false; }
          assertAuthority();
          return client.rpc(method, params, hostId);
        }} onController={value => { controller = value; }}
        onDraftController={value => { miniController = value; }}
        onDraftChange={value => { miniSnapshot = structuredClone(value); }}
        onRemoveReference={(owner, reference, operation) => removeBrowserDraftReference(owner, reference, operation, (before, after) => {
          browserReceipt = structuredClone({ before, after });
          if (!failAcceptance) return;
          failAcceptance = false;
          const original = IDBObjectStore.prototype.get;
          IDBObjectStore.prototype.get = function (key) {
            const error = new Error('Synthetic acceptance read failure');
            if (this.name === 'atoms' && key === 'native-atoms' && error.stack?.includes('acceptCommittedVersion')) {
              IDBObjectStore.prototype.get = original; acceptanceFailureStack = error.stack; throw error;
            }
            return original.call(this, key);
          };
        }, () => { browserReceipt = null; })}
        onTargetChanged={value => { if (rejectTarget) throw new Error('Synthetic target persistence failure');
          if (asyncTarget) return Promise.resolve();
          if (value.threadId === rejectSendOnTarget) { rejectSendRead = true; rejectSendOnTarget = ''; }
          targets.push(value); sessionStorage.setItem('fixture-mini-target', JSON.stringify(value)); setTarget(value);
          if (failTargetAfterWrite) { failTargetAfterWrite = false; throw new Error('Synthetic target failure after persistence'); }
          if (revokeOnTarget) { revokeOnTarget = false; authorityGranted = false; authorityEpoch++; } }}
        onRecoveryChanged={() => { if (throwRecovery) throw new Error('Synthetic recovery notification failure'); }}
        onError={error => { errors.push(error); if (throwError) throw new Error('Synthetic error notification failure'); }}
        onAssignCreatedProject={async (owner, created, assertAuthority) => {
          projectChecks.push({ target: structuredClone(owner), threadId: created.id });
          if (holdProject) { holdProject = false; projectWaiting = true;
            await new Promise<void>(resolve => { releaseProject = resolve; }); projectWaiting = false; }
          assertAuthority();
          const key = threadKey(owner.hostId, created.id), previous = projectMembership[key];
          if (previous && previous !== owner.projectId) throw new Error('Synthetic project conflict');
          if (rejectProject) throw new Error('Synthetic project association failure');
          if (!previous && owner.projectId) projectMembership[key] = owner.projectId;
        }} onOpenThread={value => opened.push(value)} />
    </StandaloneMini>
  </>;
}
const nativePut = IDBObjectStore.prototype.put;
const nativeGet = IDBObjectStore.prototype.get;
const nativeTransaction = IDBDatabase.prototype.transaction;
IDBDatabase.prototype.transaction = function (...args: Parameters<IDBDatabase['transaction']>) {
  if (captures && args[0] === 'atoms' && args[1] === 'readwrite') writesAfterCapture++;
  return nativeTransaction.apply(this, args);
};
let failWrites = false;
IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
  if (failWrites) throw new DOMException('Synthetic storage failure', 'QuotaExceededError');
  return nativePut.apply(this, args);
};
IDBObjectStore.prototype.get = function (key) {
  const stack = revokeAtClear || switchAtClear ? new Error('Synthetic cleanup race').stack ?? '' : '';
  if (this.name === 'atoms' && key === 'native-atoms' && stack.includes('clearComposerDraftRevision')) {
    if (revokeAtClear) { revokeAtClear = false; authorityGranted = false; authorityEpoch++; revocationStack = stack; }
    const startSwitch = switchAtClear; switchAtClear = null; startSwitch?.();
  }
  return nativeGet.call(this, key);
};
const root = createRoot(document.getElementById('root')!);
const fixture = {
  calls, hostCalls, opened, errors, targets, projectChecks, projectMembership, sends, sessions,
  quickRequests, quickStates,
  fenceParent(value: boolean) { parentFence = value; },
  fenceMini(value: boolean) { miniFence = value; },
  rejectOpen(value: boolean) { rejectOpen = value; },
  holdOpen() { holdOpen = true; }, openWaiting: () => openWaiting,
  releaseOpen() { releaseOpen?.(); releaseOpen = undefined; },
  grantMini() { fixture.renderMainGrant(false); parentLease?.release(); parentLease = null; fixture.renderQuickGrant(true); },
  grantMain() { fixture.renderQuickGrant(false); fixture.renderMainGrant(true); },
  holdEditTransaction() { holdEditTransaction = true; editTransactionError = ''; },
  editTransactionWaiting: () => editTransactionWaiting, editTransactionError: () => editTransactionError,
  releaseEditTransaction() { releaseEditTransaction?.(); releaseEditTransaction = undefined; },
  transferEdit() {
    const identity = { hostId: 'remote', threadId: 'thread-b' };
    miniAccess?.release(identity); return peerAccess.acquire(identity);
  },
  async useRealInterrupt() {
    Object.defineProperty(window, 'WebSocket', { configurable: true, writable: true, value: FixtureSocket });
    realInterrupt = new BrowserWorkbenchClient('ws://fixture.invalid/native-host');
    const connect = realInterrupt.connect.bind(realInterrupt);
    realInterrupt.connect = async () => {
      if (holdInterrupt) { holdInterrupt = false; interruptWaiting = true;
        await new Promise<void>(resolve => { releaseInterrupt = resolve; }); interruptWaiting = false; }
      return connect();
    };
    const opening = realInterrupt.connect(); interruptSocket!.open(); await opening;
  },
  holdInterrupt() { holdInterrupt = true; }, interruptWaiting: () => interruptWaiting,
  releaseInterrupt() { releaseInterrupt?.(); releaseInterrupt = undefined; },
  async replaceInterruptSocket() {
    interruptSocket?.close();
    const opening = realInterrupt!.connect(); interruptSocket!.open(); await opening;
  },
  dropInterrupt() { dropInterrupt = true; },
  captures: () => captures, writesAfterCapture: () => writesAfterCapture,
  holdDispatch(method: string) { heldDispatch = method; }, dispatchWaiting: () => dispatchWaiting,
  releaseDispatch() { releaseDispatch?.(); releaseDispatch = undefined; },
  holdProject() { holdProject = true; }, projectWaiting: () => projectWaiting,
  releaseProject() { releaseProject?.(); releaseProject = undefined; },
  holdRetryRead() { holdRetryRead = true; }, retryReadWaiting: () => retryReadWaiting,
  releaseRetryRead() { releaseRetryRead?.(); releaseRetryRead = undefined; },
  holdQueueLock() { holdQueueLock = true; }, queueLockWaiting: () => queueLockWaiting,
  releaseQueueLock() { releaseQueueLock?.(); releaseQueueLock = undefined; },
  holdEditSnapshot() { holdEditSnapshot = true; }, editSnapshotWaiting: () => editSnapshotWaiting,
  releaseEditSnapshot() { releaseEditSnapshot?.(); releaseEditSnapshot = undefined; },
  failTargetAfterWrite() { failTargetAfterWrite = true; },
  renderConnection: (_value: boolean) => {}, renderOwner: (_value: boolean) => {}, renderPeer: (_value: boolean) => {},
  renderQuickGrant: (_value: boolean) => {}, renderMainGrant: (_value: boolean) => {},
  controller: () => controller, main: () => mainController?.snapshot(),
  draftController: () => miniController,
  receipt: () => structuredClone(browserReceipt),
  acceptanceFailure: () => acceptanceFailureStack,
  failNextAcceptance() { failAcceptance = true; acceptanceFailureStack = ''; },
  revokeDuringClear() { revokeAtClear = true; revocationStack = ''; },
  revocationStack: () => revocationStack,
  restoreAuthority() { authorityGranted = true; authorityEpoch++; root.render(<Fixture />); },
  showPeer() { fixture.renderPeer(true); },
  freezePeer() { peerLease = peerController?.freeze() ?? null; return !!peerLease; },
  async flushPeer() { await peerLease?.flush(); },
  handoffPeer() { if (!peerLease) throw new Error('Missing peer lease'); peerLease.handoff(); peerLease.release(); peerLease = null; },
  holdEditPreparation() { holdEditPreparation = true; },
  editPreparing() { return editPreparing; },
  revokeEditGrant() { authorityGranted = false; authorityEpoch++; },
  revokeDuringTarget() { revokeOnTarget = true; },
  setAsyncEditAssertion(value: boolean) { asyncEditAssertion = value; },
  setAsyncTarget(value: boolean) { asyncTarget = value; },
  releaseEditPreparation() { releaseEditPreparation?.(); releaseEditPreparation = undefined; },
  switchDuringClear() {
    switchAtClear = () => { switching = controller?.switchTarget({ hostId: 'remote', threadId: 'thread-b',
      draftId: miniDraftIdentity('remote', 'thread-b'), cwd: '/fixture/remote' }) ?? Promise.resolve(false); };
  },
  switchResult() { return switching ?? Promise.resolve(false); },
  async attachBrowser() {
    const current = miniController, snapshot = current?.snapshot();
    if (!current || !snapshot) throw new Error('Mini controller unavailable');
    const reference = await addBrowserComment(snapshot.owner, { kind: 'element', pageUrl: 'https://fixture.invalid/page',
      framePath: [], title: 'Fixture element', immediateText: 'Example', role: 'button', name: 'Example', selector: '#fixture',
      elementPath: '#fixture', nearbyText: 'Example', rect: { x: 1, y: 2, width: 20, height: 10 }, elementMetadata: { tag: 'button' } });
    if (!await current.update(snapshot.owner, draft => ({ ...draft, references: [...(draft.references ?? []), reference] }))) {
      throw new Error('Could not attach fixture browser reference');
    }
    return reference;
  },
  async retryReceipt() {
    if (!browserReceipt || !miniController) return false;
    const accepted = await miniController.acceptCommittedVersion(browserReceipt.before, browserReceipt.after);
    if (accepted) browserReceipt = null;
    return accepted;
  },
  versions: readComposerDraftVersions,
  async setBinding(hostId: string, threadId: string, draftId: string) {
    await updateBrowserAtom(sendsAtom, previous => {
      if (!previous || typeof previous !== 'object' || Array.isArray(previous)) throw new Error('Missing fixture recovery state');
      const state = previous as { bindings: Record<string, string> };
      return { ...state, bindings: { ...state.bindings, [sendThreadKey(hostId, threadId)]: draftId } };
    });
  },
  async stripCreationProject(hostId: string, threadId: string) {
    await updateBrowserAtom(sendsAtom, previous => {
      if (!previous || typeof previous !== 'object' || Array.isArray(previous)) throw new Error('Missing fixture recovery state');
      const state = previous as { creations: Record<string, Record<string, unknown>> }, key = sendThreadKey(hostId, threadId);
      const receipt = { ...state.creations[key] }; delete receipt.projectId;
      return { ...state, creations: { ...state.creations, [key]: receipt } };
    });
  },
  async target(hostId: string, threadId: string | null, projectId?: string) {
    const state = await sends.read(), draftId = miniDraftIdentity(hostId, threadId, state.bindings);
    return controller?.switchTarget({ hostId, threadId, draftId, cwd: '/fixture/' + hostId, ...(projectId ? { projectId } : {}) }) ?? false;
  },
  async exactTarget(value: MiniConversationTarget) { return controller?.switchTarget(value) ?? false; },
  async cancel(id: string) { await sends.cancel(id); },
  async queueRecovery() { return readUnknownQueueRecovery('local', 'thread-a'); },
  failReady() { rejectReady = true; }, failQueueReply() { unknownQueue = true; },
  setProjectFailure(value: boolean) { rejectProject = value; },
  setNotificationFailures(recovery: boolean, error: boolean) { throwRecovery = recovery; throwError = error; },
  failSendReadOnTarget(threadId: string) { rejectSendOnTarget = threadId; },
  failEditReadFor(threadId: string) { rejectEditThread = threadId; },
  async records() { return sends.read(); },
  async editState(hostId: string, threadId: string) { return edits.read(hostId, threadId); },
  miniReady(hostId: string, threadId: string | null) {
    return miniSnapshot?.owner.hostId === hostId && miniSnapshot.owner.threadId === threadId;
  },
  async miniDurable(text: string) {
    const snapshot = miniSnapshot;
    if (!snapshot || !JSON.stringify(snapshot.draft).includes(text)) return false;
    const saved = await readComposerDraft(snapshot.owner, snapshot.revision);
    return !!saved && JSON.stringify(saved.draft) === JSON.stringify(snapshot.draft);
  },
  async canDrain() {
    const lease = controller?.freeze();
    if (!lease) return false;
    try { return await lease.flush(); } finally { lease.release(); }
  },
  freeze() { barrierLease = controller?.freeze() ?? null; return !!barrierLease; },
  async flush() { return barrierLease?.flush() ?? false; },
  releaseBarrier() { barrierLease?.release(); barrierLease = null; },
  hide() { emit({ type: 'workbench-pet-state', state: { isOpen: false, visibility: 'always-visible', position: null } }); },
  show() { emit({ type: 'workbench-pet-state', state: { isOpen: true, visibility: 'always-visible', position: null } }); },
  setFailure(value: boolean) { failWrites = value; },
  setTargetFailure(value: boolean) { rejectTarget = value; },
  disconnect() { connected = false; authorityEpoch++; fixture.renderConnection(false); emit({ type: 'connection-state', state: 'disconnected' }); },
  reconnect() { connected = true; authorityEpoch++; fixture.renderConnection(true); emit({ type: 'connection-state', state: 'connected' }); },
  unknown() { unknownNext = true; }, hold() { holdNext = true; }, release() { resolveHeld?.(); resolveHeld = undefined; }, complete,
  dispose() { root.unmount(); mainRelease?.(); parentLease?.release(); miniOpenLease?.release(); realInterrupt?.close(); sessions.dispose();
    if (originalWebSocket) Object.defineProperty(window, 'WebSocket', originalWebSocket);
    IDBObjectStore.prototype.put = nativePut; IDBObjectStore.prototype.get = nativeGet;
    IDBDatabase.prototype.transaction = nativeTransaction; },
};
(window as unknown as { miniFixture: typeof fixture }).miniFixture = fixture;
root.render(<Fixture />);
