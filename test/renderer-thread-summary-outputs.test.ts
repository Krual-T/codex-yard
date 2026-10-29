import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ThreadItemSummary, ThreadSummary, TurnSummary } from '../lib/codex-protocol.ts';
import type { WorkbenchClient } from '../src/renderer/workbench-contract.ts';
import { loadThread } from '../src/renderer/app/load-thread.ts';
import { applyThreadEvent } from '../src/renderer/app/thread-state.ts';
import { projectThreadSummaryResourceOutputs } from '../src/renderer/app/thread-summary-outputs.ts';

type Activity = 'read' | 'created' | 'updated';
interface Resource { id: string; url: string; activities: Activity[]; title?: string; mimeType?: string }
function receipt(id: string, resources: Resource[], extra: Record<string, unknown> = {}): ThreadItemSummary {
  return { id, type: 'mcpToolCall', server: 'connector', tool: 'call', status: 'completed', error: null,
    appContext: { connectorId: 'connector-example' }, result: { content: [], _meta: {
      'openai/resourceActivities': { version: 1, resources },
    } }, ...extra };
}
function thread(turns: TurnSummary[]): ThreadSummary {
  return { id: 'thread-1', name: null, cwd: '/workspace', status: { type: 'idle' }, turns };
}
function project(value: ThreadSummary, hostId = 'local') {
  return projectThreadSummaryResourceOutputs({ hostId, thread: value, historyComplete: true, streamGap: false });
}

test('structured MCP outputs merge provider aliases and retain the actual creating owner', () => {
  const original = thread([
    { id: 'old', status: 'completed', itemsView: 'full', items: [receipt('create', [
      { id: 'resource-1', url: 'https://docs.google.com/document/d/document-1/edit', title: 'A document',
        mimeType: 'application/pdf', activities: ['created'] },
    ])] },
    { id: 'middle', status: 'completed', itemsView: 'full', items: [receipt('update', [
      { id: 'other', url: 'https://example.test/result', title: 'Another result', activities: ['updated'] },
    ])] },
    { id: 'new', status: 'completed', itemsView: 'full', items: [receipt('read', [
      { id: 'different-provider-id', url: 'https://docs.google.com/document/d/document-1/view#section', activities: ['read'] },
    ])] },
  ]);
  const unchanged = structuredClone(original);
  const result = project(original, 'ssh-a');
  assert.deepEqual(original, unchanged);
  assert.equal(result.scope, 'structured-mcp-resources');
  assert.deepEqual(result.gaps, []);
  assert.deepEqual(result.entries.map(entry => entry.label), ['Another result', 'A document']);
  const document = result.entries[1]!;
  assert.equal(document.id, 'google:document:document-1');
  assert.equal(document.url, 'https://docs.google.com/document/d/document-1/view#section');
  assert.equal(document.mimeType, 'application/pdf');
  assert.deepEqual(document.activities, ['read', 'created']);
  assert.deepEqual(document.source, { hostId: 'ssh-a', threadId: 'thread-1', turnId: 'old', itemId: 'create' });
  assert.ok(document.aliases.includes('provider:connector-example:resource-1'));
  assert.ok(document.aliases.includes('provider:connector-example:different-provider-id'));
  assert.equal(project(original, 'ssh-b').entries[1]?.source.hostId, 'ssh-b');
});

test('turn keys and global aliases preserve the original cross-turn duplicate behavior', () => {
  const value = thread([
    { id: 'older', status: 'completed', itemsView: 'full', items: [receipt('bridge', [
      { id: 'right', url: 'https://example.test/left/#old', activities: ['updated'] },
      { id: 'read-only', url: 'https://example.test/read', activities: ['read'] },
    ])] },
    { id: 'newer', status: 'completed', itemsView: 'full', items: [receipt('two', [
      { id: 'left', url: 'https://example.test/left#new', activities: ['created'] },
      { id: 'right', url: 'https://example.test/right', activities: ['created'] },
    ])] },
  ]);
  const result = project(value);
  assert.equal(result.entries.length, 2);
  assert.equal(result.entries[0]?.id, 'provider:connector-example:left');
  assert.equal(result.entries[0]?.url, 'https://example.test/left#new');
  assert.deepEqual(result.entries[0]?.activities, ['created', 'updated']);
  assert.deepEqual(result.entries[0]?.source, { hostId: 'local', threadId: 'thread-1', turnId: 'newer', itemId: 'two' });
  assert.ok(result.entries[0]?.aliases.includes('url:https://example.test/right'));
  assert.equal(result.entries[1]?.id, 'provider:connector-example:right');
  assert.deepEqual(result.entries[1]?.activities, ['created']);
});

