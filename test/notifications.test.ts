import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import { CodexConnection } from '../lib/codex.ts';
import { createBrowserNotifications, defaultNotificationPreferences, notificationRoute } from '../src/native/notifications.ts';
import type { BrowserNotification } from '../src/native/notifications.ts';
import { createNativeWorkbench } from '../src/native/server.ts';
import { agentItem, createFakeCodex, fixtureThread, fixtureTurn } from './fake-codex.ts';
import { nativeFixture } from './native-fixture.ts';

const require = createRequire(import.meta.url);
const ece = require(require.resolve('http_ece', { paths: [dirname(require.resolve('web-push'))] })) as {
  decrypt(body: Buffer, options: object): Buffer;
};
function receiver(name = 'fixture') {
  const key = createECDH('prime256v1'); key.generateKeys();
  const auth = randomBytes(16);
  const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/' + name,
    keys: { p256dh: key.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };
  const payloads: BrowserNotification[] = [], requests: RequestInit[] = [];
  const transport: typeof fetch = async (_url, init) => {
    requests.push(init!);
    payloads.push(JSON.parse(ece.decrypt(Buffer.from(init!.body as Uint8Array), { version: 'aes128gcm', privateKey: key, authSecret: auth }).toString()));
    return new Response(null, { status: 201 });
  };
  return { subscription, payloads, requests, transport };
}
async function fixture(t: import('node:test').TestContext) {
  const root = await mkdtemp('/tmp/yard-push-'), dataDir = join(root, 'data'); await mkdir(dataDir);
  const fake = await createFakeCodex(root), connection = new CodexConnection(fake.socketPath); await connection.connect();
  const device = receiver();
  const options = { dataDir, hostIds: () => [], connectionFor: async () => connection, fetch: device.transport, intervalMs: 60000 };
  let notifications = await createBrowserNotifications(options);
  t.after(async () => { await notifications.close(); connection.close(); await fake.close(); await rm(root, { recursive: true, force: true }); });
  return { root, dataDir, fake, connection, device, get service() { return notifications; },
    async subscribe(preferences = defaultNotificationPreferences) { await notifications.request({ operation: 'subscribe', subscription: device.subscription, preferences }); },
    async restart() { await notifications.close(); notifications = await createBrowserNotifications(options); },
  };
}

test('browser subscriptions generate persistent private VAPID keys and send an encrypted, signed Web Push request', async t => {
  const h = await fixture(t);
  await h.subscribe();
  const before = await h.service.request({ operation: 'status', endpoint: h.device.subscription.endpoint });
  assert.equal(before.subscribed, true); assert.equal(typeof before.publicKey, 'string'); assert.ok(!('keys' in before));
  await h.service.request({ operation: 'test', endpoint: h.device.subscription.endpoint });
  assert.equal(h.device.payloads[0].title, 'Yard · 测试通知');
  const headers = new Headers(h.device.requests[0].headers);
  assert.equal(headers.get('content-encoding'), 'aes128gcm');
  assert.match(headers.get('authorization')!, /^vapid t=.+, k=.+/);
  assert.equal(h.device.requests[0].redirect, 'error');
  assert.equal((await stat(join(h.dataDir, 'browser-notifications.json'))).mode & 0o777, 0o600);
  await h.restart();
  const after = await h.service.request({ operation: 'status', endpoint: h.device.subscription.endpoint });
  assert.equal(after.publicKey, before.publicKey); assert.equal(after.subscribed, true);
  for (const endpoint of ['http://fcm.googleapis.com/send/x', 'https://127.0.0.1/private', 'https://fcm.googleapis.com.evil.example/x', 'https://fcm.googleapis.com:444/x']) {
    await assert.rejects(h.service.request({ operation: 'subscribe', subscription: { ...h.device.subscription, endpoint }, preferences: defaultNotificationPreferences }));
  }
  await assert.rejects(h.service.request({ operation: 'subscribe', subscription: { ...h.device.subscription, keys: { ...h.device.subscription.keys, auth: 'bad' } }, preferences: defaultNotificationPreferences }));
});

