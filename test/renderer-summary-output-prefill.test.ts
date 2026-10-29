import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSummaryOutputPrefill } from '../src/renderer/app/summary-output-prefill.ts';
import type { SummaryOutputKind } from '../src/renderer/app/summary-output-prefill.ts';
import { readRichDocument } from '../src/renderer/composer/rich-document.ts';
import { draftToInput, mergePrefill, normalizeDraft } from '../src/renderer/composer/standalone-draft.ts';
import { listPlugins } from '../src/renderer/pages/plugins/catalog.ts';
import type { PluginCatalog, PluginEntry } from '../src/renderer/pages/plugins/catalog.ts';
import type { ComposerDraft, WorkbenchClient } from '../src/renderer/workbench-contract.ts';

const context = { hostId: 'ssh:fixture', cwd: '/workspace/project' };
const original: { kind: SummaryOutputKind; noun: string; label: string; id: string; messageId: string }[] = [
  { kind: 'document', noun: 'document', label: 'Documents', id: 'documents@openai-primary-runtime', messageId: 'home.newChatPageSuggestions.createDocument.prompt.v5' },
  { kind: 'presentation', noun: 'presentation', label: 'Presentations', id: 'presentations@openai-primary-runtime', messageId: 'home.newChatPageSuggestions.createPresentation.prompt.v5' },
  { kind: 'spreadsheet', noun: 'spreadsheet', label: 'Spreadsheets', id: 'spreadsheets@openai-primary-runtime', messageId: 'home.newChatPageSuggestions.createSpreadsheet.prompt.v5' },
  { kind: 'site', noun: 'site', label: 'Sites', id: 'sites@openai-curated-remote', messageId: 'home.newChatPageSuggestions.createSite.prompt.v5' },
];

function entry(id: string, options: Partial<PluginEntry['plugin']> = {}): PluginEntry {
  return { marketplaceName: id.split('@')[1]!, marketplacePath: '/fixture/marketplace.json', plugin: {
    id, name: 'documents', installed: true, enabled: true, installPolicy: 'AVAILABLE', source: { type: 'local' }, ...options,
  } };
}

test('the four original actions retain their distinct full prompts and plugin nodes', () => {
  for (const expected of original) {
    const result = createSummaryOutputPrefill({ kind: expected.kind, context });
    const path = `plugin://${expected.id}`;
    assert.equal(result.message.id, expected.messageId);
    assert.equal(result.prompt, `Create a new ${expected.noun} with [@${expected.label}](${path}). Start by asking me what it should be about.`);
    assert.equal(result.pluginId, expected.id);
    assert.deepEqual(result.mention, { type: 'pluginMention', attrs: {
      name: expected.label, displayName: expected.label, path, description: '',
    } });
    assert.deepEqual(result.document.content?.[0]?.content, [
      { type: 'text', text: `Create a new ${expected.noun} with ` },
      result.mention,
      { type: 'text', text: '. Start by asking me what it should be about.' },
    ]);
    assert.ok(readRichDocument(result.document));
    assert.deepEqual(draftToInput({ text: result.prompt, images: [], files: [], document: result.document }, context.hostId),
      [{ type: 'text', text: result.prompt, text_elements: [] }]);
    assert.deepEqual(result.observation, { status: 'unknown', warnings: [] });
  }
});

test('plugin observations use exact IDs and the captured host and cwd, without inventing availability', () => {
  const wanted = entry('documents@openai-primary-runtime', { installed: false, enabled: false,
    availability: 'DISABLED_BY_ADMIN', disabledReason: 'disabled_by_admin' });
  const other = entry('documents@other-marketplace');
  const catalog: PluginCatalog = { entries: [other, wanted], warnings: ['fixture marketplace failed'] };
  const before = structuredClone(catalog);
  const inventory = { ...context, catalog };
  const observed = createSummaryOutputPrefill({ kind: 'document', context, inventory }).observation;
  assert.deepEqual(observed, { status: 'observed', warnings: ['fixture marketplace failed'], marketplaceName: 'openai-primary-runtime',
    marketplacePath: '/fixture/marketplace.json', name: 'documents', sourceType: 'local', installPolicy: 'AVAILABLE', installed: false, enabled: false,
    availability: 'DISABLED_BY_ADMIN', disabledReason: 'disabled_by_admin' });
  assert.deepEqual(catalog, before);
  assert.deepEqual(createSummaryOutputPrefill({ kind: 'document', context, inventory: { ...inventory, hostId: 'ssh:other' } }).observation,
    { status: 'scope-mismatch', warnings: [] });
  assert.deepEqual(createSummaryOutputPrefill({ kind: 'document', context, inventory: { ...inventory, cwd: '/other' } }).observation,
    { status: 'scope-mismatch', warnings: [] });
  assert.deepEqual(createSummaryOutputPrefill({ kind: 'site', context, inventory }).observation,
    { status: 'not-reported', warnings: ['fixture marketplace failed'] });
  assert.deepEqual(createSummaryOutputPrefill({ kind: 'document', context,
    inventory: { ...inventory, catalog: { entries: [wanted, wanted], warnings: [] } } }).observation,
  { status: 'ambiguous', warnings: [] });
});

