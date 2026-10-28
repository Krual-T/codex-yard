import type { ObjectValue } from './protocol.ts';
import { createStateMutations } from './state-mutations.ts';
import type { StateMutations } from './state-mutations.ts';

/** Serialize the two existing preference stores; publish only durable writes. */
export function createPreferenceWrites(settings: ObjectValue, globals: ObjectValue, persist: () => Promise<void>,
  publish: (event: unknown) => void, settingChanged: (key: string) => void, mutations: StateMutations = createStateMutations()) {
  return function write(source: 'setting' | 'global', key: string, value: unknown): Promise<{ success: true }> {
    if (!key || key === '__proto__' || key === 'constructor' || key === 'prototype') return Promise.reject(new Error('无效的偏好键'));
    return mutations.run(async () => {
      const target = source === 'setting' ? settings : globals;
      const existed = Object.hasOwn(target, key), previous = target[key];
      target[key] = value;
      try { await persist(); }
      catch (error) {
        if (existed) target[key] = previous; else delete target[key];
        throw error;
      }
      if (source === 'setting') settingChanged(key);
      publish({ type: source === 'setting' ? 'settings-changed' : 'global-state-updated', keys: [key] });
      return { success: true as const };
    });
  };
}
