import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { CodexConnection } from '../lib/codex.ts';
import { createSideChatHost } from '../src/native/side-chat.ts';
import type { SideChatOperation, SideChatStore } from '../src/native/side-chat.ts';
import { resolveSideChatParent } from '../src/native/side-chat-parent.ts';
import type { SideChatParentIdentity, SideChatParentPort, SideChatParentSnapshot } from '../src/native/side-chat-parent.ts';
import { createStateMutations } from '../src/native/state-mutations.ts';
import { createFakeCodex } from './fake-codex.ts';

type Value = Record<string, any>;
const identity = (): SideChatParentIdentity => ({ hostId: 'local', threadId: 'parent', connectionGeneration: 'socket-1' });
const copy = <T>(value: T): T => structuredClone(value);

// Anonymized fields from side-chat-cli-TVfg6O/result-{163,164}.json, steps.start.value.
function cliReceipt(): Value {
  return { thread: { id: 'parent', cwd: '/fixture/workspace', model: 'fixture-model', modelProvider: 'openai', reasoningEffort: null,
    environments: [{ environmentId: 'local', cwd: '/fixture/workspace', runtimeWorkspaceRoots: ['/fixture/workspace', '/fixture/extra'] }] },
  model: 'fixture-model', modelProvider: 'openai', serviceTier: null, cwd: '/fixture/workspace',
  runtimeWorkspaceRoots: ['/fixture/workspace', '/fixture/extra'], approvalPolicy: 'on-request', approvalsReviewer: 'user',
  sandbox: { type: 'readOnly', networkAccess: false }, activePermissionProfile: { id: ':read-only', extends: null }, reasoningEffort: null };
}

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'yard-h-parent-'));
  const peer = await createFakeCodex(root);
  const connection = new CodexConnection(peer.socketPath, { timeout: 1000 });
  await connection.connect();
  const socket = connection.socket;
  const mutations = createStateMutations();
  let revision = 'revision-1', generation = 'socket-1', authorized = true;
  let snapshot: SideChatParentSnapshot = { ...identity(), revision, response: cliReceipt(), project: { id: 'project', roots: ['/fixture/workspace'] },
    forkConfig: { 'mcp_servers.codex_app': { command: '/fixture/adapter' } } };
  const port: SideChatParentPort = {
    runScoped: action => mutations.run(action),
    capture: () => snapshot,
    assertCurrent(value) {
      if (!authorized || revision !== value || generation !== snapshot.connectionGeneration || !connection.connected || !socket
        || connection.socket !== socket || socket.readyState !== socket.OPEN) throw new Error('original scope changed');
    },
    request: (method, params) => connection.request(method, params),
  };
  peer.handlers.set('thread/list', params => ({ data: params.archived ? [] : [{ id: 'parent' }], nextCursor: null }));
  t.after(async () => { connection.close(); await peer.close(); await rm(root, { recursive: true, force: true }); });
  return { peer, connection, socket, mutations, port, identity: identity(),
    source: () => snapshot, replace(value: SideChatParentSnapshot) { snapshot = value; },
    revision(value: string) { revision = value; }, generation(value: string) { generation = value; },
    authorize(value: boolean) { authorized = value; } };
}

function gate() {
  let resolve!: () => void;
  return { promise: new Promise<void>(done => { resolve = done; }), resolve: () => resolve() };
}

