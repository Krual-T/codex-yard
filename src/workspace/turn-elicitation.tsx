import { ChevronLeft, ChevronRight, Link2, Shield, X } from 'lucide-react';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { record } from '../native/protocol.ts';

type Value = string | number | boolean | string[];
type Choice = { value: string; label: string };
type Field = {
  key: string; label: string; description?: string; required: boolean;
  kind: 'text' | 'number' | 'integer' | 'boolean' | 'choice' | 'multiple';
  choices: Choice[]; initial?: Value;
  format?: 'email' | 'uri' | 'date' | 'date-time'; min?: number; max?: number;
};
type ReviewField = { label: string; value: string };
type Confirmation = {
  field: string; title: string; triggerLabel: string; confirmLabel: string;
  shield: boolean; destructive: boolean; fields: ReviewField[];
  sections?: { title?: string; body: ReviewField; caption: ReviewField }[];
};
export type Elicitation = { serverName: string; message: string } & (
  { mode: 'form'; fields: Field[] } | { mode: 'confirmation'; confirmation: Confirmation } |
  { mode: 'url'; url: string } | { mode: 'unsupported' } | { mode: 'unsupportedForm' }
);
export type ElicitationReply = { action: 'accept' | 'decline' | 'cancel'; content: Record<string, Value> | null; _meta: null };

function choiceList(schema: Record<string, unknown>) {
  const titled = schema.oneOf ?? schema.anyOf;
  if (Array.isArray(titled) && titled.length) return titled.flatMap(raw => {
    const { const: value, title } = record(raw);
    return typeof value === 'string' ? [{ value, label: typeof title === 'string' ? title : value }] : [];
  });
  const labels = Array.isArray(schema.enumNames) ? schema.enumNames : [];
  return Array.isArray(schema.enum) ? schema.enum.flatMap((value, i) => typeof value === 'string'
    ? [{ value, label: typeof labels[i] === 'string' ? labels[i] : value }] : []) : [];
}

function readField(key: string, raw: unknown, required: boolean): Field | undefined {
  const value = record(raw);
  const base = { key, label: typeof value.title === 'string' && value.title ? value.title : key,
    description: typeof value.description === 'string' ? value.description : undefined, required };
  const limit = (name: string) => typeof value[name] === 'number' && Number.isFinite(value[name]) ? value[name] as number : undefined;
  if (value.type === 'string') {
    const choices = choiceList(value);
    if (choices.length || value.enum != null || value.oneOf != null) return choices.length ? { ...base, kind: 'choice', choices } : undefined;
    const { format } = value;
    if (format != null && format !== 'email' && format !== 'uri' && format !== 'date' && format !== 'date-time') return;
    return { ...base, kind: 'text', choices, format: format ?? undefined, min: limit('minLength'), max: limit('maxLength'),
      initial: typeof value.default === 'string' ? value.default : undefined };
  }
  if (value.type === 'number' || value.type === 'integer') return {
    ...base, kind: value.type, choices: [], min: limit('minimum'), max: limit('maximum'),
    initial: typeof value.default === 'number' ? String(value.default) : undefined,
  };
  if (value.type === 'boolean') return { ...base, kind: 'boolean', choices: [], initial: value.default === true };
  if (value.type !== 'array') return;
  const choices = choiceList(record(value.items));
  if (!choices.length) return;
  const initial = Array.isArray(value.default) ? value.default.filter((entry): entry is string =>
    typeof entry === 'string' && choices.some(choice => choice.value === entry)) : [];
  return { ...base, kind: 'multiple', choices, initial, min: limit('minItems'), max: limit('maxItems') };
}

function reviewText(value: unknown, max: number) {
  return typeof value === 'string' && value.trim() && value.trim().length <= max ? value.trim() : undefined;
}

