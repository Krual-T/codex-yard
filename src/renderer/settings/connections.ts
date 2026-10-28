import type { WorkbenchClient } from '../workbench-contract.ts';

export interface RemoteConnection {
  hostId: string; displayName: string; sshAlias: string | null; sshHost: string; sshPort: number | null; autoConnect: boolean;
}
export interface ConnectionRow { host: RemoteConnection; state: string; error: string | null }

export async function readConnections(client: WorkbenchClient): Promise<ConnectionRow[]> {
  const response = await client.host<{ remoteConnections: RemoteConnection[] }>('refresh-remote-connections');
  if (!Array.isArray(response?.remoteConnections)) throw new Error('Invalid remote connections response');
  return Promise.all(response.remoteConnections.map(async host => {
    if (!host || typeof host.hostId !== 'string' || typeof host.displayName !== 'string' || typeof host.autoConnect !== 'boolean') {
      throw new Error('Invalid remote connection');
    }
    try {
      const status = await client.host<{ state: string; error?: string | null }>('app-server-connection-state', { hostId: host.hostId });
      return { host, state: typeof status.state === 'string' ? status.state : 'unknown', error: status.error ?? null };
    } catch (error) { return { host, state: 'unknown', error: error instanceof Error ? error.message : String(error) }; }
  }));
}
export async function setAutoConnect(client: WorkbenchClient, hostId: string, autoConnect: boolean): Promise<void> {
  const response = await client.host<{ error?: string | null }>('set-remote-connection-auto-connect', { hostId, autoConnect });
  if (response?.error) throw new Error(response.error);
}