test('maps the two retained CLI receipt shapes without defaulting roots, model, permissions or instructions', async t => {
  for (const version of ['0.163.0-alpha.10.2', '0.164.0']) {
    const f = await fixture(t), response = cliReceipt();
    response.thread.cliVersion = version;
    f.source().response = response;
    f.source().archive = { archived: false, source: 'directory' };
    const result = await resolveSideChatParent(f.identity, f.port);
    assert.deepEqual(result, { ...f.identity, cwd: '/fixture/workspace', workspaceRoots: ['/fixture/workspace', '/fixture/extra'], archived: false,
      model: 'fixture-model', modelProvider: 'openai', effort: null, serviceTier: null,
      submitOptions: { model: 'fixture-model', effort: null, serviceTier: null, approvalPolicy: 'on-request', approvalsReviewer: 'user',
        permissionProfileId: ':read-only', sandboxMode: 'read-only' },
      sandboxPolicy: { type: 'readOnly', networkAccess: false }, project: { id: 'project', roots: ['/fixture/workspace'] },
      forkConfig: { 'mcp_servers.codex_app': { command: '/fixture/adapter' } } });
    response.runtimeWorkspaceRoots.push('/fixture/changed');
    (f.source().project as Value).id = 'changed';
    assert.deepEqual(result.workspaceRoots, ['/fixture/workspace', '/fixture/extra']);
    assert.equal((result.project as Value).id, 'project');
    assert.equal(f.peer.calls('thread/list').length, 0);
  }
});

test('empty and multi-environment roots use the authoritative top level, with only an unambiguous environment fallback', async t => {
  const f = await fixture(t), response = cliReceipt();
  f.source().response = response; f.source().archive = { archived: false, source: 'directory' };
  response.runtimeWorkspaceRoots = [];
  response.thread.environments.push({ environmentId: 'other', cwd: '/other', runtimeWorkspaceRoots: ['/other'] });
  assert.deepEqual((await resolveSideChatParent(f.identity, f.port)).workspaceRoots, []);
  response.runtimeWorkspaceRoots = ['/current', '/second'];
  assert.deepEqual((await resolveSideChatParent(f.identity, f.port)).workspaceRoots, ['/current', '/second']);
  delete response.runtimeWorkspaceRoots;
  await assert.rejects(resolveSideChatParent(f.identity, f.port), /工作区根目录/);
  response.thread.environments.pop();
  assert.deepEqual((await resolveSideChatParent(f.identity, f.port)).workspaceRoots, ['/fixture/workspace', '/fixture/extra']);
  response.thread.environments[0].cwd = '/different';
  await assert.rejects(resolveSideChatParent(f.identity, f.port), /工作区根目录/);
  response.runtimeWorkspaceRoots = ['/valid', 'relative'];
  await assert.rejects(resolveSideChatParent(f.identity, f.port), /工作区根目录/);
  response.runtimeWorkspaceRoots = ['/valid', '/bad\0path'];
  await assert.rejects(resolveSideChatParent(f.identity, f.port), /工作区根目录/);
});

test('missing or empty settings fail while future nonempty effort and tier remain exact', async t => {
  const f = await fixture(t), response = cliReceipt();
  f.source().response = response; f.source().archive = { archived: false, source: 'directory' };
  response.reasoningEffort = 'future-effort'; response.serviceTier = 'future-tier';
  f.source().developerOverride = { value: '', source: 'verified-runtime' };
  const result = await resolveSideChatParent(f.identity, f.port);
  assert.equal(result.effort, 'future-effort'); assert.equal(result.serviceTier, 'future-tier');
  assert.deepEqual(result.developerOverride, { value: '', source: 'verified-runtime' });
  response.reasoningEffort = '';
  await assert.rejects(resolveSideChatParent(f.identity, f.port), /推理强度/);
  response.reasoningEffort = '  ';
  await assert.rejects(resolveSideChatParent(f.identity, f.port), /推理强度/);
  delete response.reasoningEffort;
  await assert.rejects(resolveSideChatParent(f.identity, f.port), /推理强度/);
  response.reasoningEffort = null; delete response.serviceTier;
  await assert.rejects(resolveSideChatParent(f.identity, f.port), /服务等级/);
  response.serviceTier = null; response.model = '';
  await assert.rejects(resolveSideChatParent(f.identity, f.port), /模型/);
  response.model = 'fixture-model'; delete response.modelProvider;
  await assert.rejects(resolveSideChatParent(f.identity, f.port), /模型/);
});

