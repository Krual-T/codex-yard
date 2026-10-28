import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WorkbenchClient, WorkbenchEvent } from '../src/renderer/workbench-contract.ts';
import { pluginDetailPath, pluginsPath, pluginSource, readPlugin, readPlugins, resolvePluginSource } from '../src/renderer/settings/plugins.ts';
import { hostPath, readSettingsRoute, sectionPath } from '../src/renderer/settings/routing.ts';

class FakeClient implements WorkbenchClient {
  calls: { method: string; params?: Record<string, unknown>; hostId?: string }[] = [];
  results: Record<string, unknown> = {};
  subscribe(_listener: (event: WorkbenchEvent) => void) { return () => {}; }
  async reply(): Promise<void> { throw new Error('Unexpected approval'); }
  host<T>(): Promise<T> { throw new Error('Unexpected host request'); }
  async rpc<T>(method: string, params?: Record<string, unknown>, hostId?: string): Promise<T> {
    this.calls.push({ method, params, hostId });
    const result = this.results[method];
    if (result instanceof Error) throw result;
    return result as T;
  }
}
const route = (path: string) => {
  const url = new URL(path, 'http://fixture.test');
  return readSettingsRoute({ pathname: url.pathname, search: url.search, hash: url.hash, state: { marker: 1 } }, 'local');
};
const local = { id: 'review@team', name: 'review', installed: true, enabled: false, remotePluginId: null,
  interface: { displayName: 'Code review', shortDescription: 'Review changes' } };
const remote = { id: 'review@remote', name: 'review', remotePluginId: 'plugin-remote', installed: false, enabled: false };
const listing = { marketplaces: [
  { name: 'team', path: '/team/.agents/plugins/marketplace.json', plugins: [local] },
  { name: 'remote', path: null, plugins: [remote, { ...remote, id: 'missing', remotePluginId: null }] },
], marketplaceLoadErrors: [{ marketplacePath: '/broken', message: 'Invalid marketplace' }] };

test('plugin inventory and directory retain selected host, source identity and errors', async () => {
  const client = new FakeClient(); client.results['plugin/installed'] = listing; client.results['plugin/list'] = listing;
  const installed = await readPlugins(client, 'ssh:one', '/project', false);
  assert.equal(installed.entries.length, 1);
  assert.equal(installed.entries[0].summary.enabled, false);
  assert.deepEqual(installed.warnings, ['/broken: Invalid marketplace']);
  const directory = await readPlugins(client, 'ssh:one', '/project', true);
  assert.equal(directory.entries.length, 3);
  assert.deepEqual(directory.entries[0].source, { marketplacePath: '/team/.agents/plugins/marketplace.json', remoteMarketplaceName: null, pluginName: 'review' });
  assert.deepEqual(directory.entries[1].source, { marketplacePath: null, remoteMarketplaceName: 'remote', pluginName: 'plugin-remote' });
  assert.equal(directory.entries[2].source, null);
  assert.deepEqual(client.calls, [
    { method: 'plugin/installed', params: { cwds: ['/project'] }, hostId: 'ssh:one' },
    { method: 'plugin/list', params: { cwds: ['/project'] }, hostId: 'ssh:one' },
  ]);
  client.results['plugin/list'] = new Error('method not found');
  await assert.rejects(readPlugins(client, 'ssh:one', '', true), /method not found/);
  client.results['plugin/installed'] = { marketplaces: [{ name: 'bad', path: null, plugins: [{}] }] };
  await assert.rejects(readPlugins(client, 'local', '', false), /Invalid plugin catalog/);
  client.results['plugin/installed'] = { marketplaces: [{ name: 'bad', path: '/test', plugins: [{ ...local, interface: { displayName: {} } }] }] };
  await assert.rejects(readPlugins(client, 'local', '', false), /Invalid plugin catalog/);
});

