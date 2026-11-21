import { ArrowDown, ChevronRight, CircleAlert, Pencil, Split } from 'lucide-react';
import * as React from 'react';
import type { ThreadItemSummary, ThreadSummary } from '../../lib/codex-protocol.ts';
import { memo, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type Ref } from 'react';
import { createTurnProgressSurface } from '../native/turn-progress.ts';
import { history, interruptTurn, markThreadRead, MessageEditStopped, onConversationHistoryChanged, readContinuationTurns, recoverConversation, replaceLatestMessage, resumeThread } from './host.ts';
import type { RunMessageEdit } from './composer.tsx';
import { AttachmentCard } from './composer-attachments.tsx';
import { attachedPrompt, editablePrompt, promptImages, type EditablePrompt } from './composer-input.ts';
import { ConversationImages } from './conversation-images.tsx';
import { pluginMentionPath, pluginMentionSegments } from './output-types.ts';
import { mergeLiveTurns, TurnStream } from './turn-stream.ts';
import { AsyncQuestionMessage, AsyncQuestionReplyMessage } from './async-questions.tsx';
import { questionReplies } from '../native/async-questions.ts';
import { MessageCopy } from './message-copy.tsx';
import { MessageBody } from './message-body.tsx';
import { MessageActions } from './message-actions.tsx';
import { ToolMenu, ToolMenuItem } from './new-tab-tools.tsx';
import { PromptEdit } from './prompt-edit.tsx';
import { TurnActivity } from './turn-activity.tsx';
import { isActivity } from './turn-item-events.ts';
import type { OpenSubagent } from './turn-agents.tsx';
import { TurnChangeCard, type OpenTurnChanges } from './turn-changes-view.tsx';
import { isInputRequest, useTurnRequest } from './turn-requests.tsx';
import { WorkspaceIcon } from './workspace-icon.tsx';
import { turnTimeline } from './turn-timeline.ts';
import { conversationScope, pendingMessages, usePendingMessages, withPendingMessages } from './pending-messages.ts';
import { useMessageNavigation } from './message-navigation.tsx';
import { messageNavigationId } from './message-navigation-history.ts';

let messageDate: Intl.DateTimeFormat | undefined;
let messageTime: Intl.DateTimeFormat | undefined;
let replyTime: Intl.DateTimeFormat | undefined;
const TurnProgress = createTurnProgressSurface(React);
const GeneratedImages = React.lazy(() => import('./generated-images.tsx'));
const promptSeparatorGap = 3600; // seconds

function timeOfDay(time: Date) {
  messageTime ??= new Intl.DateTimeFormat(document.documentElement.lang, { hour: 'numeric', minute: '2-digit' });
  return messageTime.format(time).replace(/^0(?=\d)/, '');
}

function TurnTime({ seconds }: { seconds: number }) {
  const time = new Date(seconds * 1000);
  if (!Number.isFinite(time.getTime())) return null;
  messageDate ??= new Intl.DateTimeFormat(document.documentElement.lang, { year: 'numeric', month: 'long', day: 'numeric' });
  return <time className="yard-source-turn-time" dateTime={time.toISOString()}>
    {messageDate.format(time) + ' at ' + timeOfDay(time)}
  </time>;
}
function MessageMore({ branch, turnId }: { branch(turnId: string): Promise<void>; turnId: string }) {
  return <ToolMenu label="More actions" align="start" side="top" className="yard-source-response-menu" deferContent
    triggerButton={<button type="button" aria-label="More actions" data-message-hint="More actions"
      className="yard-source-message-icon" onKeyDown={event => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        if (event.currentTarget.getAttribute('aria-expanded') === 'true') return;
        event.preventDefault();
        event.currentTarget.click();
      }}><WorkspaceIcon name="more" /></button>}>
    <ToolMenuItem aria-label="Fork chat from here" onSelect={() => void branch(turnId)}>
      <Split size={16} className="rotate-90" aria-hidden="true" />Branch in new chat
    </ToolMenuItem>
  </ToolMenu>;
}

function ReplyTime({ seconds }: { seconds: number }) {
  const time = new Date(seconds * 1000);
  if (!Number.isFinite(time.getTime())) return null;
  replyTime ??= new Intl.DateTimeFormat(document.documentElement.lang, { weekday: 'long', hour: 'numeric', minute: '2-digit' });
  return <time className="yard-source-reply-time" dateTime={time.toISOString()}>{replyTime.format(time)}</time>;
}

