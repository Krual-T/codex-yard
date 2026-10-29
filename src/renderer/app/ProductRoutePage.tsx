import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { translateKnown, useI18n } from '../i18n/index.tsx';
import type { WorkbenchClient } from '../workbench-contract.ts';
import { SkillsPage } from '../pages/skills/SkillsPage.tsx';
import type { SkillsPageProps } from '../pages/skills/SkillsPage.tsx';
import { PluginsPage } from '../pages/plugins/PluginsPage.tsx';
import type { PluginsPageProps } from '../pages/plugins/PluginsPage.tsx';
import { ProjectsPage } from '../pages/projects/ProjectsPage.tsx';
import type { ProjectsPageProps } from '../pages/projects/ProjectsPage.tsx';
import { ProjectHomePage } from '../pages/projects/ProjectHomePage.tsx';
import type { ProjectHomePageProps } from '../pages/projects/ProjectHomePage.tsx';
import { LegacyAgentPage } from '../pages/agents/LegacyAgentPage.tsx';
import { WorkspaceAgentsPage } from '../pages/agents/WorkspaceAgentsPage.tsx';
import type { WorkspaceAgentsPageProps } from '../pages/agents/WorkspaceAgentsPage.tsx';
import { WorkspaceAgentPage } from '../pages/agents/WorkspaceAgentPage.tsx';
import type { WorkspaceAgentPageProps } from '../pages/agents/WorkspaceAgentPage.tsx';
import { WorkspaceAgentCreatePage, WorkspaceAgentEditor } from '../pages/agents/WorkspaceAgentEditor.tsx';
import type { WorkspaceAgentCreateProps, WorkspaceAgentEditorProps } from '../pages/agents/WorkspaceAgentEditor.tsx';
import { AutomationsPage } from '../pages/automations/AutomationsPage.tsx';
import type { AutomationsPageProps } from '../pages/automations/AutomationsPage.tsx';
import { SharedTaskDialog, TaskRunPage, TaskShareDialog } from '../pages/automations/AutomationLinkedViews.tsx';
import type { AutomationLinkedPorts } from '../pages/automations/AutomationLinkedViews.tsx';
import { readThroughOriginalBridge } from '../pages/product-http-fallback.ts';
import { LoginPage } from '../pages/auth/LoginPage.tsx';
import type { LoginPageProps } from '../pages/auth/LoginPage.tsx';
import { FirstRunPage } from '../pages/auth/FirstRunPage.tsx';
import type { FirstRunPageProps } from '../pages/auth/FirstRunPage.tsx';
import { SelectWorkspacePage } from '../pages/auth/SelectWorkspacePage.tsx';
import type { SelectWorkspacePageProps } from '../pages/auth/SelectWorkspacePage.tsx';
import { PlanSummaryPage } from '../pages/plan/PlanSummaryPage.tsx';
import type { PlanSummaryPageProps } from '../pages/plan/PlanSummaryPage.tsx';
import type { NavigationOptions } from './route-navigation.ts';
import { readProductRoute } from './product-routes.ts';
import type { ProductLocation, ProductRoute } from './product-routes.ts';

export type ProductAuth =
  | { state: 'loading' }
  | { state: 'error'; message: string; retry(): void | Promise<void> }
  | { state: 'required'; onAuthenticated(): void | Promise<void> }
  | { state: 'ready' };

/** Decisions are projections of the current host's real gates, never inferred here. */
export type ProductAccess =
  | { state: 'loading' }
  | { state: 'error'; message: string; retry(): void | Promise<void> }
  | { state: 'allow'; scheduledRedirect?: boolean; managePlugins?: 'settings' | 'skills'; cloudScheduledTasks?: 'allowed' | 'denied' | 'loading' | 'not-applicable';
      scheduledTasks?: 'allowed' | 'denied' | 'loading'; legacyProject?: { state: 'loading' } | { state: 'ready'; featureEnabled: boolean } }
  | { state: 'redirect'; path: string; stateValue?: unknown }
  | { state: 'app' }
  | { state: 'legacy' };