test('retains full sandbox and granular policy and refuses unrepresentable or unknown permission data', async t => {
  const f = await fixture(t), response = cliReceipt();
  f.source().response = response; f.source().archive = { archived: false, source: 'directory' };
  response.approvalPolicy = { granular: { sandbox_approval: false, rules: true, skill_approval: false,
    request_permissions: true, mcp_elicitations: true, future: 'retained' } };
  response.sandbox = { type: 'workspaceWrite', writableRoots: ['/fixture/workspace', '/fixture/extra'], networkAccess: true,
    excludeTmpdirEnvVar: true, excludeSlashTmp: false, future: { retained: true } };
  response.activePermissionProfile = { id: 'custom-profile', extends: null };
  response.collaborationMode = { mode: 'plan' };
  const result = await resolveSideChatParent(f.identity, f.port);
  assert.deepEqual(result.sandboxPolicy, response.sandbox);
  assert.deepEqual(result.submitOptions.approvalPolicy, response.approvalPolicy);
  assert.equal(result.submitOptions.permissionProfileId, 'custom-profile');
  assert.equal(result.submitOptions.sandboxMode, 'workspace-write');
  assert.equal(result.submitOptions.mode, 'plan');
  delete response.activePermissionProfile;
  await assert.rejects(resolveSideChatParent(f.identity, f.port), /权限配置/);
  response.activePermissionProfile = null; response.sandbox = { type: 'externalSandbox', networkAccess: 'restricted' };
  await assert.rejects(resolveSideChatParent(f.identity, f.port), /用于 fork/);
  response.activePermissionProfile = { id: 'custom-profile' };
  assert.equal((await resolveSideChatParent(f.identity, f.port)).submitOptions.permissionProfileId, 'custom-profile');
  response.activePermissionProfile = null; response.sandbox = { type: 'toString' };
  await assert.rejects(resolveSideChatParent(f.identity, f.port), /用于 fork/);
  response.sandbox = { type: 'readOnly', networkAccess: false }; response.approvalsReviewer = 'new-reviewer';
  await assert.rejects(resolveSideChatParent(f.identity, f.port), /审批方/);
  response.approvalsReviewer = 'user'; response.approvalPolicy = 'new-policy';
  await assert.rejects(resolveSideChatParent(f.identity, f.port), /审批策略/);
});

test('thread/read metadata alone and foreign snapshots cannot authorize a parent', async t => {
  const f = await fixture(t), raw = cliReceipt();
  f.source().response = { thread: raw.thread };
  await assert.rejects(resolveSideChatParent(f.identity, f.port), /工作目录/);
  f.source().response = raw; raw.thread.id = 'another-thread';
  await assert.rejects(resolveSideChatParent(f.identity, f.port), /原始会话回执/);
  raw.thread.id = 'parent';
  for (const changed of [{ hostId: 'other' }, { threadId: 'other' }, { connectionGeneration: 'other' }]) {
    await assert.rejects(resolveSideChatParent({ ...f.identity, ...changed }, f.port), /来源/);
  }
  delete (f.source() as Partial<SideChatParentSnapshot>).project;
  await assert.rejects(resolveSideChatParent(f.identity, f.port), /来源/);
  assert.equal(f.peer.calls('thread/list').length, 0);
});

test('queries actual active and archived directory pages for a positive exact identity', async t => {
  const f = await fixture(t);
  f.peer.handlers.set('thread/list', params => {
    if (params.archived === false) return { data: [{ id: 'other' }], nextCursor: null };
    if (!params.cursor) return { data: [{ id: 'first' }], nextCursor: 'page-2' };
    return { data: [{ id: 'parent' }], nextCursor: null };
  });
  assert.equal((await resolveSideChatParent(f.identity, f.port)).archived, true);
  const calls = f.peer.calls('thread/list');
  assert.deepEqual(calls.map(call => [call.params.archived, call.params.cursor]), [[false, null], [true, null], [true, 'page-2']]);
  for (const call of calls) {
    assert.deepEqual(call.params.sourceKinds, ['cli', 'vscode', 'exec', 'appServer', 'subAgent', 'subAgentReview',
      'subAgentCompact', 'subAgentThreadSpawn', 'subAgentOther', 'unknown']);
    assert.equal(Object.hasOwn(call.params, 'cwd'), false);
    assert.equal(Object.hasOwn(call.params, 'searchTerm'), false);
  }
  f.source().archive = { archived: true, source: 'notification' };
  assert.equal((await resolveSideChatParent(f.identity, f.port)).archived, true);
  assert.equal(f.peer.calls('thread/list').length, 3);
});

