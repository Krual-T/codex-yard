import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { SendRecoveryStore, sendThreadKey } from '../src/renderer/app/send-recovery.ts';
import type { SendInjectedInput, SendIntent, SendOwner, SendRecoverySnapshot } from '../src/renderer/app/send-recovery.ts';
import type { WorkbenchClient } from '../src/renderer/workbench-contract.ts';

const owner = { hostId: 'host-a', threadId: 'thread-a', draftId: 'draft-a' };
const draft = { text: 'original draft', images: [], files: [] };
const input: SendInjectedInput = { callId: 'call-a', input: [{ type: 'text', text: 'original' }],
  responseItems: [{ type: 'function_call_output', call_id: 'call-a', output: 'original context' }] };

function fixture() {
  let value: unknown, tail: Promise<void> = Promise.resolve(), failNext = false;
  let gate: { entered: () => void; wait: Promise<void> } | undefined;
  const calls: string[] = [];
  const storage = {
    async read() { await tail; return structuredClone(value); },
    update(change: (value: unknown) => unknown): Promise<unknown> {
      const result = tail.then(async () => {
        const held = gate; gate = undefined;
        if (held) { held.entered(); await held.wait; }
        const next = change(structuredClone(value));
        if (failNext) { failNext = false; throw new Error('controlled transaction aborted'); }
        value = structuredClone(next);
        return structuredClone(value);
      });
      tail = result.then(() => {}, () => {});
      return result;
    },
  };
  const client: WorkbenchClient = {
    rpc: async () => { calls.push('rpc'); throw new Error('Unexpected RPC'); },
    host: async () => { calls.push('host'); throw new Error('Unexpected host request'); },
    subscribe: () => () => {}, reply: async () => {},
  };
  const store = new SendRecoveryStore(client, storage);
  return {
    store, storage, calls,
    holdNext() {
      let entered!: () => void, release!: () => void;
      const started = new Promise<void>(resolve => { entered = resolve; });
      const wait = new Promise<void>(resolve => { release = resolve; });
      gate = { entered, wait };
      return { started, release };
    },
    failNext() { failNext = true; },
    async prepare(injected = false, selectedOwner: SendOwner = owner) {
      return store.prepare({ owner: selectedOwner, revision: 'revision-a' }, '/fixture', draft, { model: 'original-model' }, {},
        undefined, undefined, { type: 'send' }, injected ? input : undefined);
    },
    async current(id: string) { return (await store.read()).requests[id]!; },
    mutate(change: (state: SendRecoverySnapshot) => void) {
      return storage.update(value => { const state = value as SendRecoverySnapshot; change(state); return state; });
    },
  };
}

test('a queued cancellation rejects every changed part of the original intent', async t => {
  const changes: [string, (intent: SendIntent) => void][] = [
    ['revision', intent => { intent.revision = 'revision-b'; }],
    ['attempt', intent => { intent.attemptId = 'attempt-b'; }],
    ['stage', intent => { intent.stage = 'unknown'; }],
    ['owner host', intent => { intent.owner.hostId = 'host-b'; }],
    ['owner thread', intent => { intent.owner.threadId = 'thread-b'; }],
    ['owner draft', intent => { intent.owner.draftId = 'draft-b'; }],
    ['target', intent => { intent.threadId = 'thread-b'; }],
    ['action', intent => { intent.action = { type: 'queue' }; }],
    ['draft', intent => { intent.draft.text = 'newer draft'; }],
    ['options', intent => { intent.options.model = 'newer-model'; }],
    ['unknown extension', intent => { (intent as unknown as Record<string, unknown>).future = { retained: true }; }],
  ];
  for (const [label, change] of changes) await t.test(label, async () => {
    const h = fixture(), original = await h.prepare(), other = await h.prepare(false, { ...owner, draftId: 'other' });
    const expected = await h.current(original.id), held = h.holdNext();
    const writer = h.mutate(state => change(state.requests[original.id]!));
    await held.started;
    let guards = 0;
    const cancel = h.store.cancelOriginal(expected, () => { guards++; });
    held.release(); await writer;
    await assert.rejects(cancel, /原发送记录已改变/);
    assert.equal(guards, 0);
    assert.ok((await h.store.read()).requests[original.id]);
    assert.deepEqual(await h.current(other.id), other);
    assert.deepEqual(h.calls, []);
  });
});

