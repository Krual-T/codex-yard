import { Brain, Check, ChevronDown, ChevronLeft, ChevronRight, Hand, ShieldAlert, ShieldCheck } from 'lucide-react';
import { WorkspaceIcon } from './workspace-icon.tsx';
import { useEffect, useId, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import type { SessionConfig, SessionSettings } from '../../lib/codex-protocol.ts';
import { sessionSettings, threadSettings } from '../../lib/session-settings.ts';
import { modelIdentity, modelSelection } from '../native/model-selection.ts';
import { browserAtoms, composerModelPage, composerModels, composerPermissions, onThreadSettings, projectRoot, readComposerConfig, resumeThread,
  saveComposerModel, updateComposerThread, WorkspaceRequestError, writeAtom, type ComposerModel, type ComposerPermission } from './host.ts';
import { ContextUsageIndicator, type ConversationUsageController } from './conversation-usage.tsx';

type Settings = {
  key: string;
  cwd?: string;
  config?: SessionConfig;
  values: Partial<SessionSettings>;
};

export function useComposerOptions(threadId?: string, projectId?: string, hostId = 'local', destinationKnown = true) {
  const key = threadId ? hostId + ':' + threadId : 'new:' + (projectId ?? '');
  const [snapshot, setSnapshot] = useState<Settings>();
  const [permission, setPermission] = useState<{ key: string; choice: ComposerPermission }>();
  const [pending, setPending] = useState<string>();
  const [failure, setFailure] = useState<{ key: string; message: string }>();
  const currentKey = useRef(key);
  const currentWrite = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    currentKey.current = key;
    return () => { currentKey.current = ''; };
  }, [key]);

  async function read(): Promise<Settings> {
    if (threadId) {
      const result = await resumeThread(threadId, hostId);
      return { key, cwd: result.thread.cwd, values: threadSettings(result) };
    }
    const cwd = projectId ? await projectRoot(projectId, hostId) : undefined;
    const config = await readComposerConfig(cwd, hostId);
    return { key, cwd, config, values: sessionSettings(config) };
  }

  useEffect(() => {
    if (!destinationKnown) return;
    let current = true;
    let received: Partial<SessionSettings> = {};
    const cleanup = threadId && onThreadSettings(threadId, event => {
      received = { ...received, ...threadSettings(event) };
      setSnapshot(previous => ({ ...(previous?.key === key ? previous : { key }), values: {
        ...(previous?.key === key ? previous.values : {}), ...received,
      } }));
    }, hostId);
    let afterPaint = 0;
    const frame = requestAnimationFrame(() => {
      afterPaint = requestAnimationFrame(() => {
        void read().then(result => {
          if (current) setSnapshot({ ...result, values: { ...result.values, ...received } });
        }, error => { if (current) setFailure({ key, message: String(error) }); });
      });
    });
    return () => {
      current = false;
      if (cleanup) cleanup();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(afterPaint);
    };
  }, [key, threadId, projectId, hostId, destinationKnown]);

  const settings = destinationKnown && snapshot?.key === key ? snapshot : undefined;
  const draftPermission = permission?.key === key ? permission.choice : undefined;

  async function change(write: () => Promise<unknown>) {
    if (currentWrite.current === key) return;
    currentWrite.current = key;
    setPending(key);
    setFailure(undefined);
    try {
      await write();
      if (currentKey.current === key) {
        const result = await read();
        if (currentKey.current === key) setSnapshot(result);
      }
    } catch (error) {
      if (currentKey.current !== key) return;
      setFailure({ key, message: error instanceof WorkspaceRequestError && error.uncertain
        ? 'The setting may have changed. Check the current value before trying again.'
        : error instanceof Error ? error.message : String(error) });
      if (error instanceof WorkspaceRequestError && error.uncertain) {
        void read().then(result => { if (currentKey.current === key) setSnapshot(result); }, () => {});
      }
    } finally {
      if (currentWrite.current === key) currentWrite.current = undefined;
      setPending(previous => previous === key ? undefined : previous);
    }
  }

  return {
    hostId, settings, draftPermission, pending: pending === key, failure: failure?.key === key ? failure.message : undefined,
    projectless: !threadId && !projectId,
    choosePermission(choice: ComposerPermission) {
      if (!choice.allowed) return;
      if (threadId) void change(() => updateComposerThread(threadId, { yardPermissionChoice: choice.id }, hostId));
      else setPermission({ key, choice });
    },
    chooseModel(model: string, effort?: string) {
      if (threadId) void change(() => updateComposerThread(threadId, { model, effort }, hostId));
      else if (settings?.config) void change(() => saveComposerModel(settings.config!, model, effort, hostId));
    },
  };
}

