import type { ThreadItemSummary, ThreadSummary, TurnSummary } from '../../../lib/codex-protocol.ts';
import type { EditMessageRequest, EditMessageResult, EditStage } from '../../native/message-edit.ts';
import type { MessageEditOrigin, WorkbenchClient } from '../workbench-contract.ts';
import { draftToInput } from '../composer/standalone-draft.ts';
import { editableDraft } from '../messages/message-data.ts';
import { applyTextEdits, editSourceSignature, latestEditTarget } from '../messages/message-edit.ts';
import type { MessageEditAccess, MessageEditRebaseCandidate, MessageEditRebaseMarker, MessageEditRecovery, MessageEditRecoveryVersion } from '../messages/use-message-editing.ts';
import { readBrowserAtom, updateBrowserAtom } from '../storage/ui-atoms.ts';
import { loadThread } from './load-thread.ts';

export const messageEditsAtom = 'codex-yard.message-edits.v1';
export const messageEditChanged = 'yard-message-edit-updated';
export type MessageEditExpectedSource = { clientUserMessageId: string; signature: string };
export interface StoredMessageEdit {
  recovery: MessageEditRecovery;
  submission?: { request: EditMessageRequest & { expectedSource?: MessageEditExpectedSource }; stage: EditStage; operationId: string;
    /** The editor version actually sent, retained unchanged by read-only checks. */
    editorVersion?: MessageEditRecoveryVersion; turn?: TurnSummary };
}
export interface EditRecoveryStorage {
  read(): unknown | Promise<unknown>;
  update(change: (previous: unknown) => unknown): Promise<unknown>;
  changed(): void;
}
export type MessageEditRecoveryOptions = {
  /** Set only when the host verifies expectedSource inside its revert write interval. */
  hostChecksRebasedSourceBeforeRevert?: boolean;
};
const browserStorage: EditRecoveryStorage = {
  read: () => readBrowserAtom(messageEditsAtom),
  update: change => updateBrowserAtom(messageEditsAtom, change),
  changed: () => window.dispatchEvent(new Event(messageEditChanged)),
};
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function entries(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (!record(value)) throw new Error('编辑恢复记录格式无效；原值已保留。');
  return value;
}
const keyFor = (origin: Pick<MessageEditOrigin, 'hostId' | 'threadId'>) => JSON.stringify([origin.hostId, origin.threadId]);
const sameOrigin = (left: MessageEditOrigin, right: MessageEditOrigin) => left.hostId === right.hostId && left.threadId === right.threadId
  && left.turnId === right.turnId && left.itemId === right.itemId;
const sameVersion = (left: MessageEditRecoveryVersion, right: MessageEditRecoveryVersion) => left.sessionId === right.sessionId && left.revision === right.revision;
function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length && left.every((value, index) => sameJson(value, right[index]));
  if (!record(left) || !record(right)) return false;
  const leftKeys = Object.keys(left).sort(), rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && sameJson(left[key], right[key]));
}
function stored(value: unknown, identity: Pick<MessageEditOrigin, 'hostId' | 'threadId'>): StoredMessageEdit | null {
  if (value === undefined) return null;
  const recovery = record(value) && value.recovery;
  const origin = record(recovery) && recovery.origin;
  if (!record(value) || !record(recovery) || !record(origin) || !record(recovery.draft)
    || origin.hostId !== identity.hostId || origin.threadId !== identity.threadId
    || typeof origin.turnId !== 'string' || typeof origin.itemId !== 'string'
    || typeof recovery.draft.text !== 'string' || !Array.isArray(recovery.draft.images) || !Array.isArray(recovery.draft.files)) {
    throw new Error('编辑恢复内容无法安全读取；原值已保留。');
  }
  if (value.submission !== undefined) {
    const submission = value.submission, request = record(submission) && submission.request;
    if (!record(submission) || !record(request) || !record(request.origin)
      || !sameOrigin(request.origin as unknown as MessageEditOrigin, origin as unknown as MessageEditOrigin)
      || !Array.isArray(request.expectedTurnIds) || typeof request.clientUserMessageId !== 'string'
      || !record(request.turnParams) || typeof submission.operationId !== 'string'
      || !['prepared', 'reverted', 'revertUnknown', 'startUnknown', 'started', 'conflict'].includes(String(submission.stage))) {
      throw new Error('编辑发送阶段无法安全读取；原值已保留。');
    }
    if (submission.editorVersion !== undefined && (!record(submission.editorVersion)
      || typeof submission.editorVersion.sessionId !== 'string'
      || !Number.isSafeInteger(submission.editorVersion.revision) || Number(submission.editorVersion.revision) < 0)) {
      throw new Error('编辑发送版本无法安全读取；原值已保留。');
    }
    if (request.expectedSource !== undefined && (!record(request.expectedSource)
      || typeof request.expectedSource.clientUserMessageId !== 'string' || !request.expectedSource.clientUserMessageId
      || typeof request.expectedSource.signature !== 'string' || !request.expectedSource.signature)) {
      throw new Error('编辑来源核验条件无法安全读取；原值已保留。');
    }
  }
  return structuredClone(value) as unknown as StoredMessageEdit;
}

