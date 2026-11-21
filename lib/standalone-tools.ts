import { constants, accessSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { projectRoot } from './app-resources.ts';
import { isRecord } from './codex-protocol.ts';

export const nodeRuntimeVersion = '0.0.30-20261014203459-0849368674e2';
export const filePluginNames = ['documents', 'pdf', 'spreadsheets', 'presentations', 'template-creator'] as const;
const pluginNames = [...filePluginNames, 'computer-use', 'browser', 'chrome'];
const object = (value: unknown): Record<string, unknown> => isRecord(value) ? value : {};

function codexExecutable(env: NodeJS.ProcessEnv): string {
  const name = env.AGENTS_CODEX_BIN || 'codex';
  const candidates = isAbsolute(name) ? [name] : (env.PATH || process.env.PATH || '').split(delimiter).map(path => join(path, name));
  const executable = candidates.find(path => { try { accessSync(path, constants.X_OK); return true; } catch { return false; } });
  // Let the native MCP supervisor retain its disabled/optional/required and
  // tool-call failure semantics when a documented dependency is absent.
  return executable || name;
}

/** Replace the transport as one table, preserving the effective backend policy.
 * In particular, a disabled/required server and per-tool approvals stay so. */
export function nodeReplConfig(effective: Record<string, unknown>, env: NodeJS.ProcessEnv = process.env, installedIds: readonly string[] = []): Record<string, Record<string, unknown> & { env: Record<string, string> }> {
  const root = resolve(env.YARD_NODE_REPL_ROOT || join(projectRoot, 'vendor/node-repl', process.platform === 'win32' ? 'app-26.1117.3838.0' : nodeRuntimeVersion, process.platform + '-' + process.arch));
  const executable = join(root, 'bin', process.platform === 'win32' ? 'node_repl.exe' : 'node_repl');
  const previous = object(object(effective.mcp_servers).node_repl);
  const { command: _command, args: _args, cwd: _cwd, url: _url, http_headers: _headers,
    env_http_headers: _envHeaders, bearer_token_env_var: _bearer, env: oldEnv, env_vars: oldEnvVars, ...policy } = previous;
  const modules = join(root, 'lib/node_modules');
  const cleanEnv = Object.fromEntries(Object.entries(object(oldEnv)).filter(([key]) => !/^(NODE_REPL_|BROWSER_|SKY_|OAI_SKY_|CODEX_CLI_PATH$|CDP_BROWSER_BACKEND_PIPE_PATH$)/.test(key)));
  const display = env.YARD_COMPUTER_DISPLAY;
  const windows = env.YARD_COMPUTER_TARGET === 'windows' || process.platform === 'win32';
  if (env.YARD_COMPUTER_TARGET && !['linux', 'windows'].includes(env.YARD_COMPUTER_TARGET)) throw new Error('YARD_COMPUTER_TARGET must be linux or windows.');
  if (windows && display) throw new Error('Choose either YARD_COMPUTER_TARGET=windows or YARD_COMPUTER_DISPLAY, not both.');
  if (previous.enabled !== false && display && !/^:[0-9]+(?:\.0)?$/.test(display)) throw new Error('YARD_COMPUTER_DISPLAY must select a local X11 screen 0, for example :0 or :99.0.');
  const sky = display || windows
    ? { sky: join(projectRoot, 'lib/sky-service.ts') } : {};
  const browser = installedIds.some(id => id === 'browser@codex-yard' || id === 'chrome@codex-yard');
  const browserService = join(projectRoot, 'plugins/browser/scripts/browser-service.mjs');
  return { 'mcp_servers.node_repl': {
    ...policy, command: executable, args: [],
    env: { ...cleanEnv,
      NODE_REPL_NODE_PATH: env.YARD_NODE_REPL_NODE || process.execPath,
      PATH: [dirname(env.YARD_NODE_REPL_NODE || process.execPath), String(cleanEnv.PATH || env.PATH || process.env.PATH || '')].join(delimiter),
      CODEX_CLI_PATH: codexExecutable(env),
      CODEX_HOME: env.CODEX_HOME || join(homedir(), '.codex'),
      NODE_REPL_NODE_MODULE_DIRS: modules,
      NODE_REPL_TRUSTED_CODE_PATHS: [modules, join(projectRoot, 'lib'), ...(browser ? [join(projectRoot, 'plugins/browser'), join(projectRoot, 'plugins/chrome')] : [])].join(delimiter),
      NODE_REPL_TRUSTED_SERVICES: JSON.stringify({ ...sky, ...(browser ? { browser: browserService } : {}) }),
      // Explicitly clear App-inherited bindings in an already-running daemon.
      SKY_CUA_NATIVE_PIPE: '0', SKY_CUA_NATIVE_PIPE_DIRECTORY: '', CDP_BROWSER_BACKEND_PIPE_PATH: '',
      BROWSER_USE_AVAILABLE_BACKENDS: browser ? (env.YARD_IAB_SOCKET ? 'iab,chrome' : 'chrome') : '',
      NODE_REPL_INSTRUCTIONS_USE_CASE_BROWSER: browser && env.YARD_IAB_SOCKET ? 'Control the in-app Browser in conjunction with the Browser Plugin.' : '',
      NODE_REPL_INSTRUCTIONS_USE_CASE_CHROME: browser ? 'Control the Chrome browser in conjunction with the Chrome Plugin. Prefer this method of controlling Chrome over alternatives (such as Computer Use) unless the user explicitly mentions an alternative.' : '',
      BROWSER_USE_CODEX_APP_BUILD_FLAVOR: 'prod', BROWSER_USE_CODEX_APP_VERSION: '26.1013.40934',
      ...(browser && env.YARD_BROWSER_BACKEND_PATHS ? { BROWSER_USE_BACKEND_PATHS: env.YARD_BROWSER_BACKEND_PATHS } : {}),
      YARD_NODE_REPL_ROOT: root,
      ...(windows ? {
        OAI_SKY_CONFIG_PATH: join(projectRoot, 'lib/sky-windows-options.json'),
        OAI_SKY_WINDOWS_BIN: join(projectRoot, 'lib/sky-windows-helper.ts'),
        YARD_SKY_WINDOWS_BINARY: join(projectRoot, 'vendor/node-repl/app-26.1117.3838.0', 'win32-' + process.arch, 'lib/node_modules/@oai/sky/bin/windows/codex-computer-use.exe'),
        ...(env.YARD_WINDOWS_NODE || env.YARD_COMPUTER_WINDOWS_NODE ? { YARD_WINDOWS_NODE: env.YARD_WINDOWS_NODE || env.YARD_COMPUTER_WINDOWS_NODE! } : {}),
        ...(env.YARD_WINDOWS_CODEX_BIN ? { YARD_WINDOWS_CODEX_BIN: env.YARD_WINDOWS_CODEX_BIN } : {}),
        ...(env.YARD_WINDOWS_CODEX_HOME ? { YARD_WINDOWS_CODEX_HOME: env.YARD_WINDOWS_CODEX_HOME } : {}),
        ...(env.YARD_WINDOWS_SKY_PIPE ? { YARD_WINDOWS_SKY_PIPE: env.YARD_WINDOWS_SKY_PIPE } : {}),
      } : {}),
      ...(process.platform === 'linux' && display ? {
        OAI_SKY_LINUX_BIN: join(projectRoot, 'lib/sky-linux-helper.ts'),
        YARD_SKY_LINUX_BINARY: join(modules, '@oai/sky/bin/linux', 'sky_linux_' + process.arch),
      } : {}),
      ...(display ? { DISPLAY: display,
        ...Object.fromEntries(['DBUS_SESSION_BUS_ADDRESS', 'AT_SPI_BUS', 'XDG_RUNTIME_DIR'].flatMap(key => env[key] ? [[key, env[key]!]] : [])) } : {}),
      ...(env.YARD_COMPUTER_XAUTHORITY ? { XAUTHORITY: env.YARD_COMPUTER_XAUTHORITY } : {}),
    },
    ...(Array.isArray(oldEnvVars) ? { env_vars: oldEnvVars.filter(key => typeof key === 'string' && !/^(NODE_REPL_|BROWSER_|SKY_|OAI_SKY_|CODEX_CLI_PATH$|CDP_BROWSER_BACKEND_PIPE_PATH$)/.test(key)) } : {}),
    startup_timeout_sec: previous.startup_timeout_sec ?? 10,
    tool_timeout_sec: previous.tool_timeout_sec ?? 120,
  } };
}

/** Installed canonical packages are enabled only in Yard sessions. Their global
 * defaults, and packages which have not yet been replaced, are untouched. */
export function standalonePluginConfig(installedIds: readonly string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const name of pluginNames) {
    const id = name + '@codex-yard';
    if (!installedIds.includes(id)) continue;
    result[`plugins.${JSON.stringify(id)}.enabled`] = true;
    for (const other of installedIds) if (other !== id && other.startsWith(name + '@')) result[`plugins.${JSON.stringify(other)}.enabled`] = false;
  }
  for (const [legacy, replacement] of [['yard-node', null], ['yard-computer', 'computer-use'], ['yard-artifacts', 'documents']] as const) {
    if (replacement && !installedIds.includes(replacement + '@codex-yard')) continue;
    if (legacy === 'yard-artifacts' && !filePluginNames.every(name => installedIds.includes(name + '@codex-yard'))) continue;
    for (const id of installedIds) if (id.startsWith(legacy + '@')) result[`plugins.${JSON.stringify(id)}.enabled`] = false;
  }
  if (installedIds.some(id => id === 'browser@codex-yard' || id === 'chrome@codex-yard') &&
      installedIds.includes('unified-computer-use@openai-bundled')) {
    result['plugins."unified-computer-use@openai-bundled".enabled'] = false;
  }
  return result;
}

