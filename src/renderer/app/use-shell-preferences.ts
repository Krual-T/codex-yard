import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkbenchClient } from '../workbench-contract.ts';
import { preferenceDefinitions } from '../settings/preferences.ts';
import type { PreferenceValues } from '../settings/preferences.ts';

const keys = ['composer-permission-mode-visibility', 'app-shell-bottom-panel-launcher-visible', 'confirm-before-close'] as const;
type ShellPreferences = Pick<PreferenceValues, typeof keys[number]>;
const defaults: ShellPreferences = {
  'composer-permission-mode-visibility': preferenceDefinitions['composer-permission-mode-visibility'].defaultValue,
  'app-shell-bottom-panel-launcher-visible': preferenceDefinitions['app-shell-bottom-panel-launcher-visible'].defaultValue,
  'confirm-before-close': preferenceDefinitions['confirm-before-close'].defaultValue,
};

/** The shell observes the original atoms; the settings editor remains their writer. */
export function useShellPreferences(client: WorkbenchClient) {
  const [values, setValues] = useState<ShellPreferences>(defaults);
  const [error, setError] = useState('');
  const generation = useRef(0), alive = useRef(false);
  const reload = useCallback(async () => {
    const request = ++generation.current;
    try {
      const entries = await Promise.all(keys.map(async key => {
        const result = await client.host<{ exists: boolean; value?: unknown }>('get-persisted-atom', { key });
        if (result?.exists !== true && result?.exists !== false) throw new Error('Invalid saved shell preference: ' + key);
        const value = result.exists ? result.value : preferenceDefinitions[key].defaultValue;
        if (!preferenceDefinitions[key].valid(value)) throw new Error('Invalid saved shell preference: ' + key);
        return [key, value];
      }));
      if (alive.current && generation.current === request) {
        setValues(Object.fromEntries(entries) as ShellPreferences); setError('');
      }
    } catch (cause) { if (alive.current && generation.current === request) setError(String(cause)); }
  }, [client]);
  useEffect(() => {
    alive.current = true; void reload();
    const unsubscribe = client.subscribe(event => {
      if (event.type === 'page-resumed' || event.type === 'connection-state' && event.state === 'connected'
        || ['persisted-atom-updated', 'persisted-atoms-changed', 'settings-changed'].includes(event.type)
          && (!Array.isArray(event.keys) || !event.keys.length || event.keys.some(key => keys.includes(key as typeof keys[number])))) void reload();
    });
    return () => { alive.current = false; generation.current++; unsubscribe(); };
  }, [client, reload]);
  return { values, error, reload };
}
