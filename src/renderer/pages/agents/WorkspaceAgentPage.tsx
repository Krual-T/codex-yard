import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeft, Copy, Ellipsis, Pin, RefreshCw, Trash2 } from 'lucide-react';
import { AgentIcon } from './AgentIcon.tsx';
import type { AgentActivityPage, AgentChange, AgentDetail, AgentIconValue, AgentMutationPorts, AgentReceipt, AgentScope } from './agent-model.ts';
import { agentError, canEditAgent, canViewAgentConfig, isAgentScopeCurrent, validAgentScope } from './agent-model.ts';
import { useAgentMutation } from './useAgentMutation.ts';
import './workspace-agent.css';

export interface WorkspaceAgentPageProps extends AgentMutationPorts {
  scope: AgentScope | null;
  agentId: string;
  canBuild: boolean;
  canShare: boolean;
  onLoadDetail?: (request: AgentScope & { agentId: string; signal: AbortSignal }) => Promise<AgentDetail>;
  onLoadActivity?: (request: AgentScope & { agentId: string; cursor: string | null; limit: 25; signal: AbortSignal }) => Promise<AgentActivityPage>;
  onBack?: () => void;
  onOpenEditor?: (request: AgentScope & { agentId: string }) => void | Promise<void>;
  onOpenConversation?: (request: AgentScope & { agentId: string; conversationId: string }) => void | Promise<void>;
  onOpenSchedule?: (request: AgentScope & { agentId: string; scheduleId: string }) => void | Promise<void>;
  onPrefillPrompt?: (request: AgentScope & { agentId: string; prompt: string }) => void | Promise<void>;
  onCopyLink?: (request: AgentScope & { agentId: string }) => void | Promise<void>;
  onShare?: (request: AgentScope & { agentId: string }) => void | Promise<void>;
  onDeleted?: (request: AgentScope & { agentId: string }) => void | Promise<void>;
  renderComposer?: (request: AgentScope & { agentId: string }) => ReactNode;
  renderApps?: (request: AgentScope & { agentId: string; connectors: unknown[]; canEdit: boolean }) => ReactNode;
  renderMemory?: (request: AgentScope & { agentId: string; canViewConfig: boolean }) => ReactNode;
  renderIcon?: (icon: AgentIconValue | null, size: number) => ReactNode;
}

function validDetail(value: AgentDetail, id: string): boolean {
  if (!value || value.agentId !== id || typeof value.capability !== 'string' || typeof value.isPrivateToCreator !== 'boolean' ||
    !(value.creatorName === null || typeof value.creatorName === 'string') || ![true, false, null].includes(value.isPinned)) return false;
  const version = value.published;
  return version === null || !!version && typeof version.name === 'string' && typeof version.tagline === 'string' &&
    typeof version.description === 'string' && Array.isArray(version.connectors) && Array.isArray(version.starterPrompts) &&
    (version.icon === null || !!version.icon && typeof version.icon.name === 'string' && typeof version.icon.color === 'string') &&
    version.starterPrompts.every(item => item && typeof item.title === 'string' && typeof item.prompt === 'string' && typeof item.short_description === 'string') &&
    (version.persistentFolder === null || typeof version.persistentFolder === 'string');
}

export function WorkspaceAgentPage(props: WorkspaceAgentPageProps) {
  const scope = props.scope;
  if (!validAgentScope(scope) || !props.agentId) return <main className="yard-agent-page"><div className="yard-agent-content"><p>Workspace agent is unavailable for this account.</p></div></main>;
  return <AgentPageScope key={JSON.stringify([scope.hostId, scope.identity.accountId, scope.identity.userId, scope.sessionKey, props.agentId])} {...props} scope={scope} />;
}

