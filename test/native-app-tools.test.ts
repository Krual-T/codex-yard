import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { test, type TestContext } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { CodexConnection } from '../lib/codex.ts';
import { createNativeAppToolHost, type NativeAppToolsOptions } from '../lib/native-app-tools.ts';
import { record } from '../src/native/protocol.ts';
import { catalog, schemas, delegationTurnInput, formatAssistantMessage, nativeParentThread, success, validateModel, ThreadWaiter } from '../lib/native-tool-kernel.ts';
import type { NativeManager } from '../lib/native-tool-kernel.ts';
import { agentItem, commandItem, createFakeCodex, fixtureThread, fixtureTurn } from './fake-codex.ts';

async function fixture(t: TestContext, overrides: Partial<NativeAppToolsOptions> = {}) {
  const root = await mkdtemp('/tmp/yard-native-kernel-');
  const fake = await createFakeCodex(root);
  const connection = new CodexConnection(fake.socketPath);
  await connection.connect();
  const caller = fixtureThread('caller', root);
  const target = fixtureThread('target', root, { turns: [fixtureTurn('finished', [agentItem('answer', '**Answer** &amp; result')])] });
  fake.threads.set(caller.id, caller); fake.threads.set(target.id, target);
  const globals: Record<string, unknown> = {};
  const connectedHosts: string[] = [];
  const host = createNativeAppToolHost({ connectionFor: async hostId => {
    connectedHosts.push(hostId);
    if (hostId !== 'local') throw new Error('Offline SSH fixture');
    return connection;
  }, hostIds: () => ['local'], globals,
    listProjects: async () => [{ projectId: root, projectKind: 'local', label: 'Fixture', path: root,
      hostId: 'local', hostDisplayName: null, isGitRepository: false }], projectlessRoot: root + '/workspaces',
    configFor: () => ({ 'mcp_servers.codex_app': { enabled: true } }), persistGlobals: async () => {}, setMembership: async () => {}, ...overrides });
  let nextCall = 0;
  function call(tool: string, args: unknown, signal = new AbortController().signal, callId = String(++nextCall)) {
    return host.callTool({ callerSource: 'codex', hostId: 'local', namespace: 'codex_app', tool,
      threadId: caller.id, turnId: 'calling-turn', callId, arguments: args }, { signal });
  }
  t.after(async () => { await host.close(); connection.close(); await fake.close(); await rm(root, { recursive: true, force: true }); });
  return { root, fake, connection, caller, target, call, host, globals, connectedHosts };
}
function data(value: { success: boolean; contentItems: { text: string }[] }) {
  assert.equal(value.success, true, JSON.stringify(value));
  return record(JSON.parse(value.contentItems[0]!.text));
}

test('copied native schemas enforce nested targets, original limits and closed arguments', () => {
  assert.equal(catalog.length, 12);
  assert.equal(schemas.create_thread!.safeParse({ prompt: 'work', target: { type: 'project', projectId: 'repo', environment: { type: 'local' } } }).success, true);
  assert.equal(schemas.create_thread!.safeParse({ prompt: 'work', target: { type: 'project', projectId: 'repo', environment: { type: 'invented' } } }).success, false);
  assert.equal(schemas.read_thread!.safeParse({ threadId: 'thread', turnLimit: 11 }).success, false);
  assert.equal(schemas.wait_threads!.safeParse({ targets: Array.from({ length: 9 }, (_, i) => ({ threadId: String(i) })) }).success, false);
  assert.equal(schemas.set_thread_title!.safeParse({ title: 'name', invented: true }).success, false);
});

