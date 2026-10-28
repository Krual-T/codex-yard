import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WorkbenchClient, WorkbenchEvent } from '../src/renderer/workbench-contract.ts';
import { canEditHook, HookSettings } from '../src/renderer/settings/hooks.ts';
import { fixtureConfigurationHost, fixtureDraft, fixtureOperations, fixtureSource } from './renderer-settings-sections-config-fixture.ts';

const trusted = { key: 'event."review"', eventName: 'sessionStart', matcher: null, source: 'user', sourcePath: '/fixture/hooks.json',
  trustStatus: 'trusted', isManaged: false, enabled: true, timeoutSec: 60, handlerType: 'command', command: 'echo fixture', async: false,
  currentHash: 'private-internal-value' };
const untrusted = { ...trusted, key: 'new', trustStatus: 'untrusted' };
class FakeClient implements WorkbenchClient {
  operations = fixtureOperations(this);
  hooks = [{ ...trusted }, { ...untrusted }];
  version = 'v1'; profile: string | null = null; failRead = false; lost = false; override = false;
  generation = 'generation-a'; sourceAvailable = true; hostWrites: Record<string, unknown>[] = [];
  late: (() => void) | null = null;
  deferLost = false;
  beforeList?: () => Promise<void>; beforeWrite?: () => Promise<void>;
  writes: { params: Record<string, unknown>; hostId?: string }[] = [];
  subscribe(_listener: (event: WorkbenchEvent) => void) { return () => {}; }
  async reply(): Promise<void> { throw new Error('Unexpected approval'); }
  async host<T>(endpoint: string, params?: Record<string, unknown>): Promise<T> {
    if (endpoint === 'configuration-write' && params) { this.hostWrites.push(params); return await fixtureConfigurationHost(this, params) as T; }
    assert.equal(endpoint, 'codex-home'); assert.equal(params?.hostId, 'ssh:one'); return { codexHome: '/fixture' } as T;
  }
  async rpc<T>(method: string, params?: Record<string, unknown>, hostId?: string): Promise<T> {
    assert.equal(hostId, 'ssh:one');
    if (method === 'hooks/list') {
      assert.deepEqual(params, { cwds: ['/project'] });
      await this.beforeList?.();
      if (this.failRead) throw new Error('list failed');
      return { data: [{ cwd: '/project', hooks: this.hooks.map(hook => ({ ...hook })), warnings: ['fixture warning'], errors: [] }] } as T;
    }
    if (method === 'config/read') return { config: { profile: this.profile }, layers: [
      { name: { type: 'user', file: '/fixture/config.toml', profile: null }, version: this.version },
      ...(this.profile ? [{ name: { type: 'user', file: '/fixture/profile.toml', profile: this.profile }, version: 'profile-version' }] : []),
    ], ...(this.sourceAvailable ? { yardConfigSource: fixtureSource(hostId, '/fixture', this.generation) } : {}) } as T;
    if (method === 'config/batchWrite') {
      assert.ok(params); this.writes.push({ params, hostId });
      await this.beforeWrite?.();
      assert.equal(params.expectedVersion, this.version); assert.equal(params.filePath, null);
      if (this.override) return { status: 'okOverridden' } as T;
      const apply = () => {
        for (const edit of params.edits as { keyPath: string; value: boolean }[]) {
          const hook = this.hooks.find(item => `hooks.state.${JSON.stringify(item.key)}.enabled` === edit.keyPath);
          assert.ok(hook); hook.enabled = edit.value;
        }
        this.version = 'v2';
      };
      if (this.deferLost) { this.late = apply; throw new Error('reply lost'); }
      apply();
      if (this.lost) throw new Error('reply lost');
      return { status: 'ok' } as T;
    }
    throw new Error(`Unexpected ${method}`);
  }
}
const setup = async () => { const client = new FakeClient(), settings = new HookSettings(client, 'ssh:one', ['/project'], client.operations); await settings.load(); return { client, settings }; };

test('hook source changes preserve the draft and require explicit review', async () => {
  const { client, settings } = await setup(); settings.edit(trusted.key, false); client.generation = 'generation-b';
  assert.equal(await settings.save(), false); assert.equal(settings.dirty, true); assert.equal(client.hostWrites.length, 0);
  settings.useLatest(); assert.equal(await settings.save(), true);
  assert.deepEqual(client.hostWrites[0]?.source, fixtureSource('ssh:one', '/fixture', 'generation-b'));
  const absent = await setup(); absent.client.sourceAvailable = false; await absent.settings.load();
  absent.settings.edit(trusted.key, false); assert.equal(await absent.settings.save(), false); assert.equal(absent.client.hostWrites.length, 0);
});