export interface ProductPagePorts {
  skills?: Omit<SkillsPageProps, 'client' | 'hostId' | 'cwd'>;
  plugins?: Omit<PluginsPageProps, 'client' | 'hostId' | 'cwd'>;
  projects?: Omit<ProjectsPageProps, 'hostId'>;
  projectHome?: Omit<ProjectHomePageProps, 'hostId' | 'accountKey' | 'userKey' | 'projectId' | 'location' | 'onBack'>;
  agents?: Omit<WorkspaceAgentsPageProps, 'hostId'>;
  agentDetail?: Omit<WorkspaceAgentPageProps, 'agentId'>;
  agentCreate?: WorkspaceAgentCreateProps;
  agentEditor?: Omit<WorkspaceAgentEditorProps, 'agentId'>;
  automations?: Omit<AutomationsPageProps, 'hostId'>;
  automationLinks?: AutomationLinkedPorts;
  login?: Omit<LoginPageProps, 'client' | 'hostId'>;
  firstRun?: Omit<FirstRunPageProps, 'client' | 'hostId'>;
  selectWorkspace?: Omit<SelectWorkspacePageProps, 'client' | 'hostId'>;
  plan?: Pick<PlanSummaryPageProps, 'cwd' | 'onOpenFile' | 'onOpenImage' | 'onBack'>;
}

export type ProductUnresolvedReason = 'other' | 'invalid' | 'app' | 'legacy' | 'missing-ports' | 'host-mismatch';

export interface ProductRouteOwner {
  hostId: string;
  accountKey: string | null;
  userKey: string | null;
  authorityKey: string | number;
  locationKey: string | number;
}

export interface ProductRoutePageProps {
  client: WorkbenchClient;
  location: ProductLocation;
  hostId: string;
  accountKey: string | null;
  userKey: string | null;
  cwd: string;
  /** Changes whenever the selected host connection or authorization generation changes. */
  authorityKey: string | number;
  /** Changes for each committed navigation, including a new state at the same URL. */
  locationKey: string | number;
  auth: ProductAuth;
  access: ProductAccess;
  /** Consults the live parent authority, including revocation before the next React commit. */
  isCurrent(owner: ProductRouteOwner): boolean;
  /** Rechecks owner after any asynchronous leave guard, immediately before committing navigation. */
  navigate(path: string, options: NavigationOptions | undefined, owner: ProductRouteOwner): Promise<boolean>;
  pages: ProductPagePorts;
  renderUnresolved(route: ProductRoute, reason: ProductUnresolvedReason): ReactNode;
}

type ScopedNavigate = (path: string, options?: NavigationOptions) => Promise<boolean>;
function NavigationRedirect({ path, state, navigate }: { path: string; state?: unknown; navigate: ScopedNavigate }) {
  const { t } = useI18n();
  const text = (value: string) => translateKnown(t, value);
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const currentNavigate = useRef(navigate); currentNavigate.current = navigate;
  useEffect(() => {
    let current = true;
    setFailure(null);
    void Promise.resolve().then(() => current ? currentNavigate.current(path, { replace: true, state }) : false)
      .then(ok => { if (current && !ok) setFailure('Navigation was not completed.'); })
      .catch(error => { if (current) setFailure(error instanceof Error ? error.message : String(error)); });
    return () => { current = false; };
  }, [path, state, attempt]);
  return failure ? <div role="alert">{text(failure)} <button type="button" onClick={() => setAttempt(value => value + 1)}>{t('Retry')}</button></div>
    : <p role="status">{text('Opening page...')}</p>;
}

function GateError({ message, retry }: { message: string; retry(): void | Promise<void> }) {
  const { t } = useI18n();
  const [error, setError] = useState('');
  return <div role="alert">{message}{error && ` ${error}`} <button type="button" onClick={() => {
    setError(''); void Promise.resolve().then(retry).catch(cause => setError(cause instanceof Error ? cause.message : String(cause)));
  }}>{t('Retry')}</button></div>;
}

