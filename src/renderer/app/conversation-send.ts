import type { ThreadSummary } from '../../../lib/codex-protocol.ts';
import type { ComposerDraft, SubmitAction, SubmitOptions, WorkbenchClient } from '../workbench-contract.ts';
import { bindComposerDraftToThread, clearComposerDraftRevision, readComposerDraft } from '../composer/composer-draft-store.ts';
import type { ComposerSubmissionDescription } from '../composer/composer-draft-store.ts';
import type { ComposerDraftController } from '../composer/use-composer-draft.ts';
import { acknowledgeSubmittedBrowserReferences } from './browser-draft.ts';
import type { ConversationSessions } from './conversation-sessions.ts';
import { sessionOptions } from './session-options.ts';
import { captureDraftInjection, submitDraft } from './submission.ts';
import { sendsAtom, sendThreadKey } from './send-recovery.ts';
import type { SendIntent, SendRecoveryStore } from './send-recovery.ts';
import type { SendInjectionAuthority } from './send-injection-client.ts';
import { readVisualizationModelContext } from '../visualizations/state.ts';
import { isThreadBusy } from './thread-state.ts';

export interface ConversationSendScope {
  hostId: string;
  threadId: string | null;
  draftId: string;
  cwd: string;
  projectId?: string;
}

export type ConversationWriteMethod = 'thread/start' | 'thread/inject_items' | 'turn/start' | 'turn/steer' | 'thread/queue/add' | 'thread/queue/start';
/** Run the assertion after transport preparation, immediately before sending on the original connection. */
export type ConversationWriteDispatch = <T>(method: ConversationWriteMethod, params: Record<string, unknown>, hostId: string,
  assertAuthority: () => void) => Promise<T>;

export interface ConversationSendServices {
  client: WorkbenchClient;
  sessions: ConversationSessions;
  sends: SendRecoveryStore;
  cleanup: ConversationSendCleanup;
  /** Synchronously check the original owner, connection, and writable session. */
  guard(threadId: string | null, allowFirstTurn: boolean): void;
  dispatch: ConversationWriteDispatch;
  /** Captured with the same original submission grant, before this function awaits. */
  nativeInjectionAuthority?: SendInjectionAuthority;
  /** Freeze and drain the original owner before its created-thread binding. */
  prepareCreated(): Promise<void>;
  selectCreated(thread: ThreadSummary): Promise<void>;
  /** Reconcile authoritative membership before writing, including after an unknown result. */
  assignCreatedProject(creation: { owner: SendIntent['owner']; thread: ThreadSummary; cwd: string; projectId: string },
    assertAuthority: () => void): Promise<void>;
  recoveryChanged(): void;
}

export interface ConversationSendCleanup {
  /** Return the mounted original owner's controller, or null only when its absence is proven.
   * Throw when the original scope or exclusive ownership can no longer be verified. */
  controller(intent: SendIntent): ComposerDraftController | null;
}

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const injectionIdentity = (intent: SendIntent) => intent.injection && { callId: intent.injection.callId,
  input: intent.injection.input, responseItems: intent.injection.responseItems };
const submittedIdentity = (intent: SendIntent) => ({ id: intent.id, clientUserMessageId: intent.clientUserMessageId,
  owner: intent.owner, revision: intent.revision, threadId: intent.threadId, cwd: intent.cwd, projectId: intent.projectId,
  draft: intent.draft, options: intent.options, overrides: intent.overrides, action: intent.action,
  additionalContext: intent.additionalContext, documentPlainTextMode: intent.documentPlainTextMode,
  collaborationMode: intent.collaborationMode, created: intent.created, injection: injectionIdentity(intent) });

function creationProject(state: Awaited<ReturnType<SendRecoveryStore['read']>>, hostId: string, threadId: string) {
  const receipt = state.creations[sendThreadKey(hostId, threadId)];
  if (!receipt) return null;
  const raw = record(receipt)!;
  let projectId: unknown = raw.projectId;
  if (!Object.hasOwn(raw, 'projectId')) {
    const originals = Object.values(state.requests).filter(value => value.threadId === threadId
      && same(value.owner, receipt.owner) && value.created?.thread.id === threadId);
    if (originals.length !== 1) throw new Error('新会话原项目无法确认，首条消息未发送。');
    projectId = originals[0]!.projectId ?? null;
  }
  if (projectId !== null && (typeof projectId !== 'string' || !projectId)) throw new Error('新会话原项目无效，首条消息未发送。');
  return { receipt, projectId };
}

