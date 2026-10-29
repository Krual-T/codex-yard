import type { WorkbenchClient } from '../../workbench-contract.ts';

export interface WorkspaceOption { root: string; label?: string }

export async function loadWorkspaceOptions(client: WorkbenchClient, hostId: string): Promise<WorkspaceOption[]> {
  const response: unknown = await client.host('workspace-root-options', { hostId });
  if (!response || typeof response !== 'object' || Array.isArray(response)) throw new Error('Invalid workspace response');
  const value = response as Record<string, unknown>;
  if (!Array.isArray(value.roots) || value.roots.some(root => typeof root !== 'string' || !root)) throw new Error('Invalid workspace roots');
  if (value.labels != null && (typeof value.labels !== 'object' || Array.isArray(value.labels))) throw new Error('Invalid workspace labels');
  const labels = (value.labels ?? {}) as Record<string, unknown>;
  return [...new Set(value.roots as string[])].map(root => {
    const label = labels[root];
    if (label != null && typeof label !== 'string') throw new Error('Invalid workspace label');
    return { root, ...(typeof label === 'string' && label.trim() ? { label: label.trim() } : {}) };
  });
}