test('only trusted editable hooks can change and saves target the verified base user config', async () => {
  const { client, settings } = await setup(); client.profile = 'profile.with.dots';
  client.hooks.push({ ...trusted, key: 'future', handlerType: 'futureHandler' }); await settings.load();
  assert.deepEqual(settings.getSnapshot().warnings, ['fixture warning']);
  assert.equal(canEditHook(settings.getSnapshot().hooks[0]), true);
  assert.doesNotMatch(JSON.stringify(settings.getSnapshot()), /private-internal-value/);
  settings.edit('new', false); assert.equal(settings.dirty, false);
  settings.edit('future', false); assert.equal(settings.dirty, false);
  settings.edit(trusted.key, false); assert.equal(settings.dirty, true);
  assert.equal(await settings.save(), true);
  assert.equal(settings.dirty, false);
  assert.equal(settings.getSnapshot().hooks[0].enabled, false);
  assert.deepEqual(client.writes[0].params, { edits: [{ keyPath: `hooks.state.${JSON.stringify(trusted.key)}.enabled`, value: false, mergeStrategy: 'upsert' }],
    filePath: null, expectedVersion: 'v1', reloadUserConfig: true });
});

test('conflicts preserve edits until current state is explicitly reviewed', async () => {
  const { client, settings } = await setup(); settings.edit(trusted.key, false); client.version = 'external';
  assert.equal(await settings.save(), false); assert.equal(client.writes.length, 0);
  assert.equal(settings.dirty, true); assert.ok(settings.getSnapshot().latest);
  settings.useLatest(); assert.equal(settings.dirty, true); assert.equal(settings.getSnapshot().latest, null);
  assert.equal(await settings.save(), true); assert.equal(client.writes[0].params.expectedVersion, 'external');
});

test('lost replies retain the draft and a refresh cannot release the unknown write', async () => {
  const { client, settings } = await setup(); settings.edit(trusted.key, false); client.lost = true;
  assert.equal(await settings.save(), false); assert.equal(settings.dirty, true); assert.equal(settings.getSnapshot().needsRefresh, true);
  assert.equal(settings.getSnapshot().writeUncertain, true);
  assert.match(settings.getSnapshot().error || '', /unknown result/); assert.equal(await settings.save(), false);
  client.failRead = true; await settings.load(); assert.equal(settings.dirty, true); assert.match(settings.getSnapshot().error || '', /list failed/);
  client.failRead = false; await settings.load(); assert.equal(settings.dirty, true); assert.ok(settings.getSnapshot().latest);
  settings.useLatest(); await settings.discard();
  assert.equal(settings.dirty, true); assert.equal(settings.getSnapshot().writeUncertain, true);
  assert.equal(await settings.save(), false); assert.equal(client.writes.length, 1);
});

test('a late original write remains fenced after an earlier unchanged refresh', async () => {
  const { client, settings } = await setup(); settings.edit(trusted.key, false); client.deferLost = true;
  assert.equal(await settings.save(), false);
  await settings.load(); settings.useLatest();
  assert.equal(settings.getSnapshot().hooks[0].enabled, true);
  assert.equal(settings.dirty, true); assert.equal(await settings.save(), false);
  assert.ok(client.late); client.late();
  assert.equal(client.hooks[0].enabled, false);
  await settings.load(); settings.useLatest(); await settings.discard();
  assert.equal(settings.getSnapshot().writeUncertain, true);
  assert.equal(settings.dirty, true); assert.equal(client.writes.length, 1);
});

test('hook original draft and scope survive a new controller after a lost reply', async () => {
  const { client, settings } = await setup(); settings.edit(trusted.key, false); client.lost = true;
  assert.equal(await settings.save(), false);
  const resumed = new HookSettings(client, 'ssh:one', ['/project'], client.operations);
  await resumed.load();
  await resumed.restoreDraft(await fixtureDraft(client.operations, settings.editorId));
  assert.deepEqual(resumed.getSnapshot().drafts, [{ key: trusted.key, enabled: false }]);
  assert.equal(resumed.getSnapshot().writeUncertain, true);
  resumed.useLatest(); assert.equal(await resumed.save(), false);
  assert.equal(client.writes.length, 1);
  assert.equal(await client.operations.find('ssh:one', 'hooks-settings', ['/other']), null);
});

