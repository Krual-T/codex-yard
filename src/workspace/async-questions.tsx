import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { ThreadItemSummary, TurnSummary } from '../../lib/codex-protocol.ts';
import { asyncQuestions, questionReplies, questionReplyText, type AsyncQuestion } from '../native/async-questions.ts';
import { mergeLiveTurns, type TurnStream } from './turn-stream.ts';
import { composerInput } from './composer-input.ts';
import { sendExistingThread, steerTurn } from './host.ts';
import { MessageBody } from './message-body.tsx';
import { WorkspaceIcon } from './workspace-icon.tsx';
import { MessageActions } from './message-actions.tsx';
import { MessageCopy } from './message-copy.tsx';
import './async-questions.css';

type Draft = { value: string; option?: number };
type Session = { active: boolean; questions: AsyncQuestion[]; selected?: AsyncQuestion; answers: ReadonlyMap<string, string>;
  drafts: ReadonlyMap<string, Draft>; pending: boolean; error?: string;
  hasQuestion(id: string): boolean; select(id: string): void; open(ids: string[]): void; close(): void;
  write(id: string, value: string, option?: number): void; advance(answer?: string): void };
const Context = createContext<Session | null>(null);
const noStream = () => () => {};
const empty: readonly TurnSummary[] = [];
const action = 'no-drag cursor-interaction items-center select-none disabled:cursor-default focus:outline-hidden disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 whitespace-nowrap flex border gap-1 rounded-full h-token-button-composer px-(--padding-button-composer-inline,calc(var(--spacing)*2)) py-0 text-(length:--text-button-composer,var(--text-sm)) leading-(--line-height-button-composer,18px) shrink-0';

export function AsyncQuestionsProvider({ stream, history, children }: {
  stream?: TurnStream; history?: readonly TurnSummary[]; children: ReactNode;
}) {
  const live = useSyncExternalStore(stream?.subscribe ?? noStream, stream?.read ?? (() => empty));
  const turns = useMemo(() => mergeLiveTurns(history, live), [history, live]);
  const latest = turns.at(-1);
  const active = latest?.status === 'inProgress';
  const allQuestions = useMemo(() => turns.flatMap(turn => turn.items.flatMap(asyncQuestions)), [turns]);
  const latestQuestions = useMemo(() => latest?.items.flatMap(asyncQuestions) ?? [], [latest]);
  const replies = useMemo(() => new Map(turns.flatMap(turn => turn.items.flatMap(questionReplies))
    .map(reply => [reply.questionItemId, reply.answer])), [turns]);
  const [selection, setSelection] = useState<{ id: string | null; ids: string[]; seen: string[] }>();
  const [drafts, setDrafts] = useState(new Map<string, Draft>());
  const [submitted, setSubmitted] = useState(new Map<string, string>());
  const [skipped, setSkipped] = useState(new Set<string>());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const sending = useRef(false);
  const answers = new Map([...replies, ...submitted]);
  const outstanding = latestQuestions.filter(question => !answers.has(question.id) && !skipped.has(question.id));
  const chosen = allQuestions.find(question => question.id === selection?.id);
  const questions = chosen ? allQuestions.filter(question => selection?.ids.includes(question.id)) :
    outstanding.filter(question => !selection?.seen.includes(question.id));
  // Only running turns open automatically. An explicit answer remains usable
  // when that turn finishes or a newer turn starts.
  const selected = chosen ?? (active ? questions[0] : undefined);
  function select(id: string | null, ids = questions.map(question => question.id)) {
    setSelection({ id, ids, seen: allQuestions.map(question => question.id) }); setError(undefined);
  }
  async function advance(answer?: string) {
    if (!stream || !latest || !selected || sending.current) return;
    select(selected.id);
    const nextDrafts = new Map(drafts);
    nextDrafts.set(selected.id, answer?.trim() ? { ...drafts.get(selected.id), value: answer.trim() } : { value: '' });
    setDrafts(nextDrafts);
    const next = questions[questions.indexOf(selected) + 1];
    if (next) {
      if (!answer?.trim()) setSkipped(previous => new Set(previous).add(selected.id));
      select(next.id); return;
    }
    const responses = questions.flatMap(question => {
      const value = (nextDrafts.get(question.id)?.value ?? answers.get(question.id))?.trim();
      return value ? [{ questionItemId: question.id, question: question.title, answer: value }] : [];
    });
    if (!responses.length) { setSkipped(previous => new Set(previous).add(selected.id)); select(null); return; }
    sending.current = true; setPending(true); setError(undefined);
    try {
      const text = questionReplyText(responses);
      const current = mergeLiveTurns(history, stream.read()).at(-1);
      if (current?.status === 'inProgress') await steerTurn(stream.threadId, current.id, composerInput(text), stream.hostId);
      else {
        const { turn } = await sendExistingThread(stream.threadId, text, () => true, [], stream.hostId, undefined,
          { turnTrigger: 'send_user_message_async_question' });
        stream.acknowledge(turn);
      }
      setSubmitted(previous => new Map([...previous, ...responses.map(reply => [reply.questionItemId, reply.answer] as const)]));
      select(null);
    } catch (error) { setError(error instanceof Error ? error.message : 'Couldn’t send response'); }
    finally { sending.current = false; setPending(false); }
  }
  return <Context value={{ active, questions, selected, answers, drafts, pending, error, select,
    hasQuestion: id => allQuestions.some(question => question.id === id),
    open: ids => { if (ids[0]) select(ids[0], ids); }, close: () => select(null),
    write: (id, value, option) => {
      // Pin the current question before its delayed choice click or text edit:
      // an intervening turn/completed must not cancel the user's response.
      if (selection?.id !== id) select(id);
      setDrafts(previous => new Map(previous).set(id, { value, option }));
    }, advance: answer => void advance(answer) }}>
    {children}
  </Context>;
}

