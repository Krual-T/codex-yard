import { useState } from 'react';
import type { AutomationDraft, AutomationEditorDraft, AutomationEffort, Choices, ModelOption, ProjectOption, ScheduleCodec, ThreadOption } from './model.ts';
import { errorMessage } from './model.ts';
import { ScheduleEditor } from './ScheduleEditor.tsx';

export function AutomationEditor({ editor, onChange, onSave, onCancel, onRetryChoices, busy, saving, saveDisabled, allowedStatuses, allowUnvalidatedPaused, codec, projects, threads, models }: {
  editor: AutomationEditorDraft;
  onChange(editor: AutomationEditorDraft): void;
  onSave(): void;
  onCancel(): void;
  onRetryChoices?: (kind: 'projects' | 'threads' | 'models') => Promise<void> | void;
  busy: boolean;
  saving: boolean;
  saveDisabled: boolean;
  allowedStatuses: ('ACTIVE' | 'PAUSED')[];
  allowUnvalidatedPaused: boolean;
  codec?: ScheduleCodec;
  projects: Choices<ProjectOption>;
  threads: Choices<ThreadOption>;
  models: Choices<ModelOption>;
}) {
  const { draft } = editor;
  const [scheduleValid, setScheduleValid] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const update = (next: AutomationDraft) => onChange({ ...editor, draft: next });
  const selectedModel = models.state === 'ready' ? models.items.find(model => model.id === draft.model) : undefined;
  const efforts = selectedModel?.efforts ?? [];
  const validate = () => {
    if (!draft.prompt.trim()) return 'Enter a prompt.';
    if (!draft.rrule.trim()) return 'Enter a schedule.';
    if (!allowedStatuses.includes(draft.status)) return 'Select an available status.';
    if (draft.kind === 'heartbeat' && !draft.targetThreadId) return 'Select a chat for this task.';
    if (draft.kind === 'cron' && draft.target === null) return 'Select a project or choose no project.';
    if (!scheduleValid) return 'Enter a valid schedule.';
    if (codec) { try { codec.validate(draft.rrule); } catch (cause) { return errorMessage(cause); } }
    else if (!allowUnvalidatedPaused || draft.status !== 'PAUSED') return 'A schedule validator is required before saving this task.';
    return null;
  };
  const projectId = draft.kind === 'cron' && draft.target?.type === 'project' ? draft.target.projectId : null;
  const projectOptions = projects.state === 'ready' ? projects.items : [];
  const threadOptions = threads.state === 'ready' ? threads.items : [];
  const modelOptions = models.state === 'ready' ? models.items : [];
  return <form className="yard-automation-editor" onSubmit={event => { event.preventDefault(); const problem = validate(); setError(problem); if (!problem && !busy) onSave(); }}>
    <label>Name<input autoFocus value={draft.name} maxLength={300} disabled={busy} onChange={event => update({ ...draft, name: event.target.value })} placeholder="Scheduled task title" /></label>
    <label>Prompt<textarea aria-label="Prompt" className="yard-automation-prompt" value={draft.prompt} disabled={busy} onChange={event => update({ ...draft, prompt: event.target.value })} placeholder="Describe what the task should do" /></label>
    <fieldset className="yard-automation-fields" disabled={busy}><legend>Details</legend>
      <label>Runs in<select aria-label="Runs in" value={draft.kind} onChange={event => {
        if (event.target.value === draft.kind) return;
        const common = { name: draft.name, prompt: draft.prompt, status: draft.status, rrule: draft.rrule, model: draft.model, reasoningEffort: draft.reasoningEffort, notificationPolicy: draft.notificationPolicy };
        if (draft.kind === 'cron') onChange({ ...editor, rememberedCron: draft, draft: { ...common, kind: 'heartbeat', targetThreadId: editor.rememberedHeartbeat?.targetThreadId ?? '' } });
        else onChange({ ...editor, rememberedHeartbeat: draft, draft: editor.rememberedCron ? { ...editor.rememberedCron, ...common } : { ...common, kind: 'cron', target: { type: 'projectless' }, cwds: [], executionEnvironment: 'worktree', localEnvironmentConfigPath: null, pluginTemplateId: null, autoArchive: false } });
      }}><option value="cron">New task</option><option value="heartbeat">Existing chat</option></select></label>
      {draft.kind === 'heartbeat' ? <>
        <label>Chat<select aria-label="Chat" value={draft.targetThreadId} onChange={event => update({ ...draft, targetThreadId: event.target.value })}>
          <option value="">Select a chat</option>{draft.targetThreadId && !threadOptions.some(option => option.id === draft.targetThreadId) && <option value={draft.targetThreadId}>{draft.targetThreadId}</option>}
          {threadOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select></label><ChoiceState name="Chats" choices={threads} onRetry={onRetryChoices ? () => onRetryChoices('threads') : undefined} />
      </> : <>
        <label>Project<select aria-label="Project" value={draft.target === null ? 'unset' : projectId === null ? 'none' : `project:${projectId}`} onChange={event => {
          const value = event.target.value;
          if (value === 'none') update({ ...draft, target: { type: 'projectless' }, cwds: [] });
          else if (value === 'unset') update({ ...draft, target: null, cwds: [] });
          else { const project = projectOptions.find(option => `project:${option.id}` === value); if (project) update({ ...draft, target: { type: 'project', projectId: project.id }, cwds: [...project.cwds] }); }
        }}><option value="unset">Select project</option><option value="none">Don't work in a project</option>
          {projectId && !projectOptions.some(option => option.id === projectId) && <option value={`project:${projectId}`}>{projectId}</option>}
          {projectOptions.map(option => <option key={option.id} value={`project:${option.id}`}>{option.label}</option>)}
        </select></label><ChoiceState name="Projects" choices={projects} onRetry={onRetryChoices ? () => onRetryChoices('projects') : undefined} />
        <label>Environment<select aria-label="Environment" value={draft.executionEnvironment} onChange={event => update({ ...draft, executionEnvironment: event.target.value as 'local' | 'worktree' })}><option value="worktree">Worktree</option><option value="local">Local</option></select></label>
        <label className="yard-automation-checkbox"><input type="checkbox" checked={draft.autoArchive} onChange={event => update({ ...draft, autoArchive: event.target.checked })} /> Archive completed runs</label>
      </>}
      <label>Model<select aria-label="Model" value={draft.model ?? ''} onChange={event => update({ ...draft, model: event.target.value || null, reasoningEffort: null })}>
        <option value="">Default model</option>{draft.model && !modelOptions.some(option => option.id === draft.model) && <option value={draft.model}>{draft.model}</option>}
        {modelOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select></label><ChoiceState name="Models" choices={models} onRetry={onRetryChoices ? () => onRetryChoices('models') : undefined} />
      <label>Reasoning<select aria-label="Reasoning" value={draft.reasoningEffort ?? ''} onChange={event => update({ ...draft, reasoningEffort: (event.target.value || null) as AutomationEffort | null })}>
        <option value="">Default</option>{draft.reasoningEffort && !efforts.includes(draft.reasoningEffort) && <option value={draft.reasoningEffort}>{draft.reasoningEffort}</option>}
        {efforts.map(effort => <option key={effort} value={effort}>{effort}</option>)}
      </select></label>
      <label>Notifications<select aria-label="Notifications" value={draft.notificationPolicy ?? ''} onChange={event => update({ ...draft, notificationPolicy: event.target.value ? 'failed_runs_only' : null })}><option value="">{draft.kind === 'cron' ? 'All runs' : 'Important updates'}</option><option value="failed_runs_only">Failed runs only</option></select></label>
      <label>Status<select aria-label="Status" value={draft.status} onChange={event => update({ ...draft, status: event.target.value as 'ACTIVE' | 'PAUSED' })}>
        {!allowedStatuses.includes(draft.status) && <option value={draft.status} disabled>{draft.status === 'ACTIVE' ? 'Active' : 'Paused'} (unavailable)</option>}
        {allowedStatuses.map(status => <option key={status} value={status}>{status === 'ACTIVE' ? 'Active' : 'Paused'}</option>)}
      </select></label>
    </fieldset>
    <fieldset disabled={busy} className="yard-automation-schedule"><ScheduleEditor value={draft.rrule} codec={codec} onChange={rrule => update({ ...draft, rrule })} onValidChange={setScheduleValid} /></fieldset>
    {!codec && allowUnvalidatedPaused && <p className="yard-automation-muted">This paused definition can be saved without validating its schedule.</p>}
    {error && <p role="alert" className="yard-automation-error">{error}</p>}
    <div className="yard-automation-editor-actions"><button type="button" disabled={busy} onClick={onCancel}>Cancel</button><button className="yard-automation-primary" type="submit" disabled={busy || saveDisabled}>{saving ? 'Saving...' : editor.mode === 'create' ? 'Create' : 'Save'}</button></div>
  </form>;
}

function ChoiceState<T>({ name, choices, onRetry }: { name: string; choices: Choices<T>; onRetry?: () => Promise<void> | void }) {
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return choices.state === 'loading' ? <p role="status" className="yard-automation-muted">Loading {name.toLowerCase()}...</p> : choices.state === 'error' ? <div role="alert" className="yard-automation-alert"><span>{name}: {error || choices.message}</span>{onRetry && <button type="button" disabled={retrying} onClick={() => {
    setRetrying(true); setError(null);
    void Promise.resolve().then(onRetry).catch(cause => setError(errorMessage(cause))).finally(() => setRetrying(false));
  }}>Retry {name.toLowerCase()}</button>}</div> : null;
}