test('native read history preserves turn cursors and caps only explicitly included outputs', async t => {
  const h = await fixture(t);
  h.target.turns.unshift(fixtureTurn('older', [commandItem('command', '0123456789', h.root)]));
  h.fake.handlers.set('thread/turns/list', params => {
    assert.equal(params.limit, 1);
    return params.cursor ? { data: [h.target.turns[0]], nextCursor: null } : { data: [h.target.turns[1]], nextCursor: 'older-page' };
  });
  const latest = data(await h.call('read_thread', { threadId: 'target', turnLimit: 1 }));
  assert.equal(record(latest.page).hasMore, true);
  const older = data(await h.call('read_thread', { threadId: 'target', cursor: record(latest.page).nextCursor,
    turnLimit: 1, includeOutputs: true, maxOutputCharsPerItem: 3 }));
  const turn = record((older.turns as unknown[])[0]), item = record((turn.items as unknown[])[0]);
  assert.deepEqual(item.output, { text: '012', truncated: true, originalChars: 10 });
  assert.equal(h.fake.calls('thread/resume').length, 0);
  assert.equal(h.fake.calls('turn/start').length, 0);
});

test('native wait cursors suppress repeated final text and reset foreign cursors', async t => {
  const h = await fixture(t);
  const first = data(await h.call('wait_threads', { targets: [{ threadId: 'target' }], timeoutMs: 0 }));
  const snapshot = record((first.polls as unknown[])[0]);
  assert.equal(record(snapshot.latestAssistantMessage).text, 'Answer & result');
  const repeated = data(await h.call('wait_threads', { targets: [{ threadId: 'target', afterCursor: snapshot.cursor }], timeoutMs: 0 }));
  assert.equal(record((repeated.polls as unknown[])[0]).changed, false);
  assert.equal(record((repeated.polls as unknown[])[0]).latestAssistantMessage, null);
  const reset = data(await h.call('wait_threads', { targets: [{ threadId: 'target', afterCursor: 'another-generation:1' }], timeoutMs: 0 }));
  assert.equal(record((reset.polls as unknown[])[0]).cursorReset, true);
});

test('commentary does not wake native wait; cancellation does not interrupt its target', async t => {
  const h = await fixture(t);
  h.target.status = { type: 'active', activeFlags: [] };
  h.target.turns = [fixtureTurn('running', [], 'inProgress')];
  const controller = new AbortController();
  let settled = false;
  const result = h.call('wait_threads', { targets: [{ threadId: 'target' }], timeoutMs: 10_000 }, controller.signal)
    .finally(() => { settled = true; });
  const assertion = assert.rejects(result, { name: 'AbortError' });
  await h.fake.waitForCall('thread/turns/list');
  h.fake.broadcast({ method: 'item/agentMessage/delta', params: { threadId: 'target', turnId: 'running', itemId: 'commentary', delta: 'Progress' } });
  await h.call('list_projects', {});
  assert.equal(settled, false);
  controller.abort(); await assertion;
  assert.equal(h.fake.calls('turn/interrupt').length, 0);
});

test('native send keeps destination settings and replays one business call without sending twice', async t => {
  const h = await fixture(t);
  h.fake.handlers.set('thread/loaded/list', () => ({ data: ['target'] }));
  h.caller.turns = [{ ...fixtureTurn('calling-turn'), rootTurnId: 'original-root' }];
  h.fake.handlers.set('thread/read', params => {
    const thread = h.fake.threads.get(String(params.threadId));
    return { thread: { ...thread, turns: params.includeTurns ? thread!.turns : [] } };
  });
  await Promise.all([h.call('send_message_to_thread', { threadId: 'target', prompt: 'Continue' }, undefined, 'same-call'),
    h.call('send_message_to_thread', { threadId: 'target', prompt: 'Continue' }, undefined, 'same-call')]);
  assert.equal(h.fake.calls('turn/start').length, 1);
  assert.equal(h.fake.calls('thread/resume')[0]!.params.config, undefined);
  const input = h.fake.calls('turn/start')[0]!.params;
  assert.equal(input.model, undefined); assert.equal(input.effort, undefined);
  assert.equal(input.parentTurnId, 'calling-turn'); assert.equal(input.rootTurnId, 'original-root');
  assert.match(JSON.stringify(input.input), /codex_delegation/);
  assert.equal(h.fake.calls('turn/steer').length, 0);
});