test('suspending during hook preflight prevents the write and preserves the draft', async () => {
  const { client, settings } = await setup();
  let release = () => {}, entered = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  client.beforeList = async () => { entered(); await gate; };
  settings.edit(trusted.key, false);
  const saving = settings.save(); await waiting;
  settings.dispose();
  assert.equal(settings.getSnapshot().saving, false);
  assert.equal(settings.getSnapshot().writeUncertain, false);
  assert.equal(settings.getSnapshot().needsRefresh, true);
  release(); assert.equal(await saving, false);
  assert.equal(client.writes.length, 0); assert.equal(settings.dirty, true);
});

test('a late durable hook receipt permits explicit review after suspension', async () => {
  const { client, settings } = await setup();
  let release = () => {}, entered = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  client.beforeWrite = async () => { entered(); await gate; };
  settings.edit(trusted.key, false);
  const saving = settings.save(); await waiting;
  settings.dispose();
  assert.equal(settings.getSnapshot().writeUncertain, true);
  release(); assert.equal(await saving, false);
  await settings.load();
  assert.equal(settings.getSnapshot().writeUncertain, false);
  assert.ok(settings.getSnapshot().latest);
  settings.useLatest();
  assert.equal(settings.dirty, false); assert.equal(await settings.save(), false); assert.equal(client.writes.length, 1);
});

test('a newer hook edit survives controller replacement without changing the original submission', async () => {
  const { client, settings } = await setup();
  let release = () => {}, entered = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  client.beforeWrite = async () => { entered(); await gate; };
  settings.edit(trusted.key, false);
  const saving = settings.save(); await waiting; settings.dispose(); release(); await saving;
  await settings.load(); settings.useLatest();
  settings.edit(trusted.key, true); await settings.retryDraftPersistence();
  const record = await client.operations.find('ssh:one', 'hooks-settings', ['/project']);
  assert.deepEqual((record?.origin.draft as { drafts: unknown }).drafts, [{ key: trusted.key, enabled: false }]);
  const resumed = new HookSettings(client, 'ssh:one', ['/project'], client.operations); await resumed.load();
  await resumed.restoreDraft(await fixtureDraft(client.operations, settings.editorId));
  assert.deepEqual(resumed.getSnapshot().drafts, [{ key: trusted.key, enabled: true }]);
  assert.equal(client.writes.length, 1);
});

test('a retained hook controller checks its own original ID after the saved copy is closed', async () => {
  const { client, settings } = await setup(); client.lost = true;
  settings.edit(trusted.key, false); assert.equal(await settings.save(), false);
  const original = await client.operations.find('ssh:one', 'hooks-settings', ['/project']); assert.ok(original);
  const host = client.host.bind(client); let present = true;
  const checked: unknown[] = [];
  client.host = async <T>(endpoint: string, params?: Record<string, unknown>): Promise<T> => {
    if (endpoint === 'configuration-write' && params?.action === 'status') {
      checked.push(params.operationId);
      return { operation: present ? { operationId: original.operationId, hostId: 'ssh:one', method: 'config/batchWrite', state: 'succeeded', terminal: { kind: 'ok' } } : null } as T;
    }
    return host<T>(endpoint, params);
  };
  await client.operations.check(original.operationId); await client.operations.finish(original.operationId);
  present = false; await settings.load(); assert.equal(settings.getSnapshot().writeUncertain, true);
  present = true; await settings.load(); assert.equal(settings.getSnapshot().writeUncertain, false);
  settings.useLatest(); assert.equal(settings.dirty, false); assert.equal(client.writes.length, 1);
  assert.deepEqual(checked, [original.operationId, original.operationId, original.operationId]);
});

test('a closed blocked hook request is reconciled using its distinct blocker identity', async () => {
  const { client, settings } = await setup();
  const host = client.host.bind(client), checked: unknown[] = [];
  let present = true;
  client.host = async <T>(endpoint: string, params?: Record<string, unknown>): Promise<T> => {
    if (endpoint === 'configuration-write' && params?.action === 'submit') {
      return { outcome: 'blocked', operation: { operationId: 'other-id', hostId: 'other-host', method: 'skills/config/write', state: 'unknown' } } as T;
    }
    if (endpoint === 'configuration-write' && params?.action === 'status') {
      checked.push([params.hostId, params.operationId]);
      return { operation: present ? { operationId: 'other-id', hostId: 'other-host', method: 'skills/config/write', state: 'succeeded', terminal: { kind: 'effectiveEnabled', value: true } } : null } as T;
    }
    return host<T>(endpoint, params);
  };
  settings.edit(trusted.key, false); assert.equal(await settings.save(), false);
  const original = await client.operations.find('ssh:one', 'hooks-settings', ['/project']); assert.ok(original);
  await client.operations.check(original.operationId); await client.operations.finish(original.operationId); present = false;
  await settings.load(); assert.equal(settings.getSnapshot().writeUncertain, false);
  settings.useLatest(); assert.equal(settings.dirty, true); assert.equal(client.writes.length, 0);
  assert.deepEqual(checked, [['other-host', 'other-id']]);
});

