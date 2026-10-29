import { useSyncExternalStore } from 'react';
import { WorkbenchError } from './client.ts';

type Kind = 'skills' | 'plugins';
type State = 'pending' | 'unknown';
const changes = new Map<string, State>();
const listeners = new Set<() => void>();
const keyFor = (kind: Kind, hostId: string) => JSON.stringify([kind, hostId]);
const notify = () => { for (const listener of listeners) listener(); };

export function definitelyNotChanged(error: unknown): boolean {
  return error instanceof WorkbenchError && !error.uncertain || error instanceof DOMException && error.name === 'AbortError';
}

/** Keep unresolved host-wide changes fenced while this browser page is alive. */
export function useProductChanges(kind: Kind, hostId: string): boolean {
  const key = keyFor(kind, hostId);
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => changes.has(key), () => false);
}

export async function trackProductChange(kind: Kind, hostId: string, operation: () => Promise<void>): Promise<void> {
  const key = keyFor(kind, hostId);
  if (changes.has(key)) throw new Error('A previous change still needs confirmation.');
  changes.set(key, 'pending'); notify();
  try {
    await operation();
    changes.delete(key); notify();
  } catch (error) {
    if (definitelyNotChanged(error)) changes.delete(key); else changes.set(key, 'unknown');
    notify();
    throw error;
  }
}