test('aliases that bridge resources within one turn are merged and read-only resources are excluded', () => {
  const value = thread([{ id: 'turn', status: 'completed', itemsView: 'full', items: [receipt('mcp', [
    { id: 'left', url: 'https://example.test/left#new', activities: ['created'] },
    { id: 'right', url: 'https://example.test/right', activities: ['created'] },
    { id: 'right', url: 'https://example.test/left/#old', activities: ['updated'] },
    { id: 'read-only', url: 'https://example.test/read', activities: ['read'] },
  ])] }]);
  const result = project(value);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0]?.id, 'provider:connector-example:left');
  assert.deepEqual(result.entries[0]?.activities, ['created', 'updated']);
});

test('malformed metadata is rejected as a whole and unhandled sources remain explicit', () => {
  const value = thread([{ id: 'turn', status: 'completed', itemsView: 'full', items: [
    receipt('invalid', [], { result: { content: [], _meta: { 'openai/resourceActivities': { version: 1, resources: [
      { id: 'valid', url: 'https://example.test/valid', activities: ['created'] },
      { id: 'bad', url: 'https://user:secret@example.test/private', activities: ['created'] },
    ] } } } }),
    receipt('version', [], { result: { content: [], _meta: { 'openai/resourceActivities': { version: 2, resources: [] } } } }),
    receipt('legacy', [], { result: { content: [] } }),
    receipt('no-scope', [{ id: 'unknown', url: 'https://example.test/no-scope', activities: ['created'] }], { appContext: null, server: undefined }),
    receipt('page', [{ id: 'page', url: 'https://chatgpt.com/space/known-page', activities: ['created'] }]),
    receipt('codex-page', [{ id: 'page', url: 'https://chatgpt.com/codex/app/space/known-page', activities: ['updated'] }]),
    receipt('failed', [{ id: 'fail', url: 'https://example.test/fail', activities: ['created'] }], { status: 'failed' }),
    receipt('error', [{ id: 'error', url: 'https://example.test/error', activities: ['created'] }], { error: { message: 'failed' } }),
    { id: 'change', type: 'fileChange', status: 'completed', changes: [{ path: '/workspace/not-an-output' }] },
  ] }]);
  const result = project(value);
  assert.deepEqual(result.entries, []);
  assert.deepEqual(new Set(result.gaps), new Set(['invalid-resource-activities', 'unknown-provider-scope', 'page-resource']));
});

test('legacy Google Drive results retain create, update and read provenance without treating ordinary tools as outputs', () => {
  const documentUrl = 'https://docs.google.com/document/d/legacy-document/edit';
  const value = thread([
    { id: 'create-turn', status: 'completed', itemsView: 'full', items: [
      receipt('copy', [], { server: 'Google Drive app', appContext: null, tool: 'copy_file', result: {
        content: [], structuredContent: { documentUrl, display_title: ' Original document ', mime_type: 'application/vnd.google-apps.document' },
      } }),
      receipt('share', [], { server: 'codex_apps', appContext: null, tool: 'google_drive.share_file', result: {
        content: [], structuredContent: { file_url: 'https://drive.google.com/file/d/shared-file/view', name: 'Shared file' },
      } }),
    ] },
    { id: 'read-turn', status: 'completed', itemsView: 'full', items: [
      receipt('read', [], { server: 'codex_apps', appContext: null, tool: 'google_drive.get_document', result: {
        content: [], structuredContent: { document_url: documentUrl.replace('/edit', '/view#section'), title: 'Current title' },
      } }),
      receipt('delete', [], { server: 'google-drive', appContext: null, tool: 'delete_file', result: {
        content: [], structuredContent: { fileUrl: 'https://drive.google.com/file/d/deleted/view' },
      } }),
      receipt('ordinary', [], { appContext: null, tool: 'create_file', result: {
        content: [], structuredContent: { documentUrl: 'https://example.test/ordinary' },
      } }),
    ] },
  ]);
  const result = project(value, 'ssh-original');
  assert.deepEqual(result.gaps, []);
  assert.deepEqual(result.entries.map(entry => entry.label), ['Shared file', 'Current title']);
  assert.deepEqual(result.entries.map(entry => entry.activities), [['updated'], ['read', 'created']]);
  assert.equal(result.entries[1]?.mimeType, 'application/vnd.google-apps.document');
  assert.deepEqual(result.entries[1]?.source, { hostId: 'ssh-original', threadId: 'thread-1', turnId: 'create-turn', itemId: 'copy' });
});

