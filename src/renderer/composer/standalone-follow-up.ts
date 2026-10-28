import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkbenchClient } from '../workbench-contract.ts';

export type FollowUpAction = 'queue' | 'steer';

export function useFollowUpSetting(client: WorkbenchClient) {
  const [value, setValue] = useState<FollowUpAction>('steer');
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const mounted = useRef(false);
  const reload = useCallback(async () => {
    const current = ++generation.current;
    if (mounted.current) setPending(true);
    try {
      const result = await client.host<{ value?: unknown }>('get-setting', { key: 'followUpQueueMode' });
      const raw = result.value === undefined ? 'steer' : result.value;
      if (raw !== 'queue' && raw !== 'steer' && raw !== 'interrupt') throw new Error('保存的跟进方式无效');
      if (mounted.current && current === generation.current) { setValue(raw === 'interrupt' ? 'steer' : raw); setError(''); }
    } catch (reason) {
      if (mounted.current && current === generation.current) setError('无法读取跟进方式：' + String(reason instanceof Error ? reason.message : reason));
    } finally { if (mounted.current && current === generation.current) setPending(false); }
  }, [client]);
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = client.subscribe(event => {
      if (event.type === 'settings-changed' && (!Array.isArray(event.keys) || event.keys.includes('followUpQueueMode'))) void reload();
    });
    void reload();
    return () => { mounted.current = false; generation.current++; unsubscribe(); };
  }, [client, reload]);
  return { value, pending, error };
}
