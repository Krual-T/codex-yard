import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createAutomations } from '../src/native/automations.ts';
import type { Automation, AutomationRun } from '../src/native/automations.ts';
import { nextOccurrence } from '../src/native/automation-recurrence.ts';
import { CodexConnection } from '../lib/codex.ts';
import type { ThreadReadState } from '../lib/codex-protocol.ts';
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
  const readStates = new Map<string, ThreadReadState>();
  let revision = 0;
  function receipt(threadId: string) {
    if (!readStates.has(threadId)) readStates.set(threadId, { revision: String(++revision),
      firstUnread: { type: 'threadStart' } });
    return readStates.get(threadId)!;
  }
  function mark(threadId: string, firstUnread: ThreadReadState['firstUnread']) {
    const state = { firstUnread, revision: String(++revision) }; readStates.set(threadId, state);
    fake.send({ method: 'thread/readState/changed', params: { threadId, readState: state } });
    return state;
  }
  fake.handlers.set('thread/read', params => ({ ...fake.defaultResult('thread/read', params) as object,
    readState: receipt(String(params.threadId)) }));
  fake.handlers.set('thread/readState/update', params => {
    const threadId = String(params.threadId);
    if (receipt(threadId).revision !== params.expectedRevision) throw new Error('read state revision conflict');
    const operation = params.operation as { type: string };
    const latest = fake.threads.get(threadId)?.turns.at(-1);
    return { readState: mark(threadId, operation.type === 'read' ? null : latest ? { type: 'turn', turnId: latest.id } : { type: 'threadStart' }) };
  });
  fake.handlers.set('thread/turns/list', params => ({ data: fake.threads.get(String(params.threadId))?.turns ?? [], nextCursor: null }));
  const options = { dataDir, projectlessRoot: join(root, 'workspaces'), now: () => time,
    connectionFor: async () => { if (!available) throw new Error('Backend offline'); return connection; },
    listProjects: async () => [{ projectId: 'project', projectKind: 'local' as const, hostId: 'local', path: root, label: 'Fixture', hostDisplayName: null, isGitRepository: false }],
    configFor: () => ({}), setMembership: async (id: string) => { memberships.push(id); }, changed() {}, intervalMs: 10 };
  let service = createAutomations(options);
  connection.on('message', message => service.observe('local', message));
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
  function persisted(id: string) {
    const db = new DatabaseSync(join(dataDir, 'automations.sqlite'));
    try { return JSON.parse(String(db.prepare('SELECT data FROM automation_runs WHERE id=?').get(id)!.data)) as Record<string, unknown>; }
    finally { db.close(); }
  }
  async function completed() {
    const task = await create({ status: 'PAUSED' });
    await service.fetch('automation-run-now', { id: task.id }); await settled();
    const run = (await history())[0], thread = fake.threads.get(run.threadId!)!;
    thread.turns[0].status = 'completed'; thread.turns[0].items.push(agentItem('answer', 'Backend result')); thread.status = { type: 'idle' };
    return (await history())[0];
  }
  return { root, fake, dataDir, connection, options, create, history, settled, memberships, readStates, mark,
    completed, persisted,
    get service() { return service; }, setTime: (at: number) => { time = at; }, offline: () => { available = false; },
    online: () => { available = true; },
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
  assert.equal(h.fake.calls('thread/start')[0].params.projectId, 'project');
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

test('native project migration repairs a saved schedule without resetting it and survives restart', async t => {
  const h = await fixture(t);
  const original = (await h.options.listProjects())[0];
  h.options.listProjects = async () => [{ ...original, projectId: h.root }];
  const task = await h.create({ projectId: h.root, status: 'PAUSED' });
  await h.service.close();
  h.fake.handlers.set('initialize', () => ({ userAgent: 'codex-tui/0.164.0 (Linux)' }));
  await writeFile(join(h.dataDir, 'projects.json'), JSON.stringify([{ name: 'Fixture', path: h.root }]));
  const app = await createNativeWorkbench({ ...await nativeFixture(h.root), port: 0,
    dataDir: h.dataDir, workspace: h.root, socketPath: h.fake.socketPath, codexHome: join(h.root, 'codex'),
    hostCatalog: { hosts: [], projects: [], assignments: {} } });
  let projectId = '';
  try {
    const { items: [migrated] } = await app.automations.fetch('list-automations', {}) as { items: Automation[] };
    const project = [...h.fake.projects].find(([, project]) => (project.roots as { path: string }[])[0]?.path === h.root);
    assert.ok(project); projectId = project[0];
    assert.deepEqual(migrated, { ...task, target: { type: 'project', projectId }, updatedAt: migrated.updatedAt });
    assert.ok(migrated.updatedAt > task.updatedAt);
  } finally { await app.close(); }
  await h.restart();
  assert.deepEqual((await h.service.fetch('list-automations', {}) as { items: Automation[] }).items[0].target, { type: 'project', projectId });
  h.options.listProjects = async () => [{ ...original, projectId }];
  await h.service.fetch('automation-run-now', { id: task.id }); await h.settled();
  assert.equal(h.fake.calls('thread/start').at(-1)!.params.projectId, projectId);
  assert.equal((await h.history())[0].status, 'running');
});

test('an unattended due task and a pause edit resolve the old project ID before a list is opened', async t => {
  const h = await fixture(t), original = (await h.options.listProjects())[0];
  const task = await h.create(), paused = await h.create({ name: 'Pause edit' });
  h.options.listProjects = async () => [{ ...original, projectId: 'native-project' }];
  Object.assign(h.options, { resolveProjectId: async (hostId: string, id: string) => {
    assert.equal(hostId, 'local'); return id === 'project' ? 'native-project' : id;
  } });
  const saved = await h.service.fetch('automation-update', { params: { ...paused, status: 'PAUSED' } }) as { item: Automation };
  assert.deepEqual(saved.item.target, { type: 'project', projectId: 'native-project' });
  h.setTime(task.nextRunAt!);
  await h.service.tick(); await h.settled();
  assert.equal(h.fake.calls('thread/start').length, 1);
  assert.equal(h.fake.calls('thread/start')[0].params.projectId, 'native-project');
  assert.equal((await h.history())[0].automationId, task.id);
  assert.equal((await h.history())[0].status, 'running');
});

test('offline identity lookup preserves the task list and a removed project does not attach by directory', async t => {
  const h = await fixture(t), task = await h.create(), original = (await h.options.listProjects())[0];
  Object.assign(h.options, { resolveProjectId: async () => { throw new Error('Backend offline'); } });
  assert.deepEqual((await h.service.fetch('list-automations', {}) as { items: Automation[] }).items, [task]);
  h.options.listProjects = async () => [{ ...original, projectId: 'unrelated-project' }];
  Object.assign(h.options, { resolveProjectId: async () => undefined });
  await h.service.fetch('automation-run-now', { id: task.id }); await h.settled();
  assert.equal(h.fake.calls('thread/start').length, 0);
  assert.equal((await h.history())[0].status, 'failed');
  assert.match((await h.history())[0].error!, /项目已移除/);
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
  assert.equal((await h.history())[0].status, 'running');
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
  h.fake.handlers.set('turn/start', params => {
    h.fake.defaultResult('turn/start', params); h.fake.threads.get(String(params.threadId))!.status = { type: 'idle' }; return NO_REPLY;
  });
  await h.service.fetch('automation-run-now', { id: task.id }); await h.settled();
  const run = (await h.history())[0];
  h.fake.threads.get(run.threadId!)!.status = { type: 'idle' };
  let entered!: () => void, release!: () => void;
  const reading = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  let paused = false;
  h.fake.handlers.set('thread/turns/list', async params => {
    if (!paused) { paused = true; entered(); await held; }
    return h.fake.defaultResult('thread/turns/list', params);
  });
  const checking = h.service.tick(); await reading;
  await h.service.fetch('inbox-item-set-read-state', { id: run.id, isRead: true });
  await h.connection.request('thread/archive', { threadId: run.threadId }, { mutating: true });
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

test('existing runs use backend results while a small terminal history survives disconnection and deletion', async t => {
  const h = await fixture(t), run = await h.completed();
  const stored = h.persisted(run.id);
  assert.equal(stored.phase, 'settled');
  for (const key of ['status', 'summary', 'error', 'readAt', 'archived']) assert.equal(Object.hasOwn(stored, key), false, key);
  const turn = h.fake.threads.get(run.threadId!)!.turns[0];
  turn.status = 'failed'; turn.error = { message: 'Backend failure' }; turn.items[1].text = 'Backend corrected result';
  const live = (await h.history())[0];
  assert.equal(live.status, 'failed'); assert.equal(live.error, 'Backend failure'); assert.equal(live.summary, 'Backend corrected result');
  await h.service.fetch('inbox-item-set-read-state', { id: run.id, isRead: true });
  await h.service.fetch('automation-run-archive', { id: run.id });
  await h.service.beforeThreadDelete('local', run.threadId!);
  h.offline(); await h.restart();
  const offline = (await h.history())[0];
  assert.equal(offline.summary, live.summary); assert.equal(offline.archived, true); assert.ok(offline.readAt);
  assert.match(h.service.status().diagnostic!, /offline/);
  await assert.rejects(h.service.fetch('inbox-items', {}), /offline/);
  h.online(); h.fake.threads.delete(run.threadId!);
  h.service.observe('local', { method: 'thread/deleted', params: { threadId: run.threadId } });
  await h.restart();
  const deleted = (await h.history())[0];
  assert.equal(deleted.status, 'failed'); assert.equal(deleted.summary, live.summary); assert.equal(deleted.archived, true); assert.ok(deleted.readAt);
  assert.equal((await h.service.fetch('inbox-items', {}) as { items: { status: string }[] }).items[0].status, 'ARCHIVED');
  assert.equal(h.fake.calls('turn/start').length, 1);
});

test('inbox writes share revision guarded receipts and backend archive state across clients and restarts', async t => {
  const h = await fixture(t), run = await h.completed();
  const inbox = async () => await h.service.fetch('inbox-items', {}) as { items: { readAt: number | null; status: string }[]; unreadRunCounts: { total: number } };
  assert.equal((await inbox()).unreadRunCounts.total, 1);
  h.mark(run.threadId!, null); await delay(10);
  assert.equal((await inbox()).unreadRunCounts.total, 0);
  h.mark(run.threadId!, { type: 'turn', turnId: run.turnId! }); await delay(10);
  const revision = h.readStates.get(run.threadId!)!.revision;
  await h.service.fetch('inbox-item-set-read-state', { id: run.id, isRead: true });
  assert.equal(h.fake.calls('thread/readState/update').at(-1)!.params.expectedRevision, revision);
  assert.equal(h.readStates.get(run.threadId!)!.firstUnread, null);
  await h.service.fetch('automation-run-archive', { id: run.id });
  assert.ok(h.fake.archived.has(run.threadId!)); assert.equal((await inbox()).items[0].status, 'ARCHIVED');
  await h.connection.request('thread/unarchive', { threadId: run.threadId }, { mutating: true }); await delay(10);
  assert.equal((await inbox()).items[0].status, 'PENDING_REVIEW');
  h.fake.archived.add(run.threadId!); await h.restart();
  assert.equal((await inbox()).items[0].status, 'ARCHIVED');
  assert.equal(h.fake.calls('turn/start').length, 1);
});

test('failed inbox writes do not claim success or retry a conflicting or uncertain mutation', async t => {
  const h = await fixture(t), run = await h.completed();
  h.fake.handlers.set('thread/readState/update', () => { throw new Error('read state revision conflict'); });
  await assert.rejects(h.service.fetch('inbox-item-set-read-state', { id: run.id, isRead: true }), /revision conflict/);
  assert.equal(h.fake.calls('thread/readState/update').length, 1); assert.equal((await h.history())[0].readAt, null);
  h.fake.handlers.set('thread/archive', () => NO_REPLY);
  await assert.rejects(h.service.fetch('automation-run-archive', { id: run.id }), /结果待确认/);
  assert.equal(h.fake.calls('thread/archive').length, 1); assert.equal((await h.history())[0].archived, false);
  h.fake.handlers.set('thread/list', () => { throw new Error('Archive query offline'); });
  await assert.rejects(h.service.fetch('inbox-items', {}), /Archive query offline/);
  assert.equal(h.fake.calls('turn/start').length, 1);
});

test('legacy affirmative inbox marks migrate once without replaying the scheduled prompt', async t => {
  const h = await fixture(t), run = await h.completed();
  const db = new DatabaseSync(join(h.dataDir, 'automations.sqlite'));
  db.prepare('UPDATE automation_runs SET status=?,data=? WHERE id=?').run('completed', JSON.stringify({ ...run,
    summary: 'Legacy summary', readAt: run.createdAt + 1, archived: true }), run.id); db.close();
  await h.restart();
  const inbox = await h.service.fetch('inbox-items', {}) as { items: { status: string; description: string; readAt: number | null }[] };
  assert.equal(inbox.items[0].status, 'ARCHIVED'); assert.equal(inbox.items[0].description, 'Backend result'); assert.ok(inbox.items[0].readAt);
  assert.equal(h.readStates.get(run.threadId!)!.firstUnread, null); assert.ok(h.fake.archived.has(run.threadId!));
  assert.equal(h.persisted(run.id).migration, undefined);
  await h.restart(); await h.service.fetch('inbox-items', {});
  assert.equal(h.fake.calls('thread/readState/update').length, 1); assert.equal(h.fake.calls('thread/archive').length, 1);
  assert.equal(h.fake.calls('turn/start').length, 1);
});

test('a failed legacy migration remains visible and is not automatically replayed', async t => {
  const h = await fixture(t), run = await h.completed(), update = h.fake.handlers.get('thread/readState/update')!;
  const db = new DatabaseSync(join(h.dataDir, 'automations.sqlite'));
  db.prepare('UPDATE automation_runs SET status=?,data=? WHERE id=?').run('completed', JSON.stringify({ ...run,
    readAt: run.createdAt + 1, archived: false }), run.id); db.close();
  h.fake.handlers.set('thread/readState/update', () => { throw new Error('read state revision conflict'); });
  await h.restart(); await h.service.fetch('inbox-items', {}); await h.service.fetch('inbox-items', {});
  assert.equal(h.fake.calls('thread/readState/update').length, 1); assert.match(h.service.status().diagnostic!, /同步失败/);
  assert.equal((await h.history())[0].readAt, null);
  h.fake.handlers.set('thread/readState/update', update);
  await h.service.fetch('inbox-item-set-read-state', { id: run.id, isRead: true });
  assert.equal(h.persisted(run.id).migration, undefined); assert.ok((await h.history())[0].readAt);
});

test('reviewing an earlier scheduled result preserves newer unread messages and per-turn intent', async t => {
  const h = await fixture(t), run = await h.completed(), thread = h.fake.threads.get(run.threadId!)!;
  thread.turns.push(fixtureTurn('later-turn', [agentItem('later-answer', 'Later response')]));
  h.mark(run.threadId!, { type: 'turn', turnId: run.turnId! }); await delay(10);
  await h.service.fetch('inbox-item-set-read-state', { id: run.id, isRead: true });
  assert.deepEqual(h.readStates.get(run.threadId!)!.firstUnread, { type: 'turn', turnId: run.turnId });
  assert.equal(h.fake.calls('thread/readState/update').length, 0);
  assert.ok((await h.history())[0].readAt); assert.equal(h.persisted(run.id).turnRead, true);
  await h.restart(); assert.ok((await h.history())[0].readAt);
  h.mark(run.threadId!, null); await delay(10); assert.equal(h.persisted(run.id).turnRead, undefined);
  h.mark(run.threadId!, { type: 'turn', turnId: 'later-turn' }); await delay(10);
  assert.ok((await h.history())[0].readAt);
  await h.service.fetch('inbox-item-set-read-state', { id: run.id, isRead: false });
  assert.equal((await h.history())[0].readAt, null); assert.equal(h.persisted(run.id).turnRead, false);
  h.mark(run.threadId!, null); await delay(10); assert.ok((await h.history())[0].readAt);
});

test('shutdown waits for an active backend projection before closing the run database', async t => {
  const h = await fixture(t), run = await h.completed();
  let entered!: () => void, release!: () => void;
  const reading = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  h.fake.handlers.set('thread/turns/list', async params => {
    entered(); await held; return h.fake.defaultResult('thread/turns/list', params);
  });
  const pending = h.history(); await reading;
  let closed = false;
  const closing = h.service.close().then(() => { closed = true; });
  await delay(10); assert.equal(closed, false);
  release(); assert.equal((await pending)[0].id, run.id); await closing;
  assert.doesNotThrow(() => h.service.observe('local', { method: 'thread/deleted', params: { threadId: run.threadId } }));
});

test('a delayed inbox projection preserves newer receipt and archive notifications', async t => {
  const h = await fixture(t), run = await h.completed();
  let entered!: () => void, release!: () => void, paused = false;
  const reading = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  h.fake.handlers.set('thread/turns/list', async params => {
    if (!paused) { paused = true; entered(); await held; }
    return h.fake.defaultResult('thread/turns/list', params);
  });
  const pending = h.service.fetch('inbox-items', {}); await reading;
  await h.service.fetch('inbox-item-set-read-state', { id: run.id, isRead: true });
  await h.service.fetch('automation-run-archive', { id: run.id });
  release();
  const value = await pending as { items: { readAt: number | null; status: string }[] };
  assert.ok(value.items[0].readAt); assert.equal(value.items[0].status, 'ARCHIVED');
});

test('marking an empty starting run read does not acknowledge its future backend messages', async t => {
  const h = await fixture(t), task = await h.create({ status: 'PAUSED' });
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  h.fake.handlers.set('thread/start', async params => { await held; return h.fake.defaultResult('thread/start', params); });
  const result = await h.service.fetch('automation-run-now', { id: task.id }) as { run: AutomationRun };
  await h.service.fetch('inbox-automation-runs-mark-all-read', {});
  release(); await h.settled();
  assert.equal(h.persisted(result.run.id).localInbox, undefined);
  assert.equal((await h.history())[0].readAt, null);
});

test('native workbench starts its own scheduler and refuses a second owner before replacing tools', async t => {
  const root = await mkdtemp('/tmp/yard-schedule-host-');
  const fake = await createFakeCodex(root), native = await nativeFixture(root);
  const options = { ...native, dataDir: join(root, 'data'), socketPath: fake.socketPath, codexHome: join(root, 'absent-desktop'), workspace: root, port: 0 };
  let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined;
  t.after(async () => { await app?.close(); await fake.close(); await rm(root, { recursive: true, force: true }); });
  app = await createNativeWorkbench(options);
  const status = await fetch(app.url + '/api/status').then(r => r.json()) as { clients: number; scheduler: { running: boolean } };
  assert.equal(status.clients, 0); assert.equal(status.scheduler.running, true);
  await assert.rejects(createNativeWorkbench(options), /已有 Yard/);
  assert.equal((await fetch(app.url + '/api/status')).status, 200);
});
