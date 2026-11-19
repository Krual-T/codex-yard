import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { BrowserStateConvergence } from '../src/native/browser-state-convergence.ts';
import type { QueueConvergence, QueuedIntent } from '../src/native/browser-state-convergence.ts';
import { adaptStateConvergence } from '../src/native/state-convergence-renderer.ts';
import type { ObjectValue } from '../src/native/protocol.ts';

function storage(entries: Record<string, string> = {}): Storage {
  const value = Object.assign(Object.create(null), entries);
  Object.defineProperties(value, {
    length: { get: () => Object.keys(value).length },
    key: { value: (index: number) => Object.keys(value)[index] ?? null },
    getItem: { value: (key: string) => value[key] ?? null },
    setItem: { value: (key: string, item: string) => { value[key] = String(item); } },
    removeItem: { value: (key: string) => { delete value[key]; } },
  });
  return value;
}

test('only derived browser state is removed; creation choices, drafts and navigation remain durable', () => {
  const saved = storage({ 'native-atoms': JSON.stringify({
    'remote-thread-summaries-v3:ssh-fixture': [{ hasUnreadTurn: true }],
    'config-derived-agent-mode-by-host-id': { local: 'full-access' },
    'heartbeat-thread-permissions-by-id': { thread: { sandboxPolicy: {} } },
    'mcp-global-entrypoints-v2': { local: ['derived-tool'] },
    'mcp-server-tools-cache-v2': { local: ['old-tool'] },
    'agent-mode-by-host-id': { local: 'read-only' },
    'composer-recent-model-configurations-v1': ['recent-model'],
    'pull-request-chat-associations-v2': { pr: 'thread' },
    'pull-request-attachment-backfill-completed-v1': ['thread'],
    'draft:thread': 'unsent text',
  }), 'codex:persisted-atom:remote-thread-summaries-v3:old': '[{"hasUnreadTurn":true}]',
  'codex:persisted-atom:prompt-history': '["keep"]' });
  const bridge = new BrowserStateConvergence(saved);
  const atoms = JSON.parse(saved.getItem('native-atoms')!);
  assert.equal(atoms['remote-thread-summaries-v3:ssh-fixture'], undefined);
  assert.equal(atoms['config-derived-agent-mode-by-host-id'], undefined);
  assert.equal(atoms['heartbeat-thread-permissions-by-id'], undefined);
  assert.equal(atoms['mcp-global-entrypoints-v2'], undefined);
  assert.equal(atoms['mcp-server-tools-cache-v2'], undefined);
  assert.deepEqual(atoms['agent-mode-by-host-id'], { local: 'read-only' });
  assert.equal(atoms['draft:thread'], 'unsent text');
  assert.deepEqual(atoms['composer-recent-model-configurations-v1'], ['recent-model']);
  assert.deepEqual(atoms['pull-request-chat-associations-v2'], { pr: 'thread' });
  assert.deepEqual(atoms['pull-request-attachment-backfill-completed-v1'], ['thread']);
  assert.equal(saved.getItem('codex:persisted-atom:remote-thread-summaries-v3:old'), null);
  bridge.writeRemoteSummaries('remote-control:test', [{ id: 'thread', hasUnreadTurn: true, title: 'current' }]);
  assert.deepEqual(bridge.readRemoteSummaries('remote-control:test'), [{ id: 'thread', title: 'current' }]);
  assert.deepEqual(new BrowserStateConvergence(saved).readRemoteSummaries('remote-control:test'), []);
});

function queueFixture(messages: QueuedIntent[]) {
  let current = messages;
  const backend = new Map<string, string>();
  const added: string[] = [];
  const sent = new Set<string>();
  let duringDispatch: (() => Promise<void>) | undefined;
  const options: QueueConvergence<QueuedIntent> = {
    hostId: 'ssh-fixture', threadId: 'thread', read: () => current,
    // The real global-state callback is re-applied to a freshly decoded host
    // value. Reference equality would leave the durable copy behind.
    update: async change => { current = change(structuredClone(current)); },
    isSame: (left, right) => JSON.stringify(left) === JSON.stringify(right),
    isCurrent: message => current.some(item => JSON.stringify(item) === JSON.stringify(message)), canMigrate: message => message.localOnly !== true,
    wasAccepted: id => sent.has(id), isNotSent: error => error instanceof Error && error.message === 'not-sent',
    queue: {
      load: async () => {}, canEnqueue: (_thread, message) => !message.specialSettings,
      findByClientMessageId: (_thread, id) => backend.get(id),
      enqueue: async (_thread, message, _position, beforeDispatch, _restored, isCurrent) => {
        await beforeDispatch();
        assert.equal(isCurrent(), true);
        assert.equal(current.find(item => item.id === message.id)?.submission?.status, 'sending');
        added.push(message.id);
        await duringDispatch?.();
        backend.set(message.id, 'server-' + message.id);
        return { serverAccepted: true };
      },
    },
  };
  return { options, backend, added, sent, messages: () => current,
    duringDispatch: (callback: () => Promise<void>) => { duringDispatch = callback; } };
}

