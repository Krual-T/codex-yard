import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PassThrough } from 'node:stream';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { NodeRuntime } from '../plugins/yard-node/runtime.ts';
import { serveNode } from '../plugins/yard-node/server.ts';

test('standalone Node retains bindings, awaits imports, returns text/images and resets explicitly', async t => {
  const runtime = new NodeRuntime(); t.after(() => runtime.close());
  await runtime.evaluate('var count = 40');
  assert.match(JSON.stringify(await runtime.evaluate('await Promise.resolve(count + 2)')), /42/);
  assert.match(JSON.stringify(await runtime.evaluate('var fs = await yardNode.import("node:fs/promises"); console.log(typeof fs.readFile)')), /function/);
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X6AAAAABJRU5ErkJggg==';
  const image = await runtime.evaluate(`yardNode.emitImage({bytes:Buffer.from('${png}','base64'),mimeType:'image/png'})`);
  assert.deepEqual(image, [{ type: 'image', data: png, mimeType: 'image/png' }]);
  runtime.reset();
  assert.match(JSON.stringify(await runtime.evaluate('typeof count')), /undefined/);
});

test('errors retain a usable kernel; output overflow discards it instead of flooding MCP', async t => {
  const runtime = new NodeRuntime(); t.after(() => runtime.close());
  await runtime.evaluate('var kept = 7');
  await assert.rejects(runtime.evaluate('throw new Error("cell failed")'), /cell failed/);
  assert.match(JSON.stringify(await runtime.evaluate('kept')), /7/);
  await assert.rejects(runtime.evaluate('console.log("x".repeat(70000))'), /output limit/);
  assert.match(JSON.stringify(await runtime.evaluate('typeof kept')), /undefined/);
});

test('timeout and cancellation discard variables without retrying prior file side effects', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'yard-node-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const runtime = new NodeRuntime(directory); t.after(() => runtime.close());
  await runtime.evaluate('var fs = await yardNode.import("node:fs/promises"); var before = 1');
  await assert.rejects(runtime.evaluate('await fs.appendFile("effects", "once"); while(true){}', 200), /timed out.*not retried/);
  assert.equal(await readFile(join(directory, 'effects'), 'utf8'), 'once');
  assert.match(JSON.stringify(await runtime.evaluate('typeof before')), /undefined/);
  const abort = new AbortController();
  const pending = runtime.evaluate('await new Promise(() => {})', 30000, abort.signal);
  await delay(50); abort.abort();
  await assert.rejects(pending, /cancelled/);
  assert.match(JSON.stringify(await runtime.evaluate('1 + 1')), /2/);
});

test('queued cancelled code never executes, raw output stays out of the MCP channel, and a lost kernel recovers', async t => {
  const runtime = new NodeRuntime(); t.after(() => runtime.close());
  const first = runtime.evaluate('var calls = 0; await new Promise(r=>setTimeout(r,80))');
  const abort = new AbortController();
  const second = runtime.evaluate('calls++', 30000, abort.signal); abort.abort();
  const rejected = assert.rejects(second, /abort/i);
  await first; await rejected;
  assert.match(JSON.stringify(await runtime.evaluate('calls')), /0/);
  assert.match(JSON.stringify(await runtime.evaluate('process.stdout.write("raw output")')), /raw output/);
  await assert.rejects(runtime.evaluate('process.exit(0)'), /process exited/);
  assert.match(JSON.stringify(await runtime.evaluate('6 * 7')), /42/);
});

test('the stdio MCP session exposes the standalone tools and reports execution errors as errors', async () => {
  const input = new PassThrough(), output = new PassThrough();
  const messages: any[] = []; let buffer = '';
  output.on('data', chunk => {
    buffer += chunk;
    for (;;) { const at = buffer.indexOf('\n'); if (at < 0) break; messages.push(JSON.parse(buffer.slice(0, at))); buffer = buffer.slice(at + 1); }
  });
  const serving = serveNode(input, output);
  const send = (id: number, method: string, params = {}) => input.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  send(1, 'initialize'); send(2, 'tools/list'); send(3, 'tools/call', { name: 'evaluate', arguments: { code: 'throw new Error("expected error")' } });
  for (let i = 0; !messages.some(m => m.id === 3) && i < 100; i++) await delay(20);
  input.end(); await serving;
  assert.deepEqual(messages.find(m => m.id === 2).result.tools.map((tool: any) => tool.name), ['evaluate', 'reset']);
  assert.equal(messages.find(m => m.id === 3).result.isError, true);
  assert.match(JSON.stringify(messages.find(m => m.id === 3)), /expected error/);
});

test('a kernel startup failure reports an error and close completes without waiting for an exit that never occurs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'yard-node-missing-'));
  await rm(directory, { recursive: true });
  const runtime = new NodeRuntime(directory);
  try { await assert.rejects(runtime.evaluate('1 + 1'), /process exited/); }
  finally {
    await Promise.race([runtime.close(), delay(2000).then(() => { throw new Error('Kernel close hung after startup failure'); })]);
  }
});
