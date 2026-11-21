import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nodeReplConfig, nodeReplOverrides, standalonePluginConfig, filePluginNames } from '../lib/standalone-tools.ts';

test('original Node transport replaces App bindings and preserves disabled, required, approval and timeout policy', () => {
  const previous = { enabled: false, required: true, command: '/old/App/node_repl', url: 'http://old.invalid',
    args: ['--disable-sandbox'], cwd: '/old/App', http_headers: { Authorization: 'obsolete' },
    env: { CODEX_HOME: '/old/App/home', NODE_REPL_NODE_PATH: '/old/App/node', SKY_CUA_NATIVE_PIPE: '1', CDP_BROWSER_BACKEND_PIPE_PATH: '/old/App/browser', KEEP_SETTING: 'keep' },
    env_vars: ['NODE_REPL_NODE_PATH', 'CDP_BROWSER_BACKEND_PIPE_PATH', 'KEEP_VARIABLE'], startup_timeout_sec: 30, tool_timeout_sec: 500,
    default_tools_approval_mode: 'prompt', tools: { js: { approval_mode: 'approve' } } };
  const result = nodeReplConfig({ mcp_servers: { node_repl: previous } }, { ...process.env, CODEX_HOME: '/private/backend-home' })['mcp_servers.node_repl'];
  assert.equal(result.env.CODEX_HOME, '/private/backend-home');
  assert.equal(result.enabled, false); assert.equal(result.required, true);
  assert.equal(result.startup_timeout_sec, 30); assert.equal(result.tool_timeout_sec, 500);
  assert.deepEqual(result.tools, previous.tools); assert.equal(result.default_tools_approval_mode, 'prompt');
  assert.equal('url' in result, false); assert.equal('http_headers' in result, false); assert.equal('cwd' in result, false);
  assert.deepEqual(result.args, []); assert.ok(!JSON.stringify(result).includes('/old/App'));
  assert.deepEqual(result.env_vars, ['KEEP_VARIABLE']);
  assert.equal(result.env.KEEP_SETTING, 'keep'); assert.equal(result.env.SKY_CUA_NATIVE_PIPE, '0');
  assert.equal(result.env.CDP_BROWSER_BACKEND_PIPE_PATH, '');
  assert.ok(result.env.CODEX_CLI_PATH); assert.equal(result.env.NODE_REPL_NODE_PATH, process.execPath);
  assert.throws(() => nodeReplConfig({}, { ...process.env, YARD_COMPUTER_DISPLAY: 'remote:0' }), /local X11/);
  const desktop = nodeReplConfig({}, { ...process.env, YARD_COMPUTER_DISPLAY: ':99', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/private/test-bus' })['mcp_servers.node_repl'];
  assert.equal(desktop.env.DBUS_SESSION_BUS_ADDRESS, 'unix:path=/private/test-bus');
});

test('caller nested, table and field overrides merge into policy before transport replacement', () => {
  const folded = nodeReplOverrides({ mcp_servers: { node_repl: { required: true, enabled: true } } }, {
    mcp_servers: { node_repl: { enabled: false }, another: { command: 'custom' } },
    'mcp_servers.node_repl': { tool_timeout_sec: 400 }, 'mcp_servers.node_repl.tools.js.approval_mode': 'prompt', model: 'chosen',
  });
  const result = nodeReplConfig(folded.effective)['mcp_servers.node_repl'];
  assert.equal(result.enabled, false); assert.equal(result.required, true); assert.equal(result.tool_timeout_sec, 400);
  assert.deepEqual(result.tools, { js: { approval_mode: 'prompt' } });
  assert.deepEqual(folded.remaining, { 'mcp_servers.another': { command: 'custom' }, model: 'chosen' });
});

test('canonical packages replace only their installed counterparts in Yard session overrides', () => {
  const files = filePluginNames.map(name => name + '@codex-yard');
  const config = standalonePluginConfig([...files, 'documents@openai-primary-runtime', 'yard-artifacts@old', 'yard-node@old', 'unrelated@custom']);
  assert.equal(config['plugins."documents@codex-yard".enabled'], true);
  assert.equal(config['plugins."documents@openai-primary-runtime".enabled'], false);
  assert.equal(config['plugins."yard-artifacts@old".enabled'], false);
  assert.equal(config['plugins."yard-node@old".enabled'], false);
  assert.equal(config['plugins."unrelated@custom".enabled'], undefined);
  assert.equal(standalonePluginConfig(['yard-artifacts@old'])['plugins."yard-artifacts@old".enabled'], undefined);
});

test('WSL Windows desktop selection uses independent helpers without inheriting App pipes', () => {
  const env = { ...process.env, YARD_COMPUTER_TARGET: 'windows', YARD_WINDOWS_NODE: 'C:\\Node\\node.exe',
    YARD_WINDOWS_CODEX_BIN: 'C:\\Codex\\codex.exe', YARD_IAB_SOCKET: '/private/browser.sock', YARD_BROWSER_BACKEND_PATHS: '/private/browser.sock:/private/chrome.sock' };
  const config = nodeReplConfig({}, env, ['browser@codex-yard', 'chrome@codex-yard'])['mcp_servers.node_repl'];
  assert.match(config.env.OAI_SKY_CONFIG_PATH, /sky-windows-options\.json$/);
  assert.match(config.env.OAI_SKY_WINDOWS_BIN, /sky-windows-helper\.ts$/);
  assert.equal(config.env.YARD_WINDOWS_NODE, env.YARD_WINDOWS_NODE);
  assert.equal(config.env.YARD_WINDOWS_CODEX_BIN, env.YARD_WINDOWS_CODEX_BIN);
  assert.equal(config.env.SKY_CUA_NATIVE_PIPE, '0');
  assert.equal(config.env.BROWSER_USE_AVAILABLE_BACKENDS, 'iab,chrome');
  assert.equal(config.env.BROWSER_USE_BACKEND_PATHS, env.YARD_BROWSER_BACKEND_PATHS);
  assert.match(config.env.NODE_REPL_TRUSTED_SERVICES, /browser-service\.mjs/);
  assert.throws(() => nodeReplConfig({}, { ...env, YARD_COMPUTER_DISPLAY: ':0' }), /Choose either/);
});

test('an installed original Browser replacement disables the App-managed cua_repl plugin only in its session', () => {
  const app = 'unified-computer-use@openai-bundled';
  assert.equal(standalonePluginConfig([app])[`plugins."${app}".enabled`], undefined);
  for (const replacement of ['browser@codex-yard', 'chrome@codex-yard']) {
    assert.equal(standalonePluginConfig([app, replacement])[`plugins."${app}".enabled`], false);
  }
});
