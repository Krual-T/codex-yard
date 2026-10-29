import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import WebSocket, { WebSocketServer } from 'ws';
import { CodexConnection } from '../lib/codex.ts';
import { createNativeSideChatParent } from '../src/native/side-chat-native-parent.ts';
import { createSideChatNativeBrowserAuthority } from '../src/native/side-chat-browser-authority.ts';
import { SideChatParentReceipts } from '../src/native/side-chat-parent-receipts.ts';
import { createStateMutations } from '../src/native/state-mutations.ts';
import { createFakeCodex, fixtureThread, NO_REPLY } from './fake-codex.ts';
import type {} from './renderer-side-chat-workspace-fixture.tsx';
import type {} from './renderer-side-chat-root-fixture.tsx';

type Message = Record<string, any>;
async function peer() {
  const root = await mkdtemp('/tmp/hscw-'), fake = await createFakeCodex(root), mutations = createStateMutations();
  const parentThread = fixtureThread('parent-a', root);
  fake.threads.set('parent-a', parentThread); fake.loaded.add('parent-a');
  const response = (child: string | null = null) => ({ thread: child ? { ...parentThread, id: child, ephemeral: true, forkedFromId: 'parent-a', turns: [] } : parentThread,
    cwd: root, runtimeWorkspaceRoots: [root], model: 'peer-model', modelProvider: 'peer', reasoningEffort: null, serviceTier: null,
    approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: { type: 'readOnly', networkAccess: false }, activePermissionProfile: null });
  fake.handlers.set('thread/start', () => response());
  fake.handlers.set('config/read', () => ({ config: { developer_instructions: null } }));
  let holdFork = false, lateFork: (() => void) | null = null, holdChild = false, deliverChild: (() => void) | null = null, forks = 0;
  let failRevoke = false, lostPersistence = 0, lostPrepare = 0, readPrepared = 0, generation = 'generation-a', section: any, terminalStarts = 0;
  let holdPrepare = false, deliverPrepare: (() => void) | null = null;
  let holdChallenge = false, deliverChallenge: (() => void) | null = null;
  let holdApproval = false, deliverApproval: (() => void) | null = null;
  const queue = [
    { id: 'queue-a', clientUserMessageId: 'client-a', input: [{ type: 'text', text: 'synthetic queue A', text_elements: [] }] },
    { id: 'queue-b', clientUserMessageId: 'client-b', input: [{ type: 'text', text: 'synthetic queue B', text_elements: [] }] },
  ];
  const approvalReplies: Message[] = [];
  const order: string[] = [], reads: { purpose: string; token: unknown }[] = [], dispatches: Message[] = [], nativeWrites: Message[] = [];
  let injectionStatus: Message | null = null;
  fake.handlers.set('thread/fork', (_params, context) => {
    order.push('fork');
    const child = ++forks === 1 ? 'child-a' : 'child-' + forks;
    fake.threads.set(child, { ...parentThread, id: child, sessionId: child, ephemeral: true, forkedFromId: 'parent-a', turns: [] });
    fake.loaded.add(child);
    if (holdFork) { lateFork = () => context.send({ id: context.message.id, result: response(child) }); return NO_REPLY; }
    return response(child);
  });
  fake.handlers.set('thread/inject_items', () => { order.push('inject'); return {}; });
  const server = createServer((_request, reply) => {
    reply.writeHead(200, { 'content-type': 'text/html' });
    reply.end(`<main id="root"></main><script>window.fixtureCwd=${JSON.stringify(root)}</script>`);
  });
  const sockets = new WebSocketServer({ server, path: '/native-host' });
  const connections = new Map<WebSocket, Map<string, CodexConnection>>(), receipts = new SideChatParentReceipts();
  const socketGenerations = new WeakMap<WebSocket, string>();
  let parent: ReturnType<typeof createNativeSideChatParent>;
  const authority = createSideChatNativeBrowserAuthority({ requestTimeoutMs: 1_000,
    assertOrigin: scope => parent.assertBrowserOrigin(scope),
    notify(page, request) {
      if (request.kind === 'child') {
        const op = section?.operations?.[request.identity.operationId];
        assert.equal(op?.fork?.status, 'received'); assert.equal(op?.inject?.status, 'inflight');
        assert.equal(fake.calls('thread/inject_items').filter(call => call.params.threadId === request.identity.childThreadId).length, 0);
        order.push('child');
      }
      const send = () => { page.send(JSON.stringify(request)); };
      if (request.kind === 'child' && holdChild) deliverChild = send; else send();
    },
  });
  parent = createNativeSideChatParent({ mutations, assertStateAvailable() {}, readSection: () => section,
    async persistSection(next) { section = structuredClone(next); }, globals: {}, compatibility: () => ({}), receipts,
    connections: page => connections.get(page), generation: socket => socketGenerations.get(socket) ?? '',
    validateHost(host) { if (host !== 'local') throw Error('Unknown fixture host.'); }, forkConfig: () => undefined, authority,
    notify(hint, except) { for (const page of sockets.clients) if (!except.has(page) && page.readyState === WebSocket.OPEN)
      page.send(JSON.stringify({ type: 'side-chat-updated', ...hint })); },
    notifyPage(page, hint) { page.send(JSON.stringify({ type: 'side-chat-updated', ...hint })); },
  });
  sockets.on('connection', page => {
    const connection = new CodexConnection(fake.socketPath, { timeout: 180 });
    connections.set(page, new Map([['local', connection]]));
    connection.on('message', message => {
      if (typeof message.method === 'string' && page.readyState === WebSocket.OPEN) page.send(JSON.stringify({ type: 'mcp-notification',
        hostId: 'local', seq: connection.eventCursor, method: message.method, params: message.params }));
    });
    const ready = connection.connect().then(() => {
      socketGenerations.set(connection.socket!, generation);
      if (page.readyState === WebSocket.OPEN) page.send(JSON.stringify({ type: 'codex-app-server-connection-changed', hostId: 'local', state: 'connected',
        daemonConnectionGeneration: generation }));
    });
    page.on('close', () => { authority.invalidate(page); parent.forgetPage(page); receipts.forgetPage(page); connections.delete(page); connection.close(); });
    page.on('message', raw => { void (async () => {
      const message: Message = JSON.parse(String(raw));
      if (message.type === 'ready') { await ready; return; }
      if (message.type === 'mcp-response') {
        approvalReplies.push(message);
        const send = () => { if (page.readyState === WebSocket.OPEN) page.send(JSON.stringify({ type: 'server-request-response', requestId: message.requestId })); };
        if (holdApproval) deliverApproval = send; else send();
        return;
      }
      if (message.type === 'mcp-request') {
        await ready;
        dispatches.push(structuredClone(message));
        const request = message.request, source = { page, hostId: 'local', connection, socket: connection.socket!, connectionGeneration: generation,
          isCurrent: () => page.readyState === WebSocket.OPEN && connection.connected && socketGenerations.get(connection.socket!) === generation };
        const attempt = request.method === 'thread/start' ? receipts.begin(source, 'thread/start', null) : null;
        try {
          const result = await connection.requestWithCursor(request.method, request.params);
          if (attempt) receipts.receive(attempt, result.result, result.eventCursor);
          page.send(JSON.stringify({ type: 'mcp-response', hostId: 'local', message: { id: request.id, result: result.result } }));
        } catch (error) {
          if (attempt) receipts.cancel(attempt);
          page.send(JSON.stringify({ type: 'mcp-response', hostId: 'local', message: { id: request.id, error: { code: -1, message: String(error) } } }));
        }
        return;
      }
      if (message.type !== 'fetch') return;
      const body = JSON.parse(message.body), endpoint = String(message.url).split('/').at(-1);
      try {
        let result: unknown;
        if (endpoint === 'side-chat-browser-authority') {
          if (body.action === 'revoke' && failRevoke) throw Object.assign(new Error('Synthetic revoke reply lost.'), { uncertain: true });
          result = authority.handle(page, body);
          if (body.action === 'respond' && body.outcome === 'ready') order.push('respond');
        } else if (endpoint === 'side-chat') {
          if (body.action === 'close') order.push('close');
          result = await parent.handle(page, body);
          if (body.action === 'start') terminalStarts++;
          if (body.action === 'readPrepared') readPrepared++;
          if (body.action === 'read') reads.push({ purpose: body.purpose, token: (result as Message).token });
          if (body.action === 'prepare' && lostPrepare-- > 0) throw Object.assign(new Error('Synthetic prepare reply lost.'), { uncertain: true });
          if (body.action === 'retryPersistence' && lostPersistence-- > 0) throw Object.assign(new Error('Synthetic persistence reply lost.'), { uncertain: true });
        } else if (endpoint === 'send-injection') {
          nativeWrites.push(structuredClone(body));
          if (body.action === 'inject') {
            injectionStatus = { reference: structuredClone(body.reference), injection: { phase: 'injected', persistentThread: false,
              terminal: { kind: 'injected' } }, turn: { phase: 'waiting', attempts: [] }, pendingPersistence: null };
          } else if (body.action === 'start' && injectionStatus) {
            injectionStatus.turn = { phase: 'accepted', attemptId: body.turnAttemptId, attempts: [body.turnAttemptId],
              connectionGeneration: body.daemonConnectionGeneration,
              terminal: { kind: 'accepted', result: { turn: { id: 'native-turn', items: [], status: 'inProgress' } } } };
          } else if (body.action !== 'status') throw Error('Unexpected synthetic injection action.');
          result = structuredClone(injectionStatus);
        } else if (endpoint === 'queued-follow-up-send-lock-acquire') result = { acquired: true };
        else if (endpoint === 'queued-follow-up-send-lock-release') result = {};
        else if (endpoint === 'get-setting') result = { value: body.key === 'composerPlainTextMode' ? false : 'queue', exists: true };
        else if (endpoint === 'get-settings') result = {};
        else if (endpoint === 'get-persisted-atom') result = {};
        else throw Error('Fixture host endpoint not implemented: ' + endpoint);
        const send = () => { if (page.readyState === WebSocket.OPEN) page.send(JSON.stringify({
          type: 'fetch-response', requestId: message.requestId, responseType: 'success', body: result })); };
        if (endpoint === 'side-chat' && body.action === 'prepare' && holdPrepare) deliverPrepare = send;
        else if (endpoint === 'side-chat-browser-authority' && body.action === 'challenge' && holdChallenge) deliverChallenge = send;
        else send();
      } catch (error) {
        if (page.readyState === WebSocket.OPEN) page.send(JSON.stringify({ type: 'fetch-response', requestId: message.requestId,
          responseType: 'error', error: String(error), uncertain: !!(error && typeof error === 'object' && 'uncertain' in error && error.uncertain === true) }));
      } finally { parent.flushNotifications(page); }
    })().catch(() => {}); });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw Error('No fixture address.');
  return { url: `http://127.0.0.1:${address.port}/`, fake, order, reads, dispatches, nativeWrites, approvalReplies, section: () => section,
    holdChild() { holdChild = true; }, releaseChild() { holdChild = false; deliverChild?.(); }, childWaiting: () => !!deliverChild,
    holdFork() { holdFork = true; }, releaseFork() { lateFork?.(); }, forkWaiting: () => !!lateFork,
    holdPrepare() { holdPrepare = true; }, releasePrepare() { holdPrepare = false; deliverPrepare?.(); }, prepareWaiting: () => !!deliverPrepare,
    losePrepare() { lostPrepare = 1; }, preparedReads: () => readPrepared,
    holdUnsubscribe() { fake.handlers.set('thread/unsubscribe', () => NO_REPLY); },
    holdChallenge() { holdChallenge = true; }, releaseChallenge() { holdChallenge = false; deliverChallenge?.(); }, challengeWaiting: () => !!deliverChallenge,
    losePersistence(count: number) { lostPersistence = count; }, failRevoke(value: boolean) { failRevoke = value; },
    enableQueue() {
      fake.handlers.set('thread/queue/list', () => ({ data: structuredClone(queue), nextCursor: null }));
      fake.handlers.set('thread/queue/delete', params => {
        const index = queue.findIndex(item => item.id === params.queuedSubmissionId);
        if (index < 0) return { deleted: false };
        queue.splice(index, 1); return { deleted: true };
      });
      fake.handlers.set('thread/queue/start', params => {
        const index = queue.findIndex(item => item.id === params.queuedSubmissionId);
        if (index < 0) throw new Error('Synthetic queue entry not found.');
        const entry = queue.splice(index, 1)[0]!;
        return fake.defaultResult('turn/start', { threadId: params.threadId, input: entry.input, clientUserMessageId: entry.clientUserMessageId });
      });
    },
    queue: () => structuredClone(queue),
    changeGeneration() { generation = 'generation-b'; },
    signalGeneration() {
      generation = 'generation-b';
      for (const [page, byHost] of connections) {
        const connection = byHost.get('local');
        if (connection?.socket) socketGenerations.set(connection.socket, generation);
        if (page.readyState === WebSocket.OPEN) page.send(JSON.stringify({ type: 'codex-app-server-connection-changed',
          hostId: 'local', state: 'connected', daemonConnectionGeneration: generation }));
      }
    },
    async changeInjectAttempt() { await mutations.run(() => {
      const next = structuredClone(section), operation = Object.values(next.operations)[0] as Message;
      operation.inject.attemptId = 'other-attempt'; section = next;
    }); },
    startCompleted: () => terminalStarts > 0,
    holdApproval() { holdApproval = true; }, releaseApproval() { holdApproval = false; deliverApproval?.(); },
    approvalWaiting: () => !!deliverApproval,
    requestApproval(threadId: string, id: string) { for (const page of sockets.clients) if (page.readyState === WebSocket.OPEN) {
      page.send(JSON.stringify({ type: 'mcp-request', hostId: 'local', requestRef: { hostId: 'local', generation: 'approval-generation', id },
        request: { id, method: 'item/fileChange/requestApproval', params: { threadId, turnId: 'turn-a' } } }));
    } },
    hint() { for (const page of sockets.clients) if (page.readyState === WebSocket.OPEN) {
      const operations = Object.keys(section?.operations ?? {}); if (operations[0]) page.send(JSON.stringify({ type: 'side-chat-updated', hostId: 'local', operationId: operations[0] }));
    } },
    async close() {
      for (const page of sockets.clients) page.terminate();
      await new Promise<void>(resolve => sockets.close(() => resolve()));
      await new Promise<void>(resolve => server.close(() => resolve()));
      await fake.close(); await rm(root, { recursive: true, force: true });
    },
  };
}
async function eventually(check: () => boolean) {
  for (let i = 0; i < 300; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw Error('Timed out waiting for the synthetic peer.');
}
async function eventuallyAsync(check: () => Promise<boolean>) {
  for (let i = 0; i < 300; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw Error('Timed out waiting for the synthetic browser state.');
}
async function setup(browser: Browser, script: string, url: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  await context.route('**/*', route => route.request().url().startsWith(url) ? route.continue() : route.abort());
  const page = await context.newPage(); page.setDefaultTimeout(10_000);
  await page.goto(url); await page.addScriptTag({ content: script });
  await page.evaluate(async () => window.sideChatWorkspaceFixture.mount());
  await page.getByRole('button', { name: '打开侧聊' }).waitFor();
  return { context, page };
}

async function setupRoot(browser: Browser, script: string, url: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  await context.route('**/*', route => route.request().url().startsWith(url) ? route.continue() : route.abort());
  const page = await context.newPage(); page.setDefaultTimeout(10_000);
  await page.goto(url); await page.addScriptTag({ content: script });
  await page.evaluate(async () => window.sideChatRootFixture.mount());
  await page.waitForFunction(() => window.sideChatRootFixture.mounted());
  return { context, page };
}

test('SideChatRoot composes the original workspace, shared sender and child draft', { timeout: 100_000 }, async t => {
  const bundle = await build({ entryPoints: ['test/renderer-side-chat-root-fixture.tsx'], bundle: true, write: false,
    format: 'iife', loader: { '.css': 'empty' } });
  const browser = await chromium.launch({ executablePath: process.env.YARD_VALIDATION_CHROME_BIN || '/usr/bin/google-chrome',
    headless: true, args: ['--no-sandbox', '--disable-background-networking'] });
  const script = bundle.outputFiles[0]!.text;
  try {
    await t.test('opens once and exposes the real child and its browser draft transaction', async () => {
      const p = await peer(), { context, page } = await setupRoot(browser, script, p.url);
      try {
        const identity = await page.evaluate(() => window.sideChatRootFixture.open());
        assert.notEqual(identity.draftId, identity.prepareId);
        await page.getByRole('textbox', { name: '和 Codex 一起工作' }).waitFor();
        await page.waitForFunction(() => window.sideChatRootFixture.history().canSubmit && !!window.sideChatRootFixture.child()?.hasNavigation);
        const child = await page.evaluate(() => window.sideChatRootFixture.child());
        assert.deepEqual(child?.owner, { hostId: 'local', threadId: 'child-a', draftId: identity.draftId });
        assert.equal(child?.hasDraft, true); assert.equal(child?.hasEditNavigation, false);
        assert.deepEqual(p.order.slice(0, 4), ['fork', 'child', 'respond', 'inject']);
        const associations = await page.evaluate(() => window.sideChatRootFixture.listRecoverable());
        assert.equal(associations[0]?.draftId, identity.draftId); assert.equal(associations[0]?.prepareId, identity.prepareId);
        assert.equal(associations[0]?.childThreadId, 'child-a');
        const reference = await page.evaluate(() => window.sideChatRootFixture.attachBrowserReference());
        assert.equal(reference.context?.draftId, identity.draftId); assert.equal(reference.context?.threadId, 'child-a');
        await page.getByRole('button', { name: '移除引用' }).click();
        await page.waitForFunction(() => window.sideChatRootFixture.child()?.snapshot.draft.references?.length === 0);
        assert.equal((await page.evaluate(() => window.sideChatRootFixture.browserComments())).comments.length, 0);
        assert.deepEqual(await page.evaluate(() => window.sideChatRootFixture.removed()), [child!.owner]);
        await page.evaluate(() => window.sideChatRootFixture.setVisible(false));
        assert.equal((await page.evaluate(() => window.sideChatRootFixture.child()))?.owner.draftId, identity.draftId);
        await page.evaluate(() => window.sideChatRootFixture.setVisible(true));
        const input = page.getByRole('textbox', { name: '和 Codex 一起工作' }); await input.waitFor();
        await input.fill('synthetic message for the child projection');
        await page.getByRole('button', { name: '发送', exact: true }).click();
        await page.waitForFunction(() => !!window.sideChatRootFixture.child()?.hasEditNavigation);
        const turn = p.dispatches.find(message => message.request?.method === 'turn/start');
        assert.equal(turn?.daemonConnectionGeneration, 'generation-a'); assert.equal(turn?.request.params.threadId, 'child-a');
        await page.getByRole('button', { name: '停止', exact: true }).click();
        await eventually(() => p.fake.calls('turn/interrupt').length === 1);
        const stop = p.dispatches.find(message => message.request?.method === 'turn/interrupt');
        assert.equal(stop?.daemonConnectionGeneration, 'generation-a'); assert.equal(stop?.request.params.threadId, 'child-a');
        assert.equal(stop?.request.params.turnId, 'fixture-turn-1');
        assert.equal(p.fake.calls('thread/fork').length, 1);
      } finally { await context.close(); await p.close(); }
    });
    await t.test('navigation freezes before waiting, drains the real draft operation, and hands off only after commit', async () => {
      const p = await peer(), { context, page } = await setupRoot(browser, script, p.url);
      try {
        await page.evaluate(() => window.sideChatRootFixture.open());
        const input = page.getByRole('textbox', { name: '和 Codex 一起工作' }); await input.waitFor();
        await page.waitForFunction(() => !!window.sideChatRootFixture.child()?.hasNavigation);
        await input.fill('synthetic retained draft');
        await page.waitForFunction(() => window.sideChatRootFixture.child()?.snapshot.draft.text === 'synthetic retained draft');
        assert.equal(await page.evaluate(() => window.sideChatRootFixture.holdDraftOperation()), true);
        await page.evaluate(() => window.sideChatRootFixture.holdOwnerWork());
        assert.equal(await page.evaluate(() => window.sideChatRootFixture.freezeNavigation()), true);
        const draftId = (await page.evaluate(() => window.sideChatRootFixture.child()))!.identity.draftId;
        assert.equal(await page.evaluate(id => window.sideChatRootFixture.canAttachOwner(id), draftId), false);
        await page.evaluate(() => window.sideChatRootFixture.beginFlush());
        await page.waitForTimeout(100);
        assert.equal(await page.evaluate(() => window.sideChatRootFixture.flushDone()), false);
        assert.equal(await page.evaluate(() => { try { window.sideChatRootFixture.open(); return false; } catch { return true; } }), true);
        await page.evaluate(() => window.sideChatRootFixture.releaseDraftOperation());
        await page.waitForTimeout(100);
        assert.equal(await page.evaluate(() => window.sideChatRootFixture.flushDone()), false);
        await page.evaluate(() => window.sideChatRootFixture.releaseOwnerWork());
        assert.equal(await page.evaluate(() => window.sideChatRootFixture.flushResult()), true);
        await page.evaluate(() => window.sideChatRootFixture.revokeNavigation());
        assert.equal((await page.evaluate(() => window.sideChatRootFixture.child()))?.snapshot.draft.text, 'synthetic retained draft');
        await page.evaluate(() => { window.sideChatRootFixture.changeParent(); window.sideChatRootFixture.handoffNavigation();
          window.sideChatRootFixture.releaseNavigation(); });
        await page.waitForFunction(() => !window.sideChatRootFixture.child());
        assert.equal(await page.evaluate(() => window.sideChatRootFixture.closed), 0);
        assert.equal(p.fake.calls('thread/unsubscribe').length, 0);
      } finally { await context.close(); await p.close(); }
    });
    await t.test('navigation freezes and hands off every retained child', async () => {
      const p = await peer(), { context, page } = await setupRoot(browser, script, p.url);
      try {
        const first = await page.evaluate(() => window.sideChatRootFixture.open());
        const input = page.getByRole('textbox', { name: '和 Codex 一起工作' }); await input.waitFor();
        await page.waitForFunction(() => !!window.sideChatRootFixture.child()?.hasNavigation);
        await input.fill('first retained draft');
        assert.equal(await page.evaluate(() => window.sideChatRootFixture.flushDraft()), true);
        const second = await page.evaluate(() => window.sideChatRootFixture.open());
        await page.waitForFunction(id => window.sideChatRootFixture.child()?.identity.draftId === id
          && !!window.sideChatRootFixture.child()?.hasNavigation, second.draftId);
        await input.waitFor(); await input.fill('second retained draft');
        assert.equal(await page.evaluate(() => window.sideChatRootFixture.flushDraft()), true);
        await page.waitForFunction(ids => ids.every(id => window.sideChatRootFixture.canAcquireChild(id)), [first.draftId, second.draftId]);
        assert.equal(await page.evaluate(() => window.sideChatRootFixture.freezeNavigation()), true);
        for (const id of [first.draftId, second.draftId]) {
          assert.equal(await page.evaluate(value => window.sideChatRootFixture.canAcquireChild(value), id), false);
        }
        assert.equal(await page.evaluate(() => window.sideChatRootFixture.flushNavigation()), true);
        await page.evaluate(() => window.sideChatRootFixture.revokeNavigation());
        await page.evaluate(() => { window.sideChatRootFixture.changeParent(); window.sideChatRootFixture.handoffNavigation();
          window.sideChatRootFixture.releaseNavigation(); });
        await page.waitForFunction(() => !window.sideChatRootFixture.child());
        assert.equal(await page.evaluate(() => window.sideChatRootFixture.closed), 0);
        assert.equal(p.fake.calls('thread/fork').length, 2);
        assert.equal(p.fake.calls('thread/unsubscribe').length, 0);
      } finally { await context.close(); await p.close(); }
    });
    await t.test('a close freezes the child before draining its original external draft operation', async () => {
      const p = await peer(), { context, page } = await setupRoot(browser, script, p.url);
      try {
        await page.evaluate(() => window.sideChatRootFixture.open());
        await page.getByRole('textbox', { name: '和 Codex 一起工作' }).waitFor();
        await page.waitForFunction(() => !!window.sideChatRootFixture.child()?.hasNavigation);
        await page.waitForFunction(() => window.sideChatRootFixture.canAcquireDraft());
        assert.equal(await page.evaluate(() => window.sideChatRootFixture.holdDraftOperation()), true);
        await page.getByRole('button', { name: '关闭侧聊' }).click();
        assert.equal(await page.evaluate(() => window.sideChatRootFixture.canAcquireDraft()), false);
        assert.equal(p.order.includes('close'), false);
        await page.evaluate(() => window.sideChatRootFixture.releaseDraftOperation());
        await page.waitForFunction(() => window.sideChatRootFixture.closed === 1);
        assert.equal(p.fake.calls('thread/unsubscribe').length, 1);
      } finally { await context.close(); await p.close(); }
    });
    await t.test('an unconfirmed revoke keeps the original root and draft frozen until retry succeeds', async () => {
      const p = await peer(); p.failRevoke(true); p.enableQueue();
      const { context, page } = await setupRoot(browser, script, p.url);
      try {
        await page.evaluate(() => window.sideChatRootFixture.open());
        await page.getByText(/浏览器确认尚未撤销/).waitFor();
        const input = page.getByRole('textbox', { name: '和 Codex 一起工作' }); await input.waitFor();
        await page.getByRole('button', { name: '删除待发送消息' }).first().waitFor();
        await input.fill('draft survives revoke failure');
        await page.waitForFunction(() => window.sideChatRootFixture.child()?.snapshot.draft.text === 'draft survives revoke failure');
        assert.equal(await page.evaluate(() => window.sideChatRootFixture.flushDraft()), true);
        assert.equal(await page.evaluate(() => window.sideChatRootFixture.freezeNavigation()), true);
        const flushed = await page.evaluate(() => window.sideChatRootFixture.flushNavigation());
        if (!flushed) console.error('root revoke flush diagnostic', await page.locator('body').innerText());
        assert.equal(flushed, true);
        await assert.rejects(page.evaluate(() => window.sideChatRootFixture.revokeNavigation()), /revoke reply lost/);
        await assert.rejects(page.evaluate(() => window.sideChatRootFixture.releaseNavigation()), /撤权尚未确认/);
        assert.equal((await page.evaluate(() => window.sideChatRootFixture.child()))?.snapshot.draft.text, 'draft survives revoke failure');
        assert.equal(await page.evaluate(() => window.sideChatRootFixture.canAcquireDraft()), false);
        p.failRevoke(false);
        await page.evaluate(() => window.sideChatRootFixture.revokeNavigation());
        await page.evaluate(() => window.sideChatRootFixture.releaseNavigation());
        await page.waitForFunction(() => window.sideChatRootFixture.canAcquireDraft());
      } finally { await context.close(); await p.close(); }
    });
    await t.test('the original child and daemon generation reach native injection and its turn', async () => {
      const p = await peer(), { context, page } = await setupRoot(browser, script, p.url);
      try {
        const identity = await page.evaluate(() => window.sideChatRootFixture.open());
        await page.getByRole('textbox', { name: '和 Codex 一起工作' }).waitFor();
        await page.waitForFunction(() => window.sideChatRootFixture.history().canSubmit && !!window.sideChatRootFixture.child());
        await page.evaluate(() => window.sideChatRootFixture.structuredDraft());
        await page.getByRole('button', { name: '发送', exact: true }).click();
        await eventually(() => p.nativeWrites.length === 2);
        assert.deepEqual(p.nativeWrites.map(item => item.action), ['inject', 'start']);
        for (const call of p.nativeWrites) {
          assert.equal(call.daemonConnectionGeneration, 'generation-a'); assert.equal(call.reference.threadId, 'child-a');
          assert.equal(call.reference.owner.draftId, identity.draftId);
        }
        assert.equal(p.fake.calls('turn/start').length, 0);
      } finally { await context.close(); await p.close(); }
    });
    await t.test('changing Main while native injection waits rejects the original grant without dispatch', async () => {
      const p = await peer(), { context, page } = await setupRoot(browser, script, p.url);
      try {
        await page.evaluate(() => window.sideChatRootFixture.open());
        await page.getByRole('textbox', { name: '和 Codex 一起工作' }).waitFor();
        await page.waitForFunction(() => window.sideChatRootFixture.history().canSubmit && !!window.sideChatRootFixture.child());
        await page.evaluate(() => window.sideChatRootFixture.structuredDraft());
        await page.evaluate(() => window.sideChatRootFixture.holdNative());
        await page.getByRole('button', { name: '发送', exact: true }).click();
        await page.waitForFunction(() => window.sideChatRootFixture.nativeWaiting());
        await page.evaluate(() => { window.sideChatRootFixture.changeParent(); window.sideChatRootFixture.releaseNative(); });
        await eventuallyAsync(() => page.evaluate(async () => Object.values((await window.sideChatRootFixture.sends()).requests).some(item => item.stage === 'failed')));
        assert.equal(p.nativeWrites.length, 0); assert.equal(p.fake.calls('turn/start').length, 0);
      } finally { await page.evaluate(() => window.sideChatRootFixture.releaseNative()); await context.close(); await p.close(); }
    });
    await t.test('switching the active child invalidates an older pending input grant', async () => {
      const p = await peer(), { context, page } = await setupRoot(browser, script, p.url);
      try {
        const original = await page.evaluate(() => window.sideChatRootFixture.open());
        await page.getByRole('textbox', { name: '和 Codex 一起工作' }).waitFor();
        await page.waitForFunction(() => window.sideChatRootFixture.history().canSubmit && !!window.sideChatRootFixture.child());
        await page.evaluate(() => window.sideChatRootFixture.structuredDraft());
        await page.evaluate(() => window.sideChatRootFixture.holdNative());
        await page.getByRole('button', { name: '发送', exact: true }).click();
        await page.waitForFunction(() => window.sideChatRootFixture.nativeWaiting());
        const next = await page.evaluate(() => window.sideChatRootFixture.open());
        await page.waitForFunction(id => window.sideChatRootFixture.child()?.identity.draftId === id, next.draftId);
        await page.evaluate(() => window.sideChatRootFixture.releaseNative());
        await eventuallyAsync(() => page.evaluate(async () => Object.values((await window.sideChatRootFixture.sends()).requests).some(item => item.stage === 'failed')));
        assert.equal(p.nativeWrites.length, 0); assert.equal(p.fake.calls('turn/start').length, 0);
        await page.evaluate(id => window.sideChatRootFixture.show(id), original.draftId);
        assert.equal((await page.evaluate(() => window.sideChatRootFixture.child()))?.owner.draftId, original.draftId);
      } finally { await page.evaluate(() => window.sideChatRootFixture.releaseNative()); await context.close(); await p.close(); }
    });
    await t.test('queue deletion and start use the original child grant and daemon generation', async () => {
      const p = await peer(); p.enableQueue();
      const { context, page } = await setupRoot(browser, script, p.url);
      try {
        await page.evaluate(() => window.sideChatRootFixture.open());
        await page.getByRole('textbox', { name: '和 Codex 一起工作' }).waitFor();
        await page.waitForFunction(() => window.sideChatRootFixture.history().canSubmit);
        const remove = page.getByRole('button', { name: '删除待发送消息' }).first(); await remove.waitFor(); await remove.click();
        await eventually(() => p.fake.calls('thread/queue/delete').length === 1);
        const deletion = p.dispatches.find(message => message.request?.method === 'thread/queue/delete');
        assert.equal(deletion?.daemonConnectionGeneration, 'generation-a'); assert.equal(deletion?.request.params.threadId, 'child-a');
        const start = page.getByRole('button', { name: '立即发送待发送消息' }).first(); await start.waitFor(); await start.click();
        await eventually(() => p.fake.calls('thread/queue/start').length === 1);
        const starting = p.dispatches.find(message => message.request?.method === 'thread/queue/start');
        assert.equal(starting?.daemonConnectionGeneration, 'generation-a'); assert.equal(starting?.request.params.threadId, 'child-a');
      } finally { await context.close(); await p.close(); }
    });
    await t.test('a new daemon generation cannot authorize a send for the old child', async () => {
      const p = await peer(), { context, page } = await setupRoot(browser, script, p.url);
      try {
        await page.evaluate(() => window.sideChatRootFixture.open());
        const input = page.getByRole('textbox', { name: '和 Codex 一起工作' }); await input.waitFor();
        await page.waitForFunction(() => window.sideChatRootFixture.history().canSubmit);
        await input.fill('must remain on the original child');
        p.signalGeneration();
        await page.waitForFunction(() => window.sideChatRootFixture.generation() === 'generation-b');
        await page.getByRole('button', { name: '发送', exact: true }).click();
        await page.getByText(/原页面的主机连接已失效/).waitFor();
        assert.equal(p.fake.calls('turn/start').length, 0); assert.equal(p.nativeWrites.length, 0);
        assert.equal((await page.evaluate(() => window.sideChatRootFixture.child()))?.snapshot.draft.text, 'must remain on the original child');
        assert.equal(await page.evaluate(() => window.sideChatRootFixture.freezeNavigation()), false);
      } finally { await context.close(); await p.close(); }
    });
    await t.test('reopening a durable association observes without taking the original token or reforking', async () => {
      const p = await peer(), { context, page } = await setupRoot(browser, script, p.url);
      try {
        const identity = await page.evaluate(() => window.sideChatRootFixture.open());
        await page.getByRole('textbox', { name: '和 Codex 一起工作' }).waitFor();
        const other = await context.newPage(); await other.goto(p.url); await other.addScriptTag({ content: script });
        await other.evaluate(() => window.sideChatRootFixture.mount());
        await other.waitForFunction(() => window.sideChatRootFixture.mounted());
        assert.equal((await other.evaluate(() => window.sideChatRootFixture.listRecoverable()))[0]?.draftId, identity.draftId);
        const restored = await other.evaluate(value => window.sideChatRootFixture.restore(value), identity);
        assert.equal(restored.mode, 'restore');
        await other.waitForFunction(() => window.sideChatRootFixture.history().thread?.id === 'child-a');
        assert.equal((await other.evaluate(() => window.sideChatRootFixture.history())).liveReady, false);
        await other.getByRole('button', { name: '关闭侧聊' }).click();
        await other.waitForFunction(() => window.sideChatRootFixture.exited === 1);
        assert.equal(await other.evaluate(() => window.sideChatRootFixture.closed), 0);
        assert.equal(p.fake.calls('thread/fork').length, 1); assert.equal(p.fake.calls('thread/unsubscribe').length, 0);
      } finally { await context.close(); await p.close(); }
    });
    await t.test('unknown close preserves the old mounted draft when a separate side chat is opened', async () => {
      const p = await peer(); p.holdUnsubscribe();
      const { context, page } = await setupRoot(browser, script, p.url);
      try {
        const original = await page.evaluate(() => window.sideChatRootFixture.open());
        const input = page.getByRole('textbox', { name: '和 Codex 一起工作' }); await input.waitFor();
        await input.fill('original unresolved draft');
        await page.getByRole('button', { name: '关闭侧聊' }).click();
        await page.getByText(/原操作结果未知/).waitFor();
        await page.getByRole('button', { name: '另开侧聊' }).click();
        await page.waitForFunction(() => window.sideChatRootFixture.child()?.owner.threadId === 'child-2');
        const next = await page.evaluate(() => window.sideChatRootFixture.child());
        assert.notEqual(next?.owner.draftId, original.draftId);
        assert.equal(await page.evaluate(() => window.sideChatRootFixture.freezeNavigation()), false);
        await page.evaluate(id => window.sideChatRootFixture.show(id), original.draftId);
        assert.equal((await page.evaluate(() => window.sideChatRootFixture.child()))?.snapshot.draft.text, 'original unresolved draft');
        assert.equal(await page.getByRole('textbox', { name: '草稿', exact: true }).inputValue(), 'original unresolved draft');
        assert.equal(p.fake.calls('thread/unsubscribe').length, 1); assert.equal(p.fake.calls('thread/fork').length, 2);
      } finally { await context.close(); await p.close(); }
    });
  } finally { await browser.close(); }
});

test('real workspace, IDB, browser client and native parent/provider use one synthetic peer', { timeout: 100_000 }, async t => {
  const bundle = await build({ entryPoints: ['test/renderer-side-chat-workspace-fixture.tsx'], bundle: true, write: false,
    format: 'iife', loader: { '.css': 'empty' } });
  const browser = await chromium.launch({ executablePath: process.env.YARD_VALIDATION_CHROME_BIN || '/usr/bin/google-chrome',
    headless: true, args: ['--no-sandbox', '--disable-background-networking'] });
  const script = bundle.outputFiles[0]!.text;
  try {
    await t.test('fork receipt is persisted before IDB/session child confirmation and inject; close freezes before its first wait', async () => {
      const p = await peer(); p.holdChild();
      const { context, page } = await setup(browser, script, p.url);
      try {
        await page.getByRole('button', { name: '打开侧聊' }).click(); await eventually(p.childWaiting);
        assert.deepEqual(p.order, ['fork', 'child']);
        assert.equal((await page.evaluate(() => window.sideChatWorkspaceFixture.association()))?.childThreadId, null);
        p.hint(); await eventually(() => p.reads.some(read => read.purpose === 'observe'));
        assert.ok(p.reads.filter(read => read.purpose === 'observe').every(read => read.token === null));
        p.releaseChild();
        await page.getByRole('textbox', { name: '和 Codex 一起工作' }).waitFor();
        assert.deepEqual(p.order.slice(0, 4), ['fork', 'child', 'respond', 'inject']);
        assert.equal((await page.evaluate(() => window.sideChatWorkspaceFixture.association()))?.childThreadId, 'child-a');
        await page.waitForFunction(() => window.sideChatWorkspaceFixture.history().canSubmit);
        const history = await page.evaluate(() => window.sideChatWorkspaceFixture.history());
        assert.equal(history.liveReady, true); assert.equal(history.historyComplete, false);
        await page.evaluate(() => window.sideChatWorkspaceFixture.holdDrain());
        await page.getByRole('button', { name: '关闭侧聊' }).click();
        assert.equal(await page.evaluate(() => window.sideChatWorkspaceFixture.frozen), true);
        assert.equal(p.order.includes('close'), false);
        await page.evaluate(() => window.sideChatWorkspaceFixture.releaseDrain());
        await page.waitForFunction(() => window.sideChatWorkspaceFixture.closed === 1);
        assert.equal(await page.evaluate(() => window.sideChatWorkspaceFixture.cleanups), 1);
        assert.equal(p.fake.calls('thread/unsubscribe').length, 1);
      } catch (error) {
        console.error('child diagnostic', p.order, JSON.stringify(p.section()?.operations && Object.values(p.section().operations).map((op: any) =>
          ({ fork: op.fork?.status, inject: op.inject?.status, close: op.close?.status }))), await page.locator('body').innerText());
        throw error;
      } finally { p.releaseChild(); await context.close(); await p.close(); }
    });
    await t.test('lost pure persistence reply can be explicitly retried without replaying an unknown fork', async () => {
      const p = await peer(); p.holdFork(); p.losePersistence(1);
      const { context, page } = await setup(browser, script, p.url);
      try {
        await page.getByRole('button', { name: '打开侧聊' }).click(); await eventually(p.forkWaiting);
        const button = page.getByRole('button', { name: '重试保存回执' }); await button.waitFor();
        await button.click(); await page.getByText(/Synthetic persistence reply lost/).waitFor();
        await button.click();
        await page.waitForFunction(() => !document.body.textContent?.includes('Synthetic persistence reply lost'));
        assert.equal(p.fake.calls('thread/fork').length, 1); assert.equal(p.fake.calls('thread/inject_items').length, 0);
        p.releaseFork(); await page.getByRole('button', { name: '继续操作' }).first().waitFor();
        await page.getByRole('button', { name: '继续操作' }).first().click();
        await page.getByRole('textbox', { name: '和 Codex 一起工作' }).waitFor();
        assert.equal(p.fake.calls('thread/fork').length, 1); assert.equal(p.fake.calls('thread/inject_items').length, 1);
      } catch (error) {
        console.error('persistence diagnostic', p.order, JSON.stringify(p.section()?.operations && Object.values(p.section().operations).map((op: any) =>
          ({ fork: op.fork?.status, inject: op.inject?.status, close: op.close?.status }))), await page.locator('body').innerText());
        throw error;
      } finally { p.releaseFork(); await context.close(); await p.close(); }
    });
    await t.test('restored page observes without acquiring the original dispatch token', async () => {
      const p = await peer(), { context, page } = await setup(browser, script, p.url);
      try {
        await page.getByRole('button', { name: '打开侧聊' }).click();
        await page.getByRole('textbox', { name: '和 Codex 一起工作' }).waitFor();
        const other = await context.newPage(); await other.goto(p.url); await other.addScriptTag({ content: script });
        await other.evaluate(async () => window.sideChatWorkspaceFixture.mount(true));
        await other.waitForFunction(() => window.sideChatWorkspaceFixture.history().thread?.id === 'child-a');
        const restored = await other.evaluate(() => window.sideChatWorkspaceFixture.history());
        assert.equal(restored.liveReady, false); assert.equal(restored.canSubmit, false); assert.equal(restored.historyComplete, false);
        p.hint(); await eventually(() => p.reads.filter(read => read.purpose === 'observe').length >= 2);
        assert.ok(p.reads.filter(read => read.purpose === 'observe').every(read => read.token === null));
        assert.equal(p.fake.calls('thread/fork').length, 1);
      } finally { await context.close(); await p.close(); }
    });
    await t.test('in-flight prepare refuses close before acquiring a lease', async () => {
      const p = await peer(); p.holdPrepare();
      const { context, page } = await setup(browser, script, p.url);
      try {
        await page.getByRole('button', { name: '打开侧聊' }).click(); await eventually(p.prepareWaiting);
        await page.getByRole('button', { name: '关闭侧聊' }).click();
        await page.getByText(/准备结果尚未确认/).waitFor();
        assert.equal(await page.evaluate(() => window.sideChatWorkspaceFixture.frozen), false);
        assert.equal(p.order.includes('close'), false);
        p.releasePrepare();
        await page.getByRole('textbox', { name: '和 Codex 一起工作' }).waitFor();
        assert.equal(p.fake.calls('thread/fork').length, 1);
      } finally { p.releasePrepare(); await context.close(); await p.close(); }
    });
    await t.test('lost prepare is explicitly read back and an observer exits without closing the host', async () => {
      const p = await peer(); p.losePrepare();
      const { context, page } = await setup(browser, script, p.url);
      try {
        await page.getByRole('button', { name: '打开侧聊' }).click();
        await page.getByText(/Synthetic prepare reply lost/).waitFor();
        await page.getByRole('button', { name: '关闭侧聊' }).click();
        await page.getByText(/准备结果尚未确认/).waitFor();
        assert.equal(await page.evaluate(() => window.sideChatWorkspaceFixture.frozen), false);
        assert.equal(p.fake.calls('thread/fork').length, 0);
        await page.getByRole('button', { name: '核对准备结果' }).click();
        await page.getByText(/上一次宿主调用尚未确认/).waitFor();
        const association = await page.evaluate(() => window.sideChatWorkspaceFixture.association());
        assert.ok(association?.operationId); assert.equal(p.preparedReads(), 1);
        assert.equal(p.fake.calls('thread/fork').length, 0);
        await page.getByRole('button', { name: '关闭侧聊' }).click();
        await page.waitForFunction(() => window.sideChatWorkspaceFixture.exited === 1);
        assert.equal(await page.evaluate(() => window.sideChatWorkspaceFixture.closed), 0);
        assert.equal(await page.evaluate(() => window.sideChatWorkspaceFixture.frozen), false);
        assert.deepEqual(await page.evaluate(() => window.sideChatWorkspaceFixture.association()), association);
        assert.equal(p.order.includes('close'), false);
      } finally { await context.close(); await p.close(); }
    });
    await t.test('restored observer releases its close attempt without unsubscribing the original child', async () => {
      const p = await peer(), { context, page } = await setup(browser, script, p.url);
      try {
        await page.getByRole('button', { name: '打开侧聊' }).click();
        await page.getByRole('textbox', { name: '和 Codex 一起工作' }).waitFor();
        const association = await page.evaluate(() => window.sideChatWorkspaceFixture.association());
        const other = await context.newPage(); await other.goto(p.url); await other.addScriptTag({ content: script });
        await other.evaluate(() => window.sideChatWorkspaceFixture.mount(true));
        await other.waitForFunction(() => window.sideChatWorkspaceFixture.draftSnapshot()?.owner.threadId === 'child-a');
        await other.getByRole('button', { name: '关闭侧聊' }).click();
        await other.waitForFunction(() => window.sideChatWorkspaceFixture.exited === 1);
        assert.equal(await other.evaluate(() => window.sideChatWorkspaceFixture.closed), 0);
        assert.equal(await other.evaluate(() => window.sideChatWorkspaceFixture.frozen), false);
        assert.deepEqual(await other.evaluate(() => window.sideChatWorkspaceFixture.association()), association);
        assert.equal(p.fake.calls('thread/unsubscribe').length, 0);
        assert.equal(await page.getByRole('textbox', { name: '和 Codex 一起工作' }).count(), 1);
      } finally { await context.close(); await p.close(); }
    });
    await t.test('disconnect during close drain releases the undispatched lease and permits a separate new instance', async () => {
      const p = await peer(), { context, page } = await setup(browser, script, p.url);
      try {
        await page.getByRole('button', { name: '打开侧聊' }).click();
        const input = page.getByRole('textbox', { name: '和 Codex 一起工作' }); await input.waitFor();
        await input.fill('断线后仍保留的草稿');
        const association = await page.evaluate(() => window.sideChatWorkspaceFixture.association());
        await page.evaluate(() => window.sideChatWorkspaceFixture.holdDrain());
        await page.getByRole('button', { name: '关闭侧聊' }).click();
        assert.equal(await page.evaluate(() => window.sideChatWorkspaceFixture.frozen), true);
        await page.evaluate(() => { window.sideChatWorkspaceFixture.disconnect(); window.sideChatWorkspaceFixture.releaseDrain(); });
        await page.getByText(/无法关闭侧聊/).waitFor();
        assert.equal(await page.evaluate(() => window.sideChatWorkspaceFixture.frozen), false);
        await page.getByRole('button', { name: '另开侧聊' }).click();
        await page.waitForFunction(() => window.sideChatWorkspaceFixture.opened().length === 1
          || document.body.textContent?.includes('无法确认新侧聊是否已打开'));
        const opened = await page.evaluate(() => window.sideChatWorkspaceFixture.opened());
        assert.equal(opened.length, 1, await page.locator('body').innerText()); assert.equal(opened[0]?.scope.operationId, association?.operationId);
        assert.notEqual(opened[0]?.draftId, 'workspace-draft'); assert.notEqual(opened[0]?.operationId, association?.operationId);
        assert.equal(await input.inputValue(), '断线后仍保留的草稿');
        assert.deepEqual(await page.evaluate(() => window.sideChatWorkspaceFixture.association()), association);
        assert.equal(p.fake.calls('thread/fork').length, 2); assert.equal(p.fake.calls('thread/unsubscribe').length, 0);
        assert.equal(Object.keys(p.section().operations).length, 2);
        assert.equal(p.section().operations[opened[0]!.operationId].childId, 'child-2');
      } finally { await context.close(); await p.close(); }
    });
    await t.test('unknown dispatched close keeps its lease while a new instance is requested', async () => {
      const p = await peer(); p.holdUnsubscribe();
      const { context, page } = await setup(browser, script, p.url);
      try {
        await page.getByRole('button', { name: '打开侧聊' }).click();
        const input = page.getByRole('textbox', { name: '和 Codex 一起工作' }); await input.waitFor();
        await input.fill('未知关闭保留的草稿');
        const association = await page.evaluate(() => window.sideChatWorkspaceFixture.association());
        await page.getByRole('button', { name: '关闭侧聊' }).click();
        await page.getByText(/原操作结果未知/).waitFor();
        assert.equal(await page.evaluate(() => window.sideChatWorkspaceFixture.frozen), true);
        await page.getByRole('button', { name: '另开侧聊' }).click();
        await page.waitForFunction(() => window.sideChatWorkspaceFixture.opened().length === 1
          || document.body.textContent?.includes('无法确认新侧聊是否已打开'));
        const opened = await page.evaluate(() => window.sideChatWorkspaceFixture.opened());
        assert.equal(opened.length, 1, await page.locator('body').innerText()); assert.equal(opened[0]?.scope.operationId, association?.operationId);
        assert.notEqual(opened[0]?.draftId, 'workspace-draft');
        assert.equal(await page.evaluate(() => window.sideChatWorkspaceFixture.frozen), true);
        assert.deepEqual(await page.evaluate(() => window.sideChatWorkspaceFixture.association()), association);
        assert.equal(p.fake.calls('thread/unsubscribe').length, 1); assert.equal(p.fake.calls('thread/fork').length, 2);
        assert.equal(Object.keys(p.section().operations).length, 2);
        assert.equal(p.section().operations[opened[0]!.operationId].childId, 'child-2');
        assert.equal(await page.evaluate(() => window.sideChatWorkspaceFixture.draftSnapshot()?.draft.text), '未知关闭保留的草稿');
      } finally { await context.close(); await p.close(); }
    });
    await t.test('new-instance guard distinguishes before-send from a parent callback of unknown outcome', async () => {
      const p = await peer(), { context, page } = await setup(browser, script, p.url);
      try {
        await page.getByRole('button', { name: '打开侧聊' }).click();
        await page.getByRole('textbox', { name: '和 Codex 一起工作' }).waitFor();
        const button = page.getByRole('button', { name: '另开侧聊' });
        await page.evaluate(() => window.sideChatWorkspaceFixture.changePresentedScope());
        await button.click(); await page.getByText(/新侧聊尚未打开/).waitFor();
        assert.equal(await page.evaluate(() => window.sideChatWorkspaceFixture.openAttempts().length), 0);
        assert.equal(await button.isEnabled(), true);
      } finally { await context.close(); await p.close(); }
      const q = await peer(), second = await setup(browser, script, q.url);
      try {
        await second.page.getByRole('button', { name: '打开侧聊' }).click();
        await second.page.getByRole('textbox', { name: '和 Codex 一起工作' }).waitFor();
        const button = second.page.getByRole('button', { name: '另开侧聊' });
        await second.page.evaluate(() => window.sideChatWorkspaceFixture.setOpenBehavior('unsent'));
        await button.click(); await second.page.getByText(/新侧聊尚未打开/).waitFor();
        assert.equal(await second.page.evaluate(() => window.sideChatWorkspaceFixture.openAttempts().length), 1);
        assert.equal(await button.isEnabled(), true);
        await second.page.evaluate(() => window.sideChatWorkspaceFixture.setOpenBehavior('unknown'));
        await button.click();
        await second.page.getByText(/无法确认新侧聊是否已打开/).waitFor();
        assert.equal(await second.page.evaluate(() => window.sideChatWorkspaceFixture.openAttempts().length), 2);
        assert.equal(await button.isDisabled(), true);
      } finally { await second.context.close(); await q.close(); }
    });
    await t.test('real child draft callbacks attach and remove a browser reference in the shared root transaction', async () => {
      const p = await peer(), { context, page } = await setup(browser, script, p.url);
      try {
        await page.getByRole('button', { name: '打开侧聊' }).click();
        await page.getByRole('textbox', { name: '和 Codex 一起工作' }).waitFor();
        await page.waitForFunction(() => !!window.sideChatWorkspaceFixture.draftSnapshot());
        const reference = await page.evaluate(() => window.sideChatWorkspaceFixture.attachBrowserReference());
        assert.equal(reference.context?.hostId, 'local'); assert.equal(reference.context?.threadId, 'child-a');
        assert.equal(reference.context?.draftId, 'workspace-draft');
        await page.waitForFunction(() => window.sideChatWorkspaceFixture.draftSnapshot()?.draft.references?.length === 1);
        assert.equal((await page.evaluate(() => window.sideChatWorkspaceFixture.browserComments())).comments.length, 1);
        await page.getByRole('button', { name: '移除引用' }).click();
        await page.waitForFunction(() => window.sideChatWorkspaceFixture.draftSnapshot()?.draft.references?.length === 0);
        assert.equal((await page.evaluate(() => window.sideChatWorkspaceFixture.browserComments())).comments.length, 0);
        assert.deepEqual(await page.evaluate(() => window.sideChatWorkspaceFixture.removedOwners()),
          [{ hostId: 'local', threadId: 'child-a', draftId: 'workspace-draft' }]);
        assert.equal(await page.evaluate(() => window.sideChatWorkspaceFixture.hasDraftController()), true);
      } finally { await context.close(); await p.close(); }
    });
    await t.test('an IDB association failure retries initialization on the original workspace', async () => {
      const p = await peer(), context = await browser.newContext();
      await context.route('**/*', route => route.request().url().startsWith(p.url) ? route.continue() : route.abort());
      const page = await context.newPage(); page.setDefaultTimeout(10_000);
      try {
        await page.goto(p.url); await page.addScriptTag({ content: script });
        await page.evaluate(async () => {
          await window.sideChatWorkspaceFixture.initializeRoot();
          window.sideChatWorkspaceFixture.failWrite(2);
          await window.sideChatWorkspaceFixture.mount();
        });
        await page.getByText(/Synthetic IDB write failure/).waitFor();
        assert.equal(p.fake.calls('thread/fork').length, 0);
        await page.getByRole('button', { name: '重试读取草稿' }).click();
        await page.getByRole('button', { name: '打开侧聊' }).click();
        await page.getByRole('textbox', { name: '和 Codex 一起工作' }).waitFor();
        const association = await page.evaluate(() => window.sideChatWorkspaceFixture.association());
        assert.equal(association?.prepareId, 'workspace-prepare'); assert.equal(association?.childThreadId, 'child-a');
        assert.equal(p.fake.calls('thread/fork').length, 1);
      } finally { await context.close(); await p.close(); }
    });
    await t.test('generation change while child confirmation waits never injects', async () => {
      const p = await peer(); p.holdChild();
      const { context, page } = await setup(browser, script, p.url);
      try {
        await page.getByRole('button', { name: '打开侧聊' }).click(); await eventually(p.childWaiting);
        p.changeGeneration(); p.releaseChild();
        await page.getByText(/写入侧聊边界未发送/).waitFor();
        assert.equal(p.fake.calls('thread/fork').length, 1); assert.equal(p.fake.calls('thread/inject_items').length, 0);
        assert.equal(Object.values(p.section().operations).length, 1);
      } catch (error) {
        console.error('generation diagnostic', p.order, JSON.stringify(p.section()?.operations && Object.values(p.section().operations).map((op: any) =>
          ({ fork: op.fork?.status, inject: op.inject?.status, close: op.close?.status }))), await page.locator('body').innerText());
        throw error;
      } finally { p.releaseChild(); await context.close(); await p.close(); }
    });
    await t.test('an inject attempt changed during child confirmation cannot borrow the old handshake', async () => {
      const p = await peer(); p.holdChild();
      const { context, page } = await setup(browser, script, p.url);
      try {
        await page.getByRole('button', { name: '打开侧聊' }).click(); await eventually(p.childWaiting);
        await p.changeInjectAttempt(); p.releaseChild();
        await eventually(p.startCompleted);
        assert.equal(p.fake.calls('thread/fork').length, 1);
        assert.equal(p.fake.calls('thread/inject_items').length, 0);
        assert.equal((Object.values(p.section().operations)[0] as Message).inject.status, 'inflight');
        assert.equal((await page.evaluate(() => window.sideChatWorkspaceFixture.association()))?.childThreadId, 'child-a');
      } catch (error) {
        console.error('attempt diagnostic', p.order, JSON.stringify(p.section()?.operations && Object.values(p.section().operations).map((op: any) =>
          ({ fork: op.fork?.status, inject: op.inject?.status, close: op.close?.status }))), await page.locator('body').innerText());
        throw error;
      } finally { p.releaseChild(); await context.close(); await p.close(); }
    });
    await t.test('revoke failure blocks handoff until the original registration is confirmed revoked', async () => {
      const p = await peer(); p.failRevoke(true); p.enableQueue();
      const { context, page } = await setup(browser, script, p.url);
      try {
        await page.getByRole('button', { name: '打开侧聊' }).click();
        await page.getByText(/浏览器确认尚未撤销/).waitFor();
        const input = page.getByRole('textbox', { name: '和 Codex 一起工作' }); await input.waitFor();
        await page.getByRole('button', { name: '删除待发送消息' }).first().waitFor();
        await input.fill('撤权失败时保留的草稿');
        assert.equal(await page.evaluate(() => window.sideChatWorkspaceFixture.freezeNavigation()), true);
        assert.equal(await page.evaluate(() => window.sideChatWorkspaceFixture.flushNavigation()), true);
        await assert.rejects(page.evaluate(() => window.sideChatWorkspaceFixture.revokeNavigation()), /revoke reply lost/);
        await assert.rejects(page.evaluate(() => window.sideChatWorkspaceFixture.releaseNavigation()), /撤权尚未确认/);
        assert.equal(await page.evaluate(() => window.sideChatWorkspaceFixture.frozen), true);
        assert.equal((await page.evaluate(() => window.sideChatWorkspaceFixture.association()))?.childThreadId, 'child-a');
        p.failRevoke(false);
        await page.evaluate(() => window.sideChatWorkspaceFixture.revokeNavigation());
        await page.evaluate(() => window.sideChatWorkspaceFixture.releaseNavigation());
        assert.equal(await page.evaluate(() => window.sideChatWorkspaceFixture.frozen), false);
      } catch (error) {
        console.error('revoke diagnostic', p.order, JSON.stringify(await page.evaluate(async () => ({
          frozen: window.sideChatWorkspaceFixture.frozen, association: await window.sideChatWorkspaceFixture.association(),
          history: window.sideChatWorkspaceFixture.history(),
        }))), await page.locator('body').innerText());
        throw error;
      } finally { await context.close(); await p.close(); }
    });
    await t.test('a close click cannot release an existing navigation freeze', async () => {
      const p = await peer(), { context, page } = await setup(browser, script, p.url);
      try {
        await page.getByRole('button', { name: '打开侧聊' }).click();
        const input = page.getByRole('textbox', { name: '和 Codex 一起工作' }); await input.waitFor();
        await page.waitForFunction(() => window.sideChatWorkspaceFixture.history().canSubmit);
        await input.fill('原导航草稿');
        await page.getByRole('button', { name: '发送', exact: true }).waitFor({ state: 'visible' });
        assert.equal(await page.evaluate(() => window.sideChatWorkspaceFixture.freezeNavigation()), true);
        await page.getByRole('button', { name: '关闭侧聊' }).click();
        await page.getByText(/原侧聊关闭身份已改变/).waitFor();
        assert.equal(await page.evaluate(() => window.sideChatWorkspaceFixture.frozen), true);
        assert.equal(await input.inputValue(), '原导航草稿');
        assert.equal(p.fake.calls('thread/unsubscribe').length, 0);
        assert.equal(await page.evaluate(() => window.sideChatWorkspaceFixture.flushNavigation()), true);
        await page.evaluate(() => window.sideChatWorkspaceFixture.revokeNavigation());
        await page.evaluate(() => window.sideChatWorkspaceFixture.releaseNavigation());
        assert.equal(await page.evaluate(() => window.sideChatWorkspaceFixture.frozen), false);
      } finally { await context.close(); await p.close(); }
    });
    await t.test('navigation waits for the original prepare and its persisted draft association', async () => {
      const p = await peer(); p.holdPrepare();
      const { context, page } = await setup(browser, script, p.url);
      try {
        await page.getByRole('button', { name: '打开侧聊' }).click(); await eventually(p.prepareWaiting);
        assert.equal(await page.evaluate(() => window.sideChatWorkspaceFixture.freezeNavigation()), true);
        assert.equal(await page.evaluate(() => window.sideChatWorkspaceFixture.flushNavigation()), true);
        await assert.rejects(page.evaluate(() => window.sideChatWorkspaceFixture.revokeNavigation()), /尚未确定终结/);
        p.releasePrepare();
        await page.getByText(/上一次宿主调用尚未确认/).waitFor();
        assert.ok((await page.evaluate(() => window.sideChatWorkspaceFixture.association()))?.operationId);
        assert.equal(p.fake.calls('thread/fork').length, 0);
        await page.evaluate(() => window.sideChatWorkspaceFixture.revokeNavigation());
        await page.evaluate(() => window.sideChatWorkspaceFixture.releaseNavigation());
      } finally { p.releasePrepare(); await context.close(); await p.close(); }
    });
    await t.test('navigation freezes an authorization waiting before fork and requires its revocation', async () => {
      const p = await peer(); p.holdChallenge();
      const { context, page } = await setup(browser, script, p.url);
      try {
        await page.getByRole('button', { name: '打开侧聊' }).click(); await eventually(p.challengeWaiting);
        assert.equal(await page.evaluate(() => window.sideChatWorkspaceFixture.freezeNavigation()), true);
        assert.equal(await page.evaluate(() => window.sideChatWorkspaceFixture.flushNavigation()), true);
        await assert.rejects(page.evaluate(() => window.sideChatWorkspaceFixture.revokeNavigation()), /尚未确定终结/);
        p.releaseChallenge();
        await page.getByText(/宿主调用尚未派发/).waitFor();
        assert.equal(p.fake.calls('thread/fork').length, 0);
        await page.evaluate(() => window.sideChatWorkspaceFixture.revokeNavigation());
        await page.evaluate(() => window.sideChatWorkspaceFixture.releaseNavigation());
      } finally { p.releaseChallenge(); await context.close(); await p.close(); }
    });
    await t.test('only the child approval is displayed and close drains its original reply', async () => {
      const p = await peer(), { context, page } = await setup(browser, script, p.url);
      try {
        await page.getByRole('button', { name: '打开侧聊' }).click();
        await page.getByRole('textbox', { name: '和 Codex 一起工作' }).waitFor();
        p.requestApproval('parent-a', 'parent-approval');
        await page.waitForFunction(() => window.sideChatWorkspaceFixture.approvalCount() === 1);
        assert.equal(await page.getByRole('dialog').count(), 0);
        p.holdApproval(); p.requestApproval('child-a', 'child-approval');
        const dialog = page.getByRole('dialog'); await dialog.waitFor();
        await dialog.getByRole('button', { name: 'Approve', exact: true }).click();
        await eventually(p.approvalWaiting);
        assert.equal(p.approvalReplies.length, 1);
        assert.equal(p.approvalReplies[0]?.generation, 'approval-generation');
        assert.equal(p.approvalReplies[0]?.response.id, 'child-approval');
        await page.getByRole('button', { name: '关闭侧聊' }).click();
        assert.equal(await page.evaluate(() => window.sideChatWorkspaceFixture.frozen), true);
        assert.equal(p.order.includes('close'), false);
        p.releaseApproval();
        await page.waitForFunction(() => window.sideChatWorkspaceFixture.closed === 1);
        assert.equal(p.fake.calls('thread/unsubscribe').length, 1);
      } finally { p.releaseApproval(); await context.close(); await p.close(); }
    });
    await t.test('original connection loss keeps the mounted draft and prevents handoff or sending', async () => {
      const p = await peer(), { context, page } = await setup(browser, script, p.url);
      try {
        await page.getByRole('button', { name: '打开侧聊' }).click();
        const input = page.getByRole('textbox', { name: '和 Codex 一起工作' }); await input.waitFor();
        await input.fill('保留的临时草稿');
        await page.evaluate(() => window.sideChatWorkspaceFixture.disconnect());
        assert.equal(await page.evaluate(() => window.sideChatWorkspaceFixture.freezeNavigation()), false);
        assert.equal(await input.inputValue(), '保留的临时草稿');
        assert.equal(p.fake.calls('turn/start').length, 0);
        assert.equal((await page.evaluate(() => window.sideChatWorkspaceFixture.association()))?.childThreadId, 'child-a');
      } finally { await context.close(); await p.close(); }
    });
    await t.test('the real shared sender sends the captured draft to the ephemeral child', async () => {
      const p = await peer(), { context, page } = await setup(browser, script, p.url);
      try {
        await page.getByRole('button', { name: '打开侧聊' }).click();
        const input = page.getByRole('textbox', { name: '和 Codex 一起工作' }); await input.waitFor();
        await page.waitForFunction(() => window.sideChatWorkspaceFixture.history().canSubmit);
        await input.fill('synthetic side-chat message');
        await page.getByRole('button', { name: '发送', exact: true }).click();
        await eventually(() => p.fake.calls('turn/start').length === 1);
        assert.equal(p.fake.calls('turn/start')[0]!.params.threadId, 'child-a');
        assert.ok((await page.evaluate(() => window.sideChatWorkspaceFixture.authorityDispatches()))
          .some(item => item.method === 'turn/start' && item.original));
        assert.equal(p.fake.calls('thread/start').length, 1);
      } finally { await context.close(); await p.close(); }
    });
    await t.test('queue deletion goes through the original scoped dispatcher', async () => {
      const p = await peer(); p.enableQueue();
      const { context, page } = await setup(browser, script, p.url);
      try {
        await page.getByRole('button', { name: '打开侧聊' }).click();
        await page.getByRole('textbox', { name: '和 Codex 一起工作' }).waitFor();
        const button = page.getByRole('button', { name: '删除待发送消息' }).first();
        await button.waitFor(); await button.click();
        await eventually(() => p.fake.calls('thread/queue/delete').length === 1);
        assert.deepEqual(await page.evaluate(() => window.sideChatWorkspaceFixture.queueDispatches()),
          [{ method: 'thread/queue/delete', hostId: 'local', threadId: 'child-a' }]);
        assert.equal(p.fake.calls('thread/queue/delete')[0]!.params.queuedSubmissionId, 'queue-a');
        assert.ok((await page.evaluate(() => window.sideChatWorkspaceFixture.authorityDispatches()))
          .some(item => item.method === 'thread/queue/delete' && item.original));
        assert.deepEqual(p.queue().map(item => item.id), ['queue-b']);
      } finally { await context.close(); await p.close(); }
    });
    await t.test('queue start accepts the original captured authority through the shared composer wrapper', async () => {
      const p = await peer(); p.enableQueue();
      const { context, page } = await setup(browser, script, p.url);
      try {
        await page.getByRole('button', { name: '打开侧聊' }).click();
        await page.getByRole('textbox', { name: '和 Codex 一起工作' }).waitFor();
        await page.waitForFunction(() => window.sideChatWorkspaceFixture.history().canSubmit);
        const start = page.getByRole('button', { name: '立即发送待发送消息' }).first(); await start.waitFor(); await start.click();
        await eventually(() => p.fake.calls('thread/queue/start').length === 1);
        assert.equal(p.fake.calls('thread/queue/start')[0]!.params.threadId, 'child-a');
        assert.equal(p.fake.calls('thread/queue/start')[0]!.params.queuedSubmissionId, 'queue-a');
        assert.ok((await page.evaluate(() => window.sideChatWorkspaceFixture.authorityDispatches()))
          .some(item => item.method === 'thread/queue/start' && item.original));
        assert.deepEqual(p.queue().map(item => item.id), ['queue-b']);
      } finally { await context.close(); await p.close(); }
    });
    await t.test('queue mutation waiting at the original dispatcher does not cross a disconnect', async () => {
      const p = await peer(); p.enableQueue();
      const { context, page } = await setup(browser, script, p.url);
      try {
        await page.getByRole('button', { name: '打开侧聊' }).click();
        await page.getByRole('textbox', { name: '和 Codex 一起工作' }).waitFor();
        await page.evaluate(() => window.sideChatWorkspaceFixture.holdDispatch());
        const button = page.getByRole('button', { name: '删除待发送消息' }).first(); await button.waitFor(); await button.click();
        await page.waitForFunction(() => window.sideChatWorkspaceFixture.dispatchWaiting());
        await page.evaluate(() => { window.sideChatWorkspaceFixture.disconnect(); window.sideChatWorkspaceFixture.releaseDispatch(); });
        await page.waitForFunction(() => !window.sideChatWorkspaceFixture.dispatchWaiting());
        assert.equal(p.fake.calls('thread/queue/delete').length, 0);
        assert.deepEqual(p.queue().map(item => item.id), ['queue-a', 'queue-b']);
      } finally { await context.close(); await p.close(); }
    });
    await t.test('interrupt captures the original child and turn and does not cross a disconnect', async () => {
      const p = await peer(), { context, page } = await setup(browser, script, p.url);
      try {
        await page.getByRole('button', { name: '打开侧聊' }).click();
        const input = page.getByRole('textbox', { name: '和 Codex 一起工作' }); await input.waitFor();
        await page.waitForFunction(() => window.sideChatWorkspaceFixture.history().canSubmit);
        await input.fill('synthetic side-chat turn'); await page.getByRole('button', { name: '发送', exact: true }).click();
        const stop = page.getByRole('button', { name: '停止', exact: true }); await stop.waitFor();
        await page.evaluate(() => window.sideChatWorkspaceFixture.holdDispatch()); await stop.click();
        await page.waitForFunction(() => window.sideChatWorkspaceFixture.dispatchWaiting());
        assert.deepEqual(await page.evaluate(() => window.sideChatWorkspaceFixture.interrupts()),
          [{ threadId: 'child-a', turnId: 'fixture-turn-1' }]);
        assert.ok((await page.evaluate(() => window.sideChatWorkspaceFixture.authorityDispatches()))
          .some(item => item.method === 'turn/interrupt' && item.original));
        await page.evaluate(() => { window.sideChatWorkspaceFixture.disconnect(); window.sideChatWorkspaceFixture.releaseDispatch(); });
        await page.waitForFunction(() => !window.sideChatWorkspaceFixture.dispatchWaiting());
        assert.equal(p.fake.calls('turn/interrupt').length, 0);
      } finally { await context.close(); await p.close(); }
    });
  } finally { await browser.close(); }
});