test('server observation survives restart and a completed turn generates one push despite replayed events and multiple pages', async t => {
  const h = await fixture(t); await h.subscribe();
  const thread = fixtureThread('thread', h.root, { name: 'Synthetic task', status: { type: 'active', activeFlags: [] }, turns: [fixtureTurn('turn', [], 'inProgress')] });
  h.fake.threads.set(thread.id, thread); h.service.watch('local', thread.id, 'turn');
  await h.restart();
  thread.status = { type: 'idle' }; thread.turns[0].status = 'completed';
  await Promise.all([h.service.tick(), h.service.tick()]);
  assert.equal(h.device.payloads.length, 1);
  assert.equal(h.device.payloads[0].url, notificationRoute('local', thread.id));
  assert.equal(h.device.payloads[0].body, 'Synthetic task');
  const duplicate = { method: 'turn/completed', params: { threadId: thread.id, turn: thread.turns[0] } };
  h.service.observe('local', duplicate); h.service.observe('local', duplicate);
  await h.restart(); h.service.observe('local', duplicate); await h.service.close();
  assert.equal(h.device.payloads.length, 1);
  assert.equal(h.fake.calls('thread/resume').length, 0);
});

test('background approvals, device preferences, failed turns and interrupted turns keep their own semantics', async t => {
  const h = await fixture(t); await h.subscribe({ completed: false, failed: true, waiting: true });
  const thread = fixtureThread('remote-task', h.root, { status: { type: 'active', activeFlags: ['waitingOnApproval'] }, turns: [fixtureTurn('turn', [], 'inProgress')] });
  h.fake.threads.set(thread.id, thread); h.service.watch('remote-ssh-codex-managed:fixture', thread.id, 'turn');
  await h.service.tick(); await h.service.tick();
  assert.deepEqual(h.device.payloads.map(payload => payload.kind), ['waiting']);
  assert.equal(new Headers(h.device.requests[0].headers).get('urgency'), 'high');
  thread.status.activeFlags = []; await h.service.tick();
  thread.status.activeFlags = ['waitingOnUserInput']; await h.service.tick();
  assert.deepEqual(h.device.payloads.map(payload => payload.kind), ['waiting', 'waiting']);
  thread.status = { type: 'idle' }; thread.turns[0].status = 'failed';
  await h.service.tick();
  assert.deepEqual(h.device.payloads.map(payload => payload.kind), ['waiting', 'waiting', 'failed']);
  thread.turns = [fixtureTurn('second', [], 'completed')]; h.service.watch('local', thread.id, 'second'); await h.service.tick();
  thread.turns = [fixtureTurn('stopped', [], 'interrupted')]; h.service.watch('local', thread.id, 'stopped'); await h.service.tick();
  assert.equal(h.device.payloads.length, 3);
});

test('async question items notify once per question without blocking flags, including replay and another question in the same turn', async t => {
  const h = await fixture(t); await h.subscribe();
  const question = { ...agentItem('question-1', 'Private question text'), delivery: 'async', questions: [{ title: 'Private question text' }] };
  const thread = fixtureThread('async-task', h.root, { status: { type: 'active', activeFlags: [] }, turns: [fixtureTurn('turn', [question], 'inProgress')] });
  h.fake.threads.set(thread.id, thread);
  const event = { method: 'item/completed', params: { threadId: thread.id, turnId: 'turn', item: question } };
  h.service.observe('local', { ...event, method: 'item/started' });
  h.service.observe('local', event); h.service.observe('local', event);
  await h.restart();
  h.service.observe('local', event); await h.service.tick();
  assert.equal(h.device.payloads.length, 1);
  assert.equal(h.device.payloads[0].kind, 'waiting');
  assert.equal(h.device.payloads[0].url, notificationRoute('local', thread.id));
  assert.ok(!JSON.stringify(h.device.payloads).includes('Private question text'));
  const next = { ...question, id: 'question-2' };
  h.service.observe('local', { ...event, params: { ...event.params, item: next } });
  h.service.observe('local', { ...event, params: { ...event.params, item: { ...next, id: 'ordinary-message', questions: null } } });
  await h.service.close();
  assert.deepEqual(h.device.payloads.map(payload => payload.kind), ['waiting', 'waiting']);
  assert.notEqual(h.device.payloads[0].id, h.device.payloads[1].id);
});