const AssistantMessage = memo(function AssistantMessage({ text, active, turnId, branch, changes, completedAt }: {
  text: string; active: boolean; turnId: string; branch?: (turnId: string) => Promise<void>; changes?: ReactNode; completedAt?: number | null;
}) {
  const deferred = useDeferredValue(text);
  const content = active ? deferred : text;
  return <article className="yard-source-agent-message">
    <h4 className="sr-only">ChatGPT said:</h4>
    <MessageBody text={content} streaming={active} />
    {changes}
    {!active && <MessageActions>
      <MessageCopy label="Copy" text={text} messageAction />
      {branch && <MessageMore branch={branch} turnId={turnId} />}
      {typeof completedAt === 'number' && completedAt > 0 && <ReplyTime seconds={completedAt} />}
    </MessageActions>}
  </article>;
});

const PromptMessage = memo(function PromptMessage({ item, hostId, startedAt, edit, editButton, navigationId }: {
  item: ThreadItemSummary; hostId: string; startedAt?: number | null; edit?: () => void; editButton?: Ref<HTMLButtonElement>; navigationId?: string;
}) {
  if (!Array.isArray(item.content)) return null;
  const sent = startedAt && startedAt > 0 ? new Date(startedAt * 1000) : undefined;
  const images = promptImages(item.content);
  const imagePaths = new Set(images.flatMap(image => image.path ? [image.path] : []));
  const parts = item.content.flatMap(part => {
    if (part?.type !== 'text' || typeof part.text !== 'string') return [];
    const { text, attachments } = attachedPrompt(part.text);
    return [{ text, attachments: attachments.filter(file => !imagePaths.has(file.path)) }];
  });
  const replies = questionReplies(item);
  if (replies.length) return <div data-message-navigation-id={navigationId}><AsyncQuestionReplyMessage item={item} /></div>;
  const copyText = parts.map(part => part.text).join('\n');
  return <div className="yard-source-user-turn" data-message-navigation-id={navigationId} data-preparing-message={item.preparing ? String(item.clientId) : undefined}>
    <h4 className="sr-only">You said:</h4>
    {images.length > 0 && <ConversationImages images={images} hostId={hostId} />}
    {parts.some(part => part.text || part.attachments.length) &&
      <div className="yard-source-user-message bg-user-message text-user-message rounded-2xl _bubble_168sz_1" data-user-message-bubble="true">
        {parts.map((prompt, index) => <div key={index}>
          {!!prompt.attachments.length && <div className="yard-source-attachment-row">
            {prompt.attachments.map((attachment, index) => <AttachmentCard key={index} name={attachment.name} file={attachment}
              hostId={hostId} preview={false} />)}
          </div>}
          {prompt.text && <p className="_Paragraph_1fgd0_2" dir="auto">{pluginMentionSegments(prompt.text).map((segment, index) => typeof segment === 'string' ? segment :
            <span key={index} className="_Mention_a4hbb_2 yard-source-output-mention" data-appearance="inline-mention"
              data-tone="accent" data-font-weight="medium" data-layout="inline-flow" plugin-mention-path={pluginMentionPath(segment)}>
              <span aria-hidden="true" />{segment.label}
            </span>)}</p>}
        </div>)}
      </div>}
    <MessageActions>
      {sent && Number.isFinite(sent.getTime()) && <time className="yard-source-user-message-time" dateTime={sent.toISOString()}>{timeOfDay(sent)}</time>}
      {copyText && <MessageCopy label="Copy message" text={copyText} messageAction />}
      {edit && <button ref={editButton} type="button" className="yard-source-message-icon" aria-label="Edit message"
        data-message-hint="Edit message" onClick={edit}><Pencil size={14} aria-hidden="true" /></button>}
    </MessageActions>
  </div>;
});

type History = Awaited<ReturnType<typeof history>>;
export type ConversationView = { stream: TurnStream; pending?: Promise<History>; seed?: History };

export function HomePendingMessages({ children }: { children: ReactNode }) {
  const pending = usePendingMessages('new-conversation');
  if (!pending.length) return children;
  return <div className="yard-source-transcript overflow-y-auto" role="region" aria-label="Conversation">
    <div className="yard-source-transcript-content">
      {withPendingMessages([], pending).flatMap(turn => turn.items.map(item =>
        <PromptMessage key={item.id} item={item} hostId="local" />))}
    </div>
  </div>;
}

