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
  let failRevoke = false, lostConfirm = 0, lostPersistence = 0, lostPrepare = 0, readPrepared = 0, generation = 'generation-a', section: any, terminalStarts = 0;
  let holdPrepare = false, deliverPrepare: (() => void) | null = null;
  let holdChallenge = false, deliverChallenge: (() => void) | null = null;
  let holdApproval = false, deliverApproval: (() => void) | null = null;
  const pendingQueueReads: (() => void)[] = [];
  const queue = [
    { id: 'queue-a', clientUserMessageId: 'client-a', input: [{ type: 'text', text: 'synthetic queue A', text_elements: [] }] },
    { id: 'queue-b', clientUserMessageId: 'client-b', input: [{ type: 'text', text: 'synthetic queue B', text_elements: [] }] },
  ];
  const approvalReplies: Message[] = [];
  const order: string[] = [], reads: { purpose: string; token: unknown }[] = [], dispatches: Message[] = [], nativeWrites: Message[] = [];
  const authorityActions: string[] = [], queueEdits: Message[] = [], approvalInterrupts: Message[] = [];
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
          const provider = authority as typeof authority & { captureChildWrite?(page: WebSocket, value: unknown): unknown };
          const guard = parent as typeof parent & { assertChildWrite?(hostId: string, threadId: string, proof: unknown): void };
          const write = /^(turn\/(start|steer|interrupt)|thread\/queue\/(add|start|delete|reorder|update))$/.test(request.method);
          if (write && (typeof provider.captureChildWrite !== 'function' || typeof guard.assertChildWrite !== 'function')) {
            throw Error('The fixed native child write fence is required.');
          }
          const proof = write ? provider.captureChildWrite!(page, message.sideChat) : undefined;
          const pending = await mutations.run(() => {
            if (write) guard.assertChildWrite!('local', request.params.threadId, proof);
            return { request: connection.requestWithCursor(request.method, request.params) };
          });
          const result = await pending.request;
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
          result = await mutations.run(() => authority.handle(page, body));
          authorityActions.push(body.action);
          if (body.action === 'confirm' && lostConfirm-- > 0) throw Object.assign(new Error('Synthetic confirm reply lost.'), { uncertain: true });
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
          if (body.action === 'inject' || body.action === 'start') {
            const provider = authority as typeof authority & { captureChildWrite?(page: WebSocket, value: unknown): unknown };
            const guard = parent as typeof parent & { assertChildWrite?(hostId: string, threadId: string, proof: unknown): void };
            if (typeof provider.captureChildWrite !== 'function' || typeof guard.assertChildWrite !== 'function') throw Error('The fixed native child write fence is required.');
            const proof = provider.captureChildWrite(page, body.sideChat);
            await mutations.run(() => guard.assertChildWrite!(body.hostId, body.reference.threadId, proof));
          }
          if (body.action === 'inject') {
            injectionStatus = { reference: structuredClone(body.reference), injection: { phase: 'injected', persistentThread: false,
              terminal: { kind: 'injected' } }, turn: { phase: 'waiting', attempts: [] }, pendingPersistence: null };
          } else if (body.action === 'start' && injectionStatus) {
            injectionStatus.turn = { phase: 'accepted', attemptId: body.turnAttemptId, attempts: [body.turnAttemptId],
              connectionGeneration: body.daemonConnectionGeneration,
              terminal: { kind: 'accepted', result: { turn: { id: 'native-turn', items: [], status: 'inProgress' } } } };
          } else if (body.action !== 'status') throw Error('Unexpected synthetic injection action.');
          result = structuredClone(injectionStatus);
        } else if (endpoint === 'queue-edit') {
          queueEdits.push(structuredClone(body));
          const provider = authority as typeof authority & { captureChildWrite?(page: WebSocket, value: unknown): unknown };
          const guard = parent as typeof parent & { assertChildWrite?(hostId: string, threadId: string, proof: unknown): void };
          if (typeof provider.captureChildWrite !== 'function' || typeof guard.assertChildWrite !== 'function') throw Error('The fixed native child write fence is required.');
          const proof = provider.captureChildWrite(page, body.sideChat);
          await mutations.run(() => guard.assertChildWrite!(body.hostId, body.threadId, proof));
          const index = queue.findIndex(item => JSON.stringify(item) === JSON.stringify(body.entry));
          if (index < 0) result = 'changed'; else { queue.splice(index, 1); result = 'deleted'; }
        } else if (endpoint === 'approval-request-interrupt') {
          approvalInterrupts.push(structuredClone(body));
          const provider = authority as typeof authority & { captureChildWrite?(page: WebSocket, value: unknown): unknown };
          const guard = parent as typeof parent & { assertChildWrite?(hostId: string, threadId: string, proof: unknown): void };
          if (typeof provider.captureChildWrite !== 'function' || typeof guard.assertChildWrite !== 'function') throw Error('The fixed native child write fence is required.');
          const proof = provider.captureChildWrite(page, body.sideChat);
          await mutations.run(() => guard.assertChildWrite!(body.hostId, body.threadId, proof));
          result = null;
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
  return { url: `http://127.0.0.1:${address.port}/`, fake, order, reads, dispatches, nativeWrites, authorityActions, queueEdits, approvalReplies, approvalInterrupts, section: () => section,
    holdChild() { holdChild = true; }, releaseChild() { holdChild = false; deliverChild?.(); }, childWaiting: () => !!deliverChild,
    holdFork() { holdFork = true; }, releaseFork() { lateFork?.(); }, forkWaiting: () => !!lateFork,
    holdPrepare() { holdPrepare = true; }, releasePrepare() { holdPrepare = false; deliverPrepare?.(); }, prepareWaiting: () => !!deliverPrepare,
    losePrepare() { lostPrepare = 1; }, preparedReads: () => readPrepared,
    holdUnsubscribe() { fake.handlers.set('thread/unsubscribe', () => NO_REPLY); },
    holdChallenge() { holdChallenge = true; }, releaseChallenge() { holdChallenge = false; deliverChallenge?.(); }, challengeWaiting: () => !!deliverChallenge,
    losePersistence(count: number) { lostPersistence = count; }, failRevoke(value: boolean) { failRevoke = value; },
    loseConfirm() { lostConfirm = 1; },
    holdQueueReads() {
      fake.handlers.set('thread/queue/list', (_params, context) => {
        pendingQueueReads.push(() => context.send({ id: context.message.id,
          error: { code: -32603, message: 'Ephemeral threads do not support queued messages' } }));
        return NO_REPLY;
      });
    },
    queueReadsWaiting: () => pendingQueueReads.length,
    failQueueReads() { fake.handlers.delete('thread/queue/list'); for (const reply of pendingQueueReads.splice(0)) reply(); },
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
    requestInput(threadId: string, id: string) { for (const page of sockets.clients) if (page.readyState === WebSocket.OPEN) {
      page.send(JSON.stringify({ type: 'mcp-request', hostId: 'local', requestRef: { hostId: 'local', generation: 'approval-generation', id },
        request: { id, method: 'item/tool/requestUserInput', params: { threadId, turnId: 'fixture-turn-1',
          questions: [{ id: 'q', question: 'Original child question', options: null }] } } }));
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

test('SideChatRoot cancel owner lease', { timeout: 100_000 }, async t => {
  const bundle = await build({ entryPoints: ['test/renderer-side-chat-root-fixture.tsx'], bundle: true, write: false,
    format: 'iife', loader: { '.css': 'empty' } });
  const browser = await chromium.launch({ executablePath: process.env.YARD_VALIDATION_CHROME_BIN || '/usr/bin/google-chrome',
    headless: true, args: ['--no-sandbox', '--disable-background-networking'] });
  const setupCancel = async (injected = false) => {
    const p = await peer(), { context, page } = await setupRoot(browser, bundle.outputFiles[0]!.text, p.url);
    const identity = await page.evaluate(() => window.sideChatRootFixture.open());
    const input = page.getByRole('textbox', { name: '和 Codex 一起工作' }); await input.waitFor();
    await page.waitForFunction(() => window.sideChatRootFixture.history().canSubmit && window.sideChatRootFixture.canAcquireDraft());
    await input.fill('original retained draft');
    await page.waitForFunction(() => window.sideChatRootFixture.child()?.snapshot.draft.text === 'original retained draft');
    assert.equal(await page.evaluate(() => window.sideChatRootFixture.flushDraft()), true);
    const intent = await page.evaluate(value => window.sideChatRootFixture.prepareSend(value), injected);
    await page.getByRole('button', { name: 'Keep draft and cancel send' }).waitFor();
    return { p, context, page, identity, intent };
  };
  try {
    await t.test('an explicit original send retry carries the live child proof and original message identity', async () => {
      const { p, context, page, identity, intent } = await setupCancel();
      try {
        await page.getByRole('button', { name: 'Retry original send' }).click();
        await eventually(() => p.fake.calls('turn/start').length === 1);
        const turn = p.dispatches.find(item => item.request.method === 'turn/start');
        assert.equal(turn?.request.params.clientUserMessageId, intent.clientUserMessageId);
        assert.equal(turn?.request.params.threadId, 'child-a');
        assert.equal(turn?.sideChat.identity.draftId, identity.draftId);
        assert.ok(turn?.sideChat.challengeId);
        assert.equal(turn?.daemonConnectionGeneration, 'generation-a');
      } finally { await context.close(); await p.close(); }
    });
    await t.test('drains original draft and sender without waiting on its own cancellation', async () => {
      const { p, context, page, identity, intent } = await setupCancel();
      try {
        const sendButton = await page.getByRole('button', { name: '发送', exact: true }).elementHandle();
        assert.equal(await page.evaluate(() => window.sideChatRootFixture.holdDraftOperation()), true);
        await page.evaluate(() => window.sideChatRootFixture.holdOwnerWork());
        await page.getByRole('button', { name: 'Keep draft and cancel send' }).click();
        await page.waitForFunction(id => !window.sideChatRootFixture.canAttachOwner(id), identity.draftId);
        assert.equal(await page.evaluate(() => window.sideChatRootFixture.canAcquireDraft()), false);
        assert.equal(await page.evaluate(() => window.sideChatRootFixture.updateDraftWhileFrozen()), false);
        assert.equal(await page.evaluate(() => window.sideChatRootFixture.freezeNavigation()), false);
        await sendButton!.dispatchEvent('click');
        assert.equal(p.fake.calls('turn/start').length, 0);
        assert.ok((await page.evaluate(() => window.sideChatRootFixture.sends())).requests[intent.id]);
        await page.evaluate(() => window.sideChatRootFixture.releaseDraftOperation());
        await page.waitForTimeout(80);
        assert.ok((await page.evaluate(() => window.sideChatRootFixture.sends())).requests[intent.id]);
        await page.evaluate(() => window.sideChatRootFixture.releaseOwnerWork());
        await page.waitForFunction(async id => !(await window.sideChatRootFixture.sends()).requests[id], intent.id);
        await page.waitForFunction(id => window.sideChatRootFixture.canAttachOwner(id) && window.sideChatRootFixture.canAcquireDraft(), identity.draftId);
        assert.equal((await page.evaluate(() => window.sideChatRootFixture.child()))?.snapshot.draft.text, 'original retained draft');
        await page.getByRole('button', { name: '发送', exact: true }).click();
        await eventually(() => p.fake.calls('turn/start').length === 1);
      } finally {
        await page.evaluate(() => { window.sideChatRootFixture.releaseDraftOperation(); window.sideChatRootFixture.releaseOwnerWork(); });
        await context.close(); await p.close();
      }
    });
    await t.test('drains a real in-flight shared sender and preserves its changed receipt', async () => {
      const p = await peer(), { context, page } = await setupRoot(browser, bundle.outputFiles[0]!.text, p.url);
      try {
        const identity = await page.evaluate(() => window.sideChatRootFixture.open());
        const input = page.getByRole('textbox', { name: '和 Codex 一起工作' }); await input.waitFor();
        await page.waitForFunction(() => window.sideChatRootFixture.history().canSubmit && window.sideChatRootFixture.canAcquireDraft());
        await input.fill('in-flight original draft');
        await page.waitForFunction(() => window.sideChatRootFixture.child()?.snapshot.draft.text === 'in-flight original draft');
        assert.equal(await page.evaluate(() => window.sideChatRootFixture.flushDraft()), true);
        await page.evaluate(() => window.sideChatRootFixture.holdCollaboration());
        await page.getByRole('button', { name: '发送', exact: true }).click();
        await page.waitForFunction(() => window.sideChatRootFixture.collaborationWaiting());
        await page.getByRole('button', { name: 'Keep draft and cancel send' }).click();
        await page.waitForFunction(id => !window.sideChatRootFixture.canAttachOwner(id), identity.draftId);
        assert.equal(p.fake.calls('turn/start').length, 0);
        await page.evaluate(() => window.sideChatRootFixture.releaseCollaboration());
        await page.waitForFunction(id => window.sideChatRootFixture.canAttachOwner(id), identity.draftId);
        const requests = Object.values((await page.evaluate(() => window.sideChatRootFixture.sends())).requests);
        assert.equal(requests.length, 1); assert.equal(requests[0]?.stage, 'failed');
        assert.equal((await page.evaluate(() => window.sideChatRootFixture.child()))?.snapshot.draft.text, 'in-flight original draft');
        assert.equal(p.fake.calls('turn/start').length, 0); assert.equal(p.nativeWrites.length, 0);
      } finally { await page.evaluate(() => window.sideChatRootFixture.releaseCollaboration()); await context.close(); await p.close(); }
    });
    await t.test('a change to the clicked intent while draining preserves the newer IDB record', async () => {
      const { p, context, page, identity, intent } = await setupCancel();
      try {
        await page.evaluate(() => window.sideChatRootFixture.holdOwnerWork());
        await page.getByRole('button', { name: 'Keep draft and cancel send' }).click();
        await page.waitForFunction(id => !window.sideChatRootFixture.canAttachOwner(id), identity.draftId);
        await page.evaluate(id => window.sideChatRootFixture.changeIntentModel(id), intent.id);
        await page.evaluate(() => window.sideChatRootFixture.releaseOwnerWork());
        await page.getByText('原发送记录已改变，请重新读取核对。').waitFor();
        const current = (await page.evaluate(() => window.sideChatRootFixture.sends())).requests[intent.id];
        assert.equal(current?.options.model, 'changed-model'); assert.equal(current?.attemptId, intent.attemptId);
        await page.waitForFunction(() => window.sideChatRootFixture.canAcquireDraft());
        assert.equal(p.fake.calls('turn/start').length, 0);
      } finally { await page.evaluate(() => window.sideChatRootFixture.releaseOwnerWork()); await context.close(); await p.close(); }
    });
    await t.test('the original child cannot be switched away and back during cancellation', async () => {
      const { p, context, page, identity, intent } = await setupCancel();
      try {
        const second = await page.evaluate(() => window.sideChatRootFixture.open());
        await page.waitForFunction(id => window.sideChatRootFixture.child()?.identity.draftId === id, second.draftId);
        await page.getByRole('textbox', { name: '和 Codex 一起工作' }).waitFor();
        await page.waitForFunction(() => window.sideChatRootFixture.canAcquireDraft());
        await page.waitForFunction(() => !!window.sideChatRootFixture.child()?.hasNavigation);
        try { await page.evaluate(id => window.sideChatRootFixture.show(id), identity.draftId); }
        catch (error) { throw new Error('Switch back failed: ' + await page.locator('body').innerText(), { cause: error }); }
        await page.getByRole('button', { name: 'Keep draft and cancel send' }).waitFor();
        await page.evaluate(() => window.sideChatRootFixture.holdOwnerWork());
        await page.getByRole('button', { name: 'Keep draft and cancel send' }).click();
        await page.waitForFunction(id => !window.sideChatRootFixture.canAttachOwner(id), identity.draftId);
        assert.equal(await page.getByRole('button', { name: '侧聊 2' }).isDisabled(), true);
        assert.equal(await page.evaluate(id => { try { window.sideChatRootFixture.show(id); return false; } catch { return true; } }, second.draftId), true);
        assert.equal(await page.evaluate(() => { try { window.sideChatRootFixture.open(); return false; } catch { return true; } }), true);
        assert.equal(await page.evaluate(async value => { try { await window.sideChatRootFixture.restore(value); return false; } catch { return true; } }, second), true);
        assert.equal((await page.evaluate(() => window.sideChatRootFixture.child()))?.identity.draftId, identity.draftId);
        assert.ok((await page.evaluate(() => window.sideChatRootFixture.sends())).requests[intent.id]);
        await page.evaluate(() => window.sideChatRootFixture.releaseOwnerWork());
        await page.waitForFunction(async id => !(await window.sideChatRootFixture.sends()).requests[id], intent.id);
        await page.waitForFunction(id => window.sideChatRootFixture.canAttachOwner(id), identity.draftId);
        await page.evaluate(id => window.sideChatRootFixture.show(id), second.draftId);
        assert.equal((await page.evaluate(() => window.sideChatRootFixture.child()))?.identity.draftId, second.draftId);
      } finally { await page.evaluate(() => window.sideChatRootFixture.releaseOwnerWork()); await context.close(); await p.close(); }
    });
    await t.test('the original grant is checked inside the queued IndexedDB cancellation transaction', async () => {
      const { p, context, page, identity, intent } = await setupCancel();
      const writer = await context.newPage();
      try {
        await writer.goto(p.url);
        await page.evaluate(() => window.sideChatRootFixture.holdCancel());
        await page.getByRole('button', { name: 'Keep draft and cancel send' }).click();
        await page.waitForFunction(() => window.sideChatRootFixture.cancelWaiting());
        await writer.evaluate(async () => {
          const w = window as any;
          let release = false;
          w.releaseWriter = () => { release = true; };
          await new Promise<void>((resolve, reject) => {
            const open = indexedDB.open('codex-yard.ui-atoms.v1', 1);
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
              const db = open.result, tx = db.transaction('atoms', 'readwrite'), atoms = tx.objectStore('atoms');
              let started = false;
              w.writerDone = new Promise<void>((done, fail) => { tx.oncomplete = () => { db.close(); done(); }; tx.onabort = () => fail(tx.error); });
              const pump = () => {
                const request = atoms.get('native-atoms');
                request.onerror = () => reject(request.error);
                request.onsuccess = () => { if (!started) { started = true; resolve(); } if (!release) pump(); };
              };
              pump();
            };
          });
        });
        await page.evaluate(() => window.sideChatRootFixture.releaseCancel());
        await page.waitForTimeout(80);
        assert.equal(await page.evaluate(() => window.sideChatRootFixture.cancelGuardCalls()), 0);
        assert.equal(await page.evaluate(id => window.sideChatRootFixture.canAttachOwner(id), identity.draftId), false);
        await page.evaluate(() => window.sideChatRootFixture.changeParent());
        await writer.evaluate(async () => { const w = window as any; w.releaseWriter(); await w.writerDone; });
        await page.waitForFunction(id => window.sideChatRootFixture.canAttachOwner(id), identity.draftId);
        assert.equal(await page.evaluate(() => window.sideChatRootFixture.cancelGuardCalls()), 1);
        assert.deepEqual((await page.evaluate(() => window.sideChatRootFixture.sends())).requests[intent.id], intent);
        assert.equal(p.fake.calls('turn/start').length, 0);
      } finally {
        await page.evaluate(() => window.sideChatRootFixture.releaseCancel());
        await writer.evaluate(() => (window as any).releaseWriter?.()).catch(() => {});
        await context.close(); await p.close();
      }
    });
    for (const mode of ['unknown', 'native-pending'] as const) await t.test(`retains ${mode} observed during the drain`, async () => {
      const { p, context, page, identity, intent } = await setupCancel(mode === 'native-pending');
      try {
        await page.evaluate(() => window.sideChatRootFixture.holdOwnerWork());
        await page.getByRole('button', { name: 'Keep draft and cancel send' }).click();
        await page.waitForFunction(id => !window.sideChatRootFixture.canAttachOwner(id), identity.draftId);
        if (mode === 'unknown') await page.evaluate(({ id, attempt }) => window.sideChatRootFixture.markUnknown(id, attempt),
          { id: intent.id, attempt: intent.attemptId! });
        else await page.evaluate(id => window.sideChatRootFixture.markNativePending(id), intent.id);
        await page.evaluate(() => window.sideChatRootFixture.releaseOwnerWork());
        await page.getByText('原发送记录已改变，请重新读取核对。').waitFor();
        const current = (await page.evaluate(() => window.sideChatRootFixture.sends())).requests[intent.id];
        assert.equal(current?.stage, 'unknown');
        if (mode === 'native-pending') assert.equal(current?.injection?.native?.status?.pendingPersistence?.step, 'injection');
        assert.equal(p.fake.calls('turn/start').length, 0); assert.equal(p.nativeWrites.length, 0);
      } finally { await page.evaluate(() => window.sideChatRootFixture.releaseOwnerWork()); await context.close(); await p.close(); }
    });
    for (const mode of ['parent', 'connection'] as const) await t.test(`original ${mode} revocation cannot cancel`, async () => {
      const { p, context, page, identity, intent } = await setupCancel();
      try {
        await page.evaluate(() => window.sideChatRootFixture.holdOwnerWork());
        await page.getByRole('button', { name: 'Keep draft and cancel send' }).click();
        await page.waitForFunction(id => !window.sideChatRootFixture.canAttachOwner(id), identity.draftId);
        if (mode === 'parent') await page.evaluate(() => window.sideChatRootFixture.changeParent());
        else { p.signalGeneration(); await page.waitForFunction(() => window.sideChatRootFixture.generation() === 'generation-b'); }
        await page.evaluate(() => window.sideChatRootFixture.releaseOwnerWork());
        await page.waitForFunction(id => window.sideChatRootFixture.canAttachOwner(id), identity.draftId);
        assert.deepEqual((await page.evaluate(() => window.sideChatRootFixture.sends())).requests[intent.id], intent);
        assert.equal(p.fake.calls('turn/start').length, 0);
      } finally { await page.evaluate(() => window.sideChatRootFixture.releaseOwnerWork()); await context.close(); await p.close(); }
    });
    await t.test('a completed cancellation leaves the original close drain intact', async () => {
      const { p, context, page, intent } = await setupCancel();
      try {
        await page.getByRole('button', { name: 'Keep draft and cancel send' }).click();
        await page.waitForFunction(async id => !(await window.sideChatRootFixture.sends()).requests[id], intent.id);
        await page.waitForFunction(() => window.sideChatRootFixture.canAcquireDraft());
        assert.equal(await page.evaluate(() => window.sideChatRootFixture.holdDraftOperation()), true);
        await page.getByRole('button', { name: '关闭侧聊' }).click();
        assert.equal(await page.evaluate(() => window.sideChatRootFixture.canAcquireDraft()), false);
        assert.equal(p.order.includes('close'), false); assert.equal(p.fake.calls('thread/unsubscribe').length, 0);
        await page.evaluate(() => window.sideChatRootFixture.releaseDraftOperation());
        await page.waitForFunction(() => window.sideChatRootFixture.closed === 1);
        assert.equal(p.fake.calls('thread/unsubscribe').length, 1);
      } finally { await page.evaluate(() => window.sideChatRootFixture.releaseDraftOperation()); await context.close(); await p.close(); }
    });
    await t.test('a pending send still prevents the original close', async () => {
      const { p, context, page, intent } = await setupCancel();
      try {
        await page.evaluate(({ id, attempt }) => window.sideChatRootFixture.markUnknown(id, attempt), { id: intent.id, attempt: intent.attemptId! });
        await page.getByRole('button', { name: '关闭侧聊' }).click();
        await page.getByText(/侧聊草稿或发送结果尚未确认/).waitFor();
        assert.equal((await page.evaluate(() => window.sideChatRootFixture.sends())).requests[intent.id]?.stage, 'unknown');
        assert.equal(p.fake.calls('thread/unsubscribe').length, 0); assert.equal(p.order.includes('close'), false);
      } finally { await context.close(); await p.close(); }
    });
  } finally { await browser.close(); }
});

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
        const proofs = await page.evaluate(() => window.sideChatRootFixture.rpcProofs());
        const turnProof = proofs.find(item => item.method === 'turn/start')?.proof;
        const interruptProof = proofs.find(item => item.method === 'turn/interrupt')?.proof;
        assert.ok(turnProof?.challengeId); assert.deepEqual(interruptProof, turnProof);
        assert.equal(turnProof.identity.childThreadId, 'child-a'); assert.equal(turnProof.identity.draftId, identity.draftId);
        assert.equal(turnProof.identity.prepareId, identity.prepareId); assert.equal(turnProof.identity.connectionGeneration, 'generation-a');
        assert.deepEqual(turn?.sideChat, turnProof); assert.deepEqual(stop?.sideChat, interruptProof);
        assert.equal(p.fake.calls('thread/fork').length, 1);
      } finally { await context.close(); await p.close(); }
    });
    await t.test('queue and steer carry the current child challenge on the real sender', async () => {
      const p = await peer(), { context, page } = await setupRoot(browser, script, p.url);
      try {
        const identity = await page.evaluate(() => window.sideChatRootFixture.open());
        const input = page.getByRole('textbox', { name: '和 Codex 一起工作' }); await input.waitFor();
        await page.waitForFunction(() => window.sideChatRootFixture.history().canSubmit && window.sideChatRootFixture.canAcquireDraft());
        await input.fill('start original turn');
        await page.getByRole('button', { name: '发送', exact: true }).click();
        await page.getByRole('button', { name: '停止', exact: true }).waitFor();
        await input.fill('queue original input');
        await page.getByRole('button', { name: '排队', exact: true }).click();
        await eventually(() => p.fake.calls('thread/queue/add').length === 1);
        await page.getByText(/Ephemeral threads do not support queued messages/).first().waitFor();
        assert.equal((await page.evaluate(() => window.sideChatRootFixture.child()))?.snapshot.draft.text, 'queue original input');
        assert.ok(Object.values((await page.evaluate(() => window.sideChatRootFixture.sends())).requests)
          .some(intent => intent.action?.type === 'queue' && intent.stage === 'failed'));
        await page.getByRole('button', { name: 'Keep draft and cancel send' }).click();
        await page.waitForFunction(async () => !Object.values((await window.sideChatRootFixture.sends()).requests)
          .some(intent => intent.action?.type === 'queue'));
        await page.waitForFunction(() => window.sideChatRootFixture.canAcquireDraft());
        await input.fill('steer original turn');
        await page.getByRole('button', { name: '发送到当前任务', exact: true }).click();
        await eventually(() => p.fake.calls('turn/steer').length === 1);
        const messages = p.dispatches.filter(item => ['turn/start', 'thread/queue/add', 'turn/steer'].includes(item.request.method));
        assert.deepEqual(messages.map(item => item.request.method), ['turn/start', 'thread/queue/add', 'turn/steer']);
        assert.equal(messages[0]?.sideChat.identity.draftId, identity.draftId);
        assert.ok(messages[0]?.sideChat.challengeId);
        assert.deepEqual(messages[1]?.sideChat, messages[0]?.sideChat);
        assert.deepEqual(messages[2]?.sideChat, messages[0]?.sideChat);
        assert.ok(messages.every(item => item.daemonConnectionGeneration === 'generation-a'));
      } finally { await context.close(); await p.close(); }
    });
    await t.test('approval input escape carries the original child proof to the host body', async () => {
      const p = await peer(), { context, page } = await setupRoot(browser, script, p.url);
      try {
        await page.evaluate(() => window.sideChatRootFixture.open());
        const input = page.getByRole('textbox', { name: '和 Codex 一起工作' }); await input.waitFor();
        await page.waitForFunction(() => window.sideChatRootFixture.history().canSubmit);
        await input.fill('start original turn');
        await page.getByRole('button', { name: '发送', exact: true }).click();
        await page.getByRole('button', { name: '停止', exact: true }).waitFor();
        p.requestInput('child-a', 'input-request');
        const dialog = page.getByRole('dialog'); await dialog.waitFor();
        await dialog.press('Escape');
        await eventually(() => p.approvalInterrupts.length === 1);
        const body = p.approvalInterrupts[0]!, turn = p.dispatches.find(item => item.request.method === 'turn/start');
        assert.deepEqual(body.sideChat, turn?.sideChat);
        assert.equal(body.daemonConnectionGeneration, 'generation-a');
        assert.equal(body.ref.id, 'input-request'); assert.equal(body.threadId, 'child-a');
        assert.equal(body.turnId, 'fixture-turn-1');
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
      const p = await peer(); p.enableQueue();
      const { context, page } = await setupRoot(browser, script, p.url);
      try {
        await page.evaluate(() => window.sideChatRootFixture.open());
        const input = page.getByRole('textbox', { name: '和 Codex 一起工作' }); await input.waitFor();
        await page.waitForFunction(() => window.sideChatRootFixture.history().canSubmit);
        await page.getByRole('button', { name: '删除待发送消息' }).first().click();
        await eventually(() => p.fake.calls('thread/queue/delete').length === 1);
        const captured = (await page.evaluate(() => window.sideChatRootFixture.rpcProofs()))[0]!;
        p.failRevoke(true);
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
        assert.equal((await page.evaluate(() => window.sideChatRootFixture.history())).liveReady, true);
        assert.equal(await page.evaluate(() => window.sideChatRootFixture.capturedGuardValid(0)), false);
        p.failRevoke(false);
        await page.evaluate(() => window.sideChatRootFixture.revokeNavigation());
        await page.evaluate(() => window.sideChatRootFixture.releaseNavigation());
        await page.waitForFunction(() => window.sideChatRootFixture.canAcquireDraft());
        await eventually(() => p.authorityActions.filter(action => action === 'confirm').length === 2);
        await page.getByRole('button', { name: '删除待发送消息' }).first().click();
        await eventually(() => p.fake.calls('thread/queue/delete').length === 2);
        const restored = (await page.evaluate(() => window.sideChatRootFixture.rpcProofs()))[1]!;
        assert.deepEqual(restored.proof.identity, captured.proof.identity);
        assert.notEqual(restored.proof.challengeId, captured.proof.challengeId);
        assert.equal(await page.evaluate(() => window.sideChatRootFixture.capturedGuardValid(0)), false);
      } finally { await context.close(); await p.close(); }
    });
    await t.test('an unknown reauthorization revoke retains the sender lease until explicit recovery', async () => {
      const p = await peer(); p.enableQueue();
      const { context, page } = await setupRoot(browser, script, p.url);
      try {
        await page.evaluate(() => window.sideChatRootFixture.open());
        const input = page.getByRole('textbox', { name: '和 Codex 一起工作' }); await input.waitFor();
        await page.waitForFunction(() => window.sideChatRootFixture.history().canSubmit && window.sideChatRootFixture.canAcquireDraft());
        await input.fill('retained during uncertain reauthorization');
        assert.equal(await page.evaluate(() => window.sideChatRootFixture.flushDraft()), true);
        assert.equal(await page.evaluate(() => window.sideChatRootFixture.freezeNavigation()), true);
        assert.equal(await page.evaluate(() => window.sideChatRootFixture.flushNavigation()), true);
        await page.evaluate(() => window.sideChatRootFixture.revokeNavigation());
        p.loseConfirm(); p.failRevoke(true);
        await page.evaluate(() => window.sideChatRootFixture.releaseNavigation());
        await page.getByRole('button', { name: '恢复侧聊写入权限' }).waitFor();
        assert.equal(await page.evaluate(() => window.sideChatRootFixture.canAcquireDraft()), false);
        assert.equal((await page.evaluate(() => window.sideChatRootFixture.history())).liveReady, true);
        assert.equal((await page.evaluate(() => window.sideChatRootFixture.child()))?.snapshot.draft.text, 'retained during uncertain reauthorization');
        p.failRevoke(false);
        await page.getByRole('button', { name: '恢复侧聊写入权限' }).click();
        await page.waitForFunction(() => window.sideChatRootFixture.canAcquireDraft());
        await page.getByRole('button', { name: '删除待发送消息' }).first().click();
        await eventually(() => p.fake.calls('thread/queue/delete').length === 1);
        assert.ok((await page.evaluate(() => window.sideChatRootFixture.rpcProofs()))[0]?.proof.challengeId);
        assert.equal(p.fake.calls('thread/fork').length, 1);
      } finally { p.failRevoke(false); await context.close(); await p.close(); }
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
          assert.equal(call.sideChat.identity.draftId, identity.draftId); assert.equal(call.sideChat.identity.prepareId, identity.prepareId);
          assert.equal(call.sideChat.identity.childThreadId, 'child-a'); assert.equal(call.sideChat.identity.connectionGeneration, 'generation-a');
          assert.ok(call.sideChat.challengeId);
        }
        assert.deepEqual(p.nativeWrites[0]?.sideChat, p.nativeWrites[1]?.sideChat);
        assert.equal(p.fake.calls('turn/start').length, 0);
      } finally { await context.close(); await p.close(); }
    });
    await t.test('visualization follow-up uses the original child sender and preserves the visible draft', async () => {
      const p = await peer(), { context, page } = await setupRoot(browser, script, p.url);
      try {
        const identity = await page.evaluate(() => window.sideChatRootFixture.open());
        const input = page.getByRole('textbox', { name: '和 Codex 一起工作' }); await input.waitFor();
        await page.waitForFunction(() => window.sideChatRootFixture.history().canSubmit && window.sideChatRootFixture.canAcquireDraft());
        await input.fill('keep the original visible draft');
        assert.equal(await page.evaluate(() => window.sideChatRootFixture.flushDraft()), true);
        await page.evaluate(() => window.sideChatRootFixture.beginVisualization('follow up from the widget'));
        await page.waitForFunction(() => window.sideChatRootFixture.visualizationResult() !== null);
        assert.equal(await page.evaluate(() => window.sideChatRootFixture.visualizationResult()), 'sent');
        assert.equal((await page.evaluate(() => window.sideChatRootFixture.child()))?.snapshot.draft.text, 'keep the original visible draft');
        const call = p.dispatches.find(item => item.request.method === 'turn/start');
        assert.equal(call?.request.params.threadId, 'child-a');
        assert.equal(call?.sideChat.identity.draftId, identity.draftId); assert.ok(call?.sideChat.challengeId);
        assert.equal(p.fake.calls('turn/start').length, 1);
      } finally { await context.close(); await p.close(); }
    });
    await t.test('a canceled visualization source cannot send after the original authorization was captured', async () => {
      const p = await peer(), { context, page } = await setupRoot(browser, script, p.url);
      try {
        await page.evaluate(() => window.sideChatRootFixture.open());
        const input = page.getByRole('textbox', { name: '和 Codex 一起工作' }); await input.waitFor();
        await page.waitForFunction(() => window.sideChatRootFixture.history().canSubmit && window.sideChatRootFixture.canAcquireDraft());
        await input.fill('unrelated draft');
        assert.equal(await page.evaluate(() => window.sideChatRootFixture.flushDraft()), true);
        await page.evaluate(() => { window.sideChatRootFixture.holdCollaboration(); window.sideChatRootFixture.beginVisualization('canceled widget'); });
        await page.waitForFunction(() => window.sideChatRootFixture.collaborationWaiting());
        await page.evaluate(() => { window.sideChatRootFixture.abortVisualization(); window.sideChatRootFixture.releaseCollaboration(); });
        await page.waitForFunction(() => window.sideChatRootFixture.visualizationResult() !== null);
        assert.match((await page.evaluate(() => window.sideChatRootFixture.visualizationResult()))!, /可视化来源已改变/);
        assert.equal(p.fake.calls('turn/start').length, 0);
        assert.equal((await page.evaluate(() => window.sideChatRootFixture.child()))?.snapshot.draft.text, 'unrelated draft');
      } finally { await page.evaluate(() => window.sideChatRootFixture.releaseCollaboration()); await context.close(); await p.close(); }
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
        await page.waitForFunction(() => window.sideChatRootFixture.history().canSubmit
          && !!window.sideChatRootFixture.child()?.hasNavigation && window.sideChatRootFixture.canAcquireDraft());
        await page.locator('.yard-side-chat:visible').getByText(/无法读取队列/).waitFor();
        await page.evaluate(() => window.sideChatRootFixture.structuredDraft());
        await page.evaluate(() => window.sideChatRootFixture.holdNative());
        await page.getByRole('button', { name: '发送', exact: true }).click();
        await page.waitForFunction(() => window.sideChatRootFixture.nativeWaiting());
        await page.evaluate(() => { (window as any).switchPromise = window.sideChatRootFixture.open(); });
        await page.waitForFunction(id => !window.sideChatRootFixture.canAttachOwner(id), original.draftId);
        assert.equal((await page.evaluate(() => window.sideChatRootFixture.child()))?.owner.draftId, original.draftId);
        await page.evaluate(() => window.sideChatRootFixture.releaseNative());
        const next = await page.evaluate(() => (window as any).switchPromise);
        await page.waitForFunction(id => window.sideChatRootFixture.child()?.identity.draftId === id
          && !!window.sideChatRootFixture.child()?.hasNavigation && window.sideChatRootFixture.canAcquireDraft(), next.draftId);
        await page.locator('.yard-side-chat:visible').getByText(/无法读取队列/).waitFor();
        assert.equal(await page.evaluate(() => window.sideChatRootFixture.flushDraft()), true);
        await eventuallyAsync(() => page.evaluate(async () => Object.values((await window.sideChatRootFixture.sends()).requests).some(item => item.stage === 'failed')));
        assert.equal(p.nativeWrites.length, 0); assert.equal(p.fake.calls('turn/start').length, 0);
        await page.evaluate(id => window.sideChatRootFixture.show(id), original.draftId);
        assert.equal((await page.evaluate(() => window.sideChatRootFixture.child()))?.owner.draftId, original.draftId);
      } finally { await page.evaluate(() => window.sideChatRootFixture.releaseNative()); await context.close(); await p.close(); }
    });
    await t.test('a draft that cannot freeze blocks the visible switch until its real input is ready', async () => {
      const p = await peer(); p.enableQueue();
      const { context, page } = await setupRoot(browser, script, p.url);
      try {
        const original = await page.evaluate(() => window.sideChatRootFixture.open());
        await page.getByRole('textbox', { name: '和 Codex 一起工作' }).waitFor();
        await page.waitForFunction(() => !!window.sideChatRootFixture.child()?.hasNavigation && window.sideChatRootFixture.canAcquireDraft());
        const next = await page.evaluate(() => window.sideChatRootFixture.open());
        await page.waitForFunction(id => window.sideChatRootFixture.child()?.identity.draftId === id
          && !!window.sideChatRootFixture.child()?.hasNavigation && window.sideChatRootFixture.canAcquireDraft(), next.draftId);
        const input = page.getByRole('textbox', { name: '和 Codex 一起工作' });
        await input.fill('second original draft');
        assert.equal(await page.evaluate(() => window.sideChatRootFixture.flushDraft()), true);
        await input.dispatchEvent('compositionstart', { data: 'a' });
        await page.waitForFunction(() => !window.sideChatRootFixture.canAcquireDraft());
        await page.getByRole('button', { name: '侧聊 1', exact: true }).click();
        await page.getByText('原侧聊尚不能冻结，未切换。').waitFor();
        assert.equal((await page.evaluate(() => window.sideChatRootFixture.child()))?.identity.draftId, next.draftId);
        assert.equal(await input.inputValue(), 'second original draft');
        assert.equal(p.fake.calls('thread/unsubscribe').length, 0);
        await input.dispatchEvent('compositionend', { data: 'a' });
        await page.waitForFunction(() => window.sideChatRootFixture.canAcquireDraft());
        await page.getByRole('button', { name: '侧聊 1', exact: true }).click();
        await page.waitForFunction(id => window.sideChatRootFixture.child()?.identity.draftId === id, original.draftId);
        assert.equal(p.fake.calls('turn/start').length, 0);
      } finally { await context.close(); await p.close(); }
    });
    await t.test('mounted summaries read real child owners, draft titles and live session status without granting authority', async () => {
      const p = await peer(); p.enableQueue();
      const { context, page } = await setupRoot(browser, script, p.url);
      try {
        const first = await page.evaluate(() => window.sideChatRootFixture.open());
        await page.getByRole('textbox', { name: '和 Codex 一起工作' }).waitFor();
        await page.waitForFunction(() => !!window.sideChatRootFixture.child()?.hasNavigation && window.sideChatRootFixture.canAcquireDraft());
        const input = page.getByRole('textbox', { name: '和 Codex 一起工作' });
        await input.fill('First real draft\nSecond line');
        assert.equal(await page.evaluate(() => window.sideChatRootFixture.flushDraft()), true);
        await page.waitForFunction(() => window.sideChatRootFixture.listMounted()[0]?.title === 'First real draft');
        const second = await page.evaluate(() => window.sideChatRootFixture.open());
        await page.waitForFunction(id => window.sideChatRootFixture.child()?.identity.draftId === id
          && !!window.sideChatRootFixture.child()?.hasNavigation && window.sideChatRootFixture.canAcquireDraft(), second.draftId);
        await input.fill('Second real draft');
        assert.equal(await page.evaluate(() => window.sideChatRootFixture.flushDraft()), true);
        await page.waitForFunction(() => window.sideChatRootFixture.listMounted()[1]?.title === 'Second real draft'
          && window.sideChatRootFixture.listMounted()[1]?.working === false);
        const mounted = await page.evaluate(() => window.sideChatRootFixture.listMounted());
        assert.deepEqual(mounted.map(item => item.identity), [first, second]);
        assert.deepEqual(mounted.map(item => item.owner?.threadId), ['child-a', 'child-2']);
        assert.deepEqual(mounted.map(item => item.title), ['First real draft', 'Second real draft']);
        assert.deepEqual(mounted.map(item => item.active), [false, true]);
        const publications = await page.evaluate(() => window.sideChatRootFixture.publications());
        p.fake.send({ method: 'turn/started', params: { threadId: 'child-2', turn: { id: 'turn-visible', status: 'inProgress', items: [] } } });
        await page.waitForFunction(() => window.sideChatRootFixture.listMounted()[1]?.working === true);
        assert.ok(await page.evaluate(() => window.sideChatRootFixture.publications()) > publications);
        await page.evaluate(() => { const list = window.sideChatRootFixture.listMounted();
          (list[0]!.identity as { hostId: string }).hostId = 'changed'; (list[0]!.owner as { draftId: string }).draftId = 'changed'; });
        assert.equal((await page.evaluate(() => window.sideChatRootFixture.listMounted()))[0]?.identity.hostId, 'local');
        assert.equal((await page.evaluate(() => window.sideChatRootFixture.listMounted()))[0]?.owner?.draftId, first.draftId);
        assert.equal(p.fake.calls('turn/start').length, 0);
      } finally { await context.close(); await p.close(); }
    });
    await t.test('an unprepared mounted summary has no invented owner, title or working status', async () => {
      const p = await peer(); p.holdFork();
      const { context, page } = await setupRoot(browser, script, p.url);
      try {
        const identity = await page.evaluate(() => window.sideChatRootFixture.open());
        await eventually(p.forkWaiting);
        assert.deepEqual(await page.evaluate(() => window.sideChatRootFixture.listMounted()),
          [{ identity, owner: null, title: null, working: null, active: true }]);
        assert.equal(p.fake.calls('turn/start').length, 0);
      } finally { p.releaseFork(); await context.close(); await p.close(); }
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
        const proofs = await page.evaluate(() => window.sideChatRootFixture.rpcProofs());
        assert.ok(proofs.find(item => item.method === 'thread/queue/delete')?.proof.challengeId);
        assert.deepEqual(proofs.find(item => item.method === 'thread/queue/start')?.proof,
          proofs.find(item => item.method === 'thread/queue/delete')?.proof);
      } finally { await context.close(); await p.close(); }
    });
    await t.test('a confirmed revoke and reauthorization of the same child never revives an old captured proof', async () => {
      const p = await peer(); p.enableQueue();
      const { context, page } = await setupRoot(browser, script, p.url);
      try {
        await page.evaluate(() => window.sideChatRootFixture.open());
        await page.getByRole('textbox', { name: '和 Codex 一起工作' }).waitFor();
        await page.waitForFunction(() => window.sideChatRootFixture.history().canSubmit);
        await page.getByRole('button', { name: '删除待发送消息' }).first().click();
        await eventually(() => p.fake.calls('thread/queue/delete').length === 1);
        const original = (await page.evaluate(() => window.sideChatRootFixture.rpcProofs()))[0]!;
        assert.equal(await page.evaluate(() => window.sideChatRootFixture.capturedGuardValid(0)), true);
        assert.equal(await page.evaluate(() => window.sideChatRootFixture.freezeNavigation()), true);
        assert.equal(await page.evaluate(() => window.sideChatRootFixture.flushNavigation()), true);
        await page.evaluate(() => window.sideChatRootFixture.revokeNavigation());
        assert.equal(await page.evaluate(() => window.sideChatRootFixture.capturedGuardValid(0)), false);
        await page.evaluate(() => window.sideChatRootFixture.releaseNavigation());
        await eventually(() => p.authorityActions.filter(action => action === 'confirm').length === 2);
        await page.getByRole('button', { name: '删除待发送消息' }).first().click();
        await eventually(() => p.fake.calls('thread/queue/delete').length === 2);
        const current = (await page.evaluate(() => window.sideChatRootFixture.rpcProofs()))[1]!;
        assert.deepEqual(current.proof.identity, original.proof.identity);
        assert.notEqual(current.proof.challengeId, original.proof.challengeId);
        assert.equal(await page.evaluate(() => window.sideChatRootFixture.capturedGuardValid(0)), false);
        assert.equal(p.fake.calls('thread/fork').length, 1);
      } finally { await context.close(); await p.close(); }
    });
    await t.test('queue-to-draft host mutation carries the original child proof', async () => {
      const p = await peer(); p.enableQueue();
      const { context, page } = await setupRoot(browser, script, p.url);
      try {
        const identity = await page.evaluate(() => window.sideChatRootFixture.open());
        await page.getByRole('textbox', { name: '和 Codex 一起工作' }).waitFor();
        await page.waitForFunction(() => window.sideChatRootFixture.history().canSubmit && window.sideChatRootFixture.canAcquireDraft());
        await page.getByRole('button', { name: '编辑待发送消息' }).first().click();
        await eventually(() => p.queueEdits.length === 1);
        assert.equal(p.queueEdits[0]?.sideChat.identity.draftId, identity.draftId);
        assert.equal(p.queueEdits[0]?.sideChat.identity.childThreadId, 'child-a');
        assert.ok(p.queueEdits[0]?.sideChat.challengeId);
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
        await page.getByRole('textbox', { name: '和 Codex 一起工作' }).waitFor();
        await page.waitForFunction(() => window.sideChatRootFixture.canAcquireDraft());
        await page.waitForFunction(() => !!window.sideChatRootFixture.child()?.hasNavigation);
        const next = await page.evaluate(() => window.sideChatRootFixture.child());
        assert.notEqual(next?.owner.draftId, original.draftId);
        assert.equal(await page.evaluate(() => window.sideChatRootFixture.freezeNavigation()), false);
        try { await page.evaluate(id => window.sideChatRootFixture.show(id), original.draftId); }
        catch (error) { throw new Error('Switch to retained draft failed: ' + await page.locator('body').innerText(), { cause: error }); }
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
      const p = await peer(); p.enableQueue();
      const { context, page } = await setup(browser, script, p.url);
      try {
        await page.getByRole('button', { name: '打开侧聊' }).click();
        const input = page.getByRole('textbox', { name: '和 Codex 一起工作' }); await input.waitFor();
        p.failRevoke(true);
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
        await page.getByText(/无法读取队列/).waitFor();
        assert.equal(await page.evaluate(() => window.sideChatWorkspaceFixture.flushDraft()), true);
        await page.waitForFunction(() => window.sideChatWorkspaceFixture.pendingQueueReads() === 0
          && window.sideChatWorkspaceFixture.freezeNavigation());
        assert.equal(await page.evaluate(() => window.sideChatWorkspaceFixture.frozen), true);
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
    await t.test('a failed in-flight queue read cannot be mistaken for a drained navigation lease', async () => {
      const p = await peer(); p.holdQueueReads();
      const { context, page } = await setup(browser, script, p.url);
      try {
        await page.getByRole('button', { name: '打开侧聊' }).click();
        const input = page.getByRole('textbox', { name: '和 Codex 一起工作' }); await input.waitFor();
        await eventually(() => p.queueReadsWaiting() > 0);
        await input.fill('未排空的原稿');
        assert.equal(await page.evaluate(() => window.sideChatWorkspaceFixture.flushDraft()), true);
        assert.equal(await page.evaluate(() => window.sideChatWorkspaceFixture.freezeNavigation()), true);
        await page.getByRole('button', { name: '关闭侧聊' }).click();
        await page.getByText(/原侧聊关闭身份已改变/).waitFor();
        await page.evaluate(() => { (window as any).queueDrain = window.sideChatWorkspaceFixture.flushNavigation(); });
        p.failQueueReads();
        assert.equal(await page.evaluate(() => (window as any).queueDrain), false);
        assert.equal(await page.evaluate(() => window.sideChatWorkspaceFixture.frozen), true);
        await assert.rejects(page.evaluate(() => window.sideChatWorkspaceFixture.revokeNavigation()), /尚未排空/);
        assert.equal(await input.inputValue(), '未排空的原稿');
        assert.equal(p.fake.calls('thread/unsubscribe').length, 0);
        await page.evaluate(() => window.sideChatWorkspaceFixture.releaseNavigation());
        assert.equal(await page.evaluate(() => window.sideChatWorkspaceFixture.frozen), false);
      } finally { p.failQueueReads(); await context.close(); await p.close(); }
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