export function installedPluginIds(value: unknown): string[] {
  const markets = object(value).marketplaces;
  return (Array.isArray(markets) ? markets : []).flatMap(market => {
    const plugins = object(market).plugins;
    return (Array.isArray(plugins) ? plugins : []).flatMap(plugin => {
      const item = object(plugin);
      return item.installed && typeof item.id === 'string' ? [item.id] : [];
    });
  });
}

/** Fold only the replaced service's caller overrides into its policy before
 * replacing the transport; leave all unrelated overrides intact. */
export function nodeReplOverrides(effective: Record<string, unknown>, overrides: Record<string, unknown>) {
  const remaining = { ...overrides };
  const servers = { ...object(overrides.mcp_servers) };
  const node = { ...object(object(effective.mcp_servers).node_repl), ...object(servers.node_repl), ...object(overrides['mcp_servers.node_repl']) };
  delete servers.node_repl; delete remaining.mcp_servers; delete remaining['mcp_servers.node_repl'];
  for (const [name, value] of Object.entries(servers)) remaining['mcp_servers.' + name] = value;
  for (const [key, value] of Object.entries(overrides)) {
    if (!key.startsWith('mcp_servers.node_repl.')) continue;
    delete remaining[key];
    const parts = key.slice('mcp_servers.node_repl.'.length).split('.');
    let target = node;
    for (const part of parts.slice(0, -1)) { target[part] = { ...object(target[part]) }; target = object(target[part]); }
    target[parts.at(-1)!] = value;
  }
  return { effective: { ...effective, mcp_servers: { ...object(effective.mcp_servers), node_repl: node } }, remaining };
}