test('injection phase and the complete native reference are compared inside the queued transaction', async () => {
  const h = fixture(), original = await h.prepare(true), expected = await h.current(original.id), held = h.holdNext();
  const reserve = h.store.reserveNativeInjection(original, owner.threadId,
    { threadId: owner.threadId, clientUserMessageId: original.clientUserMessageId, input: original.injection!.input }, 'generation-a');
  await held.started;
  const cancel = h.store.cancelOriginal(expected, () => {});
  held.release(); await reserve;
  await assert.rejects(cancel, /原发送记录已改变/);
  const reserved = await h.current(original.id);
  assert.equal(reserved.injection?.phase, 'sending');
  assert.equal(reserved.injection?.native?.reference.connectionGeneration, 'generation-a');
  const another = structuredClone(reserved);
  another.injection!.native!.reference.connectionGeneration = 'generation-b';
  await assert.rejects(h.store.cancelOriginal(another, () => {}), /原发送记录已改变/);
  assert.deepEqual(h.calls, []);
});

test('the guard runs in the transaction and the caller cannot mutate its captured intent', async () => {
  const h = fixture(), original = await h.prepare(), other = await h.prepare(false, { ...owner, draftId: 'other' });
  const expected = await h.current(original.id), held = h.holdNext();
  const writer = h.mutate(() => {});
  await held.started;
  let authorized = true, guards = 0;
  const cancel = h.store.cancelOriginal(expected, () => { guards++; if (!authorized) throw new Error('original owner revoked'); });
  authorized = false;
  held.release(); await writer;
  await assert.rejects(cancel, /original owner revoked/);
  assert.equal(guards, 1);
  assert.deepEqual(await h.current(original.id), original);
  for (const guard of [async () => {}, async () => { throw new Error('late async guard rejection'); }, () => false]) {
    await assert.rejects(h.store.cancelOriginal(expected, guard), /必须同步核对/);
    assert.deepEqual(await h.current(original.id), original);
  }
  const heldAgain = h.holdNext(), writerAgain = h.mutate(() => {});
  await heldAgain.started;
  const successful = h.store.cancelOriginal(expected, () => {});
  expected.owner.draftId = 'changed after invocation'; expected.revision = 'changed after invocation';
  heldAgain.release(); await writerAgain; await successful;
  const remaining = await h.store.read();
  assert.equal(remaining.requests[original.id], undefined);
  assert.deepEqual(remaining.requests[other.id], other);
  await assert.rejects(h.store.cancelOriginal(original, () => {}), /已不存在/);
  assert.deepEqual(h.calls, []);
});

test('transaction failure retains the original record and retry is explicit', async () => {
  const h = fixture(), original = await h.prepare();
  h.failNext();
  await assert.rejects(h.store.cancelOriginal(original, () => {}), /transaction aborted/);
  assert.deepEqual(await h.current(original.id), original);
  await h.store.cancelOriginal(original, () => {});
  assert.equal((await h.store.read()).requests[original.id], undefined);
  assert.deepEqual(h.calls, []);
});

