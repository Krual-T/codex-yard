import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TurnProgress, continuationPrompt, progressWaitMs } from '../src/native/turn-progress.ts';
import type { HostMessage } from '../src/native/protocol.ts';

const event = (method: string, params: Record<string, unknown> = {}, hostId = 'local'): HostMessage => ({
  type: 'mcp-notification', hostId, method, params: { threadId: 'chat', turnId: 'turn', ...params },
});

test('silence is timed from observed progress; unrelated events and metadata polls cannot hide it', () => {
  const progress = new TurnProgress('local', 'chat', 'turn', 0);
  assert.equal(progress.notice(progressWaitMs - 1), null);
  progress.observe(event('thread/status/changed', { status: { type: 'active' } }), 50_000);
  progress.observe(event('item/agentMessage/delta', { delta: 'other host' }, 'ssh'), 60_000);
  progress.observe(event('item/agentMessage/delta', { threadId: 'other', delta: 'other thread' }), 70_000);
  progress.observe(event('item/agentMessage/delta', { turnId: 'old-turn', delta: 'old turn' }), 80_000);
  assert.match(progress.notice(progressWaitMs)!, /2 分钟未收到新进展/);
  assert.equal(progress.notice(progressWaitMs, true), null, 'tools and approvals retain their native status');
  progress.observe(event('item/reasoning/summaryTextDelta', { delta: 'progress' }), progressWaitMs);
  assert.equal(progress.notice(progressWaitMs + 1), null);
  assert.match(progress.notice(progressWaitMs * 2)!, /未收到新进展/);
});

test('native retries and connection failures are explicit; progress and terminal states clear them', () => {
  const progress = new TurnProgress('local', 'chat', 'turn', 0);
  progress.observe(event('error', { error: { message: 'upstream unavailable' }, willRetry: true }), 1);
  assert.match(progress.notice(1)!, /正在重试/);
  progress.observe(event('item/agentMessage/delta', { delta: 'recovered' }), 2);
  assert.equal(progress.notice(2), null);
  progress.observe({ type: 'codex-app-server-connection-changed', hostId: 'ssh', state: 'disconnected' }, 3);
  assert.equal(progress.notice(3), null);
  progress.observe({ type: 'codex-app-server-connection-changed', hostId: 'local', state: 'disconnected' }, 3);
  assert.match(progress.notice(3)!, /任务可能仍在运行/);
  progress.observe({ type: 'codex-app-server-connection-changed', hostId: 'local', state: 'connected' }, 4);
  assert.equal(progress.notice(4), null);
  progress.observe(event('turn/completed', { turn: { id: 'old-turn' } }), 5);
  assert.equal(progress.finished, false);
  progress.observe(event('turn/completed', { turn: { id: 'turn' } }), 6);
  assert.equal(progress.notice(progressWaitMs * 3), null);
  const failed = new TurnProgress('local', 'chat', 'turn', 0);
  failed.observe(event('error', { willRetry: false }), 1);
  assert.equal(failed.notice(progressWaitMs), null, 'terminal errors remain owned by the native UI');
});

test('continuation uses recent completed results and the selected request, omitting image bytes and activity', () => {
  const prompt = continuationPrompt({ data: [
    { id: 'turn', status: 'inProgress', items: [
      { type: 'userMessage', content: [{ type: 'text', text: 'Convert /tmp/draft.md to Word.' },
        { type: 'localImage', path: '/tmp/source.png' }, { type: 'image', url: 'data:image/png;base64,AAAA' }] },
      { type: 'reasoning', text: 'PRIVATE_REASONING' },
    ] },
    { id: 'interrupted', status: 'interrupted', items: [{ type: 'agentMessage', text: 'INCOMPLETE_RESULT' }] },
    { id: 'completed', status: 'completed', items: [
      { type: 'agentMessage', phase: 'commentary', text: 'OLD_COMMENTARY' },
      { type: 'commandExecution', aggregatedOutput: 'TOOL_OUTPUT' },
      { type: 'agentMessage', phase: 'final_answer', text: 'Saved /tmp/draft.md with /tmp/source.png. data:image/png;base64,AAAA' },
    ] },
  ] }, 'chat', 'turn', 'ssh');
  assert.match(prompt, /执行主机：ssh/);
  assert.match(prompt, /Convert \/tmp\/draft.md/);
  assert.match(prompt, /Saved \/tmp\/draft.md/);
  assert.match(prompt, /附件原图：\/tmp\/source.png/);
  assert.doesNotMatch(prompt, /base64|PRIVATE_REASONING|INCOMPLETE_RESULT|OLD_COMMENTARY|TOOL_OUTPUT/);
  assert.throws(() => continuationPrompt({ data: [] }, 'chat', 'turn'), /轮次已改变/);
});
