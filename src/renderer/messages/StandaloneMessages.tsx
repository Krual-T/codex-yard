import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ChevronDown, ChevronLeft, ChevronRight, GitFork, Pencil, Search, X } from 'lucide-react';
import type { ThreadItemSummary, TurnSummary } from '../../../lib/codex-protocol.ts';
import type { StandaloneMessagesProps, WorkbenchClient } from '../workbench-contract.ts';
import { StandaloneMarkdown } from '../markdown/StandaloneMarkdown.tsx';
import { ToolItem } from '../tools/ToolItem.tsx';
import { CopyButton } from './CopyButton.tsx';
import { ImageViewer, MessageImage } from './MessageImage.tsx';
import { asArray, asRecord, asString, displayJson, editableDraft, parseUserContent } from './message-data.ts';
import type { ImageSource } from './message-data.ts';
import './standalone-messages.css';

type RenderItemProps = {
  item: ThreadItemSummary;
  turnId: string;
  threadId: string;
  client: WorkbenchClient;
  hostId: string;
  cwd: string;
  onEdit: StandaloneMessagesProps['onEdit'];
  onFork: StandaloneMessagesProps['onFork'];
  onOpenFile: StandaloneMessagesProps['onOpenFile'];
  onOpenFileAt: StandaloneMessagesProps['onOpenFileAt'];
  onOpenVisualization: StandaloneMessagesProps['onOpenVisualization'];
  onOpenBrowser: StandaloneMessagesProps['onOpenBrowser'];
  onOpenImages: (images: ImageSource[], index: number) => void;
  searchMatch: boolean;
};

function UserMessage({ item, turnId, threadId, client, hostId, cwd, onEdit, onFork, onOpenFile, onOpenFileAt, onOpenImages, searchMatch }: RenderItemProps) {
  const [expanded, setExpanded] = useState(false);
  const [actionError, setActionError] = useState('');
  const parts = useMemo(() => parseUserContent(item), [item]);
  const openSingleImage = useCallback((image: ImageSource) => onOpenImages([image], 0), [onOpenImages]);
  const images = parts.flatMap((part) => part.kind === 'image' ? [part.image] : []);
  const draft = useMemo(() => onEdit ? editableDraft(item) : null, [item, onEdit]);
  const text = parts.flatMap((part) => part.kind === 'text' ? [part.text] : []).join('\n');
  const long = text.length > 1200;
  let imageIndex = 0;
  return <div className="yard-user-message"><div className="yard-message-label">You</div>
    <div className="yard-user-bubble"><div className="yard-user-body">
      {parts.map((part, index) => {
        if (part.kind === 'text') return <div key={index} className={long && !expanded && !searchMatch ? 'yard-user-text is-collapsed' : 'yard-user-text'}>
          <StandaloneMarkdown text={part.text} client={client} hostId={hostId} threadId={threadId} cwd={cwd} onOpenFile={onOpenFile} onOpenFileAt={onOpenFileAt} onOpenImage={openSingleImage} /></div>;
        if (part.kind === 'image') {
          const current = imageIndex++;
          return <MessageImage key={index} source={part.image} client={client} hostId={hostId} cwd={cwd} onOpen={() => onOpenImages(images, current)} />;
        }
        if (part.kind === 'reference') return <div className="yard-reference" key={index}>{part.referenceType}: {part.name} <span>{part.path}</span></div>;
        return <details className="yard-unsupported-input" key={index}><summary>Unsupported message content</summary><pre>{displayJson(part.value)}</pre></details>;
      })}
    </div>{long && !searchMatch && <button className="yard-expand" type="button" onClick={() => setExpanded(!expanded)}
      aria-expanded={expanded}>{expanded ? 'Show less' : 'Show more'} <ChevronDown size={15} /></button>}</div>
    <div className="yard-message-actions"><CopyButton text={text} label="Copy message" />
      {onEdit && <button type="button" className="yard-icon-button" title={draft ? 'Edit message' : 'This message cannot be edited without losing content'}
        aria-label="Edit message" disabled={!draft} onClick={() => {
          if (!draft) return;
          const origin = { turnId, itemId: item.id, ...(typeof item.format === 'string' ? { format: item.format } : {}),
            ...(Array.isArray(item.hints) ? { hints: structuredClone(item.hints) } : {}) };
          setActionError('');
          void Promise.resolve().then(() => onEdit(structuredClone(draft), origin)).catch((reason: unknown) => setActionError(reason instanceof Error ? reason.message : 'Edit failed.'));
        }}><Pencil size={16} /></button>}
      {onFork && <button type="button" className="yard-icon-button" title="Fork from this turn" aria-label="Fork from this turn" onClick={() => {
        setActionError('');
        void Promise.resolve().then(() => onFork(turnId)).catch((reason: unknown) => setActionError(reason instanceof Error ? reason.message : 'Fork failed.'));
      }}><GitFork size={16} /></button>}
    </div>
    {actionError && <div className="yard-action-error" role="alert">{actionError}</div>}
  </div>;
}

