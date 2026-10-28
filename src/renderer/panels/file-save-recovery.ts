import { readBrowserAtom, updateBrowserAtom } from '../storage/ui-atoms.ts';

export type RecoveryPhase = 'pending' | 'unknown' | 'saved' | 'conflict' | 'failed';
export interface FileSaveRecovery {
  id: string;
  checkId: string;
  submitted: boolean;
  phase: RecoveryPhase;
  expectedContents: string;
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
    || !phases.has(item.phase as RecoveryPhase) || typeof item.expectedContents !== 'string' || typeof item.contents !== 'string'
    || typeof item.saved !== 'string' || typeof item.draft !== 'string' || !Number.isSafeInteger(item.revision) || item.revision! < 0) {
    throw new Error('The saved file recovery record is invalid.');
  }
  return item as FileSaveRecovery;
}

export async function readFileRecovery(key: string) { return recovery(await readBrowserAtom(keyFor(key))); }

export async function claimFileRecovery(key: string, previous: FileSaveRecovery | undefined, next: FileSaveRecovery) {
  await updateBrowserAtom(keyFor(key), value => {
    const current = recovery(value);
    if (current ? !previous || current.id !== previous.id || current.revision !== previous.revision : !!previous) {
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

export async function discardFileRecovery(key: string, id: string, revision: number) {
  let discarded = false;
  await updateBrowserAtom(keyFor(key), value => {
    const current = recovery(value);
    if (!current || current.id === id && current.revision === revision && current.phase !== 'pending' && current.phase !== 'unknown') {
      discarded = true;
      return null;
    }
    return value;
  });
  if (!discarded) throw new Error('File recovery changed in another page. Keep or copy this edit before reopening.');
}
