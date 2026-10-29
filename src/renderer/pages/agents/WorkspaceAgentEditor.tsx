import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { AgentIconPicker } from './AgentIcon.tsx';
import type { AgentChange, AgentEditorDraft, AgentFields, AgentIconValue, AgentModels, AgentMutationPorts, AgentScope, AgentStarter } from './agent-model.ts';
import { agentError, blankAgentFields, canEditAgent, canViewAgentConfig, isAgentScopeCurrent, validAgentScope } from './agent-model.ts';
import { useAgentMutation } from './useAgentMutation.ts';
import './workspace-agent.css';

export interface WorkspaceAgentEditorProps extends AgentMutationPorts {
  scope: AgentScope | null;
  agentId: string;
  canBuild: boolean;
  draft: AgentEditorDraft | null;
  models: AgentModels;
  onLoadBuilder?: (request: AgentScope & { agentId: string; signal: AbortSignal }) => Promise<AgentEditorDraft>;
  onDraftChange?: (scope: AgentScope, draft: AgentEditorDraft) => void;
  onRetryModels?: (scope: AgentScope) => void | Promise<void>;
  onBack?: (scope: AgentScope & { agentId: string; dirty: boolean }) => void | Promise<void>;
  canShare?: boolean;
  onShare?: (request: AgentScope & { agentId: string }) => void | Promise<void>;
  renderIcon?: (icon: AgentIconValue | null, size: number) => ReactNode;
  renderExtensions?: (request: AgentScope & { agentId: string; fields: AgentFields; readOnly: boolean; onFieldsChange(fields: AgentFields): void }) => ReactNode;
}

function validDraft(value: AgentEditorDraft, agentId: string, scope: AgentScope): boolean {
  const fields = value?.fields;
  return !!value && value.agentId === agentId && !!value.scope && value.scope.hostId === scope.hostId &&
    value.scope.identity?.accountId === scope.identity.accountId && value.scope.identity?.userId === scope.identity.userId && value.scope.sessionKey === scope.sessionKey &&
    (value.revision === null || typeof value.revision === 'string' || typeof value.revision === 'number' && Number.isFinite(value.revision)) &&
    typeof value.capability === 'string' && typeof value.dirty === 'boolean' && typeof value.published === 'boolean' && typeof value.hasUnpublishedChanges === 'boolean' &&
    !!fields && typeof fields.name === 'string' && typeof fields.tagline === 'string' && typeof fields.description === 'string' && typeof fields.instructions === 'string' &&
    !!fields.icon && typeof fields.icon.name === 'string' && typeof fields.icon.color === 'string' && Array.isArray(fields.skills) &&
    !!fields.tools && typeof fields.tools === 'object' && !Array.isArray(fields.tools) && (fields.modelSpec === null || typeof fields.modelSpec === 'object' && !Array.isArray(fields.modelSpec)) &&
    Array.isArray(fields.starterPrompts) && fields.starterPrompts.every(item => item && typeof item.icon === 'string' && typeof item.title === 'string' && typeof item.short_description === 'string' && typeof item.prompt === 'string' && typeof item.source === 'string');
}

export function WorkspaceAgentEditor(props: WorkspaceAgentEditorProps) {
  const scope = props.scope;
  if (!validAgentScope(scope) || !props.agentId) return <main className="yard-agent-page"><div className="yard-agent-content">Agent configuration is unavailable for this account.</div></main>;
  return <EditorScope key={JSON.stringify([scope.hostId, scope.identity.accountId, scope.identity.userId, scope.sessionKey, props.agentId])} {...props} scope={scope} />;
}

