import type { WorkbenchClient } from '../workbench-contract.ts';

export type CatalogKind = 'skills-settings' | 'hooks-settings' | 'mcp-settings' | 'plugins-settings';
export interface CatalogItem { id: string; name: string; detail: string; status: string }
export interface CatalogPage { items: CatalogItem[]; warnings: string[]; nextCursor: string | null }
interface EntryError { path?: string; message: string }
interface Skill { name: string; description: string; path: string; scope: string; enabled: boolean }
interface Hook { key: string; eventName: string; matcher: string | null; handlerType: string; enabled: boolean; isManaged: boolean }
interface McpServer { name: string; runtimeStatus?: string | null; authStatus: string; tools?: Record<string, unknown>; toolsError?: string | null }
interface Plugin { id: string; name: string; installed: boolean; enabled: boolean; interface?: { displayName?: string | null; shortDescription?: string | null } | null }
interface Marketplace { name: string; plugins: Plugin[] }

const messages = (errors: EntryError[] | undefined) => (errors ?? []).map(error => [error.path, error.message].filter(Boolean).join(': '));
export async function readCatalog(client: WorkbenchClient, hostId: string, kind: CatalogKind, cwd: string, cursor: string | null): Promise<CatalogPage> {
  if (kind === 'skills-settings') {
    const result = await client.rpc<{ data: { cwd: string; skills: Skill[]; errors: EntryError[] }[] }>('skills/list',
      { cwds: cwd ? [cwd] : [], forceReload: false }, hostId);
    if (!Array.isArray(result?.data)) throw new Error('Invalid skills response');
    return { items: result.data.flatMap(group => (group.skills ?? []).map(skill => ({ id: `${group.cwd}:${skill.path}`, name: skill.name,
      detail: `${skill.description} (${skill.scope})`, status: skill.enabled ? 'Enabled' : 'Disabled' }))),
    warnings: result.data.flatMap(group => messages(group.errors)), nextCursor: null };
  }
  if (kind === 'hooks-settings') {
    const result = await client.rpc<{ data: { cwd: string; hooks: Hook[]; warnings: string[]; errors: EntryError[] }[] }>('hooks/list',
      { cwds: cwd ? [cwd] : [] }, hostId);
    if (!Array.isArray(result?.data)) throw new Error('Invalid hooks response');
    return { items: result.data.flatMap(group => (group.hooks ?? []).map(hook => ({ id: `${group.cwd}:${hook.key}`, name: hook.eventName,
      detail: [hook.matcher, hook.handlerType, hook.isManaged ? 'Managed' : ''].filter(Boolean).join(' | '), status: hook.enabled ? 'Enabled' : 'Disabled' }))),
    warnings: result.data.flatMap(group => [...(group.warnings ?? []), ...messages(group.errors)]), nextCursor: null };
  }
  if (kind === 'mcp-settings') {
    const result = await client.rpc<{ data: McpServer[]; nextCursor?: string | null }>('mcpServerStatus/list', { cursor, limit: 100 }, hostId);
    if (!Array.isArray(result?.data)) throw new Error('Invalid MCP server response');
    return { items: result.data.map(server => ({ id: server.name, name: server.name,
      detail: server.toolsError || `${Object.keys(server.tools ?? {}).length} tools`, status: server.runtimeStatus ?? server.authStatus ?? 'Unknown' })),
    warnings: [], nextCursor: result.nextCursor ?? null };
  }
  const result = await client.rpc<{ marketplaces: Marketplace[]; marketplaceLoadErrors: { marketplacePath: string; message: string }[] }>('plugin/installed',
    { cwds: cwd ? [cwd] : null }, hostId);
  if (!Array.isArray(result?.marketplaces)) throw new Error('Invalid installed plugins response');
  return { items: result.marketplaces.flatMap(marketplace => (marketplace.plugins ?? []).filter(plugin => plugin.installed).map(plugin => ({
    id: `${marketplace.name}:${plugin.id}`, name: plugin.interface?.displayName || plugin.name,
    detail: [plugin.interface?.shortDescription, marketplace.name].filter(Boolean).join(' | '), status: plugin.enabled ? 'Enabled' : 'Disabled',
  }))), warnings: (result.marketplaceLoadErrors ?? []).map(error => `${error.marketplacePath}: ${error.message}`), nextCursor: null };
}
