import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computerConfig } from '../lib/computer.ts';

test('desktop mounting requires an explicit local display and passes only desktop configuration to the existing daemon', () => {
  assert.deepEqual(computerConfig({ DISPLAY: ':0' }), {});
  assert.throws(() => computerConfig({ YARD_COMPUTER_DISPLAY: 'another-host:0' }), /本机 X11/);
  const config = computerConfig({ YARD_COMPUTER_DISPLAY: ':99', YARD_COMPUTER_XAUTHORITY: '/private/authority',
    YARD_COMPUTER_IMPORT: '/system/import', SECRET_TOKEN: 'never-pass' });
  assert.equal(config['mcp_servers.yard_computer.env.YARD_COMPUTER_DISPLAY'], ':99');
  assert.equal(config['mcp_servers.yard_computer.env.YARD_COMPUTER_XAUTHORITY'], '/private/authority');
  assert.equal(config['mcp_servers.yard_computer.env.YARD_COMPUTER_IMPORT'], '/system/import');
  assert.equal(config['mcp_servers.yard_computer.command'], process.execPath);
  assert.match((config['mcp_servers.yard_computer.args'] as string[])[0]!, /plugins\/yard-computer\/server\.ts$/);
  assert.equal(config['mcp_servers.yard_computer.enabled'], undefined);
  assert.equal(config['mcp_servers.yard_computer.default_tools_approval_mode'], undefined);
  assert.equal(JSON.stringify(config).includes('SECRET_TOKEN'), false);
});