test('local read, title and wait do not connect unrelated offline SSH hosts', async t => {
  const h = await fixture(t, { hostIds: () => ['local', 'offline-ssh'] });
  data(await h.call('read_thread', { threadId: 'target' }));
  data(await h.call('set_thread_title', { threadId: 'target', title: 'Local' }));
  data(await h.call('wait_threads', { targets: [{ threadId: 'target', hostId: 'local' }], timeoutMs: 0 }));
  const refused = await h.call('set_thread_archived', { threadId: 'target', hostId: 'unknown-host', archived: true });
  assert.equal(refused.success, false);
  assert.equal(h.fake.calls('thread/archive').length, 0);
  assert.ok(h.connectedHosts.every(hostId => hostId === 'local'));
});

test('send injects the stable host into an unloaded target', async t => {
  const h = await fixture(t);
  h.fake.handlers.set('thread/loaded/list', () => ({ data: [] }));
  data(await h.call('send_message_to_thread', { threadId: 'target', prompt: 'Resume with tools' }));
  assert.deepEqual(h.fake.calls('thread/resume')[0]!.params.config, { 'mcp_servers.codex_app': { enabled: true } });
});

test('fallback reconnects a previously used remote host after its connection drops', async t => {
  const remoteRoot = await mkdtemp('/tmp/yard-native-remote-');
  const remoteFake = await createFakeCodex(remoteRoot);
  const remoteThread = fixtureThread('remote-target', remoteRoot);
  remoteFake.threads.set(remoteThread.id, remoteThread);
  let local!: CodexConnection, remote = new CodexConnection(remoteFake.socketPath), remoteLookups = 0;
  const h = await fixture(t, { hostIds: () => ['local', 'remote'], connectionFor: async hostId => {
    if (hostId === 'local') return local;
    ++remoteLookups;
    if (!remote.connected) { remote = new CodexConnection(remoteFake.socketPath); await remote.connect(); }
    return remote;
  } });
  local = h.connection;
  t.after(async () => { remote.close(); await remoteFake.close(); await rm(remoteRoot, { recursive: true, force: true }); });
  data(await h.call('read_thread', { threadId: 'remote-target', hostId: 'remote' }));
  remote.close();
  data(await h.call('read_thread', { threadId: 'remote-target' }));
  assert.equal(remoteLookups, 3);
});

test('send cancelled during the loaded-state read never resumes or starts the target', async t => {
  const h = await fixture(t);
  let release!: () => void;
  h.fake.handlers.set('thread/loaded/list', async () => {
    await new Promise<void>(resolve => { release = resolve; }); return { data: [] };
  });
  const controller = new AbortController();
  const pending = h.call('send_message_to_thread', { threadId: 'target', prompt: 'Cancelled' }, controller.signal);
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await h.fake.waitForCall('thread/loaded/list');
  controller.abort(); release(); await rejected;
  assert.equal(h.fake.calls('thread/resume').length, 0); assert.equal(h.fake.calls('turn/start').length, 0);
});

test('native model validation rejects unknown models before creating projectless directories', async t => {
  const h = await fixture(t);
  h.fake.handlers.set('model/list', params => params.cursor ? { data: [{ model: 'second-page', supportedReasoningEfforts: [] }], nextCursor: null }
    : { data: [{ model: 'first-page', supportedReasoningEfforts: [] }], nextCursor: 'next' });
  const rejected = await h.call('create_thread', { prompt: 'Do work', model: 'missing-model', target: { type: 'projectless' } });
  assert.equal(rejected.success, false); assert.match(rejected.contentItems[0]!.text, /model/i);
  assert.equal(h.fake.calls('model/list').length, 2);
  assert.equal(h.fake.calls('thread/start').length, 0);
  assert.equal((await readdir(h.root)).includes('workspaces'), false);
});

