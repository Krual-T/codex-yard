import { useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import type { WorkbenchClient } from '../workbench-contract.ts';
import { readMethods } from '../../native/protocol.ts';
import type { ImageSource } from '../messages/message-data.ts';
import type { WorkspaceOption } from '../pages/auth/workspace-options.ts';
import type { FirstRunVariant } from '../pages/auth/first-run.ts';
import { readThroughOriginalBridge } from '../pages/product-http-fallback.ts';
import type { WorkspaceIdentity } from '../pages/agents/catalog.ts';
import type { AgentScope } from '../pages/agents/agent-model.ts';
import type { SkillChange, SkillChangeScope } from '../pages/skills/catalog.ts';
import type { PluginChange, PluginChangeScope, PluginSummary } from '../pages/plugins/catalog.ts';
import type { ProjectHomePageProps } from '../pages/projects/ProjectHomePage.tsx';
import type { AutomationLinkedPorts } from '../pages/automations/AutomationLinkedViews.tsx';
import { ProductRoutePage } from './ProductRoutePage.tsx';
import type { ProductAuth, ProductRouteOwner, ProductRoutePageProps } from './ProductRoutePage.tsx';
import type { Project } from './projects.ts';
import { productProjectReaders } from './ProductPagesProjects.ts';
import { readProductBridge } from './ProductPagesBridge.ts';
import { hostRequestMutates } from './client.ts';

type Owner = ProductRouteOwner;
type FileTarget = { hostId: string; cwd: string; path: string };
type SkillTarget = { hostId: string; cwd: string; skill: { name: string; path: string } };
type DispatchOptions = NonNullable<Parameters<WorkbenchClient['rpc']>[3]> & { assertBeforeSend?: () => void };

/** The current host client must honor assertBeforeSend at actual dispatch. */
export type ProductPagesClient = WorkbenchClient & {
  rpc<T = unknown>(method: string, params?: Record<string, unknown>, hostId?: string, options?: DispatchOptions): Promise<T>;
  host<T = unknown>(endpoint: string, params?: Record<string, unknown>, options?: { assertBeforeSend?: () => void }): Promise<T>;
};

/** The parent owns real authentication, capability decisions, guarded navigation and durable writes. */
export interface ProductPagesProps extends Omit<ProductRoutePageProps, 'pages' | 'client'> {
  client: ProductPagesClient;
  firstRun: { authMethod: 'chatgpt' | 'apiKey' | 'copilot' | 'other'; variant: FirstRunVariant; onContinue(owner: Owner): Promise<void> };
  onAuthenticated(owner: Owner): Promise<void>;
  workspace: {
    onComplete(owner: Owner): Promise<void>;
    onPickFolder?(owner: Owner): Promise<WorkspaceOption | null>;
    onCommitSelection?(owner: Owner, roots: string[]): Promise<boolean>;
    onCreateProject?(owner: Owner): Promise<boolean>;
  };
  projects: {
    cloudAccess: 'allowed' | 'denied' | 'unknown';
    hasUnresolvedChanges: boolean;
    onCreateProject?(owner: Owner): Promise<boolean>;
    onOpenProject?(owner: Owner, project: Project): Promise<void>;
    onComposeProject?(owner: Owner, project: Project): Promise<void>;
    onOpenThread?(owner: Owner, thread: { hostId: string; threadId: string; archived: false }): Promise<void>;
    localProject?: ProjectHomePageProps['localProject'];
    renderComposer?: (owner: Owner, request: Parameters<NonNullable<ProjectHomePageProps['renderComposer']>>[0]) => ReactNode;
  };
  agents: { identity: WorkspaceIdentity | null; enabled: boolean; canBuild: boolean; canShare: boolean; workspaceName?: string | null };
  /** Only values proved by the actual scheduled-task gates; no new scheduler is supplied. */
  automationLinks?: Pick<AutomationLinkedPorts, 'currentAccountId' | 'shareDialogEnabled' | 'canShare' | 'runAccess'>;
  /** Cwd of the plan's original conversation, not the currently selected workspace. */
  plan: { cwd: string | null };
  skills: { hasUnresolvedChanges: boolean;
    onTrackChange?: (owner: Owner, change: SkillChange, operation: () => Promise<void>) => Promise<void>;
    onReconcileChanges?: (owner: Owner, scope: SkillChangeScope) => Promise<void>;
    onTry?: (owner: Owner, value: SkillTarget) => Promise<void> };
  plugins: { hasUnresolvedChanges: boolean;
    accountKind: 'personal' | 'workspace' | 'unknown';
    workspaceDirectory: 'allowed' | 'denied' | 'unknown';
    onTrackChange?: (owner: Owner, change: PluginChange, operation: () => Promise<void>) => Promise<void>;
    onReconcileChanges?: (owner: Owner, scope: PluginChangeScope, client: WorkbenchClient) => Promise<void>;
    onSetLocalEnabled?: (owner: Owner, value: { hostId: string; cwd: string; plugin: PluginSummary; enabled: boolean }, client: WorkbenchClient) => Promise<void>;
    onManage?: (owner: Owner) => Promise<void>;
    onTry?: (owner: Owner, value: { hostId: string; cwd: string; plugin: PluginSummary }) => Promise<void> };
  onOpenFile?(owner: Owner, target: FileTarget): void;
  onOpenImage?(owner: Owner, image: ImageSource): void;
}

function ownerCurrent(check: ProductPagesProps['isCurrent'], owner: Owner): boolean {
  try { return check(owner) === true; } catch { return false; }
}

function scopedClient(client: ProductPagesClient, current: () => boolean): WorkbenchClient {
  const check = () => { if (!current()) throw new DOMException('The selected page changed.', 'AbortError'); };
  const beforeSend = (original?: () => void) => () => { check(); original?.(); check(); };
  return {
    async rpc<T>(method: string, params?: Record<string, unknown>, hostId?: string, options?: DispatchOptions) {
      check(); const value = await client.rpc<T>(method, params, hostId, { ...options, assertBeforeSend: beforeSend(options?.assertBeforeSend) });
      if (readMethods.has(method)) check(); return value;
    },
    async host<T>(endpoint: string, params?: Record<string, unknown>, options?: { assertBeforeSend?: () => void }) {
      check(); const value = await client.host<T>(endpoint, params, { assertBeforeSend: beforeSend(options?.assertBeforeSend) });
      if (!hostRequestMutates(endpoint, params ?? {})) check(); return value;
    },
    subscribe(listener) { return client.subscribe(event => { if (current()) listener(event); }); },
    async reply(request, response) { check(); await client.reply(request, response); },
  };
}

export function ProductPages(props: ProductPagesProps) {
  const owner: Owner = { hostId: props.hostId, accountKey: props.accountKey, userKey: props.userKey,
    authorityKey: props.authorityKey, locationKey: props.locationKey };
  const key = JSON.stringify([owner.hostId, owner.accountKey, owner.userKey, owner.authorityKey, owner.locationKey]);
  return <ProductPagesScope key={key} {...props} owner={owner} />;
}

function ProductPagesScope(props: ProductPagesProps & { owner: Owner }) {
  const { owner } = props;
  const checkRef = useRef(props.isCurrent); checkRef.current = props.isCurrent;
  const current = () => ownerCurrent(checkRef.current, owner);
  const check = () => { if (!current()) throw new DOMException('The selected page changed.', 'AbortError'); };
  const client = useMemo(() => scopedClient(props.client, current), [props.client]);
  const cloudAccess = props.firstRun.authMethod === 'apiKey' ? 'denied' :
    props.projects.cloudAccess === 'allowed' && !owner.accountKey ? 'unknown' : props.projects.cloudAccess;
  const readers = useMemo(() => productProjectReaders(client, current, cloudAccess, !!props.projects.onComposeProject),
    [client, cloudAccess, !!props.projects.onComposeProject]);
  const loadProject = useMemo(() => async (request: Parameters<NonNullable<ProjectHomePageProps['onLoadProject']>>[0]) => {
    check();
    if (request.hostId !== owner.hostId || request.accountKey !== owner.accountKey) throw new Error('The active account changed.');
    return readThroughOriginalBridge({ kind: 'project', projectId: request.projectId }, request.signal);
  }, [client]);
  const loadAgentDetail = useMemo(() => (request: { agentId: string; signal: AbortSignal }) =>
    readProductBridge({ kind: 'agent-detail', agentId: request.agentId }, current, request.signal), [client]);
  const loadAgentBuilder = useMemo(() => (request: { agentId: string; signal: AbortSignal }) =>
    readProductBridge({ kind: 'agent-builder', agentId: request.agentId }, current, request.signal), [client]);
  const agentIdentity = props.agents.enabled && props.agents.identity && owner.accountKey === props.agents.identity.accountId && owner.userKey === props.agents.identity.userId
    ? props.agents.identity : null;
  const agentScope: AgentScope | null = agentIdentity ? { hostId: owner.hostId, identity: agentIdentity, sessionKey: owner.authorityKey } : null;
  const agentCurrent = (scope: AgentScope) => current() && !!agentScope && scope.hostId === agentScope.hostId && scope.sessionKey === agentScope.sessionKey &&
    scope.identity.accountId === agentScope.identity.accountId && scope.identity.userId === agentScope.identity.userId;
  const agentPorts = { scope: agentScope, canBuild: props.agents.canBuild, hasUnresolvedChanges: false, isCurrent: agentCurrent };
  const openFile = props.onOpenFile ? (target: FileTarget) => { check(); props.onOpenFile!(owner, target); } : undefined;
  const query = new URLSearchParams(props.location.search);
  const directory = query.get('directory');
  const category = query.get('category');
  const initialSearch = query.get('search') ?? '';
  const workspacePluginError = props.firstRun.authMethod !== 'chatgpt' ? 'Sign in with ChatGPT to view this plugin directory.' :
    !owner.accountKey ? 'The plugin account has not been established.' :
      props.plugins.accountKind !== 'workspace' ? props.plugins.accountKind === 'unknown' ? 'The plugin account type has not been established.' : 'Workspace plugins require a workspace account.' :
        props.plugins.workspaceDirectory === 'denied' ? 'Workspace plugin access is unavailable for this account.' :
          props.plugins.workspaceDirectory === 'unknown' ? 'Workspace plugin access has not been established.' : undefined;
  const pluginAccount = () => {
    check();
    if (props.firstRun.authMethod !== 'chatgpt') throw new Error('Sign in with ChatGPT to view this plugin directory.');
    if (!owner.accountKey) throw new Error('The plugin account has not been established.');
  };
  const auth: ProductAuth = props.auth.state === 'required' ? { ...props.auth, onAuthenticated: async () => { check(); await props.onAuthenticated(owner); } } : props.auth;
  const navigateAgents = async () => {
    check();
    const host = owner.hostId === 'local' ? '' : `?hostId=${encodeURIComponent(owner.hostId)}`;
    if (!await props.navigate('/agents' + host, undefined, owner)) throw new Error('Navigation was not completed.');
  };
  const pageProps: ProductRoutePageProps['pages'] = {
    skills: { hasUnresolvedChanges: props.skills.hasUnresolvedChanges, onOpenFile: openFile,
      onTrySkill: props.skills.onTry ? async value => { check(); await props.skills.onTry!(owner, value); } : undefined,
      onTrackSkillChange: props.skills.onTrackChange ? async (change, operation) => {
        check(); await props.skills.onTrackChange!(owner, change, async () => { check(); await operation(); });
      } : undefined,
      onReconcileSkillChanges: props.skills.onReconcileChanges ? async scope => { check(); await props.skills.onReconcileChanges!(owner, scope); } : undefined },
    plugins: { accountKey: owner.accountKey, hasUnresolvedChanges: props.plugins.hasUnresolvedChanges,
      initialDirectory: directory === 'personal' || directory === 'workspace' ? directory : 'public',
      initialCategory: category ? { slug: category, title: category === 'plugins-created-by-you' ? 'Created by you' : category === 'plugins-shared-with-you' ? 'Shared with you' : category } : null,
      initialSearch,
      workspaceTabVisible: !workspacePluginError,
      workspaceSearchError: workspacePluginError,
      showPersonalShared: props.plugins.accountKind !== 'personal',
      personalUnavailableReason: props.firstRun.authMethod === 'chatgpt' ? 'The plugin account has not been established.' : 'Sign in with ChatGPT to view personal plugins.',
      onOpenSkill: openFile ? value => { if (value.skill.path) openFile({ hostId: value.hostId, cwd: value.cwd, path: value.skill.path }); } : undefined,
      onTryPlugin: props.plugins.onTry ? async value => { check(); await props.plugins.onTry!(owner, value); } : undefined,
      onManagePlugins: props.plugins.onManage ? async () => { check(); await props.plugins.onManage!(owner); } : undefined,
      onTrackPluginChange: props.plugins.onTrackChange ? async (change, operation) => {
        check(); await props.plugins.onTrackChange!(owner, change, async () => { check(); await operation(); });
      } : undefined,
      onSetLocalPluginEnabled: props.plugins.onSetLocalEnabled ? async value => { check(); await props.plugins.onSetLocalEnabled!(owner, value, client); } : undefined,
      onReconcilePluginChanges: props.plugins.onReconcileChanges ? async scope => { check(); await props.plugins.onReconcileChanges!(owner, scope, client); } : undefined,
      onLoadPersonalPlugins: async value => {
        pluginAccount(); if (value.hostId !== owner.hostId || value.accountKey !== owner.accountKey) throw new Error('The active account changed.');
        if (props.plugins.accountKind === 'unknown') throw new Error('The plugin account type has not been established.');
        if (value.section === 'shared' && props.plugins.accountKind !== 'workspace') throw new Error('Shared plugins require a workspace account.');
        if (value.section === 'created' && props.plugins.accountKind === 'workspace') {
          if (value.cursor !== null) throw new Error('The combined plugin cursor cannot be verified on this host.');
          await Promise.all([
            readProductBridge({ kind: 'personal-plugins', section: 'workspace-created', cursor: null }, current),
            readProductBridge({ kind: 'personal-plugins', section: 'user', cursor: null }, current),
          ]);
          throw new Error('The plugin responses cannot be associated with this account.');
        }
        const section = value.section === 'shared' ? 'shared' : 'user';
        return readProductBridge({ kind: 'personal-plugins', section, cursor: value.cursor }, current);
      },
      onLoadWorkspacePlugins: async value => {
        pluginAccount(); if (value.hostId !== owner.hostId || value.accountKey !== owner.accountKey) throw new Error('The active account changed.');
        if (workspacePluginError) throw new Error(workspacePluginError);
        return readProductBridge({ kind: 'personal-plugins', section: 'workspace', cursor: value.cursor }, current);
      },
      onLoadPublicSections: async value => {
        check(); if (value.hostId !== owner.hostId || value.accountKey !== owner.accountKey) throw new Error('The active account changed.');
        return readProductBridge({ kind: 'plugin-home' }, current);
      },
      onLoadPublicCategory: async value => {
        check(); if (value.hostId !== owner.hostId || value.accountKey !== owner.accountKey) throw new Error('The active account changed.');
        if (directory === 'workspace' && workspacePluginError) throw new Error(workspacePluginError);
        return readProductBridge({ kind: 'plugin-category', slug: value.categorySlug, query: value.searchTerm, cursor: value.cursor }, current);
      } },
    projects: { accountKey: owner.accountKey, sessionKey: owner.authorityKey, hasUnresolvedChanges: props.projects.hasUnresolvedChanges,
      onLoadProjects: readers.list, onLoadProjectChats: readers.chats,
      onCreateProject: props.projects.onCreateProject ? async () => { check(); return props.projects.onCreateProject!(owner); } : undefined,
      onOpenProject: props.projects.onOpenProject ? async value => { const project = await readers.findProject(value.project); check(); await props.projects.onOpenProject!(owner, project); } : undefined,
      onCreateChat: props.projects.onComposeProject ? async value => { const project = await readers.findProject(value.project); check(); await props.projects.onComposeProject!(owner, project); } : undefined,
      onOpenChat: props.projects.onOpenThread ? async value => { check(); await props.projects.onOpenThread!(owner, { hostId: value.chat.hostId, threadId: value.chat.id, archived: false }); } : undefined },
    projectHome: { localProject: props.projects.localProject, onLoadProject: loadProject,
      renderComposer: props.projects.renderComposer ? value => current() ? props.projects.renderComposer!(owner, value) : null : undefined },
    agents: { identity: agentIdentity, sessionKey: owner.authorityKey, enabled: props.agents.enabled, canBuild: props.agents.canBuild, workspaceName: props.agents.workspaceName,
      onLoadAgents: request => readProductBridge({ kind: 'agents', view: request.view, query: request.query, cursor: request.cursor }, current, request.signal),
      onLoadAgentDetail: loadAgentDetail },
    agentDetail: { ...agentPorts, canShare: props.agents.canShare,
      onLoadDetail: loadAgentDetail },
    agentCreate: agentPorts,
    agentEditor: { ...agentPorts, draft: null, models: { state: 'loading' },
      onLoadBuilder: loadAgentBuilder,
      onBack: navigateAgents },
    automationLinks: props.automationLinks,
    login: { onAuthenticated: async () => { check(); await props.onAuthenticated(owner); } },
    firstRun: { authMethod: props.firstRun.authMethod, variant: props.firstRun.variant,
      onContinue: async () => { check(); await props.firstRun.onContinue(owner); } },
    selectWorkspace: {
      onComplete: async hostId => { check(); if (hostId !== owner.hostId) throw new Error('The selected host changed.'); await props.workspace.onComplete(owner); },
      onPickFolder: props.workspace.onPickFolder ? async hostId => { check(); if (hostId !== owner.hostId) throw new Error('The selected host changed.');
        const result = await props.workspace.onPickFolder!(owner); check(); return result; } : undefined,
      onCommitSelection: props.workspace.onCommitSelection ? async value => { check(); if (value.hostId !== owner.hostId) throw new Error('The selected host changed.');
        return props.workspace.onCommitSelection!(owner, value.roots); } : undefined,
      onCreateProject: props.workspace.onCreateProject ? async hostId => { check(); if (hostId !== owner.hostId) throw new Error('The selected host changed.');
        return props.workspace.onCreateProject!(owner); } : undefined },
    plan: { cwd: props.plan.cwd, onOpenFile: openFile && props.plan.cwd ? path => openFile({ hostId: owner.hostId, cwd: props.plan.cwd!, path }) : undefined,
      onOpenImage: props.onOpenImage ? image => { check(); props.onOpenImage!(owner, image); } : undefined },
  };
  return <ProductRoutePage {...props} client={client} auth={auth} pages={pageProps} />;
}