export function useAsyncQuestionOpen() { return !!useContext(Context)?.selected; }

export function AsyncQuestionMessage({ item }: { item: ThreadItemSummary; active: boolean }) {
  const session = useContext(Context);
  return <>
    {asyncQuestions(item).map(question => <article className="yard-source-agent-message" key={question.id}>
      <MessageBody text={question.title} />
      {session?.hasQuestion(question.id) && !session.selected && !session.answers.has(question.id) && <button type="button"
        className={action + ' border-default bg-transparent text-default not-disabled:hover:bg-primary-ghost-hover mt-3'}
        disabled={session.pending} onClick={() => session.open([question.id])}><WorkspaceIcon name="asyncQuestion" />Answer question</button>}
    </article>)}
  </>;
}

export function AsyncQuestionReplyMessage({ item }: { item: ThreadItemSummary }) {
  const session = useContext(Context);
  const replies = questionReplies(item);
  return <div className="yard-source-user-turn"><h4 className="sr-only">You said:</h4>
    <div className="yard-source-user-message bg-user-message text-user-message rounded-2xl _bubble_168sz_1" data-user-message-bubble="true">
      <div className="yard-source-async-replies" data-source-async-question-replies="">
        {replies.map(reply => <div key={reply.questionItemId} className="yard-source-async-reply" data-question-item-id={reply.questionItemId}>
          <span className="yard-source-async-reply-question" title={reply.question}>{reply.question}</span>
          <MessageBody text={reply.answer} />
        </div>)}
      </div>
    </div>
    <MessageActions>
      <MessageCopy label="Copy message" text={replies.map(reply => reply.question + '\n' + reply.answer).join('\n\n')} messageAction />
      {session && replies.some(reply => session.hasQuestion(reply.questionItemId)) && <button type="button" aria-label="Edit response"
        disabled={session.pending} onClick={() => session.open(replies.map(reply => reply.questionItemId))}><WorkspaceIcon name="edit" /></button>}
    </MessageActions>
  </div>;
}