test('async questions are reconciled after pages close, with incremental history and queued turns', async t => {
  const h = await fixture(t); await h.subscribe();
  const question = (id: string) => ({ ...agentItem(id, 'Question'), delivery: 'async', questions: [{ title: 'Question' }] });
  const thread = fixtureThread('background-input', h.root, { status: { type: 'active', activeFlags: [] },
    turns: [fixtureTurn('old', [question('old-question')]), fixtureTurn('turn', Array.from({ length: 150 }, (_, i) => agentItem('working-' + i, 'Working')), 'inProgress')] });
  h.fake.threads.set(thread.id, thread); h.service.watch('local', thread.id, 'turn');
  await h.service.tick();
  assert.equal(h.device.payloads.length, 0);
  thread.turns[1].items.push(question('background-question'));
  await h.service.tick(); await h.service.tick();
  assert.equal(h.device.payloads.length, 1);
  assert.deepEqual(h.fake.calls('thread/items/list').at(-1)?.params.cursor, { type: 'item', itemId: 'background-question' });
  await h.restart(); await h.service.tick(); assert.equal(h.device.payloads.length, 1);
  thread.turns[1].status = 'completed';
  thread.turns.push(fixtureTurn('queued-turn', [question('queued-question')], 'inProgress'));
  await h.service.tick(); assert.equal(h.device.payloads.length, 2);
  thread.turns[2].items.push(question('last-question')); thread.turns[2].status = 'completed'; thread.status = { type: 'idle' };
  await h.service.tick();
  assert.deepEqual(h.device.payloads.filter(payload => payload.kind === 'waiting').map(payload => JSON.parse(payload.id)[3]),
    ['input:background-question', 'input:queued-question', 'input:last-question']);
  assert.equal(h.fake.calls('thread/resume').length, 0);
});

test('disabling waiting reminders also filters async questions', async t => {
  const h = await fixture(t); await h.subscribe({ completed: true, failed: true, waiting: false });
  h.service.observe('local', { method: 'item/completed', params: { threadId: 'thread', turnId: 'turn',
    item: { ...agentItem('question', 'Question'), delivery: 'async', questions: [{ title: 'Question' }] } } });
  await h.service.close(); assert.equal(h.device.payloads.length, 0);
});

test('history recovery skips answered async cards and still reminds about a partially answered card', async t => {
  const h = await fixture(t); await h.subscribe({ completed: false, failed: false, waiting: true });
  const question = { ...agentItem('answered-card', 'Question'), delivery: 'async', questions: [{ title: 'Question' }] };
  const partial = { ...question, id: 'partial-card', questions: [{ title: 'One' }, { title: 'Two' }] };
  const reply = { id: 'answer', type: 'userMessage', content: [{ type: 'text', text: '<send_user_message_question_reply>\n' + JSON.stringify([
    { questionItemId: JSON.stringify(['request_user_input_async', question.id, 0]), answer: 'Done' },
    { questionItemId: JSON.stringify(['request_user_input_async', partial.id, 0]), answer: 'One' },
  ]) + '\n</send_user_message_question_reply>' }] };
  // The reply is on a later page than the questions.
  const thread = fixtureThread('answered-input', h.root, { status: { type: 'active', activeFlags: [] }, turns: [fixtureTurn('turn',
    [question, partial, ...Array.from({ length: 110 }, (_, i) => agentItem('work-' + i, 'Working')), reply], 'inProgress')] });
  h.fake.threads.set(thread.id, thread); h.service.watch('local', thread.id, 'turn');
  await h.service.tick();
  assert.equal(h.device.payloads.length, 1); assert.match(h.device.payloads[0].id, /partial-card/);
  thread.status = { type: 'idle' }; thread.turns[0].status = 'completed';
  await h.service.tick(); assert.equal(h.device.payloads.length, 1);
});

test('queued turns completed while pages are closed are delivered in order and old history is not replayed', async t => {
  const h = await fixture(t); await h.subscribe();
  const thread = fixtureThread('queued-task', h.root, { turns: [fixtureTurn('old'), fixtureTurn('first'), fixtureTurn('second')] });
  h.fake.threads.set(thread.id, thread); h.service.watch('local', thread.id, 'first'); await h.service.tick();
  assert.equal(h.device.payloads.length, 2); assert.match(h.device.payloads[0].id, /first/); assert.match(h.device.payloads[1].id, /second/);
  await h.service.tick(); assert.equal(h.device.payloads.length, 2);
});

test('permanent push failures remove expired subscriptions and transient failures stay visible without exposing endpoints', async t => {
  const root = await mkdtemp('/tmp/yard-push-expired-');
  const device = receiver(); let status = 503;
  const service = await createBrowserNotifications({ dataDir: root, hostIds: () => [], connectionFor: async () => { throw new Error('Unused'); }, fetch: async () => new Response(null, { status }) });
  t.after(async () => { await service.close(); await rm(root, { recursive: true, force: true }); });
  await service.request({ operation: 'subscribe', subscription: device.subscription, preferences: defaultNotificationPreferences });
  await assert.rejects(service.request({ operation: 'test', endpoint: device.subscription.endpoint }), /503/);
  const info = await service.request({ operation: 'status', endpoint: device.subscription.endpoint });
  assert.equal(info.subscribed, true); assert.match(info.lastError!, /503/); assert.ok(!JSON.stringify(info).includes('fcm.googleapis.com'));
  status = 410;
  await assert.rejects(service.request({ operation: 'test', endpoint: device.subscription.endpoint }), /失效/);
  assert.equal((await service.request({ operation: 'status', endpoint: device.subscription.endpoint })).subscribed, false);
});

