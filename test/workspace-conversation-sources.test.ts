import assert from 'node:assert/strict';
import test from 'node:test';
import type { ThreadItemSummary, TurnSummary } from '../lib/codex-protocol.ts';
import { composerInput } from '../src/workspace/composer-input.ts';
import { conversationSources } from '../src/workspace/conversation-sources-model.ts';
import { pluginMentionMarkup, pluginMentionSegments } from '../src/workspace/output-types.ts';

const mcp = (id: string, server = 'fixture'): ThreadItemSummary => ({
  id, type: 'mcpToolCall', server, tool: 'inspect_sample',
});
const web = (id: string, action: Record<string, unknown>): ThreadItemSummary => ({
  id, type: 'webSearch', query: 'default', action, results: [{ url: 'https://sample.test/not-opened' }],
});
const turn = (id: string, items: ThreadItemSummary[], itemsView = 'summary'): TurnSummary =>
  ({ id, status: 'completed', itemsView, items });

test('Sources deduplicates attachments and pages without losing repeated MCP invocations', () => {
  const attachment = { name: 'sheet.png', path: '/workspace/sheet.png', image: true };
  const prompt = { id: 'prompt', type: 'userMessage', content: composerInput('Read the attachment', [attachment]) };
  const source = conversationSources([turn('first', [prompt])], new Map([
    ['first', [prompt, mcp('shared')]],
    ['second', [mcp('shared'), mcp('dev', 'plugin-runtime'),
      web('first', { type: 'search', query: 'example' }),
      web('second', { type: 'search', query: null, queries: ['example', 'another'] }),
      web('page', { type: 'openPage', url: 'https://sample.test/page' }),
      web('find', { type: 'findInPage', url: 'https://sample.test/page' }),
      web('bad', { type: 'openPage', url: 'file:///tmp/test' }),
      web('credentials', { type: 'openPage', url: 'https://user:pass@sample.test/page' })]],
  ]));
  assert.deepEqual(source.files, [attachment]);
  assert.equal(source.integrations.length, 1);
  assert.equal(source.integrations[0]?.name, 'Fixture');
  assert.deepEqual(source.integrations[0]?.tools[0]?.calls.map(call => call.id), ['second:shared', 'first:shared']);
  assert.equal(source.web.searchCount, 3);
  assert.deepEqual(source.web.queries, ['example', 'another']);
  assert.deepEqual(source.web.pages, [{ url: 'https://sample.test/page', label: 'sample.test/page' }]);
});

test('Sources uses authoritative full history and overlays live MCP updates by item id', () => {
  const started = { ...mcp('inspect'), status: 'inProgress' };
  const completed = { ...started, status: 'completed', result: { structuredContent: { ready: true } } };
  const live = new Map([['latest', [completed, mcp('provisional', 'other')]]]);
  const summary = conversationSources([turn('latest', [started])], live);
  assert.equal(summary.integrations.length, 2);
  assert.equal(summary.integrations.find(integration => integration.name === 'Fixture')?.tools[0]?.calls[0]?.item, completed);
  const full = conversationSources([turn('latest', [completed], 'full')], live);
  assert.equal(full.integrations.length, 1);
  assert.equal(full.integrations[0]?.tools[0]?.calls.length, 1);
});

test('Installed plugin mentions stay editable in drafts, and serialize to the Codex linked mention', () => {
  const mention = { label: 'Sample Inspector', plugin: 'sample-inspector@tool-fixture' };
  const raw = 'Use ' + pluginMentionMarkup(mention) + ' next.';
  assert.deepEqual(pluginMentionSegments(raw), ['Use ', mention, ' next.']);
  assert.deepEqual(composerInput(raw), [{ type: 'text', text: raw, text_elements: [] }]);
  assert.deepEqual(pluginMentionSegments('[@Unverified](plugin://other@host?query=1)'), ['[@Unverified](plugin://other@host?query=1)']);
});
