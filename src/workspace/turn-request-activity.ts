import type { RpcId, ThreadItemSummary } from '../../lib/codex-protocol.ts';
import type { Answers, Question } from './turn-input.tsx';

type McpOutcome = 'accept' | 'decline' | 'cancel' | 'resolved';
type Prompt = Pick<Question, 'id' | 'question' | 'secret'>;
export type DisplayAnswers = readonly (string | null)[];
type Scope = { hostId: string; threadId: string; turnId: string; id: RpcId };
type Content = { type: 'yardMcpRequest'; serverName: string; message: string; outcome?: McpOutcome } |
  { type: 'yardInputRequest'; questions: readonly Prompt[]; answers?: DisplayAnswers };
type Receipt = ThreadItemSummary & {
  requestId: RpcId;
  afterItemId?: string | null;
} & Content;

// App Server does not persist these client-side timeline rows.
const history = new Map<string, Map<string, readonly Receipt[]>>();
const listeners = new Set<() => void>();
const empty: readonly Receipt[] = [];
const threadKey = (hostId: string, threadId: string) => JSON.stringify([hostId, threadId]);
let sequence = 0;

export function readRequestActivity(scope: Pick<Scope, 'hostId' | 'threadId' | 'turnId'>) {
  return history.get(threadKey(scope.hostId, scope.threadId))?.get(scope.turnId) ?? empty;
}

export function subscribeRequestActivity(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function notify() { for (const listener of listeners) listener(); }

function save(scope: Scope, receipts: readonly Receipt[]) {
  const key = threadKey(scope.hostId, scope.threadId);
  const thread = history.get(key) ?? new Map<string, readonly Receipt[]>();
  thread.set(scope.turnId, receipts);
  history.set(key, thread);
  notify();
}

export function isRequestActivity(item: ThreadItemSummary): item is Receipt {
  return item.type === 'yardMcpRequest' || item.type === 'yardInputRequest';
}

export function isPendingActivity(item: Receipt) {
  return item.type === 'yardMcpRequest' ? item.outcome === undefined : item.answers === undefined;
}

export function readDisplayAnswers(questions: readonly Prompt[], answers: Answers): DisplayAnswers {
  return questions.map(({ id, secret }) => {
    const values = Object.hasOwn(answers, id) ? answers[id]?.answers : undefined;
    return values?.length ? secret ? '\u2022\u2022\u2022\u2022\u2022\u2022' : values.join(', ') : null;
  });
}

export function recordRequestActivity(scope: Scope, content: Content) {
  const previous = readRequestActivity(scope);
  if (previous.some(item => isPendingActivity(item) && item.requestId === scope.id)) return;
  save(scope, [...previous, {
    ...content, id: 'yard-request-activity-' + (++sequence), requestId: scope.id,
  }]);
}

function updateOpen(scope: Scope, update: (item: Receipt) => Receipt) {
  const previous = readRequestActivity(scope);
  const target = previous.find(item => isPendingActivity(item) && item.requestId === scope.id);
  if (!target) return;
  const next = update(target);
  if (next === target) return;
  save(scope, previous.map(item => item === target ? next : item));
}

export function placeRequestActivity(scope: Scope, afterItemId: string | null) {
  updateOpen(scope, item => item.afterItemId === undefined ? { ...item, afterItemId } : item);
}

export function settleRequestActivity(scope: Scope, result?: McpOutcome | DisplayAnswers) {
  updateOpen(scope, item => {
    if (item.type === 'yardMcpRequest') return { ...item, outcome: typeof result === 'string' ? result : 'resolved' };
    return { ...item, answers: typeof result === 'string' ? [] : result ?? [] };
  });
}

export function clearRequestActivity(hostId: string, threadId: string) {
  if (history.delete(threadKey(hostId, threadId))) notify();
}

export function insertRequestActivity(items: readonly ThreadItemSummary[], receipts: readonly Receipt[]) {
  if (!receipts.length) return items;
  const remaining = new Map<string | null | undefined, Receipt[]>();
  for (const receipt of receipts) {
    const after = receipt.afterItemId;
    const bucket = remaining.get(after);
    if (bucket) bucket.push(receipt);
    else remaining.set(after, [receipt]);
  }
  const merged: ThreadItemSummary[] = [...remaining.get(null) ?? []];
  remaining.delete(null);
  for (const item of items) {
    merged.push(item);
    const after = remaining.get(item.id);
    if (after) { merged.push(...after); remaining.delete(item.id); }
  }
  // A summary may omit the anchor. Opening Work loads the full item list.
  for (const after of remaining.values()) merged.push(...after);
  return merged;
}