function AgentPageScope(props: WorkspaceAgentPageProps & { scope: AgentScope }) {
  const { scope, agentId } = props;
  const [detail, setDetail] = useState<AgentDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [tab, setTab] = useState<'activity' | 'apps' | 'memory'>('activity');
  const [confirm, setConfirm] = useState<'duplicate' | 'delete' | null>(null);
  const [duplicateId, setDuplicateId] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);
  const tabId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const menu = useRef<HTMLElement>(null);
  const alive = useRef(false);
  const redirected = useRef(false);
  const mutation = useAgentMutation(scope, props);
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!props.onLoadDetail) { setDetail(null); setError(null); setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true); setError(null); setDetail(null);
    void Promise.resolve().then(() => { if (!isAgentScopeCurrent(props, scope)) throw new Error('The active account changed.'); return props.onLoadDetail!({ ...scope, agentId, signal: controller.signal }); }).then(value => {
      if (!validDetail(value, agentId)) throw new Error('Invalid agent detail.');
      if (!controller.signal.aborted && isAgentScopeCurrent(props, scope)) setDetail(value);
    }).catch(cause => { if (!controller.signal.aborted && isAgentScopeCurrent(props, scope)) setError(agentError(cause)); })
      .finally(() => { if (!controller.signal.aborted && isAgentScopeCurrent(props, scope)) setLoading(false); });
    return () => controller.abort();
  }, [revision, props.onLoadDetail, scope.hostId, scope.identity.accountId, scope.identity.userId, scope.sessionKey, agentId]);
  useEffect(() => {
    if (detail && !detail.published && canViewAgentConfig(detail.capability) && props.onOpenEditor && !redirected.current) {
      redirected.current = true;
      void Promise.resolve().then(() => { if (isAgentScopeCurrent(props, scope)) return props.onOpenEditor!({ ...scope, agentId }); }).catch(cause => { if (alive.current && isAgentScopeCurrent(props, scope)) setActionError(agentError(cause)); });
    }
  }, [detail]);
  useEffect(() => {
    const element = dialog.current;
    if (confirm && element && !element.open) element.showModal();
    if (!confirm && element?.open) element.close();
    return () => { if (element?.open) element.close(); };
  }, [confirm]);
  const invoke = (action: () => void | Promise<void>) => {
    setActionError(null);
    void Promise.resolve().then(() => { if (isAgentScopeCurrent(props, scope)) return action(); }).catch(cause => { if (alive.current && isAgentScopeCurrent(props, scope)) setActionError(agentError(cause)); });
  };
  const finish = (change: AgentChange, receipt: Extract<AgentReceipt, { state: 'confirmed' }>) => {
    if (!alive.current || !isAgentScopeCurrent(props, scope)) return;
    setConfirm(null);
    if (change.kind === 'pin' && detail) setDetail({ ...detail, isPinned: change.pinned });
    if (change.kind === 'duplicate' && props.onOpenEditor) { setDuplicateId(receipt.agentId); invoke(() => props.onOpenEditor!({ ...scope, agentId: receipt.agentId })); }
    if (change.kind === 'delete' && props.onDeleted) { setDeleted(true); invoke(() => props.onDeleted!({ ...scope, agentId })); }
  };
  const check = async () => {
    const resolved = await mutation.check(value => (value.kind === 'pin' || value.kind === 'delete' || value.kind === 'duplicate') && value.agentId === agentId);
    if (resolved?.receipt.state === 'confirmed') finish(resolved.change, resolved.receipt);
  };
  const run = async (kind: 'duplicate' | 'delete' | 'pin', pinned?: boolean) => {
    if (!detail || !detail.published || mutation.locked) return;
    if (kind === 'duplicate' && (!props.canBuild || !canViewAgentConfig(detail.capability) || !props.onOpenEditor || duplicateId) ||
      kind === 'delete' && (detail.capability !== 'hermes_admin' || !props.onDeleted) || kind === 'pin' && detail.isPinned === null) return;
    const operationId = crypto.randomUUID();
    const change: AgentChange = kind === 'duplicate' ? { ...scope, operationId, kind, agentId, name: `${detail.published.name.trim() || 'Unnamed agent'} (Copy)` } :
      kind === 'pin' ? { ...scope, operationId, kind, agentId, pinned: pinned === true } : { ...scope, operationId, kind, agentId };
    const result = await mutation.execute(change);
    if (result?.state === 'confirmed') finish(change, result);
  };
  const version = detail?.published;
  const editable = detail ? canEditAgent(detail.capability) : false;
  const configView = detail ? canViewAgentConfig(detail.capability) : false;
  const confirmAllowed = confirm === 'delete' ? detail?.capability === 'hermes_admin' && !!props.onDeleted :
    !!detail && !!detail.published && props.canBuild && configView && !!props.onOpenEditor && !duplicateId;
  return <main className="yard-agent-page"><div className="yard-agent-content">
    <header className="yard-agent-toolbar"><div className="yard-agent-actions">{props.onBack && <button className="yard-agent-icon-button" type="button" onClick={() => invoke(props.onBack!)} aria-label="Back" title="Back"><ArrowLeft size={17} /></button>}<strong>Workspace Agents</strong></div>
      {version && detail && !deleted && <div className="yard-agent-actions">
        {configView && <button className="yard-agent-btn" type="button" disabled={!props.onOpenEditor} onClick={() => invoke(() => props.onOpenEditor!({ ...scope, agentId }))}>{editable ? 'Edit agent' : 'View agent'}</button>}
        <details className="yard-agent-menu" onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); } }}><summary ref={menu} className="yard-agent-icon-button" aria-label="Agent menu" title="Agent menu"><Ellipsis size={19} /></summary><div className="yard-agent-menu-items" onClick={event => { (event.currentTarget.parentElement as HTMLDetailsElement).open = false; }}>
          <button type="button" disabled={!props.onCopyLink} onClick={() => invoke(() => props.onCopyLink!({ ...scope, agentId }))}><Copy size={16} /> Copy link</button>
          <button type="button" disabled={detail.isPinned === null || !props.onChange || mutation.locked} onClick={() => void run('pin', !detail.isPinned)}><Pin size={16} /> {detail.isPinned ? 'Unpin from sidebar' : 'Pin to sidebar'}</button>
          {editable && props.canShare && <button type="button" disabled={!props.onShare} onClick={() => invoke(() => props.onShare!({ ...scope, agentId }))}>Share</button>}
          {props.canBuild && configView && <button type="button" disabled={!props.onChange || !props.onOpenEditor || mutation.locked || !!duplicateId} onClick={() => setConfirm('duplicate')}><Copy size={16} /> Duplicate</button>}
          {detail.capability === 'hermes_admin' && <button type="button" disabled={!props.onChange || !props.onDeleted || mutation.locked} onClick={() => setConfirm('delete')}><Trash2 size={16} /> Delete</button>}
        </div></details>
      </div>}
    </header>
    {loading && <p role="status" className="yard-agent-muted">Loading agent...</p>}
    {!props.onLoadDetail && <p className="yard-agent-muted">Agent details are unavailable on this host.</p>}
    {error && <div role="alert" className="yard-agent-message yard-agent-error">Could not load this agent: {error} <button className="yard-agent-btn" type="button" onClick={() => setRevision(value => value + 1)}>Retry</button></div>}
    {actionError && <p role="alert" className="yard-agent-message yard-agent-error">Could not complete action: {actionError}</p>}
    {duplicateId && <p className="yard-agent-message">Copy created. <button className="yard-agent-btn" type="button" disabled={!props.onOpenEditor} onClick={() => invoke(() => props.onOpenEditor!({ ...scope, agentId: duplicateId }))}>Open copy</button></p>}
    {deleted && <p className="yard-agent-message">Agent deleted. <button className="yard-agent-btn" type="button" disabled={!props.onDeleted} onClick={() => invoke(() => props.onDeleted!({ ...scope, agentId }))}>Back to agents</button></p>}
    {mutation.error && <p role="alert" className="yard-agent-message yard-agent-error">{mutation.error}</p>}
    {mutation.uncertain && <div className="yard-agent-message">A change is awaiting confirmation. <button className="yard-agent-btn" type="button" disabled={!props.onCheckChanges || mutation.busy} onClick={() => void check()}>Check changes</button></div>}
    {detail && !version && <p className="yard-agent-message">{configView ? 'This agent has not been published.' : 'This agent is unavailable.'} {configView && <button className="yard-agent-btn" type="button" disabled={!props.onOpenEditor} onClick={() => invoke(() => props.onOpenEditor!({ ...scope, agentId }))}>Open configuration</button>}</p>}
    {version && detail && !deleted && <>
      <div className="yard-agent-heading"><AgentIcon icon={version.icon} size={44} renderIcon={props.renderIcon} /><div><h1>{version.name.trim() || agentId}</h1>
        {detail.isPrivateToCreator && <p>Private</p>}{!detail.isPrivateToCreator && detail.creatorName && <p>By {detail.creatorName}</p>}{version.tagline && <p>{version.tagline}</p>}</div></div>
      {version.starterPrompts.length > 0 && <div className="yard-agent-prompts-row" aria-label="Starter prompts">{version.starterPrompts.slice(0, 4).map((item, index) => <button className="yard-agent-btn" type="button" key={index} title={item.short_description || item.prompt} disabled={!props.onPrefillPrompt} onClick={() => invoke(() => props.onPrefillPrompt!({ ...scope, agentId, prompt: item.prompt }))}>{item.title}</button>)}</div>}
      {props.renderComposer?.({ ...scope, agentId })}
      <div className="yard-agent-tabs" role="tablist" aria-label="Agent details tabs" onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
        const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        event.preventDefault(); tabs[next]?.focus(); tabs[next]?.click();
      }}>{(['activity', ...(version.connectors.length ? ['apps'] as const : []), ...(version.persistentFolder === 'per_user' ? ['memory'] as const : [])] as const).map(item => <button type="button" role="tab" id={`${tabId}-${item}`} aria-controls={`${tabId}-panel`} aria-selected={tab === item} tabIndex={tab === item ? 0 : -1} key={item} onClick={() => setTab(item)}>{item === 'activity' ? 'Activity' : item === 'apps' ? 'Apps' : 'Memory'}</button>)}</div>
      <div role="tabpanel" id={`${tabId}-panel`} aria-labelledby={`${tabId}-${tab}`}>
        {tab === 'activity' && <Activity scope={scope} agentId={agentId} isCurrent={props.isCurrent} onLoad={props.onLoadActivity} onConversation={props.onOpenConversation} onSchedule={props.onOpenSchedule} onError={setActionError} />}
        {tab === 'apps' && (props.renderApps ? props.renderApps({ ...scope, agentId, connectors: version.connectors, canEdit: editable }) : <p className="yard-agent-message yard-agent-muted">App connections are unavailable on this host.</p>)}
        {tab === 'memory' && (props.renderMemory ? props.renderMemory({ ...scope, agentId, canViewConfig: configView }) : <p className="yard-agent-message yard-agent-muted">Memory is unavailable on this host.</p>)}
      </div>
    </>}
    {confirm && <dialog ref={dialog} className="yard-agent-modal" aria-labelledby="yard-agent-confirm-title" onCancel={event => { if (mutation.busy) event.preventDefault(); }} onClose={() => { setConfirm(null); menu.current?.focus(); }}>
      <h2 id="yard-agent-confirm-title">{confirm === 'delete' ? 'Delete agent?' : `Duplicate ${version?.name.trim() || 'Unnamed agent'}?`}</h2>
      <p>{confirm === 'delete' ? 'This action cannot be undone.' : "This won't copy channels, automations, or agent-owned app connections."}</p>
      {mutation.error && <p role="alert">{mutation.error}</p>}{mutation.uncertain && <button className="yard-agent-btn" type="button" disabled={!props.onCheckChanges || mutation.busy} onClick={() => void check()}>Check changes</button>}
      <footer><button className="yard-agent-btn" type="button" disabled={mutation.busy} onClick={() => setConfirm(null)}>Cancel</button><button className="yard-agent-btn yard-agent-btn-primary" type="button" disabled={mutation.locked || !props.onChange || !confirmAllowed} onClick={() => void run(confirm)}>{confirm === 'delete' ? 'Delete' : 'Duplicate'}</button></footer>
    </dialog>}
  </div></main>;
}