test('original plugin detail route uses its path host, preserves history inputs and does not reuse source across hosts', async () => {
  const client = new FakeClient(); client.results['plugin/installed'] = listing; client.results['plugin/list'] = listing;
  const page = route('/settings/plugins-settings?hostId=ssh%3Aone&directory=1&x=1');
  const entry = (await readPlugins(client, page.hostId, '', true)).entries[0];
  const path = pluginDetailPath(page, entry), detail = route(path + '#skills');
  assert.match(path, /^\/settings\/plugins-settings\/hosts\/ssh%3Aone\/plugins\/review%40team\?/);
  assert.equal(detail.hostId, 'ssh:one');
  assert.deepEqual(detail.state, { marker: 1 });
  assert.deepEqual(pluginSource(detail.search), entry.source);
  assert.deepEqual(await resolvePluginSource(client, detail, ''), entry.source);
  assert.equal(pluginsPath(detail, true), '/settings/plugins-settings?directory=1&x=1&hostId=ssh%3Aone');
  assert.equal(hostPath('ssh:two', detail), '/settings/plugins-settings?directory=1&x=1&hostId=ssh%3Atwo#skills');
  assert.equal(sectionPath('appearance', detail), '/settings/appearance?x=1&hostId=ssh%3Aone');
  const bareDetail = route('/settings/plugins-settings/hosts/ssh%3Aone/plugins/review%40team?hostId=other');
  assert.equal(bareDetail.hostId, 'ssh:one');
  assert.deepEqual(await resolvePluginSource(client, bareDetail, ''), entry.source);
  assert.throws(() => pluginSource('?pluginName=review&marketplacePath=%2Fa&remoteMarketplaceName=b'), /single marketplace/);
  client.results['plugin/installed'] = { marketplaces: [{ name: 'one', path: '/one', plugins: [local] }, { name: 'two', path: '/two', plugins: [local] }] };
  await assert.rejects(resolvePluginSource(client, bareDetail, ''), /could not be identified/);
});

test('detail reads the exact marketplace and validates its response', async () => {
  const client = new FakeClient();
  client.results['plugin/read'] = { plugin: { marketplaceName: 'remote', summary: remote, description: 'Details', skills: [], hooks: [],
    apps: [], appTemplates: [], mcpServers: [], scheduledTasks: null } };
  const detail = await readPlugin(client, 'ssh:one', { pluginName: 'plugin-remote', marketplacePath: null, remoteMarketplaceName: 'remote' });
  assert.equal(detail.summary.id, 'review@remote');
  assert.deepEqual(client.calls[0], { method: 'plugin/read', params: { remoteMarketplaceName: 'remote', pluginName: 'plugin-remote' }, hostId: 'ssh:one' });
  client.results['plugin/read'] = { plugin: { ...detail, hooks: [{ key: 'broken' }] } };
  await assert.rejects(readPlugin(client, 'local', { pluginName: 'review', marketplacePath: '/market', remoteMarketplaceName: null }), /Invalid plugin details/);
});

test('omitted marketplace path and scheduled tasks use null without relaxing required fields', async () => {
  const client = new FakeClient();
  client.results['plugin/list'] = { marketplaces: [{ name: 'remote', plugins: [remote] }] };
  const result = await readPlugins(client, 'ssh:one', '/project', true);
  assert.deepEqual(result.entries[0].source, { marketplacePath: null, remoteMarketplaceName: 'remote', pluginName: 'plugin-remote' });
  client.results['plugin/read'] = { plugin: { marketplaceName: 'remote', summary: remote, description: null, skills: [], hooks: [],
    apps: [], appTemplates: [], mcpServers: [] } };
  const source = { pluginName: 'plugin-remote', marketplacePath: null, remoteMarketplaceName: 'remote' };
  assert.equal((await readPlugin(client, 'ssh:one', source)).scheduledTasks, null);
  client.results['plugin/read'] = { plugin: { marketplaceName: 'remote', summary: remote, description: null, skills: [], hooks: [],
    apps: [], appTemplates: [], mcpServers: [], scheduledTasks: false } };
  await assert.rejects(readPlugin(client, 'ssh:one', source), /Invalid plugin details/);
});