test('creation owner, binding, settings and project stay authoritative when cancelling', async t => {
  for (const mismatch of ['none', 'owner', 'binding', 'settings', 'project', 'missing receipt']) await t.test(mismatch, async () => {
    const h = fixture(), original = await h.prepare(false, { ...owner, threadId: null });
    await h.store.creating(original.id, original.attemptId);
    const thread = { id: 'created-thread', name: null, cwd: '/fixture', status: { type: 'idle' as const }, turns: [] };
    await h.store.created(original.id, thread.id, { thread, settings: { model: 'created-model' } }, original.attemptId);
    const key = sendThreadKey(owner.hostId, thread.id);
    await h.mutate(state => {
      state.requests[original.id]!.projectId = 'project-a';
      delete state.creations[key]!.projectId;
      if (mismatch === 'owner') state.creations[key]!.owner.draftId = 'another-owner';
      if (mismatch === 'binding') state.bindings[key] = 'another-owner';
      if (mismatch === 'settings') state.creations[key]!.settings.model = 'another-model';
      if (mismatch === 'project') state.creations[key]!.projectId = 'project-b';
      if (mismatch === 'missing receipt') delete state.creations[key];
    });
    const before = await h.store.read(), expected = before.requests[original.id]!;
    if (mismatch !== 'none') {
      await assert.rejects(h.store.cancelOriginal(expected, () => {}), /回执已改变|回执无法核对/);
      assert.deepEqual(await h.store.read(), before);
    } else {
      await h.store.cancelOriginal(expected, () => {});
      const after = await h.store.read();
      assert.equal(after.requests[original.id], undefined);
      assert.equal(after.bindings[key], owner.draftId);
      assert.deepEqual(after.creations[key], { owner: original.owner, thread, settings: { model: 'created-model' }, projectId: 'project-a' });
    }
    assert.deepEqual(h.calls, []);
  });
});

test('unknown sends and confirmed injection receipts awaiting persistence cannot be cancelled', async () => {
  const unknown = fixture(), send = await unknown.prepare();
  await unknown.store.sending(send.id, send.attemptId);
  await unknown.store.failed(send.id, new Error('response lost'), send.attemptId);
  const pending = await unknown.current(send.id);
  await assert.rejects(unknown.store.cancelOriginal(pending, () => {}), /尚未核对/);
  assert.deepEqual(await unknown.current(send.id), pending);

  const h = fixture(), intent = await h.prepare(true);
  await h.store.injecting(intent.id, intent.attemptId);
  h.failNext();
  await assert.rejects(h.store.injected(intent.id, intent.attemptId), /transaction aborted/);
  assert.equal(h.store.hasConfirmedInjectionReceipt(await h.current(intent.id)), true);
  // Deliberately inconsistent persisted input checks the independent local receipt fence.
  await h.mutate(state => { state.requests[intent.id]!.stage = 'failed'; state.requests[intent.id]!.injection!.phase = 'prepared'; });
  const current = await h.current(intent.id);
  await assert.rejects(h.store.cancelOriginal(current, () => {}), /成功回执尚未保存/);
  assert.deepEqual(await h.current(intent.id), current);
  assert.deepEqual([...unknown.calls, ...h.calls], []);
});

test('an earlier attempt with an unpersisted success also blocks cancellation of a newer attempt', async () => {
  const h = fixture(), intent = await h.prepare(true);
  await h.store.injecting(intent.id, intent.attemptId);
  await h.store.injectionFailed(intent.id, Object.assign(new Error('before send'), { sendPhase: 'before-send' }), intent.attemptId);
  const newer = await h.store.attempt(intent.id);
  await assert.rejects(h.store.injected(intent.id, intent.attemptId), /另一页面处理/);
  await assert.rejects(h.store.cancelOriginal(newer, () => {}), /成功回执尚未保存/);
  assert.deepEqual(await h.current(intent.id), newer);
  assert.deepEqual(h.calls, []);
});

