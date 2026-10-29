import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { BrowserWorkbenchClient } from '../src/renderer/app/client.ts';
import { ConversationSessions } from '../src/renderer/app/conversation-sessions.ts';
import { SendRecoveryStore } from '../src/renderer/app/send-recovery.ts';
import { MessageEditRecoveryStore } from '../src/renderer/app/message-edit-recovery.ts';
import { ApprovalRequestsController } from '../src/renderer/app/approval-requests.ts';
import { SideChatWorkspace } from '../src/renderer/app/SideChatWorkspace.tsx';
import { SideChatWorkspaceRuntime } from '../src/renderer/app/side-chat-workspace-runtime.ts';
import type { SideChatChildDispatchAuthority } from '../src/renderer/side-chat/browser-authority.ts';
import type { SideChatWorkspaceNavigationController, SideChatWorkspaceNavigationLease } from '../src/renderer/app/SideChatWorkspace.tsx';
import { readSideChatDraftAssociation } from '../src/renderer/side-chat/browser-authority.ts';
import { readBrowserAtoms } from '../src/renderer/storage/ui-atoms.ts';
import { addBrowserCommentToDraft, readBrowserCommentsSnapshot } from '../src/renderer/browser/comments.ts';
import { browserDraftOwner, removeBrowserDraftReference } from '../src/renderer/app/browser-draft.ts';
import type { ComposerDraftController, ComposerDraftOwner, ComposerDraftSnapshot } from '../src/renderer/composer/StandaloneComposer.tsx';
import type { SideChatChildScope } from '../src/renderer/side-chat/SideChatPanel.tsx';
import type { WorkbenchDispatchOptions } from '../src/renderer/workbench-contract.ts';

