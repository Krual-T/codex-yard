import type { WorkbenchClient } from '../workbench-contract.ts';
import { listInstalledPlugins, prepareLocalPluginEnabled } from '../pages/plugins/catalog.ts';
import type { PluginSummary } from '../pages/plugins/catalog.ts';
import { WorkbenchError } from './client.ts';

interface ConfigSource { hostId: string; generation: string; homeDirectory: string; codexHome: string }
interface ConfigRecord {
  operationId: string; hostId: string; phase: 'pending' | 'unknown' | 'finished' | 'not-started' | 'blocked';
  origin: { section: string; scope?: readonly string[]; draft?: unknown; source?: ConfigSource };
  operation?: { state: string; storageError?: true };
}
interface ConfigSnapshot { records: ConfigRecord[]; loading: boolean; error: string | null; inFlight: string[] }

/** The shared settings controller owns operation identity, persistence and recovery. */
export interface ProductConfigurationWrites {
  subscribe(listener: () => void): () => void;
  getSnapshot(): ConfigSnapshot;
  refresh(): Promise<void>;
  submit(hostId: string, method: 'config/batchWrite', params: Record<string, unknown>, origin: {
    section: 'plugins-settings'; scope?: readonly string[]; draft: unknown; source: ConfigSource;
  }, canDispatch: () => boolean): Promise<{ operationId: string; result: unknown }>;
  check(operationId: string): Promise<void>;
  finish(operationId: string): Promise<void>;
  finishSuccessfulGroup(operationIds: readonly string[]): Promise<void>;
}

export const emptyConfigSnapshot: ConfigSnapshot = { records: [], loading: false, error: null, inFlight: [] };
export const emptyConfigSubscribe = () => () => {};
export const getEmptyConfigSnapshot = () => emptyConfigSnapshot;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

function sourceFor(value: unknown, hostId: string): ConfigSource | null {
  if (!object(value) || value.hostId !== hostId || typeof value.generation !== 'string' || !value.generation
    || typeof value.homeDirectory !== 'string' || !value.homeDirectory || typeof value.codexHome !== 'string' || !value.codexHome) return null;
  return { hostId, generation: value.generation, homeDirectory: value.homeDirectory, codexHome: value.codexHome };
}

export function pluginConfigRecords(snapshot: ConfigSnapshot, hostId: string, cwd?: string, pluginId?: string): ConfigRecord[] {
  return snapshot.records.filter(entry => entry.hostId === hostId && entry.origin.section === 'plugins-settings'
    && (cwd === undefined || entry.origin.scope?.length === 1 && entry.origin.scope[0] === cwd)
    && (pluginId === undefined || object(entry.origin.draft) && entry.origin.draft.pluginId === pluginId));
}

export async function writePluginConfig(operations: ProductConfigurationWrites | undefined, client: WorkbenchClient,
  value: { hostId: string; cwd: string; plugin: PluginSummary; enabled: boolean }, current: () => boolean): Promise<void> {
  if (!operations) throw new WorkbenchError('Plugin settings cannot be saved on this host. Try again after configuration recovery is available.', false);
  const assertCurrent = () => { if (!current()) throw new DOMException('The selected page changed.', 'AbortError'); };
  assertCurrent();
  let prepared: Awaited<ReturnType<typeof prepareLocalPluginEnabled>>;
  try { prepared = await prepareLocalPluginEnabled(client, value.hostId, value.plugin, value.enabled, { assertBeforeSend: assertCurrent }); }
  catch (error) { throw new WorkbenchError(error instanceof Error ? error.message : String(error), false); }
  const source = sourceFor(prepared.source, value.hostId);
  if (!source) throw new WorkbenchError('The original configuration source is unavailable. Reload and try again.', false);
  if (!current()) throw new DOMException('The selected page changed.', 'AbortError');
  let received = false;
  try {
    const submitted = await operations.submit(value.hostId, 'config/batchWrite', prepared.params, {
      section: 'plugins-settings', scope: [value.cwd], source,
      draft: { pluginId: value.plugin.id, enabled: value.enabled },
    }, current);
    received = true;
    if (!object(submitted.result) || submitted.result.status !== 'ok' && submitted.result.status !== 'okOverridden') {
      throw new Error('The configuration receipt could not be verified.');
    }
    if (!current()) throw new Error('The selected page changed after the save. Check the original operation.');
    const inventory = await listInstalledPlugins(client, value.hostId, value.cwd, { assertBeforeSend: assertCurrent });
    const matches = inventory.entries.filter(entry => entry.plugin.id === value.plugin.id && entry.plugin.source.type === value.plugin.source.type);
    if (matches.length !== 1 || matches[0]!.plugin.enabled !== value.enabled) throw new Error('The saved plugin state differs from the current inventory.');
    if (!current()) throw new Error('The selected page changed after the save. Check the original operation.');
    await operations.finishSuccessfulGroup([submitted.operationId]);
  } catch (error) {
    const notSent = !received && error instanceof Error && 'uncertain' in error && error.uncertain === false;
    throw new WorkbenchError(error instanceof Error ? error.message : String(error), !notSent);
  }
}

export async function reconcilePluginConfig(operations: ProductConfigurationWrites, client: WorkbenchClient,
  hostId: string, cwd: string, current: () => boolean, operationId?: string): Promise<void> {
  const assertCurrent = () => { if (!current()) throw new DOMException('The selected page changed.', 'AbortError'); };
  assertCurrent();
  await operations.refresh();
  let snapshot = operations.getSnapshot();
  if (snapshot.error) throw new Error(snapshot.error);
  const entries = pluginConfigRecords(snapshot, hostId, cwd).filter(entry => operationId === undefined || entry.operationId === operationId);
  if (entries.length !== 1) throw new Error(entries.length
    ? 'Choose the original plugin operation in configuration recovery.' : 'The original plugin operation is not available for this scope.');
  const original = entries[0]!, origin = JSON.stringify(original.origin);
  if (!sourceFor(original.origin.source, hostId) || !object(original.origin.draft)
    || typeof original.origin.draft.pluginId !== 'string' || typeof original.origin.draft.enabled !== 'boolean') {
    throw new Error('Review the preserved original plugin edit in configuration recovery.');
  }
  const { pluginId, enabled } = original.origin.draft;
  assertCurrent();
  if (snapshot.inFlight.includes(original.operationId)) throw new Error('The original plugin save is still in progress.');
  if (original.phase === 'pending' || original.phase === 'unknown' || original.phase === 'blocked') await operations.check(original.operationId);
  await operations.refresh(); snapshot = operations.getSnapshot();
  const entry = pluginConfigRecords(snapshot, hostId, cwd).find(item => item.operationId === original.operationId);
  if (snapshot.error || !entry || JSON.stringify(entry.origin) !== origin || snapshot.inFlight.includes(original.operationId)
    || entry.phase === 'pending' || entry.phase === 'unknown' || entry.phase === 'blocked' || entry.operation?.storageError) {
    throw new Error(snapshot.error || 'The original plugin save still needs confirmation.');
  }
  assertCurrent();
  if (entry.phase !== 'finished' || entry.operation?.state !== 'succeeded') {
    throw new Error('The original plugin edit was not saved. Review the preserved edit in configuration recovery.');
  }
  const inventory = await listInstalledPlugins(client, hostId, cwd, { assertBeforeSend: assertCurrent });
  const matches = inventory.entries.filter(item => item.plugin.id === pluginId);
  if (matches.length !== 1 || matches[0]!.plugin.enabled !== enabled) throw new Error('The saved plugin state differs from the original edit.');
  assertCurrent();
  await operations.finishSuccessfulGroup([original.operationId]);
}