function hostPath(path: string, hostId: string): string {
  const target = new URL(path, 'http://yard.invalid');
  if (target.origin !== 'http://yard.invalid') throw new Error('Invalid navigation target.');
  if (hostId !== 'local' || target.searchParams.has('hostId') || target.searchParams.has('host')) {
    target.searchParams.set('hostId', hostId);
    target.searchParams.delete('host');
  }
  return target.pathname + target.search + target.hash;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function ProductRoutePage(props: ProductRoutePageProps) {
  const route = readProductRoute(props.location);
  const key = JSON.stringify([props.hostId, props.accountKey, props.userKey, props.authorityKey, props.locationKey, route.kind, props.location.pathname, props.location.search, props.location.hash]);
  return <ProductRouteScope key={key} {...props} route={route} />;
}

function ProductRouteScope({ client, hostId, accountKey, userKey, cwd, authorityKey, locationKey, auth, access, isCurrent, navigate, pages, renderUnresolved, route }: ProductRoutePageProps & { route: ProductRoute }) {
  const { t } = useI18n();
  const [navigationError, setNavigationError] = useState('');
  const alive = useRef(false);
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const owner: ProductRouteOwner = { hostId, accountKey, userKey, authorityKey, locationKey };
  const current = () => { try { return alive.current && isCurrent(owner) === true; } catch { return false; } };
  const scopedNavigate: ScopedNavigate = async (path, options) => current() ? navigate(hostPath(path, hostId), options, owner) : false;
  const go = async (path: string) => {
    if (!current()) throw new Error('The selected page changed.');
    try {
      if (!await scopedNavigate(path)) throw new Error('Navigation was not completed.');
      if (alive.current) setNavigationError('');
    } catch (cause) {
      if (alive.current) setNavigationError(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    }
  };
  const goFromButton = (path: string) => { void go(path).catch(() => {}); };
  const navigateLocation = async (path: string, options: NavigationOptions): Promise<boolean> => {
    if (!current()) return false;
    try {
      if (!await scopedNavigate(path, options)) throw new Error('Navigation was not completed.');
      if (alive.current) setNavigationError('');
      return true;
    } catch (cause) { if (current()) setNavigationError(cause instanceof Error ? cause.message : String(cause)); return false; }
  };
  const back = () => { void navigateLocation(route.location.pathname + route.location.search + route.location.hash, { delta: -1 }); };
  return <>{navigationError && <div role="alert">{translateKnown(t, navigationError)}</div>}
    <ProductRouteContent client={client} hostId={hostId} accountKey={accountKey} userKey={userKey} cwd={cwd} authorityKey={authorityKey} auth={auth} access={access} isCurrent={isCurrent} navigate={scopedNavigate} pages={pages}
      renderUnresolved={renderUnresolved} route={route} go={go} goFromButton={goFromButton} back={back} navigateLocation={navigateLocation} navigationError={navigationError} current={current} /></>;
}

function ProductRouteContent({ client, hostId, accountKey, userKey, cwd, authorityKey, auth, access, navigate, pages, renderUnresolved, route, go, goFromButton, back, navigateLocation, navigationError, current }: Omit<ProductRoutePageProps, 'location' | 'locationKey' | 'navigate'> & {
  route: ProductRoute; navigate: ScopedNavigate; go(path: string): Promise<void>; goFromButton(path: string): void; back(): void; navigateLocation(path: string, options: NavigationOptions): Promise<boolean>; navigationError: string; current(): boolean;
}) {
  const { t } = useI18n();
  const text = (value: string) => translateKnown(t, value);
  const unresolved = (reason: ProductUnresolvedReason) => renderUnresolved(route, reason);
  const query = new URLSearchParams(route.location.search);
  const requestedHost = query.get('hostId') ?? query.get('host');
  if (route.kind !== 'other' && route.kind !== 'invalid' && requestedHost !== null && requestedHost !== hostId) return unresolved('host-mismatch');
  if (auth.state === 'loading') return <p role="status">{text('Checking account...')}</p>;
  if (auth.state === 'error') return <GateError message={auth.message} retry={auth.retry} />;
  if (auth.state === 'required') return <LoginPage client={client} hostId={hostId} onAuthenticated={auth.onAuthenticated} />;
  if (access.state === 'loading') return <p role="status">{text('Checking access...')}</p>;
  if (access.state === 'error') return <GateError message={access.message} retry={access.retry} />;
  if (access.state === 'app') return unresolved('app');
  if (access.state === 'legacy') return route.kind === 'agent-detail' ? <LegacyAgentPage agentId={route.agentId} onBack={back} /> : unresolved('legacy');
  if (access.state === 'redirect') return <NavigationRedirect path={access.path} state={access.stateValue} navigate={navigate} />;
  if (route.kind === 'invalid') return unresolved('invalid');
  if (route.kind === 'other') return unresolved('other');
  if (route.kind === 'inbox') return <NavigationRedirect path="/automations" navigate={navigate} />;
  if (route.kind === 'redirect') return <NavigationRedirect path={route.to} navigate={navigate} />;
  if (route.kind === 'automations' && route.path === '/automations' && access.scheduledRedirect) {
    return <NavigationRedirect path={'/scheduled' + route.location.search + route.location.hash} state={route.location.state} navigate={navigate} />;
  }
  switch (route.kind) {
    case 'skills':
      return pages.skills ? <SkillsPage {...pages.skills} client={client} hostId={hostId} cwd={cwd} /> : unresolved('missing-ports');
    case 'plugins':
      return pages.plugins ? <PluginsPage {...pages.plugins} client={client} hostId={hostId} cwd={cwd}
        onBrowseSkills={pages.plugins.onBrowseSkills ?? (() => goFromButton('/skills'))}
        onManagePlugins={pages.plugins.onManagePlugins ?? (access.managePlugins ? () => goFromButton(access.managePlugins === 'settings' ? '/settings/plugins-settings' : '/skills') : undefined)} /> : unresolved('missing-ports');
    case 'projects':
      if (route.projectId !== null) return <ProjectHomePage {...pages.projectHome} accountKey={accountKey} userKey={userKey}
        hostId={hostId} projectId={route.projectId} location={route.location} onBack={back} />;
      return pages.projects ? <ProjectsPage {...pages.projects} hostId={hostId} /> : unresolved('missing-ports');
    case 'legacy-project': {
      const decision = access.legacyProject;
      if (!decision || decision.state === 'loading') return <p role="status">{text('Checking project access...')}</p>;
      const mapping = pages.projectHome?.localProject;
      const mapped = mapping && accountKey !== null && userKey !== null && mapping.hostId === hostId && mapping.accountKey === accountKey && mapping.userKey === userKey && mapping.routeProjectId === route.projectId && !!mapping.projectId && !mapping.projectId.startsWith('g-p-');
      if (!decision.featureEnabled && !mapped) return <NavigationRedirect path="/" state={{ chatGptProjectId: route.projectId }} navigate={navigate} />;
      return <ProjectHomePage {...pages.projectHome} accountKey={accountKey} userKey={userKey} hostId={hostId} projectId={route.projectId} location={route.location} onBack={back} />;
    }
    case 'agents':
      return pages.agents ? <WorkspaceAgentsPage {...pages.agents} hostId={hostId}
        onOpenAgent={pages.agents.onOpenAgent ?? (value => go('/agents/a/' + encodeURIComponent(value.agent.id)))}
        onEditAgent={pages.agents.onEditAgent ?? (value => go('/agents/studio/edit/' + encodeURIComponent(value.agent.id)))}
        onCreateAgent={pages.agents.onCreateAgent ?? (() => go('/agents/studio/new'))} /> : unresolved('missing-ports');
    case 'agent-detail':
      if (!pages.agentDetail) return unresolved('missing-ports');
      if (pages.agentDetail.scope && pages.agentDetail.scope.hostId !== hostId) return unresolved('host-mismatch');
      return <WorkspaceAgentPage {...pages.agentDetail} agentId={route.agentId}
        onBack={pages.agentDetail.onBack ?? (() => goFromButton('/agents'))}
        onOpenEditor={pages.agentDetail.onOpenEditor ?? (value => go('/agents/studio/edit/' + encodeURIComponent(value.agentId)))}
        onDeleted={pages.agentDetail.onDeleted ?? (() => go('/agents'))} />;
    case 'agent-create':
      if (!pages.agentCreate) return unresolved('missing-ports');
      if (pages.agentCreate.scope && pages.agentCreate.scope.hostId !== hostId) return unresolved('host-mismatch');
      return <WorkspaceAgentCreatePage {...pages.agentCreate}
        onBack={pages.agentCreate.onBack ?? (() => goFromButton('/agents'))}
        onOpenEditor={pages.agentCreate.onOpenEditor ?? (value => go('/agents/studio/edit/' + encodeURIComponent(value.agentId)))} />;
    case 'agent-edit':
      if (!pages.agentEditor) return unresolved('missing-ports');
      if (pages.agentEditor.scope && pages.agentEditor.scope.hostId !== hostId) return unresolved('host-mismatch');
      return <WorkspaceAgentEditor {...pages.agentEditor} agentId={route.agentId} />;
    case 'automations': {
      if (access.scheduledTasks === 'denied') return <NavigationRedirect path="/" navigate={navigate} />;
      if (access.scheduledTasks !== 'allowed') return <p role="status">{text('Checking scheduled task access...')}</p>;
      if ((route.sharedTask !== null || route.shareDialog) && access.cloudScheduledTasks === 'denied') return <NavigationRedirect path="/" navigate={navigate} />;
      if ((route.sharedTask !== null || route.shareDialog) && access.cloudScheduledTasks === 'loading') return <p role="status">{text('Checking scheduled task access...')}</p>;
      const automation: Omit<AutomationsPageProps, 'hostId'> = pages.automations ?? { accountKey, installationKey: null, sessionKey: authorityKey, hasUnresolvedChanges: false, editor: null, isCurrent: () => current(),
        create: { sourceKey: 'local', location: 'local', capability: { allowed: false as const, reason: 'Scheduled task creation is unavailable on this host.' }, allowedStatuses: [], allowUnvalidatedPaused: false, idMatchesRequestId: false },
        projects: { state: 'loading' as const }, threads: { state: 'loading' as const }, models: { state: 'loading' as const } };
      if (automation.accountKey !== accountKey) return unresolved('host-mismatch');
      const scope = { hostId, accountKey: automation.accountKey, installationKey: automation.installationKey, sessionKey: automation.sessionKey };
      const state = record(route.location.state), template = record(state.template);
      const templateCandidate = typeof state.pluginId === 'string' && !!state.pluginId && ['key', 'name', 'prompt', 'rrule'].every(key => typeof template[key] === 'string' && !!(template[key] as string).trim());
      const update = (change: (search: URLSearchParams) => void, nextState: unknown = route.location.state) => {
        const search = new URLSearchParams(route.location.search); change(search);
        const queryString = search.toString();
        return navigateLocation(route.location.pathname + (queryString ? '?' + queryString : '') + route.location.hash, { replace: true, state: nextState });
      };
      const closeDetail = () => update(search => { for (const key of ['automationId', 'automationSource', 'automationMode', 'automationTeamId', 'automationDraftId', 'edit', 'edit_modal', 'runId', 'shared_task', 'share_dialog']) search.delete(key); });
      const closeShare = () => update(search => { search.delete('shared_task'); search.delete('share_dialog'); });
      const closeEditor = () => {
        let nextState = route.location.state;
        if (templateCandidate && automation.routeTemplate?.state === 'ready') {
          const { pluginId: _pluginId, template: _template, ...remaining } = state;
          nextState = Object.keys(remaining).length ? remaining : null;
        }
        update(search => {
          search.delete('automationDraftId');
          if (route.automationMode === 'create') { search.delete('automationMode'); search.delete('automationTeamId'); }
          else { search.delete('edit'); search.delete('edit_modal'); if (search.get('automationMode') === 'edit') search.delete('automationMode'); }
        }, nextState);
      };
      const links = access.cloudScheduledTasks === 'allowed' || access.cloudScheduledTasks === 'not-applicable' ? pages.automationLinks ?? {} : {};
      const landing = !!access.scheduledRedirect && route.view !== 'manage' && route.sharedTask === null && !route.shareDialog;
      if (landing && route.automationSource === 'cloud' && route.automationId !== null && route.runId !== null) {
        const originAccount = state.sidebarAutomationAccountId;
        const currentAccount = pages.automationLinks?.currentAccountId;
        if (originAccount !== undefined && currentAccount !== undefined && originAccount !== currentAccount) return <NavigationRedirect path="/scheduled" state={null} navigate={navigate} />;
        return <TaskRunPage scope={scope} ports={pages.automationLinks ?? {}} automationId={route.automationId} runId={route.runId} onClose={closeDetail} navigationError={navigationError}
          isCurrent={() => current() && automation.isCurrent(scope)} navigationSource={state.navigationSource} onNoConversation={() => { void update(search => search.delete('runId')); }} />;
      }
      const cloudDetail = route.automationSource === 'cloud' && route.automationId !== null && !automation.onLoadDetail ? async (request: Parameters<NonNullable<AutomationsPageProps['onLoadDetail']>>[0]) => {
        if (pages.automationLinks?.currentAccountId == null) throw new Error('The scheduled task account has not been established.');
        return readThroughOriginalBridge({ kind: 'task-detail', automationId: request.automationId }, request.signal);
      } : automation.onLoadDetail;
      return <><AutomationsPage {...automation} hostId={hostId} isCurrent={value => current() && automation.isCurrent(value)}
        isCurrentCompletion={automation.isCurrentCompletion ? (value, scope) => current() && automation.isCurrentCompletion!(value, scope) : undefined}
        onLoad={automation.onLoad ?? (request => client.host('list-automations', { hostId: request.hostId }))}
        onLoadDetail={cloudDetail}
        route={{ automationId: route.automationId, automationSource: route.automationSource, automationMode: route.automationMode, automationTeamId: route.automationTeamId,
          automationDraftId: route.automationDraftId, automationEditing: route.automationEditing, templateCandidate, navigationError,
          landing, origin: route.location,
          onBack: route.automationMode === 'create' ? closeEditor : closeDetail, onCancelEditor: closeEditor,
          onUnavailable: () => { void navigateLocation('/scheduled', { replace: true, state: null }); },
          onCreate: () => { void update(search => {
            for (const key of ['automationId', 'automationSource', 'automationTeamId', 'automationDraftId', 'edit', 'edit_modal', 'runId', 'shared_task', 'share_dialog']) search.delete(key);
            search.set('automationMode', 'create');
          }); },
          onConfirmed: completion => update(search => {
            for (const key of ['automationMode', 'automationDraftId', 'edit', 'edit_modal', 'runId']) search.delete(key);
            if (completion.kind === 'save') {
              search.set('automationId', completion.automationId); search.set('automationSource', completion.source);
              if (completion.teamId) search.set('automationTeamId', completion.teamId); else search.delete('automationTeamId');
            } else if (route.automationId === completion.automationId) {
              for (const key of ['automationId', 'automationSource', 'automationTeamId']) search.delete(key);
            }
          }, completion.kind === 'save' && templateCandidate && automation.routeTemplate?.state === 'ready' ? (() => {
            const { pluginId: _pluginId, template: _template, ...remaining } = state;
            return Object.keys(remaining).length ? remaining : null;
          })() : route.location.state),
          onSelect: entry => update(search => { search.set('automationId', entry.item.id); search.set('automationSource', entry.location === 'local' ? 'local' : 'cloud');
            if (entry.location === 'team' && entry.teamId) search.set('automationTeamId', entry.teamId); else search.delete('automationTeamId');
            for (const key of ['automationMode', 'automationDraftId', 'edit', 'edit_modal', 'runId']) search.delete(key); }) }} />
        {route.sharedTask !== null && <SharedTaskDialog scope={scope} ports={links} postId={route.sharedTask} onClose={closeShare} navigationError={navigationError}
          unavailable={access.cloudScheduledTasks === undefined ? 'Cloud scheduled task access has not been established.' : undefined} onOwner={automationId => update(search => {
          search.delete('shared_task'); search.delete('edit_modal'); search.set('automationId', automationId); search.set('automationSource', 'cloud'); search.set('share_dialog', 'true');
        })} />}
        {route.sharedTask === null && route.shareDialog && links.shareDialogEnabled !== false && <TaskShareDialog scope={scope} ports={links} automationId={route.automationId} onClose={closeShare} navigationError={navigationError}
          unavailable={access.cloudScheduledTasks === undefined ? 'Cloud scheduled task access has not been established.' : undefined} />}
      </>;
    }
    case 'login':
      return pages.login ? <LoginPage {...pages.login} client={client} hostId={hostId} /> : unresolved('missing-ports');
    case 'first-run':
      return pages.firstRun ? <FirstRunPage {...pages.firstRun} client={client} hostId={hostId} /> : unresolved('missing-ports');
    case 'select-workspace':
      return pages.selectWorkspace ? <SelectWorkspacePage {...pages.selectWorkspace} client={client} hostId={hostId} /> : unresolved('missing-ports');
    case 'plan-summary': {
      const state = record(route.location.state);
      if (typeof state.hostId === 'string' && state.hostId !== hostId) return unresolved('host-mismatch');
      const planContent = typeof state.planContent === 'string' ? state.planContent : null;
      const conversationId = typeof state.conversationId === 'string' ? state.conversationId : null;
      const planHost = typeof state.hostId === 'string' ? state.hostId : null;
      return <PlanSummaryPage {...pages.plan} client={client} hostId={planHost} conversationId={conversationId} planContent={planContent}
        loading={!planHost || !conversationId || !planContent} onBack={pages.plan?.onBack ?? (() => { void navigate(route.location.pathname + route.location.search + route.location.hash, { delta: -1 }); })} />;
    }
  }
}
