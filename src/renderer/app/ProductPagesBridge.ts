import { BrowserHttpFetch } from '../../native/browser-http-fetch.ts';

type Read =
  | { kind: 'account-access' }
  | { kind: 'projects' }
  | { kind: 'plugin-home' }
  | { kind: 'personal-plugins'; section: 'user' | 'workspace-created' | 'shared' | 'workspace'; cursor: string | null }
  | { kind: 'plugin-category'; slug: string; query: string; cursor: string | null }
  | { kind: 'agents'; view: 'recent' | 'owned' | 'directory'; query: string; cursor: string | null }
  | { kind: 'agent-detail' | 'agent-builder'; agentId: string };

/** Preserve the original request and bridge error; this bridge cannot prove account ownership. */
export async function readProductBridge(read: Read, isCurrent: () => boolean, signal?: AbortSignal): Promise<never> {
  if (!isCurrent() || signal?.aborted) throw new DOMException('The selected page changed.', 'AbortError');
  const url = new URL('https://chatgpt.com/backend-api/');
  const params = url.searchParams;
  switch (read.kind) {
    case 'account-access':
      url.pathname += 'wham/accounts/check';
      break;
    case 'projects':
      url.pathname += 'gizmos/snorlax/sidebar';
      params.set('conversations_per_gizmo', '0'); params.set('limit', '20'); params.set('owned_only', 'false');
      break;
    case 'plugin-home':
      url.pathname += 'ps/plugins/home';
      break;
    case 'personal-plugins':
      url.pathname += read.section === 'workspace-created' ? 'ps/plugins/workspace/created' :
        read.section === 'shared' ? 'ps/plugins/workspace/shared' : 'ps/plugins/list';
      if (read.section === 'user' || read.section === 'workspace') params.set('scope', read.section === 'user' ? 'USER' : 'WORKSPACE');
      params.set('limit', '50');
      if (read.cursor) params.set('pageToken', read.cursor);
      break;
    case 'plugin-category':
      url.pathname += `ps/plugin-categories/${encodeURIComponent(read.slug)}/plugins`;
      params.set('scope', 'GLOBAL'); if (read.query) params.set('q', read.query);
      params.set('limit', '50'); if (read.cursor) params.set('pageToken', read.cursor);
      break;
    case 'agents':
      url.pathname += read.view === 'directory' ? `hermes/workspace-store/agents${read.query ? '/search' : ''}` : 'hermes/agents';
      if (read.view !== 'directory') params.set('list_type', read.view === 'recent' ? 'used' : 'created');
      else if (read.query) params.set('query', read.query);
      params.set('limit', '50'); if (read.cursor) params.set('cursor', read.cursor);
      break;
    case 'agent-detail': case 'agent-builder':
      url.pathname += `hermes/agent/${encodeURIComponent(read.agentId)}/${read.kind === 'agent-detail' ? 'detail-view' : 'builder-view'}`;
      break;
  }
  const bridge = new BrowserHttpFetch();
  const id = crypto.randomUUID();
  const cancel = () => bridge.cancel(id);
  const plugin = read.kind === 'plugin-home' || read.kind === 'personal-plugins' || read.kind === 'plugin-category';
  const pending = bridge.fetch(id, { url: url.href, method: 'GET', ...(plugin ? { headers: {
    'OAI-Product-Sku': 'CONNECTOR_SETTING', 'X-Codex-Surface': 'plugin_directory',
  } } : {}) });
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const result = await pending;
    if (!isCurrent() || signal?.aborted) throw new DOMException('The selected page changed.', 'AbortError');
    if ('error' in result) throw new Error(result.error);
    await result.response.body?.cancel();
    if (!result.response.ok) throw new Error(`The product request failed (${result.response.status}).`);
    throw new Error('The response cannot be associated with the selected host and account.');
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
}
