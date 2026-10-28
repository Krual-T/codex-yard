import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WorkbenchClient, WorkbenchEvent } from '../src/renderer/workbench-contract.ts';
import { canEditSkill, SkillSettings } from '../src/renderer/settings/skills.ts';
import { fixtureConfigurationHost, fixtureDraft, fixtureOperations, fixtureSource } from './renderer-settings-sections-config-fixture.ts';

const local = { name: 'review', description: 'Review changes', path: '/project/.agents/skills/review/SKILL.md', scope: 'repo', enabled: true, pluginId: null };
const plugin = { name: 'bundle:review', description: 'Plugin review', path: '/plugin/review/SKILL.md', scope: 'user', enabled: true, pluginId: 'bundle' };
class FakeClient implements WorkbenchClient {
  operations = fixtureOperations(this);
  skills = [{ ...local }, { ...plugin }];
  writes: { params: Record<string, unknown>; hostId?: string }[] = [];
  failRead = false; failWriteAt = 0; lostWriteAt = 0; override = false;
  generation = 'generation-a'; sourceAvailable = true; hostWrites: Record<string, unknown>[] = [];
  reads = 0; beforeRead?: () => Promise<void>;
  beforeWrite?: () => Promise<void>;
  subscribe(_listener: (event: WorkbenchEvent) => void) { return () => {}; }
  async reply(): Promise<void> { throw new Error('Unexpected approval'); }
  async host<T>(endpoint: string, params?: Record<string, unknown>): Promise<T> {
    if (endpoint === 'configuration-write' && params) { this.hostWrites.push(params); return await fixtureConfigurationHost(this, params) as T; }
    throw new Error('Unexpected host call');
  }
  async rpc<T>(method: string, params?: Record<string, unknown>, hostId?: string): Promise<T> {
    assert.equal(hostId, 'ssh:one');
    if (method === 'skills/list') {
      assert.deepEqual(params, { cwds: ['/project'], forceReload: true });
      this.reads++; await this.beforeRead?.();
      if (this.failRead) throw new Error('read failed');
      return { data: [{ cwd: '/project', skills: this.skills.map(skill => ({ ...skill })), errors: [{ path: '/fixture/bad', message: 'invalid fixture' }] }],
        ...(this.sourceAvailable ? { yardConfigSource: fixtureSource(hostId, '/fixture/codex', this.generation) } : {}) } as T;
    }
    if (method === 'skills/config/write') {
      assert.ok(params); this.writes.push({ params, hostId });
      await this.beforeWrite?.();
      if (this.failWriteAt === this.writes.length) throw new Error('write unsupported');
      const matches = this.skills.filter(skill => params.name === skill.name || params.path === skill.path);
      assert.equal(matches.length, 1);
      matches[0].enabled = params.enabled as boolean;
      if (this.lostWriteAt === this.writes.length) throw new Error('reply lost');
      return { effectiveEnabled: this.override ? !params.enabled : params.enabled } as T;
    }
    throw new Error(`Unexpected ${method}`);
  }
}
const setup = async () => { const client = new FakeClient(), settings = new SkillSettings(client, 'ssh:one', ['/project'], client.operations); await settings.load(); return { client, settings }; };
const id = (name: string, path: string) => JSON.stringify([path, name]);

test('skill source changes preserve the draft and require explicit review', async () => {
  const { client, settings } = await setup(); settings.edit(id(local.name, local.path), false); client.generation = 'generation-b';
  assert.equal(await settings.save(), false); assert.equal(settings.dirty, true); assert.equal(client.hostWrites.length, 0);
  settings.useLatest(); assert.equal(await settings.save(), true);
  assert.deepEqual(client.hostWrites[0]?.source, fixtureSource('ssh:one', '/fixture/codex', 'generation-b'));
  const absent = await setup(); absent.client.sourceAvailable = false; await absent.settings.load();
  absent.settings.edit(id(local.name, local.path), false); assert.equal(await absent.settings.save(), false); assert.equal(absent.client.hostWrites.length, 0);
});

test('skill writes use original path and namespaced selectors and refresh the authoritative result', async () => {
  const { client, settings } = await setup();
  assert.deepEqual(settings.getSnapshot().warnings, ['/fixture/bad: invalid fixture']);
  settings.edit(id(local.name, local.path), false);
  settings.edit(id(plugin.name, plugin.path), false);
  assert.equal(await settings.save(), true);
  assert.deepEqual(client.writes.map(write => write.params), [
    { path: local.path, enabled: false }, { name: plugin.name, enabled: false },
  ]);
  assert.equal(settings.dirty, false);
  assert.deepEqual(settings.getSnapshot().skills.map(skill => skill.enabled), [false, false]);
  assert.equal(await client.operations.find('ssh:one', 'skills-settings', ['/project']), null);
});