test('legacy queue migration uses client IDs, preserves order and leaves special settings and later intents durable', async () => {
  const bridge = new BrowserStateConvergence(storage());
  const queue = queueFixture([{ id: 'accepted', submission: { status: 'outcome-unknown' } }, { id: 'first' },
    { id: 'special', specialSettings: true }, { id: 'after-special' }, { id: 'already-in-queue' }]);
  queue.sent.add('accepted');
  queue.backend.set('already-in-queue', 'native-id');
  await bridge.migrateQueuedFollowUps(queue.options);
  assert.deepEqual(queue.added, ['first']);
  assert.deepEqual(queue.messages().map(item => item.id), ['special', 'after-special']);
  assert.equal(queue.messages()[0].specialSettings, true);
});

test('pending, uncertain and paused submissions are never replayed by migration', async () => {
  for (const intent of [
    { id: 'pending', submission: { status: 'pending' } },
    { id: 'unknown', submission: { status: 'outcome-unknown' } },
    { id: 'paused', pausedReason: 'permissions-unavailable' },
    { id: 'ephemeral', localOnly: true },
  ]) {
    const queue = queueFixture([intent, { id: 'later' }]);
    await new BrowserStateConvergence(storage()).migrateQueuedFollowUps(queue.options);
    assert.deepEqual(queue.added, []);
    assert.deepEqual(queue.messages(), [intent, { id: 'later' }]);
  }
});

test('lost add responses pause the local intent, then backend acknowledgement removes it without another add', async () => {
  const bridge = new BrowserStateConvergence(storage());
  const queue = queueFixture([{ id: 'uncertain' }]);
  queue.duringDispatch(async () => {
    queue.backend.set('uncertain', 'accepted-on-server');
    throw new Error('connection lost');
  });
  await assert.rejects(bridge.migrateQueuedFollowUps(queue.options), /connection lost/);
  assert.equal(queue.messages()[0].submission?.status, 'outcome-unknown');
  assert.equal(queue.messages()[0].pausedReason, 'submission-outcome-unknown');
  await bridge.migrateQueuedFollowUps(queue.options);
  assert.deepEqual(queue.messages(), []);
  assert.deepEqual(queue.added, ['uncertain']);
});

test('simultaneous queue loads share migration and do not enqueue an intent twice', async () => {
  const bridge = new BrowserStateConvergence(storage());
  const queue = queueFixture([{ id: 'once' }]);
  await Promise.all([bridge.migrateQueuedFollowUps(queue.options), bridge.migrateQueuedFollowUps(queue.options)]);
  assert.deepEqual(queue.added, ['once']);
});

test('PR bodies migrate through backend list/add; branch navigation and independent metadata survive', async () => {
  const attachmentKey = 'pull-request-attachment-records-v3';
  const saved = storage({ 'native-atoms': JSON.stringify({
    [attachmentKey]: [{ hostId: 'ssh-fixture', conversationId: 'thread', attachments: [
      { url: 'https://example.test/pr/1', root: '/repo', headBranch: 'feature' }, { url: null, root: '/repo', headBranch: 'draft' },
    ] }], 'pull-request-chat-associations-v2': { pr: 'thread' }, 'pull-request-attachment-backfill-completed-v1': ['thread'],
  }), ['codex:persisted-atom:' + attachmentKey]: JSON.stringify([{ hostId: 'ssh-fixture', conversationId: 'thread',
    attachments: [{ url: 'https://example.test/pr/1', root: '/stale-repo', headBranch: 'stale-feature' }] }]) });
  const bridge = new BrowserStateConvergence(saved);
  const backend = new Map<string, ObjectValue>();
  const calls: string[] = [];
  const send = async (method: string, params: ObjectValue) => {
    calls.push(method);
    if (method.endsWith('/add')) { backend.set(String(params.identityKey), params); return {}; }
    return { data: [...backend.values()], nextCursor: null };
  };
  const canonicalize = (attachment: ObjectValue) => typeof attachment.url === 'string' ? { identityKey: 'pr-1', payload: attachment } : null;
  await bridge.migrateAttachments({ hostId: 'ssh-fixture', conversationId: 'thread' }, send, canonicalize);
  assert.deepEqual(calls, ['thread/attachment/list', 'thread/attachment/add', 'thread/attachment/list']);
  assert.deepEqual(backend.get('pr-1')?.payload, { url: 'https://example.test/pr/1', root: '/repo', headBranch: 'feature' });
  assert.equal(saved.getItem('codex:persisted-atom:' + attachmentKey), null);
  const atoms = JSON.parse(saved.getItem('native-atoms')!);
  assert.deepEqual(atoms[attachmentKey][0].attachments, [{ url: null, root: '/repo', headBranch: 'draft' }]);
  assert.deepEqual(atoms['pull-request-chat-associations-v2'], { pr: 'thread' });
  assert.deepEqual(atoms['pull-request-attachment-backfill-completed-v1'], ['thread']);
  await bridge.migrateAttachments({ hostId: 'ssh-fixture', conversationId: 'thread' }, send, canonicalize);
  assert.equal(calls.length, 3);
});