export async function finishConversationSend(sends: SendRecoveryStore, intent: SendIntent, cleanup: ConversationSendCleanup) {
  const state = await sends.read(), current = state.requests[intent.id];
  if (!current || current.stage !== 'confirmed' || current.revision !== intent.revision
    || !same(current.owner, intent.owner) || current.clientUserMessageId !== intent.clientUserMessageId
    || current.attemptId !== intent.attemptId || current.cwd !== intent.cwd || current.projectId !== intent.projectId
    || current.documentPlainTextMode !== intent.documentPlainTextMode || !same(current.draft, intent.draft)
    || !same(current.options, intent.options) || !same(current.overrides, intent.overrides)
    || !same(current.action, intent.action) || !same(current.additionalContext, intent.additionalContext)
    || !same(injectionIdentity(current), injectionIdentity(intent))) {
    throw new Error('原发送结果或草稿版本尚未确认。');
  }
  const controller = cleanup.controller(current), snapshot = controller?.snapshot();
  if (controller && (!snapshot || snapshot.owner.hostId !== current.owner.hostId || snapshot.owner.draftId !== current.owner.draftId
    || snapshot.owner.threadId !== current.owner.threadId && !(current.owner.threadId === null && snapshot.owner.threadId === current.threadId))) {
    throw new Error('原输入区已改变，已发送版本尚未清理。');
  }
  const guarded = (atoms: Readonly<Record<string, unknown>>) => {
    const recovery = record(atoms[sendsAtom]), requests = record(recovery?.requests), bindings = record(recovery?.bindings);
    if (!requests || !bindings || !same(requests[current.id], current) || current.stage !== 'confirmed'
      || !current.threadId || current.owner.threadId !== null && current.owner.threadId !== current.threadId
      || current.owner.threadId === null && bindings[sendThreadKey(current.owner.hostId, current.threadId)] !== current.owner.draftId
      || cleanup.controller(current) !== controller) return false;
    return !controller || same(controller.snapshot()?.owner, snapshot?.owner);
  };
  await acknowledgeSubmittedBrowserReferences(current, controller, state.bindings);
  if (controller) await controller.clearSubmittedVersion(current.revision, guarded);
  else await clearComposerDraftRevision(current.owner, current.revision, guarded);
  if (cleanup.controller(current) !== controller || controller && !same(controller.snapshot()?.owner, snapshot?.owner)) {
    throw new Error('原输入区已改变，已发送记录尚未关闭。');
  }
  await sends.dismiss(current.id, current);
}

