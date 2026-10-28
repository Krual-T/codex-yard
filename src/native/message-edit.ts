import { record } from './protocol.ts';
import type { ObjectValue } from './protocol.ts';
import type { ThreadItemSummary, TurnSummary } from '../../lib/codex-protocol.ts';
import type { MessageEditOrigin } from '../renderer/workbench-contract.ts';

interface Connection { request(method: string, params: ObjectValue, options?: { mutating: boolean }): Promise<unknown> }
export type EditStage = 'prepared' | 'reverted' | 'revertUnknown' | 'startUnknown' | 'started' | 'conflict';
export interface EditMessageRequest {
  origin: MessageEditOrigin;
  expectedTurnIds: string[];
  clientUserMessageId: string;
  turnParams: ObjectValue;
  operation: 'submit' | 'retry-start' | 'check';
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
    cursor = typeof page.nextCursor === 'string' && page.nextCursor ? page.nextCursor : null;
    if (cursor && seen.has(cursor)) throw new Error('消息内容分页未前进，编辑已保留。');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return result;
}
function failure(stage: EditStage, error: unknown): EditMessageResult {
  return { stage, error: error instanceof Error ? error.message : String(error) };
}

/** Caller holds the same Yard write interval as turn/start, revert and queue/start.
 * External daemon clients cannot be made atomic by this host; verify each phase.
 */
export async function editMessage(connection: Connection, hostId: string, threadId: string, value: unknown): Promise<EditMessageResult> {
  const request = record(value), origin = record(request.origin);
  if (origin.hostId !== hostId || origin.threadId !== threadId || typeof origin.turnId !== 'string' || !origin.turnId
    || typeof origin.itemId !== 'string' || !origin.itemId || !Array.isArray(request.expectedTurnIds)
    || request.expectedTurnIds.some(id => typeof id !== 'string') || typeof request.clientUserMessageId !== 'string' || !request.clientUserMessageId
    || !['submit', 'retry-start', 'check'].includes(String(request.operation))) throw new Error('编辑目标身份无效，未修改会话。');
  const expected = request.expectedTurnIds as string[], index = expected.indexOf(origin.turnId);
  if (index < 0 || new Set(expected).size !== expected.length) throw new Error('编辑来源历史无效，未修改会话。');
  const input = record(request.turnParams);
  if (!Array.isArray(input.input) || !input.input.length) throw new Error('编辑消息为空，未修改会话。');
  const current = await turns(connection, threadId);
  const metadata = record(record(await connection.request('thread/read', { threadId, includeTurns: false })).thread);
  const idle = record(metadata.status).type === 'idle' && current.every(turn => turn.status !== 'inProgress');
  const prefix = expected.slice(0, index);
  if (request.operation === 'check') {
    // clientId is the protocol UserMessage.clientId corresponding to turn/start's clientUserMessageId.
    for (const turn of current.slice(index)) {
      if ((await items(connection, threadId, turn.id)).some(item => item.type === 'userMessage' && item.clientId === request.clientUserMessageId)) return { stage: 'started', turn };
    }
    if (idle && idsEqual(current, expected)) return { stage: 'prepared' };
    if (idle && idsEqual(current, prefix)) return { stage: 'reverted' };
    return { stage: 'conflict', error: '会话记录已改变或仍在运行，请核对记录；编辑内容已保留，未重发。' };
  }
  if (!idle) throw new Error('会话仍在运行或状态未知，编辑已保留，未修改历史。');
  if (request.operation === 'retry-start') {
    if (!idsEqual(current, prefix)) return { stage: 'conflict', error: '回退后的记录已改变，请核对会话；未再次回退或发送。' };
  } else {
    if (!idsEqual(current, expected)) throw new Error('会话历史已改变，请重新核对编辑目标。');
    for (const [offset, turn] of current.slice(index).entries()) {
      const users = (await items(connection, threadId, turn.id)).filter(item => item.type === 'userMessage');
      if (offset === 0 ? users.length !== 1 || users[0]!.id !== origin.itemId : users.length > 0) throw new Error('只能编辑最后一条已完成的用户消息。');
    }
    try { await connection.request('thread/revert', { threadId, beforeTurnId: origin.turnId }, { mutating: true }); }
    catch (error) { return failure(record(error).uncertain === true ? 'revertUnknown' : 'prepared', error); }
  }
  try {
    const result = record(await connection.request('turn/start', { ...input, threadId,
      clientUserMessageId: request.clientUserMessageId, turnTrigger: 'edit_user_message' }, { mutating: true }));
    return { stage: 'started', turn: result.turn as TurnSummary };
  } catch (error) { return failure(record(error).uncertain === true ? 'startUnknown' : 'reverted', error); }
}