test('read-state revision conflicts propagate without retrying the write', async t => {
  const h = await fixture(t);
  h.fake.handlers.set('thread/read', () => ({ thread: h.target, readState: { revision: 'old', firstUnread: null } }));
  h.fake.handlers.set('thread/readState/update', () => { throw new Error('read state revision conflict'); });
  const rejected = await h.call('set_thread_read_state', { threadId: 'target', read: false });
  assert.equal(rejected.success, false); assert.match(rejected.contentItems[0]!.text, /revision conflict/);
  assert.equal(h.fake.calls('thread/readState/update').length, 1);
});

test('cancelling a queued pin write leaves the completed write in place', async t => {
  let release!: () => void, started!: () => void, writes = 0;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const persisting = new Promise<void>(resolve => { started = resolve; });
  const h = await fixture(t, { persistGlobals: async () => { ++writes; started(); await blocked; } });
  const first = h.call('set_thread_pinned', { threadId: 'target', pinned: true });
  try {
    await persisting;
    const controller = new AbortController();
    const second = h.call('set_thread_pinned', { threadId: 'target', pinned: false }, controller.signal);
    const rejected = assert.rejects(second, { name: 'AbortError' });
    await h.fake.waitForCall('thread/read', 2); await setImmediate();
    controller.abort(); release();
    data(await first); await rejected;
    assert.equal(writes, 1); assert.deepEqual(h.globals['pinned-thread-ids'], ['target']);
  } finally { release(); }
});

test('failed pin persistence restores the prior pins and permits a subsequent write', async t => {
  let fail = true;
  const h = await fixture(t, { persistGlobals: async () => { if (fail) throw new Error('Fixture disk failure'); } });
  h.globals['pinned-thread-ids'] = ['caller'];
  const rejected = await h.call('set_thread_pinned', { threadId: 'target', pinned: true });
  assert.equal(rejected.success, false); assert.deepEqual(h.globals['pinned-thread-ids'], ['caller']);
  fail = false;
  data(await h.call('set_thread_pinned', { threadId: 'target', pinned: true }));
  assert.deepEqual(h.globals['pinned-thread-ids'], ['target', 'caller']);
});

test('native ancestor protection rejects parent messaging while allowing peer and same-directory fork operations', async t => {
  const h = await fixture(t);
  h.caller.parentThreadId = 'target';
  const refused = await h.call('send_message_to_thread', { threadId: 'target', prompt: 'Ancestral' });
  assert.equal(refused.success, false); assert.match(refused.contentItems[0]!.text, /native ancestor/);
  assert.equal(h.fake.calls('turn/start').length, 0);
  const fork = data(await h.call('fork_thread', { threadId: 'target' }));
  assert.equal(typeof fork.threadId, 'string');
  assert.equal(h.fake.calls('thread/fork').length, 1);
});

test('nested native target objects are closed and the twelve catalog names remain available', () => {
  assert.deepEqual(catalog.map(tool => tool.name), ['list_projects', 'create_thread', 'fork_thread', 'list_threads',
    'list_archived_threads', 'read_thread', 'wait_threads', 'send_message_to_thread', 'set_thread_pinned',
    'set_thread_archived', 'set_thread_title', 'set_thread_read_state']);
  const invalid = [
    { prompt: 'x', target: { type: 'projectless', directoryName: 'out', extra: true } },
    { prompt: 'x', target: { type: 'project', projectId: 'repo', environment: { type: 'local', extra: true } } },
    { prompt: 'x', target: { type: 'project', projectId: 'repo', environment: { type: 'worktree', startingState: { type: 'branch', branchName: 'main', extra: true } } } },
  ];
  for (const args of invalid) assert.equal(schemas.create_thread!.safeParse(args).success, false);
  assert.equal(schemas.wait_threads!.safeParse({ targets: [{ threadId: 'target', unknown: true }] }).success, false);
  assert.equal(schemas.wait_threads!.safeParse({ targets: [{ threadId: 'target' }], timeoutMs: 120_001 }).success, false);
  assert.match(catalog.find(tool => tool.name === 'send_message_to_thread')!.description, /human user explicitly authorizes/);
});

