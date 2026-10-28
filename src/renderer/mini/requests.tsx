import { useId } from 'react';
import type { ServerRequestRef } from '../workbench-contract.ts';

export type MiniOutcome = 'ready' | 'sending' | 'sent' | 'unknown' | 'expired';
export type MiniInputDraft = Record<string, { selected: string | null; other: string }>;

interface RequestView {
  requestRef: ServerRequestRef;
  title: string;
  detail?: string;
  outcome: MiniOutcome;
  error?: string;
}

export interface MiniApproval extends RequestView {
  /** Exact results supplied by the parent's approval projection. */
  choices: readonly { label: string; result: unknown }[];
}

export interface MiniQuestion extends RequestView {
  inputDraft: MiniInputDraft;
  questions: readonly {
    id: string;
    header: string;
    question: string;
    isOther: boolean;
    isSecret: boolean;
    options: readonly { label: string; description: string }[] | null;
  }[];
}

export interface MiniOpenRequest extends RequestView {}

export type MiniRequest =
  | { kind: 'approval'; request: MiniApproval }
  | { kind: 'question'; request: MiniQuestion }
  | { kind: 'open'; request: MiniOpenRequest };

interface ActionView { id: string; label: string }
interface MutationView extends ActionView { turnId: string; outcome: MiniOutcome; error?: string }
export type MiniNotificationAction =
  | (ActionView & { kind: 'open' })
  | (ActionView & { kind: 'follow-up' })
  | (MutationView & { kind: 'stop' })
  | (MutationView & { kind: 'implement-plan'; planContent: string; collaborationMode: unknown });

export interface MiniIdentity { hostId: string; threadId: string }
export type MiniMutationAction = Exclude<MiniNotificationAction, { kind: 'open' | 'follow-up' }>;
export type MiniActionRunner = (identity: MiniIdentity, action: MiniMutationAction) => Promise<void>;
export type MiniResponder = (ref: ServerRequestRef, result: unknown) => Promise<void>;

export function sameRequestRef(left: ServerRequestRef, right: ServerRequestRef): boolean {
  return left.hostId === right.hostId && left.id === right.id && left.generation === right.generation;
}

function WriteStatus({ state, error }: { state: MiniOutcome; error?: string }) {
  if (state === 'sending') return <small role="status">Sending...</small>;
  if (state === 'sent') return <small role="status">Response sent{error ? `: ${error}` : ''}</small>;
  if (state === 'unknown') return <small role="alert">Response could not be confirmed. Check the conversation before responding again.{error && ` ${error}`}</small>;
  if (state === 'expired') return <small role="status">Request expired. Open the conversation to check its status.{error && ` ${error}`}</small>;
  return error ? <small role="alert">Not sent: {error}</small> : null;
}

export function Approval({ approval, enabled, canWrite, onRespond }: {
  approval: MiniApproval; enabled: boolean; canWrite(): boolean; onRespond: MiniResponder;
}) {
  return <div className="yard-mini-request">
    <strong>{approval.title}</strong>{approval.detail && <p>{approval.detail}</p>}
    <div className="yard-mini-request-actions">{approval.choices.map((choice, index) => <button type="button" key={index}
      disabled={!enabled || approval.outcome !== 'ready'} onClick={() => {
        if (canWrite()) void onRespond(approval.requestRef, choice.result).catch(() => {});
      }}>{choice.label}</button>)}</div>
    <WriteStatus state={approval.outcome} error={approval.error} />
  </div>;
}

