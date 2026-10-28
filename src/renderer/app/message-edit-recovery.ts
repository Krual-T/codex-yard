import type { TurnSummary } from '../../../lib/codex-protocol.ts';
import type { EditMessageRequest, EditMessageResult, EditStage } from '../../native/message-edit.ts';
import type { MessageEditOrigin, WorkbenchClient } from '../workbench-contract.ts';
import type { MessageEditRecovery, MessageEditRecoveryVersion } from '../messages/use-message-editing.ts';
import { readBrowserAtom, updateBrowserAtom } from '../storage/ui-atoms.ts';

export const messageEditsAtom = 'codex-yard.message-edits.v1';
export const messageEditChanged = 'yard-message-edit-updated';
export interface StoredMessageEdit {
  recovery: MessageEditRecovery;
  submission?: { request: EditMessageRequest; stage: EditStage; operationId: string;
    /** The editor version actually sent, retained unchanged by read-only checks. */
    editorVersion?: MessageEditRecoveryVersion; turn?: TurnSummary };
}
export interface EditRecoveryStorage {
  read(): unknown | Promise<unknown>;
  update(change: (previous: unknown) => unknown): Promise<unknown>;
  changed(): void;
}
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
  }
  return structuredClone(value) as unknown as StoredMessageEdit;
}

/** Recovery is UI data in native-atoms. Codex remains the conversation authority. */
export class MessageEditRecoveryStore {
  private observed = new Map<string, string | undefined>();
  private readonly client: WorkbenchClient;
  private readonly storage: EditRecoveryStorage;
  constructor(client: WorkbenchClient, storage: EditRecoveryStorage = browserStorage) { this.client = client; this.storage = storage; }

  async read(hostId: string, threadId: string): Promise<StoredMessageEdit | null> {
    const identity = { hostId, threadId }, key = keyFor(identity), value = entries(await this.storage.read())[key];
    if (!this.observed.has(key)) this.observed.set(key, JSON.stringify(value));
    return stored(value, identity);
  }
  private async change(origin: MessageEditOrigin, update: (previous: StoredMessageEdit | null) => StoredMessageEdit | null): Promise<StoredMessageEdit | null> {
    const key = keyFor(origin);
    let result: StoredMessageEdit | null = null;
    await this.storage.update(value => {
      const previous = entries(value), serialized = JSON.stringify(previous[key]);
      if (this.observed.has(key) && this.observed.get(key) !== serialized) {
        throw new Error('另一页面已更改此编辑。当前输入已保留，请刷新后核对恢复记录。');
      }
      const next = { ...previous };
      result = update(stored(previous[key], origin));
      if (result) next[key] = result; else delete next[key];
      return next;
    });
    this.observed.set(key, result ? JSON.stringify(result) : undefined);
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

  async submit(origin: MessageEditOrigin, expectedTurnIds: string[], turnParams: Record<string, unknown>) {
    const operationId = crypto.randomUUID();
    const state = await this.change(origin, previous => {
      if (!previous || !sameOrigin(previous.recovery.origin, origin)) throw new Error('编辑恢复尚未保存，未修改会话。');
      const old = previous.submission;
      if (old?.stage === 'started') return previous;
      const operation = old && ['revertUnknown', 'startUnknown', 'conflict'].includes(old.stage) ? 'check'
        : old?.stage === 'reverted' ? 'retry-start' : 'submit';
      const request: EditMessageRequest = operation === 'check' ? { ...old!.request, operation }
        : { origin: structuredClone(origin), expectedTurnIds: old?.request.expectedTurnIds ?? [...expectedTurnIds],
          clientUserMessageId: crypto.randomUUID(), turnParams: structuredClone(turnParams), operation };
      const editor = previous.recovery.editor;
      if (!editor) throw new Error('编辑版本尚未保存，未修改会话。');
      const editorVersion = operation === 'check' ? old!.editorVersion : { sessionId: editor.sessionId, revision: editor.revision };
      return { ...previous, submission: { request, operationId, ...(editorVersion ? { editorVersion } : {}),
        stage: operation === 'check' ? old!.stage : operation === 'retry-start' ? 'startUnknown' : 'revertUnknown' } };
    });
    const pending = state!.submission!;
    const operation = pending.request.operation;
    if (pending.stage === 'started') return this.confirmStarted(state!);
    // The uncertain phase is durable before crossing the browser/host boundary.
    const response = await this.client.host<EditMessageResult>('message-edit', { hostId: origin.hostId, threadId: origin.threadId,
      ...pending.request });
    if (!['prepared', 'reverted', 'revertUnknown', 'startUnknown', 'started', 'conflict'].includes(response.stage)) {
      throw new Error('编辑结果无法确认，恢复记录已保留；请检查结果，勿重复发送。');
    }
    const completed = await this.change(origin, previous => {
      if (previous?.submission?.operationId !== operationId) throw new Error('编辑结果已过期，未覆盖恢复记录。');
      return { ...previous, submission: { ...previous.submission, stage: response.stage, ...(response.turn ? { turn: response.turn } : {}) } };
    });
    if (response.stage === 'started') return this.confirmStarted(completed!);
    if (operation === 'check' && (response.stage === 'prepared' || response.stage === 'reverted')) {
      throw new Error(response.stage === 'reverted' ? '已核对：原消息已回退，尚未开始新任务。草稿已保留，再次发送只启动新任务。'
        : '已核对：原消息仍在，未发送编辑。草稿已保留，可再次发送。');
    }
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