function MessageItem(props: RenderItemProps) {
  const { item, turnId, threadId, client, hostId, cwd, onOpenFile, onOpenFileAt, onOpenVisualization, onOpenBrowser, onOpenImages, onFork } = props;
  const [actionError, setActionError] = useState('');
  const openSingleImage = useCallback((image: ImageSource) => onOpenImages([image], 0), [onOpenImages]);
  const markdownProps = { client, hostId, threadId, cwd, onOpenFile, onOpenFileAt, onOpenVisualization, onOpenImage: openSingleImage };
  if (item.type === 'userMessage') return <UserMessage {...props} />;
  if (item.type === 'agentMessage' || item.type === 'plan') {
    const text = asString(item.text);
    return <div className="yard-assistant-message"><div className="yard-message-label">{item.type === 'plan' ? 'Plan' : 'Codex'}</div>
      <StandaloneMarkdown text={text} {...markdownProps} />
      {asArray(item.questions).map((value, index) => {
        const question = asRecord(value);
        return <section className="yard-question" key={index}><strong>{asString(question.title) || 'Question'}</strong>
          <ul>{asArray(question.options).map((option, optionIndex) => <li key={optionIndex}>{displayJson(option)}</li>)}</ul></section>;
      })}
      {item.memoryCitation != null && <details className="yard-citation"><summary>Memory citations</summary><pre>{displayJson(item.memoryCitation)}</pre></details>}
      <div className="yard-message-actions"><CopyButton text={text} label="Copy message" />
        {onFork && <button type="button" className="yard-icon-button" title="Fork from this turn" aria-label="Fork from this turn" onClick={() => {
          setActionError('');
          void Promise.resolve().then(() => onFork(turnId)).catch((reason: unknown) => setActionError(reason instanceof Error ? reason.message : 'Fork failed.'));
        }}><GitFork size={16} /></button>}</div>
      {actionError && <div className="yard-action-error" role="alert">{actionError}</div>}
    </div>;
  }
  if (item.type === 'reasoning') {
    const summary = asArray(item.summary).filter((value): value is string => typeof value === 'string');
    const content = asArray(item.content).filter((value): value is string => typeof value === 'string');
    return <details className="yard-reasoning"><summary>{summary[0] || 'Thinking'}</summary>
      {summary.slice(1).map((text, index) => <StandaloneMarkdown key={`summary-${index}`} text={text} {...markdownProps} />)}
      {content.map((text, index) => <StandaloneMarkdown key={`content-${index}`} text={text} {...markdownProps} />)}
    </details>;
  }
  if (item.type === 'hookPrompt') return <div className="yard-hook-prompt"><div className="yard-message-label">Hook feedback</div>
    {asArray(item.fragments).map((fragment, index) => {
      const value = asRecord(fragment);
      return <div key={index}><StandaloneMarkdown text={asString(value.text)} {...markdownProps} />
        {asString(value.hookRunId) && <span className="yard-hook-id">{asString(value.hookRunId)}</span>}</div>;
    })}</div>;
  return <ToolItem item={item} client={client} hostId={hostId} threadId={threadId} cwd={cwd} onOpenFile={onOpenFile} onOpenFileAt={onOpenFileAt}
    onOpenBrowser={onOpenBrowser} onOpenImage={markdownProps.onOpenImage} />;
}

