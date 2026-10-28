import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ServerRequestRef } from '../workbench-contract.ts';
import { initialApprovalValues, parseApprovalForm, safeElicitationUrl, validateApprovalForm } from './approval-schema.ts';
import type { ApprovalField, ApprovalFormValues } from './approval-schema.ts';

export interface ServerRequest {
  hostId: string; id: string | number; method: string; params: Record<string, unknown>;
  ref: ServerRequestRef;
}

interface Question {
  id: string; header?: string; question: string; isSecret?: boolean; isOther?: boolean;
  options?: { label: string; description?: string }[] | null;
}
type DecisionChoice = { label: string; decision: unknown; detail?: string };

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function own<T>(value: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(value, key) ? value[key] : undefined;
}

function only(value: Record<string, unknown>, key: string): boolean {
  return Object.keys(value).length === 1 && Object.hasOwn(value, key);
}

function commandChoices(value: unknown): { choices: DecisionChoice[]; unsupported: boolean } {
  if (value != null && !Array.isArray(value)) return { choices: [], unsupported: true };
  const decisions: unknown[] = value == null ? ['accept', 'decline'] : value;
  const choices: DecisionChoice[] = [];
  let unsupported = false;
  for (const decision of decisions) {
    if (decision === 'accept') choices.push({ label: 'Approve', decision });
    else if (decision === 'acceptForSession') choices.push({ label: 'Approve for session', decision });
    else if (decision === 'decline') choices.push({ label: 'Decline', decision });
    else if (decision === 'cancel') choices.push({ label: 'Cancel', decision });
    else if (record(decision) && only(decision, 'acceptWithExecpolicyAmendment')
      && record(decision.acceptWithExecpolicyAmendment) && only(decision.acceptWithExecpolicyAmendment, 'execpolicy_amendment')
      && Array.isArray(decision.acceptWithExecpolicyAmendment.execpolicy_amendment)
      && decision.acceptWithExecpolicyAmendment.execpolicy_amendment.every((part) => typeof part === 'string')) {
      choices.push({ label: 'Approve and save command rule', decision,
        detail: JSON.stringify(decision.acceptWithExecpolicyAmendment.execpolicy_amendment) });
    } else if (record(decision) && only(decision, 'applyNetworkPolicyAmendment')
      && record(decision.applyNetworkPolicyAmendment) && only(decision.applyNetworkPolicyAmendment, 'network_policy_amendment')
      && record(decision.applyNetworkPolicyAmendment.network_policy_amendment)) {
      const amendment = decision.applyNetworkPolicyAmendment.network_policy_amendment;
      if (!Object.keys(amendment).every((key) => key === 'host' || key === 'action') || typeof amendment.host !== 'string'
        || !amendment.host || (amendment.action !== 'allow' && amendment.action !== 'deny')) { unsupported = true; continue; }
      choices.push({ label: (amendment.action === 'allow' ? 'Allow' : 'Deny') + ' network for ' + amendment.host,
        decision, detail: JSON.stringify(amendment) });
    } else unsupported = true;
  }
  return { choices, unsupported };
}

function permissionGrant(value: unknown): Record<string, unknown> | null {
  if (!record(value) || !Object.keys(value).every((key) => key === 'network' || key === 'fileSystem')) return null;
  const entries: [string, unknown][] = [];
  for (const key of ['network', 'fileSystem']) {
    if (value[key] == null) continue;
    if (!record(value[key])) return null;
    entries.push([key, value[key]]);
  }
  return Object.fromEntries(entries);
}

function questionsFrom(value: unknown): Question[] | null {
  if (!Array.isArray(value)) return null;
  const ids = new Set<string>();
  const questions: Question[] = [];
  for (const item of value) {
    if (!record(item) || typeof item.id !== 'string' || !item.id || ids.has(item.id) || typeof item.question !== 'string'
      || (item.header != null && typeof item.header !== 'string') || (item.isSecret != null && typeof item.isSecret !== 'boolean')
      || (item.isOther != null && typeof item.isOther !== 'boolean')
      || (item.options != null && (!Array.isArray(item.options) || !item.options.every((option: unknown) =>
        record(option) && typeof option.label === 'string' && (option.description == null || typeof option.description === 'string'))))) return null;
    ids.add(item.id);
    questions.push(item as unknown as Question);
  }
  return questions;
}

