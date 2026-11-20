import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { requestWorkspaceFetch } from '../native/browser-workspace-rpc.ts';
import { record } from '../native/protocol.ts';
import { request, sendHostMessage } from './host.ts';
import { goalDuration, goalElapsedSeconds, goalLabels, nextGoalStatus, readThreadGoal, type ThreadGoal } from './conversation-metrics.ts';
import { GoalIcon } from './conversation-goal-icons.tsx';
import { WorkspaceIcon } from './workspace-icon.tsx';
import { goalDocument, goalEditorPlugins, goalEditorSchema, goalMarkdown } from './goal-editor.ts';
import './conversation-goal.css';

export type { GoalStatus, ThreadGoal } from './conversation-metrics.ts';
type GoalSnapshot = { goal: ThreadGoal | null; loading: boolean; pending: 'status' | 'clear' | 'save' | null; error: string | null; revision: number };
const empty: GoalSnapshot = { goal: null, loading: true, pending: null, error: null, revision: 0 };
const goals = new Map<string, GoalSnapshot>();
const listeners = new Map<string, Set<() => void>>();
const scope = (hostId: string, threadId: string) => JSON.stringify([hostId, threadId]);
function snapshot(key: string) { return goals.get(key) ?? empty; }
function publish(key: string, next: GoalSnapshot) {
  goals.set(key, next);
  for (const notify of listeners.get(key) ?? []) notify();
}
function update(key: string, patch: Partial<GoalSnapshot>) { publish(key, { ...snapshot(key), ...patch }); }

window.addEventListener('message', event => {
  if (event.source !== window || event.origin !== location.origin) return;
  const message = record(event.data), params = record(message.params);
  if (message.type !== 'mcp-notification' || typeof message.hostId !== 'string' || typeof params.threadId !== 'string') return;
  const key = scope(message.hostId, params.threadId), current = snapshot(key);
  if (message.method === 'thread/goal/updated') {
    const goal = readThreadGoal(params.goal);
    if (goal?.threadId === params.threadId) publish(key, { ...current, goal, loading: false, error: null, revision: current.revision + 1 });
  } else if (message.method === 'thread/goal/cleared') {
    publish(key, { ...current, goal: null, loading: false, error: null, revision: current.revision + 1 });
  }
});

export function useConversationGoal(threadId: string | null | undefined, hostId = 'local', beforeActivate?: () => Promise<void>) {
  const key = scope(hostId, threadId ?? '');
  const subscribe = useCallback((notify: () => void) => {
    const set = listeners.get(key) ?? new Set<() => void>();
    listeners.set(key, set); set.add(notify);
    return () => { set.delete(notify); if (!set.size) listeners.delete(key); };
  }, [key]);
  const getSnapshot = useCallback(() => snapshot(key), [key]);
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const refresh = useCallback(async () => {
    if (!threadId) { update(key, { loading: false }); return; }
    const revision = snapshot(key).revision;
    try {
      const reply = await request<{ goal: unknown }>('thread/goal/get', { threadId }, { hostId });
      if (snapshot(key).revision !== revision) return;
      const goal = readThreadGoal(reply.goal);
      if (goal && goal.threadId !== threadId) throw new Error('The host returned a goal for another conversation.');
      update(key, { goal, loading: false, error: null });
    } catch (error) {
      if (snapshot(key).revision === revision) update(key, { loading: false, error: error instanceof Error ? error.message : 'Failed to load goal' });
    }
  }, [hostId, key, threadId]);
  useEffect(() => {
    void refresh();
    function reconnect(event: MessageEvent) {
      if (event.source === window && event.origin === location.origin && event.data?.type === 'codex-app-server-connection-changed' &&
          event.data.hostId === hostId && event.data.state === 'connected') void refresh();
    }
    window.addEventListener('message', reconnect);
    return () => window.removeEventListener('message', reconnect);
  }, [hostId, refresh]);

  async function mutate(operation: NonNullable<GoalSnapshot['pending']>, params: Record<string, unknown>) {
    if (!threadId || snapshot(key).pending) return false;
    update(key, { pending: operation, error: null });
    try {
      if (params.status === 'active') await beforeActivate?.();
      let objective = params.objective;
      if (typeof objective === 'string' && Array.from(objective).length > 4_000) {
        objective = (await requestWorkspaceFetch<{ objective: string }>(sendHostMessage, 'thread-goal-objective', {
          operation: 'create', objective,
        }, hostId)).objective;
      }
      const revision = snapshot(key).revision;
      const result = await request<{ goal?: unknown; cleared?: boolean }>(operation === 'clear' ? 'thread/goal/clear' : 'thread/goal/set', {
        threadId, origin: 'user', ...params, ...typeof objective === 'string' ? { objective } : {},
      }, { hostId });
      if (operation === 'clear' && !result.cleared) { await refresh(); return false; }
      if (snapshot(key).revision === revision) {
        const goal = operation === 'clear' ? null : readThreadGoal(result.goal);
        if (operation !== 'clear' && goal?.threadId !== threadId) throw new Error('The host returned an invalid goal.');
        update(key, { goal, loading: false, revision: revision + 1 });
      }
      return true;
    } catch (error) {
      update(key, { error: error instanceof Error ? error.message : 'Failed to update goal' });
      return false;
    } finally { update(key, { pending: null }); }
  }
  return {
    ...state, threadId, hostId, refresh,
    clear: () => mutate('clear', {}),
    toggle: () => {
      const goal = snapshot(key).goal, status = goal && nextGoalStatus(goal.status);
      return status ? mutate('status', { status }) : Promise.resolve(false);
    },
    save: (objective: string) => objective.trim() ? mutate('save', { objective: objective.trim(), status: 'active' }) : Promise.resolve(false),
    readObjective: async (objective: string) => {
      if (!objective.startsWith('Read the Codex goal objective file at ') || !objective.endsWith(' before continuing.')) return objective;
      return (await requestWorkspaceFetch<{ objective: string }>(sendHostMessage, 'thread-goal-objective', { operation: 'read', objective }, hostId)).objective;
    },
  };
}
export type ConversationGoalController = ReturnType<typeof useConversationGoal>;
type GoalEditorDraft = { source: string; draft: string; saved: string; savedAt: number };
const editorDrafts = new Map<string, GoalEditorDraft>();

