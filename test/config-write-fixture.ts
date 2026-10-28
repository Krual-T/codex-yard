import { createConfigWrites } from '../src/native/config-writes.ts';
import type { ConfigWriteConnection, ConfigWriteIdentity, ConfigWriteSubmission } from '../src/native/config-writes.ts';

interface Input extends ConfigWriteIdentity { params: Record<string, unknown>; connection: ConfigWriteConnection }
const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 4096 && !value.includes('\0');
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

export function createTestConfigWrites(options: Parameters<typeof createConfigWrites>[0]) {
  const writes = createConfigWrites(options);
  function submit(input: Input): Promise<ConfigWriteSubmission> {
    if (!input || !validId(input.operationId) || !validId(input.hostId)
      || input.method !== 'config/batchWrite' && input.method !== 'skills/config/write' || !record(input.params)
      || !input.connection || typeof input.connection.requestWithCursor !== 'function') return Promise.reject(new Error('Invalid configuration write request.'));
    const params = structuredClone(input.params), connection = input.connection, originalSocket = connection.socket;
    return writes.begin({ operationId: input.operationId, hostId: input.hostId, method: input.method }).then(async prepared => {
      if (prepared.outcome !== 'prepared') return prepared;
      if (!connection.connected || connection.socket !== originalSocket) return { outcome: 'not-started', operation: await prepared.notSent() };
      return prepared.start(params, connection);
    });
  }
  return { ...writes, submit };
}
