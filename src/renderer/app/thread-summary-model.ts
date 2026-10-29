import type { ThreadSummary } from '../../../lib/codex-protocol.ts';

export interface ThreadSummaryPlan {
  hostId: string;
  threadId: string;
  cwd: string;
  turnId: string;
  itemId?: string;
  text: string;
}
export type ThreadSummarySource =
  | { kind: 'file'; path: string; label: string }
  | { kind: 'web'; queries: string[]; urls: string[] }
  | { kind: 'tool'; server: string; tools: string[] };

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value : null;
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

/** Project only protocol values that identify an actual plan or source. */
export function projectThreadSummary(thread: ThreadSummary | null, hostId: string): {
  plan: ThreadSummaryPlan | null; sources: ThreadSummarySource[];
} {
  if (!thread) return { plan: null, sources: [] };
  let plan: ThreadSummaryPlan | null = null;
  const files = new Map<string, ThreadSummarySource & { kind: 'file' }>();
  const tools = new Map<string, Set<string>>();
  const queries = new Set<string>(), urls = new Set<string>();
  let searched = false;
  const addFile = (value: unknown) => {
    const item = record(value), path = text(item.fsPath) ?? text(item.path);
    if (!path || files.has(path)) return;
    const label = text(item.label) ?? text(item.name) ?? path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
    files.set(path, { kind: 'file', path, label });
  };
  const addUrl = (value: unknown) => {
    const candidate = text(value);
    if (!candidate) return;
    try { const url = new URL(candidate); if (url.protocol === 'http:' || url.protocol === 'https:') urls.add(url.href); }
    catch { /* Invalid links do not become navigation actions. */ }
  };
  for (const turn of thread.turns ?? []) {
    for (const item of turn.items ?? []) {
      if (turn.status !== 'inProgress' && item.type === 'plan' && text(item.text)) plan = { hostId, threadId: thread.id, cwd: thread.cwd,
        turnId: turn.id, itemId: item.id, text: item.text as string };
      if (item.type === 'userMessage' || item.type === 'steeringUserMessage') {
        for (const attachment of array(item.attachments)) addFile(attachment);
        for (const content of array(item.content ?? item.input)) {
          const part = record(content);
          if (part.type === 'localImage') addFile(part);
        }
      }
      if (item.type === 'mcpToolCall') {
        const server = text(item.server), tool = text(item.tool);
        if (server && tool && server !== 'plugin-runtime') {
          const existing = tools.get(server) ?? new Set<string>(); existing.add(tool); tools.set(server, existing);
        }
      }
      if (item.type === 'webSearch') {
        searched = true;
        const action = record(item.action);
        for (const value of [item.query, action.query, ...array(action.queries)]) {
          const query = text(value); if (query) queries.add(query);
        }
        addUrl(action.url);
      }
    }
  }
  const sources: ThreadSummarySource[] = [...files.values(), ...[...tools].map(([server, values]) =>
    ({ kind: 'tool' as const, server, tools: [...values] }))];
  if (searched) sources.push({ kind: 'web', queries: [...queries], urls: [...urls] });
  return { plan, sources };
}

export interface ThreadSummaryGoal { threadId: string; objective: string; status: string }
export function parseThreadSummaryGoal(value: unknown, threadId: string): ThreadSummaryGoal | null {
  const result = record(value);
  if (!Object.hasOwn(result, 'goal')) throw new Error('Invalid goal response');
  if (result.goal === null) return null;
  const goal = record(result.goal);
  if (goal.threadId !== threadId || typeof goal.objective !== 'string' || typeof goal.status !== 'string'
    || !(goal.tokenBudget === null || typeof goal.tokenBudget === 'number' && Number.isFinite(goal.tokenBudget))
    || typeof goal.tokensUsed !== 'number' || !Number.isFinite(goal.tokensUsed)
    || typeof goal.timeUsedSeconds !== 'number' || !Number.isFinite(goal.timeUsedSeconds)
    || typeof goal.createdAt !== 'number' || !Number.isFinite(goal.createdAt)
    || typeof goal.updatedAt !== 'number' || !Number.isFinite(goal.updatedAt)) {
    throw new Error('Invalid goal response');
  }
  return { threadId, objective: goal.objective, status: goal.status };
}