function GoalProgress({ goal }: { goal: ThreadGoal }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (goal.status !== 'active') return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [goal.status]);
  const number = new Intl.NumberFormat(document.documentElement.lang || 'en', { notation: 'compact', maximumFractionDigits: 1 });
  const tokens = goal.tokenBudget == null ? null : `${number.format(goal.tokensUsed)} / ${number.format(goal.tokenBudget)}`;
  const progress = (goal.status === 'active' || goal.status === 'budgetLimited') && tokens != null ? tokens
    : goalDuration(goalElapsedSeconds(goal, now), document.documentElement.lang || 'en');
  return <span className="yard-goal-progress">{progress}</span>;
}

/** A composer rail row. The parent owns opening the original Goal side tab. */
export function ConversationGoal({ controller, onEdit }: { controller: ConversationGoalController; onEdit(): void }) {
  const { goal, pending, error } = controller;
  if (!goal) return null;
  const next = nextGoalStatus(goal.status), toggleLabel = next === 'paused' ? 'Pause goal' : 'Resume goal';
  return <div className="yard-conversation-goal" data-goal-status={goal.status}>
    <div className="yard-goal-row">
      <button type="button" className="yard-goal-title" disabled={!!pending} onClick={onEdit} aria-label={`Edit goal: ${goal.objective}`}>
        <span className="yard-goal-icon"><GoalIcon name="goal" /></span>
        <span className="yard-goal-summary"><span className="yard-goal-label">{goalLabels[goal.status]}</span>
          <span className="yard-goal-objective">{goal.objective}<span aria-hidden="true"> •</span></span><GoalProgress goal={goal} />
        </span>
      </button>
      <div className="yard-goal-actions">
        <button type="button" disabled={!!pending} aria-label="Clear goal" title="Clear goal" onClick={() => void controller.clear()}>
          {pending === 'clear' ? <WorkspaceIcon name="runningSpinner" className="yard-goal-loading" size={12} /> : <GoalIcon name="clear" />}
        </button>
        {next && <button type="button" disabled={!!pending} aria-label={toggleLabel} title={toggleLabel} onClick={() => void controller.toggle()}>
          {pending === 'status' ? <WorkspaceIcon name="runningSpinner" className="yard-goal-loading" size={12} /> : <GoalIcon name={next === 'paused' ? 'pause' : 'resume'} />}
        </button>}
        <button type="button" disabled={!!pending} aria-label="Edit goal" title="Edit goal" onClick={onEdit}><GoalIcon name="edit" /></button>
      </div>
    </div>
    {error && <div className="yard-goal-error" role="alert">{error}</div>}
  </div>;
}

