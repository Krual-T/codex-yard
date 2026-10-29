import { isDeepStrictEqual } from 'node:util';
import WebSocket from 'ws';
import { RpcError } from '../../lib/codex.ts';
import type { CodexConnection } from '../../lib/codex.ts';
import type { LateRpcTerminal } from '../../lib/codex-protocol.ts';
import type { StateMutations } from './state-mutations.ts';

type ObjectValue = Record<string, unknown>;

export interface SendInjectionReference {
  hostId: string;
  threadId: string;
  intentId: string;
  injectionAttemptId: string;
  callId: string;
  clientUserMessageId: string;
  owner: { hostId: string; threadId: string | null; draftId: string };
  revision: string;
  connectionGeneration: string;
}

/** Captured by the server before entering its existing conversationWrite interval. */
export interface SendInjectionOriginal {
  connection: CodexConnection;
  socket: WebSocket;
  generation: string;
  /** Must synchronously verify the original page, owner, revision and daemon connection. */
  assertOriginal(reference: SendInjectionReference): void;
  /** Required for a new turn connection; verifies actual resume and the same backend lifecycle. */
  assertResumedContinuity?(reference: SendInjectionReference): void;
}

export interface SendInjectionInput {
  reference: SendInjectionReference;
  items: ObjectValue[];
  turnParams: ObjectValue;
}

export type SendInjectionTerminal =
  | { kind: 'injected' }
  | { kind: 'accepted'; result: ObjectValue }
  | { kind: 'rejected'; code: string | number }
  | { kind: 'not-sent'; reason: 'original-changed' | 'idle-unconfirmed' | 'storage-failed' | 'transport-unavailable' };
type InjectionPhase = 'preparing' | 'sending' | 'unknown' | 'injected' | 'rejected' | 'not-sent';
type TurnPhase = 'waiting' | 'preparing' | 'sending' | 'unknown' | 'accepted' | 'rejected' | 'not-sent';
interface InjectionState { phase: InjectionPhase; terminal?: SendInjectionTerminal }
interface TurnState { phase: TurnPhase; attemptId?: string; attempts: string[]; connectionGeneration?: string; terminal?: SendInjectionTerminal }
interface StoredOperation {
  reference: SendInjectionReference;
  items: ObjectValue[];
  turnParams: ObjectValue;
  injection: InjectionState;
  turn: TurnState;
}
interface Section extends ObjectValue { version: 1; operations: StoredOperation[] }
type Step = 'injection' | 'turn';
export interface SendInjectionReceiptIdentity { step: Step; attemptId: string }
interface Observation {
  reference: SendInjectionReference;
  step: Step;
  attemptId: string;
  connectionGeneration: string;
  terminal: SendInjectionTerminal | null;
  /** Only used when the original reservation itself could not be confirmed. */
  reservation?: StoredOperation;
}
export interface SendInjectionStatus {
  reference: SendInjectionReference;
  injection: InjectionState;
  turn: TurnState;
  /** A terminal was received by this host but its native-state commit failed. */
  pendingPersistence: { step: Step; attemptId: string; terminal: SendInjectionTerminal | null } | null;
}
export interface SendInjectionOptions {
  mutations: StateMutations;
  assertStateAvailable(): void;
  readSection(): unknown;
  /** Persist the section in the existing full native-state root, within the supplied transaction. */
  persistSection(section: unknown): Promise<void>;
  /** Hint matching pages to query the original status; this is not itself a receipt. */
  onChange?(reference: SendInjectionReference, receipt: SendInjectionReceiptIdentity): void;
}

const object = (value: unknown): value is ObjectValue => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
  && value.length <= 4096 && !value.includes('\0');
const clone = <T>(value: T): T => structuredClone(value);
const key = (reference: SendInjectionReference) => JSON.stringify([reference.hostId, reference.intentId, reference.injectionAttemptId]);
const threadKey = (hostId: string, threadId: string) => JSON.stringify([hostId, threadId]);
const observationKey = (event: Observation) => JSON.stringify([key(event.reference), event.step, event.attemptId]);
const injectionPhases: readonly InjectionPhase[] = ['preparing', 'sending', 'unknown', 'injected', 'rejected', 'not-sent'];
const turnPhases: readonly TurnPhase[] = ['waiting', 'preparing', 'sending', 'unknown', 'accepted', 'rejected', 'not-sent'];

