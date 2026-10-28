import { posix, win32 } from 'node:path';
import { RpcError } from '../../lib/codex.ts';
import type { LateRpcTerminal, RequestOptions, RpcResult } from '../../lib/codex-protocol.ts';
import type { ConfigWriteMethod, ConfigWriteRecord, ConfigWriteState, ConfigWriteStatus, ConfigWriteTerminal } from '../../lib/config-write-protocol.ts';
import type { StateMutations } from './state-mutations.ts';

export type { ConfigWriteMethod, ConfigWriteRecord, ConfigWriteState, ConfigWriteStatus, ConfigWriteTerminal } from '../../lib/config-write-protocol.ts';

export interface ConfigWriteConnection {
  readonly connected: boolean;
  readonly socket: unknown;
  readonly server?: { codexHome?: string } | null;
  requestWithCursor(method: string, params?: unknown, options?: RequestOptions): Promise<RpcResult<unknown>>;
}

export interface ConfigWriteIdentity {
  operationId: string;
  hostId: string;
  method: ConfigWriteMethod;
}

export interface ConfigWriteInput extends ConfigWriteIdentity {
  params: Record<string, unknown>;
  connection: ConfigWriteConnection;
}

export type ConfigWriteTargetInput = Omit<ConfigWriteInput, 'operationId'>;

export interface ConfigWriteTarget {
  hostKey: string;
  target: string;
  binding: string;
  scope?: 'global';
}

interface ConfigWritesOptions {
  state: Record<string, unknown>;
  persist(): Promise<unknown>;
  mutations: StateMutations;
  /** The host verifies the physical host, actual file and the path used by the daemon. */
  resolveTarget(input: ConfigWriteTargetInput): Promise<ConfigWriteTarget>;
}

export type ConfigWriteCompletion =
  | { outcome: 'success'; response: RpcResult<unknown>; operation: ConfigWriteStatus; persistenceError?: unknown }
  | { outcome: 'error' | 'unknown'; error: unknown; operation: ConfigWriteStatus; persistenceError?: unknown };

export type ConfigWriteSubmission =
  | { outcome: 'blocked' | 'existing'; operation: ConfigWriteStatus }
  | { outcome: 'started'; operation: ConfigWriteStatus; completion: Promise<ConfigWriteCompletion> };
export type ConfigWritePreflight = { outcome: 'blocked' | 'existing'; operation: ConfigWriteStatus } | null;

const stateKey = 'configWriteOperations';
type Observation = { state: 'unknown' } | { state: 'succeeded' | 'failed'; terminal: ConfigWriteTerminal };
const methods = new Set<ConfigWriteMethod>(['config/batchWrite', 'skills/config/write']);
const states = new Set<ConfigWriteState>(['pending', 'unknown', 'succeeded', 'failed']);
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 4096 && !value.includes('\0');
const active = (value: ConfigWriteRecord) => value.state === 'pending' || value.state === 'unknown';

function absoluteTarget(value: unknown): string {
  if (validId(value) && (/^[a-z]:[\\/]|^\\\\/i.test(value) ? win32.isAbsolute(value) : posix.isAbsolute(value))) return value;
  throw new Error('The actual configuration target is unavailable.');
}

function normalizedTarget(value: unknown): string {
  const path = absoluteTarget(value);
  return /^[a-z]:[\\/]|^\\\\/i.test(path) ? win32.normalize(path) : posix.normalize(path);
}

function terminalForResult(method: ConfigWriteMethod, result: unknown): ConfigWriteTerminal | null {
  if (!record(result)) return null;
  if (method === 'config/batchWrite' && (result.status === 'ok' || result.status === 'okOverridden')) return { kind: result.status };
  if (method === 'skills/config/write' && typeof result.effectiveEnabled === 'boolean') return { kind: 'effectiveEnabled', value: result.effectiveEnabled };
  return null;
}

function rejected(code: unknown): ConfigWriteTerminal | null {
  if (typeof code === 'number' && Number.isSafeInteger(code)) return { kind: 'rejected', code };
  return validId(code) ? { kind: 'rejected' } : null;
}

