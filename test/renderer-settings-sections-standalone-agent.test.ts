import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WorkbenchClient, WorkbenchEvent } from '../src/renderer/workbench-contract.ts';
import { AgentSettings } from '../src/renderer/settings/agent-settings.ts';
import { fixtureConfigurationHost, fixtureDraft, fixtureOperations, fixtureSource } from './renderer-settings-sections-config-fixture.ts';

class FakeClient implements WorkbenchClient {
  operations = fixtureOperations(this);
  config: { approval_policy: unknown; sandbox_mode: string; profile: string | null; web_search?: string; model_verbosity?: string | null;
    model_reasoning_summary?: string; sandbox_workspace_write?: { network_access: boolean }; [key: string]: unknown } =
    { approval_policy: 'on-request', sandbox_mode: 'read-only', profile: null };
  effectiveOverrides: Record<string, unknown> = {};
  lockedKeys: string[] = []; projectionAvailable = true; dropProjectionAfterWrite = false; supportsIndexedWebSearch = true; overridden = false;
  requirements: { allowedApprovalPolicies: unknown[] | null; allowedSandboxModes: string[] | null; allowedWebSearchModes: string[] | null } =
    { allowedApprovalPolicies: null, allowedSandboxModes: null, allowedWebSearchModes: null };
  version = 'v1';
  generation = 'generation-a'; sourceAvailable = true;
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
    if (method === 'config/read') return { config: { ...this.config, ...this.effectiveOverrides }, layers: this.missingVersion ? [] :
      [{ name: { type: 'user', file: '/fixture/codex/config.toml', profile: null }, version: this.version }],
      ...(this.projectionAvailable ? { yardAgentConfiguration: { base: structuredClone(this.config), lockedKeys: this.lockedKeys,
        supportsIndexedWebSearch: this.supportsIndexedWebSearch } } : {}),
      ...(this.sourceAvailable ? { yardConfigSource: fixtureSource(hostId, '/fixture/codex', this.generation) } : {}) } as T;
    if (method === 'configRequirements/read') return { requirements: this.requirements } as T;
    if (method === 'config/batchWrite') {
      if (this.reject) throw new Error('offline');
      if (this.conflict) this.version = 'external';
      if (params?.expectedVersion !== this.version) throw new Error('Configuration modified');
      for (const edit of params?.edits as { keyPath: string; value: string | boolean | null }[]) {
        if (edit.keyPath === 'sandbox_workspace_write.network_access') this.config.sandbox_workspace_write = { network_access: edit.value as boolean };
        else if (edit.value === null) delete this.config[edit.keyPath];
        else this.config[edit.keyPath] = edit.value;
      }
      if (this.dropProjectionAfterWrite) this.projectionAvailable = false;
      this.version = 'v2'; return { status: this.overridden ? 'okOverridden' : 'ok' } as T;
    }
    throw new Error('Unknown RPC');
  }
}

test('agent retains the edited policy when its original connection changes or was unavailable', async () => {
  for (const absent of [false, true]) {
    const client = new FakeClient(); client.sourceAvailable = !absent;
    const settings = new AgentSettings(client, 'local', client.operations);
    await settings.load(); settings.edit('approval', 'never');
    client.sourceAvailable = true; client.generation = 'generation-b';
    assert.equal(await settings.save(), false); assert.equal(settings.getSnapshot().values.approval, 'never');
    assert.equal(client.calls.some(call => call.method === 'configuration-write'), false);
    await settings.load(true); assert.equal(await settings.save(), true);
    assert.deepEqual(client.calls.find(call => call.method === 'configuration-write')?.params?.source,
      fixtureSource('local', '/fixture/codex', 'generation-b'));
  }
});

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
  await second.restoreDraft(await fixtureDraft(client.operations, first.editorId));
  assert.equal(second.getSnapshot().values.approval, 'never');
  assert.equal(second.getSnapshot().values.sandbox, 'workspace-write');
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
  assert.equal(agent.getSnapshot().values.approval, 'on-request');
  assert.equal(agent.getSnapshot().values.sandbox, 'read-only');
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

test('an advanced approval conflict retains the original raw policy through recovery', async () => {
  const client = new FakeClient(); client.config.approval_policy = { granular: { rules: true } };
  const first = new AgentSettings(client, 'local', client.operations); await first.load(); first.edit('approval', 'never');
  client.config.approval_policy = { granular: { rules: false } }; client.version = 'v2';
  await first.load(); await first.retryDraftPersistence();
  const saved = await fixtureDraft(client.operations, first.editorId) as { conflicts: string[]; conflictBaselines: { approval: { raw: unknown } } };
  assert.deepEqual(saved.conflicts, ['approval']); assert.deepEqual(saved.conflictBaselines.approval.raw, { granular: { rules: true } });
  const restored = new AgentSettings(client, 'local', client.operations); await restored.load(); await restored.restoreDraft(saved);
  assert.deepEqual(restored.getSnapshot().conflicts, ['approval']); assert.equal(await restored.save(), false);
  restored.resolveConflict('approval', 'draft'); assert.equal(await restored.save(), true);
});

