export type ObjectValue = Record<string, unknown>;
export type RequestId = string | number;
export interface RpcRequest { id: RequestId; method: string; params?: ObjectValue | null }
export interface RpcReply { id: RequestId; result?: unknown; error?: { code: number; message: string; data?: unknown } }
export interface SidebarBootstrap {
  catalogEntries: unknown[];
  globalStateEntries: { key: string; value?: unknown }[];
  workspaceRootOptions: { roots: string[]; canonicalPathByRoot: Record<string, string> };
  projectlessWorkspaceRoot: { workspaceRoot: string };
}
export interface HostMessage extends ObjectValue {
  type: string;
  hostId?: string;
  requestId?: string;
  url?: string;
  params?: ObjectValue;
  request?: RpcRequest;
  response?: RpcReply & { method?: string }; // Worker replies also match the method.
}
export function record(value: unknown): ObjectValue {
  return value != null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {};
}

export function updatedAtom(previous: unknown, message: ObjectValue): unknown {
  if (!message.recordUpdate) return message.value;
  const update = record(message.recordUpdate), value = { ...record(previous) };
  const equal = (a: unknown, b: unknown): boolean => {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
    const left = a as ObjectValue, right = b as ObjectValue;
    return Object.keys(left).length === Object.keys(right).length && Object.keys(left).every(key => Object.hasOwn(right, key) && equal(left[key], right[key]));
  };
  const time = (entry: unknown) => typeof update.timestampField === 'string' ? Number(record(entry)[update.timestampField] || 0) : 0;
  // Native app-initial's jwt record-update contract: entries contain operations,
  // including compare-before-write, create/update-only and retention limits.
  for (const [key, operation] of Object.entries(record(update.entries))) {
    const entry = record(operation);
    if (entry.expectedValue !== undefined && !equal(value[key], entry.expectedValue)) continue;
    if (operation == null || 'delete' in entry) { delete value[key]; continue; }
    if (entry.createOnly && Object.hasOwn(value, key) || time(value[key]) > time(entry.value)) continue;
    if (entry.updateOnly && !Object.hasOwn(value, key)) continue;
    if (!entry.updateOnly) delete value[key];
    Object.defineProperty(value, key, { configurable: true, enumerable: true, writable: true, value: entry.value });
  }
  if (typeof update.maxEntries === 'number') {
    const keys = Object.keys(value);
    if (update.timestampField != null) keys.sort((a, b) => time(value[a]) - time(value[b]));
    for (const key of keys.slice(0, Math.max(0, keys.length - update.maxEntries))) delete value[key];
  }
  if (typeof update.maxBytes === 'number') {
    let bytes = 2;
    for (const [key, entry] of Object.entries(value).reverse()) {
      const size = new TextEncoder().encode(JSON.stringify({ [key]: entry })).length - 2;
      const total = bytes + size + Number(bytes > 2 && size > 0);
      if (total > update.maxBytes) delete value[key]; else bytes = total;
    }
  }
  if (typeof update.minNumericValue === 'number') {
    for (const [key, entry] of Object.entries(value)) if (typeof entry === 'number' && entry < update.minNumericValue) delete value[key];
  }
  return value;
}

// config/read includes credentials and environment variables. Expose session
// settings and the selected profile name used by the native model selector.
const sessionKeys = ['model', 'model_provider', 'model_reasoning_effort', 'profile', 'approval_policy',
  'sandbox_mode', 'service_tier', 'approvals_reviewer', 'default_permissions'];
export function publicConfig(result: unknown) {
  const config = record(record(result).config);
  // The renderer gates its Connections page on this capability. Yard owns the
  // SSH transport and catalog; advertising it does not edit the CLI's config.
  return { config: { ...Object.fromEntries(sessionKeys.filter(key => key in config).map(key => [key, config[key]])),
    features: { remote_connections: true } }, origins: {}, layers: null };
}

export const readMethods = new Set([
  'config/read', 'configRequirements/read', 'account/read', 'account/gatewayOAuth/read', 'getAuthStatus', 'model/list',
  'thread/list', 'thread/read', 'thread/turns/list', 'thread/items/list', 'thread/loaded/list',
  'thread/search', 'thread/searchOccurrences', 'thread/timeline/list',
  'thread/goal/get', 'thread/queue/list', 'thread/metadata/read', 'thread/attachment/list', 'thread/attachmentOwner/list',
  'project/list', 'project/read', 'threadSection/list',
  'skills/list', 'mcpServerStatus/list', 'collaborationMode/list', 'permissionProfile/list',
  'experimentalFeature/list', 'app/list', 'app/read', 'app/installed', 'plugin/installed', 'plugin/list', 'plugin/read',
  'plugin/search', 'plugin/skill/read', 'plugin/share/list', 'mcpServer/resource/read',
  'account/rateLimits/read', 'fuzzyFileSearch',
  'remoteControl/status/read',
  'hooks/list', 'externalAgentConfig/import/readHistories',
]);

export const writeMethods = new Set([
  'config/batchWrite', 'config/value/write', 'config/mcpServer/reload', 'skills/config/write',
  'marketplace/add', 'marketplace/remove', 'marketplace/upgrade',
  'plugin/install', 'plugin/uninstall', 'plugin/reconcile',
  'plugin/share/save', 'plugin/share/updateTargets', 'plugin/share/checkout', 'plugin/share/delete',
  'mcpServer/oauth/login', 'mcpServer/tool/call', 'mcpServer/event/stream/start', 'mcpServer/event/stream/stop',
  'thread/start', 'thread/fork', 'thread/inject_items', 'thread/resume', 'thread/unsubscribe', 'thread/name/set', 'thread/archive', 'thread/unarchive',
  'thread/rollback', 'thread/revert', 'thread/compact/start', 'thread/readState/update', 'thread/settings/update', 'thread/delete',
  'thread/backgroundTerminals/clean', 'thread/memoryMode/set', 'thread/metadata/update',
  'turn/start', 'turn/steer', 'turn/interrupt', 'turn/settings/update',
  'fuzzyFileSearch/sessionStart', 'fuzzyFileSearch/sessionUpdate', 'fuzzyFileSearch/sessionStop',
  'thread/queue/add', 'thread/queue/delete', 'thread/queue/update', 'thread/queue/reorder', 'thread/queue/start',
  'thread/goal/set', 'thread/goal/clear', 'thread/goal/update',
  'thread/attachment/add', 'thread/attachment/remove',
  'project/create', 'project/import', 'project/update', 'project/move', 'project/delete',
  'threadSection/create', 'threadSection/update', 'threadSection/delete', 'thread/section/move',
]);