type Options = ReturnType<typeof useComposerOptions>;
type Models = Awaited<ReturnType<typeof composerModels>>;
const permissionHelp = 'https://learn.chatgpt.com/docs/sandboxing?surface=app';
const menuControls = '[role^="menuitem"]:not(:disabled), input:not(:disabled)';
const fullAccessWarningAtom = 'full-access-warning-dismissed-at-v2';

function Menu({ name, label, placement, opening, children, disabled }: {
  name: string;
  label: ReactNode;
  placement: 'start' | 'end';
  opening?(): void;
  children(close: () => void): ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const keyboard = useRef(false);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    if (!open) return;
    const menu = ref.current;
    ((keyboard.current ? menu?.querySelector<HTMLElement>(menuControls) : undefined) ?? menu)?.focus();
  }, [open]);
  const close = () => {
    ref.current?.hidePopover();
    trigger.current?.focus({ preventScroll: true });
  };
  function activate(event: MouseEvent<HTMLButtonElement>) {
    if (!ref.current || ref.current.matches(':popover-open')) return;
    keyboard.current = event.detail === 0;
    const rect = event.currentTarget.getBoundingClientRect();
    const width = Math.min(placement === 'start' ? 429 : 254, innerWidth - 16);
    const footer = event.currentTarget.parentElement?.getBoundingClientRect();
    const left = placement === 'start' ? rect.left + 1 : (footer ? footer.right - 14 : rect.right) - width;
    const gap = placement === 'start' ? 2 : 9;
    Object.assign(ref.current.style, {
      width: width + 'px', left: Math.max(8, Math.min(left, innerWidth - width - 8)) + 'px',
      bottom: (innerHeight - rect.top + gap) + 'px', maxHeight: Math.max(48, rect.top - gap - 8) + 'px',
    });
    opening?.();
  }
  return <>
    <button type="button" className={'yard-source-toolbar-trigger yard-source-toolbar-' + placement}
      ref={trigger} aria-label={name} aria-haspopup="menu" aria-expanded={open} disabled={disabled} popoverTarget={id} onClick={activate}>
      {label}
    </button>
    <div popover="auto" role="menu" aria-orientation="vertical" aria-label={name} tabIndex={-1} id={id} ref={ref}
      className="yard-source-toolbar-menu rounded-2xl bg-surface-elevated-secondary/90 text-default backdrop-blur-sm"
      onToggle={event => setOpen(event.newState === 'open')}
      onKeyDown={event => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        if (event.target instanceof HTMLInputElement) return;
        const items = [...event.currentTarget.querySelectorAll<HTMLElement>(menuControls)];
        const current = items.indexOf(document.activeElement as HTMLElement);
        const next = event.key === 'Home' || (current < 0 && event.key === 'ArrowDown') ? 0
          : event.key === 'End' || current < 0 ? items.length - 1
          : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        event.preventDefault();
        items[next]?.focus();
      }}>
      {open ? children(close) : null}
    </div>
  </>;
}