function ElicitationField({ field, value, error, disabled, onChange }: {
  field: ApprovalField; value: string | string[] | undefined; error?: string; disabled: boolean;
  onChange(value: string | string[]): void;
}) {
  const id = useId();
  const description = field.description ? id + '-description' : undefined;
  const errorId = error ? id + '-error' : undefined;
  const describedBy = [description, errorId].filter(Boolean).join(' ') || undefined;
  const label = <>{field.title}{field.required && ' (required)'}</>;
  const footnotes = <>{field.description && <small id={description} style={{ display: 'block' }}>{field.description}</small>}
    {error && <small id={errorId} style={{ display: 'block', color: 'var(--yard-danger, #b33)' }}>{error}</small>}</>;
  if (field.kind === 'multi') {
    const selected = Array.isArray(value) ? value : [];
    return <fieldset style={{ margin: '10px 0', minWidth: 0, overflowWrap: 'anywhere' }} aria-describedby={describedBy}><legend>{label}</legend>
      {field.options.map((option) => <label key={option.value} style={{ display: 'block' }}>
        <input type="checkbox" disabled={disabled} checked={selected.includes(option.value)} onChange={(event) => onChange(event.target.checked
          ? [...selected, option.value] : selected.filter((item) => item !== option.value))} /> {option.label}</label>)}
      {footnotes}</fieldset>;
  }
  return <div style={{ margin: '10px 0', overflowWrap: 'anywhere' }}>
    <label htmlFor={id} style={{ display: 'block' }}>{label}</label>
    {field.kind === 'select' || field.kind === 'boolean'
      ? <select id={id} style={{ maxWidth: '100%' }} disabled={disabled} required={field.required} aria-invalid={Boolean(error)} aria-describedby={describedBy}
        value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value)}>
        <option value="">Select...</option>
        {(field.kind === 'select' ? field.options : [{ value: 'true', label: 'True' }, { value: 'false', label: 'False' }])
          .map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
      : <input id={id} style={{ maxWidth: '100%' }} disabled={disabled} required={field.required} aria-invalid={Boolean(error)} aria-describedby={describedBy}
        type={field.kind === 'number' || field.kind === 'integer' ? 'number' : field.kind === 'string' && field.format === 'email' ? 'email'
          : field.kind === 'string' && field.format === 'uri' ? 'url' : field.kind === 'string' && field.format === 'date' ? 'date' : 'text'}
        step={field.kind === 'integer' ? '1' : field.kind === 'number' ? 'any' : undefined}
        min={field.kind === 'number' || field.kind === 'integer' ? field.minimum : undefined}
        max={field.kind === 'number' || field.kind === 'integer' ? field.maximum : undefined}
        value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value)} />}
    {footnotes}
  </div>;
}

function focusable(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled):not([type="hidden"]),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex]:not([tabindex="-1"])')]
    .filter((element) => element.getClientRects().length > 0);
}