test('shutdown waits for a scheduled notification already being delivered', async t => {
  const root = await mkdtemp('/tmp/yard-push-close-'), device = receiver();
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  const service = await createBrowserNotifications({ dataDir: root, hostIds: () => [], connectionFor: async () => { throw new Error('Unused'); },
    fetch: async (...args) => { entered(); await pending; return device.transport(...args); } });
  t.after(async () => { release(); await service.close(); await rm(root, { recursive: true, force: true }); });
  await service.request({ operation: 'subscribe', subscription: device.subscription, preferences: defaultNotificationPreferences });
  const sent = service.publish({ id: 'scheduled-failure', kind: 'failed', title: 'Yard · 定时任务启动失败', body: 'Fixture', url: '/' });
  await started;
  let closed = false; const closing = service.close().then(() => { closed = true; });
  await delay(10); assert.equal(closed, false);
  release(); await Promise.all([sent, closing]); assert.equal(device.payloads.length, 1);
});

test('native host tracks a browser-started turn after the last page closes and sends scheduled-task results with no page', async t => {
  const root = await mkdtemp('/tmp/yard-push-host-'), fake = await createFakeCodex(root), device = receiver();
  const { renderer, adapterPath } = await nativeFixture(root);
  const app = await createNativeWorkbench({ dataDir: join(root, 'data'), workspace: root, socketPath: fake.socketPath, codexHome: join(root, 'codex'),
    port: 0, renderer, adapterPath, hostCatalog: { hosts: [], projects: [], assignments: {} }, notificationFetch: device.transport, notificationIntervalMs: 60000 });
  t.after(async () => { await app.close(); await fake.close(); await rm(root, { recursive: true, force: true }); });
  const api = (body: unknown, origin = app.url) => fetch(app.url + '/api/notifications', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await api({ operation: 'subscribe', subscription: device.subscription, preferences: defaultNotificationPreferences }, 'https://evil.example')).status, 403);
  assert.equal((await api({ operation: 'subscribe', subscription: device.subscription, preferences: defaultNotificationPreferences })).status, 200);
  const worker = await fetch(app.url + '/notification-worker.js'); assert.equal(worker.status, 200); assert.equal(worker.headers.get('service-worker-allowed'), '/');
  assert.match(await worker.text(), /notificationclick/);
  const page = new WebSocket(app.url.replace('http', 'ws') + '/native-host', { origin: app.url }); await once(page, 'open');
  const thread = fixtureThread('page-task', root); fake.threads.set(thread.id, thread);
  const reply = once(page, 'message');
  page.send(JSON.stringify({ type: 'mcp-request', request: { id: 1, method: 'turn/start', params: { threadId: thread.id, input: [] } } }));
  await fake.waitFor(message => message.method === 'turn/start');
  while (app.notifications.status().watching === 0) await delay(10);
  await reply; page.close(); await once(page, 'close');
  thread.turns[0].status = 'completed'; thread.status = { type: 'idle' }; await app.notifications.tick();
  assert.equal(device.payloads.length, 1);
  const created = await app.automations.fetch('automation-create', { name: 'Background fixture', prompt: 'Synthetic task', target: { type: 'projectless' },
    rrule: 'FREQ=DAILY;BYHOUR=23;BYMINUTE=30', timeZone: 'Asia/Shanghai', status: 'PAUSED' }) as { item: { id: string } };
  await app.automations.fetch('automation-run-now', { id: created.item.id });
  await fake.waitFor(message => message.method === 'turn/start' && message.params.threadId !== thread.id);
  while (app.notifications.status().watching === 0) await delay(10);
  const scheduled = [...fake.threads.values()].find(value => value.id !== thread.id)!;
  scheduled.turns[0].status = 'completed'; scheduled.status = { type: 'idle' };
  await app.notifications.tick();
  assert.equal(device.payloads.length, 2); assert.equal(device.payloads[1].body, 'Background fixture');
  const data = JSON.parse(await readFile(join(root, 'data', 'browser-notifications.json'), 'utf8'));
  assert.equal(data.devices.length, 1);
});
