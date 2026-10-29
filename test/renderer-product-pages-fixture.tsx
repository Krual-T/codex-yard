import { createRoot } from 'react-dom/client';
import { BrowserWorkbenchClient } from '../src/renderer/app/client.ts';
import { ProductPages } from '../src/renderer/app/ProductPages.tsx';
import type { ProductPagesClient, ProductPagesProps } from '../src/renderer/app/ProductPages.tsx';
import type { ProductRouteOwner } from '../src/renderer/app/ProductRoutePage.tsx';
import type { WorkbenchClient } from '../src/renderer/workbench-contract.ts';

declare global {
  interface Window {
    productPagesHarness: {
      calls: { kind: string; value?: unknown }[];
      show(url: string, state?: unknown): void;
      revoke(): void;
      holdCommit(): void;
      releaseCommit(): void;
      holdHostSend(): void;
      releaseHostSend(): void;
      revokeAtHostDispatch(): void;
      connect(): Promise<void>;
      failNextNavigation(): void;
      setAuthMethod(value: 'chatgpt' | 'apiKey'): void;
      setAgentMismatch(value: boolean): void;
      setAgentEnabled(value: boolean): void;
      setWorkspaceDirectory(value: 'allowed' | 'denied' | 'unknown'): void;
      currentUrl(): string;
    };
  }
}

const transport = new BrowserWorkbenchClient();
const root = createRoot(document.getElementById('root')!);
const calls: { kind: string; value?: unknown }[] = [];
let generation = 0, locationGeneration = 0, live = true, denyNavigation = false, hold = false;
let holdHost = false, releaseHost: (() => void) | null = null;
let revokeAtDispatch = false;
type DispatchOptions = NonNullable<Parameters<WorkbenchClient['rpc']>[3]> & { assertBeforeSend?: () => void };
const client: WorkbenchClient = {
  rpc<T>(method: string, params?: Record<string, unknown>, targetHost?: string, options?: DispatchOptions) {
    options?.assertBeforeSend?.();
    return transport.rpc<T>(method, params, targetHost, options);
  },
  async host<T>(endpoint: string, params?: Record<string, unknown>, options?: { assertBeforeSend?: () => void }) {
    if (endpoint === 'set-global-state' && holdHost) {
      calls.push({ kind: 'host-send-wait', value: endpoint });
      await new Promise<void>(resolve => { releaseHost = resolve; });
    }
    options?.assertBeforeSend?.();
    let checks = 0;
    const dispatchOptions = options?.assertBeforeSend && revokeAtDispatch && endpoint === 'set-global-state' ? {
      assertBeforeSend() {
        if (++checks === 2) { revokeAtDispatch = false; live = false; }
        options.assertBeforeSend?.();
      },
    } : options;
    return (transport as ProductPagesClient).host<T>(endpoint, params, dispatchOptions);
  },
  subscribe(listener) { return transport.subscribe(listener); },
  reply(request, response) { return transport.reply(request, response); },
};
let authMethod: 'chatgpt' | 'apiKey' = 'chatgpt';
let agentMismatch = false;
let agentEnabled = true;
let workspaceDirectory: 'allowed' | 'denied' | 'unknown' = 'allowed';
let release: (() => void) | null = null;
let locationValue = { pathname: '/', search: '', hash: '', state: null as unknown };
let hostId = 'local';
const identity = { accountId: 'synthetic-account', userId: 'synthetic-user' };

