import { useEffect, useMemo } from 'react';
import { MessageSquare } from 'lucide-react';
import { useThreadList } from '../sidebar/use-thread-list.ts';
import type { WorkbenchClient } from '../workbench-contract.ts';

export interface ChatChoice { threadId: string; hostId: string; title: string }
export interface ChatLookupSnapshot { key: string; items: readonly ChatChoice[]; loading: boolean; error: string }

export function ChatThreadResults({ client, hostId, hostName, search, resultKey, listId, offset = 0, selected = -1,
  onSnapshot, onChoose, preserveFocus = false, chinese = false }: {
  client: WorkbenchClient; hostId: string; hostName: string; search: string; resultKey: string;
  listId?: string; offset?: number; selected?: number;
  onSnapshot?: (snapshot: ChatLookupSnapshot) => void;
  onChoose(choice: ChatChoice): void;
  preserveFocus?: boolean; chinese?: boolean;
}) {
  const list = useThreadList(client, { hostId, archived: false, search, refreshKey: resultKey });
  const items = useMemo(() => list.rows.flatMap(row => {
    if (!/^[A-Za-z0-9_-]+$/.test(row.id) || !/^[A-Za-z0-9._:-]+$/.test(row.hostId)) return [];
    const title = [row.name, row.preview, row.id].find(value => typeof value === 'string' && value.trim());
    return [{ threadId: row.id, hostId: row.hostId, title: typeof title === 'string' ? title.trim() : row.id }];
  }), [list.rows]);
  useEffect(() => {
    onSnapshot?.({ key: resultKey, items, loading: list.loading, error: list.error?.message ?? '' });
  }, [resultKey, items, list.loading, list.error, onSnapshot]);
  const retainEditorFocus = preserveFocus ? (event: React.MouseEvent) => event.preventDefault() : undefined;
  return <>
    {items.map((item, index) => <button type="button" role={listId ? 'option' : undefined}
      id={listId ? listId + '-chat-' + index : undefined} aria-selected={listId ? selected === offset + index : undefined}
      key={JSON.stringify([item.hostId, item.threadId])} onMouseDown={retainEditorFocus} onClick={() => onChoose(item)}>
      <MessageSquare size={15} aria-hidden="true" /><span>{item.title}</span><small>{hostName}</small>
    </button>)}
    {items.length < list.rows.length ? <div role="alert">{chinese
      ? '部分会话的标识无法由当前编辑器表示，未提供插入。'
      : 'Some chat identifiers cannot be represented by this editor and cannot be inserted.'}</div> : null}
    {list.loading ? <div role="status">{chinese ? '正在查找会话…' : 'Loading chats...'}</div> : null}
    {list.error ? <div role="alert">{list.error.message}{' '}<button type="button" onMouseDown={retainEditorFocus}
      onClick={() => void (list.error?.retry === 'loadMore' ? list.loadMore() : list.refresh())}>{chinese ? '重试' : 'Retry'}</button></div> : null}
    {!search && list.nextCursor && !list.loading && !list.error ? <button type="button" onMouseDown={retainEditorFocus}
      onClick={() => void list.loadMore()}>{chinese ? '更多会话' : 'More chats'}</button> : null}
    {!onSnapshot && !list.loading && !list.error && !items.length ? <div>{chinese ? '没有匹配的会话' : 'No matching chats'}</div> : null}
  </>;
}