function EditorScope(props: WorkspaceAgentEditorProps & { scope: AgentScope }) {
  const { scope, agentId, draft } = props;
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [dialogMode, setDialogMode] = useState<'publish' | 'reload' | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const alive = useRef(false);
  const currentDraft = useRef(draft);
  const controller = useRef<AbortController | null>(null);
  const mutation = useAgentMutation(scope, props);
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; }, []);
  useLayoutEffect(() => { currentDraft.current = draft; }, [draft]);
  useEffect(() => {
    const element = dialog.current;
    if (dialogMode && element && !element.open) element.showModal();
    if (!dialogMode && element?.open) element.close();
    return () => { if (element?.open) element.close(); };
  }, [dialogMode]);
  const load = async (replace: boolean) => {
    if (!props.onLoadBuilder || !isAgentScopeCurrent(props, scope) || loading || mutation.uncertain) return;
    controller.current?.abort();
    const before = currentDraft.current;
    const next = new AbortController(); controller.current = next; setLoading(true); setLoadError(null);
    try {
      const value = await props.onLoadBuilder({ ...scope, agentId, signal: next.signal });
      if (!validDraft(value, agentId, scope) || !canViewAgentConfig(value.capability)) throw new Error('Agent configuration is unavailable or invalid.');
      if (next.signal.aborted || !alive.current || !isAgentScopeCurrent(props, scope) || !replace && currentDraft.current !== null) return;
      if (replace && currentDraft.current !== before) throw new Error('The local draft changed while loading; your edits were retained.');
      if (!props.onDraftChange) throw new Error('Draft storage is unavailable on this host.');
      props.onDraftChange(scope, value); currentDraft.current = value;
      mutation.clearConflict(); setDialogMode(null);
    } catch (cause) { if (!next.signal.aborted && alive.current) setLoadError(agentError(cause)); }
    finally { if (!next.signal.aborted && alive.current) setLoading(false); }
  };
  useEffect(() => { if (!currentDraft.current) void load(false); }, [props.onLoadBuilder]);
  const setFields = (fields: AgentFields) => {
    const current = currentDraft.current;
    if (!current || !validDraft(current, agentId, scope) || !isAgentScopeCurrent(props, scope) || !props.onDraftChange || !canEditAgent(current.capability) || mutation.busy || loading) return;
    try { const next = { ...current, fields, dirty: true }; props.onDraftChange(scope, next); currentDraft.current = next; setLocalError(null); }
    catch (cause) { setLocalError(`Could not retain the draft: ${agentError(cause)}`); }
  };
  const edit = (patch: Partial<AgentFields>) => { if (currentDraft.current) setFields({ ...currentDraft.current.fields, ...patch }); };
  const change = async (kind: 'save' | 'publish') => {
    if (!draft || draft.revision === null || !props.onChange || !props.onConfirmed || mutation.locked || mutation.conflict || !valid || !canEditAgent(draft.capability) || kind === 'publish' && !props.canBuild) return;
    const value: AgentChange = { ...scope, operationId: crypto.randomUUID(), kind, agentId, revision: draft.revision, fields: structuredClone(draft.fields) };
    const result = await mutation.execute(value);
    if (alive.current && result?.state === 'confirmed') setDialogMode(null);
  };
  const check = async () => {
    const resolved = await mutation.check(value => (value.kind === 'save' || value.kind === 'publish') && value.agentId === agentId);
    if (alive.current && resolved?.receipt.state === 'confirmed') setDialogMode(null);
  };
  const validLoaded = draft && validDraft(draft, agentId, scope) && canViewAgentConfig(draft.capability);
  const fields = validLoaded ? draft.fields : undefined;
  const valid = !!fields && !!fields.name.trim() && Array.from(fields.name).length <= 200 && Array.from(fields.tagline).length <= 64 && !!fields.instructions.trim() && fields.starterPrompts.every(item => !!item.title.trim() && !!item.prompt.trim());
  const editable = !!draft && canEditAgent(draft.capability) && !!props.onDraftChange;
  const blocked = !editable || mutation.busy || loading;
  const modelName = fields?.modelSpec?.name ?? '';
  const selectedModel = props.models.state === 'ready' ? props.models.items.find(item => item.name === modelName) : undefined;
  const effort = fields?.modelSpec?.reasoning_effort ?? '';
  const modelPatch = (name: string, reasoning: string) => {
    if (!fields) return;
    const spec = { ...fields.modelSpec }; delete spec.name; delete spec.reasoning_effort;
    if (name) spec.name = name;
    if (reasoning) spec.reasoning_effort = reasoning;
    edit({ modelSpec: Object.keys(spec).length ? spec : null });
  };
  const starterChange = (index: number, patch: Partial<AgentStarter>) => { if (fields) edit({ starterPrompts: fields.starterPrompts.map((item, i) => i === index ? { ...item, ...patch } : item) }); };
  return <main className="yard-agent-page"><div className="yard-agent-content">
    <header className="yard-agent-toolbar"><div className="yard-agent-actions">{props.onBack && <button className="yard-agent-icon-button" type="button" aria-label="Back" title="Back" onClick={() => { void Promise.resolve().then(() => { if (isAgentScopeCurrent(props, scope)) return props.onBack!({ ...scope, agentId, dirty: !!draft?.dirty }); }).catch(cause => { if (alive.current) setLocalError(agentError(cause)); }); }}><ArrowLeft size={17} /></button>}<h1>{fields?.name.trim() || 'Agent configuration'}</h1></div>
      {validLoaded && <div className="yard-agent-actions"><span className="yard-agent-muted">{draft.dirty ? 'Unsaved edits' : draft.hasUnpublishedChanges ? 'Unpublished changes' : 'Saved'}</span>
        {draft.published && canEditAgent(draft.capability) && props.canShare && <button className="yard-agent-btn" type="button" disabled={!props.onShare} onClick={() => { void Promise.resolve().then(() => { if (isAgentScopeCurrent(props, scope)) return props.onShare?.({ ...scope, agentId }); }).catch(cause => { if (alive.current) setLocalError(agentError(cause)); }); }}>Share</button>}
        <button className="yard-agent-btn" type="button" disabled={!editable || draft.revision === null || !props.onChange || !props.onConfirmed || mutation.locked || mutation.conflict || !valid || !draft.dirty} onClick={() => void change('save')}>Save draft</button>
        <button className="yard-agent-btn yard-agent-btn-primary" type="button" disabled={!editable || draft.revision === null || !props.canBuild || !props.onChange || !props.onConfirmed || mutation.locked || mutation.conflict || !valid || draft.published && !draft.hasUnpublishedChanges && !draft.dirty} onClick={() => setDialogMode('publish')}>Review and publish</button>
      </div>}
    </header>
    {loading && <p role="status" className="yard-agent-muted">Loading agent configuration...</p>}
    {!draft && !props.onLoadBuilder && <p className="yard-agent-muted">Agent configuration is unavailable on this host.</p>}
    {!props.onDraftChange && <p className="yard-agent-muted">Draft storage is unavailable on this host.</p>}
    {loadError && <p role="alert" className="yard-agent-message yard-agent-error">Could not load configuration: {loadError} <button className="yard-agent-btn" type="button" onClick={() => void load(false)}>Retry</button></p>}
    {draft && !validLoaded && <p role="alert" className="yard-agent-message yard-agent-error">Agent configuration is unavailable or invalid.</p>}
    {localError && <p role="alert" className="yard-agent-message yard-agent-error">{localError}</p>}
    {mutation.error && <p role="alert" className="yard-agent-message yard-agent-error">{mutation.error}</p>}
    {mutation.uncertain && <p className="yard-agent-message">A change is awaiting confirmation. <button className="yard-agent-btn" type="button" disabled={!props.onCheckChanges || mutation.busy} onClick={() => void check()}>Check changes</button></p>}
    {mutation.conflict && <p className="yard-agent-message">The saved draft has changed. Your edits are retained. <button className="yard-agent-btn" type="button" disabled={!props.onLoadBuilder || mutation.locked} onClick={() => setDialogMode('reload')}>Reload latest draft</button></p>}
    {validLoaded && draft.revision === null && !mutation.conflict && <p className="yard-agent-message">The saved revision is unavailable. Your edits are retained until the latest draft is loaded. <button className="yard-agent-btn" type="button" disabled={!props.onLoadBuilder || mutation.locked} onClick={() => setDialogMode('reload')}>Reload latest draft</button></p>}
    {validLoaded && fields && <>
      {!editable && <p className="yard-agent-message yard-agent-muted">You can view this agent's configuration, but you don't have access to edit it.</p>}
      <div className="yard-agent-form-head"><AgentIconPicker icon={fields.icon} disabled={blocked} onChange={icon => edit({ icon })} renderIcon={props.renderIcon} />
        <label className="yard-agent-field">Agent name<input value={fields.name} disabled={blocked} onChange={event => edit({ name: event.target.value })} aria-invalid={Array.from(fields.name).length > 200} /></label></div>
      {Array.from(fields.name).length > 200 && <p role="alert">Name must be 200 characters or fewer.</p>}
      <label className="yard-agent-field">Short description<input value={fields.tagline} disabled={blocked} onChange={event => edit({ tagline: event.target.value })} aria-invalid={Array.from(fields.tagline).length > 64} /></label>
      {Array.from(fields.tagline).length > 64 && <p role="alert">Short description must be 64 characters or fewer.</p>}
      <label className="yard-agent-field">Description<textarea aria-label="Description" rows={3} value={fields.description} disabled={blocked} onChange={event => edit({ description: event.target.value })} /></label>
      <section className="yard-agent-section"><h2>Instructions</h2><label className="yard-agent-field">Instructions<textarea aria-label="Instructions" className="instructions" value={fields.instructions} disabled={blocked} onChange={event => edit({ instructions: event.target.value })} /></label></section>
      <section className="yard-agent-section"><h2>Model and reasoning</h2><div className="yard-agent-fields-pair"><label className="yard-agent-field">Model<select value={modelName} disabled={blocked || props.models.state !== 'ready'} onChange={event => { const next = props.models.state === 'ready' ? props.models.items.find(item => item.name === event.target.value) : undefined; modelPatch(event.target.value, next?.efforts.includes(effort) ? effort : ''); }}><option value="">Auto</option>{modelName && !selectedModel && <option value={modelName}>{modelName} (unavailable)</option>}{props.models.state === 'ready' && props.models.items.map(item => <option key={item.name} value={item.name}>{item.label}</option>)}</select></label>
        <label className="yard-agent-field">Reasoning effort<select value={effort} disabled={blocked || props.models.state !== 'ready'} onChange={event => modelPatch(modelName, event.target.value)}><option value="">Auto</option>{effort && !selectedModel?.efforts.includes(effort) && <option value={effort}>{effort} (unavailable)</option>}{selectedModel?.efforts.map(item => <option key={item} value={item}>{item}</option>)}</select></label></div>
        {props.models.state === 'loading' && <p role="status" className="yard-agent-muted">Loading models...</p>}{props.models.state === 'error' && <p role="alert" className="yard-agent-message">Could not load models: {props.models.message} <button className="yard-agent-btn" type="button" disabled={!props.onRetryModels} onClick={() => { void Promise.resolve().then(() => props.onRetryModels?.(scope)).catch(cause => { if (alive.current) setLocalError(agentError(cause)); }); }}>Retry</button></p>}</section>
      <section className="yard-agent-section"><div className="yard-agent-section-head"><h2>Starter prompts</h2><button className="yard-agent-btn" type="button" disabled={blocked} onClick={() => edit({ starterPrompts: [...fields.starterPrompts, { icon: 'default', title: '', short_description: '', prompt: '', source: 'manual' }] })}><Plus size={15} /> Add</button></div>
        {!fields.starterPrompts.length && <p className="yard-agent-muted">Showcase capabilities</p>}
        {fields.starterPrompts.map((item, index) => <div className="yard-agent-section" key={index}><div className="yard-agent-section-head"><h3>Starter prompt {index + 1}</h3><button className="yard-agent-icon-button" type="button" title="Remove starter prompt" aria-label={`Remove starter prompt ${index + 1}`} disabled={blocked} onClick={() => edit({ starterPrompts: fields.starterPrompts.filter((_, i) => i !== index) })}><Trash2 size={16} /></button></div>
          <label className="yard-agent-field">Title<input value={item.title} disabled={blocked} onChange={event => starterChange(index, { title: event.target.value })} /></label>
          <label className="yard-agent-field">Short description<input value={item.short_description} disabled={blocked} onChange={event => starterChange(index, { short_description: event.target.value })} /></label>
          <label className="yard-agent-field">Prompt<textarea aria-label="Prompt" rows={3} value={item.prompt} disabled={blocked} onChange={event => starterChange(index, { prompt: event.target.value })} /></label></div>)}
      </section>
      {props.renderExtensions?.({ ...scope, agentId, fields, readOnly: !editable || mutation.busy, onFieldsChange: setFields })}
    </>}
    {dialogMode && <dialog className="yard-agent-modal" ref={dialog} aria-labelledby="yard-agent-editor-dialog" onCancel={event => { if (mutation.busy || loading) event.preventDefault(); }} onClose={() => setDialogMode(null)}>
      <h2 id="yard-agent-editor-dialog">{dialogMode === 'publish' ? `Review and publish ${fields?.name || 'agent'}` : 'Discard unsaved edits?'}</h2>
      <p>{dialogMode === 'publish' ? 'Publishing makes these changes available to everyone who uses this agent.' : 'This replaces your local edits with the latest saved draft.'}</p>
      {dialogMode === 'publish' && draft?.dirty && <p>Your unsaved edits are included and will be saved when you publish.</p>}
      {mutation.error && <p role="alert">{mutation.error}</p>}
      {mutation.uncertain && <button className="yard-agent-btn" type="button" disabled={!props.onCheckChanges || mutation.busy} onClick={() => void check()}>Check changes</button>}
      <footer><button className="yard-agent-btn" type="button" disabled={mutation.busy || loading} onClick={() => setDialogMode(null)}>Cancel</button><button className="yard-agent-btn yard-agent-btn-primary" type="button" disabled={mutation.locked || loading || dialogMode === 'publish' && mutation.conflict} onClick={() => dialogMode === 'publish' ? void change('publish') : void load(true)}>{dialogMode === 'publish' ? 'Publish' : 'Reload latest draft'}</button></footer>
    </dialog>}
  </div></main>;
}

