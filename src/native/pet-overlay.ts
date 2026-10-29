import type { HostMessage, ObjectValue } from './protocol.ts';
import { record } from './protocol.ts';
import { createStateMutations } from './state-mutations.ts';
import type { StateMutations } from './state-mutations.ts';

export interface PetPosition { x: number; y: number }
export interface WebPetState {
  isOpen: boolean;
  visibility: 'always-visible' | 'on-demand';
  position: PetPosition | null;
}

const openKey = 'electron-avatar-overlay-open';
const positionKey = 'web-pet-position';
const settingKeys = new Set(['selected-avatar-id', 'avatar-overlay-mascot-width-px', 'avatar-overlay-pet-visible', 'pet-visibility']);

export function petPosition(value: unknown): PetPosition | null {
  const { x, y } = record(value);
  return typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1 &&
    typeof y === 'number' && Number.isFinite(y) && y >= 0 && y <= 1 ? { x, y } : null;
}

// Desktop Mini uses a separate BrowserWindow. The Web host retains only that
// window's visibility/position persistence; the official route owns its UI.
export function createPetOverlay(globals: ObjectValue, settings: ObjectValue,
  persist: () => Promise<unknown>, broadcast: (message: HostMessage) => void, mutations: StateMutations = createStateMutations()) {
  function snapshot(): WebPetState {
    return {
      isOpen: globals[openKey] === true,
      visibility: settings['pet-visibility'] === 'on-demand' ? 'on-demand' : 'always-visible',
      position: petPosition(globals[positionKey]),
    };
  }
  function publish(send = broadcast) {
    const state = snapshot();
    send({ type: 'avatar-overlay-open-state-changed', isOpen: state.isOpen });
    send({ type: 'workbench-pet-state', state });
  }
  async function handle(message: HostMessage, reply: (message: HostMessage) => void): Promise<boolean> {
    if (message.type === 'avatar-overlay-open-state-request' || message.type === 'electron-avatar-overlay-restore-ready') {
      try { await mutations.run(() => publish(reply)); }
      catch { reply({ type: 'workbench-pet-error', error: '宠物设置尚未核实，请重试。' }); }
      return true;
    }
    if (!['avatar-overlay-open', 'avatar-overlay-close', 'avatar-overlay-hide', 'workbench-pet-position'].includes(message.type)) return false;
    return mutations.run(async () => {
    let key: string, value: unknown;
    if (message.type === 'avatar-overlay-open') {
      key = openKey; value = globals[openKey] !== true;
    } else if (message.type === 'avatar-overlay-close' || message.type === 'avatar-overlay-hide') {
      key = openKey; value = false;
    } else if (message.type === 'workbench-pet-position') {
      const position = petPosition(message.position);
      if (position === null) return true;
      key = positionKey; value = position;
    } else return false;
    const existed = Object.hasOwn(globals, key), previous = globals[key];
    globals[key] = value;
    try { await persist(); }
    catch {
      if (existed) globals[key] = previous; else delete globals[key];
      reply({ type: 'workbench-pet-error', error: '宠物设置保存失败，请重试。' });
      return true;
    }
    publish();
    return true;
    });
  }
  return { handle, publish, snapshot, settingChanged: (key: string) => {
    if (settingKeys.has(key)) {
      publish();
      broadcast({ type: 'workbench-mini-setting', key, value: settings[key] });
    }
  } };
}
