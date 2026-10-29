import { assertPreferenceExpectation, updatedAtom } from '../../native/protocol.ts';
import { readBrowserAtoms, updateBrowserAtoms } from '../storage/ui-atoms.ts';

/** Existing atom keys, backed by one imported IndexedDB record and transaction. */
export async function browserAtom(endpoint: string, params: Record<string, unknown>, assertBeforeWrite?: () => void) {
  if (typeof params.key !== 'string') throw new Error('缺少偏好键。');
  const key = params.key;
  if (endpoint === 'get-persisted-atom') {
    assertBeforeWrite?.();
    const atoms = await readBrowserAtoms();
    assertBeforeWrite?.();
    return { value: atoms[key], exists: Object.hasOwn(atoms, key) };
  }
  await updateBrowserAtoms(atoms => {
    assertBeforeWrite?.();
    const previous = atoms[key];
    assertPreferenceExpectation(previous, Object.hasOwn(atoms, key), params.expected);
    if (params.recordUpdate && previous !== undefined && (!previous || typeof previous !== 'object' || Array.isArray(previous))) {
      throw new Error('浏览器记录格式无效；原值已保留，未覆盖。');
    }
    return { value: undefined, updates: { [key]: updatedAtom(previous, params) } };
  });
  return { success: true };
}
