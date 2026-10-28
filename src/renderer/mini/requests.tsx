import { useId, useRef, useState, useSyncExternalStore } from 'react';
import type { ServerRequestRef, WorkbenchClient } from '../workbench-contract.ts';

export type MiniOutcome = 'sent' | 'unknown';

export interface MiniApproval {
  requestRef: ServerRequestRef;
  title: string;
  detail?: string;
  /** Exact results for command, file, permission, or MCP elicitation requests. */
  choices: readonly { label: string; result: unknown }[];
  outcome?: MiniOutcome;
}

export interface MiniQuestion {
  requestRef: ServerRequestRef;
  title: string;
  questions: readonly {
    id: string;
    header: string;
    question: string;
    isOther: boolean;
    isSecret: boolean;
    options: readonly { label: string; description: string }[] | null;
  }[];
  outcome?: MiniOutcome;
}

export type MiniRequest =
  | { kind: 'approval'; request: MiniApproval }
  | { kind: 'question'; request: MiniQuestion };

export type MiniNotificationAction =
  | { id: string; kind: 'open'; label: string }
  | { id: string; kind: 'follow-up'; label: string }
  | { id: string; kind: 'stop'; label: string; turnId: string; outcome?: MiniOutcome }
  | { id: string; kind: 'implement-plan'; label: string; turnId: string; planContent: string; collaborationMode: unknown; outcome?: MiniOutcome };

export interface MiniIdentity { hostId: string; threadId: string }
type MiniMutationAction = Exclude<MiniNotificationAction, { kind: 'open' | 'follow-up' }>;
export type MiniActionRunner = (identity: MiniIdentity, action: MiniMutationAction) => Promise<void>;
export type MiniActionOutcome = (identity: MiniIdentity, action: MiniMutationAction, outcome: MiniOutcome) => void;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

/** Only explicit delivery information can make a failed write retryable. */
export function classifyMiniFailure(reason: unknown): { outcome: 'not-sent' | MiniOutcome; message: string } {
  const error = record(reason), data = record(error.data);
  const message = typeof error.message === 'string' && error.message ? error.message : 'The host did not provide an error message.';
  if (error.uncertain === true || data.uncertain === true) return { outcome: 'unknown', message };
  if (error.forwarded === true || data.forwarded === true) return { outcome: 'sent', message };
  if (error.forwarded === false || data.forwarded === false || error.uncertain === false || data.uncertain === false) {
    return { outcome: 'not-sent', message };
  }
  return { outcome: 'unknown', message };
}

const pendingWrites = new Set<string>();
const pendingListeners = new Set<() => void>();
function subscribePending(listener: () => void) {
  pendingListeners.add(listener);
  return () => { pendingListeners.delete(listener); };
}
function notifyPending() { for (const listener of pendingListeners) listener(); }

function useWrite(key: string, outcome: MiniOutcome | undefined, enabled: boolean, canWrite: () => boolean, onOutcome: (outcome: MiniOutcome) => void) {
  const [state, setState] = useState<'idle' | 'sending' | MiniOutcome>('idle');
  const [error, setError] = useState('');
  const locked = useRef(false);
  const pending = useSyncExternalStore(subscribePending, () => pendingWrites.has(key), () => false);
  async function run(write: () => Promise<void>) {
    if (!enabled || !canWrite() || locked.current || pendingWrites.has(key) || outcome) return;
    locked.current = true;
    pendingWrites.add(key); notifyPending();
    setState('sending'); setError('');
    try {
      let result: MiniOutcome;
      try { await write(); result = 'sent'; }
      catch (reason) {
        const failure = classifyMiniFailure(reason);
        setError(failure.message);
        if (failure.outcome === 'not-sent') {
          locked.current = false;
          setState('idle');
          return;
        }
        result = failure.outcome;
      }
      setState(result);
      onOutcome(result);
    } finally {
      pendingWrites.delete(key); notifyPending();
    }
  }
  return { run, state: outcome ?? (pending ? 'sending' : state), error };
}

function requestKey(ref: ServerRequestRef): string { return JSON.stringify(['request', ref.hostId, ref.generation, ref.id]); }

function WriteStatus({ state, error }: { state: 'idle' | 'sending' | MiniOutcome; error: string }) {
  if (state === 'sending') return <small role="status">Sending...</small>;
  if (state === 'sent') return <small role="status">Response sent{error ? `: ${error}` : ''}</small>;
  if (state === 'unknown') return <small role="alert">Response could not be confirmed. Check the conversation before responding again.{error && ` ${error}`}</small>;
  return error ? <small role="alert">Not sent: {error}</small> : null;
}

