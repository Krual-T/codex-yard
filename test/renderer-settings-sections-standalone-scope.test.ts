import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WorkbenchClient, WorkbenchEvent } from '../src/renderer/workbench-contract.ts';
import { HookSettings } from '../src/renderer/settings/hooks.ts';
import { readPlugins } from '../src/renderer/settings/plugins.ts';
import { settingsScope } from '../src/renderer/settings/scope.ts';
import { SkillSettings } from '../src/renderer/settings/skills.ts';
import { fixtureOperations } from './renderer-settings-sections-config-fixture.ts';

class Client implements WorkbenchClient {
  operations = fixtureOperations(this);
  calls: { method: string; params?: Record<string, unknown>; hostId?: string }[] = [];
  subscribe(_listener: (event: WorkbenchEvent) => void) { return () => {}; }
  async reply(): Promise<void> { throw new Error('Unexpected approval'); }
  async host<T>(method: string): Promise<T> {
    if (method === 'codex-home') return { codexHome: '/fixture/home' } as T;
    throw new Error('Unexpected host request');
  }
  async rpc<T>(method: string, params?: Record<string, unknown>, hostId?: string): Promise<T> {
    this.calls.push({ method, params, hostId });
    if (method === 'hooks/list') return { data: [{ cwd: '/one', hooks: [], warnings: [], errors: [] }] } as T;
    if (method === 'skills/list') return { data: [{ cwd: '/one', skills: [], errors: [] }],
      yardConfigSource: { hostId, generation: 'fixture', homeDirectory: '/fixture', codexHome: '/fixture/home' } } as T;
    if (method === 'plugin/list') return { marketplaces: [] } as T;
    if (method === 'config/read') return { config: {}, layers: [{ name: { type: 'user', file: '/fixture/home/config.toml', profile: null }, version: 'v1' }],
      yardConfigSource: { hostId, generation: 'fixture', homeDirectory: '/fixture', codexHome: '/fixture/home' } } as T;
    throw new Error(`Unexpected ${method}`);
  }
}

test('settings scope chooses matching project roots or the real matching session, never another host', () => {
  const roots = { hostId: 'ssh:one', paths: ['/one', '/two', '/one'] };
  const session = { hostId: 'ssh:one', path: '/conversation' };
  assert.deepEqual(settingsScope('ssh:one', roots, session), { source: 'project', paths: ['/one', '/two'] });
  assert.deepEqual(settingsScope('ssh:one', null, session), { source: 'session', paths: ['/conversation'] });
  assert.deepEqual(settingsScope('ssh:two', roots, session), { source: 'none', paths: [] });
  assert.deepEqual(settingsScope('ssh:one', { ...roots, paths: ['relative'] }, session), { source: 'none', paths: [] });
  assert.deepEqual(settingsScope('ssh:one', { ...roots, paths: [] }, session), { source: 'session', paths: ['/conversation'] });
  assert.deepEqual(settingsScope('local', null, { hostId: 'local', path: 'C:\\workspace' }), { source: 'session', paths: ['C:\\workspace'] });
});

test('hook, skill and plugin reads use all explicit paths on the selected host', async () => {
  const client = new Client(), paths = ['/one', '/two'];
  await new HookSettings(client, 'ssh:one', paths, client.operations).load();
  await new SkillSettings(client, 'ssh:one', paths, client.operations).load();
  await readPlugins(client, 'ssh:one', paths, true);
  assert.deepEqual(client.calls.filter(call => ['hooks/list', 'skills/list', 'plugin/list'].includes(call.method)), [
    { method: 'hooks/list', params: { cwds: paths }, hostId: 'ssh:one' },
    { method: 'skills/list', params: { cwds: paths, forceReload: true }, hostId: 'ssh:one' },
    { method: 'plugin/list', params: { cwds: paths }, hostId: 'ssh:one' },
  ]);
});

test('missing or invalid scope does not send an implicit list request', async () => {
  const client = new Client(), hooks = new HookSettings(client, 'ssh:one', [], client.operations), skills = new SkillSettings(client, 'ssh:one', [], client.operations);
  await hooks.load(); await skills.load();
  assert.match(hooks.getSnapshot().error ?? '', /working directory/);
  assert.match(skills.getSnapshot().error ?? '', /working directory/);
  await assert.rejects(readPlugins(client, 'ssh:one', ['relative'], true), /working directory/);
  assert.deepEqual(client.calls, []);
});
