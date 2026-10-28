import { randomUUID } from 'node:crypto';
import { open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';

export type NativeStateRoot = Record<string, unknown>;
export type NativeStateCheckpoint = 'startup-file-sync' | 'startup-directory-sync' | 'file-sync' | 'rename' | 'directory-sync'
  | 'recovery-file-sync' | 'recovery-directory-sync';

export interface NativeStateOptions {
  dataDir: string;
  /** Publish the complete root in place. Never start another state transaction or business RPC here. */
  publish(root: NativeStateRoot): void | Promise<void>;
  /** Validate known sections without changing the supplied snapshot. Unknown sections must remain intact. */
  validate?(root: NativeStateRoot): void | Promise<void>;
  /** Fault injection immediately at the real file step; omit in production. */
  checkpoint?(step: NativeStateCheckpoint): void | Promise<void>;
}

export class NativeStateCommitError extends Error {
  /** This describes the file commit, not the delivery of any business request. */
  readonly uncertain: boolean;
  constructor(uncertain: boolean, cause?: unknown) {
    super(uncertain ? 'native-state 提交结果未确认，状态已隔离。' : 'native-state 未提交。', { cause });
    this.name = 'NativeStateCommitError';
    this.uncertain = uncertain;
  }
}

const isObject = (value: unknown): value is NativeStateRoot => value !== null && typeof value === 'object' && !Array.isArray(value);

// Reject values JSON would silently change. E uses undefined object properties
// to clear optional fields; array holes and undefined array items are not lossless.
function snapshotText(root: unknown): string {
  const parents = new Set<object>();
  function check(value: unknown, optional = false): void {
    if (value === undefined && optional) return;
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if (typeof value !== 'object' || value === null || parents.has(value)) throw new Error('native-state 包含无法保存的值。');
    const prototype = Object.getPrototypeOf(value);
    if (Array.isArray(value) ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
      throw new Error('native-state 包含无法保存的对象。');
    }
    if (Object.getOwnPropertySymbols(value).length) throw new Error('native-state 包含无法保存的字段。');
    parents.add(value);
    if (Array.isArray(value)) {
      if (Object.getOwnPropertyNames(value).length !== value.length + 1) throw new Error('native-state 数组无效。');
      for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw new Error('native-state 数组无效。');
        check(descriptor.value);
      }
    } else {
      for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
        if (!descriptor.enumerable || !('value' in descriptor)) throw new Error('native-state 字段无效。');
        check(descriptor.value, true);
      }
    }
    parents.delete(value);
  }
  if (!isObject(root)) throw new Error('native-state 根必须是对象。');
  check(root);
  const rawJSON = (JSON as typeof JSON & { rawJSON(value: string): unknown }).rawJSON;
  return JSON.stringify(root, (_key, value: unknown) => Object.is(value, -0) ? rawJSON('-0') : value, 2) + '\n';
}

function parseRoot(text: string): NativeStateRoot {
  const value: unknown = JSON.parse(text);
  if (!isObject(value)) throw new Error('native-state 根必须是对象。');
  snapshotText(value);
  return value;
}

/** Owns only native-state.json; callers serialize every read and write with the same StateMutations. */
export function createNativeState(options: NativeStateOptions) {
  const path = join(options.dataDir, 'native-state.json');
  let initialized = false, loading = false, committing = false, quarantined = false;

  async function validate(root: NativeStateRoot): Promise<void> {
    await options.validate?.(structuredClone(root));
  }
  async function publish(root: NativeStateRoot): Promise<void> {
    await options.publish(structuredClone(root));
  }
  function assertAvailable(): void {
    if (quarantined) throw new NativeStateCommitError(true);
    if (!initialized) throw new Error('native-state 尚未载入。');
    if (committing) throw new Error('native-state 提交正在进行。');
  }
  async function directorySync(step: 'startup-directory-sync' | 'directory-sync' | 'recovery-directory-sync'): Promise<void> {
    const directory = await open(options.dataDir, 'r');
    try { await options.checkpoint?.(step); await directory.sync(); }
    finally { await directory.close(); }
  }

  async function load(): Promise<NativeStateRoot> {
    if (initialized || loading) throw new Error('native-state 只能在启动时载入一次。');
    loading = true;
    try {
      let file: Awaited<ReturnType<typeof open>> | undefined;
      try { file = await open(path, 'r'); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      let root: NativeStateRoot;
      if (file) {
        try {
          root = parseRoot(await file.readFile({ encoding: 'utf8' }));
          await validate(root);
          await options.checkpoint?.('startup-file-sync');
          await file.sync();
        } finally { await file.close(); }
        await directorySync('startup-directory-sync');
      } else {
        root = {};
        await validate(root);
      }
      initialized = true;
      return root;
    } finally { loading = false; }
  }

  // Called inside the existing transaction, after its beforeAction hook.
  async function persist(input: NativeStateRoot): Promise<void> {
    assertAvailable();
    const temporary = join(options.dataDir, `native-state.${randomUUID()}.tmp`);
    committing = true;
    let created = false, renameStarted = false;
    try {
      const text = snapshotText(input);
      const root = parseRoot(text);
      await validate(root);
      const file = await open(temporary, 'wx', 0o600);
      created = true;
      try {
        await file.writeFile(text);
        await options.checkpoint?.('file-sync');
        await file.sync();
      } finally { await file.close(); }
      renameStarted = true;
      await rename(temporary, path);
      await options.checkpoint?.('rename');
      await directorySync('directory-sync');
      await publish(root);
    } catch (error) {
      if (renameStarted) quarantined = true;
      if (created && !renameStarted) { try { await unlink(temporary); } catch { /* Preserve the commit failure. */ } }
      throw new NativeStateCommitError(renameStarted, error);
    } finally { committing = false; }
  }

  // Called as the next transaction's beforeAction, never inside the failed caller.
  async function beforeAction(): Promise<void> {
    if (!initialized) throw new Error('native-state 尚未载入。');
    if (committing) throw new Error('native-state 提交正在进行。');
    if (!quarantined) return;
    try {
      const file = await open(path, 'r');
      let root: NativeStateRoot;
      try {
        root = parseRoot(await file.readFile({ encoding: 'utf8' }));
        await validate(root);
        await options.checkpoint?.('recovery-file-sync');
        await file.sync();
      } finally { await file.close(); }
      await directorySync('recovery-directory-sync');
      await publish(root);
      quarantined = false;
    } catch (error) {
      throw new NativeStateCommitError(true, error);
    }
  }

  return { load, persist, beforeAction, assertAvailable };
}
