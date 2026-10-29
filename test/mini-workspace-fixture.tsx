import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { ThreadSummary } from '../lib/codex-protocol.ts';
import { MiniWorkspace } from '../src/renderer/app/MiniWorkspace.tsx';
import type { MiniWorkspaceController, MiniWorkspaceLease } from '../src/renderer/app/MiniWorkspace.tsx';
import { ApprovalRequestsController } from '../src/renderer/app/approval-requests.ts';
import { ConversationSessions, useConversationSession } from '../src/renderer/app/conversation-sessions.ts';
import { MessageEditRecoveryStore, messageEditChanged } from '../src/renderer/app/message-edit-recovery.ts';
import { SendRecoveryStore, sendThreadKey } from '../src/renderer/app/send-recovery.ts';
import { StandaloneComposer } from '../src/renderer/composer/StandaloneComposer.tsx';
import type { ComposerDraftController } from '../src/renderer/composer/StandaloneComposer.tsx';
import { readComposerDraft } from '../src/renderer/composer/composer-draft-store.ts';
import { StandaloneMessages } from '../src/renderer/messages/StandaloneMessages.tsx';
import type { MessageEditNavigationController } from '../src/renderer/messages/StandaloneMessages.tsx';
import type { WorkbenchClient, WorkbenchDispatchOptions, WorkbenchEvent } from '../src/renderer/workbench-contract.ts';

