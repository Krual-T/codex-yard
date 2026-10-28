import type { WorkbenchClient } from '../workbench-contract.ts';

export interface VisualizationIdentity { hostId: string; threadId: string; path: string }
type AtomKind = 'visualization-state-v3' | 'visualization-interaction-state-v1';
type RecordValue = Record<string, unknown>;

const isRecord = (value: unknown): value is RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value);
const queues = new Map<string, Promise<void>>();

export function visualizationAtomKey(kind: AtomKind, identity: VisualizationIdentity): string {
  return `${kind}:${JSON.stringify([identity.hostId, identity.threadId])}`;
}

// The old renderer used a path identity shared by Windows, WSL and Unix paths.
export function visualizationPathKey(path: string): string {
  let value = path.replaceAll('\\', '/');
  if (/^\/\/\?\/UNC\//i.test(value)) value = `//${value.slice(8)}`;
  else if (/^\/\/\?\/[a-z]:\//i.test(value)) value = value.slice(4);
  const windows = value.match(/^\/?([a-z]):\/(.*)$/i);
  if (windows) return `win32:/mnt/${windows[1].toLowerCase()}/${windows[2]}`.replace(/\/$/, '').toLowerCase();
  const wsl = value.match(/^\/\/(?:wsl\$|wsl\.localhost)\/([^/]+)(\/.*)?$/i);
  if (wsl) {
    const rest = wsl[2] || '/';
    if (/^\/mnt\/[a-z](?:\/|$)/i.test(rest)) return `win32:${rest}`.replace(/\/$/, '').toLowerCase();
    return `wsl:${wsl[1].toLowerCase()}:${rest}`.replace(/\/$/, '');
  }
  if (/^\/\/[^/]+\/[^/]+/.test(value)) return `win32:${value}`.replace(/\/+$/, '').toLowerCase();
  return value.length > 1 ? value.replace(/\/+$/, '') : value;
}

function validateJson(value: unknown, limit: number): unknown {
  let serialized: string | undefined;
  try { serialized = JSON.stringify(value); } catch { throw new Error('Invalid visualization state'); }
  if (serialized === undefined || new TextEncoder().encode(serialized).byteLength > limit) throw new Error('Invalid visualization state');
  return JSON.parse(serialized) as unknown;
}

export function normalizeWidgetState(value: unknown): RecordValue {
  const clone = validateJson(value, 16_384);
  if (!isRecord(clone) || (clone.imageIds !== undefined && (!Array.isArray(clone.imageIds) || clone.imageIds.length !== 0))) {
    throw new Error('Invalid visualization state');
  }
  const state = { modelContent: null, privateContent: null, ...clone };
  validateJson(state, 16_384);
  return state;
}

function slot(map: RecordValue, identity: VisualizationIdentity): string {
  const key = visualizationPathKey(identity.path);
  const matches = Object.entries(map).filter(([, value]) => isRecord(value) && value.hostId === identity.hostId &&
    value.threadId === identity.threadId && typeof value.path === 'string' && visualizationPathKey(value.path) === key);
  if (matches.length > 1 || (matches.length === 1 && matches[0][0] !== key && Object.hasOwn(map, key))) {
    throw new Error('Conflicting visualization state was preserved');
  }
  if (matches.length === 1) return matches[0][0];
  if (Object.hasOwn(map, key)) throw new Error('Unrecognized visualization state was preserved');
  return key;
}

async function readMap(client: WorkbenchClient, key: string): Promise<RecordValue> {
  const result = await client.host<{ value?: unknown }>('get-persisted-atom', { key });
  if (result?.value === undefined) return {};
  if (!isRecord(result.value)) throw new Error('Unrecognized visualization state was preserved');
  return result.value;
}

async function locked<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const queued = previous.then(() => gate);
  queues.set(key, queued);
  await previous;
  try {
    const locks = globalThis.navigator?.locks;
    return locks ? await locks.request(`codex-yard-visualization:${key}`, operation) : await operation();
  } finally {
    release();
    if (queues.get(key) === queued) queues.delete(key);
  }
}

export async function readVisualizationState(client: WorkbenchClient, identity: VisualizationIdentity): Promise<RecordValue | null> {
  const map = await readMap(client, visualizationAtomKey('visualization-state-v3', identity));
  const key = slot(map, identity);
  if (!Object.hasOwn(map, key)) return null;
  const entry = map[key];
  if (!isRecord(entry) || !Object.hasOwn(entry, 'state')) throw new Error('Unrecognized visualization state was preserved');
  return normalizeWidgetState(entry.state);
}

export interface VisualizationModelContext { path: string; field: 'state' | 'interaction'; modelContent: unknown }

/** Read only model-visible fields for the host/thread. Values remain untrusted. */
export async function readVisualizationModelContext(client: WorkbenchClient, hostId: string, threadId: string): Promise<VisualizationModelContext[]> {
  const identity = { hostId, threadId, path: '' };
  const result: VisualizationModelContext[] = [];
  let size = 0;
  for (const kind of ['visualization-state-v3', 'visualization-interaction-state-v1'] as const) {
    const map = await readMap(client, visualizationAtomKey(kind, identity));
    for (const [key, entry] of Object.entries(map).slice(-100).sort(([a], [b]) => a.localeCompare(b))) {
      if (!isRecord(entry) || entry.hostId !== hostId || entry.threadId !== threadId || typeof entry.path !== 'string' || !entry.path || visualizationPathKey(entry.path) !== key) continue;
      let state: RecordValue;
      try { state = kind === 'visualization-state-v3' ? normalizeWidgetState(entry.state) : validateInteractionState(entry.state); } catch { continue; }
      const item: VisualizationModelContext = { path: entry.path, field: kind === 'visualization-state-v3' ? 'state' : 'interaction', modelContent: state.modelContent };
      size += new TextEncoder().encode(JSON.stringify(item)).byteLength;
      if (size > 131_072) return result;
      result.push(item);
    }
  }
  return result;
}

export async function writeVisualizationState(client: WorkbenchClient, identity: VisualizationIdentity, value: unknown, kind: AtomKind = 'visualization-state-v3'): Promise<void> {
  const state = kind === 'visualization-state-v3' ? normalizeWidgetState(value) : validateInteractionState(value);
  const key = visualizationAtomKey(kind, identity);
  await locked(key, async () => {
    const map = await readMap(client, key);
    const pathKey = slot(map, identity);
    const previous = map[pathKey];
    if (previous !== undefined && (!isRecord(previous) || !Object.hasOwn(previous, 'state'))) throw new Error('Unrecognized visualization state was preserved');
    if (isRecord(previous)) {
      if (kind === 'visualization-state-v3') normalizeWidgetState(previous.state);
      else validateInteractionState(previous.state);
    }
    const next = { ...(isRecord(previous) ? previous : {}), ...identity, state };
    const operation = previous === undefined ? { value: next, createOnly: true } : { value: next, expectedValue: previous };
    const result = await client.host<{ success?: boolean }>('set-persisted-atom', { key, recordUpdate: { entries: { [pathKey]: operation } } });
    if (result?.success === false) throw new Error('Could not save visualization state');
    const saved = await readMap(client, key);
    if (JSON.stringify(saved[pathKey]) !== JSON.stringify(next)) throw new Error('Visualization state changed concurrently; the existing value was preserved');
  });
}

function validateInteractionState(value: unknown): RecordValue {
  const state = validateJson(value, 32_768);
  if (!isRecord(state) || !Object.hasOwn(state, 'modelContent') || (state.modelContent !== null && !isRecord(state.modelContent))) {
    throw new Error('Invalid visualization interaction state');
  }
  return state;
}
