import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserWorkbenchClient } from '../src/renderer/app/client.ts';
import { ConversationSessions } from '../src/renderer/app/conversation-sessions.ts';
import { SendRecoveryStore, sendsAtom } from '../src/renderer/app/send-recovery.ts';
import type { SendRecoverySnapshot } from '../src/renderer/app/send-recovery.ts';
import { MessageEditRecoveryStore } from '../src/renderer/app/message-edit-recovery.ts';
import { ApprovalRequestsController } from '../src/renderer/app/approval-requests.ts';
import { SideChatRoot } from '../src/renderer/side-chat/SideChatRoot.tsx';
import type { SideChatRootChild, SideChatRootController } from '../src/renderer/side-chat/SideChatRoot.tsx';
import type { SideChatWorkspaceNavigationLease } from '../src/renderer/app/SideChatWorkspace.tsx';
import { addBrowserCommentToDraft, readBrowserCommentsSnapshot } from '../src/renderer/browser/comments.ts';
import { browserDraftOwner, removeBrowserDraftReference } from '../src/renderer/app/browser-draft.ts';
import { updateBrowserAtoms } from '../src/renderer/storage/ui-atoms.ts';
import type { ComposerDraftOwner } from '../src/renderer/composer/StandaloneComposer.tsx';
import type { ComposerDraftExternalOperation } from '../src/renderer/composer/use-composer-draft.ts';
import type { WorkbenchDispatchOptions } from '../src/renderer/workbench-contract.ts';
import type { SideChatChildDispatchProof } from '../src/renderer/side-chat/browser-authority.ts';

