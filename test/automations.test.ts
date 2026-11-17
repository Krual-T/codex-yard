import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createAutomations } from '../src/native/automations.ts';
import type { Automation, AutomationRun } from '../src/native/automations.ts';
import { nextOccurrence } from '../src/native/automation-recurrence.ts';
import { CodexConnection } from '../lib/codex.ts';
import { createFakeCodex, NO_REPLY, fixtureTurn, agentItem } from './fake-codex.ts';
import { createNativeWorkbench } from '../src/native/server.ts';
import { nativeFixture } from './native-fixture.ts';

async function fixture(t: import('node:test').TestContext) {
  const root = await mkdtemp('/tmp/yard-schedule-');
  const fake = await createFakeCodex(root);
  const dataDir = join(root, 'data'); await mkdir(dataDir);
  const connection = new CodexConnection(fake.socketPath, { timeout: 500 });
  await connection.connect();
  let time = Date.parse('2026-11-06T12:00:00Z'), available = true;
  const memberships: string[] = [];
  const options = { dataDir, projectlessRoot: join(root, 'workspaces'), now: () => time,
    connectionFor: async () => { if (!available) throw new Error('Backend offline'); return connection; },
    listProjects: async () => [{ projectId: 'project', projectKind: 'local' as const, hostId: 'local', path: root, label: 'Fixture', hostDisplayName: null, isGitRepository: false }],
    configFor: () => ({}), setMembership: async (id: string) => { memberships.push(id); }, changed() {}, intervalMs: 10 };
  let service = createAutomations(options);
  t.after(async () => { await service.close(); connection.close(); await fake.close(); await rm(root, { recursive: true, force: true }); });
  async function create(extra: Record<string, unknown> = {}) {
    return (await service.fetch('automation-create', { params: { name: 'Review', prompt: 'Review the latest day', kind: 'cron', projectId: 'project',
      rrule: 'FREQ=DAILY;BYHOUR=23;BYMINUTE=30;BYSECOND=0', timeZone: 'Asia/Shanghai', ...extra } }) as { item: Automation }).item;
  }
  const history = async () => (await service.fetch('automation-runs', {}) as { items: AutomationRun[] }).items;
  async function settled() {
    for (let i = 0; i < 100; i++) { if (!(await history()).some(run => run.status === 'starting')) return; await delay(10); }
    throw new Error('Dispatch did not settle');
  }
  return { root, fake, dataDir, connection, options, create, history, settled, memberships,
    get service() { return service; }, setTime: (at: number) => { time = at; }, offline: () => { available = false; },
    async restart() { await service.close(); service = createAutomations(options); return service; } };
}

