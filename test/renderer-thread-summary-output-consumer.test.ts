import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { createNativeWorkbench } from '../src/native/server.ts';
import type { ThreadItemSummary, ThreadSummary } from '../lib/codex-protocol.ts';
import type { ConversationSnapshot } from '../src/renderer/app/conversation-sessions.ts';
import type { ProjectState } from '../src/renderer/app/projects.ts';
import { createFakeCodex } from './fake-codex.ts';
import { nativeFixture } from './native-fixture.ts';

interface OutputValue {
  loading: boolean; error: string | null; notice: string | null;
  entries: Array<{ id: string; label: string; kind: string; outputKind: string; path?: string; url?: string;
    pathResolution?: string; source: { hostId: string; threadId: string; turnId: string; itemId: string; cwd?: string } }>;
}
declare global {
  interface Window {
    outputConsumer: {
      init(): Promise<void>;
      projectState(): Promise<ProjectState>;
      show(hostId: string, threadId: string, snapshot: ConversationSnapshot, state: ProjectState | null, keepSource: boolean): void;
      value(): OutputValue;
      retry(): void;
      capture(index: number): void;
      capturedValidity(): { current: boolean; original: boolean };
      holdBeforeSend(): void;
      beforeSendHeld(): boolean;
      releaseBeforeSend(): void;
      lateResponseReceived(): boolean;
      revoke(): void;
      reconnect(): Promise<void>;
    };
  }
}

const snapshot = (thread: ThreadSummary): ConversationSnapshot => ({ thread, options: null, loading: false,
  historyComplete: true, liveReady: true, streamGap: false, error: null, canSubmit: true, canStartFirstTurn: false, archived: false });
const thread = (cwd: string, items: ThreadItemSummary[]): ThreadSummary => ({ id: 'same', cwd, name: null, status: { type: 'idle' },
  turns: [{ id: 'turn', status: 'completed', itemsView: 'full', items }] });
const message = (text: string): ThreadItemSummary => ({ id: 'answer', type: 'agentMessage', text });
const metadata = { isFile: true, isDirectory: false, isSymlink: false, modifiedAtMs: 1, createdAtMs: 1 };
const chrome = process.env.YARD_VALIDATION_CHROME_BIN ?? '/usr/bin/google-chrome';

