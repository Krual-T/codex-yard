import type { ComposerDraft, SubmitOptions, WorkbenchClient } from '../workbench-contract.ts';
import type { ThreadSummary } from '../../../lib/codex-protocol.ts';
import { readBrowserAtom, updateBrowserAtom } from '../storage/ui-atoms.ts';

export const sendsAtom = 'codex-yard.send-recovery.v1';
export interface SendOwner { hostId: string; threadId: string | null; draftId: string }
export interface SendVersion { owner: SendOwner; revision: string }
export type SendStage = 'prepared' | 'creating' | 'ready' | 'sending' | 'unknown' | 'failed' | 'confirmed';
export interface SendIntent extends SendVersion {
  id: string;
  clientUserMessageId: string;
  threadId: string | null;
  cwd: string;
  projectId?: string;
  additionalContext?: Record<string, { kind: 'untrusted'; value: string }>;
  /** Immutable submitted version, not another editable draft. */
  draft: ComposerDraft;
  options: SubmitOptions;
  overrides: Partial<SubmitOptions>;
  stage: SendStage;
  error?: string;
  turnId?: string;
  /** Only an actual thread/start response grants this empty-history phase. */
  created?: { thread: ThreadSummary; settings: SubmitOptions };
}
interface CreationReceipt { owner: SendOwner; thread: ThreadSummary; settings: SubmitOptions }
export interface SendRecoverySnapshot { requests: Record<string, SendIntent>; bindings: Record<string, string>; creations: Record<string, CreationReceipt> }
interface Storage { read(): Promise<unknown>; update(change: (value: unknown) => unknown): Promise<unknown> }
const browserStorage: Storage = { read: () => readBrowserAtom(sendsAtom), update: change => updateBrowserAtom(sendsAtom, change) };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const stages: SendStage[] = ['prepared', 'creating', 'ready', 'sending', 'unknown', 'failed', 'confirmed'];
export const sendOwnerKey = (owner: Pick<SendOwner, 'hostId' | 'draftId'>) => JSON.stringify([owner.hostId, owner.draftId]);
export const sendThreadKey = (hostId: string, threadId: string) => JSON.stringify([hostId, threadId]);

function snapshot(value: unknown): SendRecoverySnapshot {
  if (value === undefined) return { requests: {}, bindings: {}, creations: {} };
  if (!object(value) || !object(value.requests) || !object(value.bindings)) throw new Error('发送恢复记录无法识别，原值已保留。');
  for (const [id, request] of Object.entries(value.requests)) {
    if (!object(request) || request.id !== id || typeof request.clientUserMessageId !== 'string' || !request.clientUserMessageId
      || !object(request.owner) || typeof request.owner.hostId !== 'string' || typeof request.owner.draftId !== 'string'
      || !(request.owner.threadId === null || typeof request.owner.threadId === 'string')
      || !(request.threadId === null || typeof request.threadId === 'string') || typeof request.revision !== 'string'
      || typeof request.cwd !== 'string' || !object(request.draft) || typeof request.draft.text !== 'string'
      || !Array.isArray(request.draft.images) || !Array.isArray(request.draft.files) || !object(request.options)
      || !object(request.overrides) || request.projectId !== undefined && typeof request.projectId !== 'string'
      || !stages.includes(request.stage as SendStage)) throw new Error('发送恢复内容无法安全读取，原值已保留。');
    if (request.additionalContext !== undefined && (!object(request.additionalContext)
      || Object.values(request.additionalContext).some(entry => !object(entry) || entry.kind !== 'untrusted' || typeof entry.value !== 'string'))) {
      throw new Error('发送上下文无法安全读取，原值已保留。');
    }
    if (request.created !== undefined && (!object(request.created) || !object(request.created.thread)
      || request.created.thread.id !== request.threadId || !object(request.created.settings))) throw new Error('新会话创建回执无效，原值已保留。');
  }
  if (Object.values(value.bindings).some(id => typeof id !== 'string')) throw new Error('发送草稿身份记录无效，原值已保留。');
  const creations = value.creations ?? {};
  if (!object(creations) || Object.entries(creations).some(([key, receipt]) => !object(receipt) || !object(receipt.owner)
    || typeof receipt.owner.hostId !== 'string' || typeof receipt.owner.draftId !== 'string' || receipt.owner.threadId !== null
    || !object(receipt.thread) || typeof receipt.thread.id !== 'string' || key !== sendThreadKey(receipt.owner.hostId, receipt.thread.id)
    || !object(receipt.settings))) throw new Error('新会话阶段记录无效，原值已保留。');
  return structuredClone({ ...value, creations }) as unknown as SendRecoverySnapshot;
}