function usePicker<T>(load: () => Promise<T>) {
  const [value, setValue] = useState<T>();
  const [error, setError] = useState<string>();
  const loading = useRef(false);
  function refresh() {
    if (loading.current) return;
    loading.current = true;
    setError(undefined);
    void load().then(setValue, error => setError(error instanceof Error ? error.message : String(error)))
      .finally(() => { loading.current = false; });
  }
  return { value, error, refresh };
}

const permissionLabels: Record<string, [string, string]> = {
  ask: ['Ask for approval', 'Always ask to edit external files and use the internet'],
  guardian: ['Auto review', 'Codex reviews additional permission requests'],
  'full-access': ['Full access', 'Unrestricted access to the internet and any file on your computer'],
  config: ['Custom (config.toml)', 'Use the permissions configured for this workspace'],
};
const powerLabels: Record<string, string> = { none: 'None', minimal: 'Minimal', low: 'Low', medium: 'Medium',
  high: 'High', xhigh: 'Extra high', max: 'Max', ultra: 'Ultra' };
const automatic = (values: Settings['values'] | undefined) =>
  values?.approvalsReviewer === 'guardian_subagent' || values?.approvalsReviewer === 'auto_review';

function permissionId(options: Options) {
  if (options.draftPermission) return options.draftPermission.id;
  const values = options.settings?.values;
  const profile = values?.permissionProfileId;
  if (profile && !profile.startsWith(':')) return 'profile:' + profile;
  if (profile === ':danger-full-access' || (!profile && values?.sandboxMode === 'danger-full-access')) return 'full-access';
  if (automatic(values)) return 'guardian';
  return values?.sandboxMode ? 'ask' : undefined;
}

function currentModel(values: Settings['values'] | undefined, models: ComposerModel[] | undefined) {
  const current = values?.model;
  if (!current) return models?.find(model => model.isDefault);
  const qualified = values.modelProvider && !modelSelection(current) ? modelIdentity(values.modelProvider, current) : current;
  return models?.find(model => [model.id, model.model].some(id => id === current || id === qualified));
}

export function FullAccessNotice({ options }: { options: Options }) {
  const [dismissed, setDismissed] = useState(false);
  const [hidden, setHidden] = useState(() => typeof browserAtoms()[fullAccessWarningAtom] === 'number');
  const unrestricted = options.draftPermission?.fullAccess ??
    (permissionId(options) === 'full-access' || options.settings?.values.sandboxMode === 'danger-full-access');
  if (dismissed || hidden || !unrestricted) return null;
  return <aside className="yard-source-full-access bg-surface rounded-3xl border-primary-outline text-default" role="status" data-source-full-access-notice="">
    <ShieldAlert size={18} aria-hidden="true" />
    <div className="yard-source-full-access-copy"><h3 className="text-pretty">Full access is on</h3>
      <p className="text-pretty"><span className="select-none">ChatGPT can edit any file and run commands with internet access without your approval. This increases the risk of data loss, exposed information, and unexpected changes.
        {' '}<a className="underline underline-offset-2" href={permissionHelp} target="_blank" rel="noreferrer">Learn more</a> about elevated risks.</span></p>
    </div>
    <div className="yard-source-full-access-actions">
      <button type="button" className="yard-source-full-access-hide" onClick={() => {
        void writeAtom(fullAccessWarningAtom, Date.now()).then(() => setHidden(true), () => setDismissed(true));
      }}>Don’t show again</button>
      <button type="button" className="yard-source-full-access-close" aria-label="Dismiss Full access warning for this session"
        onClick={() => setDismissed(true)}><WorkspaceIcon name="close" /></button>
    </div>
  </aside>;
}