export function useConversation(view?: ConversationView, onPersisted?: (id: string, hostId: string) => void) {
  const [selected, setSelected] = useState<{ view: ConversationView; page: History }>();
  const [failure, setFailure] = useState<{ view: ConversationView; message: string }>();
  const page = selected?.view === view ? selected?.page ?? view?.seed : view?.seed;
  useEffect(() => {
    if (!view) return;
    const { stream } = view, { threadId: id, hostId } = stream;
    stream.connect();
    let current = true;
    let revision = 0;
    let replace = false;
    let reattach = false;
    let reading = false;
    let dirty = false;
    let anchor = view.seed?.turns.at(-1)?.id;
    const report = (error: unknown) => { if (current) setFailure({ view, message: String(error) }); };
    void (view.pending ?? history(id, null, hostId)).then(page => {
      if (!current || revision) return;
      setSelected({ view, page });
      anchor = page.turns.at(-1)?.id;
      stream.persisted(page.turns);
    }, error => { if (!revision) report(error); });
    const refresh = async (reverted = false, attach = false) => {
      replace ||= reverted;
      reattach ||= attach;
      revision++;
      dirty = true;
      if (reading) return;
      reading = true;
      try { while (current && dirty) {
        dirty = false;
        const requested = revision;
        if (reattach) {
          reattach = false;
          try { await resumeThread(id, hostId); }
          catch (error) { reattach = true; throw error; }
          if (!current) return;
        }
        const latest = await recoverConversation(id, hostId, replace ? undefined : anchor);
        if (!current) return;
        if (requested !== revision) { dirty = true; continue; }
        const replaceHistory = replace;
        replace = false;
        anchor = latest.turns.at(-1)?.id;
        stream.recover(latest.turns);
        setSelected(current => {
          if (replaceHistory || current?.view !== view) return { view, page: latest };
          const latestIds = new Set(latest.turns.map(turn => turn.id));
          return { view, page: { ...current.page, thread: latest.thread ?? current.page.thread, readState: latest.readState,
            turns: [...current.page.turns.filter(turn => !latestIds.has(turn.id)), ...latest.turns] } };
        });
        setFailure(undefined);
        onPersisted?.(id, hostId);
      } } catch (error) { report(error); }
      finally {
        reading = false;
        if (current && dirty) void refresh();
      }
    };
    const unsubscribe = onConversationHistoryChanged(id, (reverted, attach) => { void refresh(reverted, attach); }, hostId);
    const foreground = () => { if (!document.hidden) void refresh(false, true); };
    window.addEventListener('focus', foreground);
    window.addEventListener('pageshow', foreground);
    window.addEventListener('online', foreground);
    document.addEventListener('visibilitychange', foreground);
    // Foreground reconciliation also catches a missed peer event while the
    // transport stayed open. Writes are never replayed by this recovery path.
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 15_000);
    void refresh(false, true);
    return () => {
      current = false; unsubscribe(); stream.disconnect(); window.clearInterval(timer);
      window.removeEventListener('focus', foreground);
      window.removeEventListener('pageshow', foreground);
      window.removeEventListener('online', foreground);
      document.removeEventListener('visibilitychange', foreground);
    };
  }, [view, onPersisted]);

  async function more() {
    if (!view || !page?.nextCursor) return;
    try {
      const older = await history(view.stream.threadId, page.nextCursor, view.stream.hostId);
      setSelected(current => current?.view === view && current.page === page
        ? { view, page: { ...page, turns: [...older.turns, ...page.turns], nextCursor: older.nextCursor } } : current);
    } catch (error) { setFailure({ view, message: String(error) }); }
  }
  return { page, more, fault: failure?.view === view ? failure?.message : undefined };
}

