import type { WorkbenchClient } from '../../workbench-contract.ts';

export interface PluginSummary {
  id: string; name: string; installed: boolean; enabled: boolean; installPolicy: string;
  source: { type: string }; availability?: string; disabledReason?: string | null;
  interface?: { displayName?: string | null; shortDescription?: string | null; longDescription?: string | null; logoUrl?: string | null } | null;
}
export interface PluginEntry { marketplaceName: string; marketplacePath: string | null; plugin: PluginSummary }
export interface PluginCatalog { entries: PluginEntry[]; warnings: string[] }
export interface PluginPage { entries: PluginEntry[]; nextCursor: string | null }
export interface PluginPublicSection { id: string; title: string; categorySlug: string | null; entries: PluginEntry[] }
export interface PluginRef { pluginName: string; marketplacePath?: string; remoteMarketplaceName?: string }
export interface PluginChangeScope { hostId: string; cwd: string; accountKey: string | null }
export type PluginChange = PluginChangeScope & (
  | { kind: 'install'; ref: PluginRef }
  | { kind: 'uninstall'; pluginId: string }
  | { kind: 'setEnabled'; pluginId: string; sourceType: string; enabled: boolean }
  | { kind: 'addMarketplace'; source: string; refName: string | null }
);
export interface PluginApp { id: string; name: string; description?: string | null }
export interface PluginSkill { name: string; description: string; enabled: boolean; path?: string | null }
export interface PluginDetail {
  summary: PluginSummary; description?: string | null; marketplaceName: string; marketplacePath?: string | null;
  apps: PluginApp[]; skills: PluginSkill[]; mcpServers: string[]; hooks: { key: string; eventName: string }[];
  scheduledTasks?: { key: string; name: string; prompt: string }[] | null;
}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function summary(value: unknown): PluginSummary {
  if (!object(value) || typeof value.id !== 'string' || !value.id || typeof value.name !== 'string'
    || typeof value.installed !== 'boolean' || typeof value.enabled !== 'boolean' || typeof value.installPolicy !== 'string'
    || !object(value.source) || typeof value.source.type !== 'string') throw new Error('Invalid plugin in response');
  if (value.interface != null && (!object(value.interface) || ['displayName', 'shortDescription', 'longDescription', 'logoUrl']
    .some(key => (value.interface as Record<string, unknown>)[key] != null && typeof (value.interface as Record<string, unknown>)[key] !== 'string'))) {
    throw new Error('Invalid plugin interface');
  }
  return value as unknown as PluginSummary;
}

function catalog(value: unknown): PluginCatalog {
  if (!object(value) || !Array.isArray(value.marketplaces)) throw new Error('Invalid plugin catalog response');
  const entries = value.marketplaces.flatMap((marketplace: unknown) => {
    if (!object(marketplace) || typeof marketplace.name !== 'string' || !Array.isArray(marketplace.plugins)
      || marketplace.path != null && typeof marketplace.path !== 'string') throw new Error('Invalid marketplace in response');
    return marketplace.plugins.map((plugin: unknown) => ({ marketplaceName: marketplace.name as string,
      marketplacePath: typeof marketplace.path === 'string' ? marketplace.path : null, plugin: summary(plugin) }));
  });
  const warnings = value.marketplaceLoadErrors;
  if (warnings != null && (!Array.isArray(warnings) || warnings.some(warning => !object(warning)
    || typeof warning.marketplacePath !== 'string' || typeof warning.message !== 'string'))) throw new Error('Invalid marketplace errors');
  return { entries, warnings: (warnings ?? []).map((warning: { marketplacePath: string; message: string }) => `${warning.marketplacePath}: ${warning.message}`) };
}

export async function listPlugins(client: WorkbenchClient, hostId: string, cwd: string, refresh: boolean): Promise<PluginCatalog> {
  return catalog(await client.rpc('plugin/list', {
    ...(cwd ? { cwds: [cwd] } : {}),
    ...(refresh ? { forceRefetch: true } : {}),
  }, hostId));
}

export function pluginPage(value: unknown): PluginPage {
  if (!object(value) || !Array.isArray(value.entries) || value.nextCursor != null && (typeof value.nextCursor !== 'string' || !value.nextCursor)) {
    throw new Error('Invalid plugin page');
  }
  const entries = value.entries.map((entry: unknown) => {
    if (!object(entry) || typeof entry.marketplaceName !== 'string' || !entry.marketplaceName
      || entry.marketplacePath != null && typeof entry.marketplacePath !== 'string') throw new Error('Invalid plugin entry');
    return { marketplaceName: entry.marketplaceName, marketplacePath: typeof entry.marketplacePath === 'string' ? entry.marketplacePath : null, plugin: summary(entry.plugin) };
  });
  return { entries, nextCursor: typeof value.nextCursor === 'string' ? value.nextCursor : null };
}

export function pluginPublicSections(value: unknown): PluginPublicSection[] {
  if (!Array.isArray(value)) throw new Error('Invalid public plugin sections');
  const seen = new Set<string>();
  return value.map(section => {
    if (!object(section) || typeof section.id !== 'string' || !section.id || seen.has(section.id)
      || typeof section.title !== 'string' || !section.title || section.categorySlug != null
      && (typeof section.categorySlug !== 'string' || !section.categorySlug)) throw new Error('Invalid public plugin section');
    seen.add(section.id);
    return { id: section.id, title: section.title, categorySlug: typeof section.categorySlug === 'string' ? section.categorySlug : null,
      entries: pluginPage({ entries: section.entries, nextCursor: null }).entries };
  });
}