test('changed state is reviewed before a write and missing or ambiguous selectors cannot be adopted', async () => {
  const { client, settings } = await setup();
  settings.edit(id(local.name, local.path), false); client.skills[0].enabled = false;
  assert.equal(await settings.save(), false); assert.equal(client.writes.length, 0);
  assert.ok(settings.getSnapshot().latest); assert.equal(settings.dirty, true);
  settings.useLatest(); assert.equal(settings.dirty, false);
  settings.edit(id(plugin.name, plugin.path), false);
  client.skills.push({ ...plugin, path: '/other/review/SKILL.md' });
  assert.equal(await settings.save(), false); assert.ok(settings.getSnapshot().latest);
  settings.useLatest(); assert.equal(settings.dirty, true); assert.match(settings.getSnapshot().error || '', /ambiguous/);
  settings.discard(); assert.equal(settings.dirty, false);
  const sameSelector = settings.getSnapshot().skills.filter(skill => skill.name === plugin.name);
  assert.equal(sameSelector.every(skill => !canEditSkill(skill, settings.getSnapshot().skills)), true);
});

test('lost or partial replies remain fenced after refresh and review within the current page', async () => {
  const { client, settings } = await setup();
  settings.edit(id(local.name, local.path), false); settings.edit(id(plugin.name, plugin.path), false);
  client.failWriteAt = 2;
  assert.equal(await settings.save(), false); assert.equal(settings.getSnapshot().needsRefresh, true);
  assert.equal(settings.getSnapshot().drafts.length, 2); assert.match(settings.getSnapshot().error || '', /write unsupported/);
  assert.equal(await settings.save(), false);
  client.failRead = true; await settings.load(); assert.equal(settings.getSnapshot().drafts.length, 2);
  client.failRead = false; await settings.load(); assert.ok(settings.getSnapshot().latest);
  assert.equal(settings.getSnapshot().writeUncertain, true);
  settings.useLatest(); assert.equal(settings.getSnapshot().drafts.length, 2);
  assert.equal(await settings.save(), false); assert.equal(client.writes.length, 2);
  settings.discard(); await settings.load();
  settings.edit(id(plugin.name, plugin.path), false);
  assert.equal(settings.dirty, true);
  assert.equal(settings.getSnapshot().writeUncertain, true);
  assert.equal(client.writes.length, 2);
});

test('partial skill writes restore the complete draft and never replay the unknown operation', async () => {
  const { client, settings } = await setup();
  settings.edit(id(local.name, local.path), false); settings.edit(id(plugin.name, plugin.path), false);
  client.lostWriteAt = 2;
  assert.equal(await settings.save(), false);
  const resumed = new SkillSettings(client, 'ssh:one', ['/project'], client.operations); await resumed.load();
  await resumed.restoreDraft(await fixtureDraft(client.operations, settings.editorId));
  assert.deepEqual(resumed.getSnapshot().drafts, [{ id: id(local.name, local.path), enabled: false }, { id: id(plugin.name, plugin.path), enabled: false }]);
  assert.equal(resumed.getSnapshot().writeUncertain, true);
  resumed.useLatest(); assert.equal(await resumed.save(), false); assert.equal(client.writes.length, 2);
  assert.equal(await client.operations.find('ssh:one', 'skills-settings', ['/other']), null);
});

test('different effective responses preserve edits until refresh and review', async () => {
  const { client, settings } = await setup();
  settings.edit(id(local.name, local.path), false); client.override = true;
  assert.equal(await settings.save(), false); assert.equal(settings.dirty, true);
  assert.match(settings.getSnapshot().error || '', /different effective/);
  await settings.load(); settings.useLatest(); assert.equal(settings.dirty, false);
  client.skills[0].enabled = true; settings.invalidate();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(settings.getSnapshot().skills[0].enabled, true);
  settings.dispose();
});

test('invalidation during a save schedules a fresh read after the write', async () => {
  const { client, settings } = await setup();
  let release: () => void = () => {}, entered: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  client.beforeRead = async () => { if (client.writes.length === 1 && client.reads === 3) { entered(); await gate; } };
  settings.edit(id(local.name, local.path), false);
  const saving = settings.save(); await waiting;
  settings.invalidate(); client.skills[1].enabled = false; release();
  assert.equal(await saving, true);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(client.reads, 4);
  assert.deepEqual(settings.getSnapshot().skills.map(skill => skill.enabled), [false, false]);
});

