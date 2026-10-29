import { randomUUID } from 'node:crypto';
import type WebSocket from 'ws';
import type { SideChatEndpointScope } from './side-chat-host.ts';
import type { SideChatAuthorityChallenge, SideChatAuthorityRequest, SideChatBrowserIdentity } from '../renderer/side-chat/browser-authority.ts';
import type { SideChatHostAction, SideChatHostView } from '../renderer/side-chat/types.ts';

type Value = Record<string, unknown>;
export interface SideChatBrowserScope extends SideChatEndpointScope {
  page: WebSocket;
  draftId: string;
  action: SideChatHostAction;
}
export interface SideChatBrowserCheck extends SideChatBrowserScope {
  phase: 'claim' | 'fork' | 'inject' | 'unsubscribe';
  attemptId?: string;
}
export interface SideChatBrowserOrigin {
  page: WebSocket;
  identity: SideChatBrowserIdentity;
  action: SideChatHostAction;
  phase: 'challenge' | 'confirm' | 'claim' | 'fork' | 'inject' | 'unsubscribe' | 'child' | 'close' | 'cleanup' | 'respond';
  attemptId?: string;
}
export interface SideChatNativeBrowserAuthorityOptions {
  /** Check the original page, socket/generation, prepare index, operation, draft and applicable claim. */
  assertOrigin(scope: SideChatBrowserOrigin): void;
  /** Send only to the original open page; throw if the event could not be sent. */
  notify(page: WebSocket, request: SideChatAuthorityRequest): void;
  /** True only with external proof that the old process and all its observers stopped. */
  ownerStopped?(ownerId: string): boolean;
  requestTimeoutMs?: number;
}
interface Grant {
  page: WebSocket;
  challenge: SideChatAuthorityChallenge;
  confirmed: boolean;
  suspended: boolean;
  closeReady: boolean;
}
interface Pending {
  grant: Grant;
  request: SideChatAuthorityRequest;
  resolve(): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}
const object = (value: unknown): value is Value => !!value && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && value.length <= 512 && !value.includes('\0');
const actions: SideChatHostAction[] = ['start', 'retry', 'close', 'retryPersistence'];
const sameIdentity = (a: SideChatBrowserIdentity, b: SideChatBrowserIdentity) => a.hostId === b.hostId
  && a.parentThreadId === b.parentThreadId && a.draftId === b.draftId && a.prepareId === b.prepareId
  && a.operationId === b.operationId && a.parentCwd === b.parentCwd && a.connectionGeneration === b.connectionGeneration
  && a.childThreadId === b.childThreadId;
function validIdentity(value: unknown): value is SideChatBrowserIdentity {
  return object(value) && id(value.hostId) && id(value.parentThreadId) && id(value.draftId) && id(value.prepareId)
    && id(value.operationId) && id(value.parentCwd) && id(value.connectionGeneration)
    && (value.childThreadId === null || id(value.childThreadId) && value.childThreadId !== value.parentThreadId);
}
function unavailable(): Error { return new Error('原侧聊浏览器关联或关闭屏障未确认。'); }

