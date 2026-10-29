import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import type { Page } from 'playwright-core';
import { CodexConnection } from '../lib/codex.ts';
import { createConversationWrites } from '../src/native/conversation-writes.ts';
import { createSendInjection } from '../src/native/send-injection.ts';
import type { SendInjectionOriginal, SendInjectionReference, SendInjectionStatus } from '../src/native/send-injection.ts';
import { createStateMutations } from '../src/native/state-mutations.ts';
import { createFakeCodex, fixtureThread, fixtureTurn, NO_REPLY } from './fake-codex.ts';

async function createInjectionHost(t: TestContext, options: { holdInject?: boolean; unknownInjection?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'yard-mini-inject-'));
  const peer = await createFakeCodex(root);
  peer.threads.set('thread-a', fixtureThread('thread-a', root));
  peer.loaded.add('thread-a');
  peer.handlers.set('thread/inject_items', () => options.unknownInjection ? NO_REPLY : {});
  peer.handlers.set('turn/start', () => ({ turn: fixtureTurn('native-turn-1', [], 'inProgress') }));
  const connection = new CodexConnection(peer.socketPath, { timeout: 800 });
  await connection.connect();
  assert.ok(connection.socket);
  const socket = connection.socket;
  let section: unknown;
  let expected: { owner: SendInjectionReference['owner']; revision: string } | undefined;
  let enterInject!: () => void, releaseInject!: () => void, finishStatus!: () => void;
  const enteredInject = new Promise<void>(resolve => { enterInject = resolve; });
  const injectGate = new Promise<void>(resolve => { releaseInject = resolve; });
  const checkedStatus = new Promise<void>(resolve => { finishStatus = resolve; });
  const actions: { action: string; params: Record<string, unknown> }[] = [];
  const results: { action: string; status: SendInjectionStatus | null }[] = [];
  const service = createSendInjection({ mutations: createStateMutations(), assertStateAvailable() {}, readSection: () => section,
    async persistSection(value) { section = structuredClone(value); } });
  const write = createConversationWrites();
  const original: SendInjectionOriginal = { connection, socket, generation: 'daemon-A',
    source: { paths: { homeDirectory: root, codexHome: join(root, 'codex') }, sshTarget: null },
    assertOriginal(reference) {
      assert.ok(expected, 'the original composer owner and revision were captured');
      assert.equal(reference.hostId, 'local'); assert.equal(reference.threadId, 'thread-a');
      assert.equal(reference.connectionGeneration, 'daemon-A');
      assert.deepEqual(reference.owner, expected.owner); assert.equal(reference.revision, expected.revision);
    } };
  t.after(async () => { releaseInject(); connection.close(); await peer.close(); await rm(root, { recursive: true, force: true }); });
  return {
    peer, actions, results, enteredInject, releaseInject, checkedStatus,
    expect(value: { owner: SendInjectionReference['owner']; revision: string }) { expected = structuredClone(value); },
    async dispatch(params: Record<string, unknown>) {
      const action = String(params.action), reference = params.reference as SendInjectionReference;
      assert.equal(params.hostId, reference.hostId);
      actions.push({ action, params: structuredClone(params) });
      if (action === 'inject' && options.holdInject) { enterInject(); await injectGate; }
      try {
        let status: SendInjectionStatus | null;
        if (action === 'status') status = await service.status(reference);
        else {
          assert.equal(params.daemonConnectionGeneration, 'daemon-A');
          status = await write(reference.hostId, reference.threadId, () => action === 'inject'
            ? service.inject({ reference, items: params.items as Record<string, unknown>[], turnParams: params.turnParams as Record<string, unknown> }, original)
            : action === 'start' ? service.startTurn({ reference, turnAttemptId: String(params.turnAttemptId) }, original)
              : Promise.reject(new Error('Unexpected injection host action: ' + action)));
        }
        results.push({ action, status: structuredClone(status) });
        return status;
      } finally {
        if (action === 'status') finishStatus();
      }
    },
  };
}

async function eventually(page: Page, predicate: () => Promise<unknown>) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await page.evaluate(predicate)) return;
    await page.waitForTimeout(30);
  }
  throw new Error('Timed out waiting for the browser condition.');
}

