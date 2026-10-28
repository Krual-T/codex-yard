import type { WorkbenchClient } from '../workbench-contract.ts';
import { pluginRoute } from './routing.ts';
import type { SettingsRoute } from './routing.ts';
import { validScopePath } from './scope.ts';

interface PluginSummary {
  id: string; name: string; remotePluginId?: string | null; installed: boolean; enabled: boolean;
  version?: string | null; localVersion?: string | null; availability?: string | null; disabledReason?: string | null;
  interface?: { displayName?: string | null; shortDescription?: string | null; longDescription?: string | null; developerName?: string | null } | null;
}
interface Marketplace { name: string; path?: string | null; interface?: { displayName?: string | null } | null; plugins: PluginSummary[] }
interface PluginResponse { marketplaces: Marketplace[]; marketplaceLoadErrors?: { marketplacePath: string; message: string }[] }
export interface PluginSource { pluginName: string; marketplacePath: string | null; remoteMarketplaceName: string | null }
export interface PluginEntry { summary: PluginSummary; marketplace: string; marketplaceLabel: string; source: PluginSource | null }
export interface PluginListing { entries: PluginEntry[]; warnings: string[] }
export interface PluginDetail {
  marketplaceName: string; summary: PluginSummary; description: string | null;
  skills: { name: string; description: string; enabled: boolean }[];
  hooks: { key: string; eventName: string }[];
  apps: { id: string; name: string; description: string | null }[];
  appTemplates: { templateId: string; name: string; description: string | null }[];
  mcpServers: string[]; scheduledTasks: { key: string; name: string }[] | null;
}