/** One immutable submission; the caller owns target changes and lifecycle guards. */
export async function sendConversationDraft(services: ConversationSendServices, scope: ConversationSendScope,
  draft: ComposerDraft, options: SubmitOptions, action: SubmitAction, description: ComposerSubmissionDescription,
  retry?: SendIntent) {
  const { client, sessions, sends, guard } = services;
  const nativeAuthority = services.nativeInjectionAuthority && {
    daemonConnectionGeneration: services.nativeInjectionAuthority.daemonConnectionGeneration,
    assertBeforeSend: services.nativeInjectionAuthority.assertBeforeSend,
  };
  const captured = structuredClone({ scope, draft, options, action, description, retry });
  const original = captured.scope;
  ({ draft, options, action, description, retry } = captured);
  const allowFirstTurn = action.type === 'send';
  const notify = () => { try { services.recoveryChanged(); } catch { /* A notification is not a send result. */ } };
  let intent: SendIntent | undefined, confirmed = false;
  try {
    const draftInjection = retry?.injection ?? captureDraftInjection(draft, original.hostId, description.documentPlainTextMode);
    if (original.threadId) await sessions.ready({ hostId: original.hostId, threadId: original.threadId }, allowFirstTurn);
    guard(original.threadId, allowFirstTurn);
    const resumingCreated = !!retry && original.threadId === null && retry.owner.threadId === null
      && !!retry.threadId && retry.created?.thread.id === retry.threadId;
    if (description.owner.hostId !== original.hostId || description.owner.draftId !== original.draftId
      || (retry ? resumingCreated ? retry.owner.threadId : retry.threadId : description.owner.threadId) !== original.threadId) {
      throw new Error('提交草稿身份已改变，原输入已保留。');
    }
    const recovery = await sends.read();
    if (!original.threadId && !retry && Object.values(recovery.creations).some(receipt =>
      same(receipt.owner, description.owner))) throw new Error('原草稿已有新会话回执，请先恢复原发送。');
    const creation = original.threadId ? creationProject(recovery, original.hostId, original.threadId) : null;
    if (creation && original.projectId !== undefined && original.projectId !== creation.projectId) {
      throw new Error('新会话原项目已改变，首条消息未发送。');
    }
    const additionalContext = retry ? retry.additionalContext : original.threadId && action.type !== 'queue'
      ? Object.fromEntries((await readVisualizationModelContext(client, original.hostId, original.threadId)).map(value =>
        ['visualization:' + JSON.stringify([value.path, value.field]), { kind: 'untrusted' as const, value: JSON.stringify(value) }])) : undefined;
    guard(original.threadId, allowFirstTurn);
    if (retry) {
      const prior = recovery.requests[retry.id];
      if (!prior || prior.owner.hostId !== description.owner.hostId || prior.owner.threadId !== description.owner.threadId
        || prior.owner.draftId !== description.owner.draftId || prior.revision !== description.revision
        || !same(submittedIdentity(prior), submittedIdentity(retry))
        || (resumingCreated ? prior.threadId !== retry.threadId || prior.created?.thread.id !== retry.threadId
          || recovery.bindings[sendThreadKey(original.hostId, retry.threadId!)] !== original.draftId : prior.threadId !== original.threadId)
        || !['prepared', 'ready', 'failed'].includes(prior.stage)) {
        throw new Error('原恢复记录已改变，未发送。');
      }
      guard(original.threadId, allowFirstTurn);
      intent = await sends.attempt(retry.id);
      if (intent.owner.hostId !== description.owner.hostId || intent.owner.threadId !== description.owner.threadId
        || intent.owner.draftId !== description.owner.draftId || intent.revision !== description.revision
        || intent.threadId !== (resumingCreated ? retry.threadId : original.threadId)
        || !same(submittedIdentity(intent), submittedIdentity(retry))) throw new Error('原恢复记录已改变，未发送。');
    } else {
      const stored = await readComposerDraft(description.owner, description.revision);
      if (!stored || JSON.stringify(stored.draft) !== JSON.stringify(draft)) throw new Error('原提交版本未能核对，未发送。');
      guard(original.threadId, allowFirstTurn);
      intent = await sends.prepare(description, original.cwd, draft, options, description.overrides,
        creation ? creation.projectId ?? undefined : original.projectId, additionalContext, action, draftInjection);
    }
    notify();
    guard(original.threadId, allowFirstTurn);
    if (creation?.projectId) {
      await services.assignCreatedProject({ owner: creation.receipt.owner, thread: creation.receipt.thread,
        cwd: creation.receipt.thread.cwd || original.cwd, projectId: creation.projectId }, () => guard(original.threadId, allowFirstTurn));
      guard(original.threadId, allowFirstTurn);
    }
    const selectCreated = async (thread: ThreadSummary) => {
      if (intent!.projectId) {
        await services.assignCreatedProject({ owner: intent!.owner, thread, cwd: intent!.cwd, projectId: intent!.projectId },
          () => guard(null, allowFirstTurn));
        guard(null, allowFirstTurn);
      }
      await services.selectCreated(thread);
    };
    if (resumingCreated && intent.created) {
      await services.prepareCreated();
      await bindComposerDraftToThread(intent.owner, intent.created.thread.id);
      await selectCreated(intent.created.thread);
    }
    const dispatchThreadId = resumingCreated ? intent.threadId : original.threadId;
    const active = dispatchThreadId ? sessions.view({ hostId: original.hostId, threadId: dispatchThreadId }).snapshot() : null;
    const sendClient: WorkbenchClient = {
      rpc<T>(method: string, params: Record<string, unknown> = {}, hostId = original.hostId, options?: Parameters<WorkbenchClient['rpc']>[3]) {
        if (method === 'thread/start' || method === 'thread/inject_items' || method === 'turn/start' || method === 'turn/steer' || method === 'thread/queue/add') {
          if (hostId !== original.hostId || method !== 'thread/start' && typeof params.threadId !== 'string') {
            throw Object.assign(new Error('原发送目标无法确认，未派发。'), { uncertain: false });
          }
          const threadId = method === 'thread/start' ? null : params.threadId as string;
          return services.dispatch<T>(method, params, hostId, () => {
            guard(threadId, allowFirstTurn);
            if (threadId && (method === 'thread/inject_items' || method === 'turn/start' && action.type === 'send')
              && isThreadBusy(sessions.view({ hostId, threadId }).snapshot().thread)) throw Object.assign(new Error('当前任务已开始，原输入已保留，未发送。'), { uncertain: false });
            options?.assertBeforeSend?.();
          });
        }
        return client.rpc<T>(method, params, hostId, options);
      },
      host: (endpoint, params, options) => client.host(endpoint, params, options),
      subscribe: listener => client.subscribe(listener),
      reply: (ref, response) => client.reply(ref, response),
    };
    const result = await submitDraft(sendClient, {
      hostId: original.hostId, threadId: dispatchThreadId, cwd: intent.cwd, readOnly: false,
      initialOptions: active?.options ?? undefined, overrides: intent.overrides,
      documentPlainTextMode: intent.documentPlainTextMode, additionalContext: intent.additionalContext,
      collaborationMode: intent.collaborationMode, createdOptions: intent.created?.settings,
      injection: intent.injection,
      ...(intent.injection && nativeAuthority ? { nativeInjection: { store: sends, intent, authority: nativeAuthority } } : {}),
      assertInjectionAuthority: target => {
        guard(target, allowFirstTurn);
        if (isThreadBusy(sessions.view({ hostId: original.hostId, threadId: target }).snapshot().thread)) throw Object.assign(new Error('当前任务仍在运行，原 app 上下文未发送。'), { uncertain: false });
      },
      activeTurnId: active?.thread?.turns.find(turn => turn.status === 'inProgress')?.id ?? null, thread: active?.thread ?? null,
      send: {
        clientUserMessageId: intent.clientUserMessageId,
        injecting: async () => { await sends.injecting(intent!.id, intent!.attemptId); },
        injected: async () => { await sends.injected(intent!.id, intent!.attemptId); },
        injectionFailed: async cause => { await sends.injectionFailed(intent!.id, cause, intent!.attemptId); },
        creating: async () => { guard(null, allowFirstTurn); await sends.creating(intent!.id, intent!.attemptId); guard(null, allowFirstTurn); },
        created: async (thread, settings) => {
          await sends.created(intent!.id, thread.id, { thread, settings: sessionOptions(settings) }, intent!.attemptId);
          notify();
          await services.prepareCreated();
          await bindComposerDraftToThread(intent!.owner, thread.id);
        },
        sending: async () => {
          const target = (await sends.read()).requests[intent!.id]?.threadId ?? null;
          guard(target, allowFirstTurn); await sends.sending(intent!.id, intent!.attemptId); guard(target, allowFirstTurn);
        },
        confirmed: async turnId => { await sends.confirmed(intent!.id, turnId, intent!.attemptId); confirmed = true; },
        queued: async id => { await sends.queued(intent!.id, id, intent!.attemptId); confirmed = true; },
        resolvedCollaboration: async mode => { await sends.resolvedCollaboration(intent!.id, mode, intent!.attemptId); },
      },
    }, draft, options, action, selectCreated);
    if (intent.injection && result.turn) {
      const settled = (await sends.read()).requests[intent.id];
      confirmed = !!settled && settled.stage === 'confirmed' && settled.attemptId === intent.attemptId
        && settled.revision === intent.revision && same(settled.owner, intent.owner)
        && settled.clientUserMessageId === intent.clientUserMessageId && settled.turnId === result.turn.id;
      if (!confirmed) throw new Error('原上下文消息的持久发送回执尚未核对，原稿已保留。');
    }
    if (result.turn) sessions.started({ hostId: original.hostId, threadId: result.threadId }, result.turn);
    try { await finishConversationSend(sends, intent, services.cleanup); }
    catch (cause) {
      if (!confirmed) throw cause;
      throw new Error('发送已确认，但原草稿清理尚未完成：' + (cause instanceof Error ? cause.message : String(cause)), { cause });
    }
    notify();
  } catch (error) {
    if (intent) {
      try { await sends.failed(intent.id, error, intent.attemptId); }
      catch (storageError) { notify(); throw new AggregateError([error, storageError], '发送结果或恢复记录未能保存，原稿已保留。'); }
      notify();
    }
    throw error;
  }
}
