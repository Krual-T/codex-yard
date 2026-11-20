import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WindowsDesktop, windowsScript } from '../plugins/yard-computer/windows.ts';
import { computerConfig } from '../lib/computer.ts';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X6AAAAABJRU5ErkJggg==';
test('Windows driver selection requires explicit independent runtime paths and carries selection across WSL argv', () => {
  assert.throws(() => computerConfig({ YARD_COMPUTER_DRIVER: 'unknown' }), /must be/);
  if (process.platform !== 'win32') assert.throws(() => computerConfig({ YARD_COMPUTER_DRIVER: 'windows' }), /Windows Node/);
  const result = computerConfig({ YARD_COMPUTER_DRIVER: 'windows', YARD_COMPUTER_WINDOWS_NODE: '/mnt/c/node/node.exe', YARD_COMPUTER_WINDOWS_SERVER: 'C:\\yard\\plugins\\yard-computer\\server.ts' });
  assert.equal(result['mcp_servers.yard_computer.command'], '/mnt/c/node/node.exe');
  assert.deepEqual(result['mcp_servers.yard_computer.args'], ['C:\\yard\\plugins\\yard-computer\\server.ts', '--driver=windows']);
  assert.equal(result['mcp_servers.yard_computer.enabled'], undefined);
  assert.equal(result['mcp_servers.yard_computer.default_tools_approval_mode'], undefined);
});

test('Windows screenshots expose primary-monitor physical pixels and validate returned PNG dimensions', async () => {
  const desktop = new WindowsDesktop({ run: async () => JSON.stringify({ display: 'windows:primary', width: 1, height: 1, image: png }) });
  const content = await desktop.execute({ type: 'screenshot' });
  assert.equal(content[1]!.type, 'image');
  assert.match(JSON.stringify(content[0]), /physical primary-monitor pixels/);
  const invalid = new WindowsDesktop({ run: async () => JSON.stringify({ display: 'windows:primary', width: 2, height: 1, image: png }) });
  await assert.rejects(invalid.execute({ type: 'screenshot' }), /Invalid Windows screenshot PNG/);
});

test('Windows action values remain data, malformed input never launches a helper, failures never retry', async () => {
  let calls = 0;
  const desktop = new WindowsDesktop({ run: async () => { calls++; throw new Error('partial input'); } });
  await assert.rejects(desktop.execute({ type: 'click', x: -1, y: 1 }));
  assert.equal(calls, 0);
  await assert.rejects(desktop.execute({ type: 'type', text: 'test' }), /not retried.*may already have changed/);
  assert.equal(calls, 1);
  const text = "'; Stop-Process explorer; #";
  const script = windowsScript({ type: 'type', text });
  assert.equal(script.includes(text), false);
  assert.match(script, /FromBase64String/);
  assert.match(script, /ReleaseMutex/);
  assert.match(script, /release was attempted/);
  assert.match(script, /ReadCancel/);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(desktop.execute({ type: 'screenshot' }, abort.signal), /abort/i);
  assert.equal(calls, 1);
});