declare global { interface Window { fixtureCwd: string; sideChatRootFixture: typeof fixture } }
const client = new BrowserWorkbenchClient(), sessions = new ConversationSessions(client, async () => undefined);
const sends = new SendRecoveryStore(client), edits = new MessageEditRecoveryStore(client), approvals = new ApprovalRequestsController(client);
const root = createRoot(document.getElementById('root')!);
let controller: SideChatRootController | null = null, child: SideChatRootChild | null = null, lease: SideChatWorkspaceNavigationLease | null = null;
let version = 0, closed = 0, exited = 0, cleanups = 0, visible = true;
let heldDraft: ComposerDraftExternalOperation | null = null, nativeGate: Promise<void> | null = null;
let releaseNative: (() => void) | null = null, nativeWaiting = false;
let flushPromise: Promise<boolean> | null = null, flushDone = false;
const removed: ComposerDraftOwner[] = [];
const observedChildren = new Map<string, SideChatRootChild>();
const frozenOwners = new Map<string, object>();
const rpcCaptures: { method: string; proof: SideChatChildDispatchProof; check: () => void }[] = [];
let ownerWork: Promise<void> | null = null, finishOwnerWork: (() => void) | null = null;
let cancelGate: Promise<void> | null = null, releaseCancel: (() => void) | null = null, cancelWaiting = false, cancelGuardCalls = 0;
let collaborationGate: Promise<void> | null = null, releaseCollaboration: (() => void) | null = null, collaborationWaiting = false;
let visualizationAbort: AbortController | null = null, visualizationResult: string | null = null;
const host = client.host.bind(client);
const rpc = client.rpc.bind(client);
client.rpc = <T,>(method: string, params?: Record<string, unknown>, hostId?: string, options?: WorkbenchDispatchOptions): Promise<T> => {
  const proof = (options as WorkbenchDispatchOptions & { sideChat?: SideChatChildDispatchProof } | undefined)?.sideChat;
  if (proof && options?.assertBeforeSend) rpcCaptures.push({ method, proof: structuredClone(proof), check: options.assertBeforeSend });
  return rpc<T>(method, params, hostId, options);
};
const resolvedCollaboration = sends.resolvedCollaboration.bind(sends);
sends.resolvedCollaboration = async (...args) => {
  if (collaborationGate) { collaborationWaiting = true; await collaborationGate; collaborationWaiting = false; }
  return resolvedCollaboration(...args);
};
client.host = async <T,>(endpoint: string, params?: Record<string, unknown>, options?: { assertBeforeSend?: () => void }): Promise<T> => {
  if (endpoint === 'send-injection' && params?.action === 'inject' && nativeGate) {
    nativeWaiting = true; await nativeGate; nativeWaiting = false;
  }
  return host<T>(endpoint, params, options);
};
function render() {
  root.render(<SideChatRoot client={client} sessions={sessions} sends={sends} edits={edits} approvals={approvals} visible={visible}
    captureParent={() => {
      const original = version;
      return { parent: { hostId: 'local', threadId: 'parent-a', cwd: window.fixtureCwd, archived: false },
        assertCurrent() { if (version !== original) throw Object.assign(new Error('Synthetic parent changed.'), { uncertain: false }); } };
    }}
    onController={value => { controller = value; }} onActiveChild={value => {
      child = value; if (value) observedChildren.set(value.identity.draftId, value);
    }}
    onClosed={() => { closed++; }} onExitObservation={() => { exited++; }} cleanupChild={async () => { cleanups++; }}
    freezeChildOwner={(owner, identity, _draft, assertOriginal) => {
      if (owner.draftId !== identity.draftId || frozenOwners.has(owner.draftId)) throw new Error('Synthetic owner unavailable.');
      const token = {}; frozenOwners.set(owner.draftId, token);
      const assertCurrent = () => { if (frozenOwners.get(owner.draftId) !== token) throw new Error('Synthetic owner lease changed.'); assertOriginal(); };
      return { async drain() { assertCurrent(); if (ownerWork) await ownerWork; assertCurrent(); }, assertCurrent,
        release() { if (frozenOwners.get(owner.draftId) !== token) throw new Error('Synthetic owner lease changed.'); frozenOwners.delete(owner.draftId); } };
    }}
    cancelSend={async (intent, guard) => {
      if (cancelGate) { cancelWaiting = true; await cancelGate; cancelWaiting = false; }
      await sends.cancelOriginal(intent, () => { cancelGuardCalls++; guard(); });
    }}
    onRemoveReference={(current, owner, reference, operation) => {
      if (child?.draft !== current.draft || child.owner.threadId !== owner.threadId) throw new Error('Synthetic child changed.');
      removed.push(structuredClone(owner));
      return removeBrowserDraftReference(browserDraftOwner(owner, {}), reference, operation, () => {}, () => {});
    }}
    onOpenFile={() => {}} onOpenBrowser={() => {}} onOpenVisualization={() => {}} />);
}
const api = () => { if (!controller) throw Error('Root controller is not mounted.'); return controller; };
const current = () => { const value = api().activeChild(); if (!value) throw Error('Child draft is not mounted.'); return value; };
const fixture = {
  async mount() { await client.connect(); await client.rpc('thread/start', { cwd: window.fixtureCwd }, 'local'); render(); },
  mounted() { return !!controller; },
  open() { return api().open(); },
  listRecoverable() { return api().listRecoverable(); },
  restore(identity: Parameters<SideChatRootController['restore']>[0]) { return api().restore(identity); },
  show(draftId: string) { return api().show(draftId); },
  rpcProofs() { return rpcCaptures.map(({ method, proof }) => ({ method, proof })); },
  capturedGuardValid(index: number) { try { rpcCaptures[index]!.check(); return true; } catch { return false; } },
  child() { const value = api().activeChild(); return value && { identity: value.identity, owner: value.owner, snapshot: value.snapshot,
    hasDraft: !!value.draft, hasNavigation: !!value.navigation, hasEditNavigation: !!value.editNavigation }; },
  history(threadId = 'child-a') { return sessions.view({ hostId: 'local', threadId }).snapshot(); },
  generation() { try { return client.captureDaemonConnection('local').generation; } catch { return null; } },
  get closed() { return closed; }, get exited() { return exited; }, get cleanups() { return cleanups; },
  removed() { return removed; },
  changeParent() { version++; },
  setVisible(value: boolean) { visible = value; render(); },
  freezeNavigation() { lease = api().freeze(); return !!lease; },
  async flushNavigation() { return lease?.flush() ?? false; },
  beginFlush() { flushDone = false; flushPromise = lease?.flush() ?? Promise.resolve(false); void flushPromise.then(() => { flushDone = true; }); },
  flushDone() { return flushDone; },
  async flushResult() { return flushPromise; },
  async revokeNavigation() { if (!lease) throw Error('Missing lease'); await lease.revoke(); },
  handoffNavigation() { if (!lease) throw Error('Missing lease'); lease.handoff(); },
  releaseNavigation() { if (!lease) throw Error('Missing lease'); lease.release(); lease = null; },
  holdDraftOperation() { const value = current(); heldDraft = value.draft.beginExternalOperation(value.owner); return !!heldDraft; },
  releaseDraftOperation() { heldDraft?.finish(true); heldDraft = null; },
  canAcquireDraft() { const value = current(), operation = value.draft.beginExternalOperation(value.owner);
    if (operation) operation.finish(true); return !!operation; },
  canAcquireChild(draftId: string) {
    const value = observedChildren.get(draftId), snapshot = value?.draft.snapshot();
    if (!value || !snapshot) return false;
    const operation = value.draft.beginExternalOperation(snapshot.owner);
    if (operation) operation.finish(true); return !!operation;
  },
  canAttachOwner(draftId: string) { return !frozenOwners.has(draftId); },
  holdOwnerWork() { ownerWork = new Promise<void>(resolve => { finishOwnerWork = resolve; }); },
  releaseOwnerWork() { finishOwnerWork?.(); finishOwnerWork = null; ownerWork = null; },
  holdCancel() { cancelGate = new Promise<void>(resolve => { releaseCancel = resolve; }); cancelGuardCalls = 0; },
  releaseCancel() { releaseCancel?.(); releaseCancel = null; cancelGate = null; },
  cancelWaiting() { return cancelWaiting; },
  cancelGuardCalls() { return cancelGuardCalls; },
  holdCollaboration() { collaborationGate = new Promise<void>(resolve => { releaseCollaboration = resolve; }); },
  releaseCollaboration() { releaseCollaboration?.(); releaseCollaboration = null; collaborationGate = null; },
  collaborationWaiting() { return collaborationWaiting; },
  beginVisualization(text: string) {
    const owner = current().owner;
    if (!owner.threadId) throw Error('Missing child thread.');
    visualizationAbort = new AbortController(); visualizationResult = null;
    const result = api().submitVisualization({ hostId: owner.hostId, threadId: owner.threadId, path: '/synthetic-widget',
      draft: { text, images: [], files: [] } }, visualizationAbort.signal);
    void result.then(() => { visualizationResult = 'sent'; }, error => { visualizationResult = String(error); });
  },
  abortVisualization() { visualizationAbort?.abort(); },
  visualizationResult() { return visualizationResult; },
  flushDraft() { const value = current(); return value.draft.flush(value.owner); },
  holdNative() { nativeGate = new Promise<void>(resolve => { releaseNative = resolve; }); },
  releaseNative() { releaseNative?.(); releaseNative = null; nativeGate = null; },
  nativeWaiting() { return nativeWaiting; },
  sends() { return sends.read(); },
  async prepareSend(injected = false) {
    const value = current(), snapshot = value.draft.snapshot();
    if (!snapshot || !snapshot.owner.threadId) throw Error('Original child draft is not ready.');
    const injection = injected ? { callId: 'synthetic-call', input: [{ type: 'text', text: 'original context input' }],
      responseItems: [{ type: 'function_call_output', call_id: 'synthetic-call', output: 'original context' }] } : undefined;
    return sends.prepare({ owner: snapshot.owner, revision: snapshot.revision }, window.fixtureCwd, snapshot.draft,
      { model: 'original-model' }, {}, undefined, undefined, { type: 'send' }, injection);
  },
  async changeIntentModel(id: string) {
    await updateBrowserAtoms(atoms => {
      const state = structuredClone(atoms[sendsAtom]) as SendRecoverySnapshot;
      state.requests[id]!.options.model = 'changed-model';
      return { value: null, updates: { [sendsAtom]: state } };
    });
  },
  async markUnknown(id: string, attemptId: string) {
    await sends.sending(id, attemptId);
    await sends.failed(id, Object.assign(new Error('synthetic lost reply'), { uncertain: true }), attemptId);
  },
  async markNativePending(id: string) {
    const original = (await sends.read()).requests[id]!;
    const reserved = await sends.reserveNativeInjection(original, original.threadId!,
      { threadId: original.threadId, clientUserMessageId: original.clientUserMessageId, input: original.injection!.input }, 'generation-a');
    const native = reserved.injection!.native!;
    await sends.applyNativeStatus(id, native, { reference: native.reference, injection: { phase: 'sending' },
      turn: { phase: 'waiting', attempts: [] }, pendingPersistence: { step: 'injection', attemptId: native.reference.injectionAttemptId, terminal: null } });
  },
  async updateDraftWhileFrozen() {
    const value = current(); return value.draft.update(value.owner, draft => ({ ...draft, text: 'not authorized' }));
  },
  async structuredDraft() {
    const value = current(), text = 'Respond to the user input in the context of our conversation.';
    const input = { type: 'text', text, text_elements: [{ byteRange: { start: 0, end: new TextEncoder().encode(text).length },
      placeholder: 'codex-untrusted-app-input:' + JSON.stringify({ version: 1, message: { source: 'visualization', sourceId: 'widget', text: 'synthetic' } }) }] };
    if (!await value.draft.update(value.owner, draft => ({ ...draft, text, input: [input] }))) throw Error('Structured draft was not saved.');
    if (!await value.draft.flush(value.owner)) throw Error('Structured draft did not flush.');
  },
  async attachBrowserReference() {
    const target = current(), snapshot = target.draft.snapshot();
    if (!snapshot) throw Error('Missing child snapshot');
    let flushed = false;
    for (let i = 0; i < 300 && !flushed; i++) {
      const held = target.draft.freeze(snapshot.owner);
      if (held) { try { flushed = await held.flush(); } finally { held.release(); } }
      if (!flushed) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
    if (!flushed || current().draft !== target.draft) throw Error('Original child draft did not settle.');
    const operation = target.draft.beginExternalOperation(snapshot.owner);
    if (!operation) throw Error('Original child draft operation unavailable.');
    let success = false;
    try {
      const result = await operation.transaction(async (before, isCurrent) => {
        const saved = await addBrowserCommentToDraft(browserDraftOwner(before.owner, {}), {
          kind: 'element', pageUrl: 'https://example.invalid/', framePath: [], title: 'Synthetic page', immediateText: 'Reference',
          role: 'button', name: 'Reference', selector: '#reference', elementPath: 'button', nearbyText: '',
          rect: { x: 0, y: 0, width: 10, height: 10 }, elementMetadata: {},
        }, before, isCurrent);
        return { after: saved.snapshot, value: saved.reference };
      });
      success = result.accepted; if (!success) throw Error('Original draft update not accepted.'); return result.value;
    } finally { operation.finish(success); }
  },
  browserComments() { return readBrowserCommentsSnapshot(current().owner); },
};
window.sideChatRootFixture = fixture;
