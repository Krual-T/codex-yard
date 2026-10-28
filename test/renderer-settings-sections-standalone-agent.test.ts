import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WorkbenchClient, WorkbenchEvent } from '../src/renderer/workbench-contract.ts';
import { AgentSettings } from '../src/renderer/settings/agent-settings.ts';
import { fixtureConfigurationHost, fixtureOperations } from './renderer-settings-sections-config-fixture.ts';

class FakeClient implements WorkbenchClient {
  operations = fixtureOperations(this);
  config: { approval_policy: unknown; sandbox_mode: string; profile: string | null } = { approval_policy: 'on-request', sandbox_mode: 'read-only', profile: null };
  requirements: { allowedApprovalPolicies: unknown[] | null; allowedSandboxModes: string[] | null } = { allowedApprovalPolicies: null, allowedSandboxModes: null };
  version = 'v1';
  calls: { method: string; params?: Record<string, unknown>; hostId?: string }[] = [];
  missingVersion = false;
  conflict = false;
  reject = false;
  async reply(): Promise<void> { throw new Error('Unexpected approval'); }
  subscribe(_listener: (event: WorkbenchEvent) => void) { return () => {}; }
  async host<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    this.calls.push({ method, params });
    if (method === 'codex-home') return { codexHome: '/fixture/codex' } as T;
    if (method === 'configuration-write' && params) return await fixtureConfigurationHost(this, params) as T;
    throw new Error('Unknown host endpoint');
  }
  async rpc<T>(method: string, params?: Record<string, unknown>, hostId?: string): Promise<T> {
    this.calls.push({ method, params, hostId });
    if (method === 'config/read') return { config: { ...this.config }, layers: this.missingVersion ? [] :
      [{ name: { type: 'user', file: '/fixture/codex/config.toml', profile: null }, version: this.version }] } as T;
    if (method === 'configRequirements/read') return { requirements: this.requirements } as T;
    if (method === 'config/batchWrite') {
      if (this.reject) throw new Error('offline');
      if (this.conflict) this.version = 'external';
      if (params?.expectedVersion !== this.version) throw new Error('Configuration modified');
      for (const edit of params?.edits as { keyPath: string; value: string }[]) {
        if (edit.keyPath === 'approval_policy') this.config.approval_policy = edit.value;
        if (edit.keyPath === 'sandbox_mode') this.config.sandbox_mode = edit.value;
      }
      this.version = 'v2'; return { status: 'ok' } as T;
    }
    throw new Error('Unknown RPC');
  }
}

test('agent writes approved user defaults with the selected host and verified version', async () => {
  const client = new FakeClient(), agent = new AgentSettings(client, 'ssh:fixture', client.operations);
  await agent.load();
  agent.edit('approval', 'never'); agent.edit('sandbox', 'workspace-write');
  assert.equal(await agent.save(), true);
  assert.equal(agent.dirty, false);
  assert.deepEqual(client.calls.find(call => call.method === 'config/batchWrite'), { method: 'config/batchWrite', hostId: 'ssh:fixture', params: {
    edits: [{ keyPath: 'approval_policy', value: 'never', mergeStrategy: 'upsert' },
      { keyPath: 'sandbox_mode', value: 'workspace-write', mergeStrategy: 'upsert' }], filePath: null, expectedVersion: 'v1', reloadUserConfig: true,
  } });
});

test('agent requirements restrict choices and are checked again before a write', async () => {
  const client = new FakeClient(), agent = new AgentSettings(client, 'local', client.operations);
  client.requirements.allowedApprovalPolicies = ['on-request'];
  await agent.load(); agent.edit('approval', 'never');
  assert.equal(agent.dirty, false);
  agent.edit('sandbox', 'workspace-write');
  client.requirements.allowedSandboxModes = ['read-only'];
  assert.equal(await agent.save(), false);
  assert.match(agent.getSnapshot().error ?? '', /requirements changed/);
  assert.equal(agent.getSnapshot().values.sandbox, 'workspace-write');
  assert.equal(client.calls.some(call => call.method === 'config/batchWrite'), false);
});

test('agent retains drafts on missing version, offline writes and concurrent changes', async () => {
  for (const scenario of ['missing', 'offline', 'conflict'] as const) {
    const client = new FakeClient(), agent = new AgentSettings(client, 'local', client.operations);
    client.missingVersion = scenario === 'missing';
    await agent.load(); agent.edit('sandbox', 'workspace-write');
    client.reject = scenario === 'offline'; client.conflict = scenario === 'conflict';
    assert.equal(await agent.save(), false);
    assert.equal(agent.getSnapshot().values.sandbox, 'workspace-write');
    assert.equal(agent.dirty, true);
    assert.equal(client.calls.filter(call => call.method === 'config/batchWrite').length, scenario === 'missing' ? 0 : 1);
  }
});

