import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StandaloneMini } from '../src/renderer/mini/index.tsx';
import { MiniConversation, miniDraftIdentity } from '../src/renderer/mini/MiniConversation.tsx';
import type { MiniConversationController, MiniConversationLease, MiniConversationTarget } from '../src/renderer/mini/MiniConversation.tsx';
import { StandaloneComposer } from '../src/renderer/composer/StandaloneComposer.tsx';
import { readComposerDraft } from '../src/renderer/composer/composer-draft-store.ts';
import type { ComposerDraftController, ComposerDraftSnapshot } from '../src/renderer/composer/StandaloneComposer.tsx';
import { ConversationSessions, useConversationSession } from '../src/renderer/app/conversation-sessions.ts';
import { SendRecoveryStore, sendThreadKey } from '../src/renderer/app/send-recovery.ts';
import { MessageEditRecoveryStore } from '../src/renderer/app/message-edit-recovery.ts';
import type { WorkbenchClient, WorkbenchEvent } from '../src/renderer/workbench-contract.ts';
import type { ThreadSummary, TurnSummary } from '../lib/codex-protocol.ts';

const listeners = new Set<(event: WorkbenchEvent) => void>();
const emit = (event: WorkbenchEvent) => { for (const listener of listeners) listener(event); };
const calls: { method: string; hostId: string; params: Record<string, unknown> }[] = [];
const hostCalls: { endpoint: string; params: Record<string, unknown> }[] = [];
const opened: { hostId: string; threadId: string }[] = [];
const errors: string[] = [];
const targets: MiniConversationTarget[] = [];
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
let controller: MiniConversationController | null = null, mainController: ComposerDraftController | null = null;
let miniSnapshot: ComposerDraftSnapshot | null = null;
let barrierLease: MiniConversationLease | null = null;
let mainRelease: (() => void) | undefined;
const client: WorkbenchClient & { connected: boolean } = {
  get connected() { return connected; },
  async rpc<T>(method: string, params: Record<string, unknown> = {}, hostId = 'local'): Promise<T> {
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
    if (endpoint === 'queued-follow-up-send-lock-acquire') return { acquired: true } as T;
    if (endpoint === 'queued-follow-up-send-lock-release') return {} as T;
    if (endpoint === 'message-send-status') return { turnId: null, queuedSubmissionId: null } as T;
    throw new Error('Unexpected synthetic host ' + endpoint);
  },
  subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  async reply() { throw new Error('Unexpected approval'); },
};
const sends = new SendRecoveryStore(client);
const sessions = new ConversationSessions(client, async identity => (await sends.read()).creations[sendThreadKey(identity.hostId, identity.threadId)]);
const edits = new MessageEditRecoveryStore(client, undefined, { hostChecksRebasedSourceBeforeRevert: true });
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
function Fixture() {
  const [target, setTarget] = useState(initialTarget);
  const [online, setOnline] = useState(true);
  const [ownerAvailable, setOwnerAvailable] = useState(true);
  const [connectionRevision, setConnectionRevision] = useState(0);
  const main = useConversationSession(sessions, { hostId: 'local', threadId: 'thread-a' }, false, true, 0);
  const targetRef = useRef(target); targetRef.current = target;
  useEffect(() => {
    fixture.renderConnection = value => { setOnline(value); if (value) setConnectionRevision(revision => revision + 1); };
    fixture.renderOwner = setOwnerAvailable;
  }, []);
  return <>
    <div id="main"><StandaloneComposer client={client} context={{ hostId: 'local', threadId: 'thread-a', draftId: 'main-draft', cwd: '/fixture/local' }}
      busy={false} initialOptions={main.options ?? undefined} onDraftController={value => { mainController = value; }}
      onSubmit={async () => {}} onInterrupt={async () => {}} /></div>
    <StandaloneMini client={client} send={async command => {
      if (command.type === 'avatar-overlay-open-state-request' || command.type === 'avatar-overlay-open') {
        emit({ type: 'workbench-pet-state', state: { isOpen: true, visibility: 'always-visible', position: null } });
      } else if (command.type === 'avatar-overlay-hide' || command.type === 'avatar-overlay-close') {
        emit({ type: 'workbench-pet-state', state: { isOpen: false, visibility: 'always-visible', position: null } });
      }
    }} activities={[]} bridgeState={online ? 'connected' : 'disconnected'}
    hostConnections={{ local: { state: 'connected', fresh: true, revision: String(connectionRevision) },
      remote: { state: 'connected', fresh: true, revision: String(connectionRevision) } }} pendingRequests={[]}
    quickChatTarget={{ hostId: target.hostId, threadId: target.threadId }} onOpenThread={() => {}} onOpenRequest={() => {}}
    onExpand={() => {}} onRespond={async () => {}} onInputDraftChange={() => {}}
    onBeforeQuickChatClose={async () => { const lease = controller?.freeze(); if (!lease) return false;
      try { return await lease.flush(); } finally { lease.release(); } }}>
      <MiniConversation client={client} sessions={sessions} sends={sends} edits={edits} initialTarget={target}
        initialOptions={{ model: 'fixture-model', approvalPolicy: 'on-request', sandboxMode: 'workspace-write' }}
        isConnected={() => connected} canUseOwner={owner => ownerAvailable && owner.draftId !== 'main-draft'} onController={value => { controller = value; }}
        onDraftChange={value => { miniSnapshot = structuredClone(value); }}
        onTargetChanged={value => { if (rejectTarget) throw new Error('Synthetic target persistence failure');
          targets.push(value); sessionStorage.setItem('fixture-mini-target', JSON.stringify(value)); setTarget(value); }}
        onRecoveryChanged={() => {}} onError={error => errors.push(error)} onOpenThread={value => opened.push(value)} />
    </StandaloneMini>
  </>;
}
const nativePut = IDBObjectStore.prototype.put;
let failWrites = false;
IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
  if (failWrites) throw new DOMException('Synthetic storage failure', 'QuotaExceededError');
  return nativePut.apply(this, args);
};
const root = createRoot(document.getElementById('root')!);
const fixture = {
  calls, hostCalls, opened, errors, targets, sends, sessions, renderConnection: (_value: boolean) => {}, renderOwner: (_value: boolean) => {},
  controller: () => controller, main: () => mainController?.snapshot(),
  async target(hostId: string, threadId: string | null) {
    const state = await sends.read(), draftId = miniDraftIdentity(hostId, threadId, state.bindings);
    return controller?.switchTarget({ hostId, threadId, draftId, cwd: '/fixture/' + hostId }) ?? false;
  },
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
  disconnect() { connected = false; fixture.renderConnection(false); emit({ type: 'connection-state', state: 'disconnected' }); },
  reconnect() { connected = true; fixture.renderConnection(true); emit({ type: 'connection-state', state: 'connected' }); },
  unknown() { unknownNext = true; }, hold() { holdNext = true; }, release() { resolveHeld?.(); resolveHeld = undefined; }, complete,
  dispose() { root.unmount(); mainRelease?.(); sessions.dispose(); IDBObjectStore.prototype.put = nativePut; },
};
(window as unknown as { miniFixture: typeof fixture }).miniFixture = fixture;
root.render(<Fixture />);
