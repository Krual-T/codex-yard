import type { CodexConnection } from '../../lib/codex.ts';
import { errorMessage, isRecord } from '../../lib/codex-protocol.ts';
import type { Page, ThreadReadState, ThreadResponse, TurnSummary } from '../../lib/codex-protocol.ts';

export interface AutomationThread {
  thread: ThreadResponse['thread'];
  readState: ThreadReadState | null;
  turns: TurnSummary[];
  turn: TurnSummary | undefined;
}

/** Read the scheduled turn by its durable client ID if its write reply was lost. */
export async function readAutomationThread(connection: CodexConnection, run: { id: string; threadId: string; turnId: string | null }): Promise<AutomationThread> {
  const { thread, readState } = await connection.request('thread/read', { threadId: run.threadId, includeTurns: false });
  const turns: TurnSummary[] = [], cursors = new Set<string>();
  let cursor: string | null = null;
  do {
    const page: Page<TurnSummary> = await connection.request('thread/turns/list', { threadId: run.threadId,
      limit: 100, sortDirection: 'asc', itemsView: 'summary', ...(cursor ? { cursor } : {}) });
    turns.push(...page.data); cursor = page.nextCursor;
    if (cursor && cursors.has(cursor)) throw new Error('会话分页游标未前进。');
    if (cursor) cursors.add(cursor);
  } while (cursor);
  const turn = run.turnId ? turns.find(turn => turn.id === run.turnId)
    : turns.find(turn => turn.items.some(item => item.type === 'userMessage' && item.clientId === run.id));
  return { thread, readState: readState ?? null, turns, turn };
}

export function automationTurnResult(turn: TurnSummary, waiting = false) {
  return {
    status: turn.status === 'inProgress' ? waiting ? 'waiting' as const : 'running' as const
      : turn.status === 'completed' ? 'completed' as const : 'failed' as const,
    summary: turn.items.filter(item => item.type === 'agentMessage' && typeof item.text === 'string')
      .map(item => item.text).join('\n').slice(0, 1000) || null,
    error: turn.error?.message ?? (turn.status === 'interrupted' ? '本次执行已中断。' : null),
  };
}

/** A newer unread turn does not make an earlier scheduled result unread again. */
export function automationTurnIsRead(value: AutomationThread): boolean | null {
  if (!value.readState) return null;
  const first = value.readState.firstUnread;
  if (!first) return true;
  if (first.type === 'threadStart') return false;
  const position = value.turns.findIndex(turn => turn.id === first.turnId);
  const scheduled = value.turns.findIndex(turn => turn.id === value.turn?.id);
  return position >= 0 && scheduled >= 0 ? scheduled < position : null;
}

/** Only explicit not-found responses establish deletion; connection failures do not. */
export function automationThreadMissing(error: unknown) {
  return isRecord(error) && error.code === -32600 &&
    /thread.*(?:not found|was not found|does not exist)|no rollout found (?:for|with).*thread/i.test(errorMessage(error));
}

export async function archivedAutomationThreads(connection: CodexConnection, cwds: string[]) {
  const ids = new Set<string>(), cursors = new Set<string>();
  let cursor: string | null = null;
  do {
    const page: Page<{ id: string }> = await connection.request('thread/list', { archived: true, limit: 100,
      useStateDbOnly: true, sourceKinds: [], modelProviders: [], ...(cwds.length ? { cwd: cwds } : {}), ...(cursor ? { cursor } : {}) });
    page.data.forEach(thread => ids.add(thread.id)); cursor = page.nextCursor;
    if (cursor && cursors.has(cursor)) throw new Error('归档会话分页游标未前进。');
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return ids;
}
