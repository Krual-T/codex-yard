import { updatedAtom } from '../../native/protocol.ts';
import { readBrowserAtom, updateBrowserAtom } from '../storage/ui-atoms.ts';

/** Existing atom keys, backed by one imported IndexedDB record and transaction. */
export async function browserAtom(endpoint: string, params: Record<string, unknown>) {
  if (typeof params.key !== 'string') throw new Error('缺少偏好键。');
  const key = params.key;
  if (endpoint === 'get-persisted-atom') return { value: await readBrowserAtom(key) };
  await updateBrowserAtom(key, previous => {
    if (params.recordUpdate && previous !== undefined && (!previous || typeof previous !== 'object' || Array.isArray(previous))) {
      throw new Error('浏览器记录格式无效；原值已保留，未覆盖。');
    }
    return updatedAtom(previous, params);
  });
  return { success: true };
}