test('a null-target agent edit requires review before a later valid target can be used', async () => {
  const client = new FakeClient(); client.missingVersion = true;
  const first = new AgentSettings(client, 'local', client.operations); await first.load(); first.edit('sandbox', 'workspace-write'); await first.retryDraftPersistence();
  const saved = await fixtureDraft(client.operations, first.editorId) as { target: unknown }; assert.equal(saved.target, null);
  client.missingVersion = false;
  const restored = new AgentSettings(client, 'local', client.operations); await restored.load(); await restored.restoreDraft(saved);
  assert.equal(restored.getSnapshot().values.sandbox, 'workspace-write'); assert.equal(await restored.save(), false);
  assert.equal(client.calls.some(call => call.method === 'configuration-write'), false);
  await restored.load(true); assert.equal(await restored.save(), true);
});

test('agent reload removes the exact local draft when the authoritative policy converges', async () => {
  const client = new FakeClient(), first = new AgentSettings(client, 'local', client.operations);
  await first.load(); first.edit('approval', 'never'); await first.retryDraftPersistence();
  client.config.approval_policy = 'never'; client.version = 'v2'; await first.load(); await first.retryDraftPersistence();
  await client.operations.refresh(); assert.equal(client.operations.getSnapshot().drafts.some(item => item.editorId === first.editorId), false);
});

test('five configuration controls and workspace network save only changed user keys with original source and version', async () => {
  const client = new FakeClient(), agent = new AgentSettings(client, 'ssh:fixture', client.operations);
  client.config.model_verbosity = 'low'; client.config.model_reasoning_summary = 'concise'; client.config.web_search = 'cached';
  client.config.future_setting = { preserved: true };
  await agent.load();
  agent.edit('approval', 'never'); agent.edit('sandbox', 'workspace-write'); agent.edit('networkAccess', 'true');
  agent.edit('webSearch', 'live'); agent.edit('verbosity', ''); agent.edit('reasoning', 'detailed');
  assert.equal(await agent.save(), true);
  const write = client.calls.find(call => call.method === 'config/batchWrite');
  assert.deepEqual(write?.params, { edits: [
    { keyPath: 'approval_policy', value: 'never', mergeStrategy: 'upsert' },
    { keyPath: 'sandbox_mode', value: 'workspace-write', mergeStrategy: 'upsert' },
    { keyPath: 'sandbox_workspace_write.network_access', value: true, mergeStrategy: 'upsert' },
    { keyPath: 'web_search', value: 'live', mergeStrategy: 'upsert' },
    { keyPath: 'model_verbosity', value: null, mergeStrategy: 'upsert' },
    { keyPath: 'model_reasoning_summary', value: 'detailed', mergeStrategy: 'upsert' },
  ], filePath: null, expectedVersion: 'v1', reloadUserConfig: true });
  const hostCall = client.calls.find(call => call.method === 'configuration-write');
  assert.equal(hostCall?.params?.hostId, 'ssh:fixture');
  assert.deepEqual(hostCall?.params?.source, fixtureSource('ssh:fixture', '/fixture/codex', 'generation-a'));
  assert.equal(Object.hasOwn(client.config, 'model_verbosity'), false);
  assert.deepEqual(client.config.future_setting, { preserved: true });
  assert.equal(agent.dirty, false);
});

test('user layer stays editable under profile overrides and a confirmed overridden write verifies the base', async () => {
  const client = new FakeClient(), agent = new AgentSettings(client, 'local', client.operations);
  client.config.profile = 'work'; client.config.model_verbosity = 'low';
  client.effectiveOverrides.model_verbosity = 'high'; client.overridden = true;
  await agent.load();
  assert.equal(agent.getSnapshot().values.verbosity, 'low');
  agent.edit('verbosity', '');
  assert.equal(await agent.save(), true);
  assert.equal(agent.getSnapshot().values.verbosity, 'high');
  assert.match(agent.getSnapshot().warning ?? '', /higher-priority/);
  assert.equal(agent.dirty, false);
  assert.equal(await client.operations.find('local', 'agent'), null);
});

test('managed keys and changed web restrictions prevent dispatch even after editing', async () => {
  const client = new FakeClient(), agent = new AgentSettings(client, 'local', client.operations);
  client.lockedKeys = ['model_reasoning_summary']; client.requirements.allowedWebSearchModes = ['cached'];
  await agent.load(); agent.edit('reasoning', 'detailed'); agent.edit('webSearch', 'live');
  assert.equal(agent.dirty, false);
  assert.deepEqual(agent.getSnapshot().webSearches, ['disabled', 'cached']);
  agent.edit('webSearch', 'disabled');
  client.lockedKeys.push('web_search');
  assert.equal(await agent.save(), false);
  assert.equal(agent.getSnapshot().values.webSearch, 'disabled');
  assert.equal(client.calls.some(call => call.method === 'configuration-write'), false);
});