function jsonValue(value: unknown, parents = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || value === null || parents.has(value) || Object.getOwnPropertySymbols(value).length) return false;
  const prototype = Object.getPrototypeOf(value);
  if (Array.isArray(value) ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Array.isArray(value) && (Object.keys(descriptors).length !== value.length + 1
    || Array.from({ length: value.length }, (_, index) => Object.hasOwn(descriptors, String(index))).some(present => !present))) return false;
  parents.add(value);
  const valid = Object.entries(descriptors).every(([name, descriptor]) => name === 'length' && Array.isArray(value)
    || descriptor.enumerable && 'value' in descriptor && jsonValue(descriptor.value, parents));
  parents.delete(value);
  return valid;
}

function validReference(value: unknown): value is SendInjectionReference {
  if (!object(value) || !object(value.owner)) return false;
  return Object.keys(value).length === 9 && Object.keys(value.owner).length === 3 && jsonValue(value)
    && id(value.hostId) && id(value.threadId) && id(value.intentId) && id(value.injectionAttemptId)
    && id(value.callId) && id(value.clientUserMessageId) && id(value.revision) && id(value.connectionGeneration)
    && value.owner.hostId === value.hostId && id(value.owner.draftId)
    && (value.owner.threadId === null || value.owner.threadId === value.threadId);
}

function validPayload(reference: SendInjectionReference, items: unknown, turnParams: unknown): boolean {
  return Array.isArray(items) && items.length === 2 && items.every(object) && jsonValue(items)
    && items[0].type === 'function_call' && items[0].call_id === reference.callId
    && items[0].name === 'untrusted_input' && items[0].arguments === '{}'
    && Object.keys(items[0]).every(key => ['type', 'call_id', 'name', 'arguments'].includes(key))
    && items[1].type === 'function_call_output' && items[1].call_id === reference.callId
    && Object.keys(items[1]).every(key => ['type', 'call_id', 'output'].includes(key))
    && Array.isArray(items[1].output) && items[1].output.length > 0 && items[1].output.every((item: unknown) => object(item)
      && (item.type === 'input_text' && typeof item.text === 'string' && Object.keys(item).every(key => ['type', 'text'].includes(key))
        || item.type === 'input_image' && typeof item.image_url === 'string' && Object.keys(item).every(key => ['type', 'image_url'].includes(key))))
    && object(turnParams) && jsonValue(turnParams) && turnParams.threadId === reference.threadId
    && turnParams.clientUserMessageId === reference.clientUserMessageId && Array.isArray(turnParams.input)
    && turnParams.input.length > 0 && turnParams.input.every(object);
}

function validTerminal(value: unknown, step: Step, phase: string): boolean {
  if (phase === 'preparing' || phase === 'sending' || phase === 'unknown' || phase === 'waiting') return value === undefined;
  if (!object(value) || value.kind !== phase) return false;
  if (value.kind === 'injected') return step === 'injection';
  if (value.kind === 'accepted') return step === 'turn' && object(value.result) && jsonValue(value.result)
    && object(value.result.turn) && id(value.result.turn.id);
  if (value.kind === 'rejected') return typeof value.code === 'string' && id(value.code)
    || typeof value.code === 'number' && Number.isSafeInteger(value.code);
  return value.kind === 'not-sent' && ['original-changed', 'idle-unconfirmed', 'storage-failed', 'transport-unavailable'].includes(String(value.reason));
}

function active(operation: StoredOperation): boolean {
  return !['not-sent', 'rejected'].includes(operation.injection.phase) && operation.turn.phase !== 'accepted';
}