test('suspending during skill preflight prevents the write and preserves the draft', async () => {
  const { client, settings } = await setup();
  let release = () => {}, entered = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  client.beforeRead = async () => { entered(); await gate; };
  settings.edit(id(local.name, local.path), false);
  const saving = settings.save(); await waiting;
  settings.dispose();
  assert.equal(settings.getSnapshot().saving, false);
  assert.equal(settings.getSnapshot().writeUncertain, false);
  assert.equal(settings.getSnapshot().needsRefresh, true);
  release(); assert.equal(await saving, false);
  assert.equal(client.writes.length, 0); assert.equal(settings.dirty, true);
});

test('a late durable skill receipt permits explicit review after suspension', async () => {
  const { client, settings } = await setup();
  let release = () => {}, entered = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  client.beforeWrite = async () => { entered(); await gate; };
  settings.edit(id(local.name, local.path), false);
  const saving = settings.save(); await waiting;
  settings.dispose();
  assert.equal(settings.getSnapshot().writeUncertain, true);
  release(); assert.equal(await saving, false);
  await settings.load(); settings.useLatest();
  assert.equal(settings.getSnapshot().writeUncertain, false);
  assert.equal(settings.dirty, false); assert.equal(await settings.save(), false); assert.equal(client.writes.length, 1);
});

test('a newer skill edit survives controller replacement without changing the original submission', async () => {
  const { client, settings } = await setup();
  let release = () => {}, entered = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  client.beforeWrite = async () => { entered(); await gate; };
  settings.edit(id(local.name, local.path), false);
  const saving = settings.save(); await waiting; settings.dispose(); release(); await saving;
  await settings.load(); settings.useLatest();
  settings.edit(id(local.name, local.path), true); await settings.retryDraftPersistence();
  const record = await client.operations.find('ssh:one', 'skills-settings', ['/project']);
  assert.deepEqual((record?.origin.draft as { drafts: unknown }).drafts, [{ id: id(local.name, local.path), enabled: false }]);
  const resumed = new SkillSettings(client, 'ssh:one', ['/project'], client.operations); await resumed.load();
  await resumed.restoreDraft(await fixtureDraft(client.operations, settings.editorId));
  assert.deepEqual(resumed.getSnapshot().drafts, [{ id: id(local.name, local.path), enabled: true }]);
  assert.equal(client.writes.length, 1);
});

test('an older skill receipt cannot release a later unknown operation after its copy is closed', async () => {
  const { client, settings } = await setup(); client.lostWriteAt = 2;
  settings.edit(id(local.name, local.path), false); settings.edit(id(plugin.name, plugin.path), false);
  assert.equal(await settings.save(), false);
  const original = await client.operations.find('ssh:one', 'skills-settings', ['/project']); assert.ok(original);
  const host = client.host.bind(client); let present = true;
  const checked: unknown[] = [];
  client.host = async <T>(endpoint: string, params?: Record<string, unknown>): Promise<T> => {
    if (endpoint === 'configuration-write' && params?.action === 'status') {
      checked.push(params.operationId);
      return { operation: present ? { operationId: original.operationId, hostId: 'ssh:one', method: 'skills/config/write', state: 'succeeded', terminal: { kind: 'effectiveEnabled', value: false } } : null } as T;
    }
    return host<T>(endpoint, params);
  };
  await client.operations.check(original.operationId); await client.operations.finish(original.operationId);
  const older = await client.operations.find('ssh:one', 'skills-settings', ['/project']); assert.ok(older);
  assert.notEqual(older.operationId, original.operationId); assert.equal(older.phase, 'finished');
  present = false; await settings.load(); assert.equal(settings.getSnapshot().writeUncertain, true);
  present = true; await settings.load(); assert.equal(settings.getSnapshot().writeUncertain, false);
  settings.useLatest(); assert.equal(settings.dirty, false); assert.equal(client.writes.length, 2);
  assert.deepEqual(checked, [original.operationId, original.operationId, original.operationId]);
});

test('a completed first skill cannot release a suspended second in-flight write', async () => {
  const { client, settings } = await setup();
  let release = () => {}, entered = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  client.beforeWrite = async () => { if (client.writes.length === 2) { entered(); await gate; } };
  settings.edit(id(local.name, local.path), false); settings.edit(id(plugin.name, plugin.path), false);
  const saving = settings.save(); await waiting; settings.dispose(); await settings.load();
  assert.equal(settings.getSnapshot().writeUncertain, true);
  settings.useLatest(); assert.equal(settings.getSnapshot().drafts.length, 2);
  release(); assert.equal(await saving, false); await settings.load();
  assert.equal(settings.getSnapshot().writeUncertain, false);
  settings.useLatest(); assert.equal(settings.dirty, false); assert.equal(client.writes.length, 2);
});