function readConfirmation(raw: unknown, schema: Record<string, unknown>, message: string): Confirmation | undefined {
  const { version, field, presentation } = record(raw);
  const { properties, required } = schema;
  if (version !== 1 || typeof field !== 'string' || !field || !message.trim() || Object.keys(record(properties)).length !== 1 ||
      !Object.hasOwn(record(properties), field) || record(record(properties)[field]).type !== 'boolean' ||
      !Array.isArray(required) || required.length !== 1 || required[0] !== field) return;
  const { title, triggerLabel, confirmLabel, icon, destructive, fields, sections } = record(presentation);
  const heading = reviewText(title, 120), trigger = reviewText(triggerLabel, 80), confirm = reviewText(confirmLabel, 80);
  if (!heading || !trigger || !confirm) return;
  const details = Array.isArray(fields) && fields.length <= 20 ? fields.flatMap(raw => {
    const { label, value } = record(raw);
    const name = reviewText(label, 120);
    return name && typeof value === 'string' && value.length <= 10_000 && value.trim() ? [{ label: name, value }] : [];
  }) : [];
  if (fields != null && (!Array.isArray(fields) || fields.length > 20 || fields.length !== details.length)) return;
  const grouped: Confirmation['sections'] = [];
  const used = new Set<number>();
  if (Array.isArray(sections) && sections.length <= 10) for (const raw of sections) {
    const { title, bodyField, captionField } = record(raw);
    if (typeof bodyField !== 'number' || typeof captionField !== 'number' || bodyField === captionField ||
        !Number.isInteger(bodyField) || !Number.isInteger(captionField) || used.has(bodyField) || used.has(captionField) ||
        !details[bodyField] || !details[captionField] || title !== undefined && !reviewText(title, 120)) break;
    used.add(bodyField);
    used.add(captionField);
    grouped.push({ title: reviewText(title, 120), body: details[bodyField], caption: details[captionField] });
  }
  return { field, title: heading, triggerLabel: trigger, confirmLabel: confirm, shield: icon === 'shield', destructive: destructive === true,
    fields: details, sections: Array.isArray(sections) && grouped.length === sections.length && grouped.length > 0 &&
      used.size === details.length ? grouped : undefined };
}

export function readElicitation(params: Record<string, unknown>): Elicitation {
  const serverName = typeof params.serverName === 'string' ? params.serverName : 'MCP server';
  const message = typeof params.message === 'string' ? params.message : typeof params.description === 'string' ? params.description : '';
  const meta = record(params._meta);
  const base = { serverName, message };
  // Privileged browser/connector requests have a separate approval protocol.
  if (meta.codex_approval_kind != null) return { ...base, mode: 'unsupported' };
  if (params.mode === 'url' && typeof params.url === 'string' && serverName !== 'codex_apps') {
    try {
      const url = new URL(params.url);
      if (url.protocol === 'https:' && !url.username && !url.password) {
        return { ...base, mode: 'url', url: url.href };
      }
    } catch { /* Leave the request visible with a cancel action. */ }
  }
  const extended = params.mode === 'openaiForm' || params.mode === 'openai/form' || Object.hasOwn(meta, 'openai/elicitation');
  if (params.mode === 'form' || params.mode === 'openaiForm' || params.mode === 'openai/form') {
    const fallback = { ...base, mode: 'unsupportedForm' as const };
    const schema = record(params.mode === 'form' && extended ? record(meta['openai/elicitation']).requestedSchema : params.requestedSchema);
    if (schema.type === 'object' && schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)) {
      if (Object.hasOwn(meta, 'openai/confirmation')) {
        const confirmation = readConfirmation(meta['openai/confirmation'], schema, message);
        return confirmation ? { ...base, mode: 'confirmation', confirmation } : fallback;
      }
      if (extended && ['allOf', 'anyOf', 'oneOf', 'not', '$ref'].some(key => Object.hasOwn(schema, key))) return fallback;
      const mandatory = new Set(Array.isArray(schema.required) ? schema.required : []);
      const fields: Field[] = [];
      for (const [key, value] of Object.entries(record(schema.properties))) {
        if (extended && ['x-openai-input', 'x-openai-suggestions', 'pattern', 'allOf', 'not', '$ref'].some(key => Object.hasOwn(record(value), key))) {
          return fallback;
        }
        const field = readField(key, value, mandatory.has(key));
        if (!field) return fallback;
        mandatory.delete(key);
        fields.push(field);
      }
      if (!mandatory.size) return { ...base, mode: 'form', fields };
    }
    return fallback;
  }
  return { ...base, mode: 'unsupported' };
}

function result(action: ElicitationReply['action'], content: ElicitationReply['content'] = null): ElicitationReply {
  return { action, content, _meta: null };
}

