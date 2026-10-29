import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { createNativeState } from '../src/native/native-state.ts';
import type { NativeStateRoot, NativeStateCheckpoint } from '../src/native/native-state.ts';
import { createStateMutations } from '../src/native/state-mutations.ts';
import { createSideChatStore } from '../src/native/side-chat-store.ts';
import { createSideChatHost } from '../src/native/side-chat.ts';
import type { SideChatParent } from '../src/native/side-chat.ts';

for (const checkpoint of ['rename', 'directory-sync'] as const) test(`captured close preparation recovers an actual ${checkpoint} failure without dispatching unsubscribe`, async t => {
  const directory = await mkdtemp('/tmp/yard-close-commit-');
  t.after(() => rm(directory, { recursive: true, force: true }));
  let root: NativeStateRoot = {}, fail: NativeStateCheckpoint | null = null;
  const state = createNativeState({ dataDir: directory, publish(value) { root = value; },
    checkpoint(step) { if (step === fail) { fail = null; throw new Error('original close preparation commit failure'); } } });
  root = await state.load();
  const mutations = createStateMutations(state.beforeAction);
  const store = createSideChatStore({ mutations, read() { state.assertAvailable(); return root.sideChats; },
    persist: section => state.persist({ ...root, sideChats: section }) });
  const parent: SideChatParent = { hostId: 'local', threadId: 'parent', connectionGeneration: 'original-socket',
    cwd: directory, workspaceRoots: [directory], archived: false, model: 'fixture-model', modelProvider: 'fixture',
    effort: null, serviceTier: null, submitOptions: { model: 'fixture-model', approvalPolicy: 'never', approvalsReviewer: 'user' },
    sandboxPolicy: { type: 'readOnly', networkAccess: false }, project: null };
  const calls: string[] = [];
  let injectFailure = false;
  const host = createSideChatHost({ store, resolveParent: async () => parent,
    async request(_host, method) {
      calls.push(method);
      if (method === 'config/read') return { config: { developer_instructions: null } };
      if (method === 'thread/inject_items') return {};
      if (method === 'thread/unsubscribe') return { status: 'unsubscribed' };
      throw new Error('unexpected request ' + method);
    },
    async requestFork(_origin, params) {
      calls.push('thread/fork');
      return { eventCursor: 7, result: { thread: { id: 'child', ephemeral: true, forkedFromId: 'parent' },
        cwd: directory, runtimeWorkspaceRoots: [directory], model: params.model, modelProvider: params.modelProvider,
        reasoningEffort: null, serviceTier: null, approvalPolicy: 'never', approvalsReviewer: 'user', sandbox: parent.sandboxPolicy } };
    },
    classifyFailure() { return 'unknown'; },
    async prepareClose() { if (injectFailure) { injectFailure = false; fail = checkpoint; } },
    async cleanup() {}, onRecoveryError() {},
  });
  const prepared = await host.prepare({ hostId: 'local', threadId: 'parent' });
  const started = await host.start(prepared.operationId);
  assert.equal(started.inject.status, 'received');
  injectFailure = true;
  await assert.rejects(host.close(started.operationId), /native-state/);
  assert.equal(calls.includes('thread/unsubscribe'), false);
  const disk = JSON.parse(await readFile(join(directory, 'native-state.json'), 'utf8'));
  assert.equal(disk.sideChats.operations[started.operationId].close.status, 'inflight');
  const attemptId = disk.sideChats.operations[started.operationId].close.attemptId;
  const recovered = await host.read(started.operationId);
  assert.equal(recovered.close.status, 'inflight');
  const saved = await host.saveCaptured(started.operationId);
  assert.equal(saved.close.status, 'not-sent');
  assert.equal(saved.close.attemptId, attemptId);
  assert.equal(calls.includes('thread/unsubscribe'), false, 'pure receipt persistence must not dispatch');
  assert.equal((await host.saveCaptured(started.operationId)).close.status, 'not-sent');
  const closed = await host.retry(started.operationId);
  assert.equal(closed.close.status, 'closed');
  assert.equal(calls.filter(method => method === 'thread/unsubscribe').length, 1);
});
