import type { ThreadSettingsResponse, ThreadSummary } from '../../../lib/codex-protocol.ts';
import type { ComposerDraft, SubmitAction, SubmitOptions, WorkbenchClient } from '../workbench-contract.ts';
import { bindComposerDraftToThread, clearComposerDraftRevision, readComposerDraft } from '../composer/composer-draft-store.ts';
import type { ComposerSubmissionDescription } from '../composer/composer-draft-store.ts';
import { acknowledgeSubmittedBrowserReferences } from './browser-draft.ts';
import type { ConversationSessions } from './conversation-sessions.ts';
import { sessionOptions } from './session-options.ts';
import { submitDraft } from './submission.ts';
import type { SendIntent, SendRecoveryStore } from './send-recovery.ts';
import { readVisualizationModelContext } from '../visualizations/state.ts';

export interface ConversationSendScope {
  hostId: string;
  threadId: string | null;
  draftId: string;
  cwd: string;
  projectId?: string;
}

export interface ConversationSendServices {
  client: WorkbenchClient;
  sessions: ConversationSessions;
  sends: SendRecoveryStore;
  /** Synchronously check the original owner, connection, and writable session. */
  guard(threadId: string | null, allowFirstTurn: boolean): void;
  /** Freeze and drain the original owner before its created-thread binding. */
  prepareCreated(thread: ThreadSummary, settings: ThreadSettingsResponse): Promise<void>;
  selectCreated(thread: ThreadSummary, settings: ThreadSettingsResponse): Promise<void>;
  assignCreatedProject(intent: SendIntent): Promise<void>;
  recoveryChanged(): void;
}

export async function finishConversationSend(sends: SendRecoveryStore, intent: SendIntent) {
  const state = await sends.read(), current = state.requests[intent.id];
  if (!current || current.stage !== 'confirmed' || current.revision !== intent.revision
    || JSON.stringify(current.owner) !== JSON.stringify(intent.owner)) throw new Error('原发送结果或草稿版本尚未确认。');
  await acknowledgeSubmittedBrowserReferences(current, null, state.bindings);
  await clearComposerDraftRevision(current.owner, current.revision);
  await sends.dismiss(current.id, current);
}

/** One immutable submission; the caller owns target changes and lifecycle guards. */
export async function sendConversationDraft(services: ConversationSendServices, scope: ConversationSendScope,
  draft: ComposerDraft, options: SubmitOptions, action: SubmitAction, description: ComposerSubmissionDescription,
  retry?: SendIntent) {
  const { client, sessions, sends, guard } = services;
  const captured = structuredClone({ scope, draft, options, action, description, retry });
  const original = captured.scope;
  ({ draft, options, action, description, retry } = captured);
  const allowFirstTurn = action.type === 'send';
  let intent: SendIntent | undefined;
  try {
    if (original.threadId) await sessions.ready({ hostId: original.hostId, threadId: original.threadId }, allowFirstTurn);
    guard(original.threadId, allowFirstTurn);
    if (description.owner.hostId !== original.hostId || description.owner.draftId !== original.draftId
      || (retry ? retry.threadId : description.owner.threadId) !== original.threadId) {
      throw new Error('提交草稿身份已改变，原输入已保留。');
    }
    const additionalContext = retry ? retry.additionalContext : original.threadId && action.type !== 'queue'
      ? Object.fromEntries((await readVisualizationModelContext(client, original.hostId, original.threadId)).map(value =>
        ['visualization:' + JSON.stringify([value.path, value.field]), { kind: 'untrusted' as const, value: JSON.stringify(value) }])) : undefined;
    guard(original.threadId, allowFirstTurn);
    if (retry) {
      const prior = (await sends.read()).requests[retry.id];
      if (!prior || prior.owner.hostId !== description.owner.hostId || prior.owner.threadId !== description.owner.threadId
        || prior.owner.draftId !== description.owner.draftId || prior.revision !== description.revision
        || prior.threadId !== original.threadId || !['prepared', 'ready', 'failed'].includes(prior.stage)) {
        throw new Error('原恢复记录已改变，未发送。');
      }
      guard(original.threadId, allowFirstTurn);
      intent = await sends.attempt(retry.id);
      if (intent.owner.hostId !== description.owner.hostId || intent.owner.threadId !== description.owner.threadId
        || intent.owner.draftId !== description.owner.draftId || intent.revision !== description.revision
        || intent.threadId !== original.threadId) throw new Error('原恢复记录已改变，未发送。');
    } else {
      const stored = await readComposerDraft(description.owner, description.revision);
      if (!stored || JSON.stringify(stored.draft) !== JSON.stringify(draft)) throw new Error('原提交版本未能核对，未发送。');
      guard(original.threadId, allowFirstTurn);
      intent = await sends.prepare(description, original.cwd, draft, options, description.overrides,
        original.projectId, additionalContext, action);
    }
    services.recoveryChanged();
    guard(original.threadId, allowFirstTurn);
    if (retry?.created && retry.projectId) {
      await services.assignCreatedProject(intent);
      guard(original.threadId, allowFirstTurn);
    }
    const active = original.threadId ? sessions.view({ hostId: original.hostId, threadId: original.threadId }).snapshot() : null;
    const result = await submitDraft(client, {
      hostId: original.hostId, threadId: original.threadId, cwd: intent.cwd, readOnly: false,
      initialOptions: active?.options ?? undefined, overrides: intent.overrides,
      documentPlainTextMode: intent.documentPlainTextMode, additionalContext: intent.additionalContext,
      collaborationMode: intent.collaborationMode, createdOptions: intent.created?.settings,
      activeTurnId: active?.thread?.turns.find(turn => turn.status === 'inProgress')?.id ?? null, thread: active?.thread ?? null,
      send: {
        clientUserMessageId: intent.clientUserMessageId,
        creating: async () => { guard(null, allowFirstTurn); await sends.creating(intent!.id, intent!.attemptId); guard(null, allowFirstTurn); },
        created: async (thread, settings) => {
          await sends.created(intent!.id, thread.id, { thread, settings: sessionOptions(settings) }, intent!.attemptId);
          services.recoveryChanged();
          await services.prepareCreated(thread, settings);
          await bindComposerDraftToThread(intent!.owner, thread.id);
        },
        sending: async () => {
          const target = (await sends.read()).requests[intent!.id]?.threadId ?? null;
          guard(target, allowFirstTurn); await sends.sending(intent!.id, intent!.attemptId); guard(target, allowFirstTurn);
        },
        confirmed: async turnId => { await sends.confirmed(intent!.id, turnId, intent!.attemptId); },
        queued: async id => { await sends.queued(intent!.id, id, intent!.attemptId); },
        resolvedCollaboration: async mode => { await sends.resolvedCollaboration(intent!.id, mode, intent!.attemptId); },
      },
    }, draft, options, action, services.selectCreated);
    if (result.turn) sessions.started({ hostId: original.hostId, threadId: result.threadId }, result.turn);
    await finishConversationSend(sends, intent);
    services.recoveryChanged();
  } catch (error) {
    if (intent) {
      try { await sends.failed(intent.id, error, intent.attemptId); }
      catch (storageError) { services.recoveryChanged(); throw new AggregateError([error, storageError], '发送结果或恢复记录未能保存，原稿已保留。'); }
      services.recoveryChanged();
    }
    throw error;
  }
}
