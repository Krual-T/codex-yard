import type { WorkbenchClient } from '../workbench-contract.ts';
import { listInstalledPlugins, prepareLocalPluginEnabled } from '../pages/plugins/catalog.ts';
import type { PluginSummary } from '../pages/plugins/catalog.ts';
import { WorkbenchError } from './client.ts';

interface ConfigSource { hostId: string; generation: string; homeDirectory: string; codexHome: string }
interface ConfigRecord {
  operationId: string; hostId: string; phase: 'pending' | 'unknown' | 'finished' | 'not-started' | 'blocked';
  origin: { section: string }; operation?: { state: string; storageError?: true };
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

export function pluginConfigRecords(snapshot: ConfigSnapshot, hostId: string): ConfigRecord[] {
  return snapshot.records.filter(entry => entry.hostId === hostId && entry.origin.section === 'plugins-settings');
}

export async function writePluginConfig(operations: ProductConfigurationWrites | undefined, client: WorkbenchClient,
  value: { hostId: string; cwd: string; plugin: PluginSummary; enabled: boolean }, current: () => boolean): Promise<void> {
  if (!operations) throw new WorkbenchError('Plugin settings cannot be saved on this host. Try again after configuration recovery is available.', false);
  let prepared: Awaited<ReturnType<typeof prepareLocalPluginEnabled>>;
  try { prepared = await prepareLocalPluginEnabled(client, value.hostId, value.plugin, value.enabled); }
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
    const inventory = await listInstalledPlugins(client, value.hostId, value.cwd);
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
  hostId: string, cwd: string, current: () => boolean): Promise<void> {
  await operations.refresh();
  let snapshot = operations.getSnapshot();
  if (snapshot.error) throw new Error(snapshot.error);
  let entries = pluginConfigRecords(snapshot, hostId);
  if (!entries.length) throw new Error('The original plugin operation is not available for verification.');
  for (const entry of entries) {
    if (!current()) throw new DOMException('The selected page changed.', 'AbortError');
    if (snapshot.inFlight.includes(entry.operationId)) throw new Error('The original plugin save is still in progress.');
    if (entry.phase === 'pending' || entry.phase === 'unknown' || entry.phase === 'blocked') await operations.check(entry.operationId);
  }
  await operations.refresh(); snapshot = operations.getSnapshot(); entries = pluginConfigRecords(snapshot, hostId);
  if (snapshot.error || entries.some(entry => entry.phase === 'pending' || entry.phase === 'unknown' || entry.phase === 'blocked' || entry.operation?.storageError)) {
    throw new Error(snapshot.error || 'The original plugin save still needs confirmation.');
  }
  if (!current()) throw new DOMException('The selected page changed.', 'AbortError');
  await listInstalledPlugins(client, hostId, cwd);
  for (const entry of entries) {
    if (!current()) throw new DOMException('The selected page changed.', 'AbortError');
    await operations.finish(entry.operationId);
  }
}
