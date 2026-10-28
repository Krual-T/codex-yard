import type { ConfigReadSource } from '../../../lib/config-write-protocol.ts';

export function configReadSource(value: unknown, hostId: string): ConfigReadSource | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (source.hostId !== hostId || typeof source.generation !== 'string' || !source.generation
    || typeof source.homeDirectory !== 'string' || !source.homeDirectory
    || typeof source.codexHome !== 'string' || !source.codexHome) return null;
  return { hostId, generation: source.generation, homeDirectory: source.homeDirectory, codexHome: source.codexHome };
}

export function sameConfigSource(left: ConfigReadSource | null, right: ConfigReadSource | null): boolean {
  return !!left && !!right && left.hostId === right.hostId && left.generation === right.generation
    && left.homeDirectory === right.homeDirectory && left.codexHome === right.codexHome;
}
