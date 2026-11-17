import assert from 'node:assert/strict';
import { once } from 'node:events';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { serveComputer } from '../plugins/yard-computer/server.ts';
import { X11Desktop } from '../plugins/yard-computer/desktop.ts';
import type { ComputerExecutor } from '../plugins/yard-computer/server.ts';

async function exchange(requests: unknown[], executor: ComputerExecutor, fragmented = false) {
  const bytes = Buffer.from(requests.map(value => JSON.stringify(value) + '\n').join(''));
  const chunks = fragmented ? [...bytes].map(byte => Buffer.from([byte])) : [bytes];
  const output = new PassThrough();
  const input = new PassThrough();
  let text = '';
  output.setEncoding('utf8'); output.on('data', chunk => { text += chunk; });
  const running = serveComputer(input, output, executor);
  const expected = requests.filter(value => value && typeof value === 'object' && 'id' in value).length;
  for (const chunk of chunks) input.write(chunk);
  try {
    while (text.split('\n').length - 1 < expected) await once(output, 'data', { signal: AbortSignal.timeout(5000) });
  } finally { input.end(); await running; }
  return text.trim().split('\n').map(line => JSON.parse(line) as Record<string, any>).sort((a, b) => a.id - b.id);
}
const request = (id: number, method: string, params: unknown = {}) => ({ jsonrpc: '2.0', id, method, params });

test('computer MCP keeps Unicode frames, real images and tool failures, and executes each action once in order', async () => {
  const seen: unknown[] = [];
  const replies = await exchange([
    request(1, 'tools/list'), request(2, 'initialize', { protocolVersion: '2024-11-05' }),
    { jsonrpc: '2.0', method: 'notifications/initialized' }, request(3, 'tools/list'),
    request(4, 'tools/call', { name: 'computer', arguments: { type: 'type', text: '你好 Yard' } }),
    request(5, 'tools/call', { name: 'computer', arguments: { type: 'click', x: 12, y: 20 } }),
    request(6, 'tools/call', { name: 'other', arguments: {} }), request(7, 'ping'),
  ], { async execute(action) {
    seen.push(action);
    if (seen.length === 2) throw new Error('Lost desktop reply; inspect before continuing.');
    return [{ type: 'image', mimeType: 'image/png', data: 'unchanged-png' }];
  } }, true);
  assert.equal(replies[0]!.error.code, -32002);
  assert.equal(replies[1]!.result.protocolVersion, '2024-11-05');
  assert.equal(replies[2]!.result.tools[0].name, 'computer');
  assert.equal(replies[3]!.result.content[0].data, 'unchanged-png');
  assert.deepEqual(seen, [{ type: 'type', text: '你好 Yard' }, { type: 'click', x: 12, y: 20 }]);
  assert.equal(replies[4]!.result.isError, true);
  assert.match(replies[4]!.result.content[0].text, /Lost desktop reply/);
  assert.equal(replies[5]!.error.code, -32602);
  assert.deepEqual(replies[6]!.result, {});
});

test('an installed computer plugin initializes without a desktop and gives actionable setup errors on use', async () => {
  const replies = await exchange([request(1, 'initialize'), request(2, 'tools/list'),
    request(3, 'tools/call', { name: 'computer', arguments: { type: 'screenshot' } })], new X11Desktop({ display: '' }));
  assert.ok(replies[0]!.result.serverInfo);
  assert.equal(replies[1]!.result.tools.length, 1);
  assert.equal(replies[2]!.result.isError, true);
  assert.match(replies[2]!.result.content[0].text, /display|DISPLAY|桌面/i);
});

for (const stop of ['notification', 'eof', 'shutdown', 'output-close'] as const) test(`MCP ${stop} cancels pending desktop work without returning false success`, { timeout: 5000 }, async () => {
  const input = new PassThrough(), output = new PassThrough();
  const shutdown = new AbortController();
  let text = '', started!: () => void, didCancel!: () => void;
  const begun = new Promise<void>(resolve => { started = resolve; });
  const aborted = new Promise<void>(resolve => { didCancel = resolve; });
  let cancelled = 0;
  output.setEncoding('utf8'); output.on('data', chunk => { text += chunk; });
  const running = serveComputer(input, output, { async execute(_action, signal) {
    started();
    await new Promise<void>((_resolve, reject) => signal!.addEventListener('abort', () => {
      cancelled++; didCancel(); reject(new Error('cancelled'));
    }, { once: true }));
    return [];
  } }, shutdown.signal);
  // Observe transport rejections immediately, while still checking cancellation.
  const completion = Promise.allSettled([running]);
  input.write(JSON.stringify(request(1, 'initialize')) + '\n');
  input.write(JSON.stringify(request(2, 'tools/call', { name: 'computer', arguments: { type: 'click', x: 1, y: 2 } })) + '\n');
  await begun;
  if (stop === 'notification') input.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 2 } }) + '\n');
  else if (stop === 'eof') input.end();
  else if (stop === 'shutdown') shutdown.abort();
  else output.destroy();
  await aborted;
  if (stop === 'notification') input.end();
  const [result] = await completion;
  if (stop === 'notification' || stop === 'eof') assert.equal(result!.status, 'fulfilled');
  assert.equal(cancelled, 1);
  assert.equal(text.trim().split('\n').length, 1);
});

test('MCP EOF waits for cancelled desktop cleanup before ending the session', { timeout: 5000 }, async () => {
  const input = new PassThrough(), output = new PassThrough();
  output.resume();
  let started!: () => void, cancelled!: () => void, release!: () => void, ended = false;
  const begun = new Promise<void>(resolve => { started = resolve; });
  const aborted = new Promise<void>(resolve => { cancelled = resolve; });
  const cleanup = new Promise<void>(resolve => { release = resolve; });
  const events: string[] = [];
  const running = serveComputer(input, output, { async execute(_action, signal) {
    started();
    await new Promise<void>(resolve => signal!.addEventListener('abort', () => { cancelled(); resolve(); }, { once: true }));
    events.push('cancelled');
    await cleanup;
    events.push('input exited; mouse released; lock released');
    return [];
  } }).then(() => { ended = true; events.push('session ended'); });
  input.write(JSON.stringify(request(1, 'initialize')) + '\n');
  input.write(JSON.stringify(request(2, 'tools/call', { name: 'computer', arguments: { type: 'drag' } })) + '\n');
  await begun; input.end(); await aborted;
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(ended, false);
  release(); await running;
  assert.deepEqual(events, ['cancelled', 'input exited; mouse released; lock released', 'session ended']);
});