export function ApprovalDialog({ request, onRespond, onUnsupported }: { request: ServerRequest;
  onRespond(result: unknown): Promise<void>; onUnsupported(): Promise<void> }) {
  const dialog = useRef<HTMLElement>(null);
  const inFlight = useRef(false);
  const formId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const input = request.method === 'item/tool/requestUserInput';
  const elicitation = request.method === 'mcpServer/elicitation/request';
  const command = request.method === 'item/commandExecution/requestApproval';
  const file = request.method === 'item/fileChange/requestApproval';
  const permissions = request.method === 'item/permissions/requestApproval';
  const legacy = request.method === 'execCommandApproval' || request.method === 'applyPatchApproval';
  const known = input || elicitation || command || file || permissions || legacy;
  const form = useMemo(() => elicitation && request.params.mode === 'form' ? parseApprovalForm(request.params.requestedSchema) : null,
    [elicitation, request.params.mode, request.params.requestedSchema]);
  const [values, setValues] = useState<ApprovalFormValues>(() => form?.form ? initialApprovalValues(form.form) : {});
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const questions = input ? questionsFrom(request.params.questions) : null;
  const decisions = command ? commandChoices(request.params.availableDecisions) : null;
  const grant = permissions ? permissionGrant(request.params.permissions) : null;
  const url = elicitation && request.params.mode === 'url' ? safeElicitationUrl(request.params.url) : null;
  const validUrlRequest = Boolean(url && typeof request.params.elicitationId === 'string' && request.params.elicitationId);
  let warning = '';
  if (input && !questions) warning = 'This input request cannot be represented safely.';
  else if (permissions && !grant) warning = 'These requested permissions cannot be represented safely.';
  else if (command && decisions?.unsupported) warning = 'Some approval decisions cannot be represented safely.';
  else if (elicitation && request.params.mode === 'form' && form?.error) warning = form.error;
  else if (elicitation && request.params.mode === 'url' && !validUrlRequest) warning = 'This URL request cannot be opened safely.';
  else if (elicitation && request.params.mode !== 'form' && request.params.mode !== 'url') warning = 'This elicitation mode is not supported.';

  useEffect(() => {
    const root = dialog.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!root) return;
    (focusable(root)[0] ?? root).focus();
    const keepFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !root.contains(event.target)) (focusable(root)[0] ?? root).focus();
    };
    document.addEventListener('focusin', keepFocus);
    return () => {
      document.removeEventListener('focusin', keepFocus);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  const send = async (action: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try { await action(); }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      inFlight.current = false; setBusy(false);
    }
  };
  const respond = (result: unknown) => { void send(() => onRespond(result)); };
  const elicitationResponse = (action: 'accept' | 'decline' | 'cancel', content: unknown = null) =>
    ({ action, content, _meta: null });
  const cancel = () => {
    if (elicitation) respond(elicitationResponse('cancel'));
    else if (input) respond({ answers: {} });
    else if (permissions) respond({ permissions: {}, scope: 'turn' });
    else if (legacy) respond({ decision: 'abort' });
    else if (file) respond({ decision: 'cancel' });
    else {
      const choice = decisions?.choices.find((entry) => entry.decision === 'cancel');
      if (choice) respond({ decision: choice.decision });
    }
  };
  const submitForm = () => {
    if (!form?.form) return;
    const result = validateApprovalForm(form.form, values);
    if (result.errors) { setFieldErrors(result.errors); setError('Correct the fields below before submitting.'); return; }
    setFieldErrors({});
    respond(elicitationResponse('accept', result.content));
  };
  const submitQuestions = () => {
    if (!questions) return;
    respond({ answers: Object.fromEntries(questions.flatMap((question) => {
      const answer = own(answers, question.id)?.trim();
      return answer ? [[question.id, { answers: [answer] }]] : [];
    })) });
  };
  const setValue = (key: string, value: string | string[]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => { const next = { ...current }; delete next[key]; return next; });
    setError('');
  };
  const setAnswer = (key: string, value: string) => {
    setAnswers((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => { const next = { ...current }; delete next[key]; return next; });
    setError('');
  };

  return <div className="yard-dialog-backdrop"><section ref={dialog} tabIndex={-1} role="dialog" aria-modal="true"
    aria-labelledby="yard-request-title" className="yard-dialog" style={{ minWidth: 0, width: 'min(100%, 680px)', overflowWrap: 'anywhere' }} onKeyDown={(event) => {
      if (event.key === 'Escape' && !busy && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
        event.preventDefault(); cancel(); return;
      }
      if (event.key !== 'Tab' || !dialog.current) return;
      const items = focusable(dialog.current), first = items[0], last = items.at(-1);
      if (!first) { event.preventDefault(); dialog.current.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }}>
    <h2 id="yard-request-title">{input ? 'Codex needs your input' : elicitation ? 'Additional information requested'
      : known ? 'Approval required' : 'Unable to handle this request'}</h2>
    {elicitation && <><p>{typeof request.params.message === 'string' ? request.params.message : ''}</p>
      {typeof request.params.serverName === 'string' && <p>Server: {request.params.serverName}</p>}
      {request.params.mode === 'url' && <p style={{ overflowWrap: 'anywhere' }}>{validUrlRequest
        ? <a href={url!} target="_blank" rel="noopener noreferrer">{request.params.url as string}</a>
        : String(request.params.url ?? '')}</p>}
      {form?.form && <form id={formId} noValidate onSubmit={(event) => { event.preventDefault(); submitForm(); }}>
        {form.form.fields.map((field) => <ElicitationField key={field.key} field={field} value={own(values, field.key)}
          error={own(fieldErrors, field.key)} disabled={busy} onChange={(value) => setValue(field.key, value)} />)}</form>}</>}
    {input && questions?.map((question) => <fieldset key={question.id} style={{ minWidth: 0 }}><legend>{question.header || question.question}</legend>
      {question.header && <p>{question.question}</p>}
      {question.options?.map((option) => <label key={option.label} style={{ display: 'block', padding: '6px 0' }}>
        <input type="radio" name={question.id} disabled={busy} checked={own(answers, question.id) === option.label}
          onChange={() => setAnswer(question.id, option.label)} /> {option.label}
        {option.description && <small style={{ display: 'block', marginLeft: 24 }}>{option.description}</small>}</label>)}
      {(question.isOther || !question.options?.length) && <input aria-label={question.question} disabled={busy} style={{ maxWidth: '100%' }}
        type={question.isSecret ? 'password' : 'text'} value={own(answers, question.id) ?? ''}
        onChange={(event) => setAnswer(question.id, event.target.value)} />}
    </fieldset>)}
    {!input && !elicitation && <pre>{JSON.stringify(request.params, null, 2)}</pre>}
    {warning && <p role="alert">{warning}</p>}
    {error && <p role="alert">{error}</p>}
    {command && decisions && <fieldset style={{ minWidth: 0 }}><legend>Available decisions</legend>
      {decisions.choices.map((choice, index) => <div key={index} style={{ margin: '8px 0' }}>
        <button type="button" style={{ maxWidth: '100%', overflowWrap: 'anywhere', whiteSpace: 'normal', textAlign: 'left' }}
          disabled={busy} onClick={() => respond({ decision: choice.decision })}>{choice.label}</button>
        {choice.detail && <small style={{ display: 'block', overflowWrap: 'anywhere' }}>{choice.detail}</small>}</div>)}
    </fieldset>}
    <div style={{ flexWrap: 'wrap' }}>
      {elicitation && <><button type="button" disabled={busy} onClick={() => respond(elicitationResponse('decline'))}>Decline</button>
        <button type="button" disabled={busy} onClick={cancel}>Cancel</button>
        {form?.form && <button type="submit" form={formId} disabled={busy}>Submit</button>}
        {validUrlRequest && <button type="button" disabled={busy} onClick={() => respond(elicitationResponse('accept'))}>Continue</button>}</>}
      {input && <><button type="button" disabled={busy} onClick={cancel}>Decline</button>
        {questions && <button type="button" disabled={busy} onClick={submitQuestions}>Submit</button>}</>}
      {permissions && <><button type="button" disabled={busy} onClick={cancel}>Decline</button>
        {grant && <button type="button" disabled={busy} onClick={() => respond({ permissions: grant, scope: 'turn' })}>Approve</button>}</>}
      {file && <><button type="button" disabled={busy} onClick={() => respond({ decision: 'decline' })}>Decline</button>
        <button type="button" disabled={busy} onClick={() => respond({ decision: 'accept' })}>Approve</button></>}
      {legacy && <><button type="button" disabled={busy} onClick={() => respond({ decision: { denied: { rejection: 'Declined by user.' } } })}>Decline</button>
        <button type="button" disabled={busy} onClick={() => respond({ decision: 'approved' })}>Approve</button></>}
      {(!known || (command && decisions?.choices.length === 0)) && <button type="button" disabled={busy}
        onClick={() => { void send(onUnsupported); }}>Dismiss request</button>}
    </div>
  </section></div>;
}
