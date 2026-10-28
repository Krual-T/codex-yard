export interface SettingsProjectRoots { hostId: string; paths: readonly string[] }
export interface SettingsSessionCwd { hostId: string; path: string }
export interface SettingsScope { source: 'project' | 'session' | 'none'; paths: string[] }

export function validScopePath(path: unknown): path is string {
  return typeof path === 'string' && !!path.trim() && /^(?:\/|[a-z]:[\\/]|\\\\)/i.test(path);
}

export function settingsScope(hostId: string, roots: SettingsProjectRoots | null, session: SettingsSessionCwd | null): SettingsScope {
  if (roots?.hostId === hostId && roots.paths.length) {
    if (!roots.paths.every(validScopePath)) return { source: 'none', paths: [] };
    return { source: 'project', paths: [...new Set(roots.paths)] };
  }
  if (session?.hostId === hostId && validScopePath(session.path)) return { source: 'session', paths: [session.path] };
  return { source: 'none', paths: [] };
}

export function scopeKey(scope: SettingsScope): string { return JSON.stringify([scope.source, scope.paths]); }