/** Keeps one request identity across route changes, reload and uncertain replies. */
export class SendRecoveryStore {
  private readonly client: WorkbenchClient;
  private readonly storage: Storage;
  constructor(client: WorkbenchClient, storage: Storage = browserStorage) {
    this.client = client;
    this.storage = storage;
  }
  async read() { return snapshot(await this.storage.read()); }
  private async change(update: (value: SendRecoverySnapshot) => void): Promise<SendRecoverySnapshot> {
    let result!: SendRecoverySnapshot;
    await this.storage.update(value => { result = snapshot(value); update(result); return result; });
    return result;
  }
  async prepare(version: SendVersion, cwd: string, draft: ComposerDraft, options: SubmitOptions, overrides: Partial<SubmitOptions>, projectId?: string,
    additionalContext?: SendIntent['additionalContext']) {
    const intent: SendIntent = { ...structuredClone(version), id: crypto.randomUUID(), clientUserMessageId: crypto.randomUUID(),
      threadId: version.owner.threadId, cwd, draft: structuredClone(draft), options: structuredClone(options),
      overrides: structuredClone(overrides), stage: 'prepared', ...(projectId ? { projectId } : {}),
      ...(additionalContext && Object.keys(additionalContext).length ? { additionalContext: structuredClone(additionalContext) } : {}) };
    await this.change(state => {
      if (Object.values(state.requests).some(value => sendOwnerKey(value.owner) === sendOwnerKey(version.owner))) {
        throw new Error('此草稿还有待核对的发送结果，请先处理恢复记录。');
      }
      state.requests[intent.id] = intent;
    });
    return intent;
  }
  private async update(id: string, change: (intent: SendIntent, state: SendRecoverySnapshot) => void) {
    const state = await this.change(value => {
      const intent = value.requests[id];
      if (!intent) throw new Error('发送恢复记录已在另一页面处理，请刷新核对。');
      change(intent, value);
    });
    return state.requests[id]!;
  }
  creating(id: string) { return this.update(id, intent => {
    if (!['prepared', 'failed'].includes(intent.stage) || intent.threadId) throw new Error('会话创建阶段已改变，未重复创建。');
    intent.stage = 'creating';
  }); }
  created(id: string, threadId: string, created?: SendIntent['created']) { return this.update(id, (intent, state) => {
    if (intent.stage !== 'creating' || !threadId || intent.threadId) throw new Error('会话创建身份已改变，请核对原请求。');
    const key = sendThreadKey(intent.owner.hostId, threadId), previous = state.bindings[key];
    if (previous !== undefined && previous !== intent.owner.draftId) throw new Error('新会话已关联另一草稿，原记录已保留。');
    state.bindings[key] = intent.owner.draftId;
    intent.threadId = threadId; intent.stage = 'ready';
    if (created) {
      intent.created = structuredClone(created);
      state.creations[key] = structuredClone({ ...created, owner: intent.owner });
    }
  }); }
  sending(id: string) { return this.update(id, intent => {
    if (!intent.threadId || !['prepared', 'ready', 'failed'].includes(intent.stage)) throw new Error('发送阶段尚未核对，未重复发送。');
    intent.stage = 'sending'; delete intent.error;
  }); }
  failed(id: string, error: unknown) { return this.update(id, intent => {
    // A confirmed success can never be downgraded by a late failed check.
    if (intent.stage === 'confirmed') return;
    const uncertain = ['creating', 'sending', 'unknown'].includes(intent.stage) && (!object(error) || error.uncertain !== false);
    intent.stage = uncertain ? 'unknown' : 'failed';
    intent.error = error instanceof Error ? error.message : String(error);
  }); }
  confirmed(id: string, turnId: string) { return this.update(id, (intent, state) => {
    if (!intent.threadId || !turnId) throw new Error('缺少已发送消息身份，草稿已保留。');
    intent.stage = 'confirmed'; intent.turnId = turnId; delete intent.error;
    delete state.creations[sendThreadKey(intent.owner.hostId, intent.threadId)];
  }); }
  async check(id: string) {
    const intent = (await this.read()).requests[id];
    if (!intent) throw new Error('发送恢复记录已处理。');
    if (intent.stage === 'confirmed') return intent;
    if (!intent.threadId) throw new Error('创建会话的结果尚未确认。请核对会话列表；不会重新创建或发送。');
    const result = await this.client.host<{ turnId: string | null }>('message-send-status', {
      hostId: intent.owner.hostId, threadId: intent.threadId, clientUserMessageId: intent.clientUserMessageId,
    });
    if (result.turnId) return this.confirmed(id, result.turnId);
    return this.update(id, current => {
      if (current.stage !== 'confirmed') {
        current.stage = 'unknown'; current.error = '完整历史尚未找到原请求；结果仍未知，原稿已保留，不会重发。';
      }
    });
  }
  /** Caller has cleared exactly this submitted revision, or explicitly retained it. */
  async dismiss(id: string, expected: SendVersion) {
    await this.change(state => {
      const intent = state.requests[id];
      if (!intent) return;
      if (intent.stage !== 'confirmed' || sendOwnerKey(intent.owner) !== sendOwnerKey(expected.owner)
        || intent.revision !== expected.revision) throw new Error('发送结果或版本尚未确认，原记录已保留。');
      delete state.requests[id];
    });
  }
  /** Explicitly cancel only a request whose write has not started or was rejected. */
  async cancel(id: string) {
    await this.change(state => {
      const intent = state.requests[id];
      if (!intent) return;
      if (!['prepared', 'ready', 'failed'].includes(intent.stage)) throw new Error('发送结果尚未核对，恢复记录已保留。');
      delete state.requests[id];
    });
  }
}