test('native pending persistence and uncertain reservation are retained; only proven rejection or before-send may cancel', async t => {
  for (const mode of ['pending', 'unknown', 'before-send', 'rejected', 'not-sent', 'rejected-with-turn-attempt'] as const) await t.test(mode, async () => {
    const h = fixture(), intent = await h.prepare(true);
    let reserved = await h.store.reserveNativeInjection(intent, owner.threadId,
      { threadId: owner.threadId, clientUserMessageId: intent.clientUserMessageId, input: intent.injection!.input }, 'generation-a');
    const native = reserved.injection!.native!;
    if (mode === 'before-send') {
      reserved = await h.store.nativeHostFailure(intent.id, native, 'injection', Object.assign(new Error('not dispatched'), { sendPhase: 'before-send' }));
    } else if (mode === 'rejected' || mode === 'not-sent' || mode === 'rejected-with-turn-attempt' || mode === 'pending') {
      const result = { reference: native.reference,
        injection: mode === 'pending' ? { phase: 'sending' } : mode === 'not-sent'
          ? { phase: 'not-sent', terminal: { kind: 'not-sent', reason: 'transport-unavailable' } }
          : { phase: 'rejected', terminal: { kind: 'rejected', code: -32602 } },
        turn: { phase: 'waiting', attempts: [] },
        pendingPersistence: mode === 'pending' ? { step: 'injection', attemptId: native.reference.injectionAttemptId, terminal: null } : null };
      reserved = await h.store.applyNativeStatus(intent.id, native, result);
    }
    if (mode === 'pending' || mode === 'unknown' || mode === 'rejected-with-turn-attempt') {
      // Even a contradictory older projection must not discard the host evidence.
      await h.mutate(state => {
        const request = state.requests[intent.id]!;
        request.stage = 'failed'; request.injection!.phase = 'prepared';
        if (mode === 'rejected-with-turn-attempt') {
          request.injection!.native!.turnAttemptId = 'turn-attempt'; request.injection!.native!.turnGeneration = 'generation-a';
        }
      });
      reserved = await h.current(intent.id);
      await assert.rejects(h.store.cancelOriginal(reserved, () => {}), /尚未核对/);
      assert.deepEqual(await h.current(intent.id), reserved);
    } else {
      await h.store.cancelOriginal(reserved, () => {});
      assert.equal((await h.store.read()).requests[intent.id], undefined);
    }
    assert.deepEqual(h.calls, []);
  });
});