export function messageEditRebaseMarker(state: StoredMessageEdit | null): MessageEditRebaseMarker | null {
  const submission = state?.submission, editor = state?.recovery.editor, sent = submission?.editorVersion;
  if (submission?.stage !== 'started' || !editor || !sent || editor.sessionId !== sent.sessionId
    || !Number.isSafeInteger(editor.revision) || editor.revision <= sent.revision) return null;
  return { origin: structuredClone(state!.recovery.origin), submittedVersion: { ...sent } };
}

function requireRebasable(state: StoredMessageEdit | null, origin: MessageEditOrigin, version: MessageEditRecoveryVersion): asserts state is StoredMessageEdit {
  const marker = messageEditRebaseMarker(state), editor = state?.recovery.editor;
  if (!state || !marker || !editor || !sameOrigin(state.recovery.origin, origin) || !sameVersion(editor, version)
    || !Number.isSafeInteger(version.revision + 1)) throw new Error('较新编辑或原发送状态已改变；草稿已保留，请重新核对。');
  if (!record(editor.snapshot) || editor.snapshot.id !== origin.itemId || editor.snapshot.type !== 'userMessage'
    || editSourceSignature(editor.snapshot) !== editor.sourceSignature || !record(editor.baseDraft)
    || (!editor.requiresCurrentSource && !sameJson(editor.baseDraft.input, editor.snapshot.content)) || !Array.isArray(editor.edits)
    || typeof editor.addedText !== 'string') throw new Error('原编辑内容无法无损重建；草稿已保留。');
  try {
    const converted = applyTextEdits(editor.baseDraft, editor.edits, editor.addedText, editor.removedAttachments);
    if (!converted.draft || !sameJson(converted.draft, state.recovery.draft)) throw new Error('unsafe draft');
    draftToInput(converted.draft, origin.hostId);
  } catch {
    throw new Error('较新编辑无法无损重建或转换为可发送输入；草稿已保留，请修正后重试。');
  }
}

function requireCompleteHistory(thread: ThreadSummary, origin: MessageEditOrigin) {
  if (thread.id !== origin.threadId || thread.status?.type !== 'idle' || !Array.isArray(thread.turns)
    || new Set(thread.turns.map(turn => turn.id)).size !== thread.turns.length
    || thread.turns.some(turn => typeof turn.id !== 'string' || !turn.id || !['completed', 'interrupted', 'failed'].includes(turn.status)
      || turn.itemsView !== 'full' || !Array.isArray(turn.items)
      || turn.items.some(item => !record(item) || typeof item.id !== 'string' || !item.id || typeof item.type !== 'string')
      || new Set(turn.items.map(item => item.id)).size !== turn.items.length)) {
    throw new Error('会话状态或完整历史无法确认；草稿已保留。');
  }
}