test('missing, malformed, cyclic and failed archive directories never imply unarchived', async t => {
  const f = await fixture(t);
  f.peer.handlers.set('thread/list', () => ({ data: [], nextCursor: null }));
  await assert.rejects(resolveSideChatParent(f.identity, f.port), /归档状态/);
  f.peer.handlers.set('thread/list', () => ({ data: [{ id: 7 }], nextCursor: null }));
  await assert.rejects(resolveSideChatParent(f.identity, f.port), /归档目录回执/);
  f.peer.handlers.set('thread/list', () => ({ data: [], nextCursor: 'repeat' }));
  await assert.rejects(resolveSideChatParent(f.identity, f.port), /归档目录分页/);
  f.peer.handlers.set('thread/list', () => { throw new Error('fixture directory unavailable'); });
  await assert.rejects(resolveSideChatParent(f.identity, f.port), /fixture directory unavailable/);
});

test('a late directory reply cannot cross a changed authority revision or socket generation', async t => {
  const f = await fixture(t), entered = gate(), release = gate();
  f.peer.handlers.set('thread/list', async () => { entered.resolve(); await release.promise; return { data: [{ id: 'parent' }], nextCursor: null }; });
  const pending = resolveSideChatParent(f.identity, f.port);
  await entered.promise; f.revision('revision-2'); release.resolve();
  await assert.rejects(pending, /original scope changed/);
  assert.equal(f.peer.calls('thread/list').length, 1);
  f.revision('revision-1'); f.generation('socket-2');
  await assert.rejects(resolveSideChatParent(f.identity, f.port), /original scope changed/);
  f.generation('socket-1'); f.authorize(false);
  await assert.rejects(resolveSideChatParent(f.identity, f.port), /original scope changed/);
  f.authorize(true);
  f.connection.socket = undefined;
  await assert.rejects(resolveSideChatParent(f.identity, f.port), /original scope changed/);
  f.connection.socket = f.socket;
  f.connection.close();
  await assert.rejects(resolveSideChatParent(f.identity, f.port), /original scope changed/);
});

test('socket generation changes during a directory request and before final projection both reject the snapshot', async t => {
  const late = await fixture(t), entered = gate(), release = gate();
  late.peer.handlers.set('thread/list', async () => { entered.resolve(); await release.promise; return { data: [{ id: 'parent' }], nextCursor: null }; });
  const pending = resolveSideChatParent(late.identity, late.port);
  await entered.promise; late.generation('socket-2'); release.resolve();
  await assert.rejects(pending, /original scope changed/);
  assert.equal(late.peer.calls('thread/list').length, 1);

  const final = await fixture(t), run = final.port.runScoped;
  let intervals = 0;
  final.port.runScoped = action => {
    if (++intervals === 3) final.revision('revision-2');
    return run(action);
  };
  await assert.rejects(resolveSideChatParent(final.identity, final.port), /original scope changed/);
  assert.equal(final.peer.calls('thread/list').length, 1);
});

test('disconnecting the original socket during a directory request cannot yield a parent', async t => {
  const f = await fixture(t), entered = gate(), release = gate();
  f.peer.handlers.set('thread/list', async () => { entered.resolve(); await release.promise; return { data: [{ id: 'parent' }], nextCursor: null }; });
  const pending = resolveSideChatParent(f.identity, f.port);
  await entered.promise;
  f.peer.disconnect();
  await assert.rejects(pending);
  release.resolve();
  assert.equal(f.peer.calls('thread/list').length, 1);
});

