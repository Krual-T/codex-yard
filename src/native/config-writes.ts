import { randomUUID } from 'node:crypto';
import { posix, win32 } from 'node:path';
import { RpcError } from '../../lib/codex.ts';
import type { LateRpcTerminal, RequestOptions, RpcResult } from '../../lib/codex-protocol.ts';
import type { StateMutations } from './state-mutations.ts';

export type ConfigWriteMethod = 'config/batchWrite' | 'config/value/write' | 'skills/config/write';
export type ConfigWriteState = 'pending' | 'unknown' | 'succeeded' | 'failed';
type Terminal = 'success' | 'error' | 'not-sent';

export interface ConfigWriteRecord {
  operationId: string;
  hostId: string;
  hostKey: string;
  target: string;
  binding: string;
  state: ConfigWriteState;
}

export interface ConfigWriteStatus extends ConfigWriteRecord {
  observedTerminal?: Terminal;
  storageError?: true;
}

export interface ConfigWriteConnection {
  readonly connected: boolean;
  readonly socket: unknown;
  requestWithCursor(method: string, params?: unknown, options?: RequestOptions): Promise<RpcResult<unknown>>;
}

interface ConfigWriteInput {
  hostId: string;
  method: ConfigWriteMethod;
  params: Record<string, unknown>;
  connection: ConfigWriteConnection;
}

interface ConfigWritesOptions {
  state: Record<string, unknown>;
  persist(): Promise<unknown>;
  mutations: StateMutations;
  /** The host verifies the physical host, actual file and the path used by the daemon. */
  resolveTarget(input: ConfigWriteInput): Promise<{ hostKey: string; target: string; binding: string }>;
}

export type ConfigWriteCompletion =
  | { outcome: 'success'; response: RpcResult<unknown>; operation: ConfigWriteStatus; persistenceError?: unknown }
  | { outcome: 'error' | 'unknown'; error: unknown; operation: ConfigWriteStatus; persistenceError?: unknown };

export type ConfigWriteSubmission =
  | { outcome: 'blocked'; operation: ConfigWriteStatus }
  | { outcome: 'started'; operation: ConfigWriteStatus; completion: Promise<ConfigWriteCompletion> };

const stateKey = 'configWriteOperations';
const methods = new Set<ConfigWriteMethod>(['config/batchWrite', 'config/value/write', 'skills/config/write']);
const states = new Set<ConfigWriteState>(['pending', 'unknown', 'succeeded', 'failed']);
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 4096 && !value.includes('\0');
const active = (value: ConfigWriteRecord) => value.state === 'pending' || value.state === 'unknown';

function normalizedTarget(value: unknown): string {
  if (!validId(value)) throw new Error('The actual configuration target is unavailable.');
  if (/^[a-z]:[\\/]|^\\\\/i.test(value)) {
    if (win32.isAbsolute(value)) return win32.normalize(value);
  } else if (posix.isAbsolute(value)) return posix.normalize(value);
  throw new Error('The actual configuration target is unavailable.');
}

function terminalForError(error: unknown): Terminal | null {
  if (!(error instanceof RpcError) || error.uncertain) return null;
  if (error.code === 'OBSERVER_LIMIT' || error.status === 503) return 'not-sent';
  if (error.message === 'Codex 返回了无效错误。') return null;
  return typeof error.code === 'number' && Number.isInteger(error.code) || typeof error.code === 'string' && error.code.length > 0 ? 'error' : null;
}

