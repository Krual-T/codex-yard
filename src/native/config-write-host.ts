import type { ConfigWriteStatus, ConfigurationWriteError, ConfigurationWriteRequest, ConfigurationWriteResponse,
  ConfigurationWriteRetryResponse, ConfigurationWriteSubmitResponse } from '../../lib/config-write-protocol.ts';
import type { ConfigWriteConnection, ConfigWriteIdentity, createConfigWrites } from './config-writes.ts';

type SubmitRequest = Extract<ConfigurationWriteRequest, { action: 'submit' }>;
type Writes = ReturnType<typeof createConfigWrites>;

interface Options<Context> {
  writes: Writes;
  validateHost(hostId: string, context: Context): void | Promise<void>;
  connect(hostId: string, context: Context): Promise<ConfigWriteConnection>;
}

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 4096 && !value.includes('\0');

function parseRequest(value: unknown): ConfigurationWriteRequest {
  if (!record(value) || !validId(value.hostId) || !validId(value.operationId)) throw new Error('Invalid configuration write request.');
  const { hostId, operationId, action } = value;
  if (action === 'status' || action === 'retry-persistence') return { hostId, operationId, action };
  if (action !== 'submit' || value.method !== 'config/batchWrite' && value.method !== 'skills/config/write'
    || !record(value.params) || Object.hasOwn(value.params, 'operationId')) throw new Error('Invalid configuration write request.');
  try { return { hostId, operationId, action, method: value.method, params: structuredClone(value.params) }; }
  catch { throw new Error('Invalid configuration write request.'); }
}

function outcomeCode(operation: ConfigWriteStatus): number | 'OBSERVER_LIMIT' | undefined {
  const terminal = operation.terminal ?? operation.observedTerminal;
  return terminal?.kind === 'rejected' || terminal?.kind === 'not-sent' ? terminal.code : undefined;
}

function safeError(message: string, uncertain: boolean, code?: number | 'OBSERVER_LIMIT'): ConfigurationWriteError {
  return { message, uncertain, ...(code === undefined ? {} : { code }) };
}

/** Host adapter for the existing configuration write fence. */
export function createConfigWriteHost<Context>(options: Options<Context>) {
  const preparing = new Map<string, { hostId: string; method: SubmitRequest['method']; promise: Promise<ConfigurationWriteSubmitResponse> }>();

  async function preflight(identity: ConfigWriteIdentity) {
    try { return await options.writes.preflight(identity); }
    catch { throw new Error('Cannot verify the configuration operation identity or records.'); }
  }

  async function status(hostId: string, operationId: string): Promise<ConfigWriteStatus | null> {
    let operation: ConfigWriteStatus | null;
    try { operation = await options.writes.status(operationId); }
    catch { throw new Error('Cannot read the configuration operation.'); }
    if (operation && operation.hostId !== hostId) throw new Error('The configuration operation belongs to another host.');
    return operation;
  }

  async function runSubmit(request: SubmitRequest, context: Context): Promise<ConfigurationWriteSubmitResponse> {
    const { operationId, hostId, method, params } = request;
    const prior = await preflight(request);
    if (prior) return prior;
    let submitted;
    try {
      const connection = await options.connect(hostId, context);
      submitted = await options.writes.submit({ operationId, hostId, method, params, connection });
    } catch {
      const recovered = await preflight(request);
      if (recovered) return recovered;
      return { outcome: 'not-started', error: { message: 'The configuration write could not be prepared.', uncertain: false } };
    }
    if (submitted.outcome !== 'started') return submitted;
    let completion;
    try { completion = await submitted.completion; }
    catch {
      let operation: ConfigWriteStatus;
      try { operation = await status(hostId, operationId) ?? { ...submitted.operation, state: 'unknown' }; }
      catch { operation = { ...submitted.operation, state: 'unknown' }; }
      return { outcome: 'unknown', error: safeError('The original configuration write could not be confirmed.', true), operation };
    }
    const operation = completion.operation;
    if (completion.outcome === 'success') return { outcome: 'success', result: completion.response.result, operation };
    const terminal = operation.terminal ?? operation.observedTerminal;
    const code = outcomeCode(operation);
    if (completion.outcome === 'error' && terminal?.kind === 'not-sent') {
      return { outcome: 'not-started', error: { ...safeError('The configuration write was not sent.', false, code), uncertain: false }, operation };
    }
    return completion.outcome === 'error'
      ? { outcome: 'error', error: safeError('The configuration write was rejected.', false, code), operation }
      : { outcome: 'unknown', error: safeError('The original configuration write could not be confirmed.', true), operation };
  }

  function submit(request: SubmitRequest, context: Context): Promise<ConfigurationWriteSubmitResponse> {
    const previous = preparing.get(request.operationId);
    if (previous) {
      if (previous.hostId !== request.hostId || previous.method !== request.method) {
        return Promise.reject(new Error('The configuration operation belongs to another host or method.'));
      }
      return previous.promise.then(async response => {
        if (response.outcome === 'blocked' || response.outcome === 'not-started' && !response.operation) return response;
        const operation = await status(request.hostId, request.operationId);
        if (!operation) throw new Error('The original configuration operation is unavailable.');
        return { outcome: 'existing' as const, operation };
      });
    }
    const promise = runSubmit(request, context);
    preparing.set(request.operationId, { hostId: request.hostId, method: request.method, promise });
    return promise.finally(() => {
      if (preparing.get(request.operationId)?.promise === promise) preparing.delete(request.operationId);
    });
  }

  async function retry(hostId: string, operationId: string): Promise<ConfigurationWriteRetryResponse> {
    const current = await status(hostId, operationId);
    if (!current?.storageError) return { operation: current };
    try { return { operation: await options.writes.retryTerminalSave(operationId) }; }
    catch {
      const operation = await status(hostId, operationId);
      const terminal = operation?.terminal ?? operation?.observedTerminal;
      return { operation, error: safeError('The original configuration write status could not be saved.', !terminal) };
    }
  }

  async function handle(value: unknown, context: Context): Promise<ConfigurationWriteResponse> {
    const request = parseRequest(value);
    try { await options.validateHost(request.hostId, context); }
    catch { throw new Error('The selected configuration host is unavailable or unauthorized.'); }
    if (request.action === 'submit') return submit(request, context);
    if (request.action === 'status') return { operation: await status(request.hostId, request.operationId) };
    return retry(request.hostId, request.operationId);
  }

  return { handle };
}
