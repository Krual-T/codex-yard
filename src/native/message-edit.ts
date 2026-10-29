import { record } from './protocol.ts';
import type { ObjectValue } from './protocol.ts';
import { RpcError } from '../../lib/codex.ts';
import type { ThreadItemSummary, TurnSummary } from '../../lib/codex-protocol.ts';
import type { MessageEditOrigin } from '../renderer/workbench-contract.ts';

interface Connection { request(method: string, params: ObjectValue, options?: { mutating: boolean }): Promise<unknown> }
/** Captured by the host before enqueueing, against the original page and daemon socket. */
export interface MessageEditConnectionBinding { assertOriginal(): void }
export type EditStage = 'prepared' | 'reverted' | 'revertUnknown' | 'startUnknown' | 'started' | 'conflict';
export interface EditMessageRequest {
  origin: MessageEditOrigin;
  expectedTurnIds: string[];
  clientUserMessageId: string;
  turnParams: ObjectValue;
  operation: 'submit' | 'retry-start' | 'check';
  /** The phase whose original write may still arrive after a timeout. */
  unknownPhase?: 'revertUnknown' | 'startUnknown';
  /** A user-approved rebase must still refer to this exact completed message. */
  expectedSource?: { clientUserMessageId: string; signature: string };
}
export interface EditMessageResult { stage: EditStage; turn?: TurnSummary; error?: string }