function sourceForRebase(thread: ThreadSummary, state: StoredMessageEdit): { item: ThreadItemSummary; turnIndex: number; itemIndex: number } {
  const origin = state.recovery.origin, submission = state.submission!;
  requireCompleteHistory(thread, origin);
  const matches = thread.turns.flatMap((turn, turnIndex) => turn.items.flatMap((item, itemIndex) =>
    item.type === 'userMessage' && item.clientId === submission.request.clientUserMessageId ? [{ item, turnIndex, itemIndex }] : []));
  if (matches.length !== 1) throw new Error('无法唯一定位原发送消息；草稿已保留。');
  const match = matches[0]!, turn = thread.turns[match.turnIndex]!;
  const target = latestEditTarget(thread, { order: 'ascending', tailComplete: true });
  if (turn.status !== 'completed' || match.turnIndex !== thread.turns.length - 1
    || target?.restriction || target?.turnId !== turn.id || target.itemId !== match.item.id
    || (submission.turn?.id && submission.turn.id !== turn.id)) {
    throw new Error('原发送消息不是最新的已完成可编辑消息；草稿已保留。');
  }
  if (!editableDraft(match.item) || !sameJson(match.item.content, submission.request.turnParams.input)
    || (origin.format !== undefined && match.item.format !== origin.format)
    || (origin.hints !== undefined && !sameJson(match.item.hints, origin.hints))) {
    throw new Error('原发送消息的输入、附件或格式与请求不一致；草稿已保留。');
  }
  return match;
}

function requireCurrentRebaseTarget(thread: ThreadSummary, recovery: MessageEditRecovery, expectedTurnIds: string[]) {
  const origin = recovery.origin, editor = recovery.editor!;
  requireCompleteHistory(thread, origin);
  const target = latestEditTarget(thread, { order: 'ascending', tailComplete: true });
  const turn = thread.turns.find(value => value.id === origin.turnId);
  const item = turn?.items.find(value => value.id === origin.itemId && value.type === 'userMessage');
  if (!sameJson(thread.turns.map(value => value.id), expectedTurnIds) || turn?.status !== 'completed'
    || thread.turns.at(-1)?.id !== origin.turnId
    || target?.restriction || target?.turnId !== origin.turnId || target.itemId !== origin.itemId
    || !item || typeof editor.snapshot.clientId !== 'string' || item.clientId !== editor.snapshot.clientId
    || editSourceSignature(item) !== editor.sourceSignature || !editableDraft(item)) {
    throw new Error('恢复编辑的来源或会话历史已改变；草稿已保留，未发送。');
  }
}

async function readRebaseHistory(client: WorkbenchClient, origin: MessageEditOrigin): Promise<ThreadSummary> {
  const checkedClient: WorkbenchClient = {
    rpc: async <T>(method: string, params?: Record<string, unknown>, hostId?: string): Promise<T> => {
      const value = await client.rpc<T>(method, params, hostId);
      const page: Record<string, unknown> = record(value) ? value : {};
      if (method === 'thread/turns/list' || method === 'thread/items/list') {
        if (!Array.isArray(page.data) || (page.nextCursor !== undefined && page.nextCursor !== null
          && (typeof page.nextCursor !== 'string' || !page.nextCursor))) throw new Error('会话历史分页无效；草稿已保留。');
        if (page.data.some((entry: unknown) => {
          const item = method === 'thread/items/list' && record(entry) ? entry.item : entry;
          return !record(item) || typeof item.id !== 'string' || !item.id
            || (method === 'thread/items/list' && typeof item.type !== 'string');
        })) throw new Error('会话历史内容无效；草稿已保留。');
      }
      return value;
    },
    host: (endpoint, params) => client.host(endpoint, params),
    subscribe: listener => client.subscribe(listener),
    reply: (request, response) => client.reply(request, response),
  };
  const snapshot = await loadThread(checkedClient, origin.hostId, origin.threadId);
  const current = await checkedClient.rpc<{ thread: ThreadSummary }>('thread/read', { threadId: origin.threadId, includeTurns: false }, origin.hostId);
  if (snapshot.thread.id !== origin.threadId || current.thread?.id !== origin.threadId || current.thread.status?.type !== 'idle') {
    throw new Error('会话正在变化或状态未知；草稿已保留。');
  }
  return { ...snapshot.thread, status: current.thread.status };
}

