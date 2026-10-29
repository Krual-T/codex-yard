import { SendRecoveryStore, sendsAtom } from '../app/send-recovery.ts';
import { ConversationSessions } from '../app/conversation-sessions.ts';
import type { EphemeralForkCapture, EphemeralForkScope } from '../app/conversation-sessions.ts';
import { composerDraftAtomKey, openComposerDraft, readComposerDraft,
  readComposerDraftVersionsInRoot, sameComposerDraftValue } from '../composer/composer-draft-store.ts';
import type { ComposerDraftOwner } from '../composer/composer-draft-store.ts';
import type { ComposerDraftController, ComposerDraftLease } from '../composer/use-composer-draft.ts';
import { draftKey } from '../composer/standalone-draft.ts';
import type { StoredDraft } from '../composer/standalone-draft.ts';
import { readBrowserAtoms, updateBrowserAtoms } from '../storage/ui-atoms.ts';
import type { WorkbenchClient, WorkbenchEvent } from '../workbench-contract.ts';
import type { SideChatHostAction, SideChatHostView, SideChatScope } from './types.ts';

export interface SideChatDraftIdentity {
  hostId: string;
  parentThreadId: string;
  draftId: string;
  prepareId: string;
}
export interface SideChatBrowserIdentity extends SideChatDraftIdentity {
  operationId: string;
  parentCwd: string;
  connectionGeneration: string;
  childThreadId: string | null;
}
export interface SideChatDraftAssociation extends SideChatDraftIdentity {
  version: 1;
  operationId: string | null;
  parentCwd: string | null;
  connectionGeneration: string | null;
  childThreadId: string | null;
}
export interface SideChatAuthorityChallenge {
  registrationId: string;
  challengeId: string;
  identity: SideChatBrowserIdentity;
  action: SideChatHostAction;
  forkDispatchId?: string;
}
export interface SideChatAuthorityRequest {
  type: 'side-chat-browser-authority';
  requestId: string;
  challengeId: string;
  kind: 'child' | 'close' | 'cleanup';
  identity: SideChatBrowserIdentity;
  view?: SideChatHostView;
}

/** The parent synchronously blocks new sends and owner attachment before draining. */
export interface SideChatSendLease {
  drain(): Promise<void>;
  assertCurrent(): void;
  release(): void;
}
export interface SideChatBrowserAuthorityOptions {
  client: WorkbenchClient;
  identity: SideChatDraftIdentity;
  cwd: string;
  sessions: ConversationSessions;
  sendStore: SendRecoveryStore;
  /** Throws if the captured page, host, parent, owner or connection has changed. */
  assertCurrent(): void;
  freezeSending(owner: ComposerDraftOwner): SideChatSendLease;
  draftController(): ComposerDraftController | null;
  /** Idempotent local/voice cleanup; never calls thread/unsubscribe. */
  cleanupChild(identity: SideChatBrowserIdentity): Promise<void>;
}

type Value = Record<string, unknown>;
const object = (value: unknown): value is Value => !!value && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && value.length <= 512 && !value.includes('\0');
const sameDraft = (a: SideChatDraftIdentity, b: SideChatDraftIdentity) => a.hostId === b.hostId && a.parentThreadId === b.parentThreadId
  && a.draftId === b.draftId && a.prepareId === b.prepareId;
const sameIdentity = (a: SideChatBrowserIdentity, b: SideChatBrowserIdentity) => sameDraft(a, b)
  && a.operationId === b.operationId && a.parentCwd === b.parentCwd && a.connectionGeneration === b.connectionGeneration
  && a.childThreadId === b.childThreadId;
const ownerOf = (identity: SideChatDraftIdentity, threadId: string | null): ComposerDraftOwner =>
  ({ hostId: identity.hostId, threadId, draftId: identity.draftId });
const keyOf = (identity: SideChatDraftIdentity) => draftKey({ ...ownerOf(identity, null), cwd: '' });
const beforeSend = (error: string) => Object.assign(new Error(error), { uncertain: false as const });