export function Transcript({ page, stream, more, branch, openChanges, stop, runMessageEdit, subagents, openSubagent, label = 'Conversation' }: {
  page?: History; stream: TurnStream; more(): Promise<void>; branch?(turnId: string): Promise<void>; openChanges?: OpenTurnChanges;
  stop?(turnId: string): Promise<void>; runMessageEdit?: RunMessageEdit; subagents?: ReadonlyMap<string, ThreadSummary>;
  openSubagent?: OpenSubagent; label?: string;
}) {
  const request = useTurnRequest(stream.threadId, stream.hostId);
  const live = useSyncExternalStore(stream.subscribe, stream.read);
  const inspectedTurnId = useSyncExternalStore(stream.subscribe, stream.readInspectedTurn);
  const pending = usePendingMessages(conversationScope(stream.threadId, stream.hostId));
  useEffect(() => { pendingMessages.confirm(conversationScope(stream.threadId, stream.hostId), page?.turns ?? []); }, [stream, page?.turns]);
  const recent = useMemo(() => withPendingMessages(mergeLiveTurns(page?.turns, live, inspectedTurnId), pending), [page?.turns, live, inspectedTurnId, pending]);
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const navigation = useMessageNavigation({ threadId: stream.threadId, hostId: stream.hostId, recent, scroller, content, follow });
  const turns = navigation.turns;
  const [openedAt] = useState(() => Date.now() / 1000);
  const [workOpen, setWorkOpen] = useState(new Map<string, boolean>());
  const last = recent.at(-1);
  const latestMessages = last?.items.filter(item => item.type === 'userMessage');
  const editItem = page && !page.thread?.ephemeral && last?.status !== 'inProgress' && latestMessages?.length === 1
    ? latestMessages[0] : undefined;
  const latestPrompt = runMessageEdit && editItem ? editablePrompt(editItem) : undefined;
  const [edit, setEdit] = useState<{ turnId: string; itemId: string; prompt: EditablePrompt }>();
  const [editText, setEditText] = useState('');
  const [editError, setEditError] = useState<string>();
  const [editStatus, setEditStatus] = useState<'idle' | 'pending' | 'locked'>('idle');
  const editSubmitting = useRef(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const restoreEditFocus = useRef(false);
  useLayoutEffect(() => {
    if (!edit && restoreEditFocus.current) { restoreEditFocus.current = false; editButton.current?.focus(); }
  }, [edit]);
  function closeEdit() {
    if (editSubmitting.current) return;
    restoreEditFocus.current = true;
    setEdit(undefined);
  }
  async function sendEdit() {
    if (!edit || !runMessageEdit || editStatus !== 'idle' || editSubmitting.current) return;
    if (last?.id !== edit.turnId || editItem?.id !== edit.itemId) {
      setEditError('The latest message changed. Review the conversation before editing.');
      setEditStatus('locked');
      return;
    }
    editSubmitting.current = true;
    setEditError(undefined);
    setEditStatus('pending');
    try {
      await runMessageEdit(async current => {
        const { turn } = await replaceLatestMessage(stream.threadId, edit.turnId, edit.prompt.input(editText.trim()), stream.hostId, current);
        if (current()) stream.acknowledge(turn);
      });
      setEditStatus('idle');
      setEdit(undefined);
    } catch (error) {
      setEditError(error instanceof Error ? error.message : String(error));
      setEditStatus(error instanceof MessageEditStopped ? 'locked' : 'idle');
    } finally { editSubmitting.current = false; }
  }
  const editInPlace = edit && turns.some(turn => turn.id === edit.turnId && turn.items.some(item => item.id === edit.itemId));
  const inlineEdit = edit ? <PromptEdit prompt={edit.prompt} text={editText} change={setEditText}
    cancel={closeEdit} send={() => void sendEdit()} pending={editStatus === 'pending'} locked={editStatus === 'locked'}
    error={editError} hostId={stream.hostId} /> : undefined;
  const lastPreparation = pending.at(-1)?.id;
  useLayoutEffect(() => {
    if (lastPreparation && scroller.current) {
      navigation.latest();
      follow.current = true;
      scroller.current.scrollTop = scroller.current.scrollHeight;
    }
  }, [lastPreparation]);
  const [canScrollToEnd, setCanScrollToEnd] = useState(false);
  const acknowledged = useRef<string | undefined>(undefined);
  useEffect(() => {
    const state = page?.readState;
    if (!state?.firstUnread || canScrollToEnd || navigation.past) return;
    const key = stream.hostId + ':' + stream.threadId + ':' + state.revision;
    if (acknowledged.current === key) return;
    const acknowledge = () => {
      const node = scroller.current;
      if (document.hidden || !document.hasFocus() || !node?.getClientRects().length ||
          node.scrollHeight - node.scrollTop - node.clientHeight > 12 || acknowledged.current === key) return;
      acknowledged.current = key;
      // Reaching the latest page also reads earlier unread turns outside it.
      // expectedRevision preserves new activity arriving after this history read.
      void markThreadRead(stream.threadId, state.revision, stream.hostId).catch(error => {
        if (acknowledged.current === key) acknowledged.current = undefined;
        console.error(error);
      });
    };
    acknowledge();
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) acknowledge();
    });
    if (scroller.current) observer.observe(scroller.current);
    window.addEventListener('focus', acknowledge);
    document.addEventListener('visibilitychange', acknowledge);
    return () => {
      observer.disconnect();
      window.removeEventListener('focus', acknowledge);
      document.removeEventListener('visibilitychange', acknowledge);
    };
  }, [stream, page?.readState, turns, canScrollToEnd, navigation.past]);
  const earlierAnchor = useRef<{ element: HTMLElement; offset: number; cursor: string } | null>(null);
  const requestingEarlier = useRef(false);
  const [earlierLoading, setEarlierLoading] = useState(false);
  function loadEarlier(preservePosition: boolean) {
    if (navigation.past) { void navigation.extend('before'); return; }
    if (!page?.nextCursor || requestingEarlier.current) return;
    const first = preservePosition ? content.current?.querySelector<HTMLElement>('[data-turn-status]') : null;
    earlierAnchor.current = first ? { element: first, offset: first.offsetTop, cursor: page.nextCursor } : null;
    requestingEarlier.current = true;
    follow.current = false;
    setEarlierLoading(true);
    void more().finally(() => { requestingEarlier.current = false; setEarlierLoading(false); });
  }
  useLayoutEffect(() => {
    const node = scroller.current, anchor = earlierAnchor.current;
    if (!node || !anchor) return;
    if (page?.nextCursor === anchor.cursor) {
      if (!earlierLoading) earlierAnchor.current = null;
      return;
    }
    earlierAnchor.current = null;
    // Prepending history must preserve the visible turns, even at scrollTop 0.
    if (anchor.element.isConnected) node.scrollTop += anchor.element.offsetTop - anchor.offset;
  }, [earlierLoading, page?.nextCursor]);
  useLayoutEffect(() => {
    const node = scroller.current, body = content.current;
    if (!node || !body) return;
    const observer = new ResizeObserver(() => {
      const bottom = node.scrollHeight - node.clientHeight;
      if (follow.current && bottom > 0 && bottom !== node.scrollTop) node.scrollTop = bottom;
      setCanScrollToEnd(bottom - node.scrollTop > 12);
    });
    observer.observe(node);
    observer.observe(body);
    return () => observer.disconnect();
  }, []);
  return <div className="yard-source-transcript overflow-y-auto" role="region" aria-label={label} ref={scroller}
    onClickCapture={event => {
      if (event.target instanceof Element && event.target.closest('[data-source-inspect]')) follow.current = false;
    }}
    onWheel={event => { if (event.deltaY < 0 && event.currentTarget.scrollTop <= 32) loadEarlier(true); }}
    onScroll={event => {
      const node = event.currentTarget;
      const wasNearEnd = follow.current;
      const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
      follow.current = !navigation.past && distance <= 12;
      setCanScrollToEnd(!follow.current);
      if (!wasNearEnd && node.scrollTop <= 32) loadEarlier(true);
    }}>
    {navigation.rail}
    <div className="yard-source-transcript-content" ref={content} data-thread-user-message-navigation-content="true">
    {(navigation.past ? navigation.past.before : page?.nextCursor) ? <button type="button" disabled={earlierLoading || navigation.busy} className="yard-source-earlier-messages"
      onClick={() => loadEarlier(false)}>
      Load earlier messages <ChevronRight size={14} aria-hidden="true" />
    </button> : null}
    {turns.map((turn, index) => {
      const active = turn.status === 'inProgress' && !turn.id.startsWith('preparing:');
      const waiting = active && request && (request.turnId === turn.id || request.turnId === null) ? request : undefined;
      const awaitingEdit = waiting?.kind === 'file' ? waiting.itemId : undefined;
      const answers = turn.items.filter((item): item is ThreadItemSummary & { text: string } =>
        item.type === 'agentMessage' && !(Array.isArray(item.questions) && item.questions.length) && typeof item.text === 'string' && !!item.text.trim() && !isActivity(item));
      const changes = !active && openChanges ? <TurnChangeCard turn={turn} open={openChanges} /> : undefined;
      const firstPrompt = turn.items.find(item => item.type === 'userMessage');
      const blocks = turnTimeline(turn.items, active, turn.itemsView !== 'full');
      const lastAnswer = answers.at(-1);
      const lastActivity = blocks.filter(block => block.kind === 'activity').at(-1);
      const firstActivity = blocks.find(block => block.kind === 'activity');
      const previous = turns[index - 1];
      const startedAt = turn.startedAt ?? 0;
      const showTime = firstPrompt && startedAt > 0 && (previous ?
        typeof previous.completedAt === 'number' && startedAt - previous.completedAt > promptSeparatorGap :
        !page?.nextCursor && openedAt - startedAt > promptSeparatorGap);
      return <div className="yard-source-turn" key={turn.id} data-turn-status={turn.status} data-message-navigation-turn={turn.id}
        data-request-open={waiting && waiting.kind !== 'command' || undefined}
        data-source-earlier-turn={index < turns.length - 1 || undefined}>
        {showTime && <TurnTime seconds={startedAt} />}
        {blocks.map(block => {
          if (block.kind === 'activity') return <React.Fragment key={block.key}>
            {active && block === lastActivity && index === turns.length - 1 && <TurnProgress threadId={stream.threadId} hostId={stream.hostId} turnId={turn.id}
              working={!!waiting || turn.items.some(item => isActivity(item) && item.status === 'inProgress')}
              interrupt={() => stop ? stop(turn.id) : interruptTurn(stream.threadId, turn.id, stream.hostId)}
              read={() => readContinuationTurns(stream.threadId, stream.hostId)} />}
            <TurnActivity stream={stream} turn={turn} range={block}
              showHeader={block === firstActivity} disclosure={{ expanded: workOpen.get(turn.id),
                change: expanded => setWorkOpen(previous => new Map(previous).set(turn.id, expanded)) }}
              toolInspected={inspectedTurnId === turn.id} awaitingEdit={awaitingEdit}
              pendingRequest={block === lastActivity && !!waiting} subagents={subagents} openSubagent={openSubagent}
              waitingForInput={block === lastActivity && !!waiting && (isInputRequest(waiting) || waiting.kind === 'mcp')}
              externalInput={block === lastActivity && waiting?.kind === 'mcp' ? waiting.elicitation : undefined} />
          </React.Fragment>;
          if (block.kind === 'images') return <React.Suspense key={block.key} fallback={null}>
            <GeneratedImages items={block.items} active={active} hostId={stream.hostId} turnId={turn.id} startedAt={turn.startedAt} />
          </React.Suspense>;
          const { item } = block;
          if (block.kind === 'question') return <AsyncQuestionMessage key={block.key} item={item} active={active} />;
          if (block.kind === 'answer') return <AssistantMessage key={block.key} text={String(item.text ?? '')} active={active} turnId={turn.id}
            completedAt={item === lastAnswer ? turn.completedAt : undefined}
            branch={turn.status === 'completed' || turn.status === 'interrupted' ? branch : undefined}
            changes={item === lastAnswer ? changes : undefined} />;
          const navigationId = messageNavigationId(turn.id, item === firstPrompt ? undefined : item.id);
          if (edit?.turnId === turn.id && edit.itemId === item.id) return <div key={item.id} data-message-navigation-id={navigationId}>{inlineEdit}</div>;
          const canEdit = !edit && item === editItem && !!latestPrompt;
          return <PromptMessage key={typeof item.clientId === 'string' ? item.clientId : item.id} item={item} hostId={stream.hostId}
            navigationId={navigationId}
            startedAt={item === firstPrompt ? turn.startedAt : undefined} editButton={canEdit ? editButton : undefined}
            edit={canEdit ? () => {
              setEdit({ turnId: turn.id, itemId: item.id, prompt: latestPrompt });
              setEditText(latestPrompt.text);
              setEditStatus('idle');
              setEditError(undefined);
            } : undefined} />;
        })}
        {!answers.length && changes}
        {turn.status === 'failed' && <div className="yard-source-turn-error" role="alert">
          <CircleAlert size={16} aria-hidden="true" /><p dir="auto">{turn.error?.message || 'The response failed.'}</p>
        </div>}
      </div>;
    })}
    {navigation.past?.after && <button type="button" className="yard-source-earlier-messages" disabled={navigation.busy}
      onClick={() => void navigation.extend('after')}>Load later messages <ChevronRight size={14} aria-hidden="true" /></button>}
    {!editInPlace && inlineEdit}
    </div>
    {navigation.status}
    {(canScrollToEnd || navigation.past) && <div className="yard-source-scroll-end">
      <button type="button" aria-label={navigation.past ? 'Back to latest messages' : 'Scroll to bottom'} title={navigation.past ? 'Back to latest messages' : 'Scroll to bottom'} onClick={() => {
        navigation.latest();
        const node = scroller.current;
        if (!node) return;
        follow.current = true;
        node.scrollTop = node.scrollHeight - node.clientHeight;
        setCanScrollToEnd(false);
      }}><ArrowDown size={16} aria-hidden="true" /></button>
    </div>}
  </div>;
}