function section(value: unknown): Section {
  if (value === undefined) return { version: 1, operations: [] };
  if (!object(value) || value.version !== 1 || !Array.isArray(value.operations)) throw new Error('原注入记录无法安全读取，会话写入已暂停。');
  const identities = new Set<string>(), activeThreads = new Set<string>();
  for (const item of value.operations) {
    if (!object(item) || !validReference(item.reference) || !validPayload(item.reference, item.items, item.turnParams)
      || !object(item.injection) || !injectionPhases.includes(item.injection.phase as InjectionPhase)
      || !validTerminal(item.injection.terminal, 'injection', String(item.injection.phase))
      || !object(item.turn) || !turnPhases.includes(item.turn.phase as TurnPhase) || !Array.isArray(item.turn.attempts)
      || !item.turn.attempts.every(id) || new Set(item.turn.attempts).size !== item.turn.attempts.length
      || (item.turn.phase === 'waiting' ? item.turn.attemptId !== undefined || item.turn.connectionGeneration !== undefined || item.turn.attempts.length !== 0
        : !id(item.turn.attemptId) || item.turn.attempts.at(-1) !== item.turn.attemptId
          || item.turn.connectionGeneration !== undefined && !id(item.turn.connectionGeneration))
      || !validTerminal(item.turn.terminal, 'turn', String(item.turn.phase))
      || item.injection.phase !== 'injected' && item.turn.phase !== 'waiting') {
      throw new Error('原注入记录无法安全读取，会话写入已暂停。');
    }
    const operation = item as unknown as StoredOperation, identity = key(operation.reference);
    if (identities.has(identity)) throw new Error('原注入身份存在冲突，会话写入已暂停。');
    identities.add(identity);
    if (active(operation)) {
      const thread = threadKey(operation.reference.hostId, operation.reference.threadId);
      if (activeThreads.has(thread)) throw new Error('原会话存在多个未结注入，会话写入已暂停。');
      activeThreads.add(thread);
    }
  }
  return clone(value) as Section;
}

function matching(operations: StoredOperation[], reference: SendInjectionReference): StoredOperation | undefined {
  const found = operations.find(item => key(item.reference) === key(reference));
  if (found && !isDeepStrictEqual(found.reference, reference)) throw new Error('原注入身份不匹配，未修改原记录。');
  return found;
}

function assertConnection(original: SendInjectionOriginal, reference: SendInjectionReference, step: Step): void {
  if (!original || !id(original.generation) || !original.connection?.connected
    || original.connection.socket !== original.socket || original.socket?.readyState !== WebSocket.OPEN) {
    throw new Error('原 Codex 连接已改变。');
  }
  if (original.generation !== reference.connectionGeneration) {
    if (step !== 'turn' || !original.assertResumedContinuity) throw new Error('尚不能确认原会话的后端生命周期。');
    const resumed = original.assertResumedContinuity(reference);
    if (resumed !== undefined) {
      void Promise.resolve(resumed).catch(() => {});
      throw new Error('恢复后的原会话必须同步核对。');
    }
  }
  const result = original.assertOriginal(reference);
  if (result !== undefined) {
    void Promise.resolve(result).catch(() => {});
    throw new Error('原发送权限必须同步核对。');
  }
}

function captureOriginal(original: SendInjectionOriginal): SendInjectionOriginal {
  if (!original || typeof original.assertOriginal !== 'function') throw new Error('缺少原发送权限。');
  return { connection: original.connection, socket: original.socket, generation: original.generation,
    assertOriginal: original.assertOriginal.bind(original),
    ...(original.assertResumedContinuity ? { assertResumedContinuity: original.assertResumedContinuity.bind(original) } : {}) };
}

function terminalFor(step: Step, terminal: LateRpcTerminal): SendInjectionTerminal | null {
  if (terminal.outcome === 'error') {
    const code = terminal.error.code;
    return code === -32600 || code === -32601 || code === -32602 ? { kind: 'rejected', code } : null;
  }
  if (step === 'injection') return object(terminal.result) && Object.keys(terminal.result).length === 0 ? { kind: 'injected' } : null;
  return object(terminal.result) && jsonValue(terminal.result) && object(terminal.result.turn) && id(terminal.result.turn.id)
    ? { kind: 'accepted', result: clone(terminal.result) } : null;
}

function failure(error: unknown): SendInjectionTerminal | null {
  if (!(error instanceof RpcError) || error.uncertain) return null;
  if (error.status === 503 || error.code === 'OBSERVER_LIMIT') return { kind: 'not-sent', reason: 'transport-unavailable' };
  if (error.status !== 502 || error.message === 'Codex 返回了无效错误。') return null;
  return error.code === -32600 || error.code === -32601 || error.code === -32602
    ? { kind: 'rejected', code: error.code } : null;
}