function EffortSlider({ efforts, effort, select }: { efforts: string[]; effort?: string; select(effort: string): void }) {
  const chosen = Math.max(0, efforts.indexOf(effort ?? ''));
  const [preview, setPreview] = useState<number>();
  const pointer = useRef<number | undefined>(undefined);
  const index = preview ?? chosen;
  const progress = (index / (efforts.length - 1)) * 100 + '%';
  function commit(next: number) {
    if (next !== chosen && efforts[next]) select(efforts[next]);
  }
  function cancel() {
    pointer.current = undefined;
    setPreview(undefined);
  }
  return <div className="yard-source-power-slider">
    <div aria-hidden="true" className="yard-source-power-rail">
      <span className="yard-source-power-value" style={{ width: progress }} />
      {efforts.map((value, position) => <span key={value} className="yard-source-power-tick" />)}
      <span className="yard-source-power-thumb" style={{ left: progress }} />
    </div>
    <input type="range" aria-label="Power" aria-valuetext={powerLabels[efforts[index]] ?? efforts[index]}
      value={index} min={0} max={efforts.length - 1} step={1}
      onPointerDown={event => {
        if (event.button !== 0 || pointer.current !== undefined) return;
        pointer.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerUp={event => {
        if (pointer.current !== event.pointerId) return;
        const value = event.currentTarget.valueAsNumber;
        cancel();
        commit(value);
      }}
      onPointerCancel={cancel} onLostPointerCapture={cancel}
      onChange={event => {
        const value = event.currentTarget.valueAsNumber;
        if (pointer.current === undefined) commit(value);
        else setPreview(value);
      }} />
  </div>;
}

function ModelPicker({ options, catalog, close }: { options: Options; catalog?: Models; close(): void }) {
  const [page, setPage] = useState<'main' | 'model'>('main');
  const [provider, setProvider] = useState<string>();
  const values = options.settings?.values;
  const selection = currentModel(values, catalog?.models);
  const currentEffort = values?.reasoningEffort ?? selection?.defaultReasoningEffort ?? undefined;
  const efforts = selection?.supportedReasoningEfforts ?? [];
  const groups = [...new Set(catalog?.models.flatMap(model => {
    const provider = modelSelection(model.model ?? model.id)?.provider;
    return provider ? [provider] : [];
  }))];
  const groupName = (id: string) => catalog?.providers.find(option => option.id === id)?.name ?? id;
  function select(model: ComposerModel, effort?: string) {
    const supported = model.supportedReasoningEfforts;
    const next = effort ?? supported?.find(row => row.reasoningEffort === currentEffort)?.reasoningEffort
      ?? model.defaultReasoningEffort ?? undefined;
    options.chooseModel(model.model ?? model.id, next);
    close();
  }
  if (page === 'main') return <div className="yard-source-model-controls">
    <button type="button" role="menuitem" aria-label="Select model" className="yard-source-model-choice"
      onClick={() => setPage('model')} disabled={!catalog?.models.length}>
      {currentEffort && <span>{powerLabels[currentEffort] ?? currentEffort}</span>}
      <small>{selection?.displayName ?? modelSelection(values?.model)?.model ?? values?.model ?? 'Select model'}
        <ChevronRight size={12} aria-hidden="true" /></small>
    </button>
    {selection && efforts.length > 1 && <EffortSlider efforts={efforts.map(row => row.reasoningEffort)}
      effort={currentEffort} select={effort => select(selection, effort)} />}
  </div>;
  return <>
    <button type="button" role="menuitem" className="yard-source-toolbar-row" onClick={() => {
      if (provider) setProvider(undefined);
      else setPage('main');
    }}><ChevronLeft size={14} /><span>{provider ? groupName(provider) : 'Select model'}</span></button>
    {!provider && groups.length > 1 ? groups.map(id =>
      <button type="button" key={id} role="menuitem" className="yard-source-toolbar-row" onClick={() => setProvider(id)}>
        <span>{groupName(id)}</span><ChevronRight size={14} />
      </button>) : catalog?.models.filter(model => !provider || modelSelection(model.model ?? model.id)?.provider === provider)
        .map(model => <button type="button" key={model.id} className="yard-source-toolbar-row"
          role="menuitemradio" aria-checked={model.id === selection?.id} onClick={() => select(model)}><span>{model.displayName ?? model.model ?? model.id}</span>
          {model.id === selection?.id && <Check size={14} />}</button>)}
  </>;
}

export function ComposerToolbar({ options, usage, disabled }: { options: Options; usage: ConversationUsageController; disabled: boolean }) {
  const values = options.settings?.values;
  const picked = permissionId(options);
  const hostId = options.hostId;
  const ready = options.settings != null;
  const [labels, setLabels] = useState<ComposerModel[]>();
  useEffect(() => {
    // Settings arrive after the editor's first paint. Only the label needs a first page here.
    if (!ready) return;
    let current = true;
    void composerModelPage(hostId).then(page => { if (current) setLabels(page.data); }, () => {});
    return () => { current = false; };
  }, [hostId, ready]);
  const permission = usePicker(() => composerPermissions({ hostId: options.hostId, cwd: options.settings?.cwd, model: values?.model,
    projectless: options.projectless, automaticReview: automatic(values) }));
  const models = usePicker(() => composerModels(options.hostId));
  const model = currentModel(values, models.value?.models ?? labels);
  const modelName = model?.displayName ?? modelSelection(values?.model)?.model ?? values?.model ?? 'Loading model…';
  const effort = values?.reasoningEffort ?? model?.defaultReasoningEffort;
  const label = picked ? permissionLabels[picked]?.[0] ?? picked.slice('profile:'.length) : 'Permissions';
  const Icon = picked === 'full-access' ? ShieldAlert : automatic(values) ? ShieldCheck : Hand;
  return <>
    <Menu name="Change permissions" placement="start" opening={permission.refresh}
      disabled={!options.settings || options.pending || disabled} label={<span className={picked === 'full-access' ? 'yard-source-permission-warning' : undefined}>
        <Icon size={16} aria-hidden="true" /><span>{label}</span>{picked !== 'full-access' && <ChevronDown size={12} aria-hidden="true" />}
      </span>}>{close => <>
      <div className="yard-source-toolbar-intro yard-source-permission-intro"><span>How should ChatGPT actions be approved?</span>
        <a href={permissionHelp} target="_blank" rel="noreferrer">Learn more</a></div>
      {permission.error ? <p role="alert" className="yard-source-toolbar-intro">{permission.error}</p>
        : !permission.value ? <p role="status" className="yard-source-toolbar-intro">Loading…</p> : permission.value.filter(choice => choice.allowed || choice.id === picked).map(choice => {
          const [title, description] = permissionLabels[choice.id] ?? [choice.label, choice.description];
          const ChoiceIcon = choice.fullAccess ? ShieldAlert : choice.id === 'guardian' ? ShieldCheck : Hand;
          return <button type="button" role="menuitem" className="yard-source-toolbar-row yard-source-permission-choice"
            key={choice.id} data-full-access={choice.fullAccess || undefined} disabled={!choice.allowed}
            onClick={() => { options.choosePermission(choice); close(); }}>
            <ChoiceIcon size={14} aria-hidden="true" /><span><strong>{title}</strong><small>{description}</small></span>
            {choice.id === picked && <Check size={14} aria-label="Selected" />}
          </button>;
        })}
    </>}</Menu>
    <div className="yard-source-model-trigger-group">
    <ContextUsageIndicator usage={usage.contextUsage} />
    <Menu name={modelName + (effort ? ' ' + (powerLabels[effort] ?? effort) : '')} placement="end" opening={models.refresh}
      disabled={!options.settings || options.pending || disabled} label={<span><span>{modelName}</span>
        {effort && <span className="text-tertiary">{powerLabels[effort] ?? effort}</span>}<ChevronDown size={12} aria-hidden="true" />
        <Brain className="yard-source-compact-model-icon" size={16} aria-hidden="true" /></span>}>
      {close => models.error ? <p role="alert" className="yard-source-toolbar-intro">{models.error}</p> :
        !models.value ? <p role="status" className="yard-source-toolbar-intro">Loading…</p> : <ModelPicker options={options} catalog={models.value} close={close} />}
    </Menu>
    </div>
  </>;
}
