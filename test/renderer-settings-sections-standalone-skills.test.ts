import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WorkbenchClient, WorkbenchEvent } from '../src/renderer/workbench-contract.ts';
import { canEditSkill, SkillSettings } from '../src/renderer/settings/skills.ts';

const local = { name: 'review', description: 'Review changes', path: '/project/.agents/skills/review/SKILL.md', scope: 'repo', enabled: true, pluginId: null };
const plugin = { name: 'bundle:review', description: 'Plugin review', path: '/plugin/review/SKILL.md', scope: 'user', enabled: true, pluginId: 'bundle' };
class FakeClient implements WorkbenchClient {
  skills = [{ ...local }, { ...plugin }];
  writes: { params: Record<string, unknown>; hostId?: string }[] = [];
  failRead = false; failWriteAt = 0; lostWriteAt = 0; override = false;
  reads = 0; beforeRead?: () => Promise<void>;
  subscribe(_listener: (event: WorkbenchEvent) => void) { return () => {}; }
  async reply(): Promise<void> { throw new Error('Unexpected approval'); }
  async host<T>(): Promise<T> { throw new Error('Unexpected host call'); }
  async rpc<T>(method: string, params?: Record<string, unknown>, hostId?: string): Promise<T> {
    assert.equal(hostId, 'ssh:one');
    if (method === 'skills/list') {
      assert.deepEqual(params, { cwds: ['/project'], forceReload: true });
      this.reads++; await this.beforeRead?.();
      if (this.failRead) throw new Error('read failed');
      return { data: [{ cwd: '/project', skills: this.skills.map(skill => ({ ...skill })), errors: [{ path: '/fixture/bad', message: 'invalid fixture' }] }] } as T;
    }
    if (method === 'skills/config/write') {
      assert.ok(params); this.writes.push({ params, hostId });
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
const setup = async () => { const client = new FakeClient(), settings = new SkillSettings(client, 'ssh:one', ['/project']); await settings.load(); return { client, settings }; };
const id = (name: string, path: string) => JSON.stringify([path, name]);

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
  assert.equal(settings.dirty, false);
  assert.equal(settings.getSnapshot().writeUncertain, true);
  assert.equal(client.writes.length, 2);
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