test('delegation is escaped and uses toolOutput only on supported app-server versions', () => {
  const args = { sourceThreadId: 'parent<&', input: 'do <work> & report', toolName: 'send_message_to_thread' };
  const old = delegationTurnInput({ ...args, appServerVersion: '0.151.0-alpha.3' });
  assert.equal(old.toolOutput, undefined);
  assert.match(old.input[0]!.text, /parent&lt;&amp;/);
  assert.match(old.input[0]!.text, /do &lt;work&gt; &amp; report/);
  for (const version of ['0.151.0-alpha.4', '0.163.0', '0.164.0', '0.0.0']) {
    const supported = delegationTurnInput({ ...args, appServerVersion: version });
    assert.deepEqual(supported.input, []);
    assert.equal(supported.toolOutput?.namespace, 'codex_app');
    assert.equal(supported.toolOutput?.output, old.input[0]!.text);
  }
});

test('native model validation and assistant filtering preserve explicit failures', () => {
  const models = [{ model: 'fixture', description: '', supportedReasoningEfforts: [{ reasoningEffort: 'low' }] }];
  assert.equal(validateModel('fixture', 'low', models), null);
  assert.match(validateModel('fixture', 'high', models)!, /does not support "high"/);
  assert.match(validateModel('missing', undefined, models)!, /could not validate model/);
  assert.deepEqual(formatAssistantMessage(':: SKIP_COMPLETION ::'), { content: '', removed: true, isSkippedCompletion: true });
  assert.equal(formatAssistantMessage('ok <oai-mem-citation>secret</oai-mem-citation> end').content, 'ok  end');
  assert.equal(formatAssistantMessage('literal `<oai-mem-citation>` stays').content, 'literal `<oai-mem-citation>` stays');
  assert.equal(formatAssistantMessage('a `<oai-mem-citation>` b <oai-mem-citation>unfinished').content, 'a `<oai-mem-citation>` b');
  assert.throws(() => success({ value: 'x'.repeat(1_048_576) }), /size limit/);
  assert.equal(nativeParentThread({ id: 'child', name: null, cwd: '/', status: { type: 'idle' }, turns: [],
    source: { subAgent: { thread_spawn: { parent_thread_id: 'parent' } } } } as Parameters<typeof nativeParentThread>[0]), 'parent');
});

test('legacy history uses old turn cursors and fails unknown cursors without any write', async t => {
  const h = await fixture(t);
  h.target.historyMode = 'legacy';
  h.target.turns = [fixtureTurn('old', [agentItem('old-message', 'old')]), fixtureTurn('new', [agentItem('new-message', 'new')])];
  h.fake.handlers.set('thread/read', params => ({ thread: { ...h.target, turns: params.includeTurns ? h.target.turns : [] } }));
  const newest = data(await h.call('read_thread', { threadId: 'target', turnLimit: 1 }));
  assert.equal(record(newest.page).nextCursor, 'new');
  const older = data(await h.call('read_thread', { threadId: 'target', turnLimit: 1, cursor: 'new' }));
  assert.equal(record((older.turns as unknown[])[0]).id, 'old');
  const unknown = await h.call('read_thread', { threadId: 'target', cursor: 'missing' });
  assert.equal(unknown.success, false);
  assert.match(unknown.contentItems[0]!.text, /Unknown cursor/);
  assert.equal(h.fake.calls('thread/turns/list').length, 0);
  assert.equal(h.fake.calls('turn/start').length, 0);
});

test('passive wait reports an actual peer disconnect and does not interrupt the target', async t => {
  const h = await fixture(t);
  h.target.status = { type: 'active', activeFlags: [] };
  h.target.turns = [fixtureTurn('running', [], 'inProgress')];
  const pending = h.call('wait_threads', { targets: [{ threadId: 'target' }], timeoutMs: 10_000 });
  await h.fake.waitForCall('thread/turns/list');
  await h.call('list_projects', {});
  h.fake.disconnect();
  const value = data(await pending);
  assert.equal(value.wake, null);
  assert.match(record((value.errors as unknown[])[0]).message as string, /disconnect/i);
  assert.equal(h.fake.calls('turn/interrupt').length, 0);
});

