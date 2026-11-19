import type * as ReactRuntime from 'react';
import type { ThreadSummary } from '../../lib/codex-protocol.ts';
import type { BrowserSidechatThreads, ListSidechats } from './browser-sidechat-threads.ts';

export interface NativeSidechat {
  conversationId: string;
  tabId: string;
  title: string;
  isResponseInProgress: boolean;
}
interface Props {
  hostId: string;
  conversationId: string | null;
  isVisible: boolean;
  sideChats: NativeSidechat[];
  list: ListSidechats;
  fallbackTitle(index: number): string;
}

/** Feed saved attachments into the original Side chats section and rows. */
export function mergeSidechats(store: BrowserSidechatThreads, hostId: string, children: readonly ThreadSummary[],
  sideChats: readonly NativeSidechat[], loaded: boolean, fallbackTitle: Props['fallbackTitle']): NativeSidechat[] {
  const live = new Map(sideChats.map(chat => [chat.conversationId, chat]));
  const rows = new Map(children.map((child, index) => [child.id, {
    conversationId: child.id, tabId: 'sidechat:' + child.id,
    title: contentTitle(child.name) || contentTitle(live.get(child.id)?.title) || child.preview?.trim() || fallbackTitle(index + 1),
    isResponseInProgress: child.status?.type === 'active' || live.get(child.id)?.isResponseInProgress === true,
  }]));
  for (const chat of sideChats) {
    if (!rows.has(chat.conversationId) && (!loaded || !store.isAttached(hostId, chat.conversationId))) rows.set(chat.conversationId, chat);
  }
  return [...rows.values()];
}

// Earlier releases saved the empty tab label as a name, blocking auto titles.
// Keep history intact and display its own content when that label survives.
function contentTitle(value: string | null | undefined) {
  const title = value?.trim();
  return title && !/^(?:Side chat|侧边对话|侧边聊天)(?: \d+)?$/.test(title) ? title : undefined;
}

export function installSidechatThreads(React: typeof ReactRuntime) {
  const surface = window as unknown as Window & { workbenchSidechatThreads: BrowserSidechatThreads;
    workbenchUseSidechats?: (props: Props) => NativeSidechat[] };
  surface.workbenchUseSidechats = function useSidechats({ hostId, conversationId, isVisible, sideChats, list, fallbackTitle }: Props) {
    const store = surface.workbenchSidechatThreads, id = conversationId ?? '';
    const subscribe = React.useCallback((listener: () => void) => store.subscribe(hostId, id, listener), [store, hostId, id]);
    const snapshot = React.useCallback(() => store.snapshot(hostId, id), [store, hostId, id]);
    const branch = React.useSyncExternalStore(subscribe, snapshot);
    const supported = store.supportsHost(hostId);
    React.useEffect(() => {
      if (!conversationId || !supported || !isVisible || branch.loading || branch.error) return;
      if (!branch.loaded) void store.load(hostId, conversationId, list);
      else if (branch.nextCursor) void store.load(hostId, conversationId, list, true);
    }, [store, hostId, conversationId, supported, isVisible, branch.loaded, branch.loading, branch.error, branch.nextCursor, list]);
    return React.useMemo(() => supported && conversationId
      ? mergeSidechats(store, hostId, branch.children, sideChats, branch.loaded, fallbackTitle) : sideChats,
    [store, hostId, supported, conversationId, branch.children, branch.loaded, sideChats, fallbackTitle]);
  };
}
