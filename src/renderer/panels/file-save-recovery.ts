import { readBrowserAtom, updateBrowserAtom, updateBrowserAtoms } from '../storage/ui-atoms.ts';

export type RecoveryPhase = 'pending' | 'unknown' | 'saved' | 'conflict' | 'failed';
export interface FileSaveRecovery {
  id: string;
  checkId: string;
  submitted: boolean;
  phase: RecoveryPhase;
  contents: string;
  saved: string;
  draft: string;
  revision: number;
}

const phases = new Set<RecoveryPhase>(['pending', 'unknown', 'saved', 'conflict', 'failed']);
const keyFor = (key: string) => 'codex-yard.file-save-recovery.v1:' + key;
function recovery(value: unknown): FileSaveRecovery | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('The saved file recovery record is invalid.');
  const item = value as Partial<FileSaveRecovery>;
  if (typeof item.id !== 'string' || typeof item.checkId !== 'string' || typeof item.submitted !== 'boolean'
    || !phases.has(item.phase as RecoveryPhase) || typeof item.contents !== 'string'
    || typeof item.saved !== 'string' || typeof item.draft !== 'string' || !Number.isSafeInteger(item.revision) || item.revision! < 0) {
    throw new Error('The saved file recovery record is invalid.');
  }
  return item as FileSaveRecovery;
}

export async function readFileRecovery(key: string) { return recovery(await readBrowserAtom(keyFor(key))); }

function equalValue(left: unknown, right: unknown, seen = new WeakMap<object, object>()): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object'
    || Array.isArray(left) !== Array.isArray(right)) return false;
  if (!Array.isArray(left) && (Object.getPrototypeOf(left) !== Object.prototype || Object.getPrototypeOf(right) !== Object.prototype)) return false;
  if (seen.has(left)) return seen.get(left) === right;
  seen.set(left, right);
  const keys = Object.keys(left), other = Object.keys(right);
  return keys.length === other.length && keys.every(key => Object.hasOwn(right, key)
    && equalValue((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key], seen));
}

export function sameFileRecovery(left: FileSaveRecovery | undefined, right: FileSaveRecovery | undefined) {
  return equalValue(left, right);
}

export async function claimFileRecovery(key: string, previous: FileSaveRecovery | undefined, next: FileSaveRecovery) {
  await updateBrowserAtom(keyFor(key), value => {
    const current = recovery(value);
    if (!sameFileRecovery(current, previous)) {
      throw new Error('File recovery changed in another page. Keep or copy this edit before reopening.');
    }
    return next;
  });
}

export async function updateFileRecovery(key: string, id: string, update: (current: FileSaveRecovery) => FileSaveRecovery) {
  const result = await updateBrowserAtom(keyFor(key), value => {
    const current = recovery(value);
    if (!current || current.id !== id) throw new Error('File recovery changed in another page. Keep or copy this edit before reopening.');
    return update(current);
  });
  return recovery(result)!;
}

export async function reconcileFileRecovery(key: string, expected: FileSaveRecovery | undefined, draft: string, revision: number) {
  const result = await updateBrowserAtom(keyFor(key), value => {
    const current = recovery(value);
    if (!sameFileRecovery(current, expected)) throw new Error('File recovery changed in another page. Keep or copy this edit before closing.');
    return current ? { ...current, draft, revision } : value;
  });
  return recovery(result);
}

function checkedDiscard(value: unknown, expected: FileSaveRecovery) {
  const current = recovery(value);
  if (!sameFileRecovery(current, expected) || current?.phase === 'pending' || current?.phase === 'unknown') {
    throw new Error('File recovery changed in another page. Keep or copy this edit before closing.');
  }
  return null;
}

export async function discardFileRecovery(key: string, expected: FileSaveRecovery) {
  await updateBrowserAtom(keyFor(key), value => checkedDiscard(value, expected));
}

export async function discardFileRecoveries(records: { key: string; expected: FileSaveRecovery }[]) {
  if (records.length === 0) return;
  if (records.length === 1) return discardFileRecovery(records[0]!.key, records[0]!.expected);
  await updateBrowserAtoms(atoms => {
    const updates: Record<string, unknown> = {};
    for (const { key, expected } of records) updates[keyFor(key)] = checkedDiscard(atoms[keyFor(key)], expected);
    return { value: undefined, updates };
  });
}