test('a completed turn notification wakes the passive wait with the final message', async t => {
  const h = await fixture(t);
  h.target.status = { type: 'active', activeFlags: [] };
  h.target.turns = [fixtureTurn('running', [], 'inProgress')];
  const pending = h.call('wait_threads', { targets: [{ threadId: 'target' }], timeoutMs: 10_000 });
  await h.fake.waitForCall('thread/turns/list');
  await h.call('list_projects', {});
  const finished = fixtureTurn('running', [agentItem('final', 'Final **result**')]);
  h.target.turns = [finished];
  h.target.status = { type: 'idle' };
  h.fake.broadcast({ method: 'turn/completed', params: { threadId: 'target', turn: finished } });
  const result = data(await pending);
  assert.equal(record(result.wake).reason, 'turnCompleted');
  assert.equal(record(record((result.polls as unknown[])[0]).latestAssistantMessage).text, 'Final result');
  assert.equal(h.fake.calls('turn/interrupt').length, 0);
});

test('a slower concurrent history read cannot replace a newer completed poll', async t => {
  const h = await fixture(t);
  const old = fixtureTurn('old', [agentItem('old-message', 'Old result')]);
  old.startedAt = 1;
  const fresh = fixtureTurn('fresh', [agentItem('fresh-message', 'Fresh result')]);
  fresh.startedAt = 2;
  let release!: () => void, calls = 0;
  h.fake.handlers.set('thread/turns/list', async () => {
    if (++calls === 1) {
      await new Promise<void>(resolve => { release = resolve; });
      return { data: [old], nextCursor: null };
    }
    return { data: [fresh], nextCursor: null };
  });
  const first = h.call('wait_threads', { targets: [{ threadId: 'target' }], timeoutMs: 0 });
  await h.fake.waitForCall('thread/turns/list');
  const second = data(await h.call('wait_threads', { targets: [{ threadId: 'target' }], timeoutMs: 0 }));
  release();
  const stale = data(await first);
  const newestPoll = record((second.polls as unknown[])[0]);
  const olderPoll = record((stale.polls as unknown[])[0]);
  assert.equal(olderPoll.cursor, newestPoll.cursor);
  assert.equal(record(olderPoll.latestTurn).id, 'fresh');
  assert.equal(record(olderPoll.latestAssistantMessage).text, 'Fresh result');
});

test('same-host reconnection starts a new cursor generation', async t => {
  let active!: CodexConnection;
  const h = await fixture(t, { connectionFor: async () => active });
  active = h.connection;
  const first = data(await h.call('wait_threads', { targets: [{ threadId: 'target' }], timeoutMs: 0 }));
  const cursor = record((first.polls as unknown[])[0]).cursor;
  active.close();
  active = new CodexConnection(h.fake.socketPath);
  await active.connect();
  t.after(() => active.close());
  const second = data(await h.call('wait_threads', { targets: [{ threadId: 'target', afterCursor: cursor }], timeoutMs: 0 }));
  assert.equal(record((second.polls as unknown[])[0]).cursorReset, true);
});

test('wait summaries preserve markdown content while excluding internal and executable HTML', async t => {
  const h = await fixture(t);
  for (const [input, expected] of [
    ['one\n\ntwo', 'one two'],
    ['::notice[title]{.box}', 'title'],
    [':::note\ninside\n:::', 'inside'],
    ['one\uE200hidden\uE201two', 'onetwo'],
    ['<p>Hello <b>world</b></p>', 'Hello world'],
    ['<script>secret()</script><p>visible</p>', 'visible'],
    ['<heartbeat><decision>DONT_NOTIFY</decision><message>note</message></heartbeat>', 'note'],
    ['<heartbeat><message>unknown</message></heartbeat>', 'unknown'],
  ]) {
    h.target.turns = [fixtureTurn('done', [agentItem('final', input!)])];
    const result = data(await h.call('wait_threads', { targets: [{ threadId: 'target' }], timeoutMs: 0 }));
    assert.equal(record(record((result.polls as unknown[])[0]).latestAssistantMessage).text, expected);
  }
});