function checkedActivity(value: AgentActivityPage): AgentActivityPage {
  if (!value || !Array.isArray(value.items) || !Array.isArray(value.scheduled) || !Array.isArray(value.warnings) || !value.warnings.every(item => typeof item === 'string') ||
    !(value.nextCursor === null || typeof value.nextCursor === 'string' && value.nextCursor.length > 0) ||
    !value.items.every(item => item && typeof item.id === 'string' && !!item.id && typeof item.title === 'string' && (item.status === null || typeof item.status === 'string') && typeof item.responding === 'boolean' && (item.updatedAt === null || typeof item.updatedAt === 'string') && (item.source === null || typeof item.source === 'string')) ||
    !value.scheduled.every(item => item && typeof item.id === 'string' && !!item.id && typeof item.nextRunAt === 'string' && (item.description === null || typeof item.description === 'string'))) throw new Error('Invalid activity response.');
  return value;
}

function Activity({ scope, agentId, isCurrent, onLoad, onConversation, onSchedule, onError }: { scope: AgentScope; agentId: string; isCurrent: AgentMutationPorts['isCurrent']; onLoad: WorkspaceAgentPageProps['onLoadActivity']; onConversation: WorkspaceAgentPageProps['onOpenConversation']; onSchedule: WorkspaceAgentPageProps['onOpenSchedule']; onError: (value: string) => void }) {
  const [data, setData] = useState<AgentActivityPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const current = () => { try { return isCurrent(scope) === true; } catch { return false; } };
  const load = async (cursor: string | null, signal: AbortSignal) => {
    if (!onLoad || !current()) return;
    setLoading(true); setError(null);
    try {
      const result = checkedActivity(await onLoad({ ...scope, agentId, cursor, limit: 25, signal }));
      if (signal.aborted || !current()) return;
      setData(previous => cursor && previous ? { ...result, items: [...previous.items, ...result.items.filter(item => !previous.items.some(old => old.id === item.id))], scheduled: previous.scheduled, warnings: [...new Set([...previous.warnings, ...result.warnings])] } : result);
    } catch (cause) { if (!signal.aborted && current()) setError(agentError(cause)); }
    finally { if (!signal.aborted && current()) { busy.current = false; setLoading(false); } }
  };
  useEffect(() => {
    const next = new AbortController(); controller.current = next; busy.current = true; setData(null);
    void load(null, next.signal);
    return () => { next.abort(); busy.current = false; };
  }, [refresh, onLoad]);
  const more = () => {
    if (!data?.nextCursor || busy.current || !controller.current) return;
    busy.current = true; void load(data.nextCursor, controller.current.signal);
  };
  const go = (action: () => void | Promise<void>) => { void Promise.resolve().then(() => { if (current()) return action(); }).catch(cause => { if (!controller.current?.signal.aborted && current()) onError(agentError(cause)); }); };
  return <section className="yard-agent-section"><div className="yard-agent-section-head"><h2>Activity</h2><button className="yard-agent-icon-button" type="button" aria-label="Refresh activity" title="Refresh activity" disabled={!onLoad || loading} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={16} /></button></div>
    {!onLoad && <p className="yard-agent-muted">Activity is unavailable on this host.</p>}
    {loading && <p role="status" className="yard-agent-muted">Loading activity...</p>}
    {error && <div role="alert" className="yard-agent-message yard-agent-error">Could not load activity: {error} <button className="yard-agent-btn" type="button" onClick={() => data?.nextCursor ? more() : setRefresh(value => value + 1)}>Retry</button></div>}
    {data?.warnings.map((warning, index) => <p role="status" className="yard-agent-message yard-agent-error" key={index}>{warning}</p>)}
    {data && !data.items.length && !data.scheduled.length && !data.warnings.length && !error && <p className="yard-agent-muted">No activity yet. Conversations and automation runs will show up here.</p>}
    {data && <ul className="yard-agent-list">{data.scheduled.map(item => <li key={`schedule:${item.id}`}><button type="button" disabled={!onSchedule} onClick={() => go(() => onSchedule!({ ...scope, agentId, scheduleId: item.id }))}><span><strong>Upcoming run</strong><small>{item.description || ''}</small></span><span>{item.nextRunAt}</span></button></li>)}
      {data.items.map(item => <li key={item.id}><button type="button" disabled={!onConversation} onClick={() => go(() => onConversation!({ ...scope, agentId, conversationId: item.id }))}><span><strong>{item.title || 'Untitled conversation'}</strong><small>{activityStatus(item.status, item.responding)}{item.source ? ` - ${item.source}` : ''}</small></span><span>{item.updatedAt || ''}</span></button></li>)}</ul>}
    {data?.nextCursor && !error && <button className="yard-agent-btn" type="button" disabled={loading} onClick={more}>Load more</button>}
  </section>;
}

function activityStatus(status: string | null, responding: boolean): string {
  if (status === 'pending') return 'Queued';
  if (status === 'in_progress') return responding ? 'Responding' : 'Working';
  if (status === 'completed') return 'Task completed';
  if (status === 'blocked') return 'Needs your attention';
  if (status === 'failed' || status === 'timed_out_waiting_on_tool') return 'Could not complete task';
  if (status === 'aborted') return 'Run stopped';
  return status ?? '';
}