/** Uses the existing native-state commit interval; it does not replay writes. */
export function createConfigWrites(options: ConfigWritesOptions) {
  const live = new Set<string>();
  const observed = new Map<string, Terminal>();

  function records(): ConfigWriteRecord[] {
    const raw = options.state[stateKey];
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) throw new Error('Configuration write records cannot be read; writes are blocked.');
    const ids = new Set<string>(), targets = new Set<string>(), bindings = new Set<string>();
    const activeHosts = new Set<string>(), aliasedHosts = new Set<string>();
    for (const value of raw) {
      if (!record(value) || !validId(value.operationId) || !validId(value.hostId) || !validId(value.hostKey)
        || !validId(value.target) || !validId(value.binding) || !states.has(value.state as ConfigWriteState)) {
        throw new Error('Configuration write records cannot be read; writes are blocked.');
      }
      let target: string, binding: string;
      try { target = normalizedTarget(value.target); binding = normalizedTarget(value.binding); }
      catch { throw new Error('Configuration write records cannot be read; writes are blocked.'); }
      if (target !== value.target || binding !== value.binding || ids.has(value.operationId)) throw new Error('Configuration write records are ambiguous; writes are blocked.');
      ids.add(value.operationId);
      if (value.state === 'pending' || value.state === 'unknown') {
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
    const terminal = observed.get(value.operationId);
    return { operationId: value.operationId, hostId: value.hostId, hostKey: value.hostKey, target: value.target, binding: value.binding,
      state: value.state === 'pending' && !live.has(value.operationId) ? 'unknown' : value.state,
      ...(terminal ? { observedTerminal: terminal, storageError: true as const } : {}) };
  }

  async function status(operationId: string): Promise<ConfigWriteStatus | null> {
    if (!validId(operationId)) throw new Error('Invalid configuration write operation.');
    return options.mutations.run(() => {
      const value = records().find(item => item.operationId === operationId);
      return value ? project(value) : null;
    });
  }

  async function saveTerminal(operationId: string): Promise<ConfigWriteStatus> {
    return options.mutations.run(async () => {
      const terminal = observed.get(operationId), current = records();
      const index = current.findIndex(value => value.operationId === operationId);
      if (!terminal || index < 0 || !active(current[index]!)) throw new Error('The original terminal is unavailable.');
      const next = [...current];
      next[index] = { ...next[index]!, state: terminal === 'success' ? 'succeeded' : 'failed' };
      await save(next);
      observed.delete(operationId);
      return project(next[index]!);
    });
  }

  async function saveUnknown(operationId: string) {
    await options.mutations.run(async () => {
      const current = records(), index = current.findIndex(value => value.operationId === operationId);
      if (index < 0 || !active(current[index]!)) throw new Error('The original configuration write record is unavailable.');
      if (current[index]!.state === 'unknown') return;
      const next = [...current]; next[index] = { ...next[index]!, state: 'unknown' };
      await save(next);
    });
  }

  async function submit(input: ConfigWriteInput): Promise<ConfigWriteSubmission> {
    if (!input || !validId(input.hostId) || !methods.has(input.method) || !record(input.params)
      || !input.connection || typeof input.connection.requestWithCursor !== 'function') {
      throw new Error('Invalid configuration write request.');
    }
    const { hostId, method, connection } = input;
    const originalSocket = connection.socket;
    if (!connection.connected || !originalSocket) throw new Error('The original configuration connection is unavailable.');
    const params = structuredClone(input.params);
    const resolved = await options.resolveTarget({ hostId, method, params: structuredClone(params), connection });
    if (!resolved || !validId(resolved.hostKey)) throw new Error('The actual configuration host is unavailable.');
    if (!connection.connected || connection.socket !== originalSocket) throw new Error('The original configuration connection changed before the write.');
    const hostKey = resolved.hostKey, target = normalizedTarget(resolved.target), binding = normalizedTarget(resolved.binding);
    const prepared = await options.mutations.run(async () => {
      const current = records();
      const existing = current.find(value => active(value) && value.hostKey === hostKey &&
        (value.target === target || value.binding === binding || value.binding !== value.target || binding !== target));
      if (existing) return { outcome: 'blocked' as const, operation: project(existing) };
      const operation: ConfigWriteRecord = { operationId: randomUUID(), hostId, hostKey, target, binding, state: 'pending' };
      await save([...current, operation]);
      live.add(operation.operationId);
      return { outcome: 'started' as const, operation };
    });
    if (prepared.outcome === 'blocked') return prepared;

    const operation = prepared.operation, operationId = operation.operationId;
    let releaseInitial!: () => void;
    const afterInitial = new Promise<void>(resolve => { releaseInitial = resolve; });
    async function saveObserved(terminal: Terminal) {
      observed.set(operationId, terminal);
      try { return { operation: await saveTerminal(operationId) }; }
      catch (persistenceError) { live.delete(operationId); return { operation: project(operation), persistenceError }; }
    }
    const onLateTerminal = async (terminal: LateRpcTerminal) => {
      await afterInitial;
      await saveObserved(terminal.outcome === 'success' ? 'success' : 'error');
    };
    const completion = (async (): Promise<ConfigWriteCompletion> => {
      try {
        if (!connection.connected || connection.socket !== originalSocket) throw new RpcError('The original configuration connection changed before sending.', { status: 503 });
        const response = await connection.requestWithCursor(method, params, { mutating: true, onLateTerminal });
        if (!response || response.result === undefined || !Number.isSafeInteger(response.eventCursor) || response.eventCursor < 0) {
          throw new Error('The original configuration response was not a valid terminal.');
        }
        const saved = await saveObserved('success');
        return { outcome: 'success', response, ...saved };
      } catch (error) {
        const terminal = terminalForError(error);
        if (terminal) return { outcome: 'error', error, ...await saveObserved(terminal) };
        let persistenceError: unknown;
        try { await saveUnknown(operationId); } catch (failure) { persistenceError = failure; }
        live.delete(operationId);
        return { outcome: 'unknown', error, operation: await status(operationId) ?? project(operation),
          ...(persistenceError === undefined ? {} : { persistenceError }) };
      } finally {
        live.delete(operationId);
        releaseInitial();
      }
    })();
    return { outcome: 'started', operation: project(operation), completion };
  }

  return { submit, status, retryTerminalSave: saveTerminal };
}
