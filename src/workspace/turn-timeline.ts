import type { ThreadItemSummary } from '../../lib/codex-protocol.ts';

export type TurnBlock = { kind: 'prompt' | 'answer' | 'question'; key: string; item: ThreadItemSummary } |
  { kind: 'images'; key: string; items: ThreadItemSummary[] } |
  { kind: 'activity'; key: string; after?: string; before?: string };

/** Pinned transcript N/F: messages end the preceding activity group. Keep
 * those boundaries even when paginated summaries omit the saved tool items. */
export function turnTimeline(items: readonly ThreadItemSummary[], active: boolean, summary = false): TurnBlock[] {
  const blocks: TurnBlock[] = [];
  let after: string | undefined;
  let activity = false;
  let afterPrompt = false;
  function flush(before?: string) {
    if (activity || afterPrompt && (summary || active && before === undefined)) {
      blocks.push({ kind: 'activity', key: 'work:' + (after ?? 'start'), after, before });
    }
    activity = false;
    afterPrompt = false;
  }
  for (const item of items) {
    const kind = item.type === 'userMessage' ? 'prompt' :
      item.type === 'agentMessage' && item.delivery === 'async' && Array.isArray(item.questions) && item.questions.length ? 'question' :
      item.type === 'agentMessage' && item.phase !== 'commentary' && item.phase !== 'partial_answer' &&
        typeof item.text === 'string' && item.text.trim() ? 'answer' : undefined;
    if (kind) {
      flush(item.id);
      blocks.push({ kind, key: item.id, item });
      after = item.id;
      afterPrompt = kind === 'prompt';
    } else if (item.type === 'imageGeneration') {
      flush(item.id);
      const previous = blocks.at(-1);
      if (previous?.kind === 'images') previous.items.push(item);
      else blocks.push({ kind: 'images', key: item.id, items: [item] });
      after = item.id;
    } else activity = true;
  }
  if (active && (!blocks.length || blocks.at(-1)?.kind === 'question')) activity = true;
  flush();
  return blocks;
}

/** Resolve a range against the full read, rather than filtering its tool IDs:
 * a saved summary deliberately contains none of those IDs yet. */
export function activityRange(items: readonly ThreadItemSummary[], after?: string, before?: string) {
  const start = after === undefined ? 0 : items.findIndex(item => item.id === after) + 1;
  const end = before === undefined ? items.length : items.findIndex(item => item.id === before);
  return items.slice(start, end < 0 ? undefined : end);
}