function validDraftIdentity(value: SideChatDraftIdentity): boolean {
  return !!value && id(value.hostId) && id(value.parentThreadId) && id(value.draftId) && id(value.prepareId);
}
function association(value: unknown): SideChatDraftAssociation {
  if (!object(value) || value.version !== 1 || !validDraftIdentity(value as unknown as SideChatDraftIdentity)
    || !(value.operationId === null || id(value.operationId)) || !(value.parentCwd === null || id(value.parentCwd))
    || !(value.connectionGeneration === null || id(value.connectionGeneration)) || !(value.childThreadId === null || id(value.childThreadId))
    || (value.operationId === null) !== (value.parentCwd === null) || (value.operationId === null) !== (value.connectionGeneration === null)
    || value.operationId === null && value.childThreadId !== null || value.childThreadId === value.parentThreadId) {
    throw new Error('侧聊草稿关联无法识别；原记录已保留。');
  }
  return structuredClone(value) as unknown as SideChatDraftAssociation;
}
function entryAt(raw: unknown, identity: SideChatDraftIdentity): { root: Value; entries: Value; entry: Value } {
  readComposerDraftVersionsInRoot(raw, ownerOf(identity, null));
  if (!object(raw) || !object(raw.entries) || !object(raw.entries[keyOf(identity)])) {
    throw new Error('侧聊原草稿尚未初始化。');
  }
  return { root: raw, entries: raw.entries, entry: raw.entries[keyOf(identity)] as Value };
}
function assertAssociation(raw: unknown, expected: SideChatDraftAssociation): void {
  const { entry } = entryAt(raw, expected), saved = association(entry.sideChat);
  if (!sameDraft(saved, expected) || saved.operationId !== expected.operationId || saved.parentCwd !== expected.parentCwd
    || saved.connectionGeneration !== expected.connectionGeneration || saved.childThreadId !== expected.childThreadId
    || (entry.createdThreadId ?? null) !== expected.childThreadId
    || !readComposerDraftVersionsInRoot(raw, ownerOf(expected, expected.childThreadId)).versions.length) {
    throw new Error('侧聊草稿、准备操作或子会话关联已改变。');
  }
}
function asAssociation(value: SideChatBrowserIdentity): SideChatDraftAssociation {
  return { version: 1, ...value };
}

/** Read existing metadata only. This never transfers an old page's dispatch authority. */
export async function readSideChatDraftAssociation(identity: SideChatDraftIdentity): Promise<SideChatDraftAssociation | null> {
  if (!validDraftIdentity(identity)) throw new Error('侧聊草稿身份不完整。');
  return updateBrowserAtoms(atoms => {
    const raw = atoms[composerDraftAtomKey];
    if (raw === undefined) return { value: null };
    readComposerDraftVersionsInRoot(raw, ownerOf(identity, null));
    if (!object(raw) || !object(raw.entries) || !object(raw.entries[keyOf(identity)])) return { value: null };
    const entry = raw.entries[keyOf(identity)] as Value;
    if (entry.sideChat === undefined) return { value: null };
    const saved = association(entry.sideChat);
    if (!sameDraft(saved, identity)) throw new Error('此草稿已关联另一侧聊；原记录已保留。');
    assertAssociation(raw, saved);
    return { value: saved };
  });
}

/** One instance belongs to the original page and one side-chat draft. */
export class SideChatBrowserAuthorityBridge {
  private identity: SideChatBrowserIdentity | null = null;
  private grant: SideChatAuthorityChallenge | null = null;
  private capture: { token: EphemeralForkCapture; scope: EphemeralForkScope } | null = null;
  private closeLease: { draft: ComposerDraftController | null; draftLease: ComposerDraftLease | null; send: SideChatSendLease } | null = null;
  private invalid = false;
  private sealed = false;
  private authorizing = false;
  private revoking = false;
  private childLive = false;
  private epoch = 0;
  private registration: { operationId: string; registrationId: string } | null = null;
  private bootstrap: StoredDraft | null = null;
  private bridgeConnected: boolean;
  private hostConnected = false;
  private readonly unwatch: () => void;
  private readonly options: SideChatBrowserAuthorityOptions;

