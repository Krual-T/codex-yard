import { createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { posix, win32 } from 'node:path';
import { RpcError } from '../../lib/codex.ts';
import type { LateRpcTerminal, RequestOptions, RpcResult } from '../../lib/codex-protocol.ts';
import type { ConfigWriteErrorCategory, ConfigWriteMethod, ConfigWriteReceipt, ConfigWriteRecord, ConfigWriteState,
  ConfigWriteStatus, ConfigWriteTerminal } from '../../lib/config-write-protocol.ts';
import type { StateMutations } from './state-mutations.ts';

export type { ConfigWriteErrorCategory, ConfigWriteMethod, ConfigWriteReceipt, ConfigWriteRecord, ConfigWriteState,
  ConfigWriteStatus, ConfigWriteTerminal } from '../../lib/config-write-protocol.ts';

export interface ConfigWriteRequestOptions extends RequestOptions { retainLateUntilDisconnect?: true }
export interface ConfigWriteConnection {
  readonly connected: boolean;
  readonly socket: unknown;
  readonly server?: { codexHome?: string } | null;
  requestWithCursor(method: string, params?: unknown, options?: ConfigWriteRequestOptions): Promise<RpcResult<unknown>>;
}

export interface ConfigWriteIdentity { operationId: string; hostId: string; method: ConfigWriteMethod }
export interface ConfigWriteTargetInput extends Omit<ConfigWriteIdentity, 'operationId'> { params: Record<string, unknown>; connection: ConfigWriteConnection }
export interface ConfigWriteTarget { hostKey: string; target: string; binding: string; scope?: 'global' }

interface ConfigWritesOptions {
  state: Record<string, unknown>;
  persist(): Promise<unknown>;
  mutations: StateMutations;
  resolveTarget(input: ConfigWriteTargetInput): Promise<ConfigWriteTarget>;
  /** Called under mutations; must not reacquire that lock. */
  findFileBlocker(target: ConfigWriteTarget): boolean | Promise<boolean>;
}

export type ConfigWriteCompletion =
  | { outcome: 'success'; response: RpcResult<unknown>; operation: ConfigWriteStatus; persistenceError?: unknown }
  | { outcome: 'error' | 'unknown'; error: unknown; operation: ConfigWriteStatus; persistenceError?: unknown };
export type ConfigWriteSubmission =
  | { outcome: 'blocked'; operation: ConfigWriteStatus }
  | { outcome: 'existing'; operation: ConfigWriteStatus }
  | { outcome: 'not-started'; operation: ConfigWriteStatus }
  | { outcome: 'started'; operation: ConfigWriteStatus; completion: Promise<ConfigWriteCompletion> };
type ConfigWritePrior =
  | { outcome: 'blocked'; operation: ConfigWriteStatus }
  | { outcome: 'existing'; operation: ConfigWriteStatus }
  | null;
type StoredRecord = ConfigWriteRecord & { receiptKey?: string; receiptPublicKey?: string };
type ReceiptSigner = ConfigWriteIdentity & { publicKey: string; privateKey: KeyObject };
type Observation = { state: 'unknown' } | { state: 'succeeded' | 'failed'; terminal: ConfigWriteTerminal };
type Prepared = { outcome: 'prepared'; operation: ConfigWriteStatus;
  start(params: Record<string, unknown>, connection: ConfigWriteConnection): Promise<ConfigWriteSubmission>;
  notSent(): Promise<ConfigWriteStatus> };

const stateKey = 'configWriteOperations';
const methods = new Set<ConfigWriteMethod>(['config/batchWrite', 'skills/config/write']);
const states = new Set<ConfigWriteState>(['preparing', 'pending', 'unknown', 'succeeded', 'failed']);
const categories = new Set<ConfigWriteErrorCategory>(['configVersionConflict', 'configValidationError', 'configLayerReadonly']);
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 4096 && !value.includes('\0');
const active = (value: ConfigWriteRecord) => value.state === 'preparing' || value.state === 'pending' || value.state === 'unknown';
const validKey = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
function validEncoded(value: unknown, size: number): value is string {
  if (typeof value !== 'string' || value.length !== Math.ceil(size * 8 / 6) || !/^[A-Za-z0-9_-]+$/.test(value)) return false;
  const bytes = Buffer.from(value, 'base64url');
  return bytes.length === size && bytes.toString('base64url') === value;
}

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
function rejected(code: unknown, data?: unknown): ConfigWriteTerminal | null {
  if (!(typeof code === 'number' && Number.isSafeInteger(code)) && !validId(code)) return null;
  const category = record(data) && categories.has(data.config_write_error_code as ConfigWriteErrorCategory)
    ? data.config_write_error_code as ConfigWriteErrorCategory : undefined;
  return { kind: 'rejected', ...(typeof code === 'number' ? { code } : {}), ...(category ? { category } : {}) };
}
function terminalForError(error: unknown): ConfigWriteTerminal | null {
  if (!(error instanceof RpcError) || error.uncertain) return null;
  if (error.status === 503) return { kind: 'not-sent', ...(error.code === 'OBSERVER_LIMIT' ? { code: 'OBSERVER_LIMIT' as const } : {}) };
  if (error.message === 'Codex 返回了无效错误。') return null;
  return rejected(error.code, error.data);
}
function validTerminal(value: unknown, method: ConfigWriteMethod, state: ConfigWriteState): value is ConfigWriteTerminal {
  if (!record(value)) return false;
  if (state === 'succeeded') return method === 'config/batchWrite' && (value.kind === 'ok' || value.kind === 'okOverridden')
    || method === 'skills/config/write' && value.kind === 'effectiveEnabled' && typeof value.value === 'boolean';
  if (state !== 'failed') return false;
  return value.kind === 'rejected' && (value.code === undefined || typeof value.code === 'number' && Number.isSafeInteger(value.code))
    && (value.category === undefined || categories.has(value.category as ConfigWriteErrorCategory))
    || value.kind === 'not-sent' && (value.code === undefined || value.code === 'OBSERVER_LIMIT');
}
function canonicalTerminal(value: ConfigWriteTerminal): ConfigWriteTerminal {
  if (value.kind === 'ok' || value.kind === 'okOverridden') return { kind: value.kind };
  if (value.kind === 'effectiveEnabled') return { kind: value.kind, value: value.value };
  if (value.kind === 'rejected') return { kind: value.kind, ...(value.code === undefined ? {} : { code: value.code }),
    ...(value.category === undefined ? {} : { category: value.category }) };
  if (value.kind === 'not-sent') return { kind: value.kind, ...(value.code === undefined ? {} : { code: value.code }) };
  throw new Error('Invalid configuration write terminal.');
}
function terminalState(terminal: ConfigWriteTerminal): 'succeeded' | 'failed' {
  return terminal.kind === 'rejected' || terminal.kind === 'not-sent' ? 'failed' : 'succeeded';
}
function receiptPayload(value: StoredRecord, terminal: ConfigWriteTerminal): Buffer {
  return Buffer.from(JSON.stringify([
    'config-write-receipt-v2-ed25519', value.operationId, value.hostId, value.method, canonicalTerminal(terminal),
  ]));
}
function makeReceipt(value: StoredRecord, terminal: ConfigWriteTerminal, signer: ReceiptSigner | undefined): ConfigWriteReceipt | undefined {
  if (!signer || signer.operationId !== value.operationId || signer.hostId !== value.hostId || signer.method !== value.method
    || signer.publicKey !== value.receiptPublicKey) return undefined;
  try {
    return { operationId: value.operationId, hostId: value.hostId, method: signer.method,
      terminal: canonicalTerminal(terminal), signature: sign(null, receiptPayload(value, terminal), signer.privateKey).toString('base64url') };
  } catch { return undefined; }
}
function verifyReceipt(value: StoredRecord, receipt: unknown): ConfigWriteTerminal {
  if (!record(receipt) || receipt.operationId !== value.operationId || receipt.hostId !== value.hostId
    || receipt.method !== value.method || !value.method || !validEncoded(value.receiptPublicKey, 44) || !validEncoded(receipt.signature, 64)
    || !record(receipt.terminal)) throw new Error('The original configuration receipt cannot be verified.');
  const state = receipt.terminal.kind === 'ok' || receipt.terminal.kind === 'okOverridden' || receipt.terminal.kind === 'effectiveEnabled' ? 'succeeded' : 'failed';
  if (!validTerminal(receipt.terminal, value.method, state)) throw new Error('The original configuration receipt cannot be verified.');
  const terminal = canonicalTerminal(receipt.terminal);
  try {
    const publicKey = createPublicKey({ key: Buffer.from(value.receiptPublicKey, 'base64url'), format: 'der', type: 'spki' });
    if (publicKey.asymmetricKeyType !== 'ed25519' || !verify(null, receiptPayload(value, terminal), publicKey,
      Buffer.from(receipt.signature, 'base64url'))) throw new Error();
  } catch { throw new Error('The original configuration receipt cannot be verified.'); }
  return terminal;
}

/** Uses the existing native-state commit interval; it does not replay writes. */
export function createConfigWrites(options: ConfigWritesOptions) {
  const live = new Set<string>();
  const observed = new Map<string, Observation>();
  const signers = new Map<string, ReceiptSigner>();

  function records(): StoredRecord[] {
    const raw = options.state[stateKey];
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) throw new Error('Configuration write records cannot be read; writes are blocked.');
    const ids = new Set<string>(), targets = new Set<string>(), bindings = new Set<string>();
    const activeHosts = new Set<string>(), aliasedHosts = new Set<string>();
    let activeCount = 0, globalActive = false;
    for (const value of raw) {
      if (!record(value) || !validId(value.operationId) || !validId(value.hostId) || !states.has(value.state as ConfigWriteState)
        || value.scope !== undefined && value.scope !== 'global' || value.method !== undefined && !methods.has(value.method as ConfigWriteMethod)
        || value.receiptKey !== undefined && !validKey(value.receiptKey)
        || value.receiptPublicKey !== undefined && !validEncoded(value.receiptPublicKey, 44)) throw new Error('Configuration write records cannot be read; writes are blocked.');
      const state = value.state as ConfigWriteState, method = value.method as ConfigWriteMethod | undefined;
      if (state === 'preparing' && (!method || value.terminal !== undefined)) {
        throw new Error('Configuration write records cannot be read; writes are blocked.');
      }
      if (method === undefined ? value.terminal !== undefined : state === 'preparing' || state === 'pending' || state === 'unknown'
        ? value.terminal !== undefined : !validTerminal(value.terminal, method, state)) throw new Error('Configuration write records cannot be read; writes are blocked.');
      if (ids.has(value.operationId)) throw new Error('Configuration write records are ambiguous; writes are blocked.');
      ids.add(value.operationId);
      const hasTarget = value.hostKey !== undefined || value.target !== undefined || value.binding !== undefined;
      if (!hasTarget && (state === 'preparing' || state === 'failed' && record(value.terminal) && value.terminal.kind === 'not-sent')) continue;
      if (!validId(value.hostKey) || !validId(value.target) || !validId(value.binding)) throw new Error('Configuration write records cannot be read; writes are blocked.');
      let target: string, binding: string;
      try { target = normalizedTarget(value.target); binding = absoluteTarget(value.binding); }
      catch { throw new Error('Configuration write records cannot be read; writes are blocked.'); }
      if (target !== value.target) throw new Error('Configuration write records are ambiguous; writes are blocked.');
      if (state === 'pending' || state === 'unknown') {
        if (globalActive || value.scope === 'global' && activeCount > 0) throw new Error('Configuration write records are ambiguous; writes are blocked.');
        activeCount++;
        if (value.scope === 'global') globalActive = true;
        const key = JSON.stringify([value.hostKey, target]), bindingKey = JSON.stringify([value.hostKey, binding]);
        if (targets.has(key) || bindings.has(bindingKey) || aliasedHosts.has(value.hostKey) || binding !== target && activeHosts.has(value.hostKey)) {
          throw new Error('Configuration write records are ambiguous; writes are blocked.');
        }
        targets.add(key); bindings.add(bindingKey); activeHosts.add(value.hostKey);
        if (binding !== target) aliasedHosts.add(value.hostKey);
      }
    }
    return raw as StoredRecord[];
  }

  async function save(next: StoredRecord[]) {
    const existed = Object.hasOwn(options.state, stateKey), previous = options.state[stateKey];
    options.state[stateKey] = next;
    try { await options.persist(); }
    catch (error) { if (existed) options.state[stateKey] = previous; else delete options.state[stateKey]; throw error; }
  }
  function project(value: StoredRecord): ConfigWriteStatus {
    const observation = observed.get(value.operationId), terminal = observation && 'terminal' in observation ? observation.terminal : undefined;
    const receipt = terminal ? makeReceipt(value, terminal, signers.get(value.operationId)) : undefined;
    return { operationId: value.operationId, hostId: value.hostId,
      ...(value.hostKey === undefined ? {} : { hostKey: value.hostKey }), ...(value.target === undefined ? {} : { target: value.target }),
      ...(value.binding === undefined ? {} : { binding: value.binding }), ...(value.scope ? { scope: value.scope } : {}),
      ...(value.method ? { method: value.method } : {}), state: value.state === 'pending' && !live.has(value.operationId) ? 'unknown' : value.state,
      ...(value.state === 'preparing' && !live.has(value.operationId) ? { interrupted: true as const } : {}),
      ...(value.terminal ? { terminal: canonicalTerminal(value.terminal) } : {}),
      ...(observation ? { storageError: true as const, ...(terminal ? { observedTerminal: canonicalTerminal(terminal) } : {}),
        ...(receipt ? { recoveryReceipt: receipt } : {}) } : {}) };
  }
  async function status(operationId: string): Promise<ConfigWriteStatus | null> {
    if (!validId(operationId)) throw new Error('Invalid configuration write operation.');
    return options.mutations.run(() => { const value = records().find(item => item.operationId === operationId); return value ? project(value) : null; });
  }
  // Caller already holds mutations, as does the file reservation it guards.
  function activeForFile(): ConfigWriteStatus | null {
    const value = records().find(active); return value ? project(value) : null;
  }
  async function persistObservation(operationId: string, observation: Observation): Promise<ConfigWriteStatus> {
    const current = records(), index = current.findIndex(value => value.operationId === operationId);
    if (index < 0 || !active(current[index]!)) throw new Error('The original configuration write record is unavailable.');
    const next = [...current]; next[index] = { ...next[index]!, ...observation };
    try { await save(next); } catch (error) { observed.set(operationId, observation); throw error; }
    observed.delete(operationId);
    if ('terminal' in observation) signers.delete(operationId);
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
  async function retryTerminalSave(operationId: string, receipt?: unknown): Promise<ConfigWriteStatus> {
    if (!validId(operationId)) throw new Error('Invalid configuration write operation.');
    return options.mutations.run(async () => {
      const value = records().find(item => item.operationId === operationId);
      if (!value) throw new Error('The original configuration write record is unavailable.');
      let observation = observed.get(operationId);
      if (receipt !== undefined) {
        const terminal = verifyReceipt(value, receipt);
        if (value.terminal) {
          if (JSON.stringify(canonicalTerminal(value.terminal)) !== JSON.stringify(terminal)) throw new Error('The original configuration receipt cannot be verified.');
          return project(value);
        }
        if (observation && 'terminal' in observation && JSON.stringify(canonicalTerminal(observation.terminal)) !== JSON.stringify(terminal)) {
          throw new Error('The original configuration receipt cannot be verified.');
        }
        observation = { state: terminalState(terminal), terminal };
      }
      if (!observation && value.state === 'preparing' && !live.has(operationId)) observation = { state: 'failed', terminal: { kind: 'not-sent' } };
      if (!observation) throw new Error('The original observation is unavailable.');
      return persistObservation(operationId, observation);
    });
  }
  function original(current: StoredRecord[], input: ConfigWriteIdentity): StoredRecord | undefined {
    const value = current.find(item => item.operationId === input.operationId);
    if (value && (value.hostId !== input.hostId || value.method !== input.method)) {
      throw new Error('The configuration operation belongs to another host or method, or its original method is unavailable.');
    }
    return value;
  }
  function prior(current: StoredRecord[], input: ConfigWriteIdentity): ConfigWritePrior {
    const existing = original(current, input);
    if (existing) return { outcome: 'existing', operation: project(existing) };
    const blocker = current.find(value => active(value) && (value.scope === 'global' || value.method === undefined
      || value.state === 'preparing' && (!live.has(value.operationId) || observed.has(value.operationId))));
    return blocker ? { outcome: 'blocked', operation: project(blocker) } : null;
  }
  function validateIdentity(input: ConfigWriteIdentity) {
    if (!input || !validId(input.operationId) || !validId(input.hostId) || !methods.has(input.method)) throw new Error('Invalid configuration write request.');
  }
  async function begin(input: ConfigWriteIdentity): Promise<Prepared | Exclude<ConfigWriteSubmission, { outcome: 'started' }>> {
    validateIdentity(input);
    return options.mutations.run(async () => {
      const current = records(), previous = prior(current, input);
      if (previous) return previous;
      const { publicKey, privateKey } = generateKeyPairSync('ed25519');
      const receiptPublicKey = publicKey.export({ format: 'der', type: 'spki' }).toString('base64url');
      const value: StoredRecord = { operationId: input.operationId, hostId: input.hostId, method: input.method,
        state: 'preparing', receiptPublicKey };
      signers.set(input.operationId, { ...input, publicKey: receiptPublicKey, privateKey });
      try { await save([...current, value]); }
      catch {
        options.state[stateKey] = [...current, value];
        observed.set(input.operationId, { state: 'failed', terminal: { kind: 'not-sent' } });
        return { outcome: 'not-started', operation: project(value) };
      }
      live.add(input.operationId);
      let used = false;
      const notSent = async () => {
        if (used) throw new Error('The original configuration preparation was already used.');
        used = true;
        try { return (await saveObservation(input.operationId, { state: 'failed', terminal: { kind: 'not-sent' } })).operation; }
        finally { live.delete(input.operationId); }
      };
      const start = async (params: Record<string, unknown>, connection: ConfigWriteConnection) => {
        if (used) throw new Error('The original configuration preparation was already used.');
        used = true;
        let snapshot: Record<string, unknown>, socket: unknown;
        try { snapshot = structuredClone(params); socket = connection.socket; }
        catch {
          try { return { outcome: 'not-started' as const, operation: (await saveObservation(input.operationId,
            { state: 'failed', terminal: { kind: 'not-sent' } })).operation }; }
          finally { live.delete(input.operationId); }
        }
        return prepare(input, snapshot, connection, socket);
      };
      return { outcome: 'prepared', operation: project(value), start, notSent };
    });
  }
  async function prepare(input: ConfigWriteIdentity, params: Record<string, unknown>, connection: ConfigWriteConnection, originalSocket: unknown): Promise<ConfigWriteSubmission> {
    const { operationId, hostId, method } = input;
    let resolved: ConfigWriteTarget;
    let blocking: ConfigWriteStatus | undefined;
    try {
      if (!connection.connected || !originalSocket || connection.socket !== originalSocket) throw new Error('The original configuration connection is unavailable.');
      resolved = await options.resolveTarget({ hostId, method, params: structuredClone(params), connection });
      if (!resolved || !validId(resolved.hostKey) || resolved.scope !== undefined && resolved.scope !== 'global') throw new Error('The actual configuration host is unavailable.');
      resolved = { ...resolved, target: normalizedTarget(resolved.target), binding: absoluteTarget(resolved.binding) };
      if (!connection.connected || connection.socket !== originalSocket) throw new Error('The original configuration connection changed before the write.');
      const ready = await options.mutations.run(async () => {
        const current = records(), index = current.findIndex(value => value.operationId === operationId), own = current[index];
        if (!own || own.state !== 'preparing' || !live.has(operationId)) throw new Error('The original configuration preparation is unavailable.');
        const blocker = current.find(value => value.operationId !== operationId && active(value)
          && (value.state === 'preparing' ? !live.has(value.operationId) || observed.has(value.operationId)
            : value.method === undefined || value.scope === 'global' || resolved.scope === 'global' || value.hostKey === resolved.hostKey &&
            (value.target === resolved.target || value.binding === resolved.binding || value.binding !== value.target || resolved.binding !== resolved.target)));
        if (blocker) { blocking = project(blocker); return false; }
        if (await options.findFileBlocker(resolved)) return false;
        if (!connection.connected || connection.socket !== originalSocket) return false;
        const next = [...current]; next[index] = { ...own, ...resolved, state: 'pending' };
        await save(next);
        return true;
      });
      if (!ready) throw new Error('The configuration target is blocked or the connection changed.');
    } catch {
      try {
        const failed = await saveObservation(operationId, { state: 'failed', terminal: { kind: 'not-sent' } });
        if (blocking && !failed.operation.storageError) return { outcome: 'blocked', operation: blocking };
        return { outcome: 'not-started', operation: failed.operation };
      } finally { live.delete(operationId); }
    }
    const operation = await status(operationId);
    if (!operation) throw new Error('The original configuration write record is unavailable.');
    let releaseInitial!: () => void;
    const afterInitial = new Promise<void>(resolve => { releaseInitial = resolve; });
    const onLateTerminal = async (late: LateRpcTerminal) => {
      if (connection.socket !== originalSocket) return;
      const terminal = late.outcome === 'success' ? terminalForResult(method, late.result)
        : record(late.error) && typeof late.error.message === 'string' ? rejected(late.error.code, late.error.data) : null;
      if (!terminal) return;
      await afterInitial;
      await saveObservation(operationId, { state: late.outcome === 'success' ? 'succeeded' : 'failed', terminal });
    };
    const completion = (async (): Promise<ConfigWriteCompletion> => {
      try {
        if (!connection.connected || connection.socket !== originalSocket) throw new RpcError('The original configuration connection changed before sending.', { status: 503 });
        const response = await connection.requestWithCursor(method, params, { mutating: true, onLateTerminal, retainLateUntilDisconnect: true });
        const terminal = terminalForResult(method, response?.result);
        if (!terminal || !Number.isSafeInteger(response.eventCursor) || response.eventCursor < 0) throw new Error('The original configuration response was not a valid terminal.');
        live.delete(operationId);
        return { outcome: 'success', response, ...await saveObservation(operationId, { state: 'succeeded', terminal }) };
      } catch (error) {
        const terminal = terminalForError(error);
        live.delete(operationId);
        if (terminal) return { outcome: 'error', error, ...await saveObservation(operationId, { state: 'failed', terminal }) };
        return { outcome: 'unknown', error, ...await saveObservation(operationId, { state: 'unknown' }) };
      } finally { live.delete(operationId); releaseInitial(); }
    })();
    return { outcome: 'started', operation, completion };
  }
  return { begin, status, retryTerminalSave, activeForFile };
}