const listeners = new Set<(event: WorkbenchEvent) => void>();
const emit = (event: WorkbenchEvent) => { for (const listener of listeners) listener(event); };
const calls: { method: string; hostId: string; params: Record<string, unknown> }[] = [];
const hostCalls: { endpoint: string; params: Record<string, unknown> }[] = [];
const errors: string[] = [], opened: unknown[] = [], leases: string[] = [];
const projects: { hostId: string; projectId?: string; threadId: string; turnsBefore: number }[] = [];
const threads: Record<string, ThreadSummary> = {};
const thread = (hostId: string, id: string): ThreadSummary => threads[hostId + ':' + id] ??= {
  id, name: id, cwd: '/fixture/' + hostId, status: { type: 'idle' }, turns: [{ id: 'original-turn', status: 'completed',
    itemsView: 'full', items: [{ id: 'original-item', type: 'userMessage', clientId: 'original-message',
      content: [{ type: 'text', text: 'original message', text_elements: [] }] }] }],
};
let generation = 0, connected = true, petOpen = true, failHide = false, failMain = false, failWrites = false;
let mainController: ComposerDraftController | null = null, mainEditor: MessageEditNavigationController | null = null;
let workspace: MiniWorkspaceController | null = null, mainVisible = true, holdMain = false, resolveMain: (() => void) | undefined;
let mainWaiting = false, defaultThread: string | null = location.search.includes('home=1') ? null : 'thread-a';
const defaultProject = location.search.includes('project=1') ? 'project-original' : undefined;
let holdWrite = false, writeWaiting = false, resolveWrite: (() => void) | undefined;
let failCreatedPointer = false;
let failPreSendRead = false;
let holdPetRead = false, petReadWaiting = false, resolvePetRead: (() => void) | undefined;
let holdPetAck = false, petAckWaiting = false, resolvePetAck: (() => void) | undefined;
let holdTargetResolution = false, targetResolutionWaiting = false, resolveTargetResolution: (() => void) | undefined;
const client: WorkbenchClient = {
  async rpc<T>(method: string, params: Record<string, unknown> = {}, hostId = 'local', options?: WorkbenchDispatchOptions): Promise<T> {
    if (method === 'turn/start' && holdWrite) {
      holdWrite = false; writeWaiting = true;
      await new Promise<void>(resolve => { resolveWrite = resolve; }); writeWaiting = false;
    }
    options?.assertBeforeSend?.();
    calls.push({ method, hostId, params: structuredClone(params) });
    if (method === 'model/list') return { data: [{ id: 'fixture', model: 'fixture-model', displayName: 'Fixture', isDefault: true,
      supportedReasoningEfforts: [] }], nextCursor: null } as T;
    if (method === 'config/read') return { config: { model: 'fixture-model' }, layers: [] } as T;
    if (method === 'thread/list') return { data: [], nextCursor: null } as T;
    if (method === 'thread/resume') return { thread: structuredClone(thread(hostId, String(params.threadId))), model: 'fixture-model' } as T;
    if (method === 'thread/read') return { thread: { ...structuredClone(thread(hostId, String(params.threadId))), turns: [] } } as T;
    if (method === 'thread/turns/list') return { data: thread(hostId, String(params.threadId)).turns, nextCursor: null } as T;
    if (method === 'thread/items/list' || method === 'thread/queue/list') return { data: [], nextCursor: null } as T;
    if (method === 'thread/unsubscribe') return {} as T;
    if (method === 'thread/start') {
      const created = thread(hostId, 'created-' + calls.filter(call => call.method === 'thread/start').length);
      created.turns = [];
      const result = { thread: structuredClone(created), model: 'fixture-model' };
      emit({ type: 'thread-created', hostId, result }); return result as T;
    }
    if (method === 'turn/start') {
      const turn = { id: 'sent-' + calls.filter(call => call.method === 'turn/start').length, status: 'inProgress' as const, items: [] };
      const value = thread(hostId, String(params.threadId)); value.turns = [turn]; value.status = { type: 'active', activeFlags: [] };
      return { turn } as T;
    }
    throw new Error('Unexpected synthetic RPC ' + method);
  },
  async host<T>(endpoint: string, params: Record<string, unknown> = {}): Promise<T> {
    hostCalls.push({ endpoint, params: structuredClone(params) });
    if (endpoint === 'pet-overlay') {
      const message = params.message as { type: string; isOpen?: boolean };
      if (message.type === 'avatar-overlay-open-state-request' && holdPetAck) {
        holdPetAck = false; petAckWaiting = true;
        queueMicrotask(() => emit({ type: 'workbench-pet-state', state: { isOpen: true, visibility: 'always-visible', position: null } }));
        await new Promise<void>(resolve => { resolvePetAck = resolve; }); petAckWaiting = false;
        emit({ type: 'workbench-pet-state', state: { isOpen: petOpen, visibility: 'always-visible', position: null } });
        return {} as T;
      }
      if (message.type === 'avatar-overlay-open-state-request' && holdPetRead) {
        holdPetRead = false; petReadWaiting = true;
        await new Promise<void>(resolve => { resolvePetRead = resolve; }); petReadWaiting = false;
        return {} as T;
      }
      if (message.type === 'avatar-overlay-hide' || message.type === 'avatar-overlay-close') {
        if (failHide) throw new Error('Synthetic native hide failure');
        petOpen = false;
      } else if (message.type === 'avatar-overlay-open') {
        if (message.isOpen === petOpen) petOpen = !petOpen;
      }
      queueMicrotask(() => emit({ type: 'workbench-pet-state', state: { isOpen: petOpen, visibility: 'always-visible', position: null } }));
      return {} as T;
    }
    if (endpoint === 'get-settings') return { values: {} } as T;
    if (endpoint === 'custom-avatars') return {} as T;
    if (endpoint === 'get-setting') return { exists: true, value: params.key === 'composerPlainTextMode' ? false
      : params.key === 'followUpQueueMode' ? 'queue' : 'cmdAlways' } as T;
    if (endpoint === 'workspace-root-options') return { roots: ['/fixture/local', '/fixture/remote'] } as T;
    if (endpoint === 'codex-home') return { codexHome: '/fixture/.codex' } as T;
    if (endpoint === 'get-persisted-atom') return {} as T;
    if (endpoint === 'message-send-status') return { turnId: null, queuedSubmissionId: null } as T;
    if (endpoint === 'queued-follow-up-send-lock-acquire') return { acquired: true } as T;
    if (endpoint === 'queued-follow-up-send-lock-release') return {} as T;
    throw new Error('Unexpected synthetic host ' + endpoint);
  },
  subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  async reply(ref, response) { hostCalls.push({ endpoint: 'reply', params: { ref, response } }); },
};
const sends = new SendRecoveryStore(client);
const readSends = sends.read.bind(sends);
sends.read = async () => {
  const value = await readSends();
  if (failPreSendRead && Object.values(value.requests).some(intent => intent.stage === 'sending')) {
    failPreSendRead = false; throw new Error('Synthetic original receipt read failure');
  }
  return value;
};
const sessions = new ConversationSessions(client, async identity => (await sends.read()).creations[sendThreadKey(identity.hostId, identity.threadId)]);
const edits = new MessageEditRecoveryStore(client);
const approvals = new ApprovalRequestsController(client);
const mainAccess = edits.createAccess();
const nativePut = IDBObjectStore.prototype.put;
const nativeSetItem = Storage.prototype.setItem;
Storage.prototype.setItem = function (key, value) {
  if (failCreatedPointer && key === 'codex-yard.mini-target.v1' && JSON.parse(value).threadId === 'created-1') {
    throw new DOMException('Synthetic target pointer failure', 'QuotaExceededError');
  }
  return nativeSetItem.call(this, key, value);
};
IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
  if (failWrites) throw new DOMException('Synthetic IDB failure', 'QuotaExceededError');
  return nativePut.apply(this, args);
};

