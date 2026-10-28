import type { PetPosition, WebPetState } from '../../native/pet-overlay.ts';

export const builtinPets = [
  { id: 'codex', name: 'Codex' },
  { id: 'dewey', name: 'Dewey' },
  { id: 'fireball', name: 'Fireball' },
  { id: 'hoots', name: 'Hoots' },
  { id: 'rocky', name: 'Rocky' },
  { id: 'seedy', name: 'Seedy' },
  { id: 'stacky', name: 'Stacky' },
  { id: 'bsod', name: 'BSOD' },
  { id: 'null-signal', name: 'Null Signal' },
] as const;

export type BuiltinPetId = typeof builtinPets[number]['id'];
export type BuiltinPetAssets = Partial<Record<BuiltinPetId, string>>;
export const builtinPetAssets: Readonly<Record<BuiltinPetId, string>> = {
  codex: '/pets/codex-spritesheet-v6-51045ae208c0.webp',
  dewey: '/pets/dewey-spritesheet-v5-f5285016f310.webp',
  fireball: '/pets/fireball-spritesheet-v5-9c2a4146d3f9.webp',
  hoots: '/pets/hoots-spritesheet-v8-21cacd193ace.webp',
  rocky: '/pets/rocky-spritesheet-v5-97b5d14cdd54.webp',
  seedy: '/pets/seedy-spritesheet-v10-0f6f906a2aec.webp',
  stacky: '/pets/stacky-spritesheet-v6-18d0359c82af.webp',
  bsod: '/pets/bsod-spritesheet-v5-cc54136ce042.webp',
  'null-signal': '/pets/null-signal-spritesheet-v7-1e7dbf89200f.webp',
};
export type PetMotion = 'idle' | 'running' | 'waiting' | 'failed' | 'review' | 'jumping';
export interface PetOption {
  id: string;
  name: string;
  description?: string;
  src?: string;
  rows: 9 | 11;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function readPetState(value: unknown): WebPetState | null {
  const state = object(value);
  if (typeof state.isOpen !== 'boolean') return null;
  const candidate = object(state.position);
  const coordinate = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
  const position: PetPosition | null = coordinate(candidate.x) && coordinate(candidate.y) ? { x: candidate.x, y: candidate.y } : null;
  return { isOpen: state.isOpen, position, visibility: state.visibility === 'on-demand' ? 'on-demand' : 'always-visible' };
}

export function readPetOptions(value: unknown, assets: BuiltinPetAssets): PetOption[] {
  const records = object(value).avatars;
  const custom = Array.isArray(records) ? records.flatMap((entry): PetOption[] => {
    const avatar = object(entry);
    if (typeof avatar.id !== 'string' || !avatar.id.startsWith('custom:') || typeof avatar.displayName !== 'string' ||
      typeof avatar.spritesheetDataUrl !== 'string' || !/^data:image\/(?:png|webp);base64,/i.test(avatar.spritesheetDataUrl) ||
      avatar.spriteVersionNumber !== 1 && avatar.spriteVersionNumber !== 2) return [];
    return [{ id: avatar.id, name: avatar.displayName, description: typeof avatar.description === 'string' ? avatar.description : undefined,
      src: avatar.spritesheetDataUrl, rows: avatar.spriteVersionNumber === 2 ? 11 : 9 }];
  }) : [];
  return [...custom, ...builtinPets.map(({ id, name }) => ({ id, name, src: assets[id], rows: 11 as const }))];
}

export function petSize(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 80 && value <= 224 ? value : 112;
}

export function petFrame(motion: PetMotion, step: number): { row: number; column: number; duration: number } {
  const spec = {
    idle: { row: 0, durations: [1680, 660, 660, 840, 840, 1920] },
    running: { row: 7, durations: [120, 120, 120, 120, 120, 220] },
    waiting: { row: 6, durations: [150, 150, 150, 150, 150, 260] },
    failed: { row: 5, durations: [140, 140, 140, 140, 140, 140, 140, 240] },
    review: { row: 8, durations: [150, 150, 150, 150, 150, 280] },
    jumping: { row: 4, durations: [140, 140, 140, 140, 280] },
  }[motion];
  const column = ((step % spec.durations.length) + spec.durations.length) % spec.durations.length;
  return { row: spec.row, column, duration: spec.durations[column]! };
}

export function miniShortcut(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'altKey' | 'ctrlKey' | 'shiftKey' | 'repeat' | 'isComposing'>, isMac: boolean): boolean {
  if (event.repeat || event.isComposing || event.ctrlKey || event.shiftKey || !event.altKey) return false;
  return isMac ? !event.metaKey && (event.key === ' ' || event.key === 'Spacebar') : event.metaKey && event.key.toLowerCase() === 'p';
}
