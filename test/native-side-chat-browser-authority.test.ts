import assert from 'node:assert/strict';
import test from 'node:test';
import type WebSocket from 'ws';
import { createSideChatNativeBrowserAuthority } from '../src/native/side-chat-browser-authority.ts';
import type { SideChatBrowserCheck, SideChatBrowserScope } from '../src/native/side-chat-browser-authority.ts';
import type { SideChatAuthorityChallenge, SideChatAuthorityRequest, SideChatBrowserIdentity } from '../src/renderer/side-chat/browser-authority.ts';
import type { SideChatHostView } from '../src/renderer/side-chat/types.ts';

const original: SideChatBrowserIdentity = { hostId: 'host-a', parentThreadId: 'parent-a', draftId: 'draft-a', prepareId: 'prepare-a',
  operationId: 'operation-a', parentCwd: '/fixture/a', connectionGeneration: 'generation-a', childThreadId: null };
function view(): SideChatHostView {
  return { operationId: original.operationId, parent: { hostId: original.hostId, threadId: original.parentThreadId, cwd: original.parentCwd },
    childId: 'child-a', child: { thread: { id: 'child-a', name: null, cwd: original.parentCwd, turns: [],
      status: { type: 'idle' }, ephemeral: true, forkedFromId: original.parentThreadId },
    options: { model: 'model', effort: null, approvalPolicy: 'on-request', approvalsReviewer: 'user', sandboxMode: 'read-only', serviceTier: null },
    modelProvider: 'fixture', sandbox: { type: 'readOnly', networkAccess: false }, activePermissionProfile: null, runtimeWorkspaceRoots: [original.parentCwd] },
    fork: { status: 'received', error: null, receipt: { connectionGeneration: original.connectionGeneration, attemptId: 'attempt-a', eventCursor: 8 } },
    inject: { status: 'waiting', error: null }, close: { requested: false, status: 'idle', error: null }, recoveryError: null };
}
function fixture() {
  const page = { readyState: 1 } as WebSocket, other = { readyState: 1 } as WebSocket;
  const requests: SideChatAuthorityRequest[] = [];
  let valid = true, knownChild: string | null = null;
  const authority = createSideChatNativeBrowserAuthority({ requestTimeoutMs: 1000,
    assertOrigin(scope) {
      if (!valid || scope.page !== page || scope.identity.hostId !== original.hostId || scope.identity.parentThreadId !== original.parentThreadId
        || scope.identity.operationId !== original.operationId || scope.identity.draftId !== original.draftId
        || scope.identity.prepareId !== original.prepareId || scope.identity.connectionGeneration !== original.connectionGeneration
        || scope.identity.parentCwd !== original.parentCwd || scope.identity.childThreadId !== knownChild) throw Error('not original');
    }, notify(_page, event) { requests.push(event); },
  });
  const scope = (action: SideChatBrowserScope['action'], childThreadId: string | null = knownChild): SideChatBrowserScope => ({ page,
    hostId: original.hostId, parentThreadId: original.parentThreadId, operationId: original.operationId,
    draftId: original.draftId, connectionGeneration: original.connectionGeneration, childThreadId, action });
  const challenge = (action: SideChatBrowserScope['action'] = 'start', identity = original, forkDispatchId?: string) =>
    authority.handle(page, { action: 'challenge', registrationId: 'reg-' + action, identity, command: action,
      ...(forkDispatchId ? { forkDispatchId } : {}) }) as SideChatAuthorityChallenge;
  const confirm = (value: SideChatAuthorityChallenge, source = page) => authority.handle(source,
    { action: 'confirm', registrationId: value.registrationId, challengeId: value.challengeId });
  const respond = (request: SideChatAuthorityRequest, outcome = 'ready', source = page) => authority.handle(source,
    { action: 'respond', requestId: request.requestId, challengeId: request.challengeId, outcome });
  const check = (value: SideChatBrowserCheck) => authority.assertCurrent(value);
  return { authority, page, other, requests, scope, challenge, confirm, respond, check,
    setValid(value: boolean) { valid = value; }, setChild(value: string | null) { knownChild = value; } };
}

test('only the original page can confirm one challenge and dispatch the matching action and fork attempt', () => {
  const f = fixture(), grant = f.challenge('start', original, 'attempt-a');
  const fork: SideChatBrowserCheck = { ...f.scope('start'), phase: 'fork', attemptId: 'attempt-a' };
  assert.throws(() => f.check(fork));
  assert.throws(() => f.confirm(grant, f.other));
  f.confirm(grant);
  assert.throws(() => f.confirm(grant));
  f.check({ ...f.scope('start'), phase: 'claim' }); f.check(fork);
  assert.throws(() => f.check({ ...fork, attemptId: 'different' }));
  assert.throws(() => f.check({ ...fork, connectionGeneration: 'generation-b' }));
  assert.throws(() => f.check({ ...fork, page: f.other }));
  assert.throws(() => f.check({ ...fork, action: 'retry' }));
  assert.throws(() => f.challenge('start', original, 'attempt-b'));
  f.setValid(false);
  assert.throws(() => f.check(fork));
});