/** Recovery is UI data in native-atoms. Codex remains the conversation authority. */
export class MessageEditRecoveryStore {
  private observed = new Map<string, { serialized: string | undefined }>();
  private readonly editOwners = new Map<string, { owner: symbol }>();
  private readonly accessListeners = new Map<symbol, Set<() => void>>();
  private readonly client: WorkbenchClient;
  private readonly storage: EditRecoveryStorage;
  private readonly options: MessageEditRecoveryOptions;
  constructor(client: WorkbenchClient, storage: EditRecoveryStorage = browserStorage, options: MessageEditRecoveryOptions = {}) {
    this.client = client; this.storage = storage; this.options = options;
  }

  createAccess(): MessageEditAccess {
    const owner = Symbol('message-edit-view');
    const notifyPeers = () => {
      for (const [peer, listeners] of this.accessListeners) {
        if (peer !== owner) for (const listener of listeners) listener();
      }
    };
    const owns = (identity: Pick<MessageEditOrigin, 'hostId' | 'threadId'>) => this.editOwners.get(keyFor(identity))?.owner === owner;
    return {
      acquire: identity => {
        const key = keyFor(identity), current = this.editOwners.get(key);
        if (current && current.owner !== owner) return false;
        this.editOwners.set(key, { owner });
        if (!current) notifyPeers();
        return true;
      },
      owns,
      available: identity => !this.editOwners.has(keyFor(identity)) || owns(identity),
      capture: identity => {
        const key = keyFor(identity), current = this.editOwners.get(key);
        if (!current || current.owner !== owner) throw new Error('此消息编辑已由另一视图持有，未发送。');
        return () => {
          if (this.editOwners.get(key) !== current) throw new Error('消息编辑使用权已改变，未发送。');
        };
      },
      read: async identity => {
        const key = keyFor(identity), current = this.editOwners.get(key);
        if (!current || current.owner !== owner) throw new Error('此消息编辑已由另一视图持有。');
        const value = entries(await this.storage.read())[key], recovery = stored(value, identity)?.recovery ?? null;
        const serialized = JSON.stringify(value);
        return { recovery, accept: () => {
          if (this.editOwners.get(key) !== current) throw new Error('消息编辑使用权已改变，未接纳恢复稿。');
          this.observed.set(key, { serialized });
        } };
      },
      subscribe: listener => {
        const listeners = this.accessListeners.get(owner) ?? new Set<() => void>();
        listeners.add(listener); this.accessListeners.set(owner, listeners);
        return () => { listeners.delete(listener); if (!listeners.size) this.accessListeners.delete(owner); };
      },
      release: (identity, authority) => {
        try { authority?.(); } catch { return; }
        if (!owns(identity)) return;
        this.editOwners.delete(keyFor(identity));
        notifyPeers();
      },
    };
  }