function idsEqual(turns: { id: string }[], expected: string[]) {
  return turns.length === expected.length && turns.every((turn, index) => turn.id === expected[index]);
}
async function turns(connection: Connection, threadId: string): Promise<TurnSummary[]> {
  const result: TurnSummary[] = [], seen = new Set<string>();
  let cursor: string | null = null;
  do {
    const page = record(await connection.request('thread/turns/list', { threadId, cursor, limit: 100, sortDirection: 'asc', itemsView: 'summary' }));
    if (!Array.isArray(page.data) || page.data.some(value => typeof record(value).id !== 'string')) throw new Error('无法核对完整会话历史，编辑已保留。');
    result.push(...page.data as TurnSummary[]);
    if (page.nextCursor !== undefined && page.nextCursor !== null && typeof page.nextCursor !== 'string') throw new Error('会话历史游标无效，未修改记录。');
    cursor = typeof page.nextCursor === 'string' && page.nextCursor ? page.nextCursor : null;
    if (cursor && seen.has(cursor)) throw new Error('会话历史分页未前进，编辑已保留。');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return result;
}
async function items(connection: Connection, threadId: string, turnId: string): Promise<ThreadItemSummary[]> {
  const result: ThreadItemSummary[] = [], seen = new Set<string>();
  let cursor: string | null = null;
  do {
    const page = record(await connection.request('thread/items/list', { threadId, turnId, cursor, limit: 100, sortDirection: 'asc' }));
    if (!Array.isArray(page.data) || page.data.some(value => typeof record(record(value).item).id !== 'string')) throw new Error('无法核对消息内容，编辑已保留。');
    result.push(...page.data.map(value => record(value).item as ThreadItemSummary));
    if (page.nextCursor !== undefined && page.nextCursor !== null && typeof page.nextCursor !== 'string') throw new Error('消息内容游标无效，未修改记录。');
    cursor = typeof page.nextCursor === 'string' && page.nextCursor ? page.nextCursor : null;
    if (cursor && seen.has(cursor)) throw new Error('消息内容分页未前进，编辑已保留。');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return result;
}
function failure(stage: EditStage, error: unknown): EditMessageResult {
  return { stage, error: error instanceof Error ? error.message : String(error) };
}

function parseRequest(hostId: string, threadId: string, value: unknown) {
  const request = record(value), origin = record(request.origin);
  if (origin.hostId !== hostId || origin.threadId !== threadId || typeof origin.turnId !== 'string' || !origin.turnId
    || typeof origin.itemId !== 'string' || !origin.itemId || !Array.isArray(request.expectedTurnIds)
    || request.expectedTurnIds.some(id => typeof id !== 'string') || typeof request.clientUserMessageId !== 'string' || !request.clientUserMessageId
    || typeof request.operation !== 'string' || !['submit', 'retry-start', 'check'].includes(request.operation)
    || (request.unknownPhase !== undefined && (request.operation !== 'check'
      || (request.unknownPhase !== 'revertUnknown' && request.unknownPhase !== 'startUnknown')))) throw new Error('编辑目标身份无效，未修改会话。');
  const expected = request.expectedTurnIds as string[], index = expected.indexOf(origin.turnId);
  if (index < 0 || new Set(expected).size !== expected.length) throw new Error('编辑来源历史无效，未修改会话。');
  const input = record(request.turnParams);
  if (!Array.isArray(input.input) || !input.input.length) throw new Error('编辑消息为空，未修改会话。');
  const expectedSource = request.expectedSource === undefined ? null : record(request.expectedSource);
  if (expectedSource && (typeof expectedSource.clientUserMessageId !== 'string' || !expectedSource.clientUserMessageId
    || typeof expectedSource.signature !== 'string' || !expectedSource.signature)) throw new Error('编辑恢复的来源核对无效，未修改会话。');
  return { request, origin, expected, index, input, expectedSource };
}

function beforeWriteFailure(request: ObjectValue, error: unknown): EditMessageResult {
  const stage = request.operation === 'submit' ? 'prepared' : request.operation === 'retry-start' ? 'reverted'
    : request.unknownPhase === 'revertUnknown' || request.unknownPhase === 'startUnknown' ? request.unknownPhase : 'conflict';
  return failure(stage, error);
}

/** Only call before entering the write interval; a later failure may already have written. */
export function editMessageBeforeWriteFailure(hostId: string, threadId: string, value: unknown, error: unknown): EditMessageResult {
  return beforeWriteFailure(parseRequest(hostId, threadId, value).request, error);
}

class BeforeDispatchError extends Error {}

function guardedConnection(connection: Connection, binding?: MessageEditConnectionBinding): Connection {
  return { request(method, params, options) {
    try {
      if (!binding) throw new Error('原页面和 daemon 连接未绑定，未发送编辑。');
      const result: unknown = binding.assertOriginal();
      if (result && (typeof result === 'object' || typeof result === 'function')
        && typeof (result as { then?: unknown }).then === 'function') {
        void Promise.resolve(result).catch(() => {});
        throw new Error('原连接检查必须同步完成，未发送编辑。');
      }
    } catch (error) { throw new BeforeDispatchError(error instanceof Error ? error.message : String(error), { cause: error }); }
    return connection.request(method, params, options);
  } };
}

function definitelyRejected(error: unknown): boolean {
  // CodexConnection gives daemon error replies a protocol code and status 502;
  // transport failures or a bare uncertain:false do not establish a rejection.
  return error instanceof BeforeDispatchError || error instanceof RpcError && !error.uncertain && error.status === 502
    && (typeof error.code === 'number' || typeof error.code === 'string');
}

/** Read every history/item page and match the protocol's exact user clientId. */
export async function findSentMessage(connection: Connection, threadId: string, clientUserMessageId: string) {
  if (!threadId || !clientUserMessageId) throw new Error('核对发送需要原会话及请求身份。');
  for (const turn of await turns(connection, threadId)) {
    if ((await items(connection, threadId, turn.id)).some(item => item.type === 'userMessage' && item.clientId === clientUserMessageId)) return { turnId: turn.id };
  }
  // Absence is not proof that a previously issued request cannot still arrive.
  return { turnId: null };
}

/** Caller holds the same Yard write interval as turn/start, revert and queue/start.
 * External daemon clients cannot be made atomic by this host; verify each phase.
 */
export async function editMessage(connection: Connection, hostId: string, threadId: string, value: unknown,
  binding?: MessageEditConnectionBinding): Promise<EditMessageResult> {
  const { request, origin, expected, index, input, expectedSource } = parseRequest(hostId, threadId, value);
  const bound = guardedConnection(connection, binding);
  try {
    const current = await turns(bound, threadId);
    const metadata = record(record(await bound.request('thread/read', { threadId, includeTurns: false })).thread);
    const idle = record(metadata.status).type === 'idle' && current.every(turn => turn.status !== 'inProgress');
    const prefix = expected.slice(0, index);
    if (request.operation === 'check') {
      // clientId is the protocol UserMessage.clientId corresponding to turn/start's clientUserMessageId.
      for (const turn of current.slice(index)) {
        if ((await items(bound, threadId, turn.id)).some(item => item.type === 'userMessage' && item.clientId === request.clientUserMessageId)) return { stage: 'started', turn };
      }
      // An unchanged snapshot does not cancel or establish the outcome of an earlier write.
      return beforeWriteFailure(request, '原操作结果尚未确认，可能仍会迟到；编辑内容已保留，未重发。');
    }
    if (!idle) throw new Error('会话仍在运行或状态未知，编辑已保留，未修改历史。');
    if (request.operation === 'retry-start') {
      if (!idsEqual(current, prefix)) throw new Error('回退后的记录已改变，请核对会话；未再次回退或发送。');
    } else {
      if (!idsEqual(current, expected)) throw new Error('会话历史已改变，请重新核对编辑目标。');
      for (const [offset, turn] of current.slice(index).entries()) {
        const users = (await items(bound, threadId, turn.id)).filter(item => item.type === 'userMessage');
        if (offset === 0 ? users.length !== 1 || users[0]!.id !== origin.itemId : users.length > 0) throw new Error('只能编辑最后一条已完成的用户消息。');
        if (offset === 0 && expectedSource) {
          const source = record(users[0]);
          if (turn.status !== 'completed' || source.clientId !== expectedSource.clientUserMessageId
            || JSON.stringify([source.content, source.document, source.format, source.hints]) !== expectedSource.signature) {
            throw new Error('编辑恢复的原消息已改变或尚未完成，请重新核对；较新草稿已保留，未回退或发送。');
          }
        }
      }
    }
  } catch (error) { return beforeWriteFailure(request, error); }
  if (request.operation === 'submit') {
    try { await bound.request('thread/revert', { threadId, beforeTurnId: origin.turnId }, { mutating: true }); }
    catch (error) { return failure(definitelyRejected(error) ? 'prepared' : 'revertUnknown', error); }
  }
  try {
    const result = record(await bound.request('turn/start', { ...input, threadId,
      clientUserMessageId: request.clientUserMessageId, turnTrigger: 'edit_user_message' }, { mutating: true }));
    return { stage: 'started', turn: result.turn as TurnSummary };
  } catch (error) { return failure(definitelyRejected(error) ? 'reverted' : 'startUnknown', error); }
}
