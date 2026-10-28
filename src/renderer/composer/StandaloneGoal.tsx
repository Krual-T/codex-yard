import { useCallback, useEffect, useRef, useState } from 'react';
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
const statusLabels: Record<string, string> = {
  active: '进行中', paused: '已暂停', blocked: '受阻', usageLimited: '使用额度受限',
  budgetLimited: '目标预算已用尽', complete: '已完成',
};

/** A thread's goal lives on the CLI. Mounting this component only reads it. */
export function StandaloneGoal(props: StandaloneGoalProps) {
  return <GoalPane key={JSON.stringify([props.hostId, props.threadId])} {...props} />;
}

function GoalPane({ client, hostId, threadId, readOnly }: StandaloneGoalProps) {
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
      if (mounted.current && current === sequence.current) setError('无法读取目标：' + errorMessage(reason));
    }
  }, [client, hostId, threadId]);

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
        setError('操作未确认，请重新读取目标后再决定：' + errorMessage(reason));
      }
    } finally {
      mutating.current = false;
      if (mounted.current) setPending(false);
    }
  };
  const conflict = edit !== null && goal !== undefined && (goal?.objective ?? null) !== edit.base;
  const formattedTokens = goal ? new Intl.NumberFormat().format(goal.tokensUsed) : '';
  return <section className="standalone-goal" aria-label="会话目标">
    <header className="standalone-goal__header"><strong>目标</strong>
      <button type="button" onClick={() => void refresh()} disabled={pending}>刷新</button>
    </header>
    {goal === undefined && !error ? <div role="status">正在读取目标…</div> : null}
    {goal ? <>
      <div className="standalone-goal__status">{statusLabels[goal.status] ?? goal.status}</div>
      {!edit ? <div className="standalone-goal__objective">{goal.objective}</div> : null}
      <div className="standalone-goal__progress">
        <span>已用 {formattedTokens}{goal.tokenBudget === null ? '' : ` / ${new Intl.NumberFormat().format(goal.tokenBudget)}`} tokens</span>
        <span>耗时 {Math.floor(goal.timeUsedSeconds / 60)} 分 {Math.floor(goal.timeUsedSeconds % 60)} 秒</span>
      </div>
      {!readOnly && !edit ? <div className="standalone-goal__actions">
        <button type="button" disabled={pending} onClick={() => { setEditorError(''); setEdit({ base: goal.objective, text: goal.objective }); }}>编辑目标</button>
        {goal.status === 'active'
          ? <button type="button" disabled={pending} onClick={() => void mutate('thread/goal/set', { status: 'paused' })}>暂停目标</button>
          : <button type="button" disabled={pending} onClick={() => void mutate('thread/goal/set', { status: 'active' })}>继续目标</button>}
        {!confirmClear ? <button type="button" disabled={pending} onClick={() => setConfirmClear(true)}>清除目标</button>
          : <><button type="button" disabled={pending} onClick={() => void mutate('thread/goal/clear', {})}>确认清除</button>
            <button type="button" disabled={pending} onClick={() => setConfirmClear(false)}>取消</button></>}
      </div> : null}
    </> : null}
    {goal === null && !readOnly && !edit ? <button type="button" disabled={pending} onClick={() => { setEditorError(''); setEdit({ base: null, text: '' }); }}>新建目标</button> : null}
    {edit ? <div className="standalone-goal__editor">
      {edit.document ? <StandaloneRichEditor document={edit.document} currentDocument={() => currentDocument.current}
        ariaLabel="目标内容" readOnly={pending || readOnly} enableCompletions={false} allowMentions={false}
        onChange={document => {
          const parsed = readRichDocument(document);
          if (!parsed) { setEditorError('无法保留此格式，当前目标未更改。'); return; }
          currentDocument.current = document;
          setEdit(current => current?.document ? { ...current, document, text: serializeGoalDocument(parsed) } : current);
        }} onKeyDown={() => false} onCompletionContext={() => {}}
        onImages={() => setEditorError('目标暂不支持在富文本中插入图片。')}
        onInvalid={message => setEditorError(message ?? '此内容不能无损粘贴到目标中。')} />
        : <textarea aria-label="目标内容" value={edit.text} disabled={pending || readOnly} onChange={event => setEdit({ ...edit, text: event.target.value })} />}
      <button type="button" disabled={pending || readOnly} onClick={() => {
        if (edit.document) { currentDocument.current = undefined; setEditorError(''); setEdit({ base: edit.base, text: edit.text }); return; }
        const document = goalMarkdownDocument(edit.text);
        if (!document) { setEditorError('此目标不能无损转换为富文本，请继续编辑 Markdown 原文。'); return; }
        currentDocument.current = document; setEditorError(''); setEdit({ ...edit, document });
      }}>{edit.document ? 'Markdown 原文' : '富文本编辑'}</button>
      {editorError ? <div role="alert">{editorError}</div> : null}
      {conflict ? <div role="alert">目标已在其他位置更改；当前输入已保留。<button type="button" onClick={() => { currentDocument.current = undefined; setEditorError(''); setEdit({ base: goal?.objective ?? null, text: goal?.objective ?? '' }); }}>载入最新目标</button></div> : null}
      <div className="standalone-goal__actions">
        {edit.base === null ? <>
          <button type="button" disabled={pending || readOnly || conflict || !edit.text.trim()} onClick={() => void mutate('thread/goal/set', { objective: edit.text.trim(), status: 'paused' }, true)}>创建暂停目标</button>
          <button type="button" disabled={pending || readOnly || conflict || !edit.text.trim()} onClick={() => void mutate('thread/goal/set', { objective: edit.text.trim(), status: 'active' }, true)}>创建并开始</button>
        </> : <button type="button" disabled={pending || readOnly || conflict || !edit.text.trim() || edit.text.trim() === edit.base} onClick={() => void mutate('thread/goal/set', { objective: edit.text.trim() }, true)}>保存目标</button>}
        <button type="button" disabled={pending} onClick={() => setEdit(null)}>取消编辑</button>
      </div>
    </div> : null}
    {error ? <div role="alert">{error}</div> : null}
  </section>;
}