  constructor(options: SideChatBrowserAuthorityOptions) {
    if (!validDraftIdentity(options.identity) || !id(options.cwd) || !(options.sessions instanceof ConversationSessions)
      || !(options.sendStore instanceof SendRecoveryStore)) throw new Error('侧聊原草稿或共享会话身份不完整。');
    this.options = { ...options, identity: { ...options.identity } };
    this.bridgeConnected = 'connected' in options.client && options.client.connected === true;
    this.unwatch = options.client.subscribe(event => this.event(event));
  }
  private assertCurrent = (): void => {
    if (this.invalid || this.sealed) throw beforeSend('侧聊原页面或草稿权限已失效。');
    this.options.assertCurrent();
  };
  private async verify(expected: SideChatDraftAssociation, guard = this.assertCurrent): Promise<void> {
    await updateBrowserAtoms(atoms => { guard(); assertAssociation(atoms[composerDraftAtomKey], expected); return { value: undefined }; });
    guard();
  }
  private request<T>(body: Value, guard = this.assertCurrent): Promise<T> {
    return this.options.client.host<T>('side-chat-browser-authority', body, { assertBeforeSend: guard });
  }

  /** Persist the original prepare ID before sending prepare. */
  async initialize(): Promise<void> {
    this.assertCurrent();
    const identity = this.options.identity, prior = await readSideChatDraftAssociation(identity);
    this.assertCurrent();
    if (prior) return;
    const existing = await readBrowserAtoms();
    const raw = existing[composerDraftAtomKey];
    const exists = object(raw) && object(raw.entries) && Object.hasOwn(raw.entries, keyOf(identity));
    if (exists && !this.bootstrap) {
      throw new Error('此草稿已有其他身份，不能创建侧聊关联。');
    }
    if (!exists) {
      const opened = await openComposerDraft({ ...ownerOf(identity, null), cwd: this.options.cwd, placement: 'side-chat' }, existing,
        () => { try { this.assertCurrent(); return true; } catch { return false; } });
      if (opened.versions.length !== 1 || opened.retained.length) throw new Error('侧聊新草稿的原身份无法确认。');
      this.bootstrap = structuredClone(opened.versions[0]!);
    }
    await updateBrowserAtoms(atoms => {
      this.assertCurrent();
      const { root, entries, entry } = entryAt(atoms[composerDraftAtomKey], identity);
      if (entry.sideChat !== undefined) {
        const current = association(entry.sideChat);
        if (!sameDraft(current, identity) || current.operationId !== null) throw new Error('此草稿已关联另一侧聊。');
        return { value: undefined };
      }
      const versions = readComposerDraftVersionsInRoot(root, ownerOf(identity, null));
      if (!this.bootstrap || entry.createdThreadId !== undefined || versions.versions.length !== 1 || versions.retained.length
        || versions.versions[0]!.revision !== this.bootstrap.revision
        || !sameComposerDraftValue(versions.versions[0], this.bootstrap)) {
        throw new Error('侧聊原草稿身份已改变。');
      }
      const saved: SideChatDraftAssociation = { version: 1, ...identity, operationId: null, parentCwd: null, connectionGeneration: null, childThreadId: null };
      return { value: undefined, updates: { [composerDraftAtomKey]: { ...root, entries: { ...entries, [keyOf(identity)]: { ...entry, sideChat: saved } } } } };
    });
    this.assertCurrent();
    this.bootstrap = null;
  }

