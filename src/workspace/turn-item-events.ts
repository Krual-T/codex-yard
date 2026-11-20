import type { ThreadItemSummary } from '../../lib/codex-protocol.ts';
import { record } from '../native/protocol.ts';

const textDeltas = {
  'item/agentMessage/delta': ['agentMessage', 'text'],
  'item/plan/delta': ['plan', 'text'],
  'item/commandExecution/outputDelta': ['commandExecution', 'aggregatedOutput'],
  'item/fileChange/outputDelta': ['fileChange', 'activityOutput'],
} as const;
type TextDelta = keyof typeof textDeltas;
const string = (value: unknown) => typeof value === 'string' ? value : '';
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const isIndex = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value < 10_000;

export function isActivity(item: ThreadItemSummary) {
  return item.type !== 'userMessage' &&
    (item.type !== 'agentMessage' || item.phase === 'commentary' || item.phase === 'partial_answer');
}

/** Apply public item events; raw reasoning and executable tool payloads are not replayed. */
export function applyTurnItemEvent(method: string, params: Record<string, unknown>, previous?: ThreadItemSummary): ThreadItemSummary | undefined {
  if (method === 'item/started' || method === 'item/completed') {
    const item = record(params.item);
    if (typeof item.id !== 'string' || !item.id || typeof item.type !== 'string' || !item.type ||
        (previous && (previous.id !== item.id || previous.type !== item.type))) return;
    if (!previous) return item as ThreadItemSummary;
    if (method === 'item/started') {
      // A live delta can arrive before the item bootstrap. Fill metadata from
      // the start, without replacing output already received.
      const next = { ...item };
      for (const key of ['text', 'summary', 'changes', 'aggregatedOutput', 'activityOutput', 'activityProgress']) {
        if (key in previous) next[key] = previous[key];
      }
      return next as ThreadItemSummary;
    }
    return { ...previous, ...item } as ThreadItemSummary;
  }
  const itemId = params.itemId;
  if (typeof itemId !== 'string' || !itemId) return;
  const base = (type: string): ThreadItemSummary | undefined =>
    previous ? previous.type === type && previous.id === itemId ? previous : undefined : { id: itemId, type };
  if (Object.hasOwn(textDeltas, method)) {
    const [type, field] = textDeltas[method as TextDelta];
    const item = base(type);
    if (item && typeof params.delta === 'string' && params.delta) return { ...item, [field]: string(item[field]) + params.delta };
  }
  if (method === 'item/reasoning/summaryPartAdded' || method === 'item/reasoning/summaryTextDelta') {
    const item = base('reasoning'), index = params.summaryIndex;
    if (!item || !isIndex(index)) return;
    const summary = array(item.summary).slice();
    if (method === 'item/reasoning/summaryPartAdded') {
      if (typeof summary[index] === 'string') return;
      summary[index] = '';
    } else {
      if (typeof params.delta !== 'string' || !params.delta) return;
      summary[index] = string(summary[index]) + params.delta;
    }
    return { ...item, summary };
  }
  if (method === 'item/fileChange/patchUpdated') {
    const item = base('fileChange');
    if (item && Array.isArray(params.changes)) return { ...item, changes: params.changes };
  }
  if (method === 'item/mcpToolCall/progress') {
    const item = base('mcpToolCall');
    if (item && typeof params.message === 'string' && params.message) return { ...item, activityProgress: params.message };
  }
}
