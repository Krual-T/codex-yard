import { isDeepStrictEqual } from 'node:util';
import type { SideChatEndpointStore } from './side-chat-host.ts';
import type { SideChatOperation } from './side-chat.ts';
import type { StateMutations } from './state-mutations.ts';

type Value = Record<string, unknown>;

interface Section extends Value {
  version: 1;
  operations: Record<string, SideChatOperation>;
  prepared: Record<string, string>;
}

export interface SideChatStoreOptions {
  /** The same transaction queue used by every native-state.json consumer. */
  mutations: StateMutations;
  /** Return the committed section, or undefined if it does not exist. Throw while native state is quarantined. */
  read(): unknown;
  /**
   * Commit and publish this section within the already-held transaction. On an ambiguous
   * failure the state owner must quarantine all native-state readers and writers until
   * the complete file has been reconciled; a possibly committed snapshot is not a rollback.
   */
  persist(section: unknown): Promise<void>;
}

const object = (value: unknown): value is Value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const invalid = () => new Error('侧聊持久记录无法安全读取或更新，原记录已保留。');

// Native state is JSON. Reject values JSON would silently change, except optional
// object properties set to undefined by E to clear fields.
function jsonCopy<T>(value: T): T {
  const parents = new Set<object>();
  function check(item: unknown, optional = false): void {
    if (item === undefined && optional) return;
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return;
    if (typeof item === 'number' && Number.isFinite(item) && !Object.is(item, -0)) return;
    if (typeof item !== 'object' || item === null || parents.has(item)) throw invalid();
    const prototype = Object.getPrototypeOf(item);
    if (Array.isArray(item) ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw invalid();
    if (Object.getOwnPropertySymbols(item).length) throw invalid();
    parents.add(item);
    if (Array.isArray(item)) {
      if (Object.getOwnPropertyNames(item).length !== item.length + 1) throw invalid();
      for (let index = 0; index < item.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw invalid();
        check(descriptor.value);
      }
    } else {
      for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(item))) {
        if (!descriptor.enumerable || !('value' in descriptor)) throw invalid();
        check(descriptor.value, true);
      }
    }
    parents.delete(item);
  }
  check(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function operation(value: unknown, id?: string): value is SideChatOperation {
  if (!object(value) || value.version !== 1 || !nonempty(value.operationId) || (id !== undefined && value.operationId !== id)
    || !object(value.parent) || !nonempty(value.parent.hostId) || !nonempty(value.parent.threadId)
    || !nonempty(value.parent.connectionGeneration) || !nonempty(value.parent.cwd)
    || !Array.isArray(value.parent.workspaceRoots) || value.parent.workspaceRoots.some(root => !nonempty(root))
    || typeof value.parent.archived !== 'boolean' || !nonempty(value.parent.model) || !nonempty(value.parent.modelProvider)
    || !(value.parent.effort === null || typeof value.parent.effort === 'string')
    || !(value.parent.serviceTier === null || typeof value.parent.serviceTier === 'string')
    || !object(value.parent.submitOptions) || !object(value.parent.sandboxPolicy)
    || !['thread-override', 'host-config'].includes(String(value.instructionSource))
    || !(value.configuredInstructions === null || typeof value.configuredInstructions === 'string')
    || !object(value.forkParams) || !Array.isArray(value.boundaryItems)
    || !object(value.fork) || !nonempty(value.fork.status) || !object(value.inject) || !nonempty(value.inject.status)
    || !object(value.close) || !nonempty(value.close.status) || typeof value.close.requested !== 'boolean') return false;
  return true;
}

function sectionOf(raw: unknown): Section {
  if (raw === undefined) return { version: 1, operations: {}, prepared: {} };
  const value = jsonCopy(raw);
  if (!object(value) || value.version !== 1 || !object(value.operations) || !object(value.prepared)) throw invalid();
  for (const [id, item] of Object.entries(value.operations)) {
    if (!nonempty(id) || !operation(item, id)) throw invalid();
  }
  for (const [id, operationId] of Object.entries(value.prepared)) {
    if (!nonempty(id) || !nonempty(operationId) || !Object.hasOwn(value.operations, operationId)) throw invalid();
  }
  return value as Section;
}

function extensionFields(value: Value, known: readonly string[]): Value {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !known.includes(key)));
}

const operationFields = ['version', 'operationId', 'parent', 'instructionSource', 'configuredInstructions',
  'forkParams', 'boundaryItems', 'fork', 'childId', 'inject', 'close'];
const requestFields = ['status', 'attemptId', 'receipt', 'terminalError', 'error'];
const closeFields = [...requestFields, 'requested'];
const fenceFields = ['version', 'ownerId', 'origin', 'token', 'recovering', 'active'];
const originFields = ['hostId', 'parentThreadId', 'operationId', 'connectionGeneration'];
const activeFields = ['action', 'ownerId', 'callId'];

