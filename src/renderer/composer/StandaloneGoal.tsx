import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/index.tsx';
import type { GoalQueueMessageKey } from '../i18n/goal-queue-messages.ts';
import type { ComposerDocument, WorkbenchClient, WorkbenchEvent } from '../workbench-contract.ts';
import { StandaloneRichEditor } from './StandaloneRichEditor.tsx';
import { readRichDocument } from './rich-document.ts';
import { goalMarkdownDocument, serializeGoalDocument } from './standalone-goal-markdown.ts';
import './standalone-goal.css';

export interface StandaloneGoalProps {
  client: WorkbenchClient;
  hostId: string;
  threadId: string;
  readOnly: boolean;
}

interface Goal {
  threadId: string;
  objective: string;
  status: string;
  tokenBudget: number | null;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: number;
  updatedAt: number;
}
interface Edit { base: string | null; text: string; document?: ComposerDocument }

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function parseGoal(value: unknown, threadId: string): Goal {
  const item = record(value);
  if (item.threadId !== threadId || typeof item.objective !== 'string' || typeof item.status !== 'string'
    || !(item.tokenBudget === null || typeof item.tokenBudget === 'number' && Number.isFinite(item.tokenBudget))
    || typeof item.tokensUsed !== 'number' || !Number.isFinite(item.tokensUsed)
    || typeof item.timeUsedSeconds !== 'number' || !Number.isFinite(item.timeUsedSeconds)
    || typeof item.createdAt !== 'number' || !Number.isFinite(item.createdAt)
    || typeof item.updatedAt !== 'number' || !Number.isFinite(item.updatedAt)) {
    throw new Error('目标响应无效');
  }
  return { threadId, objective: item.objective, status: item.status, tokenBudget: item.tokenBudget,
    tokensUsed: item.tokensUsed, timeUsedSeconds: item.timeUsedSeconds, createdAt: item.createdAt, updatedAt: item.updatedAt };
}
function parseResponse(value: unknown, threadId: string): Goal | null {
  const result = record(value);
  if (!Object.hasOwn(result, 'goal')) throw new Error('目标响应无效');
  return result.goal === null ? null : parseGoal(result.goal, threadId);
}
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
const statusLabels: Record<string, GoalQueueMessageKey> = {
  active: 'Active', paused: 'Paused', blocked: 'Blocked', usageLimited: 'Usage limited',
  budgetLimited: 'Goal budget exhausted', complete: 'Completed',
};

/** A thread's goal lives on the CLI. Mounting this component only reads it. */
export function StandaloneGoal(props: StandaloneGoalProps) {
  return <GoalPane key={JSON.stringify([props.hostId, props.threadId])} {...props} />;
}