export function Approval({ client, approval, enabled, canWrite, onOutcome }: {
  client: WorkbenchClient; approval: MiniApproval; enabled: boolean; canWrite(): boolean;
  onOutcome(requestRef: ServerRequestRef, outcome: MiniOutcome): void;
}) {
  const write = useWrite(requestKey(approval.requestRef), approval.outcome, enabled, canWrite, result => onOutcome(approval.requestRef, result));
  return <div className="yard-mini-request">
    <strong>{approval.title}</strong>{approval.detail && <p>{approval.detail}</p>}
    <div className="yard-mini-request-actions">{approval.choices.map((choice, index) => <button type="button" key={index}
      disabled={!enabled || write.state !== 'idle'} onClick={() => { void write.run(() => client.reply(approval.requestRef, { result: choice.result })); }}>{choice.label}</button>)}</div>
    <WriteStatus state={write.state} error={write.error} />
  </div>;
}

export function Question({ client, question, enabled, canWrite, onOutcome }: {
  client: WorkbenchClient; question: MiniQuestion; enabled: boolean; canWrite(): boolean;
  onOutcome(requestRef: ServerRequestRef, outcome: MiniOutcome): void;
}) {
  const id = useId();
  const [answers, setAnswers] = useState<Record<string, { selected: number | null; otherSelected: boolean; other: string }>>({});
  const write = useWrite(requestKey(question.requestRef), question.outcome, enabled, canWrite, result => onOutcome(question.requestRef, result));
  const validQuestions = question.questions.length > 0 && new Set(question.questions.map(item => item.id)).size === question.questions.length;
  const valueFor = (item: MiniQuestion['questions'][number]) => {
    const value = answers[item.id];
    if (!value) return '';
    return value.otherSelected ? value.other : item.options?.[value.selected ?? -1]?.label ?? '';
  };
  const complete = validQuestions && question.questions.every(item => valueFor(item).trim().length > 0);
  return <form className="yard-mini-request yard-mini-question" onSubmit={event => {
    event.preventDefault();
    if (!complete) return;
    const result = { answers: Object.fromEntries(question.questions.map(item => [item.id, { answers: [valueFor(item)] }])) };
    void write.run(() => client.reply(question.requestRef, { result }));
  }}>
    <strong>{question.title}</strong>
    {question.questions.map((item, index) => {
      const value = answers[item.id] ?? { selected: null, otherSelected: false, other: '' };
      const update = (next: Partial<typeof value>) => setAnswers(previous => ({ ...previous, [item.id]: { ...value, ...next } }));
      const options = item.options ?? [];
      return <fieldset key={item.id} disabled={!enabled || write.state !== 'idle'}>
        <legend>{item.question || item.header}</legend>
        {item.header && item.question && item.header !== item.question && <small>{item.header}</small>}
        {options.map((option, optionIndex) => <label className="yard-mini-question-option" key={optionIndex}>
          <input type="radio" name={`${id}-${index}`} checked={!value.otherSelected && value.selected === optionIndex} onChange={() => update({ selected: optionIndex, otherSelected: false })} />
          <span>{option.label}{option.description && <small>{option.description}</small>}</span>
        </label>)}
        {item.isOther && options.length > 0 && <label className="yard-mini-question-option">
          <input type="radio" name={`${id}-${index}`} checked={value.otherSelected} onChange={() => update({ selected: null, otherSelected: true })} />
          <span>Other</span>
        </label>}
        {(options.length === 0 || item.isOther && value.otherSelected) && <input className="yard-mini-question-input"
          aria-label={`${item.question || item.header} answer`} type={item.isSecret ? 'password' : 'text'} value={value.other}
          onChange={event => update({ selected: null, otherSelected: true, other: event.target.value })} />}
      </fieldset>;
    })}
    {!validQuestions && <small role="alert">This question cannot be answered here. Open the conversation to review it.</small>}
    <div className="yard-mini-request-actions"><button type="submit" disabled={!enabled || !complete || write.state !== 'idle'}>Submit answer</button></div>
    <WriteStatus state={write.state} error={write.error} />
  </form>;
}

export function NotificationAction({ action, identity, enabled, canWrite, onOpen, onFollowUp, onRun, onOutcome }: {
  action: MiniNotificationAction; identity: MiniIdentity; enabled: boolean; canWrite(): boolean;
  onOpen(identity: MiniIdentity): void; onFollowUp?: (identity: MiniIdentity) => void; onRun?: MiniActionRunner; onOutcome?: MiniActionOutcome;
}) {
  const runnable = action.kind !== 'open' && action.kind !== 'follow-up' ? action : null;
  const write = useWrite(JSON.stringify(['action', identity.hostId, identity.threadId, action.id]), runnable?.outcome, enabled && !!onRun && !!onOutcome, canWrite,
    outcome => { if (runnable) onOutcome?.(identity, runnable, outcome); });
  if (action.kind === 'open') return <button type="button" onClick={() => onOpen(identity)}>{action.label}</button>;
  if (action.kind === 'follow-up') return <button type="button" disabled={!enabled || !onFollowUp}
    onClick={() => { if (canWrite()) onFollowUp?.(identity); }}>{action.label}</button>;
  return <div className="yard-mini-notification-action">
    <button type="button" disabled={!enabled || !onRun || !onOutcome || write.state !== 'idle'}
      onClick={() => { if (onRun) void write.run(() => onRun(identity, action)); }}>{action.label}</button>
    <WriteStatus state={write.state} error={write.error} />
  </div>;
}
