import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ServerRequestRef, WorkbenchClient } from '../workbench-contract.ts';
import { useCompletions } from '../composer/standalone-completions.tsx';
import type { Completion } from '../composer/standalone-completions.tsx';
import { initialApprovalValues, isApprovalFileUri, validateApprovalForm } from './approval-schema.ts';
import type { ApprovalField, ApprovalFormValues, ApprovalResourceOption } from './approval-schema.ts';
import { classifyElicitation, displayApprovalParameters } from './approval-elicitation.ts';
import type { ApprovalPersistence } from './approval-elicitation.ts';

export interface ServerRequest {
  hostId: string; id: string | number; method: string; params: Record<string, unknown>;
  ref: ServerRequestRef;
}

interface Question {
  id: string; header?: string; question: string; isSecret?: boolean; isOther?: boolean;
  options?: { label: string; description?: string }[] | null;
}
type DecisionChoice = { label: string; decision: unknown; detail?: string };
export type ApprovalOutcome = 'ready' | 'sending' | 'sent' | 'unknown';
export type ApprovalInputDraft = Record<string, { selected: string | null; other: string }>;
export interface ApprovalInputOrigin { ref: ServerRequestRef; hostId: string; threadId: string; turnId: string }
export interface ApprovalCompletionContext { client: WorkbenchClient; hostId: string; threadId: string; cwd: string }
export interface ApprovalConnectorAuthorization {
  ref: ServerRequestRef; hostId: string; threadId: string; connectorId: string; url: string;
  linkId?: string; reason?: string; scopes: string[];
}
export interface ApprovalFilePickRequest {
  ref: ServerRequestRef; hostId: string; threadId: string | null; serverName: string;
  field: string; kind: 'file' | 'directory'; accept: string[]; multiple: boolean;
}
export interface ApprovalDialogProps {
  request: ServerRequest;
  onRespond(result: unknown): Promise<void>;
  onUnsupported(): Promise<void>;
  onInputEscape?(origin: ApprovalInputOrigin): Promise<void>;
  /** Only for the original onboarding/auto-resolution request cases. */
  inputDismissMode?: 'interrupt' | 'reply-empty';
  /** Identity of the parent-owned outcome and both draft snapshots. */
  stateRef?: ServerRequestRef;
  outcome?: ApprovalOutcome;
  onOutcome?(ref: ServerRequestRef, outcome: ApprovalOutcome): void;
  inputDraft?: ApprovalInputDraft;
  onInputDraftChange?(ref: ServerRequestRef, draft: ApprovalInputDraft): void;
  formDraft?: ApprovalFormValues;
  onFormDraftChange?(ref: ServerRequestRef, draft: ApprovalFormValues): void;
  /** Return true only while this exact original request is still pending at its original host. */
  onCheckRequestValidity?(ref: ServerRequestRef): Promise<boolean>;
  /** Select resources in the original host namespace and return their file URIs. */
  onPickApprovalFiles?(request: ApprovalFilePickRequest): Promise<string[]>;
  completionContext?: ApprovalCompletionContext;
  /** Resolve true only after the original host confirms that the connector is accessible. */
  onCheckConnectorAuthorization?(request: ApprovalConnectorAuthorization): Promise<boolean>;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function own<T>(value: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(value, key) ? value[key] : undefined;
}

function only(value: Record<string, unknown>, key: string): boolean {
  return Object.keys(value).length === 1 && Object.hasOwn(value, key);
}

function commandChoices(value: unknown, params: Record<string, unknown>): { choices: DecisionChoice[]; unsupported: boolean } {
  if (value != null && !Array.isArray(value)) return { choices: [], unsupported: true };
  const decisions: unknown[] = value == null ? ['accept', 'decline', 'cancel'] : value;
  if (value == null) {
    if (record(params.networkApprovalContext)) decisions.splice(1, 0, 'acceptForSession');
    if (params.proposedExecpolicyAmendment != null) decisions.splice(1, 0,
      { acceptWithExecpolicyAmendment: { execpolicy_amendment: params.proposedExecpolicyAmendment } });
    if (Array.isArray(params.proposedNetworkPolicyAmendments)) decisions.splice(1, 0,
      ...params.proposedNetworkPolicyAmendments.map(amendment => ({ applyNetworkPolicyAmendment: { network_policy_amendment: amendment } })));
  }
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
  if (!Array.isArray(value) || value.length === 0) return null;
  const ids = new Set<string>();
  const questions: Question[] = [];
  for (const item of value) {
    if (!record(item) || typeof item.id !== 'string' || !item.id || ids.has(item.id) || typeof item.question !== 'string'
      || (item.header != null && typeof item.header !== 'string') || (item.isSecret != null && typeof item.isSecret !== 'boolean')
      || (item.isOther != null && typeof item.isOther !== 'boolean')
      || (item.options != null && (!Array.isArray(item.options) || !item.options.every((option: unknown) =>
        record(option) && typeof option.label === 'string' && (option.description == null || typeof option.description === 'string'))))) return null;
    if (Array.isArray(item.options)) {
      const labels = item.options.map((option: { label: string }) => option.label);
      if (labels.some((label: string) => !label.trim()) || new Set(labels).size !== labels.length) return null;
    }
    ids.add(item.id);
    questions.push(item as unknown as Question);
  }
  return questions;
}

function ElicitationField({ field, value, error, disabled, picking, onPick, onChange }: {
  field: ApprovalField; value: string | string[] | undefined; error?: string; disabled: boolean;
  picking: boolean; onPick?: () => void;
  onChange(value: string | string[] | undefined): void;
}) {
  const id = useId();
  const description = field.description ? id + '-description' : undefined;
  const errorId = error ? id + '-error' : undefined;
  const describedBy = [description, errorId].filter(Boolean).join(' ') || undefined;
  const label = <>{field.title}{field.required && ' (required)'}</>;
  const footnotes = <>{field.description && <small id={description} style={{ display: 'block' }}>{field.description}</small>}
    {error && <small id={errorId} style={{ display: 'block', color: 'var(--yard-danger, #b33)' }}>{error}</small>}</>;
  if (field.kind === 'image') return <fieldset style={{ margin: '10px 0', minWidth: 0 }} aria-describedby={describedBy}>
    <legend>{label}</legend>
    <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '4px 0' }}>
      {field.items.map(item => <label key={item.id} style={{ display: 'grid', gap: 4, minWidth: 120, maxWidth: 160 }}>
        <img src={item.image} alt="" style={{ width: '100%', height: 96, objectFit: 'contain' }} />
        <span><input type="radio" name={id} disabled={disabled} checked={value === item.id} onChange={() => onChange(item.id)} /> {item.title}</span>
      </label>)}
    </div>
    {field.file && <><button type="button" disabled={disabled || picking || !onPick} onClick={onPick}>{field.file.title || 'Choose a file'}</button>
      {typeof value === 'string' && isApprovalFileUri(value) && <p>{value}</p>}
      {!onPick && <small>File selection is unavailable on this host.</small>}</>}
    {!field.required && value !== undefined && <button type="button" disabled={disabled} onClick={() => onChange(undefined)}>Clear</button>}
    {footnotes}</fieldset>;
  if (field.kind === 'resource' || field.kind === 'resources') {
    const multiple = field.kind === 'resources';
    const selected = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
    const extra = selected.filter(uri => !field.options.some(option => option.uri === uri));
    const options: ApprovalResourceOption[] = [...field.options, ...extra.map(uri => ({ uri, name: uri }))];
    return <fieldset style={{ margin: '10px 0', minWidth: 0, overflowWrap: 'anywhere' }} aria-describedby={describedBy}>
      <legend>{label}</legend>
      {options.map(option => <label key={option.uri} style={{ display: 'block', padding: '4px 0' }}>
        <input type={multiple ? 'checkbox' : 'radio'} name={id} disabled={disabled} checked={selected.includes(option.uri)}
          onChange={event => onChange(multiple ? event.target.checked ? [...selected, option.uri] : selected.filter(uri => uri !== option.uri) : option.uri)} />
        {' '}{option.title || option.name}{option.description && <small style={{ display: 'block', marginLeft: 24 }}>{option.description}</small>}
      </label>)}
      {field.userOptions && <><button type="button" disabled={disabled || picking || !onPick} onClick={onPick}>
        {field.userOptions.kind === 'directory' ? 'Choose a directory' : 'Choose files'}</button>
        {!onPick && <small> File selection is unavailable on this host.</small>}</>}
      {!multiple && !field.required && selected.length > 0 && <button type="button" disabled={disabled} onClick={() => onChange(undefined)}>Clear</button>}
      {footnotes}</fieldset>;
  }
  if (field.kind === 'multi') {
    const selected = Array.isArray(value) ? value : [];
    return <fieldset style={{ margin: '10px 0', minWidth: 0, overflowWrap: 'anywhere' }} aria-describedby={describedBy}><legend>{label}</legend>
      {field.options.map((option) => <label key={option.value} style={{ display: 'block' }}>
        <input type="checkbox" disabled={disabled} checked={selected.includes(option.value)} onChange={(event) => onChange(event.target.checked
          ? [...selected, option.value] : selected.filter((item) => item !== option.value))} /> {option.label}</label>)}
      {footnotes}</fieldset>;
  }
  const options = field.kind === 'select' ? field.options
    : field.kind === 'boolean' ? [{ value: 'true', label: 'True' }, { value: 'false', label: 'False' }] : [];
  const selectedIndex = typeof value === 'string' ? options.findIndex(option => option.value === value) : -1;
  return <div style={{ margin: '10px 0', overflowWrap: 'anywhere' }}>
    <label htmlFor={id} style={{ display: 'block' }}>{label}</label>
    {field.kind === 'select' || field.kind === 'boolean'
      ? <select id={id} style={{ maxWidth: '100%' }} disabled={disabled} required={field.required} aria-invalid={Boolean(error)} aria-describedby={describedBy}
        value={selectedIndex < 0 ? '' : String(selectedIndex)} onChange={(event) => {
          const option = options[Number(event.target.value)];
          onChange(event.target.value !== '' && option ? option.value : undefined);
        }}>
        <option value="">Select...</option>
        {options.map((option, index) => <option key={option.value} value={index}>{option.label || '(empty string)'}</option>)}</select>
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

function CompletionAnswer({ context, question, value, disabled, onChange }: {
  context: ApprovalCompletionContext; question: Question; value: string; disabled: boolean; onChange(value: string): void;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [cursor, setCursor] = useState(value.length);
  const completions = useCompletions(context.client, context.hostId, context.cwd, value, cursor, false);
  const items = completions.items.filter(item => item.kind !== 'command');
  const choose = (item: Completion) => {
    const query = completions.query;
    if (!query || item.kind === 'command') return;
    let text: string;
    if (item.kind === 'directory') text = '@' + item.path + '/';
    else if (item.kind === 'file') {
      const path = context.cwd.replace(/\/$/, '') + '/' + item.path;
      const fence = '`'.repeat(Math.max(0, ...Array.from(path.matchAll(/`+/g), match => match[0].length)) + 1);
      text = fence + path + fence + ' ';
    } else {
      const label = ('$' + item.name).replace(/[\\\[\]]/g, '\\$&');
      const path = item.path.replace(/[\\()]/g, '\\$&');
      text = '[' + label + '](' + path + ') ';
    }
    const nextCursor = query.start + text.length;
    onChange(value.slice(0, query.start) + text + value.slice(query.end));
    setCursor(nextCursor);
    if (item.kind === 'directory') completions.show(); else completions.dismiss();
    requestAnimationFrame(() => { textarea.current?.focus(); textarea.current?.setSelectionRange(nextCursor, nextCursor); });
  };
  return <div>
    <textarea ref={textarea} aria-label={question.question} disabled={disabled} value={value} rows={3}
      style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical' }}
      aria-controls={completions.query ? completions.listId : undefined}
      onChange={event => { onChange(event.target.value); setCursor(event.target.selectionStart); }}
      onSelect={event => setCursor(event.currentTarget.selectionStart)}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || !completions.query) return;
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); completions.dismiss(); }
        else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && items.length) {
          event.preventDefault(); completions.move(event.key === 'ArrowDown' ? 1 : -1);
        } else if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
          const item = items[completions.selected];
          if (item) { event.preventDefault(); choose(item); }
        }
      }} />
    {completions.query && (items.length > 0 || completions.error) && <div id={completions.listId}>
      {items.map((item, index) => <button key={item.kind + ':' + item.path} type="button" disabled={disabled}
        aria-pressed={index === completions.selected} onMouseDown={event => event.preventDefault()} onClick={() => choose(item)}>
        {item.kind === 'skill' ? '$' : '@'}{item.name}{item.kind === 'directory' ? '/' : ''}</button>)}
      {completions.error && <small role="status">{completions.error}</small>}</div>}
  </div>;
}

function initialInputDraft(questions: Question[] | null, saved?: ApprovalInputDraft): ApprovalInputDraft {
  return Object.fromEntries((questions ?? []).map(question => {
    const previous = saved && own(saved, question.id);
    const labels = question.options?.map(option => option.label) ?? [];
    const selected = previous && (previous.selected === null && (question.isOther || labels.length === 0) || labels.includes(previous.selected ?? ''))
      ? previous.selected : labels[0] ?? null;
    return [question.id, { selected, other: typeof previous?.other === 'string' ? previous.other : '' }];
  }));
}

export function ApprovalDialog(props: ApprovalDialogProps) {
  return <ApprovalDialogContent key={JSON.stringify([props.request.ref.hostId, props.request.ref.generation, props.request.ref.id])} {...props} />;
}

function ApprovalDialogContent({ request, onRespond, onUnsupported, onInputEscape, inputDismissMode = 'interrupt', stateRef, outcome, onOutcome,
  inputDraft, onInputDraftChange, formDraft, onFormDraftChange, onCheckRequestValidity, onPickApprovalFiles, completionContext, onCheckConnectorAuthorization }: ApprovalDialogProps) {
  const dialog = useRef<HTMLElement>(null);
  const inFlight = useRef(false);
  const checkingAuth = useRef(false);
  const mounted = useRef(false);
  const formId = useId();
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  const [localOutcome, setLocalOutcome] = useState<ApprovalOutcome>();
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const input = request.method === 'item/tool/requestUserInput';
  const elicitation = request.method === 'mcpServer/elicitation/request';
  const command = request.method === 'item/commandExecution/requestApproval';
  const file = request.method === 'item/fileChange/requestApproval';
  const permissions = request.method === 'item/permissions/requestApproval';
  const legacy = request.method === 'execCommandApproval' || request.method === 'applyPatchApproval';
  const known = input || elicitation || command || file || permissions || legacy;
  const view = useMemo(() => elicitation ? classifyElicitation(request.params) : null, [elicitation, request.params]);
  const form = view?.kind === 'form' ? view.form : null;
  const [values, setValues] = useState<ApprovalFormValues>(() => formDraft ?? (form ? initialApprovalValues(form) : {}));
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const formRef = useRef(form);
  formRef.current = form;
  const questions = input ? questionsFrom(request.params.questions) : null;
  const [answers, setAnswers] = useState<ApprovalInputDraft>(() => initialInputDraft(questions, inputDraft));
  const decisions = command ? commandChoices(request.params.availableDecisions, request.params) : null;
  const grant = permissions ? permissionGrant(request.params.permissions) : null;
  const blocking = !input || request.params.isBlocking !== false;
  const sourceValid = request.hostId === request.ref.hostId && request.id === request.ref.id;
  const threadId = typeof request.params.threadId === 'string' ? request.params.threadId : '';
  const turnId = typeof request.params.turnId === 'string' ? request.params.turnId : '';
  const source: ApprovalInputOrigin | null = sourceValid && threadId && turnId
    ? { ref: request.ref, hostId: request.ref.hostId, threadId, turnId } : null;
  const completion = source && completionContext?.hostId === source.hostId && completionContext.threadId === source.threadId
    && completionContext.cwd ? completionContext : undefined;
  // A parent-owned ready state makes remounts safe even after an uncertain reply.
  const managed = stateRef?.hostId === request.ref.hostId && stateRef.generation === request.ref.generation
    && stateRef.id === request.ref.id && outcome !== undefined && Boolean(onOutcome && onInputDraftChange && onFormDraftChange);
  const locked = busy || !managed || outcome !== 'ready' || Boolean(localOutcome && localOutcome !== 'ready') || !sourceValid;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const authorizationKey = view?.kind === 'url' ? JSON.stringify([request.ref.hostId, request.ref.generation, request.ref.id, threadId,
    view.url, view.connectorId, view.linkId, view.reason, view.scopes, view.consent]) : '';
  const authorizationKeyRef = useRef(authorizationKey);
  authorizationKeyRef.current = authorizationKey;
  let warning = '';
  if (!sourceValid) warning = 'This request has inconsistent host or request identity.';
  else if (!managed) warning = 'Approval state is unavailable. Open this request in a connected conversation to respond.';
  else if (input && !questions) warning = 'This input request cannot be represented safely.';
  else if (permissions && !grant) warning = 'These requested permissions cannot be represented safely.';
  else if (command && decisions?.unsupported) warning = 'Some approval decisions cannot be represented safely.';
  else if (view?.kind === 'unsupported') warning = view.reason;

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const root = dialog.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!root || !blocking) return;
    (focusable(root)[0] ?? root).focus();
    const keepFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !root.contains(event.target)) (focusable(root)[0] ?? root).focus();
    };
    document.addEventListener('focusin', keepFocus);
    return () => {
      document.removeEventListener('focusin', keepFocus);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [blocking]);

  const send = async (action: () => Promise<void>) => {
    if (inFlight.current || lockedRef.current || !onOutcome) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      onOutcome(request.ref, 'sending');
      await action();
      setLocalOutcome('sent');
      onOutcome(request.ref, 'sent');
    }
    catch (cause) {
      let stillPending = false;
      if (record(cause) && cause.uncertain === false && onCheckRequestValidity) {
        try { stillPending = await onCheckRequestValidity(request.ref); } catch { /* An unverified request stays locked. */ }
      }
      if (stillPending && mounted.current) {
        onOutcome(request.ref, 'ready');
        setLocalOutcome('ready');
        inFlight.current = false;
        setError((cause instanceof Error ? cause.message : String(cause)) + ' The original request is still pending; you can retry.');
      } else {
        setLocalOutcome('unknown');
        onOutcome(request.ref, 'unknown');
        setError((cause instanceof Error ? cause.message : String(cause)) + ' Response could not be confirmed; check the original conversation before responding again.');
      }
    }
    finally { if (mounted.current) setBusy(false); }
  };
  const respond = (result: unknown) => { void send(() => onRespond(result)); };
  const elicitationResponse = (action: 'accept' | 'decline' | 'cancel', content: unknown = null, persist?: ApprovalPersistence) =>
    ({ action, content, _meta: action === 'accept' && persist ? { persist } : null });
  const checkConnectorAuthorization = async () => {
    if (view?.kind !== 'url' || !view.connectorId || view.consent || !threadId || !onCheckConnectorAuthorization
      || checkingAuth.current || locked) return;
    checkingAuth.current = true; setChecking(true); setError('');
    try {
      const authorized = await onCheckConnectorAuthorization({ ref: request.ref, hostId: request.ref.hostId, threadId,
        connectorId: view.connectorId, url: view.url, ...(view.linkId ? { linkId: view.linkId } : {}),
        ...(view.reason ? { reason: view.reason } : {}), scopes: view.scopes ?? [] });
      if (!mounted.current || authorizationKeyRef.current !== authorizationKey || lockedRef.current) return;
      if (authorized) respond(elicitationResponse('accept', {}));
      else setError('The connector is not ready yet. Complete authentication and check again.');
    } catch (cause) {
      if (mounted.current && authorizationKeyRef.current === authorizationKey)
        setError('The connector could not be checked: ' + (cause instanceof Error ? cause.message : String(cause)));
    } finally { checkingAuth.current = false; if (mounted.current) setChecking(false); }
  };
  const cancel = () => {
    if (elicitation) respond(elicitationResponse('cancel'));
    else if (input) {
      if (inputDismissMode === 'reply-empty') respond({ answers: {} });
      else if (source && onInputEscape) void send(() => onInputEscape(source));
      else setError('The original turn cannot be interrupted here. Open its conversation to stop it.');
    }
    else if (permissions) respond({ permissions: {}, scope: 'turn' });
    else if (legacy) respond({ decision: 'abort' });
    else if (file) respond({ decision: 'cancel' });
    else {
      const choice = decisions?.choices.find((entry) => entry.decision === 'cancel');
      if (choice) respond({ decision: choice.decision });
    }
  };
  const submitForm = () => {
    if (!form) return;
    const result = validateApprovalForm(form, values);
    if (result.errors) { setFieldErrors(result.errors); setError('Correct the fields below before submitting.'); return; }
    if (view?.kind === 'form' && view.confirmation && result.content[view.confirmation.field] !== true) {
      setError('Explicit confirmation is required.'); return;
    }
    setFieldErrors({});
    respond(elicitationResponse('accept', result.content));
  };
  const submitQuestions = () => {
    if (!questions) return;
    const result: [string, { answers: string[] }][] = [];
    const errors: Record<string, string> = Object.create(null) as Record<string, string>;
    for (const question of questions) {
      const answer = own(answers, question.id);
      const text = (answer?.selected ?? answer?.other ?? '').trim();
      if (!text) errors[question.id] = 'Provide an answer.';
      else result.push([question.id, { answers: [text] }]);
    }
    if (!result.length) { setFieldErrors(errors); setError('Answer at least one question before submitting.'); return; }
    respond({ answers: Object.fromEntries(result) });
  };
  const setValue = (key: string, value: string | string[] | undefined) => {
    const next = Object.assign(Object.create(null) as ApprovalFormValues, valuesRef.current);
    if (value === undefined) delete next[key]; else next[key] = value;
    valuesRef.current = next;
    setValues(next);
    onFormDraftChange?.(request.ref, next);
    setFieldErrors((current) => { const next = { ...current }; delete next[key]; return next; });
    setError('');
  };
  const pickFiles = async (field: ApprovalField) => {
    if (!onPickApprovalFiles || lockedRef.current || picking || !form || field.kind !== 'image'
      && field.kind !== 'resource' && field.kind !== 'resources') return;
    const picker = field.kind === 'image' ? field.file : field.userOptions;
    if (!picker) return;
    setPicking(field.key); setError('');
    try {
      const result = await onPickApprovalFiles({ ref: request.ref, hostId: request.ref.hostId, threadId: threadId || null,
        serverName: typeof request.params.serverName === 'string' ? request.params.serverName : '', field: field.key,
        kind: field.kind === 'image' ? 'file' : field.userOptions?.kind ?? 'file',
        accept: picker.accept ?? [], multiple: field.kind === 'resources' });
      if (!mounted.current || formRef.current !== form || lockedRef.current) return;
      if (!Array.isArray(result) || result.some(uri => typeof uri !== 'string' || !isApprovalFileUri(uri)))
        throw new Error('The host returned an invalid file URI.');
      if (!result.length) return;
      if (field.kind === 'resources') {
        const current = own(valuesRef.current, field.key);
        setValue(field.key, [...new Set([...(Array.isArray(current) ? current : []), ...result])]);
      } else setValue(field.key, result[0]);
    } catch (cause) {
      if (mounted.current && formRef.current === form) setError('Unable to choose a file: ' + (cause instanceof Error ? cause.message : String(cause)));
    } finally { if (mounted.current) setPicking(null); }
  };
  const setAnswer = (key: string, value: { selected: string | null; other: string }) => {
    const next = { ...answers, [key]: value };
    setAnswers(next);
    onInputDraftChange?.(request.ref, next);
    setFieldErrors((current) => { const next = { ...current }; delete next[key]; return next; });
    setError('');
  };

  return <div className={blocking ? 'yard-dialog-backdrop' : undefined} style={blocking ? undefined : {
    position: 'fixed', right: 12, bottom: 12, zIndex: 100, width: 'min(420px, calc(100vw - 24px))', pointerEvents: 'none',
  }}><section ref={dialog} tabIndex={-1} role="dialog" aria-modal={blocking ? 'true' : undefined}
    aria-labelledby={formId + '-title'} className="yard-dialog" style={{ minWidth: 0, width: 'min(100%, 680px)', overflowWrap: 'anywhere', pointerEvents: 'auto' }} onKeyDown={(event) => {
      if (event.key === 'Escape' && !locked && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
        event.preventDefault();
        cancel();
        return;
      }
      if (!blocking || event.key !== 'Tab' || !dialog.current) return;
      const items = focusable(dialog.current), first = items[0], last = items.at(-1);
      if (!first) { event.preventDefault(); dialog.current.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }}>
    <h2 id={formId + '-title'}>{input ? 'Codex needs your input' : elicitation ? 'Additional information requested'
      : known ? 'Approval required' : 'Unable to handle this request'}</h2>
    <p>Host: {request.ref.hostId}{threadId && <> · Thread: {threadId}</>}{turnId && <> · Turn: {turnId}</>}</p>
    {elicitation && <><p>{typeof request.params.message === 'string' ? request.params.message : ''}</p>
      {typeof request.params.serverName === 'string' && <p>Server: {request.params.serverName}</p>}
      {request.params.mode === 'url' && <p style={{ overflowWrap: 'anywhere' }}>{view?.kind === 'url'
        ? <a href={view.url} target="_blank" rel="noopener noreferrer">{request.params.url as string}</a>
        : String(request.params.url ?? '')}</p>}
      {view?.kind === 'url' && view.connectorId !== undefined && <><p>Connector: {view.connector}</p>
        <p>Connector ID: {view.connectorId}</p>{view.reason && <p>{view.reason}</p>}
        {view.scopes?.length ? <p>Requested scopes: {view.scopes.join(', ')}</p> : null}
        {view.consent && <><p>Consent origin: {view.consent.origin} · Connection: {view.consent.connectionId}</p>
          <ul>{view.consent.scopes.map(scope => <li key={scope.scope}>{scope.label} ({scope.scope})</li>)}</ul>
          <p>This connection consent requires the host authorization flow.</p></>}
        {!view.consent && !onCheckConnectorAuthorization && <p>Connection verification is unavailable in this view.</p>}</>}
      {view?.kind === 'tool' && <><p>Connector: {view.connector}{view.tool && <> · Tool: {view.tool}</>}</p>
        {view.riskLevel === 'high' && <p role="status">Elevated risk</p>}
        {view.executionBound && <p>Review this specific database change before approving.</p>}
        <pre>{displayApprovalParameters(view.parameters)}</pre></>}
      {form && <form id={formId} noValidate onSubmit={(event) => { event.preventDefault(); submitForm(); }}>
        {view?.kind === 'form' && view.confirmation && <div>
          {view.confirmation.title && <h3>{view.confirmation.title}</h3>}
          {view.confirmation.destructive && <p>Destructive change</p>}
          {view.confirmation.sections ? view.confirmation.sections.map((section, index) => <section key={index}>
            {section.title && <h4>{section.title}</h4>}
            {section.fields.map((field, fieldIndex) => <p key={fieldIndex}><strong>{field.label}: </strong>{field.value}</p>)}
          </section>) : view.confirmation.fields.map((field, index) => <p key={index}><strong>{field.label}: </strong>{field.value}</p>)}
        </div>}
        {form.fields.map((field) => <ElicitationField key={field.key} field={field} value={own(values, field.key)}
          error={own(fieldErrors, field.key)} disabled={locked} picking={picking === field.key}
          onPick={onPickApprovalFiles ? () => { void pickFiles(field); } : undefined}
          onChange={(value) => setValue(field.key, value)} />)}</form>}</>}
    {input && questions?.map((question) => <fieldset key={question.id} style={{ minWidth: 0 }}><legend>{question.header || question.question}</legend>
      {question.header && <p>{question.question}</p>}
      {(() => { const answer = own(answers, question.id) ?? { selected: null, other: '' };
        const allowOther = question.isOther || !question.options?.length;
        return <>
      {question.options?.map((option) => <label key={option.label} style={{ display: 'block', padding: '6px 0' }}>
        <input type="radio" name={formId + question.id} disabled={locked} checked={answer.selected === option.label}
          onChange={() => setAnswer(question.id, { ...answer, selected: option.label })} /> {option.label}
        {option.description && <small style={{ display: 'block', marginLeft: 24 }}>{option.description}</small>}</label>)}
      {question.isOther && Boolean(question.options?.length) && <label style={{ display: 'block' }}>
        <input type="radio" name={formId + question.id} disabled={locked} checked={answer.selected === null}
          onChange={() => setAnswer(question.id, { ...answer, selected: null })} /> Other</label>}
      {allowOther && (question.isSecret
        ? <input aria-label={question.question} disabled={locked || answer.selected !== null} style={{ maxWidth: '100%' }} type="password"
          value={answer.other} onChange={event => setAnswer(question.id, { selected: null, other: event.target.value })} />
        : completion ? <CompletionAnswer context={completion} question={question} value={answer.other} disabled={locked || answer.selected !== null}
          onChange={other => setAnswer(question.id, { selected: null, other })} />
          : <textarea aria-label={question.question} disabled={locked || answer.selected !== null} rows={3}
            style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical' }} value={answer.other}
            onChange={event => setAnswer(question.id, { selected: null, other: event.target.value })} />)}
      {own(fieldErrors, question.id) && <small role="alert">{own(fieldErrors, question.id)}</small>}
      </>; })()}
    </fieldset>)}
    {!input && !elicitation && <pre>{JSON.stringify(request.params, null, 2)}</pre>}
    {warning && <p role="alert">{warning}</p>}
    {error && <p role="alert">{error}</p>}
    {(localOutcome ?? outcome) === 'unknown' && !error && <p role="alert">Response could not be confirmed; check the original conversation before responding again.</p>}
    {(localOutcome ?? outcome) === 'sent' && <p role="status">Response sent; waiting for the request to resolve.</p>}
    {command && decisions && <fieldset style={{ minWidth: 0 }}><legend>Available decisions</legend>
      {decisions.choices.map((choice, index) => <div key={index} style={{ margin: '8px 0' }}>
        <button type="button" style={{ maxWidth: '100%', overflowWrap: 'anywhere', whiteSpace: 'normal', textAlign: 'left' }}
          disabled={locked} onClick={() => respond({ decision: choice.decision })}>{choice.label}</button>
        {choice.detail && <small style={{ display: 'block', overflowWrap: 'anywhere' }}>{choice.detail}</small>}</div>)}
    </fieldset>}
    <div style={{ flexWrap: 'wrap' }}>
      {elicitation && <><button type="button" disabled={locked} onClick={() => respond(elicitationResponse('decline'))}>Decline</button>
        <button type="button" disabled={locked} onClick={cancel}>Cancel</button>
        {form && <button type="submit" form={formId} disabled={locked}>{view?.kind === 'form' && view.confirmation?.confirmLabel || 'Submit'}</button>}
        {view?.kind === 'tool' && <button type="button" disabled={locked} onClick={() => respond(elicitationResponse('accept', {}))}>Approve</button>}
        {view?.kind === 'tool' && view.persistence.map(option => <button key={option} type="button" disabled={locked}
          onClick={() => respond(elicitationResponse('accept', {}, option))}>{option === 'session' ? 'Approve for session' : 'Always approve'}</button>)}
        {view?.kind === 'url' && view.connectorId === undefined && <button type="button" disabled={locked} onClick={() => respond(elicitationResponse('accept', {}))}>Continue</button>}
        {view?.kind === 'url' && view.connectorId !== undefined && !view.consent && onCheckConnectorAuthorization
          && <button type="button" disabled={locked || checking || !threadId} onClick={() => { void checkConnectorAuthorization(); }}>Check connection</button>}</>}
      {input && <><button type="button" disabled={locked || inputDismissMode !== 'reply-empty' && (!source || !onInputEscape)} onClick={cancel}>
        {inputDismissMode === 'reply-empty' ? 'Dismiss' : 'Stop turn'}</button>
        {questions && <button type="button" disabled={locked} onClick={submitQuestions}>Submit</button>}</>}
      {permissions && <><button type="button" disabled={locked} onClick={cancel}>Decline</button>
        {grant && <><button type="button" disabled={locked} onClick={() => respond({ permissions: grant, scope: 'turn' })}>Approve</button>
          <button type="button" disabled={locked} onClick={() => respond({ permissions: grant, scope: 'session' })}>Approve for session</button></>}</>}
      {file && <><button type="button" disabled={locked} onClick={() => respond({ decision: 'decline' })}>Decline</button>
        <button type="button" disabled={locked} onClick={() => respond({ decision: 'accept' })}>Approve</button>
        <button type="button" disabled={locked} onClick={() => respond({ decision: 'acceptForSession' })}>Approve for session</button></>}
      {legacy && <><button type="button" disabled={locked} onClick={() => respond({ decision: { denied: { rejection: 'Declined by user.' } } })}>Decline</button>
        <button type="button" disabled={locked} onClick={() => respond({ decision: 'approved' })}>Approve</button></>}
      {(!known || (command && decisions?.choices.length === 0)) && <button type="button" disabled={locked}
        onClick={() => { void send(onUnsupported); }}>Dismiss request</button>}
    </div>
  </section></div>;
}