/** Existing native-state holds the fence; every Yard write must use the parent's conversationWrite interval. */
export function createSendInjection(options: SendInjectionOptions) {
  const observed = new Map<string, Observation>();

  function read(): Section { options.assertStateAvailable(); return section(options.readSection()); }
  async function save(value: Section): Promise<void> { await options.persistSection(clone(value)); }
  function statusOf(operation: StoredOperation): SendInjectionStatus {
    const event = [...observed.values()].find(value => isDeepStrictEqual(value.reference, operation.reference));
    return clone({ reference: operation.reference, injection: operation.injection, turn: operation.turn,
      pendingPersistence: event ? { step: event.step, attemptId: event.attemptId, terminal: event.terminal } : null });
  }
  function notify(event: Observation): void {
    try { void Promise.resolve(options.onChange?.(clone(event.reference), { step: event.step, attemptId: event.attemptId })).catch(() => {}); }
    catch { /* A notification failure must not change the original receipt. */ }
  }
  function remember(event: Observation): void {
    const existing = observed.get(observationKey(event));
    if (!existing || event.terminal !== null || existing.terminal === null) {
      if (!isDeepStrictEqual(existing, event)) {
        observed.set(observationKey(event), clone(event));
        notify(event);
      }
    }
  }
  async function settle(event: Observation): Promise<SendInjectionStatus | null> {
    try {
      const result = await options.mutations.run(async () => {
        const current = read();
        let operation = matching(current.operations, event.reference);
        if (!operation && event.reservation) {
          if (event.step !== 'injection') throw new Error('原发送记录不存在，无法补存。');
          operation = clone(event.reservation);
          current.operations.push(operation);
        }
        if (!operation) return null;
        if (event.reservation && (!isDeepStrictEqual(operation.items, event.reservation.items)
          || !isDeepStrictEqual(operation.turnParams, event.reservation.turnParams))) {
          throw new Error('原注入内容已改变，无法补存。');
        }
        if (event.step === 'turn' && event.reservation && operation.turn.attemptId !== event.attemptId
          && ['waiting', 'not-sent', 'rejected'].includes(operation.turn.phase)
          && isDeepStrictEqual(operation.turn.attempts, event.reservation.turn.attempts.slice(0, -1))
          && !operation.turn.attempts.includes(event.attemptId)) operation.turn = clone(event.reservation.turn);
        const state = event.step === 'injection' ? operation.injection : operation.turn;
        const sameAttempt = event.step === 'injection' ? event.attemptId === operation.reference.injectionAttemptId
          && event.connectionGeneration === operation.reference.connectionGeneration
          : operation.turn.attemptId === event.attemptId
            && event.connectionGeneration === (operation.turn.connectionGeneration ?? operation.reference.connectionGeneration);
        if (sameAttempt && ['preparing', 'sending', 'unknown'].includes(state.phase)) {
          state.phase = (event.terminal?.kind ?? 'unknown') as never;
          if (event.terminal) state.terminal = clone(event.terminal); else delete state.terminal;
          await save(current);
        } else if (event.reservation && operation.injection.phase === 'preparing') {
          throw new Error('原注入恢复身份已改变。');
        }
        return operation;
      });
      if (observed.get(observationKey(event)) === event) observed.delete(observationKey(event));
      else {
        const remembered = observed.get(observationKey(event));
        if (remembered && isDeepStrictEqual(remembered, event)) observed.delete(observationKey(event));
      }
      notify(event);
      return result ? statusOf(result) : null;
    } catch (error) { remember(event); throw error; }
  }

  async function retain(event: Observation, fallback: StoredOperation): Promise<SendInjectionStatus> {
    try { return await settle(event) ?? statusOf(fallback); }
    catch { remember(event); return statusOf(fallback); }
  }

  async function assertCanWrite(hostId: string, threadId: string, reference?: SendInjectionReference): Promise<void> {
    if (!id(hostId) || !id(threadId) || reference && (!validReference(reference)
      || reference.hostId !== hostId || reference.threadId !== threadId)) throw new Error('会话写入身份无效。');
    await options.mutations.run(() => {
      const current = read();
      const blocking = current.operations.find(value => value.reference.hostId === hostId && value.reference.threadId === threadId && active(value));
      if (blocking && (!reference || !isDeepStrictEqual(blocking.reference, reference))) {
        throw new Error('此会话有尚未结算的原上下文注入，请先核对原发送。');
      }
    });
  }

  async function status(reference: SendInjectionReference): Promise<SendInjectionStatus | null> {
    if (!validReference(reference)) throw new Error('原注入身份无效。');
    return options.mutations.run(() => {
      const operation = matching(read().operations, reference)
        ?? [...observed.values()].find(value => value.reservation && isDeepStrictEqual(value.reference, reference))?.reservation;
      return operation ? statusOf(operation) : null;
    });
  }

  async function retryPersistence(reference: SendInjectionReference, receipt: SendInjectionReceiptIdentity): Promise<SendInjectionStatus | null> {
    if (!validReference(reference) || !receipt || !['injection', 'turn'].includes(receipt.step) || !id(receipt.attemptId)
      || receipt.step === 'injection' && receipt.attemptId !== reference.injectionAttemptId) throw new Error('原回执身份无效。');
    const event = observed.get(observationKey({ reference, ...receipt, connectionGeneration: reference.connectionGeneration, terminal: null }));
    if (event && !isDeepStrictEqual(event.reference, reference)) throw new Error('原注入身份不匹配，未修改原记录。');
    if (event) await settle(event);
    return status(reference);
  }

  async function idle(reference: SendInjectionReference, original: SendInjectionOriginal, step: Step): Promise<void> {
    const pending = await options.mutations.run(() => {
      read();
      assertConnection(original, reference, step);
      return { reply: original.connection.request('thread/read', { threadId: reference.threadId, includeTurns: false }) };
    });
    const reply: unknown = await pending.reply;
    if (!object(reply) || !object(reply.thread) || reply.thread.id !== reference.threadId
      || !object(reply.thread.status) || reply.thread.status.type !== 'idle') throw new Error('原会话尚未确认空闲。');
  }

  async function dispatch(reference: SendInjectionReference, original: SendInjectionOriginal, step: Step,
    attemptId: string, fallback: StoredOperation): Promise<SendInjectionStatus> {
    let checkedReservation = false;
    try {
      await options.mutations.run(async () => {
        const current = read(), operation = matching(current.operations, reference);
        if (!operation) throw new Error('原发送记录不存在。');
        const state = step === 'injection' ? operation.injection : operation.turn;
        if (state.phase !== 'preparing' || step === 'turn' && (operation.turn.attemptId !== attemptId
          || operation.turn.connectionGeneration !== original.generation)) {
          throw new Error('原发送尝试已改变。');
        }
        checkedReservation = true;
        state.phase = 'sending';
        await save(current);
        assertConnection(original, reference, step);
      });
    } catch (error) {
      if (!checkedReservation) throw error;
      const reason = (() => { try { assertConnection(original, reference, step); return 'storage-failed' as const; }
        catch { return 'original-changed' as const; } })();
      return retain({ reference, step, attemptId, connectionGeneration: original.generation, terminal: { kind: 'not-sent', reason } }, fallback);
    }
    try { await idle(reference, original, step); }
    catch {
      const reason = (() => { try { assertConnection(original, reference, step); return 'idle-unconfirmed' as const; }
        catch { return 'original-changed' as const; } })();
      return retain({ reference, step, attemptId, connectionGeneration: original.generation, terminal: { kind: 'not-sent', reason } }, fallback);
    }
    let pending: { reply: Promise<unknown> };
    try {
      pending = await options.mutations.run(() => {
        const current = read(), operation = matching(current.operations, reference);
        if (!operation) throw new Error('原发送记录不存在。');
        const state = step === 'injection' ? operation.injection : operation.turn;
        if (state.phase !== 'sending' || step === 'turn' && (operation.turn.attemptId !== attemptId
          || operation.turn.connectionGeneration !== original.generation)) {
          throw new Error('原发送尝试已改变。');
        }
        assertConnection(original, reference, step);
        const method = step === 'injection' ? 'thread/inject_items' : 'turn/start';
        const params = step === 'injection' ? { threadId: reference.threadId, items: clone(operation.items) } : clone(operation.turnParams);
        return { reply: original.connection.request(method, params, { mutating: true, retainLateUntilDisconnect: true,
          onLateTerminal: terminal => {
            const event: Observation = { reference: clone(reference), step, attemptId, connectionGeneration: original.generation,
              terminal: terminalFor(step, terminal) };
            void settle(event).catch(() => {});
          } }) };
      });
    } catch {
      const reason = (() => { try { assertConnection(original, reference, step); return 'storage-failed' as const; }
        catch { return 'original-changed' as const; } })();
      return retain({ reference, step, attemptId, connectionGeneration: original.generation, terminal: { kind: 'not-sent', reason } }, fallback);
    }
    let terminal: SendInjectionTerminal | null;
    try { terminal = terminalFor(step, { outcome: 'success', result: await pending.reply }); }
    catch (error) { terminal = failure(error); }
    return retain({ reference, step, attemptId, connectionGeneration: original.generation, terminal }, fallback);
  }

  async function inject(input: SendInjectionInput, origin: SendInjectionOriginal): Promise<SendInjectionStatus> {
    if (!input || !validReference(input.reference) || !validPayload(input.reference, input.items, input.turnParams)) {
      throw new Error('原注入请求身份或内容无效，未发送。');
    }
    const original = captureOriginal(origin), reference = clone(input.reference), operation: StoredOperation = { reference, items: clone(input.items), turnParams: clone(input.turnParams),
      injection: { phase: 'preparing' }, turn: { phase: 'waiting', attempts: [] } };
    let existing: StoredOperation | undefined;
    let reservationStarted = false;
    try {
      existing = await options.mutations.run(async () => {
        const current = read(), previous = matching(current.operations, reference);
        if (previous) {
          if (!isDeepStrictEqual(previous.items, operation.items) || !isDeepStrictEqual(previous.turnParams, operation.turnParams)) {
            throw new Error('原注入内容已改变，未重复发送。');
          }
          return previous;
        }
        const unpersisted = [...observed.values()].find(value => value.step === 'injection' && value.reservation
          && key(value.reference) === key(reference));
        if (unpersisted?.reservation) {
          if (!isDeepStrictEqual(unpersisted.reference, reference) || !isDeepStrictEqual(unpersisted.reservation.items, operation.items)
            || !isDeepStrictEqual(unpersisted.reservation.turnParams, operation.turnParams)) {
            throw new Error('原注入身份或内容已改变，未重复发送。');
          }
          return unpersisted.reservation;
        }
        if ([...observed.values()].some(value => value.step === 'injection' && value.reservation
          && value.reference.hostId === reference.hostId && value.reference.threadId === reference.threadId)) {
          throw new Error('原注入的未发送回执尚未保存，请先补存。');
        }
        if (current.operations.some(value => value.reference.hostId === reference.hostId
          && value.reference.threadId === reference.threadId && active(value))) throw new Error('此会话已有待核对的原注入。');
        assertConnection(original, reference, 'injection');
        current.operations.push(operation);
        reservationStarted = true;
        await save(current);
        return undefined;
      });
    } catch (error) {
      // No request is made if reservation or original authority failed.
      if (!reservationStarted) throw error;
      const event: Observation = { reference, step: 'injection', attemptId: reference.injectionAttemptId,
        connectionGeneration: reference.connectionGeneration,
        terminal: { kind: 'not-sent', reason: 'storage-failed' }, reservation: operation };
      remember(event);
      return statusOf(operation);
    }
    if (existing) return statusOf(existing);
    return dispatch(reference, original, 'injection', reference.injectionAttemptId, operation);
  }

  async function startTurn(input: { reference: SendInjectionReference; turnAttemptId: string },
    origin: SendInjectionOriginal): Promise<SendInjectionStatus> {
    if (!input || !validReference(input.reference) || !id(input.turnAttemptId)) throw new Error('原发送身份无效，未发送。');
    const original = captureOriginal(origin), reference = clone(input.reference), attemptId = input.turnAttemptId;
    let reservation: StoredOperation | undefined;
    let prepared: { operation: StoredOperation; existing: boolean };
    try {
      prepared = await options.mutations.run(async () => {
        const current = read(), operation = matching(current.operations, reference);
        if (!operation || operation.injection.phase !== 'injected') throw new Error('原上下文注入尚未确认，未发送消息。');
        const pending = [...observed.values()].find(value => isDeepStrictEqual(value.reference, reference));
        if (pending) {
          if (pending.step === 'turn' && pending.attemptId === attemptId) {
            return { operation: pending.reservation ?? operation, existing: true };
          }
          throw new Error('原发送回执尚未保存，请先补存。');
        }
        if (operation.turn.attempts.includes(attemptId)) return { operation, existing: true };
        if (!['waiting', 'not-sent', 'rejected'].includes(operation.turn.phase)) throw new Error('原消息结果尚未确认，未重复发送。');
        assertConnection(original, reference, 'turn');
        operation.turn = { phase: 'preparing', attemptId, attempts: [...operation.turn.attempts, attemptId], connectionGeneration: original.generation };
        reservation = clone(operation);
        await save(current);
        return { operation, existing: false };
      });
    } catch (error) {
      if (!reservation) throw error;
      const event: Observation = { reference, step: 'turn', attemptId,
        connectionGeneration: original.generation,
        terminal: { kind: 'not-sent', reason: 'storage-failed' }, reservation };
      remember(event);
      return statusOf(reservation);
    }
    if (prepared.existing) return statusOf(prepared.operation);
    return dispatch(reference, original, 'turn', attemptId, prepared.operation);
  }

  return { assertCanWrite, inject, startTurn, status, retryPersistence };
}
