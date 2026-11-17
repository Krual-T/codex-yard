import type { ObjectValue } from './protocol.ts';

interface HistoryItem { id: string }
interface HistoryTurn { id: string; items: HistoryItem[]; itemsView: string }
interface HistoryPage { data: HistoryTurn[]; nextCursor: string | null }
type Request = (method: string, params: ObjectValue, options?: unknown) => Promise<HistoryPage>;

/** Keep messages and timing on the critical path. The native item paginator
 * replaces summaries with detailed activity when a turn is expanded. */
export async function readConversationPage(request: Request, threadId: string, options: ObjectValue = {}) {
  const response = await request('thread/turns/list', {
    threadId, cursor: options.cursor ?? null, limit: options.limit ?? 2,
    sortDirection: options.sortDirection ?? 'desc', itemsView: 'summary',
  }, options.requestOptions);
  return { response, itemsPaginationByTurnId: Object.fromEntries(response.data.map(turn => [turn.id, {
    olderCursor: null, isLoadingOlder: false, hasLoadedOldest: turn.itemsView === 'full',
    ...(turn.itemsView === 'full' ? {} : { summaryItemIds: turn.items.map(item => item.id) }),
  }])) };
}

export function installConversationHistory() {
  Object.assign(window, { workbenchReadConversationPage: async (...args: Parameters<typeof readConversationPage>) => {
    const page = await readConversationPage(...args);
    window.dispatchEvent(new Event('yard-conversation-history-ready'));
    return page;
  } });
}