function readValue(field: Field, value?: Value): { value?: Value; invalid?: boolean } {
  if (value === undefined || value === '') return { invalid: field.required };
  if (field.kind === 'integer' || field.kind === 'number') {
    const number = Number(value);
    return Number.isFinite(number) && (field.kind !== 'integer' || Number.isInteger(number)) && within(number, field)
      ? { value: number } : { invalid: true };
  }
  if (field.kind === 'multiple' && Array.isArray(value)) return within(value.length, field) ? { value } : { invalid: true };
  if (field.kind !== 'text' || typeof value !== 'string') return { value };
  if (!within(value.length, field)) return { invalid: true };
  if (field.format === 'uri') {
    try { new URL(value); } catch { return { invalid: true }; }
  }
  if (field.format === 'email' && !/^[^\s@]+@[^\s@]+$/.test(value)) return { invalid: true };
  if ((field.format === 'date' || field.format === 'date-time') && !Number.isFinite(Date.parse(value))) return { invalid: true };
  return { value };
}

function within(value: number, field: Field) {
  return (field.min === undefined || value >= field.min) && (field.max === undefined || value <= field.max);
}

type Actions = { submitted?: boolean; error?: string; onReply(value: ElicitationReply): void };

function ElicitationForm({ request, submitted, error, onReply }: Actions & { request: Extract<Elicitation, { mode: 'form' }> }) {
  const { fields, message } = request;
  const heading = useId(), inputId = useId();
  const [index, setIndex] = useState(0);
  const [incorrect, setIncorrect] = useState(false);
  const [draft, setDraft] = useState(() => new Map(fields.map(field => [field.key, field.initial])));
  const field = fields[index], value = field && draft.get(field.key);
  const last = index >= fields.length - 1;
  const nextLabel = last ? 'Continue' : 'Next';

  function page(next: number) { setIndex(next); setIncorrect(false); }
  function change(value: Value) {
    if (field) setDraft(previous => new Map(previous).set(field.key, value));
    setIncorrect(false);
  }
  function skip() {
    if (last) onReply(result('decline'));
    else page(index + 1);
  }
  function next(choice?: string) {
    if (submitted) return;
    const updated = new Map(draft);
    if (field && choice !== undefined) {
      updated.set(field.key, choice);
      setDraft(updated);
    }
    if (field && readValue(field, updated.get(field.key)).invalid) { setIncorrect(true); return; }
    if (!last) { page(index + 1); return; }
    const content: [string, Value][] = [];
    for (const [i, entry] of fields.entries()) {
      const checked = readValue(entry, updated.get(entry.key));
      if (checked.invalid) { setIndex(i); setIncorrect(true); return; }
      if (checked.value !== undefined) content.push([entry.key, checked.value]);
    }
    onReply(result('accept', Object.fromEntries(content)));
  }

  return <section className="yard-source-approval yard-source-elicitation" aria-labelledby={heading}
    aria-busy={submitted && !error} data-source-mcp-form="" onKeyDown={event => {
      if (event.nativeEvent.isComposing || submitted) return;
      if (event.key === 'Escape') { event.preventDefault(); onReply(result('cancel')); }
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        if (field?.kind === 'choice' && value === undefined) skip();
        else next();
      }
    }}>
    <div className="yard-source-elicitation-content">
      <div className="yard-source-input-heading">
        <h3 id={heading} dir="auto">{message || request.serverName + ' requests information'}</h3>
        <div className="yard-source-input-navigation">
          {fields.length > 1 && <>
            <button type="button" title="Previous question" aria-label="Previous question" disabled={index === 0 || submitted}
              onClick={() => page(index - 1)}><ChevronLeft size={14} aria-hidden="true" /></button>
            <span role="status">{index + 1} of {fields.length}</span>
            <button type="button" title="Next question" aria-label="Next question" disabled={last || submitted}
              onClick={() => page(index + 1)}><ChevronRight size={14} aria-hidden="true" /></button>
          </>}
          <button type="button" title="Cancel" aria-label="Cancel" disabled={submitted} onClick={() => onReply(result('cancel'))}>
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
      {field && <fieldset key={field.key} className="yard-source-elicitation-field" data-kind={field.kind}
        disabled={submitted} aria-label={field.label}>
        {field.kind !== 'boolean' && <label htmlFor={inputId} className="yard-source-elicitation-label">{field.label}</label>}
        {field.description && <p className="yard-source-elicitation-description" id={inputId + '-description'} dir="auto">{field.description}</p>}
        {field.kind === 'boolean' ? <label className="yard-source-elicitation-option">
          <input type="checkbox" aria-label={field.label} checked={value === true} onChange={event => change(event.currentTarget.checked)} />
          <span>{field.label}</span>
        </label> : field.kind === 'choice' || field.kind === 'multiple' ? <div role="group" aria-label={field.label}
          className="yard-source-elicitation-choices">
          {field.choices.map(choice => <label key={choice.value} className="yard-source-elicitation-option">
            <input type={field.kind === 'choice' ? 'radio' : 'checkbox'} name={field.kind === 'choice' ? inputId : undefined}
              aria-label={choice.label} checked={field.kind === 'choice' ? value === choice.value : Array.isArray(value) && value.includes(choice.value)}
              onChange={event => {
                if (field.kind === 'choice') next(choice.value);
                else {
                  const previous = Array.isArray(value) ? value : [];
                  change(event.currentTarget.checked ? [...previous, choice.value] : previous.filter(entry => entry !== choice.value));
                }
              }} /><span>{choice.label}</span>
          </label>)}
        </div> : <input id={inputId} className="yard-source-elicitation-input" aria-label={field.label}
          aria-describedby={field.description ? inputId + '-description' : undefined}
          type={field.kind === 'integer' || field.kind === 'number' ? 'number' : field.format === 'email' ? 'email' : 'text'}
          min={field.kind !== 'text' ? field.min : undefined} max={field.kind !== 'text' ? field.max : undefined}
          maxLength={field.kind === 'text' ? field.max : undefined} step={field.kind === 'integer' ? 1 : 'any'}
          autoComplete="off" value={typeof value === 'string' ? value : ''}
          onChange={event => change(event.currentTarget.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing && !event.ctrlKey && !event.metaKey) {
              event.preventDefault();
              next();
            }
          }} />}
      </fieldset>}
      {incorrect && <p role="alert" className="yard-source-elicitation-error">Enter a valid value for {field?.label}.</p>}
      {error && <p role="alert">{error}</p>}
    </div>
    <div className="yard-source-elicitation-actions">
      {field?.kind === 'choice' ? <button type="button" disabled={submitted} onClick={skip}>Skip</button> :
        <>
          {!last && <button type="button" disabled={submitted} onClick={skip}>Skip for now</button>}
          <button type="button" data-primary="" aria-label={nextLabel} disabled={submitted} onClick={() => next()}>
            {nextLabel} <kbd>{navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+'}↵</kbd>
          </button>
        </>}
    </div>
  </section>;
}

