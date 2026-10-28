import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkbenchClient } from '../workbench-contract.ts';

export type EnterBehavior = 'enter' | 'cmdIfMultiline' | 'cmdAlways';
const isBehavior = (value: unknown): value is EnterBehavior =>
  value === 'enter' || value === 'cmdIfMultiline' || value === 'cmdAlways';

export function useEnterSetting(client: WorkbenchClient) {
  const [value, setValue] = useState<EnterBehavior>('enter');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(true);
  const generation = useRef(0);
  const mounted = useRef(false);
  const reload = useCallback(async () => {
    const current = ++generation.current;
    try {
      const result = await client.host<{ value?: unknown }>('get-setting', { key: 'composerEnterBehavior' });
      const next = result.value === undefined ? 'enter' : result.value;
      if (!isBehavior(next)) throw new Error('保存的发送方式无效');
      if (mounted.current && current === generation.current) { setValue(next); setError(''); }
    } catch (reason) {
      if (mounted.current && current === generation.current) setError('无法读取发送方式：' + String(reason instanceof Error ? reason.message : reason));
    } finally { if (mounted.current && current === generation.current) setPending(false); }
  }, [client]);
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = client.subscribe(event => {
      if (event.type === 'settings-changed' && (!Array.isArray(event.keys) || event.keys.includes('composerEnterBehavior'))) void reload();
    });
    void reload();
    return () => { mounted.current = false; generation.current++; unsubscribe(); };
  }, [client, reload]);
  const update = useCallback(async (next: EnterBehavior) => {
    setPending(true);
    try {
      const response = await client.host<{ success?: boolean }>('set-setting', { key: 'composerEnterBehavior', value: next });
      if (response.success !== true) throw new Error('设置未被确认');
      await reload();
    } catch (reason) {
      if (mounted.current) { setError('无法保存发送方式：' + String(reason instanceof Error ? reason.message : reason)); setPending(false); }
    }
  }, [client, reload]);
  return { value, error, pending, update };
}