test('a retained hook editor can review its exact closed not-sent operation after the host restarts', async () => {
  const { client, settings } = await setup();
  const host = client.host.bind(client); const calls: string[] = [];
  client.host = async <T>(endpoint: string, params?: Record<string, unknown>): Promise<T> => {
    if (endpoint === 'configuration-write') {
      calls.push(String(params?.action));
      if (params?.action === 'submit') return { outcome: 'not-started', error: { message: 'prepare failed', uncertain: false }, operation: {
        operationId: params.operationId, hostId: params.hostId, method: params.method, state: 'preparing', storageError: true,
        observedTerminal: { kind: 'not-sent' },
      } } as T;
      if (params?.action === 'status') return { operation: null } as T;
    }
    return host<T>(endpoint, params);
  };
  settings.edit(trusted.key, false); assert.equal(await settings.save(), false);
  const original = await client.operations.find('ssh:one', 'hooks-settings', ['/project']); assert.ok(original);
  assert.equal(settings.getSnapshot().writeUncertain, true);
  await client.operations.check(original.operationId); await client.operations.confirmNotSent(original.operationId); await client.operations.finish(original.operationId);
  await settings.load(); assert.equal(settings.getSnapshot().writeUncertain, false);
  assert.ok(settings.getSnapshot().latest); settings.useLatest(); assert.equal(settings.dirty, true);
  assert.deepEqual(calls, ['submit', 'status']); assert.equal(client.writes.length, 0);
});

test('suspending a hook editor does not unfreeze a pending discard', async () => {
  const { client, settings } = await setup(); settings.edit(trusted.key, false); await settings.retryDraftPersistence();
  const clear = client.operations.clearEditorDraft.bind(client.operations); let enter = () => {}, release = () => {};
  const waiting = new Promise<void>(resolve => { enter = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  client.operations.clearEditorDraft = async (...args) => { enter(); await gate; return clear(...args); };
  const discarding = settings.discard(); await waiting; settings.dispose();
  assert.equal(settings.getSnapshot().saving, true); settings.edit(trusted.key, true); assert.equal(settings.dirty, true);
  release(); assert.equal(await discarding, true); assert.equal(settings.dirty, false);
});

test('a changed trust state or override cannot silently apply a pending edit', async () => {
  const { client, settings } = await setup(); settings.edit(trusted.key, false); client.hooks[0].trustStatus = 'modified';
  assert.equal(await settings.save(), false); settings.useLatest();
  assert.equal(settings.dirty, true); assert.match(settings.getSnapshot().error || '', /requires review/); assert.equal(client.writes.length, 0);
  await settings.discard(); assert.equal(settings.dirty, false); assert.equal(settings.getSnapshot().hooks[0].trustStatus, 'modified');
  client.hooks[0].trustStatus = 'trusted'; await settings.load(); settings.edit(trusted.key, false); client.override = true;
  assert.equal(await settings.save(), false); assert.equal(settings.dirty, true); assert.match(settings.getSnapshot().error || '', /overrides/);
});

test('omitted optional matcher and command async use protocol defaults', async () => {
  const client = new FakeClient();
  const withoutOptionals = { ...trusted } as Partial<typeof trusted>;
  delete withoutOptionals.matcher; delete withoutOptionals.async;
  client.hooks = [withoutOptionals as typeof trusted];
  const settings = new HookSettings(client, 'ssh:one', ['/project'], client.operations);
  await settings.load();
  assert.equal(settings.getSnapshot().error, null);
  assert.equal(settings.getSnapshot().hooks[0].matcher, null);
  assert.deepEqual(settings.getSnapshot().hooks[0].handler, { type: 'command', command: 'echo fixture', async: false });
  client.hooks[0] = { ...trusted, async: 'false' as unknown as boolean };
  await settings.load();
  assert.match(settings.getSnapshot().error ?? '', /Invalid hook handler/);
});