test('child confirmation suspends injection until the original request is answered, and validates its receipt', async () => {
  const f = fixture(), grant = f.challenge('start', original, 'attempt-a'); f.confirm(grant);
  f.setChild('child-a');
  const scope = { ...f.scope('start'), childThreadId: 'child-a' };
  const wrong = view(); wrong.fork.receipt!.attemptId = 'other-attempt';
  await assert.rejects(f.authority.prepareChild(scope, wrong));
  const pending = f.authority.prepareChild(scope, view()), request = f.requests[0]!;
  assert.equal(request.kind, 'child');
  assert.throws(() => f.check({ ...scope, phase: 'inject', attemptId: 'inject-1' }));
  assert.throws(() => f.respond(request, 'ready', f.other));
  f.respond(request); await pending;
  f.check({ ...scope, phase: 'inject', attemptId: 'inject-1' });
  await f.authority.prepareChild(scope, view());
  assert.equal(f.requests.length, 1);
  assert.throws(() => f.respond(request));
});

test('revocation rejects pending child and late confirmation, without transferring the original page', async () => {
  const f = fixture(), grant = f.challenge('start', original, 'attempt-a'); f.confirm(grant); f.setChild('child-a');
  const scope = { ...f.scope('start'), childThreadId: 'child-a' }, pending = f.authority.prepareChild(scope, view());
  const request = f.requests[0]!;
  f.authority.handle(f.page, { action: 'revoke', operationId: original.operationId, registrationId: grant.registrationId });
  await assert.rejects(pending);
  assert.throws(() => f.respond(request));
  assert.throws(() => f.check({ ...scope, phase: 'inject' }));
  assert.throws(() => f.authority.handle(f.other, { action: 'challenge', registrationId: 'foreign', identity: { ...original, childThreadId: 'child-a' }, command: 'retry' }));
  assert.deepEqual(f.authority.handle(f.page, { action: 'revoke', operationId: original.operationId, registrationId: grant.registrationId }), { revoked: true });
});

test('close requires the original child lease and cleanup, and disconnect rejects a waiting acknowledgement', async () => {
  const f = fixture(); f.setChild('child-a');
  const identity = { ...original, childThreadId: 'child-a' }, grant = f.challenge('close', identity); f.confirm(grant);
  const scope = { ...f.scope('close'), childThreadId: 'child-a' };
  f.check({ ...scope, phase: 'claim' });
  assert.throws(() => f.check({ ...scope, phase: 'unsubscribe' }));
  const barrier = f.authority.prepareClose(scope), close = f.requests[0]!;
  assert.equal(close.kind, 'close'); f.respond(close); await barrier;
  f.check({ ...scope, phase: 'unsubscribe' });
  const cleanup = f.authority.cleanup(scope), cleanupRequest = f.requests[1]!;
  assert.equal(cleanupRequest.kind, 'cleanup'); f.respond(cleanupRequest); await cleanup;
  assert.throws(() => f.check({ ...scope, phase: 'unsubscribe' }));
  const next = f.challenge('close', identity); f.confirm(next);
  const lost = f.authority.prepareClose(scope), late = f.requests[2]!;
  f.authority.invalidate(f.page, original.hostId);
  await assert.rejects(lost);
  assert.throws(() => f.respond(late));
  assert.equal(f.authority.ownerStopped('old-process'), false);
});

test('failed browser preparation never unlocks unsubscribe and owner stop needs an explicit host proof', async () => {
  const f = fixture(); f.setChild('child-a');
  const grant = f.challenge('close', { ...original, childThreadId: 'child-a' }); f.confirm(grant);
  const scope = { ...f.scope('close'), childThreadId: 'child-a' };
  const barrier = f.authority.prepareClose(scope); f.respond(f.requests[0]!, 'failed');
  await assert.rejects(barrier);
  assert.throws(() => f.check({ ...scope, phase: 'unsubscribe' }));
  const proof = createSideChatNativeBrowserAuthority({ assertOrigin() {}, notify() {}, ownerStopped: id => id === 'observed-stopped' });
  assert.equal(proof.ownerStopped('observed-stopped'), true);
  assert.equal(proof.ownerStopped('different'), false);
});