test('summary output consumer uses real host checks and rejects stale owner, content, and authority', {
  skip: !existsSync(chrome) && 'Chrome is unavailable', timeout: 90_000,
}, async t => {
  const root = await mkdtemp(join(tmpdir(), 'outputs-'));
  const cleanup: Array<() => Promise<unknown>> = [() => rm(root, { recursive: true, force: true })];
  t.after(async () => { for (const close of cleanup.reverse()) await close(); });
  const local = await createFakeCodex(root); cleanup.push(() => local.close());
  const remoteRoot = join(root, 'remote'); await mkdir(remoteRoot);
  const remote = await createFakeCodex(remoteRoot); cleanup.push(() => remote.close());
  let fail = true, releaseLate!: () => void;
  const late = new Promise<void>(resolve => { releaseLate = resolve; });
  local.handlers.set('fs/getMetadata', async params => {
    const path = String(params.path);
    if (path.endsWith('/late.pdf')) await late;
    if (path.endsWith('/failure.pdf') && fail) throw new Error('controlled metadata failure');
    if (path.endsWith('/missing.pdf')) throw new Error('missing (os error 2)');
    return metadata;
  });
  remote.handlers.set('fs/getMetadata', () => metadata);
  const fixture = await nativeFixture(root);
  const app = await createNativeWorkbench({ ...fixture, port: 0, socketPath: local.socketPath,
    codexHome: join(root, 'codex'), dataDir: join(root, 'data'), workspace: root,
    hostCatalog: { hosts: [{ hostId: 'remote-fixture', displayName: 'Fixture', sshAlias: null, sshHost: 'fixture', sshPort: null, identity: null }],
      projects: [], assignments: {} },
    sshStream: (_host, onPaths) => { onPaths?.({ homeDirectory: remoteRoot, codexHome: join(remoteRoot, 'codex') }); return connect(remote.socketPath); },
    httpFetch: async () => { throw new Error('External HTTP is disabled'); },
  });
  cleanup.push(() => app.close());
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React, {StrictMode} from 'react';
    import {createRoot} from 'react-dom/client';
    import {flushSync} from 'react-dom';
    import {BrowserWorkbenchClient} from './src/renderer/app/client.ts';
    import {useThreadSummaryOutputs} from './src/renderer/app/use-thread-summary-outputs.ts';
    const client = new BrowserWorkbenchClient();
    const realHost = client.host.bind(client);
    let hold = false, held = false, release = () => {}, lateResponse = false;
    client.host = async (endpoint, params, options) => {
      if (endpoint === 'paths-exist' && hold) {
        hold = false; held = true;
        await new Promise(resolve => { release = resolve; }); held = false;
      }
      const response = await realHost(endpoint, params, options);
      if (endpoint === 'paths-exist' && params?.paths?.includes('/workspace/out/late.pdf')) lateResponse = true;
      return response;
    };
    let authority = 0, result, captured;
    const root = createRoot(document.getElementById('root'));
    function View({options}) {
      result = useThreadSummaryOutputs(options);
      return <div><span data-testid="loading">{String(result.loading)}</span>
        <span data-testid="error">{result.error}</span><span data-testid="notice">{result.notice}</span>
        {result.entries.map(entry => <button key={entry.id} onClick={() => result.assertEntryCurrent(entry)}>{entry.label}</button>)}
        <button onClick={result.retry}>Retry</button></div>;
    }
    window.outputConsumer = {
      async init() {
        await client.connect();
        await client.rpc('thread/list', {}, 'local');
        await client.rpc('thread/list', {}, 'remote-fixture');
        for (const [hostId, path] of [['local','/workspace/out'],['remote-fixture','/remote/out']]) {
          await realHost('thread-projects', {operation:'setProjectless', value:{hostId, threadId:'same', projectless:true}});
          await realHost('thread-projects', {operation:'updateProjectlessThread', value:{hostId, threadId:'same', outputDirectory:path}});
        }
      },
      projectState:() => realHost('thread-project-state'),
      show(hostId, threadId, snapshot, projectState, keepSource) {
        const original = keepSource ? authority : ++authority;
        const originalConnection = client.captureDaemonConnection(hostId);
        const options = {client, hostId, threadId, snapshot, projectState, enabled:true, sourceKey:String(original),
          assertCurrent() {if (original !== authority) throw Error('original authority revoked'); originalConnection.assertOriginal();}};
        flushSync(() => root.render(<StrictMode><View options={options}/></StrictMode>));
      },
      value:() => ({entries:result.entries, loading:result.loading, error:result.error, notice:result.notice}),
      retry:() => result.retry(),
      capture:index => { captured = {entry:result.entries[index], original:result.assertEntryCurrent}; },
      capturedValidity() {
        const valid = fn => {try {fn(captured.entry); return true;} catch {return false;}};
        return {current:valid(result.assertEntryCurrent), original:valid(captured.original)};
      },
      holdBeforeSend:() => {hold=true;}, beforeSendHeld:() => held, releaseBeforeSend:() => release(),
      lateResponseReceived:() => lateResponse,
      revoke:() => {authority++;},
      async reconnect() {client.suspend(); await client.resume(); await client.rpc('thread/list', {}, 'local');},
    };
  ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'empty' } });
  const browser = await chromium.launch({ executablePath: chrome, headless: true,
    args: ['--no-sandbox', '--no-proxy-server', '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'],
    env: { HOME: root, CODEX_HOME: join(root, 'codex'), XDG_CONFIG_HOME: join(root, 'config'),
      XDG_CACHE_HOME: join(root, 'cache'), PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' } });
  cleanup.push(() => browser.close());
  const context = await browser.newContext({ bypassCSP: true, serviceWorkers: 'block' }); cleanup.push(() => context.close());
  const page = await context.newPage(); page.setDefaultTimeout(10_000);
  const pageErrors: string[] = [], external: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== app.url) { external.push(url.origin); return route.abort(); }
    if (url.pathname.startsWith('/assets/')) return route.abort();
    return route.continue();
  });
  await page.goto(app.url);
  await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
  await page.evaluate(() => window.outputConsumer.init());
  const projects = await page.evaluate(() => window.outputConsumer.projectState());
  assert.deepEqual(projects.outputDirectories.map(item => [item.hostId, item.threadId, item.value]).sort(),
    [['local', 'same', '/workspace/out'], ['remote-fixture', 'same', '/remote/out']]);
  const ready = () => page.waitForFunction(() => !window.outputConsumer.value().loading);
  const show = (hostId: string, value: ConversationSnapshot, state: ProjectState | null = projects, keepSource = false) =>
    page.evaluate(({ hostId, value, state, keepSource }) => window.outputConsumer.show(hostId, 'same', value, state, keepSource),
      { hostId, value, state, keepSource });

  const resource: ThreadItemSummary = { id: 'created', type: 'mcpToolCall', server: 'connector', tool: 'write', status: 'completed', error: null,
    appContext: { connectorId: 'fixture' }, result: { _meta: { 'openai/resourceActivities': { version: 1,
      resources: [{ id: 'resource', url: 'https://example.invalid/document', title: 'Resource', activities: ['created'] }] } } } };
  const ordinary: ThreadItemSummary = { id: 'ordinary', type: 'mcpToolCall', server: 'ordinary', tool: 'read', status: 'completed', result: { content: [] } };
  const localSnapshot = snapshot(thread('/workspace', [resource, ordinary, message(
    ':codex-file-citation{path="/workspace/out/a.pdf"}\n\n:codex-file-citation{path="/workspace/out/missing.pdf"}\n\n:codex-file-citation{path="/workspace/outside.pdf"}') ]));
  await show('local', localSnapshot); await ready();
  let value = await page.evaluate(() => window.outputConsumer.value());
  assert.equal(value.error, null); assert.equal(value.notice, null);
  assert.deepEqual(value.entries.map(entry => [entry.kind, entry.label]), [['link', 'Resource'], ['file', 'a.pdf']]);
  assert.deepEqual(value.entries[0]?.source, { hostId: 'local', threadId: 'same', turnId: 'turn', itemId: 'created' });
  assert.deepEqual(value.entries[1]?.source, { hostId: 'local', threadId: 'same', cwd: '/workspace', turnId: 'turn', itemId: 'answer' });
  assert.deepEqual(local.calls('fs/getMetadata').map(item => item.params?.path).sort(), ['/workspace/out/a.pdf', '/workspace/out/missing.pdf']);
  await page.getByRole('button', { name: 'a.pdf', exact: true }).click();
  await page.evaluate(() => window.outputConsumer.capture(1));
  assert.deepEqual(await page.evaluate(() => window.outputConsumer.capturedValidity()), { current: true, original: true });

  const remoteSnapshot = snapshot(thread('/remote', [message(':codex-file-citation{path="/remote/out/remote.pdf"}') ]));
  await show('remote-fixture', remoteSnapshot); await ready();
  value = await page.evaluate(() => window.outputConsumer.value());
  assert.equal(value.entries[0]?.source.hostId, 'remote-fixture');
  assert.equal(value.entries[0]?.path, '/remote/out/remote.pdf');
  assert.equal(remote.calls('fs/getMetadata').at(-1)?.params?.path, '/remote/out/remote.pdf');
  await show('local', localSnapshot); await ready();
  assert.deepEqual(await page.evaluate(() => window.outputConsumer.capturedValidity()), { current: false, original: false });

  const website = snapshot(thread('/workspace', [message('Preview http://localhost:5199/') ]));
  const beforeWebsite = local.calls('fs/getMetadata').length;
  await show('local', website); await ready();
  value = await page.evaluate(() => window.outputConsumer.value());
  assert.equal(value.entries[0]?.outputKind, 'website'); assert.equal(value.entries[0]?.url, 'http://localhost:5199/');
  assert.deepEqual(value.entries[0]?.source, { hostId: 'local', threadId: 'same', cwd: '/workspace', turnId: 'turn', itemId: 'answer' });
  assert.equal(local.calls('fs/getMetadata').length, beforeWebsite);
  const htmlSite = snapshot(thread('/workspace', [{ id: 'change', type: 'fileChange', status: 'completed', changes: [
    { path: '/workspace/out/index.html', kind: { type: 'add' }, diff: '' },
  ] }, message('Website created.') ]));
  await show('local', htmlSite); await ready();
  value = await page.evaluate(() => window.outputConsumer.value());
  assert.equal(value.entries[0]?.outputKind, 'website'); assert.equal(value.entries[0]?.path, '/workspace/out/index.html');
  assert.equal(value.entries[0]?.source.itemId, 'change');
  assert.equal(local.calls('fs/getMetadata').at(-1)?.params?.path, '/workspace/out/index.html');

  const relative = snapshot(thread('/workspace', [message(':codex-file-citation{path="out/relative.pdf"}') ]));
  await show('local', relative); await ready();
  value = await page.evaluate(() => window.outputConsumer.value());
  assert.equal(value.entries[0]?.pathResolution, 'thread-cwd');
  assert.match(value.notice ?? '', /original turn workspace is unverified/);
  const ambiguous = structuredClone(projects); ambiguous.unresolved.outputDirectories.same = '/unknown';
  const callsBeforeAmbiguous = local.calls('fs/getMetadata').length;
  await show('local', relative, ambiguous); await ready();
  value = await page.evaluate(() => window.outputConsumer.value());
  assert.equal(value.entries.length, 0); assert.match(value.notice ?? '', /output directory cannot be determined/);
  assert.equal(local.calls('fs/getMetadata').length, callsBeforeAmbiguous);
  await show('local', relative, null); await ready();
  assert.match((await page.evaluate(() => window.outputConsumer.value())).notice ?? '', /output directory cannot be determined/);
  assert.equal(local.calls('fs/getMetadata').length, callsBeforeAmbiguous);
  const otherHostUnresolved = structuredClone(projects);
  otherHostUnresolved.unresolved.qualified.push({ field: 'thread-projectless-output-directories', hostId: 'remote-fixture', threadId: 'same', value: 17 });
  await show('local', relative, otherHostUnresolved); await ready();
  assert.equal((await page.evaluate(() => window.outputConsumer.value())).entries[0]?.path, '/workspace/out/relative.pdf');

  const broken = snapshot(thread('/workspace', [resource, message(':codex-file-citation{path="/workspace/out/failure.pdf"}') ]));
  await show('local', broken); await ready();
  value = await page.evaluate(() => window.outputConsumer.value());
  assert.match(value.error ?? '', /controlled metadata failure/); assert.deepEqual(value.entries.map(entry => entry.label), ['Resource']);
  fail = false;
  await page.evaluate(() => window.outputConsumer.retry());
  await page.waitForFunction(() => !window.outputConsumer.value().loading && window.outputConsumer.value().error === null
    && window.outputConsumer.value().entries.some(entry => entry.label === 'failure.pdf'));
  value = await page.evaluate(() => window.outputConsumer.value());
  assert.equal(value.error, null); assert.deepEqual(value.entries.map(entry => entry.label), ['Resource', 'failure.pdf']);

  const legacy: ThreadItemSummary = { id: 'figma', type: 'mcpToolCall', server: 'connector', tool: 'figma_create_new_file', status: 'completed',
    result: { content: [{ type: 'text', text: JSON.stringify({ file_key: 'fixture', file_url: 'https://example.invalid/file' }) }] } };
  await show('local', snapshot(thread('/workspace', [ordinary]))); await ready();
  value = await page.evaluate(() => window.outputConsumer.value());
  assert.deepEqual(value.entries, []); assert.equal(value.notice, null); assert.equal(value.error, null);
  await show('local', snapshot(thread('/workspace', [ordinary, legacy]))); await ready();
  value = await page.evaluate(() => window.outputConsumer.value());
  assert.deepEqual(value.entries.map(entry => entry.kind === 'link' ? entry.url : entry.path), ['https://example.invalid/file']);
  assert.deepEqual(value.entries[0]?.source, { hostId: 'local', threadId: 'same', turnId: 'turn', itemId: 'figma' });
  assert.equal(value.notice, null); assert.equal(value.error, null);
  const google: ThreadItemSummary = { id: 'google', type: 'mcpToolCall', server: 'google-drive', tool: 'create_file', status: 'completed',
    result: { structuredContent: { webViewLink: 'https://example.invalid/document' } } };
  await show('local', snapshot(thread('/workspace', [google]))); await ready();
  value = await page.evaluate(() => window.outputConsumer.value());
  assert.deepEqual(value.entries.map(entry => entry.kind === 'link' ? entry.url : entry.path), ['https://example.invalid/document']);
  assert.deepEqual(value.entries[0]?.source, { hostId: 'local', threadId: 'same', turnId: 'turn', itemId: 'google' });
  assert.equal(value.notice, null);
  await show('local', snapshot(thread('/workspace', [{ ...google, tool: 'get_document' }]))); await ready();
  assert.equal((await page.evaluate(() => window.outputConsumer.value())).notice, null);
  const partial = snapshot(thread('/workspace', [])); partial.historyComplete = false;
  await show('local', partial); await ready();
  assert.match((await page.evaluate(() => window.outputConsumer.value())).notice ?? '', /history is incomplete/);

  const delayed = snapshot(thread('/workspace', [resource, message(':codex-file-citation{path="/workspace/out/late.pdf"}') ]));
  await show('local', delayed);
  await local.waitFor(item => item.method === 'fs/getMetadata' && item.params?.path === '/workspace/out/late.pdf');
  value = await page.evaluate(() => window.outputConsumer.value());
  assert.equal(value.loading, true); assert.deepEqual(value.entries.map(entry => entry.label), ['Resource']);
  await show('local', localSnapshot, projects, true); await ready();
  releaseLate();
  await page.waitForFunction(() => window.outputConsumer.lateResponseReceived());
  value = await page.evaluate(() => window.outputConsumer.value());
  assert.ok(value.entries.every(entry => entry.label !== 'late.pdf'));

  const before = local.calls('fs/getMetadata').length;
  await page.evaluate(() => window.outputConsumer.holdBeforeSend());
  await show('local', snapshot(thread('/workspace', [message(':codex-file-citation{path="/workspace/out/never.pdf"}') ])));
  await page.waitForFunction(() => window.outputConsumer.beforeSendHeld());
  await page.evaluate(() => window.outputConsumer.revoke());
  await page.evaluate(() => window.outputConsumer.releaseBeforeSend());
  await page.waitForFunction(() => !window.outputConsumer.beforeSendHeld());
  await ready();
  assert.match((await page.evaluate(() => window.outputConsumer.value())).error ?? '', /original authority revoked/);
  assert.equal(local.calls('fs/getMetadata').slice(before).some(item => item.params?.path === '/workspace/out/never.pdf'), false);

  await show('local', localSnapshot); await ready();
  await page.evaluate(() => window.outputConsumer.capture(1));
  await page.evaluate(() => window.outputConsumer.reconnect());
  assert.deepEqual(await page.evaluate(() => window.outputConsumer.capturedValidity()), { current: false, original: false });
  await show('local', localSnapshot); await ready();
  assert.equal((await page.evaluate(() => window.outputConsumer.value())).entries[1]?.label, 'a.pdf');
  assert.deepEqual(pageErrors, []); assert.deepEqual(external, []);
});
