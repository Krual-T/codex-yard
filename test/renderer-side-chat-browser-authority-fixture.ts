import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserWorkbenchClient } from '../src/renderer/app/client.ts';
import { ConversationSessions } from '../src/renderer/app/conversation-sessions.ts';
import { SendRecoveryStore } from '../src/renderer/app/send-recovery.ts';
import { StandaloneComposer } from '../src/renderer/composer/StandaloneComposer.tsx';
import type { ComposerDraftController } from '../src/renderer/composer/use-composer-draft.ts';
import { SideChatBrowserAuthorityBridge, readSideChatDraftAssociation } from '../src/renderer/side-chat/browser-authority.ts';
import { SideChatController } from '../src/renderer/side-chat/controller.ts';
import type { SideChatHostPort, SideChatHostView } from '../src/renderer/side-chat/types.ts';
import { readBrowserAtoms } from '../src/renderer/storage/ui-atoms.ts';

const identity = { hostId: 'host-a', parentThreadId: 'parent-a', draftId: 'side-draft-a', prepareId: 'prepare-a' };
const client = new BrowserWorkbenchClient(), sessions = new ConversationSessions(client, async () => undefined), sendStore = new SendRecoveryStore(client);
let draft: ComposerDraftController | null = null, current = true, senderFrozen = false, cleanupCount = 0, startSettled = false;
let pauseStart = false, releaseStart: (() => void) | undefined, startWaiting = false;
let pauseAfterAuthorize = false, releaseAuthorized: (() => void) | undefined, authorizedWaiting = false;
let childRequests = 0;
client.subscribe(event => { if (event.type === 'side-chat-browser-authority' && event.kind === 'child') childRequests++; });
const bridge = new SideChatBrowserAuthorityBridge({ client, identity, cwd: '/fixture/a', sessions, sendStore,
  assertCurrent() { if (!current || !client.connected) throw new Error('Original page or connection changed.'); },
  freezeSending(owner) {
    if (senderFrozen || owner.hostId !== identity.hostId || owner.draftId !== identity.draftId || owner.threadId !== 'child-a') {
      throw new Error('Sender owner changed.');
    }
    senderFrozen = true;
    return { async drain() {}, assertCurrent() { if (!senderFrozen || !current || !client.connected) throw new Error('Sender lease lost.'); },
      release() { senderFrozen = false; } };
  },
  draftController: () => draft,
  async cleanupChild() { cleanupCount++; },
});
const host = (action: string, extra: Record<string, unknown> = {}) => client.host<SideChatHostView>('side-chat-fixture',
  { action, ...identity, ...extra }, { assertBeforeSend: () => bridge.assertAuthorized(action as 'start' | 'retry' | 'close') });
const port: SideChatHostPort = {
  async prepare(hostId, parentThreadId) {
    await bridge.initialize();
    return client.host('side-chat-fixture', { action: 'prepare', ...identity, hostId, parentThreadId });
  },
  async start(operationId) {
    if (pauseStart) { startWaiting = true; await new Promise<void>(resolve => { releaseStart = resolve; }); }
    await bridge.authorize('start', { forkDispatchId: 'attempt-a', isForkUnsent: () => !startSettled });
    if (pauseAfterAuthorize) { authorizedWaiting = true; await new Promise<void>(resolve => { releaseAuthorized = resolve; }); }
    try { return await host('start', { operationId, forkDispatchId: 'attempt-a' }); }
    finally { startSettled = true; }
  },
  async read(operationId, purpose) { return client.host('side-chat-fixture', { action: 'read', ...identity, operationId, purpose }); },
  async retry(operationId) { await bridge.revoke(); await bridge.authorize('retry'); return host('retry', { operationId }); },
  async close(operationId) { await bridge.revoke(); await bridge.authorize('close'); return host('close', { operationId }); },
  async retryPersistence(operationId) { return client.host('side-chat-fixture', { action: 'read', ...identity, operationId }); },
  subscribe(listener) { return client.subscribe(event => {
    if (event.type === 'side-chat-updated' && typeof event.hostId === 'string' && typeof event.operationId === 'string') {
      listener({ hostId: event.hostId, operationId: event.operationId });
    }
  }); },
};
const controller = new SideChatController({ ...identity, port, canDispatch: () => true,
  onPrepared: scope => bridge.linkPrepared(scope, 'generation-a', '/fixture/a') });