function GoalPane({ client, hostId, threadId, readOnly }: StandaloneGoalProps) {
  const { t, locale } = useI18n('zh-CN');
  const [goal, setGoal] = useState<Goal | null>();
  const [edit, setEdit] = useState<Edit | null>(null);
  const [editorError, setEditorError] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const sequence = useRef(0);
  const mounted = useRef(false);
  const mutating = useRef(false);
  const currentDocument = useRef<ComposerDocument | undefined>(undefined);

  const refresh = useCallback(async () => {
    const current = ++sequence.current;
    try {
      const result = parseResponse(await client.rpc('thread/goal/get', { threadId }, hostId), threadId);
      if (mounted.current && current === sequence.current) { setGoal(result); setError(''); }
    } catch (reason) {
      if (mounted.current && current === sequence.current) setError(t('Could not read goal:') + errorMessage(reason));
    }
  }, [client, hostId, threadId, t]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const unsubscribe = client.subscribe((event: WorkbenchEvent) => {
      if (event.hostId !== hostId) return;
      if (event.type === 'codex-app-server-connection-changed' && event.state === 'connected') { void refresh(); return; }
      if (event.type !== 'mcp-notification') return;
      const params = record(event.params);
      if (params.threadId !== threadId) return;
      if (event.method === 'thread/goal/cleared') {
        sequence.current++; setGoal(null); setConfirmClear(false); setError('');
      } else if (event.method === 'thread/goal/updated') {
        try { const next = parseGoal(params.goal, threadId); sequence.current++; setGoal(next); setError(''); }
        catch { void refresh(); }
      }
    });
    return () => { mounted.current = false; sequence.current++; unsubscribe(); };
  }, [client, hostId, threadId, refresh]);

  const mutate = async (method: 'thread/goal/set' | 'thread/goal/clear', fields: Record<string, unknown>, closeEdit = false) => {
    if (readOnly || mutating.current) return;
    mutating.current = true; setPending(true); setError('');
    const current = ++sequence.current;
    try {
      const response = await client.rpc(method, { threadId, origin: 'user', ...fields }, hostId);
      if (!mounted.current) return;
      if (method === 'thread/goal/set') {
        const result = parseResponse(response, threadId);
        if (!result) throw new Error('目标保存响应无效');
        if (current === sequence.current) setGoal(result); else void refresh();
      } else {
        if (record(response).cleared !== true) throw new Error('目标未清除，请重新读取');
        if (current === sequence.current) setGoal(null); else void refresh();
        setConfirmClear(false);
      }
      if (closeEdit) setEdit(null);
    } catch (reason) {
      if (mounted.current) {
        setError(t('Action unconfirmed; reload the goal before deciding:') + errorMessage(reason));
      }
    } finally {
      mutating.current = false;
      if (mounted.current) setPending(false);
    }
  };
  const conflict = edit !== null && goal !== undefined && (goal?.objective ?? null) !== edit.base;
  const number = new Intl.NumberFormat(locale);
  const formattedTokens = goal ? number.format(goal.tokensUsed) + (goal.tokenBudget === null ? '' : ` / ${number.format(goal.tokenBudget)}`) : '';
  return <section className="standalone-goal" aria-label={t('Conversation goal')}>
    <header className="standalone-goal__header"><strong>{t('Goal')}</strong>
      <button type="button" onClick={() => void refresh()} disabled={pending}>{t('Refresh')}</button>
    </header>
    {goal === undefined && !error ? <div role="status">{t('Loading goal...')}</div> : null}
    {goal ? <>
      <div className="standalone-goal__status">{statusLabels[goal.status] ? t(statusLabels[goal.status]) : goal.status}</div>
      {!edit ? <div className="standalone-goal__objective">{goal.objective}</div> : null}
      <div className="standalone-goal__progress">
        <span>{t('Used {used} tokens').replace('{used}', formattedTokens)}</span>
        <span>{t('Elapsed {minutes} min {seconds} sec').replace('{minutes}', number.format(Math.floor(goal.timeUsedSeconds / 60)))
          .replace('{seconds}', number.format(Math.floor(goal.timeUsedSeconds % 60)))}</span>
      </div>
      {!readOnly && !edit ? <div className="standalone-goal__actions">
        <button type="button" disabled={pending} onClick={() => { setEditorError(''); setEdit({ base: goal.objective, text: goal.objective }); }}>{t('Edit goal')}</button>
        {goal.status === 'active'
          ? <button type="button" disabled={pending} onClick={() => void mutate('thread/goal/set', { status: 'paused' })}>{t('Pause goal')}</button>
          : <button type="button" disabled={pending} onClick={() => void mutate('thread/goal/set', { status: 'active' })}>{t('Resume goal')}</button>}
        {!confirmClear ? <button type="button" disabled={pending} onClick={() => setConfirmClear(true)}>{t('Clear goal')}</button>
          : <><button type="button" disabled={pending} onClick={() => void mutate('thread/goal/clear', {})}>{t('Confirm clear')}</button>
            <button type="button" disabled={pending} onClick={() => setConfirmClear(false)}>{t('Cancel')}</button></>}
      </div> : null}
    </> : null}
    {goal === null && !readOnly && !edit ? <button type="button" disabled={pending} onClick={() => { setEditorError(''); setEdit({ base: null, text: '' }); }}>{t('New goal')}</button> : null}
    {edit ? <div className="standalone-goal__editor">
      {edit.document ? <StandaloneRichEditor document={edit.document} currentDocument={() => currentDocument.current}
        ariaLabel={t('Goal content')} readOnly={pending || readOnly} enableCompletions={false} allowMentions={false}
        onChange={document => {
          const parsed = readRichDocument(document);
          if (!parsed) { setEditorError(t('Could not preserve this format; the goal was not changed.')); return; }
          currentDocument.current = document;
          setEdit(current => current?.document ? { ...current, document, text: serializeGoalDocument(parsed) } : current);
        }} onKeyDown={() => false} onCompletionContext={() => {}}
        onImages={() => setEditorError(t('Images are not supported in goal rich text.'))}
        onInvalid={message => setEditorError(message ?? t('This content cannot be pasted into the goal without loss.'))} />
        : <textarea aria-label={t('Goal content')} value={edit.text} disabled={pending || readOnly} onChange={event => setEdit({ ...edit, text: event.target.value })} />}
      <button type="button" disabled={pending || readOnly} onClick={() => {
        if (edit.document) { currentDocument.current = undefined; setEditorError(''); setEdit({ base: edit.base, text: edit.text }); return; }
        const document = goalMarkdownDocument(edit.text);
        if (!document) { setEditorError(t('This goal cannot be converted without loss; edit the Markdown instead.')); return; }
        currentDocument.current = document; setEditorError(''); setEdit({ ...edit, document });
      }}>{t(edit.document ? 'Markdown source' : 'Rich text editing')}</button>
      {editorError ? <div role="alert">{editorError}</div> : null}
      {conflict ? <div role="alert">{t('The goal changed elsewhere; your edits were retained.')}<button type="button" onClick={() => { currentDocument.current = undefined; setEditorError(''); setEdit({ base: goal?.objective ?? null, text: goal?.objective ?? '' }); }}>{t('Load latest goal')}</button></div> : null}
      <div className="standalone-goal__actions">
        {edit.base === null ? <>
          <button type="button" disabled={pending || readOnly || conflict || !edit.text.trim()} onClick={() => void mutate('thread/goal/set', { objective: edit.text.trim(), status: 'paused' }, true)}>{t('Create paused goal')}</button>
          <button type="button" disabled={pending || readOnly || conflict || !edit.text.trim()} onClick={() => void mutate('thread/goal/set', { objective: edit.text.trim(), status: 'active' }, true)}>{t('Create and start')}</button>
        </> : <button type="button" disabled={pending || readOnly || conflict || !edit.text.trim() || edit.text.trim() === edit.base} onClick={() => void mutate('thread/goal/set', { objective: edit.text.trim() }, true)}>{t('Save goal')}</button>}
        <button type="button" disabled={pending} onClick={() => setEdit(null)}>{t('Cancel editing')}</button>
      </div>
    </div> : null}
    {error ? <div role="alert">{error}</div> : null}
  </section>;
}
