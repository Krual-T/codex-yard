import { composerDraftAtomKey, updateComposerDraftVersionInRoot } from '../composer/composer-draft-store.ts';
import type { ComposerDraftSnapshot } from '../composer/composer-draft-store.ts';
import { createId } from '../composer/standalone-draft.ts';
import type { ComposerDraft } from '../workbench-contract.ts';
import type { BrowserOwner } from './comments.ts';

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Compare complete structured data, including fields unknown to this renderer. */
export function sameBrowserValue(a: unknown, b: unknown): boolean {
  const visited = new WeakMap<object, WeakSet<object>>();
  const compare = (left: unknown, right: unknown): boolean => {
    if (Object.is(left, right)) return true;
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
    if (Array.isArray(left) !== Array.isArray(right)) return false;
    if (Array.isArray(left) && Array.isArray(right) && left.length !== right.length) return false;
    const prototype = Object.getPrototypeOf(left);
    if (prototype !== Object.getPrototypeOf(right) || prototype !== Object.prototype && prototype !== null && prototype !== Array.prototype) return false;
    if (visited.get(left)?.has(right)) return true;
    const matches = visited.get(left) ?? new WeakSet<object>();
    matches.add(right); visited.set(left, matches);
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key)
      && compare((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
  };
  return compare(a, b);
}

export function updateBrowserDraftVersion(atoms: Readonly<Record<string, unknown>>, owner: BrowserOwner,
  snapshot: ComposerDraftSnapshot, change: (draft: ComposerDraft) => ComposerDraft): { repository: unknown; snapshot: ComposerDraftSnapshot } {
  const source = snapshot.owner;
  if (!snapshot.revision || source.hostId !== owner.hostId || source.draftId !== owner.draftId) throw new Error('草稿身份已改变，请重新核对。');
  if (source.threadId === null) {
    if (owner.threadId !== null) throw new Error('草稿与浏览器引用的会话关联无法核实。');
  } else {
    const sends = atoms['codex-yard.send-recovery.v1'];
    if (sends !== undefined && (!record(sends) || !record(sends.bindings))) {
      throw new Error('草稿与浏览器引用的会话关联无法核实。');
    }
    const binding = record(sends) && record(sends.bindings) ? sends.bindings[JSON.stringify([source.hostId, source.threadId])] : undefined;
    if (binding !== undefined && typeof binding !== 'string') throw new Error('草稿与浏览器引用的会话关联无法核实。');
    const expectedThread = binding === source.draftId ? null : source.threadId;
    if (owner.threadId !== expectedThread) {
      throw new Error('草稿与浏览器引用的会话关联无法核实。');
    }
  }
  const result = updateComposerDraftVersionInRoot(atoms[composerDraftAtomKey], snapshot, change, createId());
  return { repository: result.root, snapshot: result.after };
}
