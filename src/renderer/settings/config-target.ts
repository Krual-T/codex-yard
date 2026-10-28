interface UserLayer {
  name: { type: 'user'; file: string; profile: string | null };
  version: string;
}

export interface ConfigTarget { file: string; filePath: string | null; profile: string | null; version: string }
export type ConfigTargetResult = { target: ConfigTarget; error: null } | { target: null; error: string };

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const normalizePath = (path: string) => {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[a-z]:\//i.test(normalized) ? normalized.toLowerCase() : normalized;
};

export function userConfigTarget(layers: unknown, codexHome: unknown, profile: string | null): ConfigTargetResult {
  const unavailable = 'Cannot save: the selected host did not provide an unambiguous version for the target user configuration file.';
  if (typeof codexHome !== 'string' || !/^(?:\/|[a-z]:[\\/]|\\\\)/i.test(codexHome) || !Array.isArray(layers)) {
    return { target: null, error: unavailable };
  }
  const users: UserLayer[] = layers.flatMap(layer => {
    if (!isRecord(layer) || !isRecord(layer.name) || layer.name.type !== 'user' || typeof layer.name.file !== 'string' ||
      typeof layer.version !== 'string' || !layer.version || (layer.name.profile !== null && typeof layer.name.profile !== 'string')) return [];
    return [{ name: { type: 'user' as const, file: layer.name.file, profile: layer.name.profile }, version: layer.version }];
  });
  if (profile === null && users.some(layer => layer.name.profile !== null)) return { target: null, error: unavailable };
  const baseFile = `${codexHome.replace(/[\\/]+$/, '')}/config.toml`;
  const matches = users.filter(layer => layer.name.profile === profile && /^(?:\/|[a-z]:[\\/]|\\\\)/i.test(layer.name.file) &&
    (profile === null ? normalizePath(layer.name.file) === normalizePath(baseFile) : normalizePath(layer.name.file) !== normalizePath(baseFile)));
  if (matches.length !== 1) return { target: null, error: unavailable };
  const layer = matches[0];
  return { target: { file: layer.name.file, filePath: profile ? layer.name.file : null, profile, version: layer.version }, error: null };
}