test('failed or unconfirmed attachment migration retains its durable source', async () => {
  const key = 'codex:persisted-atom:pull-request-attachment-records-v3';
  const original = JSON.stringify([{ hostId: 'local', conversationId: 'thread', attachments: [{ url: 'https://example.test/pr/1' }] }]);
  const saved = storage({ [key]: original });
  const bridge = new BrowserStateConvergence(saved);
  const canonicalize = () => ({ identityKey: 'pr', payload: { url: 'https://example.test/pr/1' } });
  await assert.rejects(bridge.migrateAttachments({ hostId: 'local', conversationId: 'thread' }, async method => {
    if (method.endsWith('/add')) throw new Error('offline');
    return { data: [], nextCursor: null };
  }, canonicalize), /offline/);
  assert.equal(saved.getItem(key), original);
  await bridge.migrateAttachments({ hostId: 'local', conversationId: 'thread' }, async () => ({ data: [], nextCursor: null }), canonicalize);
  assert.equal(saved.getItem(key), original);
});

test('fixed renderer changes actual queue gates and parses with the pinned version', async () => {
  const path = '/assets/app-initial-a68277f60b93.js';
  const original = await readFile(new URL('../vendor/codex-app/26.1013.40934/webview' + path, import.meta.url));
  const adapted = adaptStateConvergence(path, original).toString();
  await transform(adapted, { target: 'esnext' });
  assert.ok(adapted.includes('be=I?rSo(i,L,R,pe,o):null'));
  assert.ok(adapted.includes('_D=nc(q,window.workbenchStateConvergence.legacyAttachmentRecords())'));
  assert.ok(adapted.includes('this.options.getStreamRole(e)?.role===`owner`'));
  assert.throws(() => adaptStateConvergence(path, Buffer.from('changed snapshot')), /固定界面版本不匹配/);
  const begin = adapted.indexOf('function Xjn('), end = adapted.indexOf('function Zjn(', begin);
  const context = vm.createContext({ nx: () => false, og: () => false, Oc: () => true,
    lse: () => true, Qr: (id: string) => id,
    OT: { default: (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right) },
  });
  const createQueue = vm.runInContext('(' + adapted.slice(begin, end) + ')', context);
  const manager = { getHostId: () => 'ssh-fixture', getConversation: () => ({ resumeState: 'resumed',
    latestThreadSettings: { permissions: ':workspace', approvalsReviewer: 'user', serviceTier: null } }),
    hasPendingThreadSettingsUpdate: () => false, addNotificationCallback: () => () => {} };
  const queue = createQueue({ scope: {}, manager, appServerVersion: () => '0.164.0' });
  assert.equal(queue.isEnabled('thread'), true, 'Yard must not depend on a desktop rollout for native queues');
  assert.equal(queue.canEnqueue('thread', { context: {}, submissionOptions: { executionHostId: 'ssh-fixture',
    permissionProfileId: ':workspace', serviceTier: null } }), true);
  assert.equal(queue.canEnqueue('thread', { context: {}, submissionOptions: { executionHostId: 'ssh-fixture',
    permissionProfileId: ':workspace', serviceTier: null, shouldSendPermissionOverrides: true } }), false);
  assert.equal(queue.canEnqueue('thread', { context: { requiresLocalPreparation: true } }), false);
});
