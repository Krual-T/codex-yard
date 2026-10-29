import { versionAtLeast } from '../../lib/codex-version.ts';
import { userConfigTarget } from '../renderer/settings/config-target.ts';

type Config = Record<string, unknown>;

export interface AgentConfigProjection {
  config: Config;
  yardAgentConfiguration: { base: Config | null; lockedKeys: string[]; supportsIndexedWebSearch: boolean };
}

const settings = {
  approval_policy: ['untrusted', 'on-failure', 'on-request', 'never'],
  sandbox_mode: ['read-only', 'workspace-write', 'danger-full-access'],
  web_search: ['disabled', 'cached', 'indexed', 'live'],
  model_verbosity: ['low', 'medium', 'high'],
  model_reasoning_summary: ['auto', 'concise', 'detailed', 'none'],
} as const;
const settingKeys = Object.keys(settings) as (keyof typeof settings)[];
const granularKeys = ['sandbox_approval', 'rules', 'skill_approval', 'request_permissions', 'mcp_elicitations'];
const managedTypes = new Set(['mdm', 'sessionFlags', 'legacyManagedConfigTomlFromFile', 'legacyManagedConfigTomlFromMdm']);
const networkKey = 'sandbox_workspace_write.network_access';
const isRecord = (value: unknown): value is Config => value !== null && typeof value === 'object' && !Array.isArray(value);

function granularApproval(value: unknown): Config | null {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !isRecord(value.granular)) return null;
  const granular = value.granular;
  if (Object.keys(granular).some(key => !granularKeys.includes(key) || typeof granular[key] !== 'boolean')) return null;
  return { granular: Object.fromEntries(granularKeys.filter(key => Object.hasOwn(granular, key)).map(key => [key, granular[key]])) };
}

function selectConfig(value: unknown): { config: Config; valid: boolean } {
  if (!isRecord(value)) return { config: {}, valid: false };
  const config: Config = {};
  let valid = true;
  for (const key of settingKeys) {
    if (!Object.hasOwn(value, key)) continue;
    const entry = value[key];
    if (entry === null || typeof entry === 'string' && (settings[key] as readonly string[]).includes(entry)) {
      config[key] = entry;
    } else if (key === 'approval_policy') {
      const granular = granularApproval(entry);
      if (granular) config[key] = granular; else valid = false;
    } else valid = false;
  }
  if (Object.hasOwn(value, 'sandbox_workspace_write') && value.sandbox_workspace_write != null) {
    const workspace = value.sandbox_workspace_write;
    if (!isRecord(workspace)) valid = false;
    else if (Object.hasOwn(workspace, 'network_access')) {
      if (typeof workspace.network_access === 'boolean') config.sandbox_workspace_write = { network_access: workspace.network_access };
      else valid = false;
    }
  }
  return { config, valid };
}

function knownVersion(version: string | null): boolean {
  if (version === null || !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(version)) return false;
  const prerelease = version.split('+', 1)[0]?.split('-').slice(1).join('-');
  return !prerelease?.split('.').some(part => /^\d+$/.test(part) && part.length > 1 && part.startsWith('0'));
}

function supportsIndexed(version: string | null): boolean {
  return knownVersion(version) && (version === '0.0.0' || versionAtLeast(version, 0, 142, 0, 6));
}

/** Project one raw config/read response using that same connection's home and version. */
export function projectAgentConfiguration(result: unknown, options: { codexHome: string | null; appServerVersion: string | null }): AgentConfigProjection {
  const response = isRecord(result) ? result : {};
  const effective = selectConfig(response.config);
  const origins = isRecord(response.origins) ? response.origins : null;
  const managed = (key: string) => {
    const origin = origins && Object.hasOwn(origins, key) ? origins[key] : null;
    return isRecord(origin) && isRecord(origin.name) && typeof origin.name.type === 'string' && managedTypes.has(origin.name.type);
  };
  const knownOrigins = [...settingKeys, 'sandbox_workspace_write', networkKey];
  const originsValid = origins && knownOrigins.every(key => {
    if (!Object.hasOwn(origins, key)) return true;
    const origin = origins[key];
    return isRecord(origin) && isRecord(origin.name) && typeof origin.name.type === 'string';
  });
  const lockedKeys: string[] = settingKeys.filter(managed);
  if (managed('sandbox_workspace_write') || managed(networkKey)) lockedKeys.push(networkKey);

  const layers = response.layers;
  let base: Config | null = null;
  if (effective.valid && originsValid && knownVersion(options.appServerVersion) && Array.isArray(layers)
    && layers.every(layer => isRecord(layer) && isRecord(layer.name) && typeof layer.name.type === 'string')) {
    const users = layers.filter(layer => isRecord(layer) && isRecord(layer.name) && layer.name.type === 'user');
    if (users.length === 1 && userConfigTarget(layers, options.codexHome).target) {
      const selected = selectConfig(users[0].config);
      if (selected.valid) base = selected.config;
    }
  }
  return { config: effective.config, yardAgentConfiguration: { base, lockedKeys, supportsIndexedWebSearch: supportsIndexed(options.appServerVersion) } };
}
