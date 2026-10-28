import type { WorkbenchClient } from '../src/renderer/workbench-contract.ts';
import { SettingsConfigOperations } from '../src/renderer/settings/config-operations.ts';
import type { SettingsWriteStorage } from '../src/renderer/settings/config-operations.ts';

export function fixtureOperations(client: WorkbenchClient): SettingsConfigOperations {
  let value: unknown;
  const listeners = new Set<() => void>();
  const storage: SettingsWriteStorage = {
    read: async () => structuredClone(value),
    update: async change => { value = structuredClone(change(structuredClone(value))); for (const listener of listeners) listener(); return structuredClone(value); },
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  let id = 0;
  return new SettingsConfigOperations(client, storage, () => `fixture-operation-${++id}`);
}

/** Simulates the host adapter around a synthetic CLI, including its original operation ID. */
export async function fixtureConfigurationHost(client: WorkbenchClient, input: Record<string, unknown>) {
  if (input.action !== 'submit' || typeof input.operationId !== 'string' || typeof input.hostId !== 'string'
    || typeof input.method !== 'string' || !input.params || typeof input.params !== 'object') throw new Error('Unexpected configuration host request');
  const result = await client.rpc<Record<string, unknown>>(input.method, input.params as Record<string, unknown>, input.hostId);
  const terminal = input.method === 'skills/config/write' ? { kind: 'effectiveEnabled', value: result.effectiveEnabled }
    : { kind: result.status };
  return { outcome: 'success', result, operation: { operationId: input.operationId, hostId: input.hostId,
    method: input.method, state: 'succeeded', terminal } };
}