test('the host sends a delegated 0.164 toolOutput to the original target', async t => {
  const h = await fixture(t);
  h.connection.server = { userAgent: 'codex/0.164.0' };
  data(await h.call('send_message_to_thread', { threadId: 'target', prompt: 'Continue <carefully>' }));
  const request = h.fake.calls('turn/start')[0]!.params;
  assert.deepEqual(request.input, []);
  assert.equal(record(request.toolOutput).name, 'send_message_to_thread');
  assert.match(String(record(request.toolOutput).output), /Continue &lt;carefully&gt;/);
  assert.equal(h.fake.calls('turn/start').length, 1);
});

test('newer non-paginated histories translate turn-id cursors to daemon anchors', async t => {
  const h = await fixture(t);
  h.connection.server = { userAgent: 'codex/0.164.0' };
  h.target.historyMode = 'legacy';
  const newer = fixtureTurn('newer', [agentItem('newer-message', 'newer')]);
  const older = fixtureTurn('older', [agentItem('older-message', 'older')]);
  h.fake.handlers.set('thread/turns/list', params => params.cursor
    ? { data: [older], nextCursor: null } : { data: [newer], nextCursor: 'daemon-page-token' });
  const first = data(await h.call('read_thread', { threadId: 'target', turnLimit: 1 }));
  assert.equal(record(first.page).nextCursor, 'newer');
  const second = data(await h.call('read_thread', { threadId: 'target', turnLimit: 1, cursor: 'newer' }));
  assert.equal(record((second.turns as unknown[])[0]).id, 'older');
  assert.deepEqual(JSON.parse(String(h.fake.calls('thread/turns/list')[1]!.params.cursor)), { turnId: 'newer', includeAnchor: false });
});

test('wait wakes on actionable status without treating commentary as an event', async t => {
  const h = await fixture(t);
  h.target.status = { type: 'active', activeFlags: [] };
  h.target.turns = [fixtureTurn('running', [], 'inProgress')];
  const pending = h.call('wait_threads', { targets: [{ threadId: 'target' }], timeoutMs: 10_000 });
  await h.fake.waitForCall('thread/turns/list');
  await h.call('list_projects', {});
  h.target.status = { type: 'active', activeFlags: ['waitingOnApproval'] };
  h.fake.broadcast({ method: 'thread/status/changed', params: { threadId: 'target', status: h.target.status } });
  const value = data(await pending);
  assert.equal(record(value.wake).reason, 'actionableStatus');
  assert.equal(h.fake.calls('turn/interrupt').length, 0);
});

test('unqualified duplicate thread ids remain ambiguous across hosts', async () => {
  const reads: string[] = [];
  function manager(hostId: string): NativeManager {
    return { getHostId: () => hostId,
      async readThread() { reads.push(hostId); return { thread: { id: 'same', name: null, cwd: '/', status: { type: 'idle' }, turns: [] } }; },
      async listThreadTurns() { return { response: { data: [], nextCursor: null } }; },
      addNotificationCallback() { return () => {}; }, addThreadDeletedListener() { return () => {}; } };
  }
  const managers = [manager('local'), manager('remote')];
  const waiter = new ThreadWaiter({ getManagers: () => managers, subscribe: () => () => {} }, formatAssistantMessage);
  const signal = new AbortController().signal;
  await assert.rejects(waiter.resolveThreadHost({ threadId: 'same', signal }), /Ambiguous.*local, remote/);
  reads.length = 0;
  assert.equal((await waiter.resolveThreadHost({ preferredHostId: 'local', threadId: 'same', signal })).hostId, 'local');
  assert.deepEqual(reads, ['local']);
});
