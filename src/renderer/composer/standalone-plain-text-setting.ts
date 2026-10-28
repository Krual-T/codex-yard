import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Preferences } from '../settings/preferences.ts';
import type { WorkbenchClient } from '../workbench-contract.ts';

/** Read the same preference authority used by Settings, without loading unrelated settings. */
export function usePlainTextSetting(client: WorkbenchClient) {
  const preferences = useMemo(() => new Preferences(client), [client]);
  const entry = useSyncExternalStore(preferences.subscribe,
    () => preferences.getSnapshot().composerPlainTextMode,
    () => preferences.getSnapshot().composerPlainTextMode);
  const [pending, setPending] = useState(true);
  const pendingRef = useRef(true);
  const request = useRef(0);
  const reload = useCallback(async () => {
    const serial = ++request.current;
    pendingRef.current = true;
    setPending(true);
    try { await preferences.reload('composerPlainTextMode'); }
    finally {
      if (request.current === serial) { pendingRef.current = false; setPending(false); }
    }
  }, [preferences]);
  useEffect(() => {
    const unsubscribe = client.subscribe(event => {
      if (event.type !== 'settings-changed') return;
      const keys = Array.isArray(event.keys) ? event.keys : typeof event.key === 'string' ? [event.key] : [];
      if (!keys.length || keys.includes('composerPlainTextMode')) void reload();
    });
    void reload();
    return () => { request.current++; unsubscribe(); };
  }, [client, reload]);
  const readyValue = () => {
    const latest = preferences.getSnapshot().composerPlainTextMode;
    return pendingRef.current || !latest.available || latest.error ? undefined : latest.value;
  };
  return { ...entry, loading: entry.loading || pending, readyValue, reload };
}