test('agent restores a newer edit separately from an unknown original request', async () => {
  const client = new FakeClient(), first = new AgentSettings(client, 'local', client.operations);
  await first.load(); first.edit('sandbox', 'workspace-write'); client.reject = true;
  assert.equal(await first.save(), false);
  first.edit('approval', 'never'); await first.retryDraftPersistence();
  const record = await client.operations.find('local', 'agent');
  assert.deepEqual(record?.params.edits, [{ keyPath: 'sandbox_mode', value: 'workspace-write', mergeStrategy: 'upsert' }]);
  const second = new AgentSettings(client, 'local', client.operations); await second.load();
  assert.deepEqual(second.getSnapshot().values, { approval: 'never', sandbox: 'workspace-write' });
  client.reject = false; assert.equal(await second.save(), false);
  assert.equal(client.calls.filter(call => call.method === 'config/batchWrite').length, 1);
});

test('advanced approval is preserved and changes elsewhere block writes', async () => {
  const client = new FakeClient(), agent = new AgentSettings(client, 'local', client.operations);
  client.config.approval_policy = { granular: { rules: true } };
  await agent.load(); agent.edit('sandbox', 'workspace-write');
  client.config.approval_policy = { granular: { rules: false } };
  assert.equal(await agent.save(), false);
  assert.match(agent.getSnapshot().error ?? '', /changed elsewhere/);
  assert.equal(client.calls.some(call => call.method === 'config/batchWrite'), false);
  assert.equal(agent.dirty, true);
});

test('unverifiable requirements do not permit new agent choices', async () => {
  const client = new FakeClient(), agent = new AgentSettings(client, 'local', client.operations);
  client.requirements.allowedSandboxModes = 'read-only' as unknown as string[];
  await agent.load(); agent.edit('sandbox', 'workspace-write');
  assert.equal(agent.dirty, false);
  assert.match(agent.getSnapshot().error ?? '', /Invalid configuration requirements/);
});

test('agent reload retains only an edited approval and adopts a concurrent sandbox restriction', async () => {
  const client = new FakeClient(), agent = new AgentSettings(client, 'local', client.operations);
  client.config.approval_policy = 'never'; client.config.sandbox_mode = 'workspace-write';
  await agent.load(); agent.edit('approval', 'on-request');
  client.config.sandbox_mode = 'read-only'; client.version = 'external-version';
  assert.equal(await agent.save(), false);
  await agent.load();
  assert.deepEqual(agent.getSnapshot().values, { approval: 'on-request', sandbox: 'read-only' });
  assert.deepEqual(agent.getSnapshot().conflicts, []);
  assert.equal(await agent.save(), true);
  const write = client.calls.find(call => call.method === 'config/batchWrite');
  assert.deepEqual(write?.params?.edits, [{ keyPath: 'approval_policy', value: 'on-request', mergeStrategy: 'upsert' }]);
  assert.equal(write?.params?.expectedVersion, 'external-version');
  assert.equal(client.config.sandbox_mode, 'read-only');
});

test('agent same-field conflict requires an explicit choice even after repeated reloads', async () => {
  const client = new FakeClient(), agent = new AgentSettings(client, 'local', client.operations);
  await agent.load(); agent.edit('approval', 'never');
  client.config.approval_policy = 'untrusted'; client.version = 'external-version';
  await agent.load();
  assert.deepEqual(agent.getSnapshot().conflicts, ['approval']);
  assert.equal(await agent.save(), false);
  await agent.load();
  assert.deepEqual(agent.getSnapshot().conflicts, ['approval']);
  agent.resolveConflict('approval', 'draft');
  assert.equal(await agent.save(), true);
  const write = client.calls.find(call => call.method === 'config/batchWrite');
  assert.deepEqual(write?.params?.edits, [{ keyPath: 'approval_policy', value: 'never', mergeStrategy: 'upsert' }]);
});

test('a concurrent sandbox edit cannot be overwritten without review', async () => {
  const client = new FakeClient(), agent = new AgentSettings(client, 'local', client.operations);
  await agent.load(); agent.edit('sandbox', 'workspace-write');
  client.config.sandbox_mode = 'danger-full-access'; client.version = 'v2';
  await agent.load();
  assert.deepEqual(agent.getSnapshot().conflicts, ['sandbox']);
  assert.equal(await agent.save(), false);
  agent.resolveConflict('sandbox', 'draft');
  client.config.sandbox_mode = 'read-only'; client.version = 'v3';
  assert.equal(await agent.save(), false);
  await agent.load();
  assert.deepEqual(agent.getSnapshot().conflicts, ['sandbox']);
  agent.resolveConflict('sandbox', 'current');
  assert.equal(agent.dirty, false);
  assert.equal(client.calls.some(call => call.method === 'config/batchWrite'), false);
});

test('agent profile changes cannot redirect a pending sandbox edit', async () => {
  const client = new FakeClient(), agent = new AgentSettings(client, 'local', client.operations);
  await agent.load(); agent.edit('sandbox', 'workspace-write');
  client.config.profile = 'other'; client.version = 'external-version';
  assert.equal(await agent.save(), false);
  await agent.load();
  assert.equal(agent.getSnapshot().values.sandbox, 'workspace-write');
  assert.equal(agent.getSnapshot().profile, null);
  assert.match(agent.getSnapshot().error ?? '', /profile changed/);
  assert.equal(client.calls.some(call => call.method === 'config/batchWrite'), false);
});
