import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WorkbenchClient, WorkbenchEvent } from '../src/renderer/workbench-contract.ts';
import { AgentSettings } from '../src/renderer/settings/agent-settings.ts';

class FakeClient implements WorkbenchClient {
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
  const client = new FakeClient(), agent = new AgentSettings(client, 'ssh:fixture');
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
  const client = new FakeClient(), agent = new AgentSettings(client, 'local');
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
    const client = new FakeClient(), agent = new AgentSettings(client, 'local');
    client.missingVersion = scenario === 'missing';
    await agent.load(); agent.edit('sandbox', 'workspace-write');
    client.reject = scenario === 'offline'; client.conflict = scenario === 'conflict';
    assert.equal(await agent.save(), false);
    assert.equal(agent.getSnapshot().values.sandbox, 'workspace-write');
    assert.equal(agent.dirty, true);
    assert.equal(client.calls.filter(call => call.method === 'config/batchWrite').length, scenario === 'missing' ? 0 : 1);
  }
});

test('advanced approval is preserved and changes elsewhere block writes', async () => {
  const client = new FakeClient(), agent = new AgentSettings(client, 'local');
  client.config.approval_policy = { granular: { rules: true } };
  await agent.load(); agent.edit('sandbox', 'workspace-write');
  client.config.approval_policy = { granular: { rules: false } };
  assert.equal(await agent.save(), false);
  assert.match(agent.getSnapshot().error ?? '', /changed elsewhere/);
  assert.equal(client.calls.some(call => call.method === 'config/batchWrite'), false);
  assert.equal(agent.dirty, true);
});

test('unverifiable requirements do not permit new agent choices', async () => {
  const client = new FakeClient(), agent = new AgentSettings(client, 'local');
  client.requirements.allowedSandboxModes = 'read-only' as unknown as string[];
  await agent.load(); agent.edit('sandbox', 'workspace-write');
  assert.equal(agent.dirty, false);
  assert.match(agent.getSnapshot().error ?? '', /Invalid configuration requirements/);
});