export interface WorkspaceAgentCreateProps extends AgentMutationPorts {
  scope: AgentScope | null;
  canBuild: boolean;
  onBack?: () => void;
  onOpenEditor?: (request: AgentScope & { agentId: string }) => void | Promise<void>;
  onBrowseTemplates?: (scope: AgentScope) => void | Promise<void>;
}
export function WorkspaceAgentCreatePage(props: WorkspaceAgentCreateProps) {
  const scope = props.scope;
  if (!validAgentScope(scope)) return <main className="yard-agent-page"><div className="yard-agent-content">Agent creation is unavailable for this account.</div></main>;
  return <CreateScope key={JSON.stringify([scope.hostId, scope.identity.accountId, scope.identity.userId, scope.sessionKey])} {...props} scope={scope} />;
}
function CreateScope(props: WorkspaceAgentCreateProps & { scope: AgentScope }) {
  const mutation = useAgentMutation(props.scope, props);
  const alive = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const openCreated = async (agentId: string) => {
    if (!alive.current || !isAgentScopeCurrent(props, props.scope) || !props.onOpenEditor) return;
    setCreatedId(agentId); setError(null);
    try { await props.onOpenEditor({ ...props.scope, agentId }); }
    catch (cause) { if (alive.current) setError(`Draft created, but could not open it: ${agentError(cause)}`); }
  };
  const check = async () => {
    const resolved = await mutation.check(value => value.kind === 'create');
    if (resolved?.change.kind === 'create' && resolved.receipt.state === 'confirmed') await openCreated(resolved.receipt.agentId);
  };
  const create = async () => {
    if (!props.canBuild || !props.onChange || !props.onConfirmed || !props.onOpenEditor || mutation.locked || createdId) return;
    const result = await mutation.execute({ ...props.scope, operationId: crypto.randomUUID(), kind: 'create', fields: blankAgentFields() });
    if (result?.state === 'confirmed') await openCreated(result.agentId);
  };
  return <main className="yard-agent-page"><div className="yard-agent-content"><header className="yard-agent-toolbar"><div className="yard-agent-actions">{props.onBack && <button className="yard-agent-icon-button" type="button" aria-label="Back" title="Back" onClick={() => { if (isAgentScopeCurrent(props, props.scope)) props.onBack?.(); }}><ArrowLeft size={17} /></button>}<h1>Create agent</h1></div>
    <div className="yard-agent-actions"><button className="yard-agent-btn" type="button" disabled={!props.canBuild || !props.onBrowseTemplates || mutation.locked} onClick={() => { void Promise.resolve().then(() => { if (isAgentScopeCurrent(props, props.scope)) return props.onBrowseTemplates?.(props.scope); }).catch(cause => { if (alive.current) setError(agentError(cause)); }); }}>Browse templates</button>
      <button className="yard-agent-btn yard-agent-btn-primary" type="button" disabled={!props.canBuild || !props.onChange || !props.onConfirmed || !props.onOpenEditor || mutation.locked || !!createdId} onClick={() => void create()}>Start blank</button></div></header>
    {!props.canBuild && <p className="yard-agent-muted">You do not have permission to build agents.</p>}
    {createdId && <p>Draft created. <button className="yard-agent-btn" type="button" disabled={!props.onOpenEditor} onClick={() => void openCreated(createdId)}>Open draft</button></p>}
    {error && <p role="alert" className="yard-agent-error">{error}</p>}{mutation.error && <p role="alert" className="yard-agent-error">{mutation.error}</p>}
    {mutation.uncertain && <p>A change is awaiting confirmation. <button className="yard-agent-btn" type="button" disabled={!props.onCheckChanges || mutation.busy} onClick={() => void check()}>Check changes</button></p>}
  </div></main>;
}
