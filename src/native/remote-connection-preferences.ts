import { publicHost } from './hosts.ts';
import { record } from './protocol.ts';
import type { ObjectValue } from './protocol.ts';
import type { SshHost } from './ssh.ts';
import type { StateMutations } from './state-mutations.ts';

/** Remote connection views use the same committed native-state interval as writes. */
export function createRemoteConnectionPreferences(hosts: readonly SshHost[], globals: ObjectValue,
  mutations: StateMutations, persist: () => Promise<void>, publish: (event: unknown) => void) {
  const key = 'remote-connection-auto-connect-by-host-id';
  const snapshot = () => {
    const preferences = record(globals[key]);
    return hosts.map(host => ({ ...publicHost(host), autoConnect: preferences[host.hostId] === true }));
  };
  return {
    read: () => mutations.run(() => structuredClone(snapshot())),
    setAutoConnect(hostId: string, autoConnect: boolean) {
      if (!hosts.some(host => host.hostId === hostId) || typeof autoConnect !== 'boolean') return Promise.reject(new Error('需要 SSH 主机和连接状态'));
      return mutations.run(async () => {
        const existed = Object.hasOwn(globals, key), previous = globals[key];
        globals[key] = { ...record(previous), [hostId]: autoConnect };
        try { await persist(); }
        catch (error) { if (existed) globals[key] = previous; else delete globals[key]; throw error; }
        const committed = structuredClone(snapshot());
        publish({ type: 'shared-object-updated', key: 'remote_ssh_connections', value: committed });
      });
    },
  };
}