export function Question({ question, enabled, canWrite, onRespond, onInputDraftChange }: {
  question: MiniQuestion; enabled: boolean; canWrite(): boolean; onRespond: MiniResponder;
  onInputDraftChange(ref: ServerRequestRef, draft: MiniInputDraft): void;
}) {
  const id = useId();
  const validQuestions = question.questions.length > 0 && new Set(question.questions.map(item => item.id)).size === question.questions.length;
  const answerFor = (item: MiniQuestion['questions'][number]) => question.inputDraft[item.id] ??
    { selected: item.options?.[0]?.label ?? null, other: '' };
  const valueFor = (item: MiniQuestion['questions'][number]) => {
    const value = answerFor(item);
    return value.selected === null ? item.isOther || !item.options?.length ? value.other : ''
      : item.options?.some(option => option.label === value.selected) ? value.selected : '';
  };
  const complete = validQuestions && question.questions.every(item => valueFor(item).trim().length > 0);
  return <form className="yard-mini-request yard-mini-question" onSubmit={event => {
    event.preventDefault();
    if (!complete || !enabled || question.outcome !== 'ready' || !canWrite()) return;
    const result = { answers: Object.fromEntries(question.questions.map(item => [item.id, { answers: [valueFor(item)] }])) };
    void onRespond(question.requestRef, result).catch(() => {});
  }}>
    <strong>{question.title}</strong>{question.detail && <p>{question.detail}</p>}
    {question.questions.map((item, index) => {
      const value = answerFor(item);
      const update = (next: typeof value) => {
        if (enabled && question.outcome === 'ready' && canWrite()) onInputDraftChange(question.requestRef, { ...question.inputDraft, [item.id]: next });
      };
      const options = item.options ?? [];
      return <fieldset key={item.id} disabled={!enabled || question.outcome !== 'ready'}>
        <legend>{item.question || item.header}</legend>
        {item.header && item.question && item.header !== item.question && <small>{item.header}</small>}
        {options.map((option, optionIndex) => <label className="yard-mini-question-option" key={optionIndex}>
          <input type="radio" name={`${id}-${index}`} checked={value.selected === option.label}
            onChange={() => update({ ...value, selected: option.label })} />
          <span>{option.label}{option.description && <small>{option.description}</small>}</span>
        </label>)}
        {item.isOther && options.length > 0 && <label className="yard-mini-question-option">
          <input type="radio" name={`${id}-${index}`} checked={value.selected === null} onChange={() => update({ ...value, selected: null })} />
          <span>Other</span>
        </label>}
        {(options.length === 0 || item.isOther && value.selected === null) && <input className="yard-mini-question-input"
          aria-label={`${item.question || item.header} answer`} type={item.isSecret ? 'password' : 'text'} value={value.other}
          onChange={event => update({ selected: null, other: event.target.value })} />}
      </fieldset>;
    })}
    {!validQuestions && <small role="alert">This question cannot be answered here. Open the conversation to review it.</small>}
    <div className="yard-mini-request-actions"><button type="submit" disabled={!enabled || !complete || question.outcome !== 'ready'}>Submit answer</button></div>
    <WriteStatus state={question.outcome} error={question.error} />
  </form>;
}

export function OpenRequest({ request, identity, onOpen }: { request: MiniOpenRequest; identity: MiniIdentity; onOpen(identity: MiniIdentity): void }) {
  return <div className="yard-mini-request"><strong>{request.title}</strong>{request.detail && <p>{request.detail}</p>}
    <div className="yard-mini-request-actions"><button type="button" onClick={() => onOpen(identity)}>Open conversation</button></div>
    <WriteStatus state={request.outcome} error={request.error} />
  </div>;
}

export function NotificationAction({ action, identity, enabled, canWrite, onOpen, onFollowUp, onRun }: {
  action: MiniNotificationAction; identity: MiniIdentity; enabled: boolean; canWrite(): boolean;
  onOpen(identity: MiniIdentity): void; onFollowUp?: (identity: MiniIdentity) => void; onRun?: MiniActionRunner;
}) {
  if (action.kind === 'open') return <button type="button" onClick={() => onOpen(identity)}>{action.label}</button>;
  if (action.kind === 'follow-up') return <button type="button" disabled={!enabled || !onFollowUp}
    onClick={() => { if (canWrite()) onFollowUp?.(identity); }}>{action.label}</button>;
  return <div className="yard-mini-notification-action">
    <button type="button" disabled={!enabled || !onRun || action.outcome !== 'ready'}
      onClick={() => { if (canWrite() && onRun) void onRun(identity, action).catch(() => {}); }}>{action.label}</button>
    <WriteStatus state={action.outcome} error={action.error} />
  </div>;
}