test('legacy Figma and Notion JSON receipts produce only the original successful created resources', () => {
  const first = '0123456789abcdef0123456789abcdef', second = 'fedcba9876543210fedcba9876543210';
  const figmaResult = { content: [{ type: 'text', text: 'Created file follows.' }, { type: 'text', text: JSON.stringify({
    file_key: 'legacy-figma', file_url: 'https://www.figma.com/design/legacy-figma/Diagram', message: 'File "Original diagram" created successfully.',
  }) }] };
  const value = thread([
    { id: 'figma-turn', status: 'completed', itemsView: 'full', items: [
      receipt('figma', [], { server: 'figma', appContext: null, tool: 'mcp__figma__figma_create_new_file', result: figmaResult }),
    ] },
    { id: 'notion-turn', status: 'completed', itemsView: 'full', items: [
      receipt('notion-create', [], { server: 'notion', appContext: null, tool: 'mcp__notion__notion_create_pages', result: {
        content: [{ type: 'text', text: JSON.stringify({ pages: [
          { id: first, url: 'https://www.notion.so/' + first, properties: { title: 'First page' } },
          { id: second, url: 'https://www.notion.so/' + second, properties: { title: 'Second page' } },
        ] }) }],
      } }),
      receipt('notion-read', [], { server: 'notion', appContext: null, tool: 'notion-fetch', result: {
        content: [{ type: 'text', text: JSON.stringify({ metadata: { type: 'page' }, title: 'Read title', url: 'https://www.notion.so/' + first }) }],
      } }),
      receipt('failed-figma', [], { server: 'figma', appContext: null, tool: 'figma-create-new-file', status: 'failed', result: figmaResult }),
      receipt('explicit-invalid-metadata', [], { server: 'figma', appContext: null, tool: 'figma-create-new-file', result: {
        ...figmaResult, _meta: { 'openai/resourceActivities': { version: 2, resources: [] } },
      } }),
      receipt('ordinary-json', [], { appContext: null, tool: 'inspect', result: figmaResult }),
    ] },
  ]);
  const result = project(value);
  assert.deepEqual(result.gaps, ['invalid-resource-activities']);
  assert.deepEqual(result.entries.map(entry => entry.label), ['Read title', 'Second page', 'Original diagram']);
  assert.deepEqual(result.entries.map(entry => entry.source.itemId), ['notion-create', 'notion-create', 'figma']);
  assert.deepEqual(result.entries[0]?.activities, ['read', 'created']);
  assert.deepEqual(result.entries[2]?.activities, ['created']);
});

test('actual MCP server identity supplies provider scope and legacy receipts merge with resource activities', () => {
  const value = thread([
    { id: 'legacy-turn', status: 'completed', itemsView: 'full', items: [
      receipt('legacy-create', [], { server: 'figma', appContext: null, tool: 'figma-create-new-file', result: {
        content: [{ type: 'text', text: JSON.stringify({ file_key: 'same-file', file_url: 'https://figma.com/file/same-file/Original' }) }],
      } }),
    ] },
    { id: 'metadata-turn', status: 'completed', itemsView: 'full', items: [
      receipt('server-output', [{ id: 'result', url: 'https://example.test/server-output', activities: ['created'] }], { server: 'custom-server', appContext: null }),
      receipt('metadata-update', [{ id: 'same-file', url: 'https://figma.com/design/same-file/Updated', title: 'Updated diagram', activities: ['updated'] }],
        { server: 'figma', appContext: null }),
    ] },
  ]);
  const result = project(value);
  assert.deepEqual(result.gaps, []);
  assert.equal(result.entries.length, 2);
  assert.equal(result.entries[0]?.label, 'Updated diagram');
  assert.deepEqual(result.entries[0]?.activities, ['created', 'updated']);
  assert.equal(result.entries[0]?.source.itemId, 'metadata-update');
  assert.equal(result.entries[1]?.id, 'provider:mcp-server:custom-server:result');
});