export async function searchPlugins(client: WorkbenchClient, hostId: string, cwd: string, searchTerm: string, scope: 'global' | 'personal' | 'workspace', cursor: string | null): Promise<PluginPage> {
  const response = await client.rpc<{ data?: unknown; nextCursor?: unknown }>('plugin/search', {
    searchTerm, scope, cursor, limit: 50, ...(cwd ? { cwds: [cwd] } : {}),
  }, hostId);
  return pluginPage({ entries: response?.data, nextCursor: response?.nextCursor });
}

export async function listInstalledPlugins(client: WorkbenchClient, hostId: string, cwd: string): Promise<PluginCatalog> {
  return catalog(await client.rpc('plugin/installed', cwd ? { cwds: [cwd] } : {}, hostId));
}

export function pluginRef(entry: PluginEntry): PluginRef {
  return { pluginName: entry.plugin.name, ...(entry.marketplacePath ? { marketplacePath: entry.marketplacePath } : { remoteMarketplaceName: entry.marketplaceName }) };
}

export async function readPlugin(client: WorkbenchClient, hostId: string, ref: PluginRef): Promise<PluginDetail> {
  if (!!ref.marketplacePath === !!ref.remoteMarketplaceName || !ref.pluginName) throw new Error('A single plugin marketplace source is required');
  const response = await client.rpc<{ plugin?: unknown }>('plugin/read', { ...ref }, hostId);
  if (!object(response?.plugin)) throw new Error('Invalid plugin details');
  const value = response.plugin;
  summary(value.summary);
  if (typeof value.marketplaceName !== 'string' || !Array.isArray(value.apps) || !Array.isArray(value.skills)
    || !Array.isArray(value.mcpServers) || !Array.isArray(value.hooks)
    || value.description != null && typeof value.description !== 'string'
    || value.scheduledTasks != null && (!Array.isArray(value.scheduledTasks) || value.scheduledTasks.some(task => !object(task)
      || typeof task.key !== 'string' || typeof task.name !== 'string' || typeof task.prompt !== 'string'))
    || value.apps.some(app => !object(app) || typeof app.id !== 'string' || typeof app.name !== 'string')
    || value.skills.some(skill => !object(skill) || typeof skill.name !== 'string' || typeof skill.description !== 'string' || typeof skill.enabled !== 'boolean')
    || value.mcpServers.some(server => typeof server !== 'string')
    || value.hooks.some(hook => !object(hook) || typeof hook.key !== 'string' || typeof hook.eventName !== 'string')) throw new Error('Invalid plugin details');
  return value as unknown as PluginDetail;
}

export async function installPlugin(client: WorkbenchClient, hostId: string, ref: PluginRef): Promise<PluginApp[]> {
  const value = await client.rpc<{ appsNeedingAuth?: unknown; authPolicy?: unknown }>('plugin/install', { ...ref }, hostId);
  if (!Array.isArray(value?.appsNeedingAuth) || !['ON_INSTALL', 'ON_USE'].includes(String(value.authPolicy))
    || value.appsNeedingAuth.some(app => !object(app) || typeof app.id !== 'string' || typeof app.name !== 'string')) throw new Error('Invalid plugin installation response');
  return value.appsNeedingAuth as PluginApp[];
}

export async function uninstallPlugin(client: WorkbenchClient, hostId: string, pluginId: string): Promise<void> {
  const value = await client.rpc('plugin/uninstall', { pluginId }, hostId);
  if (!object(value)) throw new Error('Invalid plugin uninstall response');
}

export async function prepareLocalPluginEnabled(client: WorkbenchClient, hostId: string, plugin: PluginSummary, enabled: boolean): Promise<{ params: Record<string, unknown>; source: unknown }> {
  if (plugin.source.type === 'remote') throw new Error('Remote plugins require workspace enablement');
  const config = await client.rpc<{ layers?: unknown; yardConfigSource?: unknown }>('config/read', { includeLayers: true }, hostId);
  if (!config || !Object.hasOwn(config, 'layers')) throw new Error('Configuration layers are unavailable');
  if (config?.layers != null && !Array.isArray(config.layers)) throw new Error('Invalid configuration layers');
  const layers = (config?.layers ?? []) as unknown[];
  const userLayers = layers.filter(value => object(value) && object(value.name) && value.name.type === 'user');
  const user = userLayers.at(-1);
  if (user != null && (!object(user) || !object(user.name) || typeof user.name.file !== 'string' || typeof user.version !== 'string')) {
    throw new Error('Cannot determine the user configuration version');
  }
  const layer = user as { name: { file: string }; version: string } | undefined;
  return { params: {
    edits: [{ keyPath: `plugins.${plugin.id}.enabled`, value: enabled, mergeStrategy: 'upsert' }],
    filePath: layer?.name.file ?? null, expectedVersion: layer?.version ?? null, reloadUserConfig: true,
  }, source: config.yardConfigSource };
}

export async function setLocalPluginEnabled(client: WorkbenchClient, hostId: string, plugin: PluginSummary, enabled: boolean): Promise<void> {
  const { params } = await prepareLocalPluginEnabled(client, hostId, plugin, enabled);
  const result = await client.rpc<{ status?: unknown }>('config/batchWrite', params, hostId);
  if (result?.status !== 'ok' && result?.status !== 'okOverridden') throw new Error('Invalid configuration write response');
}

export async function addMarketplace(client: WorkbenchClient, hostId: string, source: string, refName: string): Promise<void> {
  const result = await client.rpc<{ marketplaceName?: unknown; installedRoot?: unknown; alreadyAdded?: unknown }>('marketplace/add', {
    source, refName: refName || null,
  }, hostId);
  if (typeof result?.marketplaceName !== 'string' || typeof result.installedRoot !== 'string' || typeof result.alreadyAdded !== 'boolean') {
    throw new Error('Invalid marketplace response');
  }
}
