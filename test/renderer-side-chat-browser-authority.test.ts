import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { once } from 'node:events';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import WebSocket, { WebSocketServer } from 'ws';
import { createSideChatNativeBrowserAuthority } from '../src/native/side-chat-browser-authority.ts';
import type { SideChatAuthorityRequest } from '../src/renderer/side-chat/browser-authority.ts';
import type { SideChatHostView } from '../src/renderer/side-chat/types.ts';

const base = { hostId: 'host-a', parentThreadId: 'parent-a', draftId: 'side-draft-a', prepareId: 'prepare-a',
  operationId: 'operation-a', parentCwd: '/fixture/a', connectionGeneration: 'generation-a' };
function initialView(): SideChatHostView {
  return { operationId: base.operationId, parent: { hostId: base.hostId, threadId: base.parentThreadId, cwd: base.parentCwd },
    childId: null, child: null, fork: { status: 'waiting', error: null }, inject: { status: 'waiting', error: null },
    close: { requested: false, status: 'idle', error: null }, recoveryError: null };
}
function receivedView(): SideChatHostView {
  return { ...initialView(), childId: 'child-a', child: { thread: { id: 'child-a', name: null, cwd: base.parentCwd,
    turns: [], status: { type: 'idle' }, ephemeral: true, forkedFromId: base.parentThreadId },
  options: { model: 'model', effort: null, approvalPolicy: 'on-request', approvalsReviewer: 'user', sandboxMode: 'read-only', serviceTier: null },
  modelProvider: 'synthetic', sandbox: { type: 'readOnly', networkAccess: false }, activePermissionProfile: null, runtimeWorkspaceRoots: [base.parentCwd] },
  fork: { status: 'received', error: null, receipt: { connectionGeneration: base.connectionGeneration, attemptId: 'attempt-a', eventCursor: 10 } } };
}
async function peer() {
  const server = createServer((_request, response) => { response.writeHead(200, { 'content-type': 'text/html' }); response.end('<main id="root"></main>'); });
  const sockets = new WebSocketServer({ server, path: '/native-host' });
  let parentPage: WebSocket | undefined, view = initialView(), holdChallenge = false, heldChallenge: (() => void) | undefined;
  let holdChild = false, heldChild: (() => void) | undefined, generation = base.connectionGeneration, failRevoke = false;
  let holdClaim = false, heldClaim: (() => void) | undefined, holdActive = false, heldActive: (() => void) | undefined;
  let token = 1, active = false;
  const reads: { page: 'original' | 'observer'; purpose: string }[] = [];
  const calls = { fork: 0, inject: 0, unsubscribe: 0, cleanup: 0 };
  const authority = createSideChatNativeBrowserAuthority({ requestTimeoutMs: 10_000,
    assertOrigin(scope) {
      const id = scope.identity;
      if (!parentPage || scope.page !== parentPage || parentPage.readyState !== WebSocket.OPEN
        || id.hostId !== base.hostId || id.parentThreadId !== base.parentThreadId || id.draftId !== base.draftId
        || id.prepareId !== base.prepareId || id.operationId !== base.operationId || id.parentCwd !== base.parentCwd
        || id.connectionGeneration !== generation || id.childThreadId !== view.childId) throw Error('Synthetic original scope changed.');
    },
    notify(page, request) {
      const send = () => page.send(JSON.stringify(request));
      if (request.kind === 'child' && holdChild) heldChild = send; else send();
    },
  });
  const scoped = (page: WebSocket, action: 'start' | 'retry' | 'close') => ({ page, action, hostId: base.hostId,
    parentThreadId: base.parentThreadId, operationId: base.operationId, draftId: base.draftId,
    connectionGeneration: generation, childThreadId: view.childId });
  sockets.on('connection', page => {
    page.on('close', () => authority.invalidate(page));
    page.on('message', raw => {
      const message = JSON.parse(String(raw)) as Record<string, any>;
      if (message.type === 'ready') {
        page.send(JSON.stringify({ type: 'codex-app-server-connection-changed', hostId: base.hostId, state: 'connected' })); return;
      }
      if (message.type === 'mcp-request') {
        const request = message.request, method = request.method;
        const result = method === 'config/read' ? { config: {} } : { data: [], nextCursor: null };
        page.send(JSON.stringify({ type: 'mcp-response', hostId: message.hostId, message: { id: request.id, result } })); return;
      }
      if (message.type !== 'fetch') return;
      void (async () => {
        const body = JSON.parse(String(message.body)) as Record<string, any>, endpoint = String(message.url).split('/').at(-1);
        let result: unknown;
        if (endpoint === 'side-chat-browser-authority') {
          if (body.action === 'revoke' && failRevoke) throw Error('Synthetic revoke failure.');
          result = authority.handle(page, body);
          if (body.action === 'challenge' && holdChallenge) {
            await new Promise<void>(resolve => { heldChallenge = resolve; });
          }
        } else if (endpoint === 'side-chat-fixture') {
          if (body.action === 'prepare') {
            if (parentPage && parentPage !== page) throw Error('Another page owns this operation.');
            parentPage = page; result = view;
          } else if (body.action === 'read') {
            const purpose = body.purpose === 'reconcile' ? 'reconcile' : 'observe';
            reads.push({ page: page === parentPage ? 'original' : 'observer', purpose });
            if (purpose === 'reconcile' && page === parentPage && !active) token++;
            result = view;
          }
          else if (body.action === 'start') {
            const capturedToken = token;
            if (holdClaim) await new Promise<void>(resolve => { heldClaim = resolve; });
            if (capturedToken !== token) throw Error('Original token was fenced.');
            authority.assertCurrent({ ...scoped(page, 'start'), phase: 'claim' });
            active = true;
            if (holdActive) await new Promise<void>(resolve => { heldActive = resolve; });
            authority.assertCurrent({ ...scoped(page, 'start'), phase: 'fork', attemptId: body.forkDispatchId });
            calls.fork++; view = receivedView();
            page.send(JSON.stringify({ type: 'mcp-notification', hostId: base.hostId, seq: 11, method: 'turn/started',
              params: { threadId: 'child-a', turn: { id: 'turn-a', status: 'inProgress', items: [] } } }));
            try {
              await authority.prepareChild({ ...scoped(page, 'start'), childThreadId: 'child-a' }, view);
              authority.assertCurrent({ ...scoped(page, 'start'), phase: 'inject', attemptId: 'inject-a' });
              calls.inject++; view.inject = { status: 'received', error: null };
            } catch { view.inject = { status: 'not-sent', error: 'child confirmation failed' }; }
            active = false; result = view;
          } else if (body.action === 'retry') {
            authority.assertCurrent({ ...scoped(page, 'retry'), phase: 'claim' });
            await authority.prepareChild({ ...scoped(page, 'retry'), childThreadId: 'child-a' }, view);
            authority.assertCurrent({ ...scoped(page, 'retry'), phase: 'inject', attemptId: 'inject-b' });
            calls.inject++; view.inject = { status: 'received', error: null }; result = view;
          } else if (body.action === 'close') {
            authority.assertCurrent({ ...scoped(page, 'close'), phase: 'claim' });
            await authority.prepareClose({ ...scoped(page, 'close'), childThreadId: 'child-a' });
            authority.assertCurrent({ ...scoped(page, 'close'), phase: 'unsubscribe', attemptId: 'close-a' });
            calls.unsubscribe++;
            await authority.cleanup({ ...scoped(page, 'close'), childThreadId: 'child-a' });
            calls.cleanup++; view.close = { requested: true, status: 'closed', error: null }; result = view;
          } else throw Error('Unexpected side-chat fixture action.');
        } else if (endpoint === 'get-setting') result = { value: body.key === 'composerPlainTextMode' ? false : 'queue', exists: true };
        else throw Error('Unexpected host endpoint ' + endpoint);
        const send = () => { if (page.readyState === WebSocket.OPEN) page.send(JSON.stringify({ type: 'fetch-response',
          requestId: message.requestId, responseType: 'success', body: result })); };
        send();
      })().catch(error => { if (page.readyState === WebSocket.OPEN) page.send(JSON.stringify({ type: 'fetch-response',
        requestId: message.requestId, responseType: 'error', error: error.message, uncertain: false })); });
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw Error('No fixture address.');
  return { url: `http://127.0.0.1:${address.port}/`, calls, reads,
    holdChallenge() { holdChallenge = true; }, releaseChallenge() { holdChallenge = false; heldChallenge?.(); },
    get challengeWaiting() { return !!heldChallenge; }, holdChild() { holdChild = true; },
    releaseChild() { holdChild = false; heldChild?.(); }, get childWaiting() { return !!heldChild; },
    failRevoke(value: boolean) { failRevoke = value; },
    holdBeforeClaim() { holdClaim = true; }, releaseClaim() { holdClaim = false; heldClaim?.(); },
    get claimWaiting() { return !!heldClaim; }, holdAfterClaim() { holdActive = true; },
    releaseActive() { holdActive = false; heldActive?.(); }, get activeWaiting() { return !!heldActive; },
    get token() { return token; },
    hint() { for (const page of sockets.clients) if (page.readyState === WebSocket.OPEN) page.send(JSON.stringify({
      type: 'side-chat-updated', hostId: base.hostId, operationId: base.operationId })); },
    changeGeneration() { generation = 'generation-b'; },
    async close() { for (const socket of sockets.clients) socket.terminate(); await new Promise<void>(resolve => sockets.close(() => resolve()));
      await new Promise<void>(resolve => server.close(() => resolve())); } };
}
async function eventually(check: () => boolean): Promise<void> {
  for (let n = 0; n < 300; n++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw Error('Timed out waiting for the synthetic peer.');
}
async function setup(browser: Browser, script: string, url: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext(), page = await context.newPage();
  page.setDefaultTimeout(10_000); await page.goto(url); await page.addScriptTag({ content: script });
  await page.evaluate(async () => (window as any).sideChatAuthorityFixture.connect());
  return { context, page };
}
async function mount(page: Page) {
  await page.evaluate(() => (window as any).sideChatAuthorityFixture.mount());
  await page.waitForFunction(() => !!(window as any).sideChatAuthorityFixture.snapshot());
  await page.getByRole('textbox', { name: '和 Codex 一起工作' }).waitFor();
}

test('actual browser IDB, controller and composer consume the native authority bridge', {
  skip: !existsSync('/usr/bin/google-chrome') && 'Google Chrome is unavailable', timeout: 100_000,
}, async t => {
  const bundle = await build({ entryPoints: ['test/renderer-side-chat-browser-authority-fixture.ts'], bundle: true, write: false,
    format: 'iife', loader: { '.css': 'empty' } });
  const browser = await chromium.launch({ executablePath: process.env.YARD_VALIDATION_CHROME_BIN || '/usr/bin/google-chrome',
    headless: true, args: ['--no-sandbox', '--disable-background-networking'] });
  const script = bundle.outputFiles[0]!.text;
  try {
    await t.test('two actual pages observe on both sides of the original claim without rotating its token', async () => {
      const p = await peer(), { context, page } = await setup(browser, script, p.url);
      try {
        p.holdBeforeClaim(); p.holdAfterClaim();
        await page.evaluate(() => { (window as any).startPromise = (window as any).sideChatAuthorityFixture.start(); });
        await eventually(() => p.claimWaiting);
        const original = await page.evaluate(() => (window as any).sideChatAuthorityFixture.controller.getSnapshot().view);
        const other = await context.newPage(); await other.goto(p.url); await other.addScriptTag({ content: script });
        await other.evaluate(async (restored: SideChatHostView) => { const f = (window as any).sideChatAuthorityFixture;
          await f.connect(); f.restoreObserver(restored); }, original);
        p.hint(); await eventually(() => p.reads.length === 2);
        assert.deepEqual(p.reads.map(read => read.purpose), ['observe', 'observe']); assert.equal(p.token, 1);
        p.releaseClaim(); await eventually(() => p.activeWaiting);
        p.hint(); await eventually(() => p.reads.length === 4);
        await page.evaluate(async () => (window as any).sideChatAuthorityFixture.controller.read());
        assert.equal(p.reads.at(-1)?.purpose, 'reconcile'); assert.equal(p.token, 1);
        p.releaseActive(); await page.evaluate(async () => (window as any).startPromise);
        await page.waitForFunction(() => (window as any).sideChatAuthorityFixture.controller.getSnapshot().phase === 'ready');
        assert.deepEqual(p.calls, { fork: 1, inject: 1, unsubscribe: 0, cleanup: 0 });
      } finally { p.releaseClaim(); p.releaseActive(); await context.close(); await p.close(); }
    });
    await t.test('failed revoke retains the registration and prevents disposal until explicit revocation', async () => {
      const p = await peer(), { context, page } = await setup(browser, script, p.url);
      try {
        await page.evaluate(async () => (window as any).sideChatAuthorityFixture.start());
        p.failRevoke(true);
        await assert.rejects(page.evaluate(async () => (window as any).sideChatAuthorityFixture.revoke()), /revoke failure/);
        await assert.rejects(page.evaluate(() => (window as any).sideChatAuthorityFixture.disposeBridge()), /尚未解除/);
        assert.equal((await page.evaluate(async () => (window as any).sideChatAuthorityFixture.association())).childThreadId, 'child-a');
        assert.deepEqual(p.calls, { fork: 1, inject: 1, unsubscribe: 0, cleanup: 0 });
        p.failRevoke(false);
        await page.evaluate(async () => (window as any).sideChatAuthorityFixture.revoke());
        await page.evaluate(() => (window as any).sideChatAuthorityFixture.disposeBridge());
        assert.deepEqual(p.calls, { fork: 1, inject: 1, unsubscribe: 0, cleanup: 0 });
      } finally { await context.close(); await p.close(); }
    });
    await t.test('same-attempt child association, original event capture and real close drain', async () => {
      const p = await peer(), { context, page } = await setup(browser, script, p.url);
      try {
        await page.evaluate(async () => (window as any).sideChatAuthorityFixture.start());
        const state = await page.evaluate(async () => { const f = (window as any).sideChatAuthorityFixture;
          return { phase: f.controller.getSnapshot().phase, association: await f.association(), history: f.history() }; });
        assert.equal(state.phase, 'ready'); assert.equal(state.association.prepareId, base.prepareId);
        assert.equal(state.association.operationId, base.operationId); assert.equal(state.association.childThreadId, 'child-a');
        assert.equal(state.history.liveReady, true); assert.equal(state.history.historyComplete, false);
        assert.equal(state.history.thread.turns[0].id, 'turn-a');
        await mount(page);
        const editor = page.getByRole('textbox', { name: '和 Codex 一起工作' });
        await editor.fill('original side draft');
        await page.waitForFunction(() => (window as any).sideChatAuthorityFixture.snapshot()?.draft.text === 'original side draft');
        const pending = await page.evaluate(async () => (window as any).sideChatAuthorityFixture.pendingSend());
        await assert.rejects(page.evaluate(async () => (window as any).sideChatAuthorityFixture.freeze()), /发送结果|尚未确认/);
        assert.equal(await page.evaluate(() => (window as any).sideChatAuthorityFixture.senderFrozen()), false);
        await page.evaluate(async id => (window as any).sideChatAuthorityFixture.cancelSend(id), pending.id);
        await page.evaluate(() => (window as any).sideChatAuthorityFixture.failNextRead());
        await assert.rejects(page.evaluate(async () => (window as any).sideChatAuthorityFixture.freeze()), /IDB read failure|草稿未能排空/);
        assert.equal(await page.evaluate(() => (window as any).sideChatAuthorityFixture.senderFrozen()), false);
        await page.evaluate(async () => (window as any).sideChatAuthorityFixture.revoke());
        assert.equal(await page.evaluate(() => (window as any).sideChatAuthorityFixture.history().liveReady), true);
        await page.evaluate(async () => (window as any).sideChatAuthorityFixture.freeze());
        assert.equal(await page.evaluate(() => (window as any).sideChatAuthorityFixture.senderFrozen()), true);
        await page.evaluate(async () => (window as any).sideChatAuthorityFixture.close());
        assert.equal(await page.evaluate(() => (window as any).sideChatAuthorityFixture.controller.getSnapshot().phase), 'closed');
        assert.equal(await page.evaluate(() => (window as any).sideChatAuthorityFixture.cleanupCount()), 1);
        assert.equal(await page.evaluate(() => (window as any).sideChatAuthorityFixture.senderFrozen()), false);
        assert.equal(await editor.inputValue(), 'original side draft');
        assert.deepEqual(p.calls, { fork: 1, inject: 1, unsubscribe: 1, cleanup: 1 });
      } finally { await context.close(); await p.close(); }
    });

    await t.test('child IDB failure stays not-sent and explicitly recovers the same fork and capture', async () => {
      const p = await peer(), { context, page } = await setup(browser, script, p.url);
      try {
        await page.evaluate(() => { const f = (window as any).sideChatAuthorityFixture; f.setPauseStart(true); (window as any).startPromise = f.start(); });
        await page.waitForFunction(() => (window as any).sideChatAuthorityFixture.startWaiting);
        await page.evaluate(() => { (window as any).sideChatAuthorityFixture.failWrite(); (window as any).sideChatAuthorityFixture.releaseStart(); });
        await page.evaluate(async () => (window as any).startPromise);
        assert.equal(await page.evaluate(() => (window as any).sideChatAuthorityFixture.controller.getSnapshot().phase), 'inject-failed');
        assert.deepEqual(p.calls, { fork: 1, inject: 0, unsubscribe: 0, cleanup: 0 });
        assert.equal((await page.evaluate(async () => (window as any).sideChatAuthorityFixture.association())).childThreadId, null);
        await page.evaluate(async () => (window as any).sideChatAuthorityFixture.recoverChild());
        await page.evaluate(async () => (window as any).sideChatAuthorityFixture.retry());
        assert.equal(await page.evaluate(() => (window as any).sideChatAuthorityFixture.controller.getSnapshot().phase), 'ready');
        assert.equal((await page.evaluate(async () => (window as any).sideChatAuthorityFixture.association())).childThreadId, 'child-a');
        assert.equal(await page.evaluate(() => (window as any).sideChatAuthorityFixture.history().liveReady), true);
        assert.deepEqual(p.calls, { fork: 1, inject: 1, unsubscribe: 0, cleanup: 0 });
      } finally { await context.close(); await p.close(); }
    });

    await t.test('an initialization write failure retries the same draft and prepare before any fork', async () => {
      const p = await peer(), { context, page } = await setup(browser, script, p.url);
      try {
        await page.evaluate(async () => { const f = (window as any).sideChatAuthorityFixture;
          await f.initializeRoot(); f.failWrite(2); await f.start(); });
        assert.equal(p.calls.fork, 0);
        assert.equal(await page.evaluate(() => (window as any).sideChatAuthorityFixture.controller.getSnapshot().view), null);
        await page.evaluate(async () => (window as any).sideChatAuthorityFixture.start());
        assert.equal(await page.evaluate(() => (window as any).sideChatAuthorityFixture.controller.getSnapshot().phase), 'ready');
        const saved = await page.evaluate(async () => (window as any).sideChatAuthorityFixture.association());
        assert.equal(saved.prepareId, base.prepareId); assert.equal(saved.draftId, base.draftId); assert.equal(p.calls.fork, 1);
      } finally { await context.close(); await p.close(); }
    });

    await t.test('revoke while challenge reply is delayed blocks the original fork', async () => {
      const p = await peer(); p.holdChallenge();
      const { context, page } = await setup(browser, script, p.url);
      try {
        await page.evaluate(() => { (window as any).startPromise = (window as any).sideChatAuthorityFixture.start(); });
        await eventually(() => p.challengeWaiting);
        const second = await context.newPage(); await second.goto(p.url); await second.addScriptTag({ content: script });
        await second.evaluate(async () => (window as any).sideChatAuthorityFixture.connect());
        assert.equal((await second.evaluate(async () => (window as any).sideChatAuthorityFixture.association())).operationId, base.operationId);
        await assert.rejects(second.evaluate(async () => (window as any).sideChatAuthorityFixture.claimExisting()));
        await page.evaluate(async () => (window as any).sideChatAuthorityFixture.revoke());
        p.releaseChallenge(); await page.evaluate(async () => (window as any).startPromise);
        assert.equal(p.calls.fork, 0);
        assert.equal((await page.evaluate(async () => (window as any).sideChatAuthorityFixture.association())).operationId, base.operationId);
      } finally { p.releaseChallenge(); await context.close(); await p.close(); }
    });

    await t.test('a changed original generation after confirmation cannot reach fork', async () => {
      const p = await peer(), { context, page } = await setup(browser, script, p.url);
      try {
        await page.evaluate(() => { const f = (window as any).sideChatAuthorityFixture; f.setPauseAfterAuthorize(true); (window as any).startPromise = f.start(); });
        await page.waitForFunction(() => (window as any).sideChatAuthorityFixture.authorizedWaiting);
        p.changeGeneration();
        await page.evaluate(() => (window as any).sideChatAuthorityFixture.releaseAuthorized());
        await page.evaluate(async () => (window as any).startPromise);
        assert.equal(p.calls.fork, 0);
        assert.equal((await page.evaluate(async () => (window as any).sideChatAuthorityFixture.association())).operationId, base.operationId);
      } finally { await context.close(); await p.close(); }
    });

    await t.test('revoke while the child IDB transaction waits prevents the late binding and inject', async () => {
      const p = await peer(); p.holdChild();
      const { context, page } = await setup(browser, script, p.url);
      try {
        await page.evaluate(() => { (window as any).startPromise = (window as any).sideChatAuthorityFixture.start(); });
        await eventually(() => p.childWaiting);
        const blocker = await context.newPage(); await blocker.goto(p.url);
        await blocker.evaluate(async () => {
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open('codex-yard.ui-atoms.v1', 1);
            request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
          });
          const tx = db.transaction('atoms', 'readwrite'), store = tx.objectStore('atoms');
          let released = false;
          const done = new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error);
          });
          await new Promise<void>((resolve, reject) => {
            let first = true;
            const poll = () => {
              const request = store.get('native-atoms');
              request.onerror = () => reject(request.error);
              request.onsuccess = () => { if (!released) poll(); if (first) { first = false; resolve(); } };
            };
            poll();
          });
          (window as any).releaseIdb = () => { released = true; return done; };
        });
        p.releaseChild();
        await page.waitForFunction(() => (window as any).sideChatAuthorityFixture.childRequests === 1);
        await page.evaluate(async () => (window as any).sideChatAuthorityFixture.revoke());
        await blocker.evaluate(async () => (window as any).releaseIdb());
        await page.evaluate(async () => (window as any).startPromise);
        assert.equal((await page.evaluate(async () => (window as any).sideChatAuthorityFixture.association())).childThreadId, null);
        assert.deepEqual(p.calls, { fork: 1, inject: 0, unsubscribe: 0, cleanup: 0 });
      } finally { p.releaseChild(); await context.close(); await p.close(); }
    });

    await t.test('disconnect after freezing preserves the real draft and cannot unsubscribe', async () => {
      const p = await peer(), { context, page } = await setup(browser, script, p.url);
      try {
        await page.evaluate(async () => (window as any).sideChatAuthorityFixture.start()); await mount(page);
        const editor = page.getByRole('textbox', { name: '和 Codex 一起工作' }); await editor.fill('keep on disconnect');
        await page.waitForFunction(() => (window as any).sideChatAuthorityFixture.snapshot()?.draft.text === 'keep on disconnect');
        await page.evaluate(async () => (window as any).sideChatAuthorityFixture.freeze());
        await page.evaluate(() => (window as any).sideChatAuthorityFixture.disconnect());
        await page.evaluate(async () => (window as any).sideChatAuthorityFixture.close());
        assert.equal(await page.evaluate(() => (window as any).sideChatAuthorityFixture.senderFrozen()), true);
        assert.equal(await editor.inputValue(), 'keep on disconnect');
        assert.equal(p.calls.unsubscribe, 0);
      } finally { await context.close(); await p.close(); }
    });
  } finally { await browser.close(); }
});