function preserveExtensions(previous: SideChatOperation, next: SideChatOperation): SideChatOperation {
  const before = previous as unknown as Value, after = next as unknown as Value;
  const result: Value = { ...extensionFields(before, operationFields), ...after };
  for (const key of ['fork', 'inject', 'close'] as const) {
    const oldState = before[key], newState = after[key];
    if (object(oldState) && object(newState)) {
      result[key] = { ...extensionFields(oldState, key === 'close' ? closeFields : requestFields), ...newState };
    }
  }
  const oldFence = before.endpointFence, newFence = after.endpointFence;
  if (object(oldFence) && object(newFence) && oldFence.version === 1 && newFence.version === 1) {
    const fence: Value = { ...extensionFields(oldFence, fenceFields), ...newFence };
    if (object(oldFence.origin) && object(newFence.origin)) {
      fence.origin = { ...extensionFields(oldFence.origin, originFields), ...newFence.origin };
    }
    if (object(oldFence.active) && object(newFence.active) && oldFence.active.callId === newFence.active.callId
      && oldFence.active.ownerId === newFence.active.ownerId && oldFence.active.action === newFence.active.action) {
      fence.active = { ...extensionFields(oldFence.active, activeFields), ...newFence.active };
    }
    result.endpointFence = fence;
  }
  return result as unknown as SideChatOperation;
}

/** Durable operations and the prepare index share the host's existing native-state transaction. */
export function createSideChatStore(options: SideChatStoreOptions): SideChatEndpointStore {
  const { mutations, read, persist } = options;
  const load = () => sectionOf(read());
  async function commit(next: Section): Promise<void> {
    await persist(jsonCopy(next));
    if (!isDeepStrictEqual(load(), next)) throw invalid();
  }
  function checked(input: SideChatOperation): SideChatOperation {
    const copy = jsonCopy(input);
    if (!operation(copy)) throw invalid();
    return copy;
  }
  function id(value: string): void { if (!nonempty(value)) throw invalid(); }

  return {
    async create(input) {
      const candidate = checked(input);
      await mutations.run(async () => {
        const current = load();
        if (Object.hasOwn(current.operations, candidate.operationId)) throw invalid();
        await commit({ ...current, operations: { ...current.operations, [candidate.operationId]: candidate } });
      });
    },
    async read(operationId) {
      id(operationId);
      return mutations.run(() => {
        const current = load();
        return Object.hasOwn(current.operations, operationId) ? jsonCopy(current.operations[operationId]) : null;
      });
    },
    async update(operationId, update) {
      id(operationId);
      return mutations.run(async () => {
        const current = load();
        if (!Object.hasOwn(current.operations, operationId)) throw invalid();
        const previous = current.operations[operationId];
        const candidate = checked(update(jsonCopy(previous)));
        if (candidate.operationId !== operationId || !isDeepStrictEqual(candidate.parent, previous.parent)
          || candidate.instructionSource !== previous.instructionSource
          || candidate.configuredInstructions !== previous.configuredInstructions
          || !isDeepStrictEqual(candidate.forkParams, previous.forkParams)
          || !isDeepStrictEqual(candidate.boundaryItems, previous.boundaryItems)) throw invalid();
        const next = preserveExtensions(previous, candidate);
        await commit({ ...current, operations: { ...current.operations, [operationId]: next } });
        return jsonCopy(next);
      });
    },
    async readPrepared(prepareId) {
      id(prepareId);
      return mutations.run(() => {
        const current = load();
        if (!Object.hasOwn(current.prepared, prepareId)) return null;
        return jsonCopy(current.operations[current.prepared[prepareId]]);
      });
    },
    async createPrepared(prepareId, input) {
      id(prepareId);
      const candidate = checked(input);
      return mutations.run(async () => {
        const current = load();
        if (Object.hasOwn(current.prepared, prepareId)) {
          const existing = current.operations[current.prepared[prepareId]];
          if (existing.parent.hostId !== candidate.parent.hostId || existing.parent.threadId !== candidate.parent.threadId
            || existing.parent.connectionGeneration !== candidate.parent.connectionGeneration) throw invalid();
          return jsonCopy(existing);
        }
        if (Object.hasOwn(current.operations, candidate.operationId)) throw invalid();
        const next: Section = { ...current, operations: { ...current.operations, [candidate.operationId]: candidate },
          prepared: { ...current.prepared, [prepareId]: candidate.operationId } };
        await commit(next);
        return jsonCopy(candidate);
      });
    },
  };
}