/** Only active page-scoped confirmations are kept here; operations remain in native-state. */
export function createSideChatNativeBrowserAuthority(options: SideChatNativeBrowserAuthorityOptions) {
  const grants = new Map<string, Grant>();
  const pending = new Map<string, Pending>();
  const timeout = options.requestTimeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeout) || timeout <= 0) throw new Error('侧聊浏览器确认超时无效。');

  function current(grant: Grant, phase: SideChatBrowserOrigin['phase'], identity = grant.challenge.identity, attemptId?: string): void {
    if (grant.page.readyState !== 1 || grants.get(identity.operationId) !== grant) throw unavailable();
    options.assertOrigin({ page: grant.page, identity, action: grant.challenge.action, phase, ...(attemptId ? { attemptId } : {}) });
  }
  function discard(grant: Grant): void {
    if (grants.get(grant.challenge.identity.operationId) === grant) grants.delete(grant.challenge.identity.operationId);
    for (const [requestId, item] of pending) if (item.grant === grant) {
      pending.delete(requestId); clearTimeout(item.timer); item.reject(unavailable());
    }
  }
  function checked(scope: SideChatBrowserScope, phase: SideChatBrowserOrigin['phase'], attemptId?: string): Grant {
    const grant = grants.get(scope.operationId), identity = grant?.challenge.identity;
    if (!grant || !identity || !grant.confirmed || grant.suspended || grant.page !== scope.page
      || identity.hostId !== scope.hostId || identity.parentThreadId !== scope.parentThreadId
      || identity.draftId !== scope.draftId || identity.connectionGeneration !== scope.connectionGeneration
      || identity.childThreadId !== scope.childThreadId || grant.challenge.action !== scope.action) throw unavailable();
    current(grant, phase, identity, attemptId);
    return grant;
  }
  function assertCurrent(scope: SideChatBrowserCheck): void {
    const grant = checked(scope, scope.phase, scope.attemptId);
    if (scope.phase === 'fork' && (!scope.attemptId || scope.childThreadId !== null
      || grant.challenge.forkDispatchId !== scope.attemptId)) throw unavailable();
    if (scope.phase === 'inject' && !scope.childThreadId) throw unavailable();
    if (scope.phase === 'unsubscribe' && (!scope.childThreadId || !grant.closeReady)) throw unavailable();
  }
  function ask(grant: Grant, kind: SideChatAuthorityRequest['kind'], identity: SideChatBrowserIdentity,
    view?: SideChatHostView): Promise<void> {
    if ([...pending.values()].some(item => item.grant === grant)) throw unavailable();
    const request: SideChatAuthorityRequest = { type: 'side-chat-browser-authority', requestId: randomUUID(),
      challengeId: grant.challenge.challengeId, kind, identity: structuredClone(identity), ...(view ? { view: structuredClone(view) } : {}) };
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(request.requestId); reject(unavailable());
      }, timeout);
      timer.unref?.();
      pending.set(request.requestId, { grant, request, resolve, reject, timer });
      try { options.notify(grant.page, request); }
      catch { pending.delete(request.requestId); clearTimeout(timer); reject(unavailable()); }
    });
  }

  /** Called outside StateMutations after the original fork receipt is durably recorded and before inject. */
  async function prepareChild(scope: SideChatBrowserScope & { childThreadId: string }, view: SideChatHostView): Promise<void> {
    const grant = grants.get(scope.operationId), old = grant?.challenge.identity;
    if (!grant || !old || !grant.confirmed || grant.suspended || grant.page !== scope.page
      || old.hostId !== scope.hostId || old.parentThreadId !== scope.parentThreadId || old.draftId !== scope.draftId
      || old.connectionGeneration !== scope.connectionGeneration || grant.challenge.action !== scope.action
      || !['start', 'retry', 'retryPersistence'].includes(scope.action)
      || !view || view.operationId !== old.operationId || view.parent.hostId !== old.hostId || view.parent.threadId !== old.parentThreadId
      || view.parent.cwd !== old.parentCwd || view.childId !== scope.childThreadId || view.child?.thread.id !== scope.childThreadId
      || view.child.thread.ephemeral !== true || view.child.thread.forkedFromId !== old.parentThreadId
      || view.fork.status !== 'received' || view.fork.receipt?.connectionGeneration !== old.connectionGeneration
      || !Number.isSafeInteger(view.fork.receipt.eventCursor) || view.fork.receipt.eventCursor < 0) throw unavailable();
    if (old.childThreadId !== null) {
      if (old.childThreadId !== scope.childThreadId) throw unavailable();
      current(grant, 'child');
      return;
    }
    if (!['start', 'retry'].includes(scope.action) || !grant.challenge.forkDispatchId
      || view.fork.receipt.attemptId !== grant.challenge.forkDispatchId) throw unavailable();
    const next = { ...old, childThreadId: scope.childThreadId };
    current(grant, 'child', next, grant.challenge.forkDispatchId);
    grant.suspended = true;
    await ask(grant, 'child', next, view);
    current(grant, 'child', next, grant.challenge.forkDispatchId);
    grant.challenge.identity = next;
    grant.suspended = false;
  }
  async function prepareClose(scope: SideChatBrowserScope & { childThreadId: string }): Promise<void> {
    const grant = checked(scope, 'close');
    grant.closeReady = false;
    await ask(grant, 'close', grant.challenge.identity);
    checked(scope, 'close');
    grant.closeReady = true;
  }
  async function cleanup(scope: SideChatBrowserScope & { childThreadId: string }): Promise<void> {
    const grant = checked(scope, 'cleanup');
    if (!grant.closeReady) throw unavailable();
    await ask(grant, 'cleanup', grant.challenge.identity);
    checked(scope, 'cleanup');
    discard(grant);
  }
  function ownerStopped(ownerId: string): boolean {
    if (!id(ownerId) || !options.ownerStopped) return false;
    try { return options.ownerStopped(ownerId) === true; } catch { return false; }
  }

  /** Call synchronously from the original page's host-message handler. */
  function handle(page: WebSocket, body: unknown): unknown {
    if (!object(body) || !id(body.action) || page.readyState !== 1) throw unavailable();
    if (body.action === 'challenge') {
      if (!id(body.registrationId) || !validIdentity(body.identity) || !actions.includes(body.command as SideChatHostAction)
        || body.forkDispatchId !== undefined && (!id(body.forkDispatchId) || body.identity.childThreadId !== null
          || !['start', 'retry'].includes(String(body.command)))) throw unavailable();
      const identity = structuredClone(body.identity), action = body.command as SideChatHostAction;
      if (grants.has(identity.operationId)) throw unavailable();
      options.assertOrigin({ page, identity, action, phase: 'challenge' });
      const challenge: SideChatAuthorityChallenge = { registrationId: body.registrationId, challengeId: randomUUID(), identity, action,
        ...(typeof body.forkDispatchId === 'string' ? { forkDispatchId: body.forkDispatchId } : {}) };
      grants.set(identity.operationId, { page, challenge, confirmed: false, suspended: false, closeReady: false });
      return structuredClone(challenge);
    }
    if (body.action === 'confirm') {
      if (!id(body.registrationId) || !id(body.challengeId)) throw unavailable();
      const grant = [...grants.values()].find(value => value.challenge.registrationId === body.registrationId
        && value.challenge.challengeId === body.challengeId && value.page === page);
      if (!grant || grant.confirmed || grant.suspended) throw unavailable();
      current(grant, 'confirm');
      grant.confirmed = true;
      return { confirmed: true };
    }
    if (body.action === 'revoke') {
      if (!id(body.operationId) || !id(body.registrationId)) throw unavailable();
      const grant = grants.get(body.operationId);
      if (grant && (grant.page !== page || grant.challenge.registrationId !== body.registrationId)) throw unavailable();
      if (grant) discard(grant);
      return { revoked: true };
    }
    if (body.action === 'respond') {
      if (!id(body.requestId) || !id(body.challengeId) || !['ready', 'failed'].includes(String(body.outcome))) throw unavailable();
      const item = pending.get(body.requestId);
      if (!item || item.grant.page !== page || item.grant.challenge.challengeId !== body.challengeId) throw unavailable();
      current(item.grant, 'respond', item.request.identity);
      pending.delete(body.requestId); clearTimeout(item.timer);
      if (body.outcome === 'ready') item.resolve(); else item.reject(unavailable());
      return { received: true };
    }
    throw unavailable();
  }
  /** Called by the host before a page, host connection or generation is replaced. */
  function invalidate(page: WebSocket, hostId?: string): void {
    for (const grant of grants.values()) if (grant.page === page && (hostId === undefined || grant.challenge.identity.hostId === hostId)) discard(grant);
  }
  return { handle, invalidate, assertCurrent, prepareChild, prepareClose, cleanup, ownerStopped };
}