function Fixture() {
  const [online, setOnline] = useState(true), [revision, setRevision] = useState(0), [enabled, setEnabled] = useState(true);
  const [showWorkspace, setShowWorkspace] = useState(true);
  const [recovery, setRecovery] = useState<Awaited<ReturnType<MessageEditRecoveryStore['read']>>>(null);
  const [, render] = useState(0);
  const view = useConversationSession(sessions, { hostId: 'local', threadId: 'thread-a' }, false, true, 0);
  const enabledRef = useRef(enabled); enabledRef.current = enabled;
  useEffect(() => {
    fixture.updateOnline = value => { setOnline(value); if (value) setRevision(revision => revision + 1); };
    fixture.render = () => render(value => value + 1);
    fixture.leaveMini = async () => {
      const lease = workspace?.freeze();
      if (!lease || !await lease.flush()) { lease?.release(); throw new Error('Mini navigation did not flush'); }
      flushSync(() => setShowWorkspace(false));
      lease.handoff(); lease.release();
    };
    fixture.mountMini = () => { flushSync(() => setShowWorkspace(true)); };
    const read = () => { void edits.read('local', 'thread-a').then(setRecovery); };
    read(); window.addEventListener(messageEditChanged, read);
    return () => window.removeEventListener(messageEditChanged, read);
  }, []);
  const freezeMain = (): MiniWorkspaceLease => {
    leases.push('freeze');
    const draft = mainController?.snapshot(), composer = draft && mainController?.freeze(draft.owner);
    if (!composer) throw new Error('Synthetic Main controller unavailable');
    const edit = mainEditor?.freeze();
    const acquisition = mainAccess.freezeAcquisition({ hostId: 'local', threadId: 'thread-a' });
    flushSync(() => { setEnabled(false); mainVisible = false; });
    let active = true, flushed = false, handed = false;
    return {
      async flush() {
        leases.push('flush');
        if (holdMain) { mainWaiting = true; await new Promise<void>(resolve => { resolveMain = resolve; }); mainWaiting = false; }
        if (failMain) return false;
        await edit?.flush(); flushed = await composer.flush(); return flushed;
      },
      handoff() { if (!flushed) throw new Error('Main not flushed'); leases.push('handoff'); edit?.handoff(); handed = true; },
      release() {
        if (!active) return; active = false; leases.push('release');
        composer.release(); if (!handed) edit?.release(); acquisition();
        flushSync(() => { setEnabled(true); mainVisible = true; });
      },
    };
  };
  return <>
    <div id="main" inert={!enabled}>
      <StandaloneMessages client={client} hostId="local" threadId="thread-a" thread={view.thread} editAccess={mainAccess}
        editRecovery={recovery?.recovery ?? null} onEditNavigationController={value => { mainEditor = value; }}
        onEditDraftChange={(draft, origin, version, authority) => edits.save(draft, origin, version, authority)}
        editHistory={{ order: 'ascending', tailComplete: view.historyComplete }} onEdit={enabled ? async (_draft, _origin, prepare) => { await prepare(); } : undefined} />
      <StandaloneComposer client={client} context={{ hostId: 'local', threadId: 'thread-a', draftId: 'main-draft', cwd: '/fixture/local' }}
        busy={false} initialOptions={{ model: 'fixture-model' }} onDraftController={value => { mainController = value; }}
        onSubmit={async () => {}} onInterrupt={async () => {}} />
    </div>
    {showWorkspace && <MiniWorkspace client={client} sessions={sessions} sends={sends} edits={edits} approvals={approvals}
      defaultTarget={{ hostId: 'local', threadId: defaultThread, cwd: '/fixture/local', projectId: defaultProject }}
      activities={[{ hostId: 'remote', threadId: 'thread-b', title: 'Remote fixture', status: 'idle',
        actions: [{ id: 'follow-remote', kind: 'follow-up', label: 'Follow remote' }] }]}
      bridgeState={online ? 'connected' : 'disconnected'} hostConnections={{ local: { state: online ? 'connected' : 'disconnected', fresh: online, revision: String(revision) },
        remote: { state: online ? 'connected' : 'disconnected', fresh: online, revision: String(revision) } }}
      resolveTarget={async identity => {
        const value = { ...identity, cwd: location.search.includes('badcwd=1') ? '/fixture/changed' : '/fixture/' + identity.hostId,
          ...(identity.hostId === 'local' && defaultProject ? { projectId: defaultProject } : {}) };
        if (holdTargetResolution) {
          holdTargetResolution = false; targetResolutionWaiting = true;
          await new Promise<void>(resolve => { resolveTargetResolution = resolve; }); targetResolutionWaiting = false;
        }
        return value;
      }}
      captureConnection={() => { const captured = generation; if (!connected) throw new Error('Synthetic offline');
        return () => { if (!connected || captured !== generation) throw new Error('Synthetic original connection revoked'); }; }}
      freezeMain={freezeMain} onController={value => { workspace = value; }}
      onOpenThread={value => { opened.push(value); }} onOpenRequest={(identity, ref) => { opened.push({ identity, ref }); }}
      onExpand={() => {}} onOpenSettings={() => {}} onError={message => { errors.push(message); }}
      onAssignCreatedProject={async (target, created, assert) => { assert(); projects.push({ hostId: target.hostId, projectId: target.projectId,
        threadId: created.id, turnsBefore: calls.filter(call => call.method === 'turn/start').length }); }}
      initialOptions={{ model: 'fixture-model' }} />}
  </>;
}
const root = createRoot(document.getElementById('root')!);
const fixture = {
  calls, hostCalls, errors, opened, leases, projects, sends, approvals,
  updateOnline: (_value: boolean) => {}, render: () => {},
  leaveMini: async () => {}, mountMini: () => {},
  ready: () => !!mainController && !!mainEditor,
  mainVisible: () => mainVisible,
  holdMain(value: boolean) { holdMain = value; }, mainWaiting: () => mainWaiting,
  releaseMain() { holdMain = false; resolveMain?.(); resolveMain = undefined; },
  failMain(value: boolean) { failMain = value; }, failWrites(value: boolean) { failWrites = value; },
  failHide(value: boolean) { failHide = value; },
  failCreatedPointer(value: boolean) { failCreatedPointer = value; },
  failPreSendRead() { failPreSendRead = true; },
  holdPetRead() { holdPetRead = true; }, petReadWaiting: () => petReadWaiting,
  holdPetAck() { holdPetAck = true; }, petAckWaiting: () => petAckWaiting,
  releasePetAck(open: boolean) { petOpen = open; resolvePetAck?.(); resolvePetAck = undefined; },
  holdTargetResolution() { holdTargetResolution = true; }, targetResolutionWaiting: () => targetResolutionWaiting,
  async releaseTargetResolution() {
    resolveTargetResolution?.(); resolveTargetResolution = undefined;
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  },
  invalidatePet() { emit({ type: 'workbench-pet-error', stateUnconfirmed: true, error: 'Synthetic state failure' }); },
  expirePetRead() { const original = Date.now; Date.now = () => original() + 11_000; },
  latePetState() { emit({ type: 'workbench-pet-state', state: { isOpen: true, visibility: 'always-visible', position: null } }); },
  releasePetRead() { resolvePetRead?.(); resolvePetRead = undefined; },
  holdWrite() { holdWrite = true; }, writeWaiting: () => writeWaiting,
  releaseWrite() { resolveWrite?.(); resolveWrite = undefined; },
  disconnect() { connected = false; generation++; emit({ type: 'connection-state', state: 'disconnected' }); fixture.updateOnline(false); },
  reconnect() { connected = true; generation++; emit({ type: 'connection-state', state: 'connected' }); fixture.updateOnline(true); },
  hide() { petOpen = false; emit({ type: 'workbench-pet-state', state: { isOpen: false, visibility: 'always-visible', position: null } }); },
  complete(hostId: string, id: string) {
    const value = thread(hostId, id), turn = value.turns.find(item => item.status === 'inProgress');
    if (!turn) return;
    turn.status = 'completed'; value.status = { type: 'idle' };
    emit({ type: 'mcp-notification', hostId, method: 'turn/completed', params: { threadId: id, turn: structuredClone(turn) } });
  },
  request() { const ref = { hostId: 'remote', id: 7, generation: 'fixture-1' };
    emit({ type: 'mcp-request', hostId: ref.hostId, requestRef: ref, request: { id: ref.id,
      method: 'item/commandExecution/requestApproval', params: { threadId: 'thread-b', command: 'pwd', cwd: '/fixture/remote',
        availableDecisions: ['accept', 'decline'] } } }); },
  records: () => sends.read(),
  edit: () => edits.read('local', 'thread-a'),
  mainDraft: () => mainController?.snapshot(),
  miniDraft: async (owner: Parameters<typeof readComposerDraft>[0]) => readComposerDraft(owner),
  pointer: () => sessionStorage.getItem('codex-yard.mini-target.v1'),
  nav: () => workspace,
  resetHome() { defaultThread = null; fixture.render(); },
  dispose() { root.unmount(); sessions.dispose(); approvals.dispose(); },
};
Object.assign(window, { miniWorkspaceFixture: fixture });
root.render(<Fixture />);