function current(owner: ProductRouteOwner) {
  return live && owner.hostId === hostId && owner.accountKey === (authMethod === 'chatgpt' ? identity.accountId : null) && owner.userKey === (authMethod === 'chatgpt' ? identity.userId : null) &&
    owner.authorityKey === generation && owner.locationKey === locationGeneration;
}
function setLocation(url: string, state: unknown = null) {
  const parsed = new URL(url, window.location.origin);
  history.pushState(state, '', parsed.href);
  locationValue = { pathname: parsed.pathname, search: parsed.search, hash: parsed.hash, state };
  hostId = parsed.searchParams.get('hostId') ?? parsed.searchParams.get('host') ?? 'local';
  generation++; locationGeneration++; live = true; render();
}
async function navigate(path: string, options: { replace?: boolean; delta?: number; state?: unknown } | undefined, owner: ProductRouteOwner) {
  calls.push({ kind: 'navigate-attempt', value: { path, options, owner } });
  if (denyNavigation) { denyNavigation = false; return false; }
  if (!current(owner)) return false;
  const parsed = new URL(path, window.location.origin);
  if (options?.replace) history.replaceState(options.state ?? null, '', parsed.href); else history.pushState(options?.state ?? null, '', parsed.href);
  locationValue = { pathname: parsed.pathname, search: parsed.search, hash: parsed.hash, state: options?.state ?? null };
  hostId = parsed.searchParams.get('hostId') ?? parsed.searchParams.get('host') ?? 'local';
  locationGeneration++; calls.push({ kind: 'navigate', value: { path, options } }); render(); return true;
}
function render() {
  const props: ProductPagesProps = {
    client, location: locationValue, hostId, cwd: hostId === 'local' ? '/local/project' : '/remote/project',
    accountKey: authMethod === 'chatgpt' ? identity.accountId : null, userKey: authMethod === 'chatgpt' ? identity.userId : null, authorityKey: generation, locationKey: locationGeneration,
    auth: { state: 'ready' }, access: { state: 'allow', managePlugins: 'skills', scheduledTasks: 'allowed', cloudScheduledTasks: 'allowed', legacyProject: { state: 'ready', featureEnabled: true } },
    isCurrent: current, navigate,
    renderUnresolved: (_route, reason) => <div data-testid="unresolved">{reason}</div>,
    onAuthenticated: async owner => { if (!current(owner)) throw new Error('Changed owner'); calls.push({ kind: 'authenticated' }); },
    firstRun: { authMethod, variant: authMethod === 'apiKey' ? 'apiKey' : 'chatgpt', onContinue: async owner => { if (!current(owner)) throw new Error('Changed owner'); calls.push({ kind: 'first-run-complete', value: owner }); } },
    workspace: {
      onComplete: async owner => { if (!current(owner)) throw new Error('Changed owner');
        if (!await navigate('/?hostId=' + encodeURIComponent(owner.hostId), { replace: true, state: { fromWorkspace: true } }, owner)) throw new Error('Could not continue'); },
      onCommitSelection: async (owner, roots) => {
        calls.push({ kind: 'workspace-prepare', value: { owner, roots } });
        if (hold) await new Promise<void>(resolve => { release = resolve; });
        if (!current(owner)) throw new Error('Changed owner');
        for (const path of roots) await client.host('project-add', { hostId: owner.hostId, path, name: path.split('/').pop() || path });
        calls.push({ kind: 'workspace-saved', value: { owner, roots } }); return true;
      },
    },
    projects: { cloudAccess: 'allowed', hasUnresolvedChanges: false,
      onOpenProject: async (owner, project) => { if (!current(owner)) throw new Error('Changed owner');
        calls.push({ kind: 'open-project', value: project });
        if (!await navigate('/?hostId=' + encodeURIComponent(owner.hostId), { state: { project } }, owner)) throw new Error('Could not open project'); },
      onComposeProject: async (owner, project) => { if (!current(owner)) throw new Error('Changed owner');
        calls.push({ kind: 'compose-project', value: project });
        if (!await navigate('/?hostId=' + encodeURIComponent(owner.hostId), { state: { project } }, owner)) throw new Error('Could not open project'); },
      onOpenThread: async (owner, thread) => { if (!current(owner)) throw new Error('Changed owner'); calls.push({ kind: 'open-thread', value: thread });
        if (!await navigate('/?hostId=' + encodeURIComponent(owner.hostId) + '&threadId=' + encodeURIComponent(thread.threadId), { state: { thread } }, owner)) throw new Error('Could not open thread'); },
      renderComposer: (owner, request) => <output data-testid="project-composer">{JSON.stringify({ owner, request })}</output> },
    agents: { identity: agentMismatch ? { ...identity, accountId: 'different-account' } : identity, enabled: agentEnabled, canBuild: true, canShare: true },
    automationLinks: { currentAccountId: identity.accountId, shareDialogEnabled: true, canShare: { allowed: true }, runAccess: { allowed: true } },
    plan: { cwd: '/plan/conversation' }, skills: { hasUnresolvedChanges: false }, plugins: { hasUnresolvedChanges: false, accountKind: 'workspace', workspaceDirectory },
    onOpenFile: (owner, value) => { if (!current(owner)) throw new Error('Changed owner'); calls.push({ kind: 'open-file', value }); },
  };
  root.render(<ProductPages {...props} />);
}
window.productPagesHarness = { calls, show: setLocation, revoke() { live = false; },
  holdCommit() { hold = true; }, releaseCommit() { hold = false; release?.(); release = null; },
  holdHostSend() { holdHost = true; }, releaseHostSend() { holdHost = false; releaseHost?.(); releaseHost = null; },
  revokeAtHostDispatch() { revokeAtDispatch = true; }, connect: () => transport.connect(),
  failNextNavigation() { denyNavigation = true; }, setAuthMethod(value) { authMethod = value; generation++; render(); },
  setAgentMismatch(value) { agentMismatch = value; render(); },
  setAgentEnabled(value) { agentEnabled = value; render(); },
  setWorkspaceDirectory(value) { workspaceDirectory = value; render(); },
  currentUrl: () => locationValue.pathname + locationValue.search + locationValue.hash };
window.addEventListener('beforeunload', () => transport.close());
render();