export function ConversationGoalEditor({ controller }: { controller: ConversationGoalController }) {
  const key = scope(controller.hostId, controller.threadId ?? ''), source = useRef(controller.goal?.objective ?? '');
  const mount = useRef<HTMLDivElement>(null), view = useRef<EditorView>(null);
  const [draft, setDraft] = useState(''), [saved, setSaved] = useState('');
  const [savedAt, setSavedAt] = useState(() => controller.goal ? controller.goal.updatedAt * 1_000 : Date.now()), [now, setNow] = useState(Date.now);
  const [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null);
  const saving = controller.pending === 'save', changed = draft !== saved, canSave = !loading && !controller.pending && !!draft.trim() && draft.trim() !== saved;
  const saveRef = useRef<() => void>(() => {});
  saveRef.current = () => {
    if (!canSave) return;
    const objective = draft.trim();
    void controller.save(objective).then(success => {
      if (success) {
        source.current = snapshot(key).goal?.objective ?? objective;
        setDraft(objective); setSaved(objective); setSavedAt(Date.now()); replace(objective);
      }
    });
  };
  function replace(text: string) {
    if (!view.current) return;
    view.current.dispatch(view.current.state.tr.replaceWith(0, view.current.state.doc.content.size, goalDocument(text).content).setMeta('goal-source', text));
  }
  useEffect(() => {
    if (!mount.current) return;
    const editor = new EditorView(mount.current, {
      state: EditorState.create({ schema: goalEditorSchema, doc: goalDocument(''), plugins: goalEditorPlugins(() => saveRef.current()) }),
      attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Goal', 'data-placeholder': 'Goal', 'data-composer-markdown': '', spellcheck: 'true', dir: 'auto' },
      dispatchTransaction(transaction) {
        editor.updateState(editor.state.apply(transaction));
        if (transaction.docChanged) setDraft(transaction.getMeta('goal-source') ?? goalMarkdown(editor.state.doc));
      },
    });
    view.current = editor;
    return () => { editor.destroy(); view.current = null; };
  }, [controller.threadId, controller.hostId]);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    source.current = controller.goal?.objective ?? '';
    const cached = editorDrafts.get(key);
    if (cached?.source === source.current) {
      setDraft(cached.draft); setSaved(cached.saved); setSavedAt(cached.savedAt); setLoading(false); replace(cached.draft);
      return () => { active = false; };
    }
    void controller.readObjective(controller.goal?.objective ?? '').then(objective => {
      if (!active) return;
      setDraft(objective); setSaved(objective); setLoading(false); replace(objective);
    }).catch(reason => { if (active) {
      const objective = controller.goal?.objective ?? '';
      setDraft(objective); setSaved(objective); replace(objective); setLoading(false);
      setError(reason instanceof Error ? reason.message : 'Failed to load goal objective');
    } });
    return () => { active = false; };
  }, [controller.threadId, controller.hostId]);
  useEffect(() => {
    if (!loading) editorDrafts.set(key, { source: source.current, draft, saved, savedAt });
  }, [key, draft, saved, savedAt, loading]);
  useEffect(() => { view.current?.setProps({ editable: () => !saving && !loading }); if (!loading && !saving) view.current?.focus(); }, [saving, loading]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  const minutes = Math.max(0, Math.floor((now - savedAt) / 60_000));
  return <section className="yard-goal-editor" aria-label="Edit goal" aria-busy={saving || loading}>
    <div className="yard-goal-editor-toolbar"><span>{minutes === 0 ? 'Updated just now' : `Updated ${minutes} min ago`}</span>
      <button type="button" aria-label="Revert" title="Revert" disabled={!changed || saving || loading}
        onClick={() => { setDraft(saved); replace(saved); }}><WorkspaceIcon name="goalRevert" /></button>
      <button type="button" className="yard-goal-save" disabled={!canSave} onClick={() => saveRef.current()}>{saving ? <WorkspaceIcon name="runningSpinner" size={14} className="yard-goal-loading" /> : 'Save'}</button>
    </div>
    {(error || controller.error) && <div className="yard-goal-error" role="alert">{error || controller.error}</div>}
    <div className="yard-goal-editor-scroll"><div ref={mount} className="_RichTextInput_1ev2o_1" data-rich-text-layout="multiline" /></div>
  </section>;
}