test('missing or incomplete history and stream gaps cannot prove an empty Outputs list', () => {
  const missing = projectThreadSummaryResourceOutputs({ hostId: 'local', thread: null, historyComplete: false, streamGap: true });
  assert.deepEqual(new Set(missing.gaps), new Set(['missing-thread', 'incomplete-history', 'stream-gap']));
  const incomplete = thread([{ id: 'turn', status: 'inProgress', items: [receipt('observed', [
    { id: 'created', url: 'https://example.test/created', activities: ['created'] },
  ])] }]);
  const result = projectThreadSummaryResourceOutputs({ hostId: 'local', thread: incomplete, historyComplete: true, streamGap: true });
  assert.deepEqual(new Set(result.gaps), new Set(['incomplete-history', 'stream-gap']));
  assert.equal(result.entries.length, 1);
});

test('distinct provider scopes do not collide solely on the resource id', () => {
  const value = thread([{ id: 'turn', status: 'completed', itemsView: 'full', items: [
    receipt('first', [{ id: 'same', url: 'https://one.example.test/file', activities: ['created'] }], { pluginId: 'one@plugin' }),
    receipt('second', [{ id: 'same', url: 'https://two.example.test/file', activities: ['created'] }], { pluginId: 'two@plugin' }),
  ] }]);
  assert.deepEqual(project(value).entries.map(entry => entry.id), ['provider:two@plugin:same', 'provider:one@plugin:same']);
});

test('the original system-tool discovery gate and Pages exception remain explicit', () => {
  const system = receipt('system', [{ id: 'id', url: 'https://example.test/system', activities: ['created'] }], { server: 'node_repl' });
  assert.deepEqual(project(thread([{ id: 'turn', status: 'completed', itemsView: 'full', items: [system] }])).entries, []);
  const page = receipt('page', [], { server: 'pages', appContext: { connectorId: 'connector_openai_pages' }, tool: 'create_page' });
  const result = project(thread([{ id: 'turn', status: 'completed', itemsView: 'full', items: [system, page] }]));
  assert.equal(result.entries[0]?.source.itemId, 'system');
  assert.deepEqual(result.gaps, ['page-resource']);
});

test('the real thread loader and live item reducer preserve structured receipts for projection', async () => {
  const calls: { method: string; hostId?: string; cursor: unknown }[] = [];
  const saved = receipt('saved', [{ id: 'doc', url: 'https://example.test/doc', activities: ['created'] }]);
  const client: WorkbenchClient = {
    async rpc<T>(method: string, params?: Record<string, unknown>, hostId?: string): Promise<T> {
      calls.push({ method, hostId, cursor: params?.cursor });
      let response: unknown;
      if (method === 'thread/read') response = { thread: thread([]) };
      else if (method === 'thread/turns/list') response = { data: [
        { id: 'turn', status: 'completed', itemsView: 'summary', items: [] },
      ], nextCursor: null };
      else if (method === 'thread/items/list' && params?.cursor === null) response = {
        data: [{ item: { id: 'message', type: 'agentMessage', text: 'done' } }], nextCursor: 'next',
      };
      else if (method === 'thread/items/list' && params?.cursor === 'next') response = {
        data: [{ item: saved }], nextCursor: null,
      };
      else throw new Error(`Unexpected RPC ${method}`);
      return response as T;
    },
    async host() { throw new Error('Unexpected host request'); },
    subscribe() { return () => {}; },
    async reply() { throw new Error('Unexpected approval'); },
  };
  const loaded = (await loadThread(client, 'ssh-a', 'thread-1')).thread;
  assert.equal(loaded.turns[0]?.itemsView, 'full');
  assert.deepEqual(project(loaded, 'ssh-a').entries.map(entry => entry.source), [
    { hostId: 'ssh-a', threadId: 'thread-1', turnId: 'turn', itemId: 'saved' },
  ]);
  assert.ok(calls.every(call => call.hostId === 'ssh-a'));
  assert.deepEqual(calls.filter(call => call.method === 'thread/items/list').map(call => call.cursor), [null, 'next']);
  const running = thread([{ id: 'turn', status: 'inProgress', items: [] }]);
  const live = applyThreadEvent(running, { type: 'mcp-notification', hostId: 'ssh-a', method: 'item/completed',
    params: { threadId: 'thread-1', turnId: 'turn', item: saved } });
  const observed = projectThreadSummaryResourceOutputs({ hostId: 'ssh-a', thread: live, historyComplete: true, streamGap: false });
  assert.equal(observed.entries[0]?.source.itemId, 'saved');
  assert.ok(observed.gaps.includes('incomplete-history'));
});