  async read(hostId: string, threadId: string): Promise<StoredMessageEdit | null> {
    const identity = { hostId, threadId }, key = keyFor(identity), value = entries(await this.storage.read())[key];
    if (!this.observed.has(key)) this.observed.set(key, { serialized: JSON.stringify(value) });
    return stored(value, identity);
  }
  private async change(origin: MessageEditOrigin, update: (previous: StoredMessageEdit | null) => StoredMessageEdit | null): Promise<StoredMessageEdit | null> {
    const key = keyFor(origin);
    const observation = this.observed.get(key);
    let result: StoredMessageEdit | null = null;
    await this.storage.update(value => {
      const previous = entries(value), serialized = JSON.stringify(previous[key]);
      if (this.observed.get(key) !== observation || (observation && observation.serialized !== serialized)) {
        throw new Error('另一页面已更改此编辑。当前输入已保留，请刷新后核对恢复记录。');
      }
      const next = { ...previous };
      result = update(stored(previous[key], origin));
      if (result) next[key] = result; else delete next[key];
      return next;
    });
    // A later acquisition may have accepted a different baseline while this receipt was pending.
    if (this.observed.get(key) === observation) this.observed.set(key, { serialized: result ? JSON.stringify(result) : undefined });
    this.storage.changed();
    return result;
  }
  save(value: MessageEditRecovery | null, origin: MessageEditOrigin, version: MessageEditRecoveryVersion) {
    return this.change(origin, previous => {
      if (previous && !sameOrigin(previous.recovery.origin, origin)) throw new Error('此会话还有另一条未完成的编辑，已保留。');
      const old = previous?.recovery.editor;
      if (old && (old.sessionId !== version.sessionId || old.revision > version.revision)) {
        throw new Error('编辑版本已改变，原恢复记录已保留。');
      }
      if (!value) {
        if (old && old.revision !== version.revision) return previous;
        if (previous?.submission && !['prepared', 'started'].includes(previous.submission.stage)) {
          throw new Error('此编辑已回退或发送结果尚未核对；草稿已保留，请先检查结果或继续发送。');
        }
        return null;
      }
      if (!sameOrigin(value.origin, origin)) throw new Error('编辑草稿目标不一致。');
      return { ...previous, recovery: structuredClone(value) };
    }).then(() => {});
  }

  async prepareRebase(origin: MessageEditOrigin, version: MessageEditRecoveryVersion): Promise<MessageEditRebaseCandidate> {
    if (!this.options.hostChecksRebasedSourceBeforeRevert) {
      throw new Error('宿主尚未支持恢复编辑的写前来源核验；草稿已保留。');
    }
    const state = await this.read(origin.hostId, origin.threadId);
    requireRebasable(state, origin, version);
    const thread = await readRebaseHistory(this.client, origin);
    sourceForRebase(thread, state);
    return structuredClone({ origin, version, operationId: state.submission!.operationId,
      clientUserMessageId: state.submission!.request.clientUserMessageId, recovery: state.recovery, thread });
  }

  async commitRebase(candidate: MessageEditRebaseCandidate): Promise<MessageEditRecovery> {
    if (!this.options.hostChecksRebasedSourceBeforeRevert) {
      throw new Error('宿主尚未支持恢复编辑的写前来源核验；草稿已保留。');
    }
    const state = await this.read(candidate.origin.hostId, candidate.origin.threadId);
    requireRebasable(state, candidate.origin, candidate.version);
    if (state.submission!.operationId !== candidate.operationId || state.submission!.request.clientUserMessageId !== candidate.clientUserMessageId
      || !sameJson(state.recovery, candidate.recovery)) throw new Error('较新编辑或原发送状态已改变；草稿已保留。');
    const proposed = sourceForRebase(candidate.thread, state);
    const thread = await readRebaseHistory(this.client, candidate.origin);
    const actual = sourceForRebase(thread, state);
    if (!sameJson(thread.turns, candidate.thread.turns)
      || thread.turns[actual.turnIndex]!.id !== candidate.thread.turns[proposed.turnIndex]!.id
      || actual.item.id !== proposed.item.id || editSourceSignature(actual.item) !== editSourceSignature(proposed.item)) {
      throw new Error('核对期间会话历史已改变；草稿已保留，请重试。');
    }
    const next = await this.change(candidate.origin, previous => {
      requireRebasable(previous, candidate.origin, candidate.version);
      if (previous.submission!.operationId !== candidate.operationId || previous.submission!.request.clientUserMessageId !== candidate.clientUserMessageId
        || !sameJson(previous.recovery, candidate.recovery)) throw new Error('较新编辑或原发送状态已改变；草稿已保留。');
      const old = previous.recovery.editor!, item = actual.item, turn = thread.turns[actual.turnIndex]!;
      const origin: MessageEditOrigin = { hostId: candidate.origin.hostId, threadId: candidate.origin.threadId, turnId: turn.id, itemId: item.id,
        ...(typeof item.format === 'string' ? { format: item.format } : {}), ...(Array.isArray(item.hints) ? { hints: structuredClone(item.hints) } : {}) };
      return { recovery: { ...previous.recovery, origin, editor: { ...old, revision: old.revision + 1,
        snapshot: structuredClone(item), sourceSignature: editSourceSignature(item), turnIndex: actual.turnIndex, itemIndex: actual.itemIndex,
        requiresCurrentSource: true } } };
    });
    return structuredClone(next!.recovery);
  }