test('recurrence preserves time zones, stable anchors, COUNT and DST without changing the host timezone', async () => {
  const anchor = Date.parse('2026-11-06T12:00:00Z'), before = process.env.TZ;
  const daily = { rrule: 'FREQ=DAILY;BYHOUR=23;BYMINUTE=30;BYSECOND=0', timeZone: 'Asia/Shanghai', anchor };
  assert.equal(await nextOccurrence(daily, anchor), Date.parse('2026-11-06T15:30:00Z'));
  assert.equal(await nextOccurrence({ ...daily, timeZone: 'UTC' }, anchor), Date.parse('2026-11-06T23:30:00Z'));
  const everyOther = { ...daily, rrule: 'FREQ=DAILY;INTERVAL=2;BYHOUR=23;BYMINUTE=30;BYSECOND=0' };
  assert.equal(await nextOccurrence(everyOther, Date.parse('2026-11-07T00:00:00Z')), Date.parse('2026-11-08T15:30:00Z'));
  const counted = { ...daily, rrule: 'DTSTART:20261106T153000Z\nRRULE:FREQ=DAILY;COUNT=1' };
  assert.equal(await nextOccurrence(counted, anchor), Date.parse('2026-11-06T15:30:00Z'));
  assert.equal(await nextOccurrence(counted, Date.parse('2026-11-06T15:30:00Z')), null);
  const dst = { rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0;BYSECOND=0', timeZone: 'America/New_York', anchor: Date.parse('2026-03-07T00:00:00Z') };
  assert.equal(await nextOccurrence(dst, Date.parse('2026-03-07T15:00:00Z')), Date.parse('2026-03-08T13:00:00Z'));
  await assert.rejects(nextOccurrence({ ...daily, rrule: 'FREQ=DAILY;INTERVAL=0' }, anchor));
  await assert.rejects(nextOccurrence({ ...daily, rrule: 'FREQ=SECONDLY' }, anchor));
  await assert.rejects(nextOccurrence({ ...daily, timeZone: 'Not/A_Zone' }, anchor));
  assert.equal(process.env.TZ, before);
});

test('a running server schedules with no browser, desktop files or desktop process and persists the run', async t => {
  const h = await fixture(t);
  const task = await h.create();
  h.setTime(task.nextRunAt!);
  h.service.start();
  await h.fake.waitFor(message => message.method === 'turn/start'); await h.settled();
  assert.equal(h.fake.calls('thread/start').length, 1);
  assert.equal(h.fake.calls('turn/start').length, 1);
  const run = (await h.history())[0];
  assert.equal(h.fake.calls('turn/start')[0].params.clientUserMessageId, run.id);
  assert.equal(run.status, 'running');
  assert.deepEqual(h.memberships, [run.threadId]);
  await h.restart(); await h.service.tick();
  assert.equal((await h.history())[0].status, 'running');
  assert.equal(h.fake.calls('turn/start').length, 1);
  const thread = h.fake.threads.get(run.threadId!)!;
  thread.turns[0].status = 'completed'; thread.turns[0].items.push(agentItem('answer', 'Review ready')); thread.status = { type: 'idle' };
  await h.service.tick();
  assert.equal((await h.history())[0].summary, 'Review ready');
  assert.equal((await h.history())[0].status, 'completed');
});

test('missed periods coalesce, concurrent checks claim once, and editing the name preserves the recurrence anchor', async t => {
  const h = await fixture(t), task = await h.create();
  h.setTime(task.nextRunAt! + 4 * 86400000);
  await Promise.all([h.service.tick(), h.service.tick(), h.service.tick()]); await h.settled();
  assert.equal((await h.history()).length, 1);
  const updated = (await h.service.fetch('list-automations', {}) as { items: Automation[] }).items[0];
  assert.ok(updated.nextRunAt! > task.nextRunAt! + 4 * 86400000);
  assert.equal((await h.history())[0].scheduledAt, task.nextRunAt);
  const saved = await h.service.fetch('automation-update', { params: { ...updated, projectId: 'project', name: 'New title' } }) as { item: Automation };
  assert.equal(saved.item.anchor, updated.anchor); assert.equal(saved.item.nextRunAt, updated.nextRunAt);
  await assert.rejects(h.service.fetch('automation-run-now', { id: task.id }), /运行中/);
});

test('pause/delete wins over an in-flight schedule calculation, and a paused manual run does not consume the schedule', async t => {
  const h = await fixture(t), task = await h.create();
  h.setTime(task.nextRunAt!);
  const ticking = h.service.tick();
  await h.service.fetch('automation-delete', { id: task.id }); await ticking;
  assert.equal(h.fake.calls('thread/start').length, 0);
  const paused = await h.create({ status: 'PAUSED' });
  await h.service.fetch('automation-run-now', { id: paused.id }); await h.settled();
  const current = (await h.service.fetch('list-automations', {}) as { items: Automation[] }).items[0];
  assert.equal(current.status, 'PAUSED'); assert.equal(current.nextRunAt, null);
  assert.equal((await h.history())[0].scheduledAt, null);
});

test('a disconnected backend preserves due work and another server cannot take ownership of the same data directory', async t => {
  const h = await fixture(t), task = await h.create();
  assert.throws(() => createAutomations(h.options), /已有 Yard/);
  h.offline(); h.setTime(task.nextRunAt!); await h.service.tick();
  assert.equal((await h.history()).length, 0);
  assert.equal((await h.service.fetch('list-automations', {}) as { items: Automation[] }).items[0].nextRunAt, task.nextRunAt);
  assert.match(h.service.status().diagnostic!, /offline/);
});

test('uncertain turn delivery is recovered by the persisted client message ID, not another user turn', async t => {
  const h = await fixture(t), task = await h.create();
  h.fake.handlers.set('turn/start', params => {
    const thread = h.fake.threads.get(String(params.threadId))!;
    thread.turns.push(fixtureTurn('other-user-turn', [agentItem('other-answer', 'Not the scheduled run')]));
    h.fake.defaultResult('turn/start', params); return NO_REPLY;
  });
  await h.service.fetch('automation-run-now', { id: task.id }); await h.settled();
  assert.equal((await h.history())[0].status, 'uncertain');
  await h.restart(); await h.service.tick();
  assert.equal((await h.history())[0].status, 'running');
  assert.notEqual((await h.history())[0].turnId, 'other-user-turn');
  assert.equal(h.fake.calls('turn/start').length, 1);
});

test('an unknown thread creation blocks repeats and requires explicit acknowledgement to release', async t => {
  const h = await fixture(t), task = await h.create();
  h.fake.handlers.set('thread/start', () => NO_REPLY);
  await h.service.fetch('automation-run-now', { id: task.id }); await h.settled();
  const run = (await h.history())[0]; assert.equal(run.status, 'uncertain');
  await h.restart(); await h.service.tick();
  await assert.rejects(h.service.fetch('automation-run-now', { id: task.id }), /待核实/);
  await assert.rejects(h.service.fetch('automation-run-resolve', { id: run.id }), /核查/);
  await h.service.fetch('automation-run-resolve', { id: run.id, confirmed: true });
  assert.equal((await h.history())[0].status, 'released');
  assert.equal(h.fake.calls('thread/start').length, 1);
});

test('a delayed history reply cannot undo read, archive or explicit release changes', async t => {
  const h = await fixture(t), task = await h.create();
  h.fake.handlers.set('turn/start', params => { h.fake.defaultResult('turn/start', params); return NO_REPLY; });
  await h.service.fetch('automation-run-now', { id: task.id }); await h.settled();
  const run = (await h.history())[0];
  h.fake.threads.get(run.threadId!)!.status = { type: 'idle' };
  let entered!: () => void, release!: () => void;
  const reading = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  h.fake.handlers.set('thread/turns/list', async params => { entered(); await held; return h.fake.defaultResult('thread/turns/list', params); });
  const checking = h.service.tick(); await reading;
  await h.service.fetch('inbox-item-set-read-state', { id: run.id, isRead: true });
  h.service.threadArchived('local', run.threadId!, true);
  await h.service.fetch('automation-run-resolve', { id: run.id, confirmed: true });
  release(); await checking;
  const current = (await h.history())[0];
  assert.equal(current.status, 'released'); assert.equal(current.archived, true); assert.ok(current.readAt);
});

test('inbox read state survives restart and deleted task history is retained', async t => {
  const h = await fixture(t), task = await h.create();
  h.fake.handlers.set('turn/start', params => {
    const result = h.fake.defaultResult('turn/start', params);
    const thread = h.fake.threads.get(String(params.threadId))!;
    thread.turns[0].status = 'completed'; thread.status = { type: 'idle' };
    return { ...result, turn: thread.turns[0] };
  });
  await h.service.fetch('automation-run-now', { id: task.id }); await h.settled();
  const run = (await h.history())[0];
  await h.service.fetch('inbox-item-set-read-state', { id: run.id, isRead: true });
  await h.service.fetch('automation-delete', { id: task.id });
  await h.restart();
  assert.ok((await h.history())[0].readAt);
  const inbox = await h.service.fetch('inbox-items', {}) as { items: { id: string }[]; unreadRunCounts: { total: number } };
  assert.equal(inbox.items[0].id, run.id); assert.equal(inbox.unreadRunCounts.total, 0);
  assert.deepEqual(await h.service.fetch('list-automations', {}), { items: [] });
  const db = new DatabaseSync(join(h.dataDir, 'automations.sqlite'));
  assert.equal(Number(db.prepare('SELECT count(*) AS n FROM automation_runs').get()!.n), 1); db.close();
});

test('native workbench starts its own scheduler and refuses a second owner before replacing tools', async t => {
  const root = await mkdtemp('/tmp/yard-schedule-host-');
  const fake = await createFakeCodex(root), native = await nativeFixture(root);
  const options = { ...native, dataDir: join(root, 'data'), socketPath: fake.socketPath, codexHome: join(root, 'absent-desktop'), workspace: root, port: 0 };
  const app = await createNativeWorkbench(options);
  t.after(async () => { await app.close(); await fake.close(); await rm(root, { recursive: true, force: true }); });
  const status = await fetch(app.url + '/api/status').then(r => r.json()) as { clients: number; scheduler: { running: boolean } };
  assert.equal(status.clients, 0); assert.equal(status.scheduler.running, true);
  await assert.rejects(createNativeWorkbench(options), /已有 Yard/);
  assert.equal((await fetch(app.url + '/api/status')).status, 200);
});