  /** Use from Controller.onPrepared, with the generation and cwd from the original host reply. */
  async linkPrepared(scope: SideChatScope, connectionGeneration: string, parentCwd: string): Promise<void> {
    const origin = this.options.identity;
    if (scope.hostId !== origin.hostId || scope.parentThreadId !== origin.parentThreadId || scope.draftId !== origin.draftId
      || !id(scope.operationId) || !id(connectionGeneration) || !id(parentCwd) || parentCwd !== this.options.cwd) {
      throw new Error('侧聊准备回执与原草稿或父会话不一致。');
    }
    const next: SideChatBrowserIdentity = { ...origin, operationId: scope.operationId, connectionGeneration, parentCwd, childThreadId: null };
    await updateBrowserAtoms(atoms => {
      this.assertCurrent();
      const { root, entries, entry } = entryAt(atoms[composerDraftAtomKey], origin), previous = association(entry.sideChat);
      if (!sameDraft(previous, origin) || previous.childThreadId !== null || entry.createdThreadId !== undefined
        || previous.operationId !== null && (previous.operationId !== next.operationId || previous.connectionGeneration !== connectionGeneration
          || previous.parentCwd !== parentCwd)) throw new Error('侧聊准备关联已改变；原记录已保留。');
      return { value: undefined, updates: { [composerDraftAtomKey]: { ...root, entries: {
        ...entries, [keyOf(origin)]: { ...entry, sideChat: { ...previous, ...asAssociation(next) } },
      } } } };
    });
    this.assertCurrent();
    await this.verify(asAssociation(next));
    this.identity = next;
  }

  /** Capture the actual event stream before a fork, then complete the IDB/native challenge. */
  async authorize(action: SideChatHostAction, fork?: { forkDispatchId: string; isForkUnsent(): boolean }): Promise<void> {
    this.assertCurrent();
    if (!this.identity || this.authorizing || this.revoking || this.registration || this.grant) throw beforeSend('原侧聊权限尚未就绪或仍在使用。');
    if (this.identity.childThreadId && !this.childLive && action !== 'close') {
      throw beforeSend('原侧聊事件流尚未确认，不能继续派发。');
    }
    if (fork && (!id(fork.forkDispatchId) || this.identity.childThreadId !== null || !['start', 'retry'].includes(action))) {
      throw beforeSend('侧聊 fork 身份无效。');
    }
    this.authorizing = true;
    const identity = structuredClone(this.identity), registrationId = crypto.randomUUID();
    const epoch = this.epoch;
    const guard = () => { this.assertCurrent(); if (epoch !== this.epoch) throw beforeSend('原侧聊确认已撤销。'); };
    this.registration = { operationId: identity.operationId, registrationId };
    try {
      if (fork) {
        const scope: EphemeralForkScope = { hostId: identity.hostId, parentThreadId: identity.parentThreadId, parentCwd: identity.parentCwd,
          operationId: identity.operationId, connectionGeneration: identity.connectionGeneration, forkDispatchId: fork.forkDispatchId };
        const token = this.options.sessions.captureEphemeralFork(scope, { isCurrent: () => {
          try { this.assertCurrent(); return true; } catch { return false; }
        }, isForkUnsent: fork.isForkUnsent });
        this.capture = { token, scope };
      }
      const challenge = await this.request<SideChatAuthorityChallenge>({ action: 'challenge', registrationId, identity, command: action,
        ...(fork ? { forkDispatchId: fork.forkDispatchId } : {}) }, guard);
      guard();
      if (!challenge || challenge.registrationId !== registrationId || !id(challenge.challengeId)
        || !sameIdentity(challenge.identity, identity) || challenge.action !== action || challenge.forkDispatchId !== fork?.forkDispatchId) {
        throw new Error('宿主侧聊确认身份不匹配。');
      }
      await this.verify(asAssociation(identity), guard);
      const reply = await this.request<{ confirmed: boolean }>({ action: 'confirm', registrationId, challengeId: challenge.challengeId }, guard);
      if (reply?.confirmed !== true) throw new Error('宿主未确认原草稿关联。');
      guard();
      this.grant = challenge;
    } catch (error) {
      if (this.capture) { this.options.sessions.cancelEphemeralFork(this.capture.token); this.capture = null; }
      try {
        await this.request({ action: 'revoke', operationId: identity.operationId, registrationId }, () => this.options.assertCurrent());
      } catch { this.invalid = true; throw new Error('侧聊确认撤销结果未知；原记录已保留。'); }
      if (this.registration?.registrationId === registrationId) this.registration = null;
      throw error;
    } finally {
      this.authorizing = false;
    }
  }