test('caller identity and host-owned snapshot are frozen before a delayed directory reply', async t => {
  const f = await fixture(t), entered = gate(), release = gate();
  f.peer.handlers.set('thread/list', async () => { entered.resolve(); await release.promise; return { data: [{ id: 'parent' }], nextCursor: null }; });
  const input = copy(f.identity), pending = resolveSideChatParent(input, f.port);
  await entered.promise;
  input.threadId = 'other'; (f.source().project as Value).id = 'changed';
  (f.source().response as Value).runtimeWorkspaceRoots = ['/changed'];
  release.resolve();
  const parent = await pending;
  assert.equal(parent.threadId, 'parent');
  assert.equal((parent.project as Value).id, 'project');
  assert.deepEqual(parent.workspaceRoots, ['/fixture/workspace', '/fixture/extra']);
});

test('the E host consumes the mapped parent on the same synthetic connection without resuming or starting a turn', async t => {
  const f = await fixture(t), operations = new Map<string, SideChatOperation>();
  f.source().archive = { archived: false, source: 'directory' };
  f.peer.handlers.set('config/read', () => ({ config: { developer_instructions: 'host instructions' } }));
  f.peer.handlers.set('thread/fork', params => ({ thread: { id: 'child', ephemeral: true, forkedFromId: params.threadId },
    cwd: params.cwd, runtimeWorkspaceRoots: params.runtimeWorkspaceRoots, model: params.model, modelProvider: params.modelProvider,
    serviceTier: params.serviceTier, reasoningEffort: null, approvalPolicy: params.approvalPolicy,
    approvalsReviewer: params.approvalsReviewer, activePermissionProfile: { id: params.permissions },
    sandbox: { type: 'readOnly', networkAccess: false } }));
  f.peer.handlers.set('thread/inject_items', () => ({}));
  const store: SideChatStore = {
    async create(operation) { operations.set(operation.operationId, copy(operation)); },
    async read(id) { return operations.has(id) ? copy(operations.get(id)!) : null; },
    async update(id, change) { const next = change(copy(operations.get(id)!)); operations.set(id, copy(next)); return copy(next); },
  };
  const host = createSideChatHost({ store,
    resolveParent: (hostId, threadId) => resolveSideChatParent({ hostId, threadId, connectionGeneration: f.identity.connectionGeneration }, f.port),
    request(hostId, method, params, mutating, onLateTerminal, generation) {
      assert.equal(hostId, f.identity.hostId); assert.equal(generation, f.identity.connectionGeneration);
      assert.equal(f.connection.socket, f.socket);
      return f.connection.request(method, params, { mutating, onLateTerminal });
    },
    classifyFailure: () => 'unknown', async prepareClose() {}, async cleanup() {}, onRecoveryError() {},
  });
  const prepared = await host.prepare({ hostId: 'local', threadId: 'parent' });
  assert.equal(prepared.instructionSource, 'host-config');
  assert.deepEqual(prepared.forkParams.runtimeWorkspaceRoots, ['/fixture/workspace', '/fixture/extra']);
  assert.equal((prepared.forkParams.config as Value).model_reasoning_effort, undefined);
  const started = await host.start(prepared.operationId);
  assert.equal(started.fork.status, 'received'); assert.equal(started.inject.status, 'received');
  assert.equal(started.childId, 'child');
  assert.equal(f.peer.calls('thread/fork').length, 1); assert.equal(f.peer.calls('thread/inject_items').length, 1);
  assert.equal(f.peer.calls('thread/resume').length, 0); assert.equal(f.peer.calls('turn/start').length, 0);
  f.source().archive = { archived: true, source: 'notification' };
  await assert.rejects(host.prepare({ hostId: 'local', threadId: 'parent' }), /父会话/);
  assert.equal(f.peer.calls('config/read').length, 1); assert.equal(f.peer.calls('thread/fork').length, 1);
});