function TurnStatus({ turn }: { turn: TurnSummary }) {
  if (turn.status === 'completed') return null;
  return <div className={`yard-turn-status is-${turn.status}`} role={turn.status === 'failed' ? 'alert' : 'status'}>
    {turn.status === 'inProgress' ? 'In progress' : turn.status === 'interrupted' ? 'Interrupted' : 'Failed'}
    {turn.error?.message && <span>: {turn.error.message}</span>}
    {turn.error?.additionalDetails && <div>{turn.error.additionalDetails}</div>}
  </div>;
}

type SearchHit = { key: string; text: string };
type ViewerState = { images: ImageSource[]; index: number };
const itemKey = (turnId: string, itemId: string | null) => JSON.stringify([turnId, itemId]);

function searchText(value: unknown): string {
  if (typeof value === 'string') return /^data:(?:image|audio)\//i.test(value) ? '' : value;
  if (Array.isArray(value)) return value.map(searchText).join('\n');
  if (value !== null && typeof value === 'object') {
    const record = asRecord(value);
    return Object.entries(record).filter(([key, entry]) => !(record.type === 'image' && key === 'data')
      && !(record.type === 'imageGeneration' && key === 'result' && typeof entry === 'string' && /^[a-z\d+/=\s]+$/i.test(entry)))
      .map(([, entry]) => searchText(entry)).join('\n');
  }
  return typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
}