  /** Await this before changing the captured owner, association or navigation. */
  async revoke(): Promise<void> {
    if (this.revoking) throw beforeSend('原侧聊确认正在撤销。');
    this.revoking = true;
    const registration = this.registration;
    this.epoch++;
    this.grant = null;
    if (this.capture) { this.options.sessions.cancelEphemeralFork(this.capture.token); this.capture = null; }
    let confirmed = false;
    try {
      if (registration) await this.request({ action: 'revoke', ...registration }, () => this.options.assertCurrent());
      confirmed = true;
    } catch (error) { this.invalid = true; throw error; }
    finally { if (confirmed && this.registration === registration) this.registration = null; this.revoking = false; }
  }

  /** Advisory browser check; the host repeats the complete check in its dispatch interval. */
  assertAuthorized(action: SideChatHostAction): void {
    this.assertCurrent();
    if (!this.identity || !this.grant || this.grant.action !== action || !sameIdentity(this.grant.identity, this.identity)
      || action === 'close' && !this.closeLease) throw beforeSend('原侧聊操作尚未取得当前浏览器确认。');
  }

  /** Invoke synchronously from the original close event, before its first await. */
  async freezeClose(): Promise<void> {
    this.assertCurrent();
    const identity = this.identity, draft = this.options.draftController();
    if (!identity || this.closeLease) throw beforeSend('侧聊草稿尚未就绪或正在关闭。');
    const owner = ownerOf(identity, identity.childThreadId), draftLease = draft?.freeze(owner) ?? null;
    if (draft && !draftLease) throw beforeSend('侧聊草稿无法冻结，原内容已保留。');
    let send: SideChatSendLease;
    try { send = this.options.freezeSending(owner); }
    catch (error) { draftLease?.release(); throw error; }
    this.closeLease = { draft, draftLease, send };
    try { await this.checkClose(identity); }
    catch (error) { this.closeLease = null; send.release(); draftLease?.release(); throw error; }
  }
  private async checkClose(identity: SideChatBrowserIdentity, guard = this.assertCurrent): Promise<void> {
    const lease = this.closeLease, owner = ownerOf(identity, identity.childThreadId);
    if (!lease || lease.draft !== this.options.draftController()) throw new Error('原侧聊草稿租约已改变。');
    guard(); lease.send.assertCurrent();
    if (lease.draftLease && !await lease.draftLease.flush()) throw new Error('侧聊草稿未能排空。');
    await lease.send.drain();
    guard(); lease.send.assertCurrent();
    const snapshot = lease.draft?.snapshot() ?? null;
    if (lease.draft && (!snapshot || snapshot.owner.hostId !== owner.hostId || snapshot.owner.threadId !== owner.threadId
      || snapshot.owner.draftId !== owner.draftId)) throw new Error('原侧聊草稿身份已改变。');
    const stored = snapshot ? await readComposerDraft(owner, snapshot.revision) : null, sends = await this.options.sendStore.read();
    if (snapshot && (!stored || !sameComposerDraftValue(stored.draft, snapshot.draft))
      || Object.values(sends.requests).some(intent => intent.owner.hostId === owner.hostId && intent.owner.draftId === owner.draftId)) {
      throw new Error('侧聊草稿或发送结果尚未确认。');
    }
    await updateBrowserAtoms(atoms => {
      guard();
      assertAssociation(atoms[composerDraftAtomKey], asAssociation(identity));
      if (snapshot) {
        const versions = readComposerDraftVersionsInRoot(atoms[composerDraftAtomKey], owner).versions
          .filter(value => value.revision === snapshot.revision);
        if (versions.length !== 1 || !sameComposerDraftValue(versions[0]!.draft, snapshot.draft)) {
          throw new Error('原侧聊活动草稿版本已改变。');
        }
      }
      const raw = atoms[sendsAtom];
      if (raw !== undefined) {
        if (!object(raw) || !object(raw.requests)) throw new Error('发送恢复记录无法识别。');
        for (const request of Object.values(raw.requests)) {
          if (!object(request) || !object(request.owner) || !id(request.owner.hostId) || !id(request.owner.draftId)
            || !(request.owner.threadId === null || id(request.owner.threadId))) throw new Error('发送恢复身份无法识别。');
          if (request.owner.hostId === owner.hostId && request.owner.draftId === owner.draftId) throw new Error('侧聊发送结果尚未确认。');
        }
      }
      return { value: undefined };
    });
    if (lease.draftLease && !await lease.draftLease.flush()) throw new Error('侧聊草稿未能排空。');
    guard(); lease.send.assertCurrent();
    const latest = lease.draft?.snapshot() ?? null;
    if (lease !== this.closeLease || lease.draft !== this.options.draftController() || snapshot && (!latest
      || latest.revision !== snapshot.revision || !sameComposerDraftValue(latest, snapshot))) throw new Error('侧聊草稿在关闭时发生变化。');
  }

