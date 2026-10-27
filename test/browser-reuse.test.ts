import assert from 'node:assert/strict';
import { test } from 'node:test';
import { get } from 'node:http';
import { chromeCommand, connectionArgs, createBrowserSession } from '../src/browser-reuse/chrome-mcp.ts';
import type { BrowserTools } from '../src/browser-reuse/chrome-mcp.ts';
import { startBrowserPreview } from '../src/browser-reuse/preview-server.ts';

test('connecting requires an explicit local endpoint or auto-connect, without a launch/profile fallback', () => {
  assert.deepEqual(connectionArgs({ autoConnect: true }), ['--autoConnect']);
  assert.deepEqual(connectionArgs({ browserUrl: 'http://127.0.0.1:9222' }), ['--browserUrl', 'http://127.0.0.1:9222']);
  for (const browserUrl of ['http://192.168.1.10:9222', 'http://localhost.evil:9222', 'https://127.0.0.1:9222', 'http://user:pass@localhost:9222', 'http://localhost:9222/path']) {
    assert.throws(() => connectionArgs({ browserUrl }));
  }
  const remote = chromeCommand({ autoConnect: true, windowsSsh: { host: 'XiaoXin', mcpEntry: "C:/MCP/User's copy/mcp.js" } });
  assert.equal(remote.command, 'ssh');
  assert.ok(remote.args.includes('StrictHostKeyChecking=yes'));
  const script = Buffer.from(remote.args.at(-1)!, 'base64').toString('utf16le');
  assert.match(script, /'C:\/MCP\/User''s copy\/mcp.js' '--autoConnect'/);
  assert.match(script, /NO_UPDATE_CHECKS = '1'/);
  for (const host of ['-oProxyCommand=bad', 'XiaoXin;bad', 'XiaoXin\nother']) {
    assert.throws(() => chromeCommand({ autoConnect: true, windowsSsh: { host, mcpEntry: 'C:/mcp.js' } }));
  }
  assert.throws(() => chromeCommand({ autoConnect: true, windowsSsh: { host: 'XiaoXin', mcpEntry: 'relative.js' } }));
});

test('a panel keeps page selection, input and screenshot together across concurrent actions and a failure', async () => {
  const calls: [string, Record<string, unknown>][] = [];
  const tools: BrowserTools = { async callTool(name, args = {}) {
    calls.push([name, args]);
    if (name === 'fill' && args.uid === '1_99') throw new Error('stale UID');
    return { content: name === 'take_screenshot' ? [{ type: 'image', mimeType: 'image/jpeg', data: 'test' }] : [{ type: 'text', text: name }] };
  } };
  const session = createBrowserSession(tools);
  const failed = session.run('fill', { pageId: 1, uid: '1_99', text: 'a' });
  const second = session.run('navigate', { pageId: 2, url: 'https://example.com/' });
  await assert.rejects(failed, /stale UID/);
  assert.equal((await second).pageId, 2);
  assert.deepEqual(calls.map(([name]) => name), ['select_page', 'fill', 'select_page', 'navigate_page', 'take_snapshot', 'take_screenshot']);
  assert.deepEqual(calls.map(([, args]) => args.pageId), [1, 1, 2, 2, 2, 2]);
  assert.equal(calls[0]![1].bringToFront, true);
  const count = calls.length;
  for (const [action, value] of [['navigate', { pageId: 2, url: 'file:///etc/passwd' }], ['fill', { pageId: 2, uid: 'bad' }], ['view', { pageId: 0 }], ['evaluate_script', { pageId: 2 }]] as const) {
    await assert.rejects(session.run(action, value));
  }
  assert.equal(calls.length, count);
});

test('the local preview requires both its per-process token and exact origin before browser access', async t => {
  let calls = 0;
  const app = await startBrowserPreview({ async callTool() { calls++; return { content: [{ type: 'text', text: '1: https://example.com [selected]' }] }; } });
  t.after(() => app.close());
  const headers = { Origin: app.origin, Authorization: 'Bearer ' + new URL(app.url).hash.slice(1), 'Content-Type': 'application/json' };
  for (const candidate of [{ ...headers, Origin: 'https://evil.example' }, { ...headers, Authorization: '' }]) {
    const response = await fetch(app.origin + '/command', { method: 'POST', headers: candidate, body: '{"action":"pages"}' });
    assert.equal(response.status, 403);
  }
  // Node fetch normalizes Host; use HTTP to send an actual foreign Host.
  const foreignHost = await new Promise<number>(resolve => get(app.origin, { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode!); }));
  assert.equal(foreignHost, 403);
  assert.equal(calls, 0);
  const response = await fetch(app.origin + '/command', { method: 'POST', headers, body: '{"action":"pages"}' });
  assert.match((await response.json()).text, /example.com/);
  assert.equal(calls, 1);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const page = await fetch(app.origin);
  assert.match(page.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
});