test('the synthetic Mini host bridge uses the native injection service', async t => {
  const owner = { hostId: 'local', threadId: 'thread-a', draftId: 'draft-1' };
  const reference: SendInjectionReference = { hostId: 'local', threadId: 'thread-a', intentId: 'intent-1',
    injectionAttemptId: 'injection-1', callId: 'call-1', clientUserMessageId: 'message-1',
    owner, revision: 'revision-1', connectionGeneration: 'daemon-A' };
  const items = [{ type: 'function_call', call_id: reference.callId, name: 'untrusted_input', arguments: '{}' },
    { type: 'function_call_output', call_id: reference.callId, output: [{ type: 'input_text', text: 'synthetic context' }] }];
  const turnParams = { threadId: reference.threadId, clientUserMessageId: reference.clientUserMessageId,
    input: [{ type: 'text', text: 'synthetic prompt' }] };

  await t.test('rejects a different owner and serializes an accepted injection before the original turn', async t => {
    const host = await createInjectionHost(t);
    host.expect({ owner, revision: reference.revision });
    const inject = { action: 'inject', hostId: reference.hostId, daemonConnectionGeneration: 'daemon-A', reference, items, turnParams };
    await assert.rejects(host.dispatch({ ...inject, reference: { ...reference, owner: { ...owner, draftId: 'other' } } }),
      { code: 'ERR_ASSERTION' });
    assert.equal(host.peer.calls('thread/inject_items').length, 0);
    const injected = await host.dispatch(inject);
    assert.equal(injected?.injection.phase, 'injected'); assert.equal(injected?.turn.phase, 'waiting');
    const accepted = await host.dispatch({ action: 'start', hostId: reference.hostId, daemonConnectionGeneration: 'daemon-A',
      reference, turnAttemptId: 'turn-attempt-1' });
    assert.equal(accepted?.turn.phase, 'accepted'); assert.deepEqual(accepted?.reference, reference);
    assert.deepEqual(host.peer.messages.filter(value => ['thread/inject_items', 'turn/start'].includes(String(value.method)))
      .map(value => value.method), ['thread/inject_items', 'turn/start']);
  });

  await t.test('keeps an unanswered dispatched injection unknown when queried', async t => {
    const host = await createInjectionHost(t, { unknownInjection: true });
    host.expect({ owner, revision: reference.revision });
    const injected = await host.dispatch({ action: 'inject', hostId: reference.hostId, daemonConnectionGeneration: 'daemon-A',
      reference, items, turnParams });
    const status = await host.dispatch({ action: 'status', hostId: reference.hostId, reference });
    assert.equal(injected?.injection.phase, 'unknown'); assert.equal(status?.injection.phase, 'unknown');
    assert.equal(status?.turn.phase, 'waiting'); assert.deepEqual(status?.reference, reference);
    assert.equal(host.peer.calls('thread/inject_items').length, 1); assert.equal(host.peer.calls('turn/start').length, 0);
  });
});

