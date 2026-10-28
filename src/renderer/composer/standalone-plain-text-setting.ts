import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { Preferences } from '../settings/preferences.ts';
import type { WorkbenchClient } from '../workbench-contract.ts';

/** Read the same preference authority used by Settings, without loading unrelated settings. */
export function usePlainTextSetting(client: WorkbenchClient) {
  const preferences = useMemo(() => new Preferences(client), [client]);
  const entry = useSyncExternalStore(preferences.subscribe,
    () => preferences.getSnapshot().composerPlainTextMode,
    () => preferences.getSnapshot().composerPlainTextMode);
  useEffect(() => {
    const unsubscribe = client.subscribe(event => {
      if (event.type !== 'settings-changed') return;
      const keys = Array.isArray(event.keys) ? event.keys : typeof event.key === 'string' ? [event.key] : [];
      if (!keys.length || keys.includes('composerPlainTextMode')) void preferences.reload('composerPlainTextMode');
    });
    void preferences.reload('composerPlainTextMode');
    return unsubscribe;
  }, [client, preferences]);
  return entry;
}
