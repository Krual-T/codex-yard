import { useEffect, useRef, useState } from 'react';
import type { ServerRequestRef } from '../workbench-contract.ts';

export interface ServerRequest {
  hostId: string; id: string | number; method: string; params: Record<string, unknown>;
  ref: ServerRequestRef;
}
interface Question { id: string; header?: string; question: string; isSecret?: boolean; options?: { label: string; description?: string }[] | null }
export function approvalResponse(request: ServerRequest, accept: boolean, answers: Record<string, string> = {}) {
  if (request.method === 'item/tool/requestUserInput') return { answers: accept ? Object.fromEntries(Object.entries(answers).map(([id, answer]) => [id, { answers: [answer] }])) : {} };
  if (request.method === 'item/permissions/requestApproval') return { permissions: accept ? request.params.permissions ?? {} : {}, scope: 'turn' };
  if (request.method === 'mcpServer/elicitation/request') {
    const schema = request.params.requestedSchema as { properties?: Record<string, { type?: string }> } | undefined;
    const content = Object.fromEntries(Object.entries(answers).map(([key, value]) => {
      const type = schema?.properties?.[key]?.type;
      return [key, type === 'boolean' ? value === 'true' : type === 'number' || type === 'integer' ? Number(value) : value];
    }));
    return { action: accept ? 'accept' : 'decline', content: accept ? content : null, _meta: null };
  }
  if (request.method === 'execCommandApproval' || request.method === 'applyPatchApproval') return { decision: accept ? 'approved' : 'denied' };
  return { decision: accept ? 'accept' : 'decline' };
}

export function ApprovalDialog({ request, onRespond, onUnsupported }: { request: ServerRequest;
  onRespond(result: unknown): Promise<void>; onUnsupported(): Promise<void> }) {
  const dialog = useRef<HTMLElement>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const questions = Array.isArray(request.params.questions) ? request.params.questions as Question[] : [];
  const input = request.method === 'item/tool/requestUserInput';
  const elicitation = request.method === 'mcpServer/elicitation/request';
  const known = input || elicitation || ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/permissions/requestApproval', 'execCommandApproval', 'applyPatchApproval'].includes(request.method);
  const schema = request.params.requestedSchema as { properties?: Record<string, { type?: string; title?: string; description?: string; enum?: string[] }> } | undefined;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>('input,button,textarea')?.focus();
    return () => previous?.focus();
  }, []);
  const respond = async (accept: boolean) => {
    setBusy(true); setError('');
    try { await onRespond(approvalResponse(request, accept, answers)); }
    catch (cause) { setError((cause as Error).message); setBusy(false); }
  };
  return <div className="yard-dialog-backdrop"><section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="yard-request-title" className="yard-dialog" onKeyDown={event => {
    if (event.key !== 'Tab') return;
    const items = [...dialog.current!.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,textarea,a[href]')];
    const first = items[0], last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }}><h2 id="yard-request-title">{input ? 'Codex needs your input' : elicitation ? 'Additional information requested' : known ? 'Approval required' : 'Unable to handle this request'}</h2>
    {input ? questions.map(question => <fieldset key={question.id}><legend>{question.header || question.question}</legend>{question.header && <p>{question.question}</p>}
      {question.options?.map(option => <label key={option.label} style={{ display: 'block', padding: '6px 0' }}><input type="radio" name={question.id} checked={answers[question.id] === option.label} onChange={() => setAnswers(value => ({ ...value, [question.id]: option.label }))} /> {option.label}{option.description && <small style={{ display: 'block', marginLeft: 24 }}>{option.description}</small>}</label>)}
      <input aria-label={question.question} type={question.isSecret ? 'password' : 'text'} value={answers[question.id] ?? ''} onChange={event => setAnswers(value => ({ ...value, [question.id]: event.target.value }))} />
    </fieldset>) : elicitation ? <><p>{String(request.params.message ?? '')}</p>{Object.entries(schema?.properties ?? {}).map(([key, field]) => <label key={key} style={{ display: 'block', margin: '10px 0' }}>{field.title ?? key}{field.enum ? <select value={answers[key] ?? ''} onChange={event => setAnswers(value => ({ ...value, [key]: event.target.value }))}><option value="">Select…</option>{field.enum.map(value => <option key={value}>{value}</option>)}</select> : <input value={answers[key] ?? ''} onChange={event => setAnswers(value => ({ ...value, [key]: event.target.value }))} />}{field.description && <small>{field.description}</small>}</label>)}</> : <pre>{JSON.stringify(request.params, null, 2)}</pre>}
    {error && <p role="alert">{error}</p>}
    <div>{known ? <><button disabled={busy} onClick={() => { void respond(false); }}>Decline</button><button disabled={busy || input && questions.some(question => !answers[question.id])} onClick={() => { void respond(true); }}>{input || elicitation ? 'Submit' : 'Approve'}</button></> : <button disabled={busy} onClick={() => { setBusy(true); void onUnsupported().catch(cause => { setError(String(cause)); setBusy(false); }); }}>Dismiss request</button>}</div>
  </section></div>;
}