test('Mini binds actual writes to the captured daemon socket identity', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 150_000,
}, async t => {
  const bundle = await build({ entryPoints: ['test/mini-workspace-fixture.tsx'], bundle: true, write: false,
    format: 'iife', loader: { '.css': 'empty' } });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--no-sandbox', '--disable-background-networking'] });
  async function create(home = false, injectionHost?: Awaited<ReturnType<typeof createInjectionHost>>) {
    const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
    if (injectionHost) await context.exposeFunction('miniInjectionHost', injectionHost.dispatch);
    const page = await context.newPage(); page.setDefaultTimeout(10_000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:32149'
      ? route.fulfill({ contentType: 'text/html', body: '<main id="root"></main>' }) : route.abort());
    await page.goto('http://127.0.0.1:32149/?socket=1' + (home ? '&home=1' : ''));
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.waitForFunction(() => !!(window as any).miniWorkspaceFixture?.ready());
    return { context, page, errors };
  }
  async function open(page: Page) {
    await page.getByRole('button', { name: 'Quick chat', exact: true }).click();
    await page.locator('.yard-mini-conversation textarea').first().waitFor();
    await page.waitForFunction(() => !(document.querySelector('[data-mini-composer-content]') as HTMLElement)?.inert);
  }
  async function wire(page: Page) { return page.evaluate(() => (window as any).miniWorkspaceFixture.wire); }
  try {
    await t.test('send, queue, steer, interrupt and queue start carry the original generation', async () => {
      const { context, page, errors } = await create();
      try {
        await open(page);
        const mini = page.locator('.yard-mini-conversation'), input = mini.locator('textarea').first();
        await input.fill('socket send'); await mini.locator('.standalone-composer__submit').click();
        await page.waitForFunction(() => (window as any).miniWorkspaceFixture.calls.some((x: any) => x.method === 'turn/start'));
        await page.waitForFunction(() => document.querySelector('.yard-mini-conversation .standalone-composer__submit')?.textContent?.includes('排队'));
        await input.fill('socket queue'); await mini.locator('.standalone-composer__submit').click();
        await page.waitForFunction(() => (window as any).miniWorkspaceFixture.calls.some((x: any) => x.method === 'thread/queue/add'));
        await eventually(page, async () => !Object.keys((await (window as any).miniWorkspaceFixture.records()).requests).length
          && (document.querySelector('.yard-mini-conversation textarea') as HTMLTextAreaElement)?.value === '');
        await input.fill('socket steer'); await mini.getByRole('button', { name: '发送到当前任务' }).click();
        await page.waitForFunction(() => (window as any).miniWorkspaceFixture.calls.some((x: any) => x.method === 'turn/steer'));
        await mini.getByRole('button', { name: '停止', exact: true }).click();
        await page.waitForFunction(() => (window as any).miniWorkspaceFixture.calls.some((x: any) => x.method === 'turn/interrupt'));
        await mini.getByRole('button', { name: '立即发送待发送消息' }).click();
        try { await page.waitForFunction(() => (window as any).miniWorkspaceFixture.calls.some((x: any) => x.method === 'thread/queue/start')); }
        catch (cause) {
          const diagnostic = await page.evaluate(() => ({ text: document.querySelector('.yard-mini-conversation')?.textContent,
            calls: (window as any).miniWorkspaceFixture.calls, hostCalls: (window as any).miniWorkspaceFixture.hostCalls }));
          throw new Error('Queue start failed: ' + JSON.stringify(diagnostic), { cause });
        }
        const methods = ['turn/start', 'thread/queue/add', 'turn/steer', 'turn/interrupt', 'thread/queue/start'];
        const writes = (await wire(page)).filter((x: any) => methods.includes(x.request?.method));
        assert.deepEqual(writes.map((x: any) => x.request.method), methods);
        for (const write of writes) {
          assert.equal(write.hostId, 'local'); assert.equal(write.daemonConnectionGeneration, 'daemon-A');
          assert.equal(Object.hasOwn(write.request.params, 'daemonConnectionGeneration'), false);
        }
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('created thread and its first turn use one original generation and retained binding', async () => {
      const { context, page, errors } = await create(true);
      try {
        await open(page);
        await page.locator('.yard-mini-conversation textarea').first().fill('created through original socket');
        await page.locator('.yard-mini-conversation .standalone-composer__submit').click();
        await page.waitForFunction(() => (window as any).miniWorkspaceFixture.calls.some((x: any) => x.method === 'turn/start'));
        const value = await page.evaluate(async () => ({ wire: (window as any).miniWorkspaceFixture.wire,
          pointer: JSON.parse((window as any).miniWorkspaceFixture.pointer()), state: await (window as any).miniWorkspaceFixture.records() }));
        const writes = value.wire.filter((x: any) => ['thread/start', 'turn/start'].includes(x.request?.method));
        assert.deepEqual(writes.map((x: any) => x.request.method), ['thread/start', 'turn/start']);
        assert.ok(writes.every((x: any) => x.daemonConnectionGeneration === 'daemon-A'));
        assert.equal(writes[1].request.params.threadId, 'created-1');
        assert.equal(value.state.bindings[JSON.stringify(['local', 'created-1'])], value.pointer.draftId);
        assert.equal(value.pointer.threadId, 'created-1'); assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('actual Mini app context injection and turn carry the same original generation', async t => {
      const host = await createInjectionHost(t, { holdInject: true });
      const { context, page, errors } = await create(false, host);
      try {
        await open(page);
        assert.equal(await page.evaluate(() => (window as any).miniWorkspaceFixture.attachAppInput()), true);
        await eventually(page, async () => {
          const f = (window as any).miniWorkspaceFixture, saved = await f.miniDraft(JSON.parse(f.pointer()));
          return saved?.draft.input?.[0]?.text?.includes('MCP app initiated');
        });
        const original = await page.evaluate(async () => {
          const f = (window as any).miniWorkspaceFixture;
          return f.miniDraft(JSON.parse(f.pointer()));
        });
        host.expect(original);
        await page.locator('.yard-mini-conversation .standalone-composer__submit').click();
        try { await page.waitForFunction(() => (window as any).miniWorkspaceFixture.hostCalls
          .some((x: any) => x.endpoint === 'send-injection' && x.params.action === 'inject')); }
        catch (cause) {
          const diagnostic = await page.evaluate(async () => {
            const fixture = (window as any).miniWorkspaceFixture;
            const state = await fixture.records();
            const draft = await fixture.miniDraft(JSON.parse(fixture.pointer()));
            return { alerts: Array.from(document.querySelectorAll('.yard-mini-conversation [role="alert"]'), node => node.textContent),
              methods: fixture.calls.map((call: any) => call.method), hostEndpoints: fixture.hostCalls.map((call: any) => call.endpoint),
              requests: Object.values(state.requests).map((request: any) => ({ stage: request.stage, injectionPhase: request.injection?.phase })),
              originalInputRetained: draft?.draft.input?.[0]?.text?.includes('MCP app initiated') === true };
          });
          throw new Error('Original app context did not reach its turn: ' + JSON.stringify(diagnostic), { cause });
        }
        await host.enteredInject;
        const inject = host.actions[0]!.params, reference = inject.reference as SendInjectionReference;
        const pending = (await page.evaluate(() => (window as any).miniWorkspaceFixture.records())).requests[reference.intentId];
        assert.ok(pending); assert.equal(pending.stage, 'sending');
        assert.equal(reference.intentId, pending.id); assert.ok(reference.injectionAttemptId);
        assert.deepEqual(reference.owner, original.owner); assert.equal(reference.revision, original.revision);
        assert.equal(reference.hostId, 'local'); assert.equal(reference.threadId, 'thread-a');
        assert.equal(reference.connectionGeneration, 'daemon-A');
        assert.equal(reference.callId, pending.injection.callId); assert.equal(reference.clientUserMessageId, pending.clientUserMessageId);
        assert.deepEqual(reference, pending.injection.native.reference);
        assert.deepEqual(pending.draft, original.draft);
        assert.deepEqual(inject.items, pending.injection.responseItems);
        assert.deepEqual((inject.turnParams as Record<string, unknown>).input, pending.injection.input);
        host.releaseInject();
        await page.waitForFunction(() => (window as any).miniWorkspaceFixture.hostCalls
          .some((x: any) => x.endpoint === 'send-injection' && x.params.action === 'start'));
        await host.peer.waitForCall('turn/start');
        await eventually(page, async () => {
          const current = (await (window as any).miniWorkspaceFixture.records()).requests[reference.intentId];
          return !current || current.stage === 'confirmed';
        });
        assert.deepEqual(host.actions.map(value => value.action), ['inject', 'start']);
        assert.deepEqual(host.actions[1]!.params.reference, reference);
        assert.equal(host.actions[1]!.params.daemonConnectionGeneration, 'daemon-A');
        assert.equal(host.actions[1]!.params.turnAttemptId, pending.attemptId);
        assert.deepEqual(host.results.map(value => [value.action, value.status?.injection.phase, value.status?.turn.phase]),
          [['inject', 'injected', 'waiting'], ['start', 'injected', 'accepted']]);
        assert.deepEqual(host.peer.calls('thread/inject_items').map(value => value.params),
          [{ threadId: 'thread-a', items: inject.items }]);
        assert.deepEqual(host.peer.calls('turn/start').map(value => value.params), [inject.turnParams]);
        assert.deepEqual(host.peer.messages.filter(value => ['thread/inject_items', 'turn/start'].includes(String(value.method)))
          .map(value => value.method), ['thread/inject_items', 'turn/start']);
        assert.equal((await wire(page)).filter((x: any) => ['thread/inject_items', 'turn/start'].includes(x.request?.method)).length, 0);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('app context keeps its original owner and rejects daemon ABA during recovery', async t => {
      const host = await createInjectionHost(t);
      const { context, page, errors } = await create(false, host);
      try {
        await open(page);
        assert.equal(await page.evaluate(() => (window as any).miniWorkspaceFixture.attachAppInput()), true);
        await eventually(page, async () => {
          const f = (window as any).miniWorkspaceFixture, saved = await f.miniDraft(JSON.parse(f.pointer()));
          return saved?.draft.input?.[0]?.text?.includes('MCP app initiated');
        });
        const original = await page.evaluate(async () => {
          const f = (window as any).miniWorkspaceFixture;
          return f.miniDraft(JSON.parse(f.pointer()));
        });
        host.expect(original);
        await page.evaluate(() => (window as any).miniWorkspaceFixture.holdSendRead());
        await page.locator('.yard-mini-conversation .standalone-composer__submit').click();
        await page.waitForFunction(() => (window as any).miniWorkspaceFixture.sendReadWaiting());
        await page.evaluate(() => { const f = (window as any).miniWorkspaceFixture;
          f.setDaemon('local', 'daemon-B'); f.setDaemon('local', 'daemon-A'); f.releaseSendRead(); });
        await page.locator('.yard-mini-conversation [role="alert"]').first().waitFor();
        assert.match(await page.locator('.yard-mini-conversation [role="alert"]').first().innerText(), /原连接或输入权限已改变/);
        assert.deepEqual(host.actions, []);
        assert.equal(host.peer.calls('thread/inject_items').length, 0); assert.equal(host.peer.calls('turn/start').length, 0);
        assert.equal((await wire(page)).filter((x: any) => ['thread/inject_items', 'turn/start'].includes(x.request?.method)).length, 0);
        assert.deepEqual(await page.evaluate((owner: any) => (window as any).miniWorkspaceFixture.miniDraft(owner), original.owner), original);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('an unknown dispatched app injection retains its original draft and status check does not replay', async t => {
      const host = await createInjectionHost(t, { unknownInjection: true });
      const { context, page, errors } = await create(false, host);
      try {
        await open(page);
        assert.equal(await page.evaluate(() => (window as any).miniWorkspaceFixture.attachAppInput()), true);
        await eventually(page, async () => {
          const f = (window as any).miniWorkspaceFixture, saved = await f.miniDraft(JSON.parse(f.pointer()));
          return saved?.draft.input?.[0]?.text?.includes('MCP app initiated');
        });
        const original = await page.evaluate(async () => {
          const f = (window as any).miniWorkspaceFixture;
          return f.miniDraft(JSON.parse(f.pointer()));
        });
        host.expect(original);
        await page.locator('.yard-mini-conversation .standalone-composer__submit').click();
        await eventually(page, async () => Object.values((await (window as any).miniWorkspaceFixture.records()).requests)
          .some((intent: any) => intent.stage === 'unknown' && intent.injection?.native?.status?.injection.phase === 'unknown'));
        const injection = host.actions.find(value => value.action === 'inject')!;
        const reference = injection.params.reference as SendInjectionReference;
        const before = (await page.evaluate(() => (window as any).miniWorkspaceFixture.records())).requests[reference.intentId];
        assert.equal(reference.intentId, before.id); assert.ok(reference.injectionAttemptId);
        assert.equal(reference.hostId, 'local'); assert.equal(reference.threadId, 'thread-a');
        assert.equal(reference.connectionGeneration, 'daemon-A');
        assert.deepEqual(reference.owner, original.owner); assert.equal(reference.revision, original.revision);
        assert.deepEqual(before.injection.native.reference, reference);
        assert.deepEqual(before.draft, original.draft);
        assert.deepEqual(await page.evaluate((owner: any) => (window as any).miniWorkspaceFixture.miniDraft(owner), original.owner), original);
        const notice = page.getByRole('region', { name: 'Message send recovery' });
        await notice.getByRole('button', { name: 'Check original host status' }).click();
        await page.waitForFunction(() => (window as any).miniWorkspaceFixture.hostCalls
          .some((x: any) => x.endpoint === 'send-injection' && x.params.action === 'status'));
        await host.checkedStatus;
        await page.waitForFunction(() => Array.from(document.querySelectorAll<HTMLButtonElement>('.yard-send-recovery button'))
          .some(button => button.textContent === 'Check original host status' && !button.disabled));
        assert.deepEqual(host.actions.map(value => value.action), ['inject', 'status']);
        assert.deepEqual(host.actions[1]!.params.reference, reference);
        assert.deepEqual(host.results.map(value => [value.action, value.status?.injection.phase, value.status?.turn.phase]),
          [['inject', 'unknown', 'waiting'], ['status', 'unknown', 'waiting']]);
        assert.equal(host.peer.calls('thread/inject_items').length, 1); assert.equal(host.peer.calls('turn/start').length, 0);
        assert.equal((await wire(page)).filter((x: any) => ['thread/inject_items', 'turn/start'].includes(x.request?.method)).length, 0);
        assert.equal(await notice.getByRole('button', { name: 'Retry original send' }).count(), 0);
        const after = (await page.evaluate(() => (window as any).miniWorkspaceFixture.records())).requests[reference.intentId];
        assert.equal(after.stage, 'unknown'); assert.deepEqual(after.injection.native.reference, reference);
        assert.deepEqual(await page.evaluate((owner: any) => (window as any).miniWorkspaceFixture.miniDraft(owner), original.owner), original);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('a created-thread receipt survives connection ABA without dispatching its first turn', async () => {
      const { context, page, errors } = await create(true);
      try {
        await open(page);
        await page.evaluate(() => (window as any).miniWorkspaceFixture.holdCreatedReply());
        const input = page.locator('.yard-mini-conversation textarea').first(); await input.fill('retain created draft');
        await page.locator('.yard-mini-conversation .standalone-composer__submit').click();
        await page.waitForFunction(() => (window as any).miniWorkspaceFixture.createdReplyWaiting());
        await page.evaluate(() => { const f = (window as any).miniWorkspaceFixture;
          f.setDaemon('local', 'daemon-B'); f.setDaemon('local', 'daemon-A'); f.releaseCreatedReply(); });
        await eventually(page, async () => Object.values((await (window as any).miniWorkspaceFixture.records()).requests)
          .some((intent: any) => intent.stage === 'failed' && intent.created?.thread.id === 'created-1'));
        const value = await page.evaluate(async () => ({ wire: (window as any).miniWorkspaceFixture.wire,
          pointer: JSON.parse((window as any).miniWorkspaceFixture.pointer()), state: await (window as any).miniWorkspaceFixture.records() }));
        assert.equal(value.wire.filter((x: any) => x.request?.method === 'thread/start').length, 1);
        assert.equal(value.wire.filter((x: any) => x.request?.method === 'turn/start').length, 0);
        assert.equal(value.state.bindings[JSON.stringify(['local', 'created-1'])], value.pointer.draftId);
        assert.equal(value.pointer.threadId, null); assert.equal(await input.inputValue(), 'retain created draft');
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('queued start waiting on its lock cannot revive after daemon ABA', async () => {
      const { context, page, errors } = await create();
      try {
        await open(page);
        const mini = page.locator('.yard-mini-conversation'), input = mini.locator('textarea').first();
        await input.fill('first turn'); await mini.locator('.standalone-composer__submit').click();
        await page.waitForFunction(() => document.querySelector('.yard-mini-conversation .standalone-composer__submit')?.textContent?.includes('排队'));
        await input.fill('queued during turn'); await mini.locator('.standalone-composer__submit').click();
        await page.waitForFunction(() => (window as any).miniWorkspaceFixture.calls.some((x: any) => x.method === 'thread/queue/add'));
        await eventually(page, async () => !Object.keys((await (window as any).miniWorkspaceFixture.records()).requests).length);
        await mini.getByRole('button', { name: '停止', exact: true }).click();
        await page.waitForFunction(() => (window as any).miniWorkspaceFixture.calls.some((x: any) => x.method === 'turn/interrupt'));
        await page.evaluate(() => (window as any).miniWorkspaceFixture.holdQueueLock());
        await mini.getByRole('button', { name: '立即发送待发送消息' }).click();
        await page.waitForFunction(() => (window as any).miniWorkspaceFixture.queueLockWaiting());
        await page.evaluate(() => { const f = (window as any).miniWorkspaceFixture;
          f.setDaemon('local', 'daemon-B'); f.setDaemon('local', 'daemon-A'); f.releaseQueueLock(); });
        await eventually(page, async () => {
          const f = (window as any).miniWorkspaceFixture, recovery = await f.queueRecovery();
          return f.hostCalls.some((x: any) => x.endpoint === 'queued-follow-up-send-lock-release' && x.params.sent === false)
            && !recovery.markers.length && !recovery.releases.length;
        });
        assert.equal((await wire(page)).filter((x: any) => x.request?.method === 'thread/queue/start').length, 0);
        assert.match(await mini.innerText(), /queued during turn/); assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('interrupt rechecks its original daemon immediately before socket send', async () => {
      const { context, page, errors } = await create();
      try {
        await open(page);
        const mini = page.locator('.yard-mini-conversation');
        await mini.locator('textarea').first().fill('running original turn');
        await mini.locator('.standalone-composer__submit').click();
        await mini.getByRole('button', { name: '停止', exact: true }).waitFor();
        await page.evaluate(() => (window as any).miniWorkspaceFixture.holdInterruptConnect());
        await mini.getByRole('button', { name: '停止', exact: true }).click();
        await page.waitForFunction(() => (window as any).miniWorkspaceFixture.interruptConnectWaiting());
        await page.evaluate(() => { const f = (window as any).miniWorkspaceFixture;
          f.setDaemon('local', 'daemon-B'); f.setDaemon('local', 'daemon-A'); f.releaseInterruptConnect(); });
        await mini.getByRole('alert').first().waitFor();
        assert.equal((await wire(page)).filter((x: any) => x.request?.method === 'turn/interrupt').length, 0);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('opening cannot adopt a different generation after its first wait', async () => {
      const { context, page, errors } = await create();
      try {
        await page.evaluate(() => (window as any).miniWorkspaceFixture.holdMain(true));
        await page.getByRole('button', { name: 'Quick chat', exact: true }).click();
        await page.waitForFunction(() => (window as any).miniWorkspaceFixture.mainWaiting());
        await page.evaluate(() => { const f = (window as any).miniWorkspaceFixture;
          f.setDaemon('local', 'daemon-B'); f.setDaemon('local', 'daemon-A'); f.releaseMain(); });
        await page.waitForFunction(() => (window as any).miniWorkspaceFixture.mainVisible());
        assert.equal(await page.locator('.yard-mini-conversation').count(), 0);
        assert.equal((await wire(page)).filter((x: any) => ['thread/start', 'turn/start'].includes(x.request?.method)).length, 0);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('a send waiting on real recovery cannot revive after daemon ABA', async () => {
      const { context, page, errors } = await create();
      try {
        await open(page);
        const input = page.locator('.yard-mini-conversation textarea').first(); await input.fill('keep after ABA');
        await eventually(page, async () => { const f = (window as any).miniWorkspaceFixture;
          return (await f.miniDraft(JSON.parse(f.pointer())))?.draft.text === 'keep after ABA'; });
        await page.evaluate(() => (window as any).miniWorkspaceFixture.holdSendRead());
        await page.locator('.yard-mini-conversation .standalone-composer__submit').click();
        await page.waitForFunction(() => (window as any).miniWorkspaceFixture.sendReadWaiting());
        await page.evaluate(() => { const f = (window as any).miniWorkspaceFixture;
          f.setDaemon('local', 'daemon-B'); f.setDaemon('local', 'daemon-A'); f.releaseSendRead(); });
        await page.locator('.yard-mini-conversation [role="alert"]').first().waitFor();
        assert.equal((await wire(page)).filter((x: any) => ['thread/start', 'turn/start', 'turn/steer', 'thread/queue/add'].includes(x.request?.method)).length, 0);
        assert.equal(await input.inputValue(), 'keep after ABA'); assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('a workspace switch cannot borrow a destination generation acquired after the click', async () => {
      const { context, page, errors } = await create(true);
      try {
        await open(page);
        const select = page.locator('.yard-mini-conversation select[aria-label="运行位置"]');
        await select.locator('option').filter({ hasText: 'Remote: /fixture/remote' }).waitFor({ state: 'attached' });
        await page.locator('.yard-mini-conversation .standalone-composer__target summary').click();
        await page.evaluate(() => (window as any).miniWorkspaceFixture.holdSendRead());
        await select.selectOption(JSON.stringify(['remote', '/fixture/remote']));
        await page.waitForFunction(() => (window as any).miniWorkspaceFixture.sendReadWaiting());
        await page.evaluate(() => { const f = (window as any).miniWorkspaceFixture;
          f.setDaemon('remote', 'daemon-new'); f.setDaemon('remote', 'daemon-remote'); f.releaseSendRead(); });
        await page.locator('.yard-mini-conversation [role="alert"]').first().waitFor();
        const pointer = await page.evaluate(() => JSON.parse((window as any).miniWorkspaceFixture.pointer()));
        assert.equal(pointer.hostId, 'local'); assert.equal(pointer.threadId, null); assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('a home workspace switch retains the previously captured destination authority', async () => {
      const { context, page, errors } = await create(true);
      try {
        await open(page);
        const select = page.locator('.yard-mini-conversation select[aria-label="运行位置"]');
        await select.locator('option').filter({ hasText: 'Remote: /fixture/remote' }).waitFor({ state: 'attached' });
        await page.locator('.yard-mini-conversation .standalone-composer__target summary').click();
        await select.selectOption(JSON.stringify(['remote', '/fixture/remote']));
        await page.waitForFunction(() => JSON.parse((window as any).miniWorkspaceFixture.pointer()).hostId === 'remote');
        const input = page.locator('.yard-mini-conversation textarea').first();
        await input.fill('remote original connection');
        await page.locator('.yard-mini-conversation .standalone-composer__submit').click();
        await page.waitForFunction(() => (window as any).miniWorkspaceFixture.calls.some((x: any) => x.method === 'turn/start' && x.hostId === 'remote'));
        const writes = (await wire(page)).filter((x: any) => ['thread/start', 'turn/start'].includes(x.request?.method));
        assert.deepEqual(writes.map((x: any) => x.request.method), ['thread/start', 'turn/start']);
        assert.ok(writes.every((x: any) => x.hostId === 'remote' && x.daemonConnectionGeneration === 'daemon-remote'));
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('message edit sends the captured generation in the real host body', async () => {
      const { context, page, errors } = await create();
      try {
        await open(page);
        const item = page.locator('.yard-mini-conversation [data-message-id="original-item"]');
        await item.getByRole('button', { name: 'Edit message' }).click();
        await item.getByRole('textbox', { name: 'Edit message text' }).fill('edited through original socket');
        await eventually(page, async () => (await (window as any).miniWorkspaceFixture.edit())?.recovery?.editor?.edits?.[0]?.text === 'edited through original socket');
        await item.getByRole('button', { name: 'Send', exact: true }).click();
        await page.waitForFunction(() => (window as any).miniWorkspaceFixture.hostCalls.some((x: any) => x.endpoint === 'message-edit'));
        const request = (await wire(page)).find((x: any) => x.type === 'fetch' && x.url.endsWith('/message-edit'));
        assert.equal(JSON.parse(request.body).daemonConnectionGeneration, 'daemon-A');
        assert.equal(Object.hasOwn(request, 'daemonConnectionGeneration'), false);
        assert.equal(JSON.parse(request.body).origin.itemId, 'original-item'); assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('message edit waits with its original generation and cannot write after ABA', async () => {
      const { context, page, errors } = await create();
      try {
        await open(page);
        const item = page.locator('.yard-mini-conversation [data-message-id="original-item"]');
        await item.getByRole('button', { name: 'Edit message' }).click();
        const input = item.getByRole('textbox', { name: 'Edit message text' }); await input.fill('retained edited text');
        await eventually(page, async () => (await (window as any).miniWorkspaceFixture.edit())?.recovery?.editor?.edits?.[0]?.text === 'retained edited text');
        await page.evaluate(() => (window as any).miniWorkspaceFixture.holdEditSubmit());
        await item.getByRole('button', { name: 'Send', exact: true }).click();
        await page.waitForFunction(() => (window as any).miniWorkspaceFixture.editSubmitWaiting());
        await page.evaluate(() => { const f = (window as any).miniWorkspaceFixture;
          f.setDaemon('local', 'daemon-B'); f.setDaemon('local', 'daemon-A'); f.releaseEditSubmit(); });
        await page.locator('.yard-mini-conversation [role="alert"]').first().waitFor();
        assert.equal((await wire(page)).filter((x: any) => x.type === 'fetch' && x.url.endsWith('/message-edit')).length, 0);
        assert.equal((await page.evaluate(() => (window as any).miniWorkspaceFixture.edit())).recovery.editor.edits[0].text, 'retained edited text');
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test('only the exact locally received injection receipt exposes persistence retry', async () => {
      for (const confirmed of [false, true]) {
        const { context, page, errors } = await create();
        try {
          await open(page);
          await page.evaluate((value: boolean) => (window as any).miniWorkspaceFixture.seedInjectionReceipt(value), confirmed);
          const notice = page.getByRole('region', { name: 'Message send recovery' }); await notice.waitFor();
          const button = notice.getByRole('button', { name: 'Save confirmed context receipt' });
          assert.equal(await button.count(), confirmed ? 1 : 0);
          if (confirmed) {
            await button.click();
            await eventually(page, async () => Object.values((await (window as any).miniWorkspaceFixture.records()).requests)
              .some((intent: any) => intent.injection?.phase === 'confirmed'));
            assert.equal((await wire(page)).filter((x: any) => x.request?.method === 'thread/inject_items').length, 1);
            assert.equal((await wire(page)).filter((x: any) => x.request?.method === 'turn/start').length, 0);
          }
          assert.deepEqual(errors, []);
        } finally { await context.close(); }
      }
    });
  } finally { await browser.close(); }
});
