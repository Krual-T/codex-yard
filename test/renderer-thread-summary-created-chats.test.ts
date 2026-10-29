import assert from 'node:assert/strict';
import { test } from 'node:test';
import { success } from '../lib/native-tool-kernel.ts';
import type { ThreadSummary } from '../lib/codex-protocol.ts';
import { projectCreatedChats } from '../src/renderer/app/thread-summary-created-chats.ts';

test('created chats retain the originating receipt and actual host, ignoring failed and unresolved calls', () => {
  const thread: ThreadSummary = { id: 'parent', cwd: '/work', name: null, status: { type: 'idle' }, turns: [
    { id: 'one', status: 'completed', items: [
      { id: 'dynamic', type: 'dynamicToolCall', namespace: 'codex_app', tool: 'create_thread', status: 'completed',
        ...success({ threadId: 'same', hostId: 'remote' }) },
      { id: 'failed', type: 'dynamicToolCall', namespace: 'codex_app', tool: 'create_thread', status: 'completed',
        ...success({ threadId: 'failed' }), success: false },
      { id: 'unresolved', type: 'dynamicToolCall', namespace: 'codex_app', tool: 'create_thread', status: 'completed',
        ...success({ clientThreadId: 'temporary' }) },
      { id: 'cloud', type: 'dynamicToolCall', namespace: 'codex_app', tool: 'create_thread', status: 'completed',
        ...success({ kind: 'chatgpt', threadId: 'cloud' }) },
      { id: 'mcp', type: 'mcpToolCall', server: 'codex_app', tool: 'create_thread', status: 'completed', error: null,
        result: { content: [{ type: 'text', text: JSON.stringify({ kind: 'codex', threadId: 'same' }) }] } },
      { id: 'wrong-host', type: 'dynamicToolCall', namespace: 'codex_app', tool: 'create_thread', status: 'completed',
        ...success({ threadId: 'invalid', hostId: 42 }) },
    ] },
  ] };
  assert.deepEqual(projectCreatedChats(thread, 'local', 'Created chat'), [
    { hostId: 'local', threadId: 'same', label: 'Created chat', source: { hostId: 'local', threadId: 'parent', turnId: 'one', itemId: 'mcp' } },
    { hostId: 'remote', threadId: 'same', label: 'Created chat', source: { hostId: 'local', threadId: 'parent', turnId: 'one', itemId: 'dynamic' } },
  ]);
});