function ConfirmationIcon({ size }: { size: number }) {
  return <span className="yard-source-mcp-confirmation-icon" aria-hidden="true">
    <Shield size={size} fill="#4d6fe6" strokeWidth={0} />
    <Shield size={size} fill="#86a0f2" strokeWidth={0} />
  </span>;
}

function ConfirmationDialog({ request, submitted, error, onReply }: Actions & { request: Extract<Elicitation, { mode: 'confirmation' }> }) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const { confirmation, message } = request;
  useLayoutEffect(() => {
    if (!open) return;
    const element = dialog.current;
    element?.showModal();
    const initialFocus = confirmation.destructive ? cancel.current : confirm.current;
    initialFocus?.focus({ preventScroll: true });
    return () => {
      element?.close();
      trigger.current?.focus({ preventScroll: true });
    };
  }, [open, confirmation.destructive]);
  function close() { setOpen(false); }
  function approve() {
    if (submitted) return;
    onReply(result('accept', { [confirmation.field]: true }));
    close();
  }
  function details(field: ReviewField) {
    return <><dt dir="auto">{field.label}</dt><dd dir="auto">{field.value}</dd></>;
  }
  return <div className="yard-source-mcp-confirmation" aria-busy={submitted && !error}>
    <button type="button" ref={trigger} className="yard-source-mcp-confirmation-chip" aria-haspopup="dialog" disabled={submitted}
      data-open={open || undefined} data-has-icon={confirmation.shield || undefined} onClick={() => setOpen(true)}>
      {confirmation.shield && <ConfirmationIcon size={24} />}
      <span dir="auto">{confirmation.triggerLabel}</span>
    </button>
    {error && <p role="alert">{error}</p>}
    {open && createPortal(<dialog ref={dialog} className="yard-source-mcp-confirmation-dialog" aria-labelledby={titleId}
      onCancel={event => { event.preventDefault(); event.stopPropagation(); close(); }}
      onClick={event => { if (event.target === event.currentTarget) close(); }}>
      <form onSubmit={event => { event.preventDefault(); event.stopPropagation(); approve(); }}>
        <button className="yard-source-mcp-confirmation-close" type="button" aria-label="Close dialog" title="Close dialog" onClick={close}>
          <X size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <header>
          {confirmation.shield && <ConfirmationIcon size={32} />}
          <h2 id={titleId} dir="auto">{confirmation.title}</h2>
        </header>
        {confirmation.sections ? <div className="yard-source-mcp-confirmation-sections">
          {confirmation.sections.map((section, i) => <section key={i}>
            {section.title && <h3 dir="auto">{section.title}</h3>}
            <dl><div>{details(section.body)}</div><div>{details(section.caption)}</div></dl>
          </section>)}
        </div> : confirmation.fields.length ? <dl>
          {confirmation.fields.map((field, i) => <div key={i}>{details(field)}</div>)}
        </dl> : <p className="yard-source-mcp-confirmation-message" dir="auto">{message}</p>}
        <footer>
          <button type="submit" ref={confirm} data-destructive={confirmation.destructive || undefined} disabled={submitted}>{confirmation.confirmLabel}</button>
          <button type="button" ref={cancel} onClick={close}>Cancel</button>
        </footer>
      </form>
    </dialog>, document.body)}
  </div>;
}

