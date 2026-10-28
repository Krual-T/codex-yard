import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WorkbenchClient, WorkbenchEvent } from '../src/renderer/workbench-contract.ts';
import { canEditHook, HookSettings } from '../src/renderer/settings/hooks.ts';

const trusted = { key: 'event."review"', eventName: 'sessionStart', matcher: null, source: 'user', sourcePath: '/fixture/hooks.json',
  trustStatus: 'trusted', isManaged: false, enabled: true, timeoutSec: 60, handlerType: 'command', command: 'echo fixture', async: false,
  currentHash: 'private-internal-value' };
const untrusted = { ...trusted, key: 'new', trustStatus: 'untrusted' };
class FakeClient implements WorkbenchClient {
  hooks = [{ ...trusted }, { ...untrusted }];
  version = 'v1'; profile: string | null = null; failRead = false; lost = false; override = false;
  late: (() => void) | null = null;
  deferLost = false;
  beforeList?: () => Promise<void>; beforeWrite?: () => Promise<void>;
  writes: { params: Record<string, unknown>; hostId?: string }[] = [];
  subscribe(_listener: (event: WorkbenchEvent) => void) { return () => {}; }
  async reply(): Promise<void> { throw new Error('Unexpected approval'); }
  async host<T>(endpoint: string, params?: Record<string, unknown>): Promise<T> {
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
    ] } as T;
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
const setup = async () => { const client = new FakeClient(), settings = new HookSettings(client, 'ssh:one', ['/project']); await settings.load(); return { client, settings }; };

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
  settings.useLatest(); settings.discard();
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
  await settings.load(); settings.useLatest(); settings.discard();
  assert.equal(settings.getSnapshot().writeUncertain, true);
  assert.equal(settings.dirty, true); assert.equal(client.writes.length, 1);
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

test('suspending after a hook write was sent keeps it fenced even after a late success', async () => {
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
  await settings.load(); settings.useLatest(); settings.discard();
  assert.equal(settings.getSnapshot().writeUncertain, true);
  assert.equal(settings.dirty, true); assert.equal(await settings.save(), false); assert.equal(client.writes.length, 1);
});

test('a changed trust state or override cannot silently apply a pending edit', async () => {
  const { client, settings } = await setup(); settings.edit(trusted.key, false); client.hooks[0].trustStatus = 'modified';
  assert.equal(await settings.save(), false); settings.useLatest();
  assert.equal(settings.dirty, true); assert.match(settings.getSnapshot().error || '', /requires review/); assert.equal(client.writes.length, 0);
  settings.discard(); assert.equal(settings.dirty, false); assert.equal(settings.getSnapshot().hooks[0].trustStatus, 'modified');
  client.hooks[0].trustStatus = 'trusted'; await settings.load(); settings.edit(trusted.key, false); client.override = true;
  assert.equal(await settings.save(), false); assert.equal(settings.dirty, true); assert.match(settings.getSnapshot().error || '', /overrides/);
});

test('omitted optional matcher and command async use protocol defaults', async () => {
  const client = new FakeClient();
  const withoutOptionals = { ...trusted } as Partial<typeof trusted>;
  delete withoutOptionals.matcher; delete withoutOptionals.async;
  client.hooks = [withoutOptionals as typeof trusted];
  const settings = new HookSettings(client, 'ssh:one', ['/project']);
  await settings.load();
  assert.equal(settings.getSnapshot().error, null);
  assert.equal(settings.getSnapshot().hooks[0].matcher, null);
  assert.deepEqual(settings.getSnapshot().hooks[0].handler, { type: 'command', command: 'echo fixture', async: false });
  client.hooks[0] = { ...trusted, async: 'false' as unknown as boolean };
  await settings.load();
  assert.match(settings.getSnapshot().error ?? '', /Invalid hook handler/);
});
