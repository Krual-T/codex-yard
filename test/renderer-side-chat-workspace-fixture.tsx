import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserWorkbenchClient } from '../src/renderer/app/client.ts';
import { ConversationSessions } from '../src/renderer/app/conversation-sessions.ts';
import { SendRecoveryStore } from '../src/renderer/app/send-recovery.ts';
import { MessageEditRecoveryStore } from '../src/renderer/app/message-edit-recovery.ts';
import { ApprovalRequestsController } from '../src/renderer/app/approval-requests.ts';
import { SideChatWorkspace } from '../src/renderer/app/SideChatWorkspace.tsx';
import type { SideChatWorkspaceNavigationController, SideChatWorkspaceNavigationLease } from '../src/renderer/app/SideChatWorkspace.tsx';
import { readSideChatDraftAssociation } from '../src/renderer/side-chat/browser-authority.ts';
import { readBrowserAtoms } from '../src/renderer/storage/ui-atoms.ts';
import type { ComposerDraftOwner } from '../src/renderer/composer/StandaloneComposer.tsx';

declare global { interface Window { fixtureCwd: string; sideChatWorkspaceFixture: typeof fixture } }
const identity = { hostId: 'local', parentThreadId: 'parent-a', draftId: 'workspace-draft', prepareId: 'workspace-prepare', cwd: window.fixtureCwd };
const client = new BrowserWorkbenchClient(), sessions = new ConversationSessions(client, async () => undefined);
const sends = new SendRecoveryStore(client), edits = new MessageEditRecoveryStore(client), approvals = new ApprovalRequestsController(client);
let ownerCurrent = true, frozen = false, closed = 0, cleanups = 0, navigation: SideChatWorkspaceNavigationController | null = null;
let lease: SideChatWorkspaceNavigationLease | null = null, drainGate: Promise<void> | null = null, releaseDrain: (() => void) | null = null;
let dispatchGate: Promise<void> | null = null, releaseDispatch: (() => void) | null = null, dispatchWaiting = false;
const queueDispatches: { method: string; hostId: string; threadId: unknown }[] = [], interrupts: { threadId: string; turnId: string }[] = [];
const originalAuthorities = new WeakSet<() => void>();
const authorityDispatches: { method: string; original: boolean }[] = [];
const root = createRoot(document.getElementById('root')!);
function assertCurrent() { if (!ownerCurrent || !client.connected) throw Error('Synthetic original owner is unavailable.'); }
function capture(owner: ComposerDraftOwner) {
  assertCurrent(); if (frozen || owner.hostId !== identity.hostId || owner.draftId !== identity.draftId) throw Error('Synthetic owner is frozen.');
  const authority = () => { assertCurrent(); if (frozen) throw Error('Synthetic owner was frozen.'); };
  originalAuthorities.add(authority); return authority;
}
const fixture = {
  identity,
  async mount(restore = false) {
    await client.connect();
    await client.rpc('thread/start', { cwd: identity.cwd }, identity.hostId);
    root.render(<SideChatWorkspace client={client} identity={{ ...identity, mode: restore ? 'restore' : 'new' }} open sessions={sessions} sends={sends} edits={edits} approvals={approvals}
      assertCurrent={assertCurrent} freezeSending={owner => {
        assertCurrent(); if (frozen || owner.draftId !== identity.draftId || owner.hostId !== identity.hostId) throw Error('Synthetic lease unavailable.');
        frozen = true;
        return { async drain() { await drainGate; }, assertCurrent() { assertCurrent(); if (!frozen) throw Error('Synthetic lease lost.'); },
          release() { frozen = false; } };
      }} captureSubmissionAuthority={capture} dispatchSubmission={(method, params, hostId, guard, originalAuthority) => {
        if (originalAuthority && !originalAuthorities.has(originalAuthority)) throw Error('Synthetic original authority was replaced.');
        if (!originalAuthority && method !== 'thread/queue/start') throw Error('Synthetic original authority is missing.');
        authorityDispatches.push({ method, original: !!originalAuthority });
        return client.rpc(method, params, hostId, { assertBeforeSend: guard });
      }}
      dispatchQueueMutation={async (method, params, hostId, originalAuthority, guard, onLateTerminal) => {
        if (!originalAuthorities.has(originalAuthority)) throw Error('Synthetic queue authority was replaced.');
        authorityDispatches.push({ method, original: true });
        queueDispatches.push({ method, hostId, threadId: params.threadId }); guard();
        if (dispatchGate) { dispatchWaiting = true; await dispatchGate; dispatchWaiting = false; }
        guard(); return client.rpc(method, params, hostId, { assertBeforeSend: guard, onLateTerminal });
      }} interruptTurn={async (scope, guard, originalAuthority) => {
        if (!originalAuthorities.has(originalAuthority)) throw Error('Synthetic interrupt authority was replaced.');
        authorityDispatches.push({ method: 'turn/interrupt', original: true });
        interrupts.push({ threadId: scope.childThreadId, turnId: scope.turnId }); guard();
        if (dispatchGate) { dispatchWaiting = true; await dispatchGate; dispatchWaiting = false; }
        guard(); await client.rpc('turn/interrupt', { threadId: scope.childThreadId, turnId: scope.turnId }, scope.hostId, { assertBeforeSend: guard });
      }}
      cancelSend={async (intent, guard) => { guard(); await sends.cancel(intent.id); }} cleanupChild={async () => { cleanups++; }}
      onNavigationController={value => { navigation = value; }} onClosed={() => { closed++; }} />);
  },
  association: () => readSideChatDraftAssociation(identity),
  history: () => sessions.view({ hostId: 'local', threadId: 'child-a' }).snapshot(),
  approvalCount: () => approvals.getSnapshot().length,
  queueDispatches: () => queueDispatches, interrupts: () => interrupts, authorityDispatches: () => authorityDispatches,
  get frozen() { return frozen; }, get closed() { return closed; }, get cleanups() { return cleanups; },
  holdDrain() { drainGate = new Promise(resolve => { releaseDrain = resolve; }); },
  releaseDrain() { releaseDrain?.(); drainGate = null; releaseDrain = null; },
  holdDispatch() { dispatchGate = new Promise(resolve => { releaseDispatch = resolve; }); },
  releaseDispatch() { releaseDispatch?.(); dispatchGate = null; releaseDispatch = null; },
  dispatchWaiting: () => dispatchWaiting,
  freezeNavigation() { lease = navigation?.freeze() ?? null; return !!lease; },
  async flushNavigation() { return lease?.flush() ?? false; },
  async revokeNavigation() { await lease?.revoke(); },
  releaseNavigation() { lease?.release(); },
  disconnect() { ownerCurrent = false; client.suspend(); },
  initializeRoot: () => readBrowserAtoms(),
  failWrite(number: number) {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if (--number > 0) return original.apply(this, args);
      IDBObjectStore.prototype.put = original;
      throw new Error('Synthetic IDB write failure.');
    };
  },
};
window.sideChatWorkspaceFixture = fixture;
