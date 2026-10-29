import { createRoot } from 'react-dom/client';
import { BrowserWorkbenchClient } from '../src/renderer/app/client.ts';
import { ProductWorkspace } from '../src/renderer/app/ProductWorkspace.tsx';
import type { ProductWorkspaceProps } from '../src/renderer/app/ProductWorkspace.tsx';
import type { ProductPagesClient } from '../src/renderer/app/ProductPages.tsx';
import type { ProductRouteOwner } from '../src/renderer/app/ProductRoutePage.tsx';
import type { ProductConfigurationWrites } from '../src/renderer/app/ProductPluginConfig.ts';

declare global {
  interface Window {
    productWorkspaceConfiguration?: ProductConfigurationWrites;
    productWorkspaceHarness: {
      calls: { kind: string; value?: unknown }[];
      show(path: string, state?: unknown): void;
      ownerGeneration(): number;
      failNavigation(): void;
      status(): Promise<unknown>;
    };
  }
}

const client = new BrowserWorkbenchClient() as ProductPagesClient;
const root = createRoot(document.getElementById('root')!);
const calls: { kind: string; value?: unknown }[] = [];
let route = { pathname: '/skills', search: '', hash: '', state: null as unknown };
let locationKey = 0, authorityKey = 1, hostId = 'local', failNavigation = false;
client.subscribe(event => {
  if (event.type === 'mcp-notification' && event.method === 'account/updated' && event.hostId === hostId) {
    authorityKey++; render();
  }
});
const isCurrent = (owner: Pick<ProductRouteOwner, 'hostId' | 'authorityKey' | 'locationKey'>) =>
  owner.hostId === hostId && owner.authorityKey === authorityKey && owner.locationKey === locationKey;
function navigate(path: string, options: { replace?: boolean; state?: unknown } | undefined, owner: ProductRouteOwner) {
  if (!isCurrent(owner)) return Promise.resolve(false);
  if (failNavigation) { failNavigation = false; throw new Error('Synthetic navigation failure'); }
  calls.push({ kind: 'navigate', value: { path, options } });
  show(path, options?.state); return Promise.resolve(true);
}
function show(path: string, state: unknown = null) {
  const url = new URL(path, location.origin); history.pushState(state, '', url);
  const nextHost = url.searchParams.get('hostId') ?? 'local';
  if (hostId !== nextHost) { hostId = nextHost; authorityKey++; }
  route = { pathname: url.pathname, search: url.search, hash: url.hash, state };
  locationKey++; render();
}
function render() {
  const props: ProductWorkspaceProps = {
    client, location: route, hostId, cwd: hostId === 'local' ? '/fixture/project' : '/remote/project', authorityKey, locationKey, isCurrent, navigate,
    renderUnresolved: (_route, reason) => <div data-testid="unresolved">{reason}</div>, firstRunVariant: 'apiKey',
    onAuthenticated: async owner => { if (!isCurrent(owner)) throw new Error('Stale owner'); calls.push({ kind: 'authenticated' }); },
    onFirstRunContinue: async owner => { if (!isCurrent(owner)) throw new Error('Stale owner'); calls.push({ kind: 'first-run' }); },
    workspace: {
      async onCommitSelection(owner, roots) {
        if (!isCurrent(owner) || roots.length !== 1) throw new Error('Cannot commit these roots');
        const project = await client.host<{ project?: { id?: unknown } }>('project-add', { hostId: owner.hostId, path: roots[0], name: 'Fixture project' });
        if (typeof project.project?.id !== 'string') throw new Error('Project receipt missing');
        calls.push({ kind: 'project-saved', value: project.project }); return true;
      },
      async onComplete(owner) { if (!await navigate('/skills', undefined, owner)) throw new Error('Navigation was not completed.'); },
    },
    projects: { hasUnresolvedChanges: false, onOpenThread: async (owner, thread) => { if (!isCurrent(owner)) throw new Error('Stale owner'); calls.push({ kind: 'open-thread', value: thread }); } },
    plan: { cwd: '/fixture/project' },
    onOpenFile: (owner, value) => { if (isCurrent(owner)) calls.push({ kind: 'open-file', value }); },
    onTrySkill: async (owner, value) => { if (!isCurrent(owner)) throw new Error('Stale owner'); calls.push({ kind: 'try-skill', value }); },
    configurationWrites: window.productWorkspaceConfiguration,
  };
  root.render(<ProductWorkspace {...props} />);
}
window.productWorkspaceHarness = {
  calls, show, ownerGeneration: () => authorityKey,
  failNavigation() { failNavigation = true; },
  status: () => client.rpc('getAuthStatus', { includeToken: true, refreshToken: false }, 'local'),
};
render();
