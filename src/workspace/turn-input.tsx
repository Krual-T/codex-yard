import { ArrowRight, ChevronLeft, ChevronRight, Mic, Pencil, X } from 'lucide-react';
import { useId, useState, type KeyboardEvent } from 'react';
import { record } from '../native/protocol.ts';

type Option = { label: string; description: string };
export type Question = { id: string; question: string; options: Option[]; custom: boolean; secret: boolean };
export type Answers = Record<string, { answers: string[] }>;

export function parseQuestions(value: unknown): Question[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  return value.flatMap(entry => {
    const { id, question, options: choices, isOther, isSecret } = record(entry);
    if (typeof id !== 'string' || !id || ids.has(id) || typeof question !== 'string' || !question.trim()) return [];
    ids.add(id);
    const options = Array.isArray(choices) ? choices.map(record)
      .flatMap(({ label, description }) => typeof label === 'string' && label.trim()
        ? [{ label, description: typeof description === 'string' ? description : '' }] : []) : [];
    return [{ id, question, options, custom: isOther === true || !options.length, secret: isSecret === true }];
  });
}

const recommended = /\s*\(Recommended\)\s*$/i;

export function InputRequestCard({ questions, submitted, error, onAnswer, onDismiss }: {
  questions: readonly Question[];
  submitted?: boolean;
  error?: string;
  onAnswer(answers: Answers): void;
  onDismiss(): void;
}) {
  const heading = useId();
  const [page, setPage] = useState(0);
  const [selections, setSelections] = useState(new Map<string, number>());
  const [written, setWritten] = useState(new Map<string, string>());
  const [answers, setAnswers] = useState(new Map<string, string>());
  const question = questions[page]!;
  const priorSelection = selections.get(question.id);
  const defaultSelection = question.options.findIndex(({ label }) => recommended.test(label));
  const selected = priorSelection ?? Math.max(0, defaultSelection);
  const typed = written.get(question.id) ?? '';
  const last = page === questions.length - 1;
  const prompt = question.options.length ? 'No, and tell ChatGPT what to do differently' : 'Type your answer';

  function choose(index: number) {
    setSelections(previous => new Map(previous).set(question.id, index));
  }

  function commit(answer?: string) {
    if (submitted) return;
    const next = new Map(answers);
    if (answer) next.set(question.id, answer);
    else next.delete(question.id);
    setAnswers(next);
    if (!last) setPage(page + 1);
    else onAnswer(Object.fromEntries(Array.from(next, ([id, value]) => [id, { answers: [value] }])));
  }

  function onTextEnter(event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (typed.trim()) commit(typed.trim());
  }

  function write(value: string) {
    setWritten(previous => new Map(previous).set(question.id, value));
  }

  return <section className="yard-source-approval yard-source-input-request" aria-labelledby={heading} data-source-input-request=""
    tabIndex={-1} aria-busy={submitted && !error}
    onKeyDown={event => {
      if (submitted || event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onDismiss();
        return;
      }
      if (!(event.target instanceof HTMLElement) || event.target.closest('input,textarea')) return;
      const index = Number(event.key) - 1;
      if (/^[1-9]$/.test(event.key) && question.options[index]) {
        event.preventDefault();
        choose(index);
        event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[index]?.focus();
      }
    }}>
    <div className="yard-source-input-heading">
      <h3 id={heading}>{question.question}</h3>
      <div className="yard-source-input-navigation">
        {questions.length > 1 && <>
          <button type="button" aria-label="Previous question" title="Previous question" disabled={page === 0 || submitted}
            onClick={() => setPage(page - 1)}><ChevronLeft size={14} aria-hidden="true" /></button>
          <span aria-live="polite">{page + 1} of {questions.length}</span>
          <button type="button" aria-label="Next question" title="Next question" disabled={last || submitted}
            onClick={() => setPage(page + 1)}><ChevronRight size={14} aria-hidden="true" /></button>
        </>}
        <button type="button" aria-label="Dismiss" title="Dismiss" disabled={submitted} onClick={onDismiss}>
          <X size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
    {!!question.options.length && <div role="radiogroup" aria-labelledby={heading} onKeyDown={event => {
      const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]');
      const focusIndex = Array.from(buttons).indexOf(event.target as HTMLButtonElement);
      if (focusIndex < 0 || submitted || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        commit(question.options[focusIndex]?.label);
        return;
      }
      const delta = event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : 0;
      if (delta) {
        event.preventDefault();
        const next = (focusIndex + delta + buttons.length) % buttons.length;
        choose(next);
        buttons[next]?.focus();
      }
    }}>
      {question.options.map(({ label, description }, index) => <button key={question.id + ':' + index} type="button" role="radio"
        aria-label={label} aria-checked={index === selected} tabIndex={index === selected ? 0 : -1}
        data-selected={priorSelection === index || undefined} disabled={submitted} onClick={() => choose(index)}
        onDoubleClick={() => commit(label)}>
        <kbd aria-hidden="true">{index + 1}</kbd>
        <span><span>{label.replace(recommended, '')}{recommended.test(label) && <small>Recommended</small>}</span>
          {description && <span className="yard-source-input-option-description">{description}</span>}
        </span>
        <ArrowRight size={16} className="yard-source-input-option-arrow" aria-hidden="true" />
      </button>)}
    </div>}
    {error && <p role="alert">{error}</p>}
    <div className="yard-source-input-footer">
      {question.custom && <>
        <Pencil size={14} aria-hidden="true" />
        {question.secret ? <input key={question.id} type="password" value={typed} aria-label={prompt} placeholder={prompt}
          autoComplete="off" spellCheck={false} disabled={submitted}
          onKeyDown={onTextEnter} onChange={event => write(event.target.value)} /> :
          <textarea key={question.id} rows={1} value={typed} aria-label={prompt} placeholder={prompt}
            autoComplete="off" disabled={submitted}
            onKeyDown={onTextEnter} onChange={event => write(event.target.value)} />}
        <button type="button" className="yard-source-input-dictate" aria-label="Dictate" title="Dictate" disabled>
          <Mic size={14} aria-hidden="true" />
        </button>
      </>}
      <button type="button" data-primary={!!typed.trim() || undefined} disabled={submitted}
        onClick={() => commit(typed.trim())}>{typed.trim() ? 'Submit' : 'Skip'}</button>
    </div>
  </section>;
}
