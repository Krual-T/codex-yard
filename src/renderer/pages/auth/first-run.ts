import type { WorkbenchClient } from '../../workbench-contract.ts';

export type FirstRunVariant = 'chatgpt' | 'apiKey' | 'none';

export async function completeFirstRun(client: WorkbenchClient, hostId: string, variant: FirstRunVariant, isCurrent: () => boolean = () => true): Promise<boolean> {
  const keys = ['viewed2025-09-15-nux'];
  if (variant === 'chatgpt') keys.push('viewed2025-09-15-full-chatgpt-auth-nux');
  if (variant === 'apiKey') keys.push('viewed2025-09-15-apikey-auth-nux');
  for (const key of keys) {
    if (!isCurrent()) return false;
    const result = await client.host<{ success?: unknown }>('set-global-state', { hostId, key, value: true });
    if (!isCurrent()) return false;
    if (result?.success !== true) throw new Error('Could not save first-run progress');
  }
  return true;
}