function terminalForError(error: unknown): ConfigWriteTerminal | null {
  if (!(error instanceof RpcError) || error.uncertain) return null;
  if (error.status === 503) return { kind: 'not-sent', ...(error.code === 'OBSERVER_LIMIT' ? { code: 'OBSERVER_LIMIT' as const } : {}) };
  if (error.message === 'Codex 返回了无效错误。') return null;
  return rejected(error.code);
}

function validTerminal(value: unknown, method: ConfigWriteMethod, state: ConfigWriteState): boolean {
  if (!record(value)) return false;
  if (state === 'succeeded') {
    return method === 'config/batchWrite' && (value.kind === 'ok' || value.kind === 'okOverridden')
      || method === 'skills/config/write' && value.kind === 'effectiveEnabled' && typeof value.value === 'boolean';
  }
  if (state !== 'failed') return false;
  return value.kind === 'rejected' && (value.code === undefined || typeof value.code === 'number' && Number.isSafeInteger(value.code))
    || value.kind === 'not-sent' && (value.code === undefined || value.code === 'OBSERVER_LIMIT');
}

/** Uses the existing native-state commit interval; it does not replay writes. */
export function createConfigWrites(options: ConfigWritesOptions) {
  const live = new Set<string>();
  const observed = new Map<string, Observation>();
  const preparing = new Map<string, { hostId: string; method: ConfigWriteMethod; promise: Promise<ConfigWriteSubmission> }>();

  function records(): ConfigWriteRecord[] {
    const raw = options.state[stateKey];
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) throw new Error('Configuration write records cannot be read; writes are blocked.');
    const ids = new Set<string>(), targets = new Set<string>(), bindings = new Set<string>();
    const activeHosts = new Set<string>(), aliasedHosts = new Set<string>();
    let activeCount = 0, globalActive = false;
    for (const value of raw) {
      if (!record(value) || !validId(value.operationId) || !validId(value.hostId) || !validId(value.hostKey)
        || !validId(value.target) || !validId(value.binding) || !states.has(value.state as ConfigWriteState)
        || value.scope !== undefined && value.scope !== 'global'
        || value.method !== undefined && !methods.has(value.method as ConfigWriteMethod)) {
        throw new Error('Configuration write records cannot be read; writes are blocked.');
      }
      const state = value.state as ConfigWriteState, method = value.method as ConfigWriteMethod | undefined;
      if (method === undefined ? value.terminal !== undefined :
        state === 'pending' || state === 'unknown' ? value.terminal !== undefined : !validTerminal(value.terminal, method, state)) {
        throw new Error('Configuration write records cannot be read; writes are blocked.');
      }
      let target: string, binding: string;
      try { target = normalizedTarget(value.target); binding = absoluteTarget(value.binding); }
      catch { throw new Error('Configuration write records cannot be read; writes are blocked.'); }
      if (target !== value.target || ids.has(value.operationId)) throw new Error('Configuration write records are ambiguous; writes are blocked.');
      ids.add(value.operationId);
      if (state === 'pending' || state === 'unknown') {
        if (globalActive || value.scope === 'global' && activeCount > 0) throw new Error('Configuration write records are ambiguous; writes are blocked.');
        activeCount++;
        if (value.scope === 'global') globalActive = true;
        const key = JSON.stringify([value.hostKey, target]);
        const bindingKey = JSON.stringify([value.hostKey, binding]);
        if (targets.has(key) || bindings.has(bindingKey) || aliasedHosts.has(value.hostKey as string)
          || binding !== target && activeHosts.has(value.hostKey as string)) {
          throw new Error('Configuration write records are ambiguous; writes are blocked.');
        }
        targets.add(key); bindings.add(bindingKey); activeHosts.add(value.hostKey as string);
        if (binding !== target) aliasedHosts.add(value.hostKey as string);
      }
    }
    return raw as ConfigWriteRecord[];
  }

  async function save(next: ConfigWriteRecord[]) {
    const existed = Object.hasOwn(options.state, stateKey), previous = options.state[stateKey];
    options.state[stateKey] = next;
    try { await options.persist(); }
    catch (error) {
      if (existed) options.state[stateKey] = previous; else delete options.state[stateKey];
      throw error;
    }
  }

  function project(value: ConfigWriteRecord): ConfigWriteStatus {
    const observation = observed.get(value.operationId);
    return { operationId: value.operationId, hostId: value.hostId, hostKey: value.hostKey, target: value.target, binding: value.binding,
      ...(value.scope ? { scope: value.scope } : {}), ...(value.method ? { method: value.method } : {}),
      state: value.state === 'pending' && !live.has(value.operationId) ? 'unknown' : value.state,
      ...(value.terminal ? { terminal: { ...value.terminal } } : {}),
      ...(observation ? { storageError: true as const, ...('terminal' in observation ? { observedTerminal: { ...observation.terminal } } : {}) } : {}) };
  }

  async function status(operationId: string): Promise<ConfigWriteStatus | null> {
    if (!validId(operationId)) throw new Error('Invalid configuration write operation.');
    return options.mutations.run(() => {
      const value = records().find(item => item.operationId === operationId);
      return value ? project(value) : null;
    });
  }

  async function persistObservation(operationId: string, observation: Observation): Promise<ConfigWriteStatus> {
    const current = records(), index = current.findIndex(value => value.operationId === operationId);
    if (index < 0 || !active(current[index]!)) throw new Error('The original configuration write record is unavailable.');
    const next = [...current];
    next[index] = { ...next[index]!, ...observation };
    try { await save(next); }
    catch (error) { observed.set(operationId, observation); throw error; }
    observed.delete(operationId);
    return project(next[index]!);
  }

  async function saveObservation(operationId: string, observation: Observation) {
    return options.mutations.run(async () => {
      try { return { operation: await persistObservation(operationId, observation) }; }
      catch (persistenceError) {
        const value = records().find(item => item.operationId === operationId);
        if (!value || !observed.has(operationId)) throw persistenceError;
        return { operation: project(value), persistenceError };
      }
    });
  }

  async function retryTerminalSave(operationId: string): Promise<ConfigWriteStatus> {
    if (!validId(operationId)) throw new Error('Invalid configuration write operation.');
    return options.mutations.run(async () => {
      const observation = observed.get(operationId);
      if (!observation) throw new Error('The original observation is unavailable.');
      return persistObservation(operationId, observation);
    });
  }

  function original(current: ConfigWriteRecord[], input: ConfigWriteIdentity): ConfigWriteRecord | undefined {
    const value = current.find(item => item.operationId === input.operationId);
    if (value && (value.hostId !== input.hostId || value.method !== input.method)) {
      throw new Error('The configuration operation belongs to another host or method, or its original method is unavailable.');
    }
    return value;
  }

  async function preflight(input: ConfigWriteIdentity): Promise<ConfigWritePreflight> {
    if (!input || !validId(input.operationId) || !validId(input.hostId) || !methods.has(input.method)) {
      throw new Error('Invalid configuration write request.');
    }
    return options.mutations.run(() => {
      const current = records(), existing = original(current, input);
      if (existing) return { outcome: 'existing' as const, operation: project(existing) };
      // Legacy records may have lost an unstable alias when their binding was normalized.
      const blocker = current.find(value => active(value) && (value.scope === 'global' || value.method === undefined));
      return blocker ? { outcome: 'blocked' as const, operation: project(blocker) } : null;
    });
  }

  async function prepare(input: ConfigWriteInput, params: Record<string, unknown>, originalSocket: unknown): Promise<ConfigWriteSubmission> {
    const { operationId, hostId, method, connection } = input;
    const prior = await preflight(input);
    if (prior) return prior;
    if (!connection.connected || !originalSocket || connection.socket !== originalSocket) throw new Error('The original configuration connection is unavailable.');
    const resolved = await options.resolveTarget({ hostId, method, params: structuredClone(params), connection });
    if (!resolved || !validId(resolved.hostKey) || resolved.scope !== undefined && resolved.scope !== 'global') throw new Error('The actual configuration host is unavailable.');
    if (!connection.connected || connection.socket !== originalSocket) throw new Error('The original configuration connection changed before the write.');
    const hostKey = resolved.hostKey, target = normalizedTarget(resolved.target), binding = absoluteTarget(resolved.binding);
    const prepared = await options.mutations.run(async () => {
      const current = records(), previous = original(current, input);
      if (previous) return { outcome: 'existing' as const, operation: project(previous) };
      const existing = current.find(value => active(value) && (value.method === undefined || value.scope === 'global' || resolved.scope === 'global' || value.hostKey === hostKey &&
        (value.target === target || value.binding === binding || value.binding !== value.target || binding !== target)));
      if (existing) return { outcome: 'blocked' as const, operation: project(existing) };
      const operation: ConfigWriteRecord = { operationId, hostId, hostKey, target, binding, method,
        ...(resolved.scope ? { scope: resolved.scope } : {}), state: 'pending' };
      await save([...current, operation]);
      live.add(operationId);
      return { outcome: 'started' as const, operation };
    });
    if (prepared.outcome !== 'started') return prepared;

    const operation = prepared.operation;
    let releaseInitial!: () => void;
    const afterInitial = new Promise<void>(resolve => { releaseInitial = resolve; });
    const onLateTerminal = async (late: LateRpcTerminal) => {
      const terminal = late.outcome === 'success' ? terminalForResult(method, late.result)
        : record(late.error) && typeof late.error.message === 'string' ? rejected(late.error.code) : null;
      if (!terminal) return;
      await afterInitial;
      await saveObservation(operationId, { state: late.outcome === 'success' ? 'succeeded' : 'failed', terminal });
    };
    const completion = (async (): Promise<ConfigWriteCompletion> => {
      try {
        if (!connection.connected || connection.socket !== originalSocket) throw new RpcError('The original configuration connection changed before sending.', { status: 503 });
        const response = await connection.requestWithCursor(method, params, { mutating: true, onLateTerminal });
        const terminal = terminalForResult(method, response?.result);
        if (!terminal || !Number.isSafeInteger(response.eventCursor) || response.eventCursor < 0) {
          throw new Error('The original configuration response was not a valid terminal.');
        }
        live.delete(operationId);
        return { outcome: 'success', response, ...await saveObservation(operationId, { state: 'succeeded', terminal }) };
      } catch (error) {
        const terminal = terminalForError(error);
        live.delete(operationId);
        if (terminal) return { outcome: 'error', error, ...await saveObservation(operationId, { state: 'failed', terminal }) };
        return { outcome: 'unknown', error, ...await saveObservation(operationId, { state: 'unknown' }) };
      } finally {
        live.delete(operationId);
        releaseInitial();
      }
    })();
    return { outcome: 'started', operation: project(operation), completion };
  }

  function submit(input: ConfigWriteInput): Promise<ConfigWriteSubmission> {
    if (!input || !validId(input.operationId) || !validId(input.hostId) || !methods.has(input.method) || !record(input.params)
      || !input.connection || typeof input.connection.requestWithCursor !== 'function') {
      return Promise.reject(new Error('Invalid configuration write request.'));
    }
    const { operationId, hostId, method, connection } = input;
    const previous = preparing.get(operationId);
    if (previous) {
      if (previous.hostId !== hostId || previous.method !== method) return Promise.reject(new Error('The configuration operation belongs to another host or method.'));
      return previous.promise.then(async result => {
        if (result.outcome === 'blocked') return result;
        const value = await status(operationId);
        if (!value) throw new Error('The original configuration write record is unavailable.');
        return { outcome: 'existing' as const, operation: value };
      });
    }
    const params = structuredClone(input.params), originalSocket = connection.socket;
    const promise = prepare({ operationId, hostId, method, params, connection }, params, originalSocket);
    preparing.set(operationId, { hostId, method, promise });
    return promise.finally(() => {
      if (preparing.get(operationId)?.promise === promise) preparing.delete(operationId);
    });
  }

  return { preflight, submit, status, retryTerminalSave };
}