test('the existing plugin-list consumer supplies scoped inventory to the prefill helper', async () => {
  const wanted = entry('spreadsheets@openai-primary-runtime', { name: 'spreadsheets', source: { type: 'remote' } });
  const calls: { method: string; params?: Record<string, unknown>; hostId?: string }[] = [];
  const client: WorkbenchClient = {
    async rpc<T>(method: string, params?: Record<string, unknown>, hostId?: string): Promise<T> {
      calls.push({ method, params, hostId });
      return { marketplaces: [{ name: wanted.marketplaceName, path: null, plugins: [wanted.plugin] }],
        marketplaceLoadErrors: [] } as T;
    },
    async host<T>(): Promise<T> { throw new Error('Unexpected host request'); },
    async reply(): Promise<void> { throw new Error('Unexpected approval'); },
    subscribe() { return () => {}; },
  };
  const catalog = await listPlugins(client, context.hostId, context.cwd, false);
  const result = createSummaryOutputPrefill({ kind: 'spreadsheet', context, inventory: { ...context, catalog } });
  assert.deepEqual(calls, [{ method: 'plugin/list', params: { cwds: [context.cwd] }, hostId: context.hostId }]);
  assert.equal(result.observation.status, 'observed');
  if (result.observation.status !== 'observed') throw new Error('Expected observed plugin');
  assert.equal(result.observation.name, 'spreadsheets');
  assert.equal(result.observation.sourceType, 'remote');
  assert.equal(result.observation.installed, true);
  assert.equal(result.mention.attrs.path, 'plugin://spreadsheets@openai-primary-runtime');
});

test('translated templates preserve the reference position and reject lossy substitutions', () => {
  const result = createSummaryOutputPrefill({ kind: 'presentation', context, formatMessage(message) {
    assert.equal(message.id, 'home.newChatPageSuggestions.createPresentation.prompt.v5');
    return '请用 {artifact} 创建演示文稿，并先询问主题。';
  } });
  assert.equal(result.prompt, '请用 [@Presentations](plugin://presentations@openai-primary-runtime) 创建演示文稿，并先询问主题。');
  assert.deepEqual(result.document.content?.[0]?.content, [
    { type: 'text', text: '请用 ' }, result.mention, { type: 'text', text: ' 创建演示文稿，并先询问主题。' },
  ]);
  for (const template of ['missing reference', '{artifact} and {artifact}', '**{artifact}**', 'a\n{artifact}']) {
    assert.throws(() => createSummaryOutputPrefill({ kind: 'site', context, formatMessage: () => template }));
  }
});

test('composer serializes the real plugin node and keeps the existing pending-prefill contract', () => {
  const result = createSummaryOutputPrefill({ kind: 'document', context });
  const incoming: ComposerDraft = { text: result.prompt, images: [], files: [], document: result.document };
  assert.ok(readRichDocument(result.document));
  assert.deepEqual(draftToInput(incoming, context.hostId), [{ type: 'text', text: result.prompt, text_elements: [] }]);
  const current = normalizeDraft({ text: 'existing', images: [{ id: 'image', src: 'data:image/png;base64,AA==' }],
    files: [], document: { type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'existing', marks: [{ type: 'strong' }] },
    ] }] }, hints: [{ future: 'retained' }] });
  const before = structuredClone(current);
  const merged = mergePrefill(current, incoming);
  assert.deepEqual(current, before);
  assert.deepEqual(merged, { ...before, pendingDrafts: [incoming] });
});