/** Pinned r1e/nB: Question header, numbered choices, custom reply, Skip/Send. */
export function AsyncQuestionPanel({ hidden }: { hidden?: boolean }) {
  const session = useContext(Context);
  const input = useRef<HTMLTextAreaElement>(null);
  const question = session?.selected;
  const panel = useRef<HTMLElement>(null);
  const advancing = useRef<ReturnType<typeof setTimeout>>(undefined);
  const composing = useRef(false);
  const [choice, setChoice] = useState<string>();
  useEffect(() => {
    setChoice(undefined);
    composing.current = false;
    if (question) {
      if (question.options.length) panel.current?.focus();
      else input.current?.focus();
    }
    return () => { clearTimeout(advancing.current); advancing.current = undefined; };
  }, [question?.id]);
  if (!session || !question || hidden) return null;
  const index = session.questions.indexOf(question), last = index === session.questions.length - 1;
  const priorAnswer = session.answers.get(question.id) ?? '';
  const priorOption = question.options.indexOf(priorAnswer);
  const draft = session.drafts.get(question.id) ?? { value: priorAnswer, option: priorOption < 0 ? undefined : priorOption };
  const inline = question.options.length > 0;
  function choose(option: string, index: number) {
    if (advancing.current || session!.pending) return;
    session!.write(question!.id, option, index); setChoice(option);
    // Pinned nB gives the selected choice 180 ms before advancing.
    advancing.current = setTimeout(() => {
      advancing.current = undefined;
      session!.advance(option);
    }, 180);
  }
  const editor = <div className="flex min-w-0 flex-1 flex-wrap justify-end gap-2 items-end">
    {inline && <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center text-codex-description"><WorkspaceIcon name="pencil" /></span>}
    <textarea ref={input} key={question.id} rows={1}
      className="min-w-0 flex-1 self-center resize-none border-0 bg-transparent p-0 text-sm leading-5 focus:outline-none field-sizing-content"
      aria-label={inline ? 'Or write your own response' : 'Reply…'} placeholder={inline ? 'Or write your own response' : 'Reply…'}
      value={draft.option === undefined ? draft.value : ''} disabled={session.pending}
      onChange={event => session.write(question.id, event.target.value)}
      onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
      onFocus={() => {
        clearTimeout(advancing.current); advancing.current = undefined; setChoice(undefined);
        if (draft.option !== undefined) session.write(question.id, '');
      }}
      onKeyDown={event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && !composing.current && event.nativeEvent.keyCode !== 229) {
          event.preventDefault(); event.stopPropagation(); if (draft.value.trim()) session.advance(draft.value);
        }
      }} />
    <button type="button" disabled aria-label="Dictate" className="flex h-token-button-composer aspect-square shrink-0 items-center justify-center text-tertiary"><WorkspaceIcon name="microphone" /></button>
  </div>;
  return <section className="flex flex-col overflow-hidden text-default focus:outline-none rounded-3xl border border-default bg-surface-elevated-secondary mb-2 @container/request-card" aria-label="Question"
    ref={panel} tabIndex={0}
    data-source-async-question="" data-codex-composer-request-navigation="true" aria-busy={session.pending}
    onKeyDown={event => {
      if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey || session.pending) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); session.close(); }
      if (event.target instanceof HTMLElement && event.target.closest('textarea,input')) return;
      const choice = Number(event.key) - 1;
      if (/^[1-9]$/.test(event.key) && question.options[choice]) {
        event.preventDefault(); choose(question.options[choice]!, choice);
      }
    }}>
    <div className="flex items-start justify-between border-border/70 ps-4 pe-3 pt-4 pb-2">
      <span className="flex items-center gap-2 leading-5 font-normal text-secondary text-size-chat-sm select-none"><WorkspaceIcon name="asyncQuestion" />Question</span>
      <div className="yard-source-input-navigation">
        {session.questions.length > 1 && <>
          <button type="button" aria-label="Previous question" disabled={!index || session.pending}
            onClick={() => session.select(session.questions[index - 1]!.id)}><WorkspaceIcon name="questionChevron" size={12} className="rotate-90" /></button>
          <span>{index + 1} of {session.questions.length}</span>
          <button type="button" aria-label="Next question" disabled={last || session.pending}
            onClick={() => session.select(session.questions[index + 1]!.id)}><WorkspaceIcon name="questionChevron" size={12} className="-rotate-90" /></button>
        </>}
        <button type="button" aria-label="Dismiss" disabled={session.pending} onClick={session.close}><WorkspaceIcon name="closeSmall" size={12} /></button>
      </div>
    </div>
    <div className="flex flex-col gap-3 pt-1 pb-2">
    <div className="px-4 text-sm font-medium break-words whitespace-pre-wrap">{question.title}</div>
    <div className="flex flex-col gap-1 px-2">
    {!!question.options.length && <div className="flex flex-col gap-1" role="radiogroup" aria-label={question.title} onKeyDown={event => {
      if (session.pending || event.altKey || event.ctrlKey || event.metaKey) return;
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
      const current = buttons.indexOf(event.target as HTMLButtonElement);
      const delta = event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : 0;
      if (current >= 0 && delta) { event.preventDefault(); buttons[(current + delta + buttons.length) % buttons.length]?.focus(); }
    }}>
      {question.options.map((option, index) => <button type="button" role="radio" aria-checked={draft.option === index} key={index}
        aria-label={option}
        className={'group flex min-h-8 w-full cursor-interaction items-center gap-2 px-2 py-1.5 text-start text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-within:bg-text/5 rounded-xl hover:bg-text/5' + (choice === option ? ' bg-text/5' : '')}
        disabled={session.pending} onClick={() => choose(option, index)}><span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center rounded-xs border text-xs leading-none font-medium self-start border-default bg-text/5 text-codex-description">{index + 1}</span>
        <span className="min-w-0 text-sm font-medium wrap-anywhere">{option}</span>
        <WorkspaceIcon name="back" className="ms-auto rotate-180 text-codex-description opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" /></button>)}
    </div>}
    {session.error && <p role="alert">{session.error}</p>}
    {!inline && <div className="flex w-full items-center px-2 py-1.5">
      <div role="presentation" className="relative min-w-0 flex-1 rounded-lg border border-primary-outline px-3 py-2">{editor}</div>
    </div>}
    <div role="presentation" className={'flex items-center gap-2 ' + (inline
      ? 'group min-h-8 w-full cursor-text px-2 py-1.5 text-start text-sm rounded-xl focus-within:ring-1 focus-within:ring-ring'
      : 'justify-end px-2 py-1.5')}>
      {inline && editor}
      <div className="flex items-center gap-2 place-self-end">
      <button type="button" disabled={session.pending} className={action + ' border-default bg-primary-soft-alpha not-disabled:hover:bg-primary-ghost-hover'}
        data-request-input-dismiss="" onClick={() => session.advance()}>Skip</button>
      <button type="button" disabled={session.pending || !draft.value.trim()} className={action + ' border-default bg-primary-solid not-disabled:hover:bg-text/80 text-primary-solid'} onClick={() => session.advance(draft.value)}>
        {!last ? 'Next' : session.answers.has(question.id) ? 'Send update' : 'Send'}
      </button>
      </div>
    </div>
    </div>
    </div>
  </section>;
}