test('missing host projection cannot turn absent fields into assumed defaults or dispatch writes', async () => {
  const client = new FakeClient(), agent = new AgentSettings(client, 'local', client.operations);
  client.projectionAvailable = false; await agent.load(); agent.edit('webSearch', 'live'); agent.edit('approval', 'never');
  assert.equal(agent.getSnapshot().projectionAvailable, false);
  assert.match(agent.getSnapshot().writeError ?? '', /details are unavailable/);
  assert.equal(agent.dirty, false);
  assert.equal(client.calls.some(call => call.method === 'configuration-write'), false);
});

test('indexed search is offered only for the original daemon capability and rechecked before dispatch', async () => {
  const client = new FakeClient(), agent = new AgentSettings(client, 'local', client.operations);
  client.supportsIndexedWebSearch = false; await agent.load();
  assert.deepEqual(agent.getSnapshot().webSearches, ['disabled', 'cached', 'live']);
  agent.edit('webSearch', 'indexed'); assert.equal(agent.dirty, false);
  client.supportsIndexedWebSearch = true; await agent.load(); agent.edit('webSearch', 'indexed');
  client.supportsIndexedWebSearch = false;
  assert.equal(await agent.save(), false);
  assert.equal(agent.getSnapshot().values.webSearch, 'indexed');
  assert.equal(client.calls.some(call => call.method === 'configuration-write'), false);
});

test('an old two-field persisted draft recovers without manufacturing changes to newer fields', async () => {
  const client = new FakeClient(), first = new AgentSettings(client, 'local', client.operations);
  client.config.web_search = 'live'; client.config.model_verbosity = 'high'; client.config.model_reasoning_summary = 'detailed';
  await first.load(); first.edit('approval', 'never'); await first.retryDraftPersistence();
  const original = await fixtureDraft(client.operations, first.editorId) as Record<string, unknown>;
  const old = { ...original, values: { approval: 'never', sandbox: 'read-only' }, saved: { approval: 'on-request', sandbox: 'read-only' } };
  const second = new AgentSettings(client, 'local', client.operations); await second.load(); await second.restoreDraft(old);
  assert.equal(second.getSnapshot().values.webSearch, 'live');
  assert.equal(second.getSnapshot().values.verbosity, 'high');
  assert.equal(second.getSnapshot().values.reasoning, 'detailed');
  assert.equal(await second.save(), true);
  assert.deepEqual(client.calls.find(call => call.method === 'config/batchWrite')?.params?.edits,
    [{ keyPath: 'approval_policy', value: 'never', mergeStrategy: 'upsert' }]);
});

test('new field conflicts and unknown writes retain their own draft and original operation', async () => {
  const client = new FakeClient(), agent = new AgentSettings(client, 'local', client.operations);
  client.config.web_search = 'cached'; await agent.load(); agent.edit('webSearch', 'live');
  client.config.web_search = 'disabled'; client.version = 'v2'; await agent.load();
  assert.deepEqual(agent.getSnapshot().conflicts, ['webSearch']);
  assert.equal(await agent.save(), false); agent.resolveConflict('webSearch', 'draft');
  client.reject = true; assert.equal(await agent.save(), false);
  const operation = await client.operations.find('local', 'agent');
  assert.ok(operation); assert.equal(operation.phase, 'unknown');
  assert.deepEqual(operation.params.edits, [{ keyPath: 'web_search', value: 'live', mergeStrategy: 'upsert' }]);
  client.reject = false; assert.equal(await agent.save(), false);
  assert.equal(client.calls.filter(call => call.method === 'config/batchWrite').length, 1);
  assert.equal(agent.getSnapshot().values.webSearch, 'live');
});

test('a received write is not resent when the user-layer verification becomes unavailable', async () => {
  const client = new FakeClient(), agent = new AgentSettings(client, 'local', client.operations);
  await agent.load(); agent.edit('reasoning', 'detailed'); client.dropProjectionAfterWrite = true;
  assert.equal(await agent.save(), false);
  assert.match(agent.getSnapshot().error ?? '', /saved user configuration could not be verified/);
  const operation = await client.operations.find('local', 'agent');
  assert.equal(operation?.phase, 'finished');
  assert.equal(agent.getSnapshot().values.reasoning, 'detailed');
  assert.equal(await agent.save(), false);
  assert.equal(client.calls.filter(call => call.method === 'config/batchWrite').length, 1);
});