test('real IndexedDB serializes cancellation with another page and checks the original guard in the transaction', { timeout: 60_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'yard-cancel-'));
  const server = createServer((_request, response) => { response.writeHead(200, { 'content-type': 'text/html' }); response.end('<!doctype html>'); });
  const bundled = await build({ stdin: { contents: `
    import { SendRecoveryStore, sendsAtom } from './src/renderer/app/send-recovery.ts';
    import { updateBrowserAtoms } from './src/renderer/storage/ui-atoms.ts';
    window.fixture = { SendRecoveryStore, sendsAtom, updateBrowserAtoms };
  `, resolveDir: process.cwd(), loader: 'js' }, bundle: true, write: false, format: 'iife', platform: 'browser' });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No fixture address');
  const url = `http://127.0.0.1:${address.port}/`;
  let closeContext: (() => Promise<void>) | undefined;
  try {
    const context = await chromium.launchPersistentContext(join(directory, 'profile'), {
      executablePath: process.env.YARD_VALIDATION_CHROME_BIN || '/usr/bin/google-chrome', headless: true,
      args: ['--no-sandbox', '--disable-background-networking'],
    });
    closeContext = () => context.close();
    await context.route('**/*', route => route.request().url().startsWith(url) ? route.continue() : route.abort());
    const pageA = await context.newPage(), pageB = await context.newPage();
    for (const page of [pageA, pageB]) {
      await page.goto(url); await page.addScriptTag({ content: bundled.outputFiles[0]!.text });
      await page.evaluate(() => {
        const w = window as any;
        w.calls = [];
        w.store = new w.fixture.SendRecoveryStore({ rpc: async () => { w.calls.push('rpc'); throw Error('unexpected'); },
          host: async () => { w.calls.push('host'); throw Error('unexpected'); }, subscribe: () => () => {}, reply: async () => {} });
      });
    }
    const intent = await pageB.evaluate(async () => (window as any).store.prepare({ owner: { hostId: 'host-a', threadId: 'thread-a', draftId: 'draft-a' },
      revision: 'revision-a' }, '/fixture', { text: 'original', images: [], files: [] }, {}, {}));
    const other = await pageB.evaluate(async () => (window as any).store.prepare({ owner: { hostId: 'host-a', threadId: 'thread-a', draftId: 'other' },
      revision: 'other' }, '/fixture', { text: 'other', images: [], files: [] }, {}, {}));
    await pageA.evaluate(async () => (window as any).fixture.updateBrowserAtoms(() => ({ value: null, updates: { 'unrelated-atom': { keep: true } } })));

    const hold = async (mode: 'change' | 'same') => pageA.evaluate(async ({ mode, id }) => {
      const w = window as any;
      let release = false;
      w.releaseWriter = () => { release = true; };
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('codex-yard.ui-atoms.v1', 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result, tx = db.transaction('atoms', 'readwrite'), atoms = tx.objectStore('atoms');
          let started = false;
          w.writerDone = new Promise<void>((done, failed) => { tx.oncomplete = () => { db.close(); done(); }; tx.onabort = () => failed(tx.error); });
          const pump = () => {
            const get = atoms.get('native-atoms');
            get.onerror = () => reject(get.error);
            get.onsuccess = () => {
              if (!started) { started = true; resolve(); }
              if (!release) { pump(); return; }
              if (mode === 'change') {
                const root = get.result;
                root.atoms[w.fixture.sendsAtom].requests[id].revision = 'revision-b';
                atoms.put(root, 'native-atoms');
              }
            };
          };
          pump();
        };
      });
    }, { mode, id: intent.id });
    const launch = async (value: unknown) => pageB.evaluate(value => {
      const w = window as any; w.guardCalls = 0; w.allowed = true; w.result = null;
      w.pending = w.store.cancelOriginal(value, () => { w.guardCalls++; if (!w.allowed) throw Error('revoked in original page'); })
        .then(() => { w.result = 'cancelled'; }, (error: Error) => { w.result = error.message; });
    }, value);
    const release = async () => { await pageA.evaluate(async () => { const w = window as any; w.releaseWriter(); await w.writerDone; });
      await pageB.evaluate(async () => (window as any).pending); };

    await hold('change'); await launch(intent);
    await pageB.waitForTimeout(80);
    assert.deepEqual(await pageB.evaluate(() => [(window as any).guardCalls, (window as any).result]), [0, null]);
    await release();
    assert.match(await pageB.evaluate(() => (window as any).result), /原发送记录已改变/);
    const changed = await pageB.evaluate(async id => (await (window as any).store.read()).requests[id], intent.id);
    assert.equal(changed.revision, 'revision-b');

    await hold('same'); await launch(changed);
    await pageB.waitForTimeout(80);
    assert.equal(await pageB.evaluate(() => (window as any).guardCalls), 0);
    await pageB.evaluate(() => { (window as any).allowed = false; });
    await release();
    assert.match(await pageB.evaluate(() => (window as any).result), /revoked in original page/);
    assert.deepEqual(await pageB.evaluate(async id => (await (window as any).store.read()).requests[id], intent.id), changed);

    await hold('same'); await launch(changed);
    await pageB.waitForTimeout(80); await release();
    assert.equal(await pageB.evaluate(() => (window as any).result), 'cancelled');
    const state = await pageB.evaluate(async () => (window as any).store.read());
    assert.equal(state.requests[intent.id], undefined);
    assert.deepEqual(state.requests[other.id], other);
    const atoms = await pageA.evaluate(async () => (window as any).fixture.updateBrowserAtoms((atoms: Record<string, unknown>) => ({ value: atoms })));
    assert.deepEqual(atoms['unrelated-atom'], { keep: true });
    assert.deepEqual(await pageB.evaluate(() => (window as any).calls), []);
  } finally {
    await closeContext?.();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