const optionalString = (value: unknown) => value == null || typeof value === 'string';
function validSummary(value: PluginSummary): boolean {
  return !!value && typeof value.id === 'string' && !!value.id && typeof value.name === 'string' && !!value.name
    && typeof value.installed === 'boolean' && typeof value.enabled === 'boolean'
    && [value.remotePluginId, value.version, value.localVersion, value.availability, value.disabledReason].every(optionalString)
    && (value.interface == null || typeof value.interface === 'object' && [value.interface.displayName, value.interface.shortDescription,
      value.interface.longDescription, value.interface.developerName].every(optionalString));
}
export async function readPlugins(client: WorkbenchClient, hostId: string, cwds: readonly string[], directory: boolean): Promise<PluginListing> {
  if (!cwds.length || !cwds.every(validScopePath)) throw new Error('Select a project or session with a working directory.');
  const params = { cwds };
  const result = await client.rpc<PluginResponse>(directory ? 'plugin/list' : 'plugin/installed', params, hostId);
  if (!Array.isArray(result?.marketplaces) || result.marketplaces.some(marketplace => !marketplace || typeof marketplace.name !== 'string' || !marketplace.name
    || !(typeof marketplace.path === 'string' && !!marketplace.path || marketplace.path == null) || !Array.isArray(marketplace.plugins)
    || marketplace.interface != null && (typeof marketplace.interface !== 'object' || !optionalString(marketplace.interface.displayName))
    || marketplace.plugins.some(plugin => !validSummary(plugin))) || result.marketplaceLoadErrors != null
    && (!Array.isArray(result.marketplaceLoadErrors) || result.marketplaceLoadErrors.some(error => !error || typeof error.marketplacePath !== 'string' || typeof error.message !== 'string')))
    throw new Error('Invalid plugin catalog response');
  const entries = result.marketplaces.flatMap(marketplace => marketplace.plugins.filter(plugin => directory || plugin.installed).map(summary => {
    const source: PluginSource | null = marketplace.path != null
      ? { marketplacePath: marketplace.path, remoteMarketplaceName: null, pluginName: summary.name }
      : summary.remotePluginId ? { marketplacePath: null, remoteMarketplaceName: marketplace.name, pluginName: summary.remotePluginId } : null;
    return { summary, marketplace: marketplace.name, marketplaceLabel: marketplace.interface?.displayName || marketplace.name, source };
  }));
  return { entries, warnings: (result.marketplaceLoadErrors ?? []).map(error => `${error.marketplacePath}: ${error.message}`) };
}
export async function readPlugin(client: WorkbenchClient, hostId: string, source: PluginSource): Promise<PluginDetail> {
  const params = source.marketplacePath !== null
    ? { marketplacePath: source.marketplacePath, pluginName: source.pluginName }
    : { remoteMarketplaceName: source.remoteMarketplaceName, pluginName: source.pluginName };
  const result = await client.rpc<{ plugin: PluginDetail }>('plugin/read', params, hostId);
  const plugin = result?.plugin;
  if (!plugin || typeof plugin.marketplaceName !== 'string' || !optionalString(plugin.description) || !validSummary(plugin.summary)
    || !Array.isArray(plugin.skills) || !Array.isArray(plugin.hooks) || !Array.isArray(plugin.apps)
    || !Array.isArray(plugin.appTemplates) || !Array.isArray(plugin.mcpServers)
    || !(plugin.scheduledTasks == null || Array.isArray(plugin.scheduledTasks))
    || plugin.skills.some(skill => !skill || typeof skill.name !== 'string' || typeof skill.description !== 'string' || typeof skill.enabled !== 'boolean')
    || plugin.hooks.some(hook => !hook || typeof hook.key !== 'string' || typeof hook.eventName !== 'string')
    || plugin.apps.some(app => !app || typeof app.id !== 'string' || typeof app.name !== 'string' || !optionalString(app.description))
    || plugin.appTemplates.some(app => !app || typeof app.templateId !== 'string' || typeof app.name !== 'string' || !optionalString(app.description))
    || plugin.mcpServers.some(server => typeof server !== 'string')
    || plugin.scheduledTasks?.some(task => !task || typeof task.key !== 'string' || typeof task.name !== 'string')) throw new Error('Invalid plugin details response');
  return { ...plugin, scheduledTasks: plugin.scheduledTasks ?? null };
}
export function pluginSource(search: string): PluginSource | null {
  const params = new URLSearchParams(search);
  const pluginName = params.get('pluginName')?.trim(), path = params.get('marketplacePath')?.trim(), remote = params.get('remoteMarketplaceName')?.trim();
  if (!pluginName && !path && !remote) return null;
  if (!pluginName || !!path === !!remote) throw new Error('The plugin address does not identify a single marketplace');
  return { pluginName, marketplacePath: path || null, remoteMarketplaceName: remote || null };
}
export function pluginsPath(route: SettingsRoute, directory: boolean): string {
  const params = new URLSearchParams(route.search);
  for (const key of ['pluginName', 'marketplacePath', 'remoteMarketplaceName']) params.delete(key);
  params.delete('host');
  if (route.hostId === route.baseHost) params.delete('hostId'); else params.set('hostId', route.hostId);
  if (directory) params.set('directory', '1'); else params.delete('directory');
  const search = params.toString();
  return `/settings/plugins-settings${search ? `?${search}` : ''}`;
}
export function pluginDetailPath(route: SettingsRoute, entry: PluginEntry): string {
  if (!entry.source) throw new Error('This plugin has no readable marketplace source');
  const params = new URLSearchParams(route.search);
  for (const key of ['pluginName', 'marketplacePath', 'remoteMarketplaceName', 'host', 'hostId']) params.delete(key);
  params.set('pluginName', entry.source.pluginName);
  if (entry.source.marketplacePath !== null) params.set('marketplacePath', entry.source.marketplacePath);
  else if (entry.source.remoteMarketplaceName !== null) params.set('remoteMarketplaceName', entry.source.remoteMarketplaceName);
  return `/settings/plugins-settings/hosts/${encodeURIComponent(route.hostId)}/plugins/${encodeURIComponent(entry.summary.id)}?${params}`;
}
export async function resolvePluginSource(client: WorkbenchClient, route: SettingsRoute, cwds: readonly string[]): Promise<PluginSource> {
  const identity = pluginRoute(route.pathname);
  if (!identity) throw new Error('The plugin address is invalid');
  const source = pluginSource(route.search);
  if (source) return source;
  const listing = await readPlugins(client, identity.hostId, cwds, false);
  const matches = listing.entries.filter(entry => entry.summary.id === identity.pluginId);
  if (matches.length !== 1 || !matches[0].source) throw new Error('The plugin marketplace could not be identified. Return to Plugins and refresh.');
  return matches[0].source;
}