  async submit(origin: MessageEditOrigin, expectedTurnIds: string[], turnParams: Record<string, unknown>, assertCanDispatch?: () => void) {
    const existing = await this.read(origin.hostId, origin.threadId);
    let checkedRecovery: MessageEditRecovery | undefined;
    if (existing?.recovery.editor?.requiresCurrentSource && (!existing.submission || existing.submission.stage === 'prepared')) {
      if (!this.options.hostChecksRebasedSourceBeforeRevert) {
        throw new Error('宿主尚未支持恢复编辑的写前来源核验；草稿已保留，未发送。');
      }
      const thread = await readRebaseHistory(this.client, origin);
      requireCurrentRebaseTarget(thread, existing.recovery, expectedTurnIds);
      checkedRecovery = existing.recovery;
    }
    const operationId = crypto.randomUUID();
    let previousSubmission: StoredMessageEdit['submission'];
    const state = await this.change(origin, previous => {
      if (!previous || !sameOrigin(previous.recovery.origin, origin)) throw new Error('编辑恢复尚未保存，未修改会话。');
      const old = previous.submission;
      if (previous.recovery.editor?.requiresCurrentSource && (!old || old.stage === 'prepared')
        && (!checkedRecovery || !sameJson(previous.recovery, checkedRecovery))) {
        throw new Error('恢复编辑在核对期间发生变化；草稿已保留，未发送。');
      }
      if (old?.stage === 'started') return previous;
      previousSubmission = old && structuredClone(old);
      const editor = previous.recovery.editor;
      if (!editor) throw new Error('编辑版本尚未保存，未修改会话。');
      const sameVersion = old?.editorVersion?.sessionId === editor.sessionId && old.editorVersion.revision === editor.revision;
      const operation = old && ['revertUnknown', 'startUnknown', 'conflict'].includes(old.stage) ? 'check'
        : old?.stage === 'reverted' ? 'retry-start' : 'submit';
      if (editor.requiresCurrentSource && (operation === 'submit' || operation === 'retry-start' && !sameVersion)
        && !sameJson(turnParams.input, draftToInput(previous.recovery.draft, origin.hostId))) {
        throw new Error('待发送内容与保存的编辑版本不一致；草稿已保留，未发送。');
      }
      const checkedClientId = checkedRecovery?.editor?.snapshot.clientId;
      if (checkedRecovery && (typeof checkedClientId !== 'string' || !checkedClientId)) throw new Error('恢复编辑的来源身份无效，未发送。');
      const expectedSource: MessageEditExpectedSource | undefined = typeof checkedClientId === 'string' ? {
        clientUserMessageId: checkedClientId, signature: checkedRecovery!.editor!.sourceSignature,
      } : undefined;
      const request: EditMessageRequest & { expectedSource?: MessageEditExpectedSource } = operation === 'check' ? { ...old!.request, operation,
        ...(old!.stage === 'revertUnknown' || old!.stage === 'startUnknown' ? { unknownPhase: old!.stage } : {}) }
        : operation === 'retry-start' ? { ...old!.request, operation, unknownPhase: undefined,
            // A known rejected start is terminal. The user's newer edit is a new
            // request against the already reverted prefix, never a replay of A.
            ...(!sameVersion ? { clientUserMessageId: crypto.randomUUID(), turnParams: structuredClone(turnParams) } : {}) }
          : { origin: structuredClone(origin), expectedTurnIds: old?.request.expectedTurnIds ?? [...expectedTurnIds],
            clientUserMessageId: crypto.randomUUID(), turnParams: structuredClone(turnParams), operation,
            ...(expectedSource ? { expectedSource } : {}) };
      const editorVersion = operation === 'check' || operation === 'retry-start' && sameVersion ? old!.editorVersion
        : { sessionId: editor.sessionId, revision: editor.revision };
      return { ...previous, submission: { request, operationId, ...(editorVersion ? { editorVersion } : {}),
        stage: operation === 'check' ? old!.stage : operation === 'retry-start' ? 'startUnknown' : 'revertUnknown' } };
    });
    const pending = state!.submission!;
    const operation = pending.request.operation;
    if (pending.stage === 'started') return this.confirmStarted(state!);
    // The uncertain phase is durable before crossing the browser/host boundary.
    try {
      const assertion: unknown = assertCanDispatch?.();
      if (assertion && (typeof assertion === 'object' || typeof assertion === 'function')
        && typeof (assertion as { then?: unknown }).then === 'function') {
        void Promise.resolve(assertion).catch(() => {});
        throw new Error('派发前检查必须同步完成，未发送。');
      }
    } catch (reason) {
      try {
        await this.change(origin, previous => {
          if (previous?.submission?.operationId !== operationId) throw new Error('编辑恢复记录已改变，未覆盖。');
          if (previousSubmission) return { ...previous, submission: previousSubmission };
          const { submission: _submission, ...withoutSubmission } = previous;
          return withoutSubmission;
        });
      } catch (restoreError) {
        throw new Error('派发前检查失败，恢复阶段未能写回；原记录已保留，请先核对。', { cause: restoreError });
      }
      throw reason;
    }
    const response = await this.client.host<EditMessageResult>('message-edit', { hostId: origin.hostId, threadId: origin.threadId,
      ...pending.request });
    if (!['prepared', 'reverted', 'revertUnknown', 'startUnknown', 'started', 'conflict'].includes(response.stage)) {
      throw new Error('编辑结果无法确认，恢复记录已保留；请检查结果，勿重复发送。');
    }
    // Older hosts may infer success from an unchanged snapshot. A check is read-only
    // and only a matching clientId can resolve this request as started.
    const checkedStage = operation === 'check' && response.stage !== 'started' ? pending.stage : response.stage;
    const completed = await this.change(origin, previous => {
      if (previous?.submission?.operationId !== operationId) throw new Error('编辑结果已过期，未覆盖恢复记录。');
      return { ...previous, submission: { ...previous.submission, stage: checkedStage, ...(checkedStage === 'started' && response.turn ? { turn: response.turn } : {}) } };
    });
    if (checkedStage === 'started') return this.confirmStarted(completed!);
    if (operation === 'check') throw new Error('原操作结果尚未确认，可能仍会迟到；草稿已保留，未重发。');
    throw new Error(response.error || '编辑结果尚未确认，草稿已保留；再次点击先检查结果。');
  }

  private confirmStarted(state: StoredMessageEdit) {
    const sent = state.submission!, editor = state.recovery.editor, version = sent.editorVersion;
    if (!editor || !version || editor.sessionId !== version.sessionId || editor.revision !== version.revision) {
      // Resolving an older request is not confirmation that the visible draft was sent.
      // Reject the hook's success path so it cannot clear that newer editor version.
      throw new Error('已核对：较早版本已发送；当前较新草稿未发送，已保留。请先核对会话，再决定如何处理此草稿。');
    }
    return { turn: sent.turn };
  }
}
