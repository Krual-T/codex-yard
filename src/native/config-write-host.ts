import type { ConfigReadSource, ConfigWriteErrorCategory, ConfigWriteReceipt, ConfigWriteStatus, ConfigurationWriteError, ConfigurationWriteRequest,
  ConfigurationWriteResponse, ConfigurationWriteRetryResponse, ConfigurationWriteSubmitResponse } from '../../lib/config-write-protocol.ts';
import type { ConfigWriteConnection, createConfigWrites } from './config-writes.ts';

type SubmitRequest = Extract<ConfigurationWriteRequest, { action: 'submit' }>;
type ParsedSubmit = Omit<SubmitRequest, 'source'> & { source: ConfigReadSource | null };
type ParsedRequest = Exclude<ConfigurationWriteRequest, { action: 'submit' }> | ParsedSubmit;
type Writes = ReturnType<typeof createConfigWrites>;
interface Options<Context> {
  writes: Writes;
  validateHost(hostId: string, context: Context): void | Promise<void>;
  connect(hostId: string, context: Context, source: ConfigReadSource): Promise<{ connection: ConfigWriteConnection; socket: unknown }>;
}
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 4096 && !value.includes('\0');

function readSource(value: unknown, hostId: string): ConfigReadSource | null {
  if (!record(value) || value.hostId !== hostId || !validId(value.generation)
    || !validId(value.homeDirectory) || !validId(value.codexHome)) return null;
  return { hostId, generation: value.generation, homeDirectory: value.homeDirectory, codexHome: value.codexHome };
}

function parseRequest(value: unknown): ParsedRequest {
  if (!record(value) || !validId(value.hostId) || !validId(value.operationId)) throw new Error('Invalid configuration write request.');
  const { hostId, operationId, action } = value;
  if (action === 'status') return { hostId, operationId, action };
  if (action === 'retry-persistence') return { hostId, operationId, action,
    ...(value.receipt === undefined ? {} : { receipt: value.receipt as ConfigWriteReceipt }) };
  if (action !== 'submit' || value.method !== 'config/batchWrite' && value.method !== 'skills/config/write'
    || !record(value.params) || Object.hasOwn(value.params, 'operationId')) throw new Error('Invalid configuration write request.');
  try { return { hostId, operationId, action, method: value.method, params: structuredClone(value.params), source: readSource(value.source, hostId) }; }
  catch { throw new Error('Invalid configuration write request.'); }
}

function safeError(message: string, uncertain: boolean, code?: number | 'OBSERVER_LIMIT', category?: ConfigWriteErrorCategory): ConfigurationWriteError {
  return { message, uncertain, ...(code === undefined ? {} : { code }), ...(category === undefined ? {} : { category }) };
}
const categoryMessages: Record<ConfigWriteErrorCategory, string> = {
  configVersionConflict: 'The configuration changed since it was read. Reload it before saving again.',
  configValidationError: 'The configuration was rejected as invalid. Review the submitted values.',
  configLayerReadonly: 'The selected configuration layer is read-only.',
};

/** Host adapter for the existing configuration write fence. */
export function createConfigWriteHost<Context>(options: Options<Context>) {
  async function status(hostId: string, operationId: string): Promise<ConfigWriteStatus | null> {
    let operation: ConfigWriteStatus | null;
    try { operation = await options.writes.status(operationId); }
    catch { throw new Error('Cannot read the configuration operation.'); }
    if (operation && operation.hostId !== hostId) throw new Error('The configuration operation belongs to another host.');
    return operation;
  }

  async function submit(request: ParsedSubmit, context: Context, hostAllowed: boolean): Promise<ConfigurationWriteSubmitResponse> {
    const { operationId, hostId, method, params, source } = request;
    let prepared;
    try { prepared = await options.writes.begin({ operationId, hostId, method }); }
    catch { throw new Error('Cannot verify the configuration operation identity or records; it may belong to another host or method.'); }
    if (prepared.outcome === 'existing' || prepared.outcome === 'blocked') {
      if (!hostAllowed) throw new Error('The selected configuration host is unavailable or unauthorized.');
      return prepared;
    }
    if (prepared.outcome === 'not-started') return { outcome: 'not-started', operation: prepared.operation,
      error: { message: 'The configuration write could not be prepared.', uncertain: false } };
    if (!hostAllowed || !source) {
      const operation = await prepared.notSent();
      return { outcome: 'not-started', operation, error: { message: hostAllowed
        ? 'The original configuration source is unavailable or invalid. Reload the settings before saving.'
        : 'The selected configuration host is unavailable or unauthorized.', uncertain: false } };
    }
    let connection: ConfigWriteConnection;
    try {
      const selected = await options.connect(hostId, context, source);
      connection = selected.connection;
      if (!selected.socket || !connection?.connected || connection.socket !== selected.socket) throw new Error('Configuration source changed.');
    }
    catch {
      const operation = await prepared.notSent();
      return { outcome: 'not-started', operation, error: { message: 'The original configuration source is unavailable or changed. Reload the settings before saving.', uncertain: false } };
    }
    let submitted;
    try { submitted = await prepared.start(params, connection); }
    catch {
      let operation: ConfigWriteStatus;
      try { operation = await status(hostId, operationId) ?? { ...prepared.operation, state: 'unknown' }; }
      catch { operation = { ...prepared.operation, state: 'unknown' }; }
      return { outcome: 'unknown', error: safeError('The original configuration write could not be confirmed.', true), operation };
    }
    if (submitted.outcome === 'existing' || submitted.outcome === 'blocked') return submitted;
    if (submitted.outcome === 'not-started') return { outcome: 'not-started', operation: submitted.operation,
      error: { message: 'The configuration write could not be prepared or its target is blocked.', uncertain: false } };
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
    if (completion.outcome === 'error' && terminal?.kind === 'not-sent') {
      return { outcome: 'not-started', error: { ...safeError('The configuration write was not sent.', false, terminal.code), uncertain: false }, operation };
    }
    if (completion.outcome === 'error') {
      const rejected = terminal?.kind === 'rejected' ? terminal : undefined;
      return { outcome: 'error', error: safeError(rejected?.category ? categoryMessages[rejected.category] : 'The configuration write was rejected.',
        false, rejected?.code, rejected?.category), operation };
    }
    return { outcome: 'unknown', error: safeError('The original configuration write could not be confirmed.', true), operation };
  }

  async function retry(hostId: string, operationId: string, receipt?: ConfigWriteReceipt): Promise<ConfigurationWriteRetryResponse> {
    const current = await status(hostId, operationId);
    if (!current && receipt !== undefined) throw new Error('The original configuration receipt cannot be verified.');
    if (!current || !current.storageError && !current.interrupted && receipt === undefined) return { operation: current };
    try { return { operation: await options.writes.retryTerminalSave(operationId, receipt) }; }
    catch {
      const operation = await status(hostId, operationId);
      const terminal = operation?.terminal ?? operation?.observedTerminal;
      return { operation, error: safeError('The original configuration receipt could not be verified or saved.', !terminal) };
    }
  }

  async function handle(value: unknown, context: Context): Promise<ConfigurationWriteResponse> {
    const request = parseRequest(value);
    if (request.action === 'status') return { operation: await status(request.hostId, request.operationId) };
    if (request.action === 'retry-persistence') return retry(request.hostId, request.operationId, request.receipt);
    let hostAllowed = true;
    try { await options.validateHost(request.hostId, context); }
    catch { hostAllowed = false; }
    return submit(request, context, hostAllowed);
  }
  return { handle };
}