let observer: SideChatController | null = null;
const root = createRoot(document.getElementById('root')!);
const fixture = {
  identity, controller, bridge, sessions, sendStore,
  async connect() { await client.connect(); },
  async start() { await controller.start(); },
  restoreObserver(view: SideChatHostView) {
    observer = new SideChatController({ ...identity, port, restored: view, canDispatch: () => false, onPrepared: async () => {} });
  },
  observerPhase() { return observer?.getSnapshot().phase; },
  setPauseStart(value: boolean) { pauseStart = value; },
  get startWaiting() { return startWaiting; },
  releaseStart() { releaseStart?.(); },
  setPauseAfterAuthorize(value: boolean) { pauseAfterAuthorize = value; },
  get authorizedWaiting() { return authorizedWaiting; },
  get childRequests() { return childRequests; },
  releaseAuthorized() { releaseAuthorized?.(); },
  async recoverChild() {
    const view = controller.getSnapshot().view;
    if (!view) throw new Error('No original view.');
    await bridge.recoverChild(view, () => { if (!startSettled) throw new Error('Original call is not settled.'); });
  },
  async retry() { await controller.retry(); },
  mount() {
    root.render(React.createElement(StandaloneComposer, { client,
      context: { hostId: identity.hostId, threadId: 'child-a', draftId: identity.draftId, cwd: '/fixture/a', placement: 'side-chat' },
      busy: false, initialOptions: { model: 'model', effort: null, approvalPolicy: 'on-request', approvalsReviewer: 'user', sandboxMode: 'read-only' },
      onDraftController(value: ComposerDraftController | null) { draft = value; }, async onSubmit() {}, async onInterrupt() {} }));
  },
  snapshot() { return draft?.snapshot() ?? null; },
  history() { return sessions.view({ hostId: 'host-a', threadId: 'child-a' }).snapshot(); },
  association() { return readSideChatDraftAssociation(identity); },
  async freeze() { await bridge.freezeClose(); },
  async close() { await controller.close(); },
  async revoke() { await bridge.revoke(); },
  disposeBridge() { bridge.dispose(); },
  async authorize() { await bridge.authorize('start', { forkDispatchId: 'attempt-a', isForkUnsent: () => true }); },
  async claimExisting() {
    await bridge.initialize();
    await bridge.linkPrepared({ hostId: identity.hostId, parentThreadId: identity.parentThreadId, draftId: identity.draftId,
      operationId: 'operation-a' }, 'generation-a', '/fixture/a');
    await bridge.authorize('start', { forkDispatchId: 'attempt-a', isForkUnsent: () => true });
  },
  async pendingSend() {
    const snapshot = draft?.snapshot();
    if (!snapshot) throw new Error('Draft not mounted.');
    return sendStore.prepare({ owner: snapshot.owner, revision: snapshot.revision }, '/fixture/a', snapshot.draft, {}, {});
  },
  async cancelSend(id: string) { await sendStore.cancel(id); },
  senderFrozen() { return senderFrozen; },
  cleanupCount() { return cleanupCount; },
  disconnect() { current = false; client.suspend(); },
  async initializeRoot() { await readBrowserAtoms(); },
  failWrite(number = 1) {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if (--number > 0) return original.apply(this, args);
      IDBObjectStore.prototype.put = original;
      throw new Error('Synthetic IDB write failure.');
    };
    return () => { IDBObjectStore.prototype.put = original; };
  },
  failNextRead() {
    const original = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (...args: Parameters<IDBObjectStore['get']>) {
      IDBObjectStore.prototype.get = original;
      throw new Error('Synthetic IDB read failure.');
    };
    return () => { IDBObjectStore.prototype.get = original; };
  },
  async markUnavailable() { await bridge.revoke(); current = false; },
  async closeFixture() { controller.dispose(); bridge.dispose(); sessions.dispose(); client.suspend(); root.unmount(); },
};
(window as unknown as { sideChatAuthorityFixture: typeof fixture }).sideChatAuthorityFixture = fixture;