export function StandaloneMessages({ client, hostId, thread, onEdit, onFork, onOpenFile, onOpenFileAt, onOpenVisualization, onOpenBrowser }: StandaloneMessagesProps) {
  const [query, setQuery] = useState('');
  const [matchIndex, setMatchIndex] = useState(-1);
  const [following, setFollowing] = useState(true);
  const [viewer, setViewer] = useState<ViewerState | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const nodes = useRef(new Map<string, HTMLElement>());
  const searchOpened = useRef(new Set<HTMLDetailsElement>());
  const followRef = useRef(true);
  const threadId = useRef(thread?.id);
  const openImages = useCallback((images: ImageSource[], index: number) => setViewer({ images, index }), []);
  const closeViewer = useCallback(() => setViewer(null), []);
  const setViewerIndex = useCallback((index: number) => setViewer((current) => current ? { ...current, index } : null), []);
  const hasQuery = Boolean(query.trim());
  const searchable = useMemo<SearchHit[]>(() => !hasQuery ? [] : thread?.turns.flatMap((turn) => [
    ...turn.items.map((item) => ({ key: itemKey(turn.id, item.id), text: searchText(item).toLocaleLowerCase() })),
    ...(turn.status !== 'completed' ? [{ key: itemKey(turn.id, null), text: searchText([turn.status, turn.error]).toLocaleLowerCase() }] : []),
  ]) ?? [], [hasQuery, thread]);
  const hits = useMemo<SearchHit[]>(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle ? searchable.filter((hit) => hit.text.includes(needle)) : [];
  }, [query, searchable]);
  const hitKeys = useMemo(() => new Set(hits.map((hit) => hit.key)), [hits]);
  const selected = matchIndex < 0 ? undefined : hits[Math.min(matchIndex, hits.length - 1)];
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    if (threadId.current !== thread?.id) {
      threadId.current = thread?.id;
      followRef.current = true;
      setFollowing(true);
      setViewer(null);
    }
    if (followRef.current) element.scrollTop = element.scrollHeight;
  });
  useEffect(() => {
    let states: { element: HTMLDetailsElement; open: boolean }[] = [];
    function beforePrint() {
      states = Array.from(scroller.current?.querySelectorAll('details') ?? [], (element) => ({ element, open: element.open }));
      for (const state of states) state.element.open = true;
    }
    function afterPrint() {
      for (const state of states) if (state.element.isConnected) state.element.open = state.open;
      states = [];
    }
    window.addEventListener('beforeprint', beforePrint);
    window.addEventListener('afterprint', afterPrint);
    return () => { window.removeEventListener('beforeprint', beforePrint); window.removeEventListener('afterprint', afterPrint); };
  }, []);
  function restoreSearchDetails() {
    for (const details of searchOpened.current) if (details.isConnected) details.open = false;
    searchOpened.current.clear();
  }
  function scrollToMatch(index: number) {
    if (!hits.length) return;
    const next = ((index % hits.length) + hits.length) % hits.length;
    setMatchIndex(next);
    followRef.current = false;
    setFollowing(false);
    const node = nodes.current.get(hits[next]?.key ?? '');
    node?.querySelectorAll('details').forEach((details) => {
      if (!details.open) { searchOpened.current.add(details); details.open = true; }
    });
    node?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  function followLatest() {
    followRef.current = true;
    setFollowing(true);
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }
  function onScroll() {
    const element = scroller.current;
    if (!element) return;
    const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
    if (nearBottom !== followRef.current) { followRef.current = nearBottom; setFollowing(nearBottom); }
  }
  return <div className="yard-messages-root">
    <div className="yard-message-search"><Search size={16} aria-hidden="true" /><input aria-label="Search messages" value={query}
      placeholder="Search messages" onChange={(event) => { restoreSearchDetails(); setQuery(event.target.value); setMatchIndex(-1); }}
      onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); scrollToMatch(event.shiftKey && matchIndex < 0 ? hits.length - 1 : matchIndex + (event.shiftKey ? -1 : 1)); } }} />
      {query && <><span aria-live="polite">{hits.length ? `${matchIndex < 0 ? 0 : Math.min(matchIndex, hits.length - 1) + 1} / ${hits.length}` : '0 results'}</span>
        <button type="button" className="yard-icon-button" title="Previous result" aria-label="Previous result" disabled={!hits.length} onClick={() => scrollToMatch(matchIndex < 0 ? hits.length - 1 : matchIndex - 1)}><ChevronLeft size={16} /></button>
        <button type="button" className="yard-icon-button" title="Next result" aria-label="Next result" disabled={!hits.length} onClick={() => scrollToMatch(matchIndex + 1)}><ChevronRight size={16} /></button>
        <button type="button" className="yard-icon-button" title="Clear search" aria-label="Clear search" onClick={() => { restoreSearchDetails(); setQuery(''); setMatchIndex(-1); }}><X size={16} /></button></>}
    </div>
    <div className="yard-message-scroll" ref={scroller} onScroll={onScroll} onClickCapture={(event) => {
      const target = event.target;
      if (target instanceof Element) {
        const summary = target.closest('summary');
        if (summary?.parentElement instanceof HTMLDetailsElement) searchOpened.current.delete(summary.parentElement);
      }
    }} data-thread-find-target="conversation">
      {!thread ? <div className="yard-message-empty">Select a conversation</div> : thread.turns.length === 0 ? <div className="yard-message-empty">No messages yet</div> :
        <div className="yard-message-list">{thread.turns.map((turn) => <section className="yard-turn" key={turn.id} data-turn-id={turn.id}>
          {turn.items.map((item) => {
            const key = itemKey(turn.id, item.id);
            const searchMatch = hitKeys.has(key);
            return <article className="yard-message-item" key={item.id} data-message-id={item.id} data-search-current={selected?.key === key || undefined}
              ref={(node) => { if (node) nodes.current.set(key, node); else nodes.current.delete(key); }}>
              <MessageItem item={item} turnId={turn.id} threadId={thread.id} client={client} hostId={hostId} cwd={thread.cwd} onEdit={onEdit} onFork={onFork}
                onOpenFile={onOpenFile} onOpenFileAt={onOpenFileAt} onOpenVisualization={onOpenVisualization} onOpenBrowser={onOpenBrowser}
                onOpenImages={openImages} searchMatch={searchMatch} /></article>;
          })}{turn.status !== 'completed' && <div data-search-current={selected?.key === itemKey(turn.id, null) || undefined}
            ref={(node) => { const key = itemKey(turn.id, null); if (node) nodes.current.set(key, node); else nodes.current.delete(key); }}><TurnStatus turn={turn} /></div>}
        </section>)}</div>}
    </div>
    {!following && thread && <button type="button" className="yard-jump-latest" onClick={followLatest}><ArrowDown size={16} /> Latest</button>}
    {viewer && thread && <ImageViewer images={viewer.images} index={viewer.index} client={client} hostId={hostId} cwd={thread.cwd}
      onIndexChange={setViewerIndex} onClose={closeViewer} />}
  </div>;
}
