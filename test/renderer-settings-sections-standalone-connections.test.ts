import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WorkbenchClient, WorkbenchEvent } from '../src/renderer/workbench-contract.ts';
import { readConnections, setAutoConnect } from '../src/renderer/settings/connections.ts';

class FakeClient implements WorkbenchClient {
  async reply(): Promise<void> { throw new Error('Unexpected approval'); }
  calls: { endpoint: string; params?: Record<string, unknown> }[] = [];
  statusError = false;
  writeError = false;
  rpc<T>(): Promise<T> { throw new Error('rpc not used'); }
  subscribe(_listener: (event: WorkbenchEvent) => void) { return () => {}; }
  async host<T>(endpoint: string, params?: Record<string, unknown>): Promise<T> {
    this.calls.push({ endpoint, params });
    if (endpoint === 'refresh-remote-connections') return { remoteConnections: [{ hostId: 'ssh:one', displayName: 'One', sshAlias: 'one', sshHost: 'fixture', sshPort: null, autoConnect: false }] } as T;
    if (endpoint === 'app-server-connection-state') {
      if (this.statusError) throw new Error('offline');
      return { state: 'disconnected', error: null } as T;
    }
    if (endpoint === 'set-remote-connection-auto-connect') return { error: this.writeError ? 'connect failed' : null } as T;
    throw new Error('unsupported');
  }
}

test('SSH list keeps configured auto-connect separate from current connection state', async () => {
  const client = new FakeClient();
  const rows = await readConnections(client);
  assert.equal(rows[0].host.autoConnect, false);
  assert.equal(rows[0].state, 'disconnected');
  assert.deepEqual(client.calls[1], { endpoint: 'app-server-connection-state', params: { hostId: 'ssh:one' } });
  client.statusError = true;
  assert.deepEqual((await readConnections(client))[0].error, 'offline');
});

test('connection changes target exactly one host and report failure without replay', async () => {
  const client = new FakeClient(); client.writeError = true;
  await assert.rejects(setAutoConnect(client, 'ssh:one', true), /connect failed/);
  assert.deepEqual(client.calls, [{ endpoint: 'set-remote-connection-auto-connect', params: { hostId: 'ssh:one', autoConnect: true } }]);
});
