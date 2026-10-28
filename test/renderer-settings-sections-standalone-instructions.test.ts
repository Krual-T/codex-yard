import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WorkbenchClient, WorkbenchEvent } from '../src/renderer/workbench-contract.ts';
import { Instructions } from '../src/renderer/settings/instructions.ts';

class FakeClient implements WorkbenchClient {
  files = new Map<string, string>([['/fixture/AGENTS.md', '\ufeffOriginal\n']]);
  calls: { endpoint: string; params?: Record<string, unknown> }[] = [];
  lostReply = false;
  offline = false;
  invalidUtf8 = false;
  async reply(): Promise<void> { throw new Error('Unexpected approval'); }
  subscribe(_listener: (event: WorkbenchEvent) => void) { return () => {}; }
  async rpc<T>(): Promise<T> { throw new Error('Unexpected RPC'); }
  async host<T>(endpoint: string, params?: Record<string, unknown>): Promise<T> {
    this.calls.push({ endpoint, params });
    if (endpoint === 'codex-home') return { codexHome: '/fixture' } as T;
    if (endpoint === 'paths-exist') return { existingPaths: [...this.files.keys()] } as T;
    if (endpoint === 'read-file-binary') return { contentsBase64: this.invalidUtf8 ? '/w==' : Buffer.from(this.files.get(String(params?.path)) ?? '').toString('base64') } as T;
    if (endpoint === 'codex-agents-md-save') {
      if (this.offline) throw new Error('offline');
      const path = `/fixture/${String(params?.fileName)}`;
      if ((this.files.get(path) ?? null) !== params?.expectedContents) throw new Error('changed on host');
      this.files.set(path, String(params?.contents));
      if (this.lostReply) throw new Error('reply lost');
      return { saved: true } as T;
    }
    throw new Error('Unexpected endpoint');
  }
}

test('instruction drafts retain byte-order marks and save to the selected host with the original text', async () => {
  const client = new FakeClient(), editor = new Instructions(client, 'ssh:fixture');
  await editor.load();
  assert.equal(editor.getSnapshot().files?.[0].draft, '\ufeffOriginal\n');
  assert.equal(editor.getSnapshot().files?.[1].saved, null);
  editor.edit('AGENTS.md', '\ufeffUpdated\n'); editor.edit('AGENTS.override.md', 'Override');
  assert.equal(editor.dirty, true);
  assert.equal(await editor.save('AGENTS.md'), true);
  assert.deepEqual(client.calls.find(call => call.endpoint === 'codex-agents-md-save')?.params, {
    hostId: 'ssh:fixture', fileName: 'AGENTS.md', contents: '\ufeffUpdated\n', expectedContents: '\ufeffOriginal\n',
  });
  assert.equal(editor.dirty, true);
  assert.equal(await editor.save('AGENTS.override.md'), true);
  assert.equal(editor.dirty, false);
});

test('a lost reply keeps the draft fenced after rereading even when the file matches', async () => {
  const client = new FakeClient(), editor = new Instructions(client, 'local');
  await editor.load(); editor.edit('AGENTS.md', 'Draft');
  client.lostReply = true;
  assert.equal(await editor.save('AGENTS.md'), false);
  assert.equal(editor.getSnapshot().files?.[0].draft, 'Draft');
  assert.equal(editor.getSnapshot().files?.[0].needsRefresh, true);
  assert.equal(await editor.save('AGENTS.md'), false);
  assert.equal(client.calls.filter(call => call.endpoint === 'codex-agents-md-save').length, 1);
  client.lostReply = false; await editor.load();
  assert.equal(editor.getSnapshot().files?.[0].latest, 'Draft');
  editor.useLatest('AGENTS.md');
  assert.equal(editor.dirty, true);
  assert.equal(editor.getSnapshot().files?.[0].needsRefresh, true);
  assert.equal(await editor.save('AGENTS.md'), false);
  assert.equal(client.calls.filter(call => call.endpoint === 'codex-agents-md-save').length, 1);
});

test('unclassified failures and failed reloads preserve the draft without assuming the write ended', async () => {
  const client = new FakeClient(), editor = new Instructions(client, 'local');
  await editor.load(); editor.edit('AGENTS.md', 'My draft');
  client.files.set('/fixture/AGENTS.md', 'External edit');
  assert.equal(await editor.save('AGENTS.md'), false);
  client.invalidUtf8 = true; await editor.load();
  assert.equal(editor.getSnapshot().files?.[0].draft, 'My draft');
  assert.ok(editor.getSnapshot().error);
  client.invalidUtf8 = false; await editor.load();
  assert.equal(editor.getSnapshot().files?.[0].latest, 'External edit');
  assert.equal(await editor.save('AGENTS.md'), false);
  editor.useLatest('AGENTS.md');
  assert.equal(await editor.save('AGENTS.md'), false);
  assert.equal(editor.getSnapshot().files?.[0].draft, 'My draft');
  assert.equal(client.files.get('/fixture/AGENTS.md'), 'External edit');
  editor.discard('AGENTS.md'); editor.edit('AGENTS.md', 'Later draft');
  assert.equal(await editor.save('AGENTS.md'), false);
  assert.equal(client.calls.filter(call => call.endpoint === 'codex-agents-md-save').length, 1);
});

test('reading the old file cannot release an earlier write that may arrive later', async () => {
  const client = new FakeClient(), editor = new Instructions(client, 'local');
  await editor.load(); editor.edit('AGENTS.md', 'First draft'); client.offline = true;
  assert.equal(await editor.save('AGENTS.md'), false);
  client.offline = false; await editor.load();
  assert.equal(editor.getSnapshot().files?.[0].latest, undefined);
  editor.edit('AGENTS.md', 'Second draft');
  assert.equal(await editor.save('AGENTS.md'), false);
  client.files.set('/fixture/AGENTS.md', 'First draft');
  await editor.load();
  assert.equal(editor.getSnapshot().files?.[0].draft, 'Second draft');
  assert.equal(editor.getSnapshot().files?.[0].latest, 'First draft');
  assert.equal(await editor.save('AGENTS.md'), false);
  assert.equal(client.calls.filter(call => call.endpoint === 'codex-agents-md-save').length, 1);
});

test('discard and clean external reload request an editor remount without changing exact saved text', async () => {
  const client = new FakeClient(), editor = new Instructions(client, 'local');
  const original = '\ufeffFirst\r\nSecond\nThird\r';
  client.files.set('/fixture/AGENTS.md', original);
  await editor.load();
  assert.equal(editor.getSnapshot().files?.[0].draft, original);
  assert.equal(editor.getSnapshot().files?.[0].editorRevision, 0);
  editor.edit('AGENTS.md', `${original}draft`); editor.discard('AGENTS.md');
  assert.equal(editor.getSnapshot().files?.[0].draft, original);
  assert.equal(editor.getSnapshot().files?.[0].editorRevision, 1);
  client.files.set('/fixture/AGENTS.md', `${original}external`); await editor.load();
  assert.equal(editor.getSnapshot().files?.[0].draft, `${original}external`);
  assert.equal(editor.getSnapshot().files?.[0].editorRevision, 2);
});
