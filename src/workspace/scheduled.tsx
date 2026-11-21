import * as React from 'react';
import { CalendarClock, MoreHorizontal, Pause, Play, Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { Automation, AutomationRun } from '../native/automations.ts';
import { installAutomationRecovery, type AutomationWindow } from '../native/browser-automation-recovery.ts';
import { modelSelection } from '../native/model-selection.ts';
import { workspaceThreadRoute } from '../native/history-startup.ts';
import { composerModels } from './host.ts';
import { failureText, fetchHost, PageDialog, PageError, usePageData, type PageProject, type WorkspacePageProps } from './page-controls.tsx';

installAutomationRecovery(React);
const recovery = window as AutomationWindow;
const date = (at: number | null, timeZone?: string) => at === null ? '—' : new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium', timeStyle: 'short', timeZone,
}).format(at);
const active = new Set(['starting', 'running', 'waiting', 'uncertain']);
const statusLabel: Record<AutomationRun['status'], string> = {
  starting: 'Starting', running: 'Running', waiting: 'Waiting for input', uncertain: '执行结果待核实',
  completed: 'Completed', failed: 'Failed', released: '结果未知，已解除',
};

function ScheduleFields({ value, change }: { value: string; change(value: string): void }) {
  const parts: Record<string, string> = Object.fromEntries(value.split(';').map(part => part.split('=')));
  const frequency = parts.FREQ ?? 'DAILY';
  const known = Object.keys(parts).every(key => ['FREQ', 'BYHOUR', 'BYMINUTE', 'BYSECOND', 'BYDAY', 'BYMONTHDAY', 'BYMONTH'].includes(key)) &&
    ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(frequency) && (!parts.BYSECOND || parts.BYSECOND === '0') &&
    ['BYHOUR', 'BYMINUTE', 'BYMONTH', 'BYMONTHDAY'].every(key => !parts[key] || /^\d+$/.test(parts[key])) &&
    (!parts.BYDAY || parts.BYDAY.split(',').every(day => ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'].includes(day)));
  const [custom, setCustom] = useState(!known);
  const update = (patch: Record<string, string>) => change(Object.entries({ ...parts, ...patch }).map(([key, val]) => key + '=' + val).join(';'));
  return <fieldset className="yard-schedule-fields"><legend>Schedule</legend>
    <label>Repeat<select value={custom ? 'custom' : frequency} onChange={event => {
      const next = event.currentTarget.value; setCustom(next === 'custom');
      if (next !== 'custom') change('FREQ=' + next + ';BYHOUR=' + (parts.BYHOUR ?? '9') + ';BYMINUTE=' + (parts.BYMINUTE ?? '0') + ';BYSECOND=0' +
        (next === 'WEEKLY' ? ';BYDAY=MO' : next === 'MONTHLY' ? ';BYMONTHDAY=1' : next === 'YEARLY' ? ';BYMONTH=1;BYMONTHDAY=1' : ''));
    }}><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option>
      <option value="YEARLY">Yearly</option><option value="custom">Custom rule</option></select></label>
    {custom ? <label>Recurrence rule<input required value={value} onChange={event => change(event.currentTarget.value)} /></label> : <>
      <label>Time<input type="time" required value={(parts.BYHOUR ?? '9').padStart(2, '0') + ':' + (parts.BYMINUTE ?? '0').padStart(2, '0')}
        onChange={event => { const [hour, minute] = event.currentTarget.value.split(':'); update({ BYHOUR: String(Number(hour)), BYMINUTE: String(Number(minute)) }); }} /></label>
      {frequency === 'WEEKLY' && <div role="group" aria-label="Days">{['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'].map(day =>
        <label key={day}><input type="checkbox" checked={(parts.BYDAY ?? '').split(',').includes(day)} onChange={event => {
          const days = new Set((parts.BYDAY ?? '').split(',').filter(Boolean));
          if (event.currentTarget.checked) days.add(day); else days.delete(day);
          if (days.size) update({ BYDAY: [...days].join(',') });
        }} />{day}</label>)}</div>}
      {frequency === 'YEARLY' && <label>Month<input type="number" min={1} max={12} required value={parts.BYMONTH ?? '1'}
        onChange={event => update({ BYMONTH: event.currentTarget.value })} /></label>}
      {['MONTHLY', 'YEARLY'].includes(frequency) && <label>Day of month<input type="number" min={1} max={31} required value={parts.BYMONTHDAY ?? '1'}
        onChange={event => update({ BYMONTHDAY: event.currentTarget.value })} /></label>}
    </>}
  </fieldset>;
}

function TaskEditor({ task, projects, close, saved }: { task?: Automation; projects: PageProject[]; close(): void; saved(): void }) {
  const [value, setValue] = useState(() => ({ name: task?.name ?? '', prompt: task?.prompt ?? '',
    projectId: task?.target.type === 'project' ? task.target.projectId : '', rrule: task?.rrule ?? 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0;BYSECOND=0',
    timeZone: task?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone, model: task?.model ?? '', reasoningEffort: task?.reasoningEffort ?? '' }));
  const hostId = projects.find(project => project.id === value.projectId)?.hostId ?? task?.hostId ?? 'local';
  const readModels = useCallback(() => composerModels(hostId), [hostId]);
  const catalog = usePageData(readModels);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const models = catalog.value?.models ?? [];
  const model = models.find(model => (model.model ?? model.id) === value.model);
  const change = (patch: Partial<typeof value>) => setValue(previous => ({ ...previous, ...patch }));
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    try {
      await fetchHost(task ? 'automation-update' : 'automation-create', { ...task, ...value,
        projectId: value.projectId || null, model: value.model || null, reasoningEffort: value.reasoningEffort || null });
      saved();
    } catch (error) { setError(failureText(error)); } finally { setBusy(false); }
  }
  return <PageDialog title={task ? 'Edit scheduled task' : 'New scheduled task'} close={close}>
    <form onSubmit={event => void save(event)}><fieldset disabled={busy}>
      <label>Name<input data-testid="automation-title-input" required maxLength={200} value={value.name} onChange={event => change({ name: event.currentTarget.value })} /></label>
      <label>Prompt<textarea required rows={5} value={value.prompt} onChange={event => change({ prompt: event.currentTarget.value })} /></label>
      <label>Project<select value={value.projectId} onChange={event => change({ projectId: event.currentTarget.value, model: '', reasoningEffort: '' })}>
        <option value="">Standalone chat</option>{value.projectId && !projects.some(project => project.id === value.projectId) && <option value={value.projectId}>{task?.cwds[0] ?? value.projectId}</option>}
        {projects.map(project => <option key={project.hostId + project.id} value={project.id}>{project.label}</option>)}</select></label>
      <ScheduleFields value={value.rrule} change={rrule => change({ rrule })} />
      <label>Time zone<input required value={value.timeZone} onChange={event => change({ timeZone: event.currentTarget.value })} /></label>
      <label>Model<select value={value.model} onChange={event => change({ model: event.currentTarget.value, reasoningEffort: '' })}>
        <option value="">Default</option>{value.model && !model && <option value={value.model}>{modelSelection(value.model)?.model ?? value.model}</option>}
        {models.map(model => <option key={model.id} value={model.model ?? model.id}>{model.displayName ?? model.id}</option>)}</select></label>
      <label>Reasoning effort<select value={value.reasoningEffort} onChange={event => change({ reasoningEffort: event.currentTarget.value })}>
        <option value="">Default</option>{[...new Set([...(model?.supportedReasoningEfforts?.map(option => option.reasoningEffort) ?? ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']),
          ...(value.reasoningEffort ? [value.reasoningEffort] : [])])].map(effort => <option key={effort}>{effort}</option>)}</select></label>
      <PageError error={error || catalog.error} /><footer><button type="button" onClick={close}>Cancel</button>
        <button type="submit" className="yard-page-primary">{busy ? 'Saving…' : task ? 'Save' : 'Create'}</button></footer>
    </fieldset></form>
  </PageDialog>;
}

export default function ScheduledPage({ projects, navigate }: WorkspacePageProps) {
  const [limit, setLimit] = useState(50);
  const read = useCallback(async () => {
    const [tasks, runs] = await Promise.all([fetchHost<{ items: Automation[] }>('list-automations'),
      fetchHost<{ items: AutomationRun[]; diagnostic: string | null }>('automation-runs', { limit })]);
    return { tasks: tasks.items, runs: runs.items, diagnostic: runs.diagnostic };
  }, [limit]);
  const data = usePageData(read);
  const [editor, setEditor] = useState<{ task?: Automation }>();
  const [deleting, setDeleting] = useState<Automation>();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    const changed = (event: MessageEvent) => {
      if (event.source === window && event.origin === location.origin && (event.data?.type === 'automation-runs-updated' ||
          event.data?.type === 'codex-app-server-connection-changed' && event.data.state === 'connected')) data.refresh();
    };
    window.addEventListener('message', changed); window.addEventListener('focus', data.refresh);
    return () => { window.removeEventListener('message', changed); window.removeEventListener('focus', data.refresh); };
  }, [data.refresh]);
  async function act(endpoint: string, params: Record<string, unknown>) {
    if (busy) return; setBusy(true); setError('');
    try { await fetchHost(endpoint, params); data.refresh(); setDeleting(undefined); }
    catch (error) { setError(failureText(error)); } finally { setBusy(false); }
  }
  return <article className="yard-workspace-page" aria-label="Scheduled tasks">
    <header><div><h1><CalendarClock size={23} />Scheduled</h1><p>Recurring tasks run while Yard is running, even when this page is closed.</p></div>
      <button type="button" className="yard-page-primary" onClick={() => setEditor({})}><Plus size={16} />Create</button></header>
    <PageError error={error || data.error || data.value?.diagnostic || ''} retry={data.refresh} />
    {!data.value && !data.error && <p role="status">Loading scheduled tasks…</p>}
    <section aria-label="Tasks" className="yard-page-section"><h2>Tasks</h2>
      {data.value?.tasks.length === 0 && <p>No scheduled tasks yet.</p>}
      {data.value?.tasks.map(task => <div className="yard-scheduled-task" key={task.id}>
        <button type="button" className="yard-scheduled-name" onClick={() => setEditor({ task })}><strong>{task.name}</strong>
          <small>{task.status === 'PAUSED' ? 'Paused' : 'Next: ' + date(task.nextRunAt, task.timeZone)} · {task.timeZone}</small></button>
        <button type="button" disabled={busy} aria-label={task.status === 'PAUSED' ? 'Resume scheduled task' : 'Pause scheduled task'}
          onClick={() => void act('automation-update', { ...task, status: task.status === 'PAUSED' ? 'ACTIVE' : 'PAUSED' })}>
          {task.status === 'PAUSED' ? <Play size={16} /> : <Pause size={16} />}</button>
        <details className="yard-page-actions"><summary role="button" aria-label="Scheduled task actions"><MoreHorizontal size={18} /></summary>
          <div role="menu">{[
            { label: 'Run now', action: () => void act('automation-run-now', { id: task.id }), disabled: data.value?.runs.some(run => run.automationId === task.id && active.has(run.status)) },
            { label: 'Edit', action: () => setEditor({ task }) }, { label: 'Delete', action: () => setDeleting(task) },
          ].map(action => <button type="button" role="menuitem" key={action.label} disabled={busy || action.disabled} onClick={event => {
            event.currentTarget.closest('details')?.removeAttribute('open'); action.action();
          }}>{action.label}</button>)}</div></details>
      </div>)}
    </section>
    <section className="yard-page-section" aria-label="Run history"><h2>Recent runs</h2><ul className="yard-scheduled-runs">
      {data.value?.runs.map(run => <li key={run.id}><div className="yard-scheduled-run-heading">
        <button type="button" disabled={!run.threadId} onClick={() => { if (run.threadId) navigate(workspaceThreadRoute(run.hostId, run.threadId)); }}>
          {run.automationName} <small>{statusLabel[run.status]} · {date(run.createdAt)}</small></button>
        <button type="button" disabled={busy} onClick={() => void act('automation-run-archive', { id: run.id, archived: !run.archived })}>
          {run.archived ? 'Unarchive' : 'Archive'}</button></div>
        {run.summary && <p>{run.summary}</p>}
        {recovery.workbenchAutomationRecovery?.({ id: run.id, runStatus: run.status, threadId: run.threadId, description: run.error }, true)}
      </li>)}
    </ul>{data.value?.runs.length === limit && limit < 200 && <button type="button" onClick={() => setLimit(value => value + 50)}>Load older runs</button>}</section>
    {editor && <TaskEditor task={editor.task} projects={projects} close={() => setEditor(undefined)} saved={() => { setEditor(undefined); data.refresh(); }} />}
    {deleting && <PageDialog title="Delete scheduled task?" close={() => setDeleting(undefined)}><p>{deleting.name} will stop running. Its existing run history will remain.</p>
      <footer><button type="button" onClick={() => setDeleting(undefined)}>Cancel</button><button type="button" disabled={busy}
        onClick={() => void act('automation-delete', { id: deleting.id })}>Delete</button></footer></PageDialog>}
  </article>;
}