function UnsupportedForm({ request, submitted, error, onReply }: Actions & { request: Extract<Elicitation, { mode: 'unsupportedForm' }> }) {
  return <section className="yard-source-approval yard-source-elicitation yard-source-unsupported-form" aria-label="Unsupported form"
    aria-busy={submitted && !error} onKeyDown={event => {
      if (event.key === 'Escape' && !submitted) { event.preventDefault(); onReply(result('cancel')); }
    }}>
    <div className="yard-source-elicitation-content">
      <h3>This form isn’t supported in this version</h3>
      <p>{request.serverName} requested this form. You can skip it and keep going, or dismiss the request</p>
      {error && <p role="alert">{error}</p>}
    </div>
    <div className="yard-source-elicitation-actions">
      <button type="button" disabled={submitted} onClick={() => onReply(result('cancel'))}>Dismiss</button>
      <button type="button" data-primary="" disabled={submitted} onClick={() => onReply(result('decline'))}>Skip</button>
    </div>
  </section>;
}

function ElicitationLink({ request, submitted, error, onReply }: Actions & { request: Extract<Elicitation, { mode: 'url' | 'unsupported' }> }) {
  const [opened, setOpened] = useState(false);
  return <section className="yard-source-approval yard-source-elicitation-link" aria-label={request.serverName + ' action required'}
    aria-busy={submitted && !error} data-source-mcp-link="" onKeyDown={event => {
      if (event.key === 'Escape' && !submitted) { event.preventDefault(); onReply(result('decline')); }
    }}>
    <div className="yard-source-elicitation-link-icon" aria-hidden="true"><Link2 size={20} /></div>
    <div className="yard-source-elicitation-link-copy">
      <h3>Action required</h3>
      <p dir="auto">{request.message || request.serverName + ' requests information'}</p>
      {request.mode === 'url' ? <p className="yard-source-elicitation-url"><span>URL</span><bdi>{request.url}</bdi></p> :
        <p role="status">This request is not supported in the browser.</p>}
    </div>
    {error && <p role="alert" className="yard-source-elicitation-link-error">{error}</p>}
    <div className="yard-source-approval-actions">
      <button type="button" aria-label="Not now" disabled={submitted} onClick={() => onReply(result('decline'))}>Not now <kbd>Esc</kbd></button>
      {request.mode === 'url' && <button type="button" data-primary="" aria-label={opened ? 'Continue' : 'Open link'} disabled={submitted} onClick={() => {
        if (opened) { onReply(result('accept', {})); return; }
        window.open(request.url, '_blank', 'noopener,noreferrer');
        setOpened(true);
      }}>{opened ? 'Continue' : 'Open link'} <kbd>↵</kbd></button>}
    </div>
  </section>;
}

export function ElicitationCard({ request, ...actions }: Actions & { request: Elicitation }) {
  if (request.mode === 'form') return <ElicitationForm request={request} {...actions} />;
  if (request.mode === 'confirmation') return <ConfirmationDialog request={request} {...actions} />;
  if (request.mode === 'unsupportedForm') return <UnsupportedForm request={request} {...actions} />;
  return <ElicitationLink request={request} {...actions} />;
}