  /** The parent must prove that the original close call cannot still unsubscribe. */
  async cancelClose(assertSettledWithoutUnsubscribe: () => void): Promise<void> {
    assertSettledWithoutUnsubscribe();
    await this.revoke();
    assertSettledWithoutUnsubscribe();
    const lease = this.closeLease;
    this.closeLease = null;
    lease?.send.release(); lease?.draftLease?.release();
  }

  /** An operation closed before fork has no child cleanup event to release its lease. */
  async completeEmptyClose(assertClosedWithoutChild: () => void): Promise<void> {
    const lease = this.closeLease, identity = this.identity;
    if (!lease || !identity || identity.childThreadId !== null) throw beforeSend('原侧聊不是已确认的无子会话关闭。');
    assertClosedWithoutChild();
    await this.revoke();
    assertClosedWithoutChild();
    if (lease !== this.closeLease || this.identity !== identity || identity.childThreadId !== null) {
      throw beforeSend('原侧聊关闭身份已改变。');
    }
    this.sealed = true; this.closeLease = null;
    lease.send.release(); lease.draftLease?.release();
  }

  private async child(request: SideChatAuthorityRequest, guard: () => void): Promise<void> {
    const old = this.identity, capture = this.capture, view = request.view, next = request.identity;
    if (!old || !capture || old.childThreadId !== null || !next.childThreadId || !sameIdentity({ ...next, childThreadId: null }, old)
      || !view?.child || view.operationId !== old.operationId || view.parent.hostId !== old.hostId || view.parent.threadId !== old.parentThreadId
      || view.parent.cwd !== old.parentCwd || view.childId !== next.childThreadId || view.child.thread.id !== next.childThreadId
      || view.fork.receipt?.connectionGeneration !== old.connectionGeneration || view.fork.receipt.attemptId !== capture.scope.forkDispatchId
      || !Number.isSafeInteger(view.fork.receipt.eventCursor) || view.fork.receipt.eventCursor < 0) {
      throw new Error('侧聊 child 回执与原 fork 不一致。');
    }
    guard();
    await updateBrowserAtoms(atoms => {
      guard();
      const { root, entries, entry } = entryAt(atoms[composerDraftAtomKey], old), saved = association(entry.sideChat);
      if (!sameDraft(saved, old) || saved.operationId !== old.operationId || saved.parentCwd !== old.parentCwd
        || saved.connectionGeneration !== old.connectionGeneration || saved.childThreadId !== null && saved.childThreadId !== next.childThreadId
        || entry.createdThreadId !== undefined && entry.createdThreadId !== next.childThreadId) throw new Error('侧聊 child 草稿关联已改变。');
      return { value: undefined, updates: { [composerDraftAtomKey]: { ...root, entries: {
        ...entries, [keyOf(old)]: { ...entry, createdThreadId: next.childThreadId, sideChat: { ...saved, childThreadId: next.childThreadId } },
      } } } };
    });
    await this.verify(asAssociation(next), guard);
    guard();
    const installed = this.options.sessions.installEphemeralFork(capture.token, { scope: capture.scope,
      eventCursor: view.fork.receipt.eventCursor, child: view.child });
    this.capture = null;
    if (!installed) throw new Error('无法确认原连接上的侧聊事件流。');
    this.childLive = true;
    this.identity = structuredClone(next);
  }
  /** Recover an interrupted child handshake only after the parent proves the original call settled. */
  async recoverChild(view: SideChatHostView, assertSettled: () => void): Promise<void> {
    const grant = this.grant, identity = this.identity;
    if (!grant || !identity || !view.childId) throw beforeSend('原侧聊 child 回执尚未就绪。');
    const guard = () => { this.assertCurrent(); assertSettled(); if (this.grant !== grant) throw beforeSend('原侧聊确认已撤销。'); };
    guard();
    await this.child({ type: 'side-chat-browser-authority', requestId: 'recovery', challengeId: grant.challengeId,
      kind: 'child', identity: { ...identity, childThreadId: view.childId }, view }, guard);
    guard();
    grant.identity = structuredClone(this.identity!);
  }
  private async answer(request: SideChatAuthorityRequest): Promise<void> {
    const grant = this.grant;
    if (!grant || request.challengeId !== grant.challengeId || request.identity.operationId !== grant.identity.operationId) return;
    const guard = () => { this.assertCurrent(); if (this.grant !== grant) throw beforeSend('原侧聊确认已撤销。'); };
    try {
      if (request.kind === 'child') {
        await this.child(request, guard);
        grant.identity = structuredClone(request.identity);
      } else {
        if (!this.identity || !sameIdentity(request.identity, this.identity)) throw new Error('侧聊关闭身份已改变。');
        if (request.kind === 'close') await this.checkClose(this.identity, guard);
        else {
          if (!this.closeLease) throw new Error('原侧聊关闭租约不存在。');
          await this.options.cleanupChild(this.identity);
          guard();
        }
      }
      await this.request({ action: 'respond', requestId: request.requestId, challengeId: request.challengeId, outcome: 'ready' }, guard);
      if (request.kind === 'cleanup') {
        this.sealed = true;
        const lease = this.closeLease; this.closeLease = null;
        lease?.send.release(); lease?.draftLease?.release();
      }
    } catch {
      try { await this.request({ action: 'respond', requestId: request.requestId, challengeId: request.challengeId, outcome: 'failed' }, guard); }
      catch { /* The host keeps the original operation and the local lease. */ }
    }
  }
  private event(event: WorkbenchEvent): void {
    if (event.type === 'connection-state') {
      if (event.state === 'connected') this.bridgeConnected = true;
      else if (this.bridgeConnected) this.invalidate();
      return;
    }
    if (event.type === 'codex-app-server-connection-changed' && event.hostId === this.options.identity.hostId) {
      if (event.state === 'connected') this.hostConnected = true;
      else if (this.hostConnected) this.invalidate();
      return;
    }
    if (event.type !== 'side-chat-browser-authority' || !id(event.requestId) || !id(event.challengeId)
      || !['child', 'close', 'cleanup'].includes(String(event.kind)) || !object(event.identity)) return;
    void this.answer(event as unknown as SideChatAuthorityRequest);
  }
  /** On disconnect, the native owner must also invalidate this page before any authority transfer. */
  invalidate(): void {
    this.invalid = true; this.epoch++; this.grant = null; this.registration = null;
    if (this.capture) { this.options.sessions.cancelEphemeralFork(this.capture.token); this.capture = null; }
  }
  dispose(): void {
    if (this.registration || this.authorizing || this.revoking || this.closeLease) {
      throw beforeSend('原侧聊确认或关闭租约尚未解除，不能卸载。');
    }
    this.invalidate(); this.unwatch();
  }
}
