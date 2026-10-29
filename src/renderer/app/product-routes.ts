export interface ProductLocation {
  pathname: string;
  search: string;
  hash: string;
  state: unknown;
}

type Located<T> = T & { location: ProductLocation };

export type ProductRoute = Located<
  | { kind: 'skills' | 'plugins' | 'agents' | 'agent-create' | 'login' | 'first-run' | 'select-workspace' | 'plan-summary' | 'inbox' }
  | { kind: 'projects'; projectId: string | null }
  | { kind: 'legacy-project'; projectId: string }
  | { kind: 'agent-detail' | 'agent-edit'; agentId: string }
  | { kind: 'automations'; path: '/automations' | '/scheduled'; view: string | null; automationId: string | null; automationMode: string | null;
      automationSource: string | null; automationTeamId: string | null; automationDraftId: string | null; automationEditing: boolean;
      runId: string | null; sharedTask: string | null; shareDialog: boolean }
  | { kind: 'redirect'; to: '/' | '/dots/home' }
  | { kind: 'other' }
  | { kind: 'invalid'; message: string }
>;

/** Parse only known product paths; preserve the original location for every branch. */
export function readProductRoute(location: ProductLocation): ProductRoute {
  const pathname = location.pathname.length > 1 ? location.pathname.replace(/\/+$/, '') : location.pathname;
  const search = new URLSearchParams(location.search);
  switch (pathname) {
    case '/skills': return { kind: 'skills', location };
    case '/plugins': return { kind: 'plugins', location };
    case '/projects': return { kind: 'projects', projectId: search.get('projectId'), location };
    case '/agents': return { kind: 'agents', location };
    case '/agents/studio/new': return { kind: 'agent-create', location };
    case '/automations':
    case '/scheduled':
      return { kind: 'automations', path: pathname, view: search.get('view'), automationId: search.get('automationId'), automationMode: search.get('automationMode'),
        automationSource: search.get('automationSource'), automationTeamId: search.get('automationTeamId'), automationDraftId: search.get('automationDraftId'),
        automationEditing: search.get('edit') === 'true' || search.get('edit_modal') === 'true' || search.get('automationMode') === 'edit',
        runId: search.get('runId'), sharedTask: search.get('shared_task'), shareDialog: search.get('share_dialog') === 'true', location };
    case '/inbox': return { kind: 'inbox', location };
    case '/explore':
    case '/mission-control': return { kind: 'redirect', to: '/', location };
    case '/dots': return { kind: 'redirect', to: '/dots/home', location };
    case '/login': return { kind: 'login', location };
    case '/first-run': return { kind: 'first-run', location };
    case '/select-workspace': return { kind: 'select-workspace', location };
    case '/plan-summary': return { kind: 'plan-summary', location };
  }
  const legacyProject = /^\/g\/([^/]+)\/project$/i.exec(pathname);
  if (legacyProject) {
    let value = legacyProject[1]!;
    try { value = decodeURIComponent(value); } catch { /* The original route retains malformed escapes. */ }
    const parts = value.split('-');
    if (parts.length > 1 && parts[0] === 'g') value = parts[1] === 'p' ? `g-p-${parts[2]}` : `g-${parts[1]}`;
    return { kind: 'legacy-project', projectId: value, location };
  }
  const match = /^\/agents\/(a|studio\/edit)\/([^/]+)$/.exec(pathname);
  if (match) {
    try {
      const agentId = decodeURIComponent(match[2]!);
      if (!agentId) return { kind: 'invalid', message: 'Missing agent ID.', location };
      return { kind: match[1] === 'a' ? 'agent-detail' : 'agent-edit', agentId, location };
    } catch { return { kind: 'invalid', message: 'Invalid agent ID encoding.', location }; }
  }
  return { kind: 'other', location };
}
