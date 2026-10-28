import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WorkbenchClient, WorkbenchEvent } from '../src/renderer/workbench-contract.ts';
import { readCatalog } from '../src/renderer/settings/catalog.ts';

class FakeClient implements WorkbenchClient {
  async reply(): Promise<void> { throw new Error('Unexpected approval'); }
  calls: { method: string; params?: Record<string, unknown>; hostId?: string }[] = [];
  result: unknown;
  subscribe(_listener: (event: WorkbenchEvent) => void) { return () => {}; }
  host<T>(): Promise<T> { throw new Error('host not used'); }
  async rpc<T>(method: string, params?: Record<string, unknown>, hostId?: string): Promise<T> {
    this.calls.push({ method, params, hostId }); return this.result as T;
  }
}

test('skills and hooks preserve host, cwd, statuses, and diagnostic messages', async () => {
  const client = new FakeClient();
  client.result = { data: [{ cwd: '/project', skills: [{ name: 'review', description: 'Review code', path: '/project/review', scope: 'repo', enabled: true }],
    errors: [{ path: '/project/bad', message: 'Invalid skill' }] }] };
  const skills = await readCatalog(client, 'remote', 'skills-settings', '/project', null);
  assert.equal(skills.items[0].status, 'Enabled');
  assert.deepEqual(skills.warnings, ['/project/bad: Invalid skill']);
  assert.deepEqual(client.calls[0], { method: 'skills/list', params: { cwds: ['/project'], forceReload: false }, hostId: 'remote' });
  client.result = { data: [{ cwd: '/project', hooks: [{ key: 'one', eventName: 'SessionStart', matcher: null, handlerType: 'command', enabled: false, isManaged: true, command: 'sensitive-command' }], warnings: ['warning'], errors: [] }] };
  const hooks = await readCatalog(client, 'remote', 'hooks-settings', '/project', null);
  assert.equal(hooks.items[0].status, 'Disabled');
  assert.match(hooks.items[0].detail, /Managed/);
  assert.doesNotMatch(JSON.stringify(hooks), /sensitive-command/);
  assert.deepEqual(hooks.warnings, ['warning']);
});

test('MCP pagination and locally installed plugins use their actual response shapes', async () => {
  const client = new FakeClient();
  client.result = { data: [{ name: 'local', runtimeStatus: 'connected', authStatus: 'unsupported', tools: { a: {}, b: {} } }], nextCursor: 'next' };
  const mcp = await readCatalog(client, 'local', 'mcp-settings', '', 'previous');
  assert.deepEqual(mcp.items[0], { id: 'local', name: 'local', detail: '2 tools', status: 'connected' });
  assert.equal(mcp.nextCursor, 'next');
  assert.deepEqual(client.calls[0], { method: 'mcpServerStatus/list', params: { cursor: 'previous', limit: 100 }, hostId: 'local' });
  client.result = { marketplaces: [{ name: 'local', plugins: [{ id: 'p', name: 'Plugin', installed: true, enabled: false, interface: { shortDescription: 'Useful' } },
    { id: 'q', name: 'Not installed', installed: false, enabled: false }] }], marketplaceLoadErrors: [] };
  const plugins = await readCatalog(client, 'local', 'plugins-settings', '', null);
  assert.equal(plugins.items.length, 1);
  assert.equal(plugins.items[0].status, 'Disabled');
  assert.equal(client.calls[1].method, 'plugin/installed');
});

test('invalid or rejected catalog responses are errors, not empty catalogs', async () => {
  const client = new FakeClient(); client.result = {};
  await assert.rejects(readCatalog(client, 'local', 'skills-settings', '', null), /Invalid skills response/);
  await assert.rejects(readCatalog(client, 'local', 'plugins-settings', '', null), /Invalid installed plugins response/);
});
