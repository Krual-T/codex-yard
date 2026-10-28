import type { WorkbenchClient } from '../workbench-contract.ts';

export interface RemoteWorktreePreferences { root: string; autoCleanup: boolean; keepCount: number }
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

export async function readRemoteWorktreePreferences(client: WorkbenchClient, hostId: string): Promise<RemoteWorktreePreferences> {
  const result = await client.rpc<{ config?: { desktop?: unknown } }>('config/read', { includeLayers: false }, hostId);
  const desktop = result?.config?.desktop;
  if (!record(desktop)) throw new Error('This host does not expose its desktop worktree configuration.');
  const root = desktop['git-worktree-root'], cleanup = desktop['worktree-auto-cleanup-enabled'], keep = desktop['worktree-keep-count'];
  if ((root !== undefined && typeof root !== 'string') || (cleanup !== undefined && typeof cleanup !== 'boolean') ||
    (keep !== undefined && (typeof keep !== 'number' || !Number.isSafeInteger(keep) || keep < 1))) {
    throw new Error('The remote worktree configuration contains an invalid value.');
  }
  return { root: root ?? '', autoCleanup: cleanup ?? true, keepCount: keep ?? 15 };
}
