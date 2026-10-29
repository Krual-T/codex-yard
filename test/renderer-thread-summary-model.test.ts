import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectThreadSummary } from '../src/renderer/app/thread-summary-model.ts';
import type { ThreadSummary } from '../lib/codex-protocol.ts';

test('summary projects actual attachments, search and tools without turning arbitrary values into links or outputs', () => {
  const thread: ThreadSummary = { id: 'one', cwd: '/work', name: null, status: { type: 'idle' }, turns: [
    { id: 'turn', status: 'completed', items: [
      { id: 'user', type: 'userMessage', content: [{ type: 'localImage', path: '/work/photo.png' },
        { type: 'localImage', path: '/work/photo.png' }, { type: 'mention', path: '/not-an-attachment' }] },
      { id: 'plan', type: 'plan', text: '# Check the change' },
      { id: 'search', type: 'webSearch', query: 'query', action: { type: 'openPage', url: 'javascript:alert(1)' } },
      { id: 'search2', type: 'webSearch', action: { type: 'findInPage', url: 'https://example.test/page' } },
      { id: 'tool', type: 'mcpToolCall', server: 'search', tool: 'lookup' },
      { id: 'tool2', type: 'mcpToolCall', server: 'search', tool: 'lookup' },
      { id: 'change', type: 'fileChange', changes: [{ path: '/work/unrelated.ts' }] },
    ] },
    { id: 'running', status: 'inProgress', items: [{ id: 'running-plan', type: 'plan', text: '# Not finished' }] },
  ] };
  assert.deepEqual(projectThreadSummary(thread, 'local'), {
    plan: { hostId: 'local', threadId: 'one', cwd: '/work', turnId: 'turn', itemId: 'plan', text: '# Check the change' },
    sources: [{ kind: 'file', path: '/work/photo.png', label: 'photo.png' },
      { kind: 'tool', server: 'search', tools: ['lookup'] },
      { kind: 'web', queries: ['query'], urls: ['https://example.test/page'] }],
  });
});