declare global { interface Window { fixtureCwd: string; sideChatWorkspaceFixture: typeof fixture } }
const identity = { hostId: 'local', parentThreadId: 'parent-a', draftId: 'workspace-draft', prepareId: 'workspace-prepare', cwd: window.fixtureCwd };
const client = new BrowserWorkbenchClient(), sessions = new ConversationSessions(client, async () => undefined);
const sends = new SendRecoveryStore(client), edits = new MessageEditRecoveryStore(client), approvals = new ApprovalRequestsController(client);
let ownerCurrent = true, frozen = false, closed = 0, exited = 0, cleanups = 0, navigation: SideChatWorkspaceNavigationController | null = null;
let lease: SideChatWorkspaceNavigationLease | null = null, drainGate: Promise<void> | null = null, releaseDrain: (() => void) | null = null;
let dispatchGate: Promise<void> | null = null, releaseDispatch: (() => void) | null = null, dispatchWaiting = false;
let draftController: ComposerDraftController | null = null, draftSnapshot: ComposerDraftSnapshot | null = null;
let openBehavior: 'success' | 'unsent' | 'unknown' = 'success';
let presentedIdentity = { ...identity, mode: 'new' as 'new' | 'restore' };
const opened: { scope: SideChatChildScope; operationId: string; draftId: string }[] = [];
const openAttempts: SideChatChildScope[] = [], removedOwners: ComposerDraftOwner[] = [];
const queueDispatches: { method: string; hostId: string; threadId: unknown }[] = [], interrupts: { threadId: string; turnId: string }[] = [];
const originalAuthorities = new WeakSet<() => void>();
const childAuthorities = new WeakMap<() => void, SideChatChildDispatchAuthority>();
const authorityDispatches: { method: string; original: boolean }[] = [];
const root = createRoot(document.getElementById('root')!);
function assertCurrent() { if (!ownerCurrent || !client.connected) throw Error('Synthetic original owner is unavailable.'); }
function capture(owner: ComposerDraftOwner, childAuthority?: SideChatChildDispatchAuthority) {
  assertCurrent(); if (frozen || owner.hostId !== identity.hostId || owner.draftId !== identity.draftId) throw Error('Synthetic owner is frozen.');
  const authority = () => { assertCurrent(); if (frozen) throw Error('Synthetic owner was frozen.'); childAuthority?.assertCurrent(); };
  originalAuthorities.add(authority); if (childAuthority) childAuthorities.set(authority, childAuthority); return authority;
}
function options(original: (() => void) | null, guard: () => void, onLateTerminal?: WorkbenchDispatchOptions['onLateTerminal']) {
  const child = original && childAuthorities.get(original);
  if (!child) throw Error('Synthetic dispatcher did not receive the original child authority.');
  return { daemonConnectionGeneration: child.proof.identity.connectionGeneration, sideChat: structuredClone(child.proof),
    assertBeforeSend: () => { child.assertCurrent(); guard(); }, onLateTerminal };
}
function render() {
    root.render(<SideChatWorkspace client={client} identity={presentedIdentity} open sessions={sessions} sends={sends} edits={edits} approvals={approvals}
      assertCurrent={assertCurrent} freezeSending={owner => {
        assertCurrent(); if (frozen || owner.draftId !== identity.draftId || owner.hostId !== identity.hostId) throw Error('Synthetic lease unavailable.');
        frozen = true;
        return { async drain() { await drainGate; }, assertCurrent() { assertCurrent(); if (!frozen) throw Error('Synthetic lease lost.'); },
          release() { frozen = false; } };
      }} captureSubmissionAuthority={capture} dispatchSubmission={(method, params, hostId, guard, originalAuthority) => {
        if (originalAuthority && !originalAuthorities.has(originalAuthority)) throw Error('Synthetic original authority was replaced.');
        if (!originalAuthority && method !== 'thread/queue/start') throw Error('Synthetic original authority is missing.');
        authorityDispatches.push({ method, original: !!originalAuthority });
        return client.rpc(method, params, hostId, options(originalAuthority, guard));
      }}
      dispatchQueueMutation={async (method, params, hostId, originalAuthority, guard, onLateTerminal) => {
        if (!originalAuthorities.has(originalAuthority)) throw Error('Synthetic queue authority was replaced.');
        authorityDispatches.push({ method, original: true });
        queueDispatches.push({ method, hostId, threadId: params.threadId }); guard();
        if (dispatchGate) { dispatchWaiting = true; await dispatchGate; dispatchWaiting = false; }
        guard(); return client.rpc(method, params, hostId, options(originalAuthority, guard, onLateTerminal));
      }} interruptTurn={async (scope, guard, originalAuthority) => {
        if (!originalAuthorities.has(originalAuthority)) throw Error('Synthetic interrupt authority was replaced.');
        authorityDispatches.push({ method: 'turn/interrupt', original: true });
        interrupts.push({ threadId: scope.childThreadId, turnId: scope.turnId }); guard();
        if (dispatchGate) { dispatchWaiting = true; await dispatchGate; dispatchWaiting = false; }
        guard(); await client.rpc('turn/interrupt', { threadId: scope.childThreadId, turnId: scope.turnId }, scope.hostId, options(originalAuthority, guard));
      }}
      cancelSend={async (intent, guard) => { guard(); await sends.cancel(intent.id); }} cleanupChild={async () => { cleanups++; }}
      onNavigationController={value => { navigation = value; }} onClosed={() => { closed++; }} onExitObservation={() => { exited++; }}
      onOpenNew={async scope => {
        openAttempts.push(structuredClone(scope));
        if (openBehavior === 'unsent') throw Object.assign(new Error('Synthetic new authority unavailable.'), { uncertain: false });
        if (openBehavior === 'unknown') throw new Error('Synthetic new result unknown.');
        const next = { ...identity, draftId: 'new-draft-' + openAttempts.length, prepareId: 'new-prepare-' + openAttempts.length, mode: 'new' as const };
        const nextClient = new BrowserWorkbenchClient(), nextSessions = new ConversationSessions(nextClient, async () => undefined);
        const nextSends = new SendRecoveryStore(nextClient);
        const runtime = new SideChatWorkspaceRuntime({ client: nextClient, identity: next, sessions: nextSessions, sends: nextSends,
          assertCurrent() { if (!nextClient.connected) throw Error('Synthetic new connection is unavailable.'); },
          freezeSending() { throw Error('Synthetic new close is not requested.'); }, draftController: () => null, cleanupChild: async () => {} });
        await nextClient.connect();
        await nextClient.rpc('thread/start', { cwd: next.cwd }, next.hostId);
        const nextController = await runtime.initialize(); await nextController.start();
        if (nextController.getSnapshot().phase !== 'ready') await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => { unsubscribe(); reject(new Error('Synthetic new controller did not become ready.')); }, 10_000);
          const unsubscribe = nextController.subscribe(() => {
            if (nextController.getSnapshot().phase === 'ready') { clearTimeout(timeout); unsubscribe(); resolve(); }
          });
          if (nextController.getSnapshot().phase === 'ready') { clearTimeout(timeout); unsubscribe(); resolve(); }
        });
        const view = nextController.getSnapshot().view, association = await readSideChatDraftAssociation(next);
        if (!view || nextController.getSnapshot().phase !== 'ready' || association?.operationId !== view.operationId
          || association.childThreadId !== view.childId) throw Error('Synthetic new operation and draft were not linked: '
            + JSON.stringify({ phase: nextController.getSnapshot().phase, error: nextController.getSnapshot().error, view, association }));
        opened.push({ scope: structuredClone(scope), operationId: view.operationId, draftId: next.draftId });
      }}
      onDraftController={value => { draftController = value; }} onDraftChange={value => { draftSnapshot = structuredClone(value); }}
      onRemoveReference={(owner, reference, operation) => {
        removedOwners.push(structuredClone(owner));
        return removeBrowserDraftReference(browserDraftOwner(owner, {}), reference, operation, () => {}, () => {});
      }} />);
}
const fixture = {
  identity,
  async mount(restore = false) {
    await client.connect();
    await client.rpc('thread/start', { cwd: identity.cwd }, identity.hostId);
    presentedIdentity = { ...identity, mode: restore ? 'restore' : 'new' }; render();
  },
  association: () => readSideChatDraftAssociation(identity),
  history: () => sessions.view({ hostId: 'local', threadId: 'child-a' }).snapshot(),
  approvalCount: () => approvals.getSnapshot().length,
  queueDispatches: () => queueDispatches, interrupts: () => interrupts, authorityDispatches: () => authorityDispatches,
  get frozen() { return frozen; }, get closed() { return closed; }, get exited() { return exited; }, get cleanups() { return cleanups; },
  opened: () => opened, openAttempts: () => openAttempts,
  setOpenBehavior(value: typeof openBehavior) { openBehavior = value; },
  changePresentedScope() { presentedIdentity = { ...presentedIdentity, parentThreadId: 'other-parent' }; flushSync(render); },
  draftSnapshot: () => draftSnapshot, hasDraftController: () => !!draftController, removedOwners: () => removedOwners,
  async attachBrowserReference() {
    const controller = draftController, snapshot = controller?.snapshot();
    if (!controller || !snapshot) throw Error('Synthetic side-chat draft is not ready.');
    let flushed = false;
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && !flushed) {
      const lease = controller.freeze(snapshot.owner);
      if (lease) { try { flushed = await lease.flush(); } finally { lease.release(); } }
      if (!flushed) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
    if (!flushed || draftController !== controller) throw Error('Synthetic side-chat draft did not settle before the browser action.');
    const operation = controller.beginExternalOperation(snapshot.owner);
    if (!operation) throw Error('Synthetic side-chat draft operation is unavailable.');
    let success = false;
    try {
      const receipt = await operation.transaction(async (before, isCurrent) => {
        const result = await addBrowserCommentToDraft(browserDraftOwner(before.owner, {}), {
          kind: 'element', pageUrl: 'https://example.invalid/', framePath: [], title: 'Synthetic page',
          immediateText: 'Reference', role: 'button', name: 'Reference', selector: '#reference', elementPath: 'button',
          nearbyText: '', rect: { x: 0, y: 0, width: 10, height: 10 }, elementMetadata: {},
        }, before, isCurrent);
        return { after: result.snapshot, value: result.reference };
      });
      success = receipt.accepted;
      if (!success) throw Error('Synthetic reference projection was not accepted.');
      return receipt.value;
    } finally { operation.finish(success); }
  },
  browserComments: () => readBrowserCommentsSnapshot({ hostId: 'local', threadId: 'child-a', draftId: identity.draftId }),
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
