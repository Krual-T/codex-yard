import { spawn } from 'node:child_process';
import { mkdtemp, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { CodexConnection } from '../../lib/codex.ts';
import { filePluginNames, installedPluginIds, standalonePluginConfig } from '../../lib/standalone-tools.ts';
import { record, type ObjectValue } from './protocol.ts';

export interface PluginNetwork { cloudEnabled: boolean; proxyUrl: string }
interface Options {
  globals: ObjectValue; persist(): Promise<void>; codexHome: string;
  home(hostId: string): string;
  request(hostId: string, method: string, params: ObjectValue): Promise<unknown>;
  file(hostId: string, path: string): Promise<string>;
  directory(hostId: string, path: string): Promise<{ fileName: string; isDirectory: boolean }[]>;
}
const stateKey = 'yard-plugin-network';
const segment = /^[A-Za-z0-9_][A-Za-z0-9_.+-]*$/;
const missing = (error: unknown) => /ENOENT|not found|no such file/i.test(String(error));
const sessionPackages = new Set<string>([...filePluginNames, 'computer-use', 'browser', 'chrome']);

export function pluginNetwork(value: unknown): PluginNetwork {
  return { cloudEnabled: record(value).cloudEnabled === true, proxyUrl: typeof record(value).proxyUrl === 'string' ? String(record(value).proxyUrl) : '' };
}
export function pluginProxy(value: unknown): string {
  if (typeof value !== 'string') throw new Error('HTTP proxy must be an address or port.');
  const text = value.trim();
  if (!text) return '';
  let url: URL;
  try { url = new URL(/^\d+$/.test(text) ? 'http://127.0.0.1:' + text : text); }
  catch { throw new Error('Enter an HTTP proxy URL, such as http://127.0.0.1:7897.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.port === '0' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Enter an HTTP or HTTPS proxy address without credentials or a path.');
  }
  return url.origin;
}

// Same selection as Codex's core-plugin-common/installed.rs: prefer "local",
// otherwise compare semantic versions, falling back to lexical ordering.
function compareVersions(a: string, b: string) {
  const parse = (value: string) => /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\w.-]+))?(?:\+[\w.-]+)?$/.exec(value);
  const left = parse(a), right = parse(b);
  const cmp = (x: string, y: string) => x < y ? -1 : x > y ? 1 : 0;
  if (!left || !right) return cmp(a, b);
  for (let i = 1; i <= 3; i++) { const result = BigInt(left[i]!) - BigInt(right[i]!); if (result) return result < 0n ? -1 : 1; }
  if (!left[4] || !right[4]) return left[4] ? -1 : right[4] ? 1 : 0;
  const x = left[4].split('.'), y = right[4].split('.');
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] === undefined || y[i] === undefined) return x[i] === undefined ? -1 : 1;
    if (x[i] === y[i]) continue;
    const nx = /^\d+$/.test(x[i]!), ny = /^\d+$/.test(y[i]!);
    if (nx && ny) return BigInt(x[i]!) < BigInt(y[i]!) ? -1 : 1;
    return nx !== ny ? nx ? -1 : 1 : cmp(x[i]!, y[i]!);
  }
  return 0;
}

/** Plugin metadata has its own network policy. Never invoke the CLI's cloud
 * inventory/featured requests on the default, local-only path. */
export function createPlugins(options: Options) {
  let updating = Promise.resolve();
  let cloud: Promise<{ connection: CodexConnection; close(): Promise<void> }> | undefined;
  let active = 0, idle: ReturnType<typeof setTimeout> | undefined;
  async function close() { clearTimeout(idle); const current = cloud; cloud = undefined; if (current) await current.then(value => value.close(), () => {}); }
  const settings = () => pluginNetwork(options.globals[stateKey]);
  async function update(value: ObjectValue) {
    if (typeof value.cloudEnabled !== 'boolean') throw new Error('Cloud plugin access must be enabled or disabled.');
    const next = { cloudEnabled: value.cloudEnabled, proxyUrl: pluginProxy(value.proxyUrl) };
    const operation = updating.catch(() => {}).then(async () => {
      const previous = options.globals[stateKey];
      options.globals[stateKey] = next;
      try { await options.persist(); }
      catch (error) { if (previous === undefined) delete options.globals[stateKey]; else options.globals[stateKey] = previous; throw error; }
      await close();
    });
    updating = operation;
    await operation;
    return settings();
  }
  async function json(hostId: string, path: string) { return record(JSON.parse(await options.file(hostId, path))); }
  async function manifest(hostId: string, root: string): Promise<ObjectValue> {
    for (const path of ['.codex-plugin/plugin.json', '.claude-plugin/plugin.json', '.agent-plugin/plugin.json']) {
      try { return await json(hostId, join(root, path)); } catch (error) { if (!missing(error)) throw error; }
    }
    return {};
  }
  async function local(hostId: string, params: ObjectValue, installedOnly: boolean, effectiveConfigs?: ObjectValue[]) {
    const cwds = Array.isArray(params.cwds) ? params.cwds.filter((cwd): cwd is string => typeof cwd === 'string') : [];
    const configs = effectiveConfigs ?? await Promise.all((cwds.length ? cwds : [undefined]).map(async cwd =>
      record(record(await options.request(hostId, 'config/read', { includeLayers: false, ...(cwd ? { cwd } : {}) })).config)));
    const markets = new Map<string, ObjectValue>();
    const errors: ObjectValue[] = [];
    for (const config of configs) {
      if (record(config.features).plugins === false) continue;
      const installed = new Map<string, ObjectValue>();
      for (const [id, policy] of Object.entries(record(config.plugins))) {
        const parts = id.split('@'), name = parts[0]!, market = parts[1]!;
        if (parts.length !== 2 || !segment.test(name) || !segment.test(market) || name === '..' || market === '..') continue;
        const base = join(options.home(hostId), 'plugins/cache', market, name);
        let versions: string[];
        try { versions = (await options.directory(hostId, base)).filter(entry => entry.isDirectory && /^[A-Za-z0-9_.+-]+$/.test(entry.fileName) && !['.', '..'].includes(entry.fileName)).map(entry => entry.fileName); }
        catch (error) { if (missing(error)) continue; throw error; }
        const version = versions.includes('local') ? 'local' : versions.sort(compareVersions).at(-1);
        if (!version) continue;
        const root = join(base, version);
        let data: ObjectValue = {};
        try { data = await manifest(hostId, root); }
        catch (error) { errors.push({ marketplacePath: root, message: String(error) }); }
        installed.set(id, summary(id, name, data, root, true, record(policy).enabled !== false, version));
      }
      // Only registered local catalogs are read. A Git URL is never cloned or
      // refreshed here; already installed packages still appear from the cache.
      for (const [name, value] of Object.entries(record(config.marketplaces))) {
        const source = record(value).source;
        if (record(value).source_type !== 'local' || typeof source !== 'string') continue;
        const path = source.endsWith('.json') ? source : join(source, '.agents/plugins/marketplace.json');
        try {
          const catalog = await json(hostId, path), plugins: ObjectValue[] = [];
          for (const value of Array.isArray(catalog.plugins) ? catalog.plugins : []) {
            const item = record(value), pluginName = item.name;
            if (typeof pluginName !== 'string' || !segment.test(pluginName)) continue;
            const id = pluginName + '@' + name, present = installed.get(id);
            if (present) { plugins.push(present); installed.delete(id); continue; }
            if (installedOnly) continue;
            const localPath = record(item.source).source === 'local' && typeof record(item.source).path === 'string'
              ? resolve(source.endsWith(join('.agents', 'plugins', 'marketplace.json')) ? dirname(dirname(dirname(source))) : source.endsWith('.json') ? dirname(source) : source, String(record(item.source).path)) : null;
            const data = localPath ? await manifest(hostId, localPath) : {};
            plugins.push(summary(id, pluginName, { ...data, ...item }, localPath, false, false, null));
          }
          merge(name, path, record(catalog.interface), plugins);
        } catch (error) { errors.push({ marketplacePath: path, message: String(error) }); }
      }
      for (const plugin of installed.values()) merge(String(plugin.id).split('@')[1]!, null, null, [plugin]);
    }
    function merge(name: string, path: string | null, ui: unknown, plugins: ObjectValue[]) {
      const old = markets.get(name);
      const combined = new Map((Array.isArray(old?.plugins) ? old.plugins : []).map(item => [record(item).id, record(item)]));
      for (const plugin of plugins) if (!combined.has(plugin.id)) combined.set(plugin.id, plugin);
      markets.set(name, { name, path: old?.path ?? path, interface: old?.interface ?? ui, plugins: [...combined.values()] });
    }
    return { marketplaces: [...markets.values()], marketplaceLoadErrors: errors, ...(!installedOnly ? { featuredPluginIds: [] } : {}) };
  }
  // Native skills/list uses global plugin policy. Project Yard's eight session
  // packages using native metadata, keeping the installed paths used by its
  // Skill loader and skills/config/write. Never parse a second Skill catalog.
  async function sessionSkills(params: ObjectValue, forward?: () => Promise<unknown>) {
    const result = record(await (forward ? forward() : options.request('local', 'skills/list', params)));
    if (!Array.isArray(result.data)) return result;
    return { ...result, data: await Promise.all(result.data.map(async value => {
      const entry = record(value);
      if (typeof entry.cwd !== 'string') return value;
      const errors = Array.isArray(entry.errors) ? [...entry.errors] : [];
      let skills = Array.isArray(entry.skills) ? [...entry.skills] : [];
      try {
        const configuration = record(await options.request('local', 'config/read', { cwd: entry.cwd, includeLayers: true }));
        const config = record(configuration.config);
        const switches: ObjectValue[] = [];
        // Native Skill switches accumulate only user and session-flag layers,
        // independently of the effective config's project-level array.
        for (const value of Array.isArray(configuration.layers) ? [...configuration.layers].reverse() : []) {
          const layer = record(value);
          if (layer.disabledReason != null || !['user', 'sessionFlags'].includes(String(record(layer.name).type))) continue;
          const settings = record(record(layer.config).skills).config;
          for (const value of Array.isArray(settings) ? settings : []) {
            const setting = record(value), path = typeof setting.path === 'string' ? setting.path : undefined;
            const name = typeof setting.name === 'string' ? setting.name.trim() : undefined;
            if ((path === undefined) === (name === undefined) || name === '') continue;
            switches.push({ ...setting, name, path: path === undefined ? undefined : await realpath(path).catch(() => path) });
          }
        }
        const inventory = await local('local', { cwds: [entry.cwd] }, true, [config]);
        const policy = standalonePluginConfig(installedPluginIds(inventory)).plugins;
        skills = skills.filter(skill => record(policy[String(record(skill).pluginId)]).enabled !== false);
        for (const error of inventory.marketplaceLoadErrors) errors.push({ path: error.marketplacePath, message: error.message });
        for (const market of inventory.marketplaces) {
          for (const value of market.plugins as ObjectValue[]) {
            const id = String(value.id), name = String(value.name), cacheRoot = record(value.source).path;
            if (market.name !== 'codex-yard' || !sessionPackages.has(name) || !policy[id]?.enabled) continue;
            try {
              if (typeof market.path !== 'string') throw new Error('The installed package has no registered local marketplace');
              if (typeof cacheRoot !== 'string' || !isAbsolute(cacheRoot)) throw new Error('The installed package has no cache path');
              const detail = record(record(await options.request('local', 'plugin/read', { marketplacePath: market.path, pluginName: name })).plugin);
              const sourceRoot = record(record(detail.summary).source).path;
              if (typeof sourceRoot !== 'string' || !isAbsolute(sourceRoot)) throw new Error('Native plugin metadata has no local source path');
              const [sourceManifest, cacheManifest] = await Promise.all([manifest('local', sourceRoot), manifest('local', cacheRoot)]);
              if (typeof sourceManifest.version !== 'string' || sourceManifest.version !== cacheManifest.version) throw new Error('Installed and source plugin versions differ');
              if (!Array.isArray(detail.skills)) throw new Error('Native plugin metadata has no Skills');
              const mapped: ObjectValue[] = [];
              for (const value of detail.skills) {
                const skill = record(value);
                if (typeof skill.path !== 'string' || typeof skill.name !== 'string') throw new Error('Native Skill metadata has no name or path');
                const path = cachePath(sourceRoot, cacheRoot, skill.path);
                const [sourceText, cacheText] = await Promise.all([options.file('local', skill.path), options.file('local', path)]);
                if (sourceText !== cacheText) throw new Error('Installed and source Skill contents differ: ' + skill.name);
                const metadata = 'agents/openai.yaml';
                const [sourceMetadata, cacheMetadata] = await Promise.all([optionalFile(join(dirname(skill.path), metadata)), optionalFile(join(dirname(path), metadata))]);
                if (sourceMetadata !== cacheMetadata) throw new Error('Installed and source Skill metadata differ: ' + skill.name);
                let enabled = true;
                for (const setting of switches) {
                  if ((setting.name === skill.name || setting.path === path) && typeof setting.enabled === 'boolean') enabled = setting.enabled;
                }
                const ui = { ...record(skill.interface) };
                for (const icon of ['iconSmall', 'iconLarge']) if (typeof ui[icon] === 'string' && isAbsolute(ui[icon])) ui[icon] = cachePath(sourceRoot, cacheRoot, ui[icon]);
                mapped.push({ ...skill, path, enabled, scope: 'user', pluginId: id, ...(skill.interface ? { interface: ui } : {}) });
              }
              for (const skill of mapped) if (!skills.some(value => record(value).path === skill.path ||
                (record(value).pluginId === id && record(value).name === skill.name))) skills.push(skill);
            } catch (error) {
              errors.push({ path: cacheRoot ?? entry.cwd, message: `Cannot load Yard Skills for ${id}: ${String(error)}. Reinstall this plugin in Settings → Plugins.` });
            }
          }
        }
      } catch (error) { errors.push({ path: entry.cwd, message: String(error) }); }
      return { ...entry, skills, errors };
    })) };
  }
  async function optionalFile(path: string) {
    try { return await options.file('local', path); } catch (error) { if (missing(error)) return null; throw error; }
  }
  async function request(hostId: string, method: string, params: ObjectValue, forward?: () => Promise<unknown>) {
    if (hostId === 'local' && method === 'skills/list') return sessionSkills(params, forward);
    if (!settings().cloudEnabled) {
      if (method === 'plugin/installed' || method === 'plugin/list') return local(hostId, params, method === 'plugin/installed');
      if (method === 'plugin/search') {
        const result = await local(hostId, params, false), term = String(params.searchTerm ?? '').toLowerCase();
        return { data: result.marketplaces.flatMap(market => (market.plugins as ObjectValue[])
          .filter(plugin => JSON.stringify([plugin.name, plugin.interface, plugin.keywords]).toLowerCase().includes(term))
          .map(plugin => ({ plugin, marketplaceName: market.name, marketplacePath: market.path }))), nextCursor: null };
      }
      if (method.startsWith('plugin/share/') || method === 'plugin/reconcile' || params.remoteMarketplaceName || params.remotePluginId) {
        throw new Error('Cloud plugin access is off. Enable it in Settings → Plugins.');
      }
    }
    const proxy = settings().proxyUrl;
    if (settings().cloudEnabled && proxy && hostId === 'local' && ['plugin/installed', 'plugin/list', 'plugin/search'].includes(method)) {
      clearTimeout(idle); active++;
      cloud ??= startCloud(options.codexHome, proxy).catch(error => { cloud = undefined; throw error; });
      try { return await (await cloud).connection.request(method, params, { timeoutMs: 30_000 }); }
      finally { if (--active === 0) { idle = setTimeout(() => { void close(); }, 30_000); idle.unref(); } }
    }
    return forward ? forward() : options.request(hostId, method, params);
  }
  return { settings, update, request, close };
}

function cachePath(sourceRoot: string, cacheRoot: string, path: string) {
  const suffix = relative(sourceRoot, path);
  if (suffix === '..' || suffix.startsWith('..' + sep) || isAbsolute(suffix)) throw new Error('Native Skill path is outside its plugin source');
  return join(cacheRoot, suffix);
}

function summary(id: string, name: string, data: ObjectValue, path: string | null, installed: boolean, enabled: boolean, version: string | null): ObjectValue {
  const ui = record(data.interface);
  return { id, name, installed, enabled, remotePluginId: null, version: null, localVersion: version ?? data.version ?? null,
    shareContext: null, source: path ? { type: 'local', path } : { type: 'remote' }, installedAt: null,
    installPolicy: record(data.policy).installation ?? 'AVAILABLE', installPolicySource: null, mustShowInstallationInterstitial: null,
    authPolicy: record(data.policy).authentication ?? 'ON_INSTALL', availability: 'AVAILABLE', disabledReason: null, eligiblePlanTypes: null,
    interface: { ...ui, displayName: ui.displayName ?? ui.display_name ?? name, shortDescription: ui.shortDescription ?? ui.short_description ?? data.description ?? '' },
    keywords: Array.isArray(data.keywords) ? data.keywords : [] };
}

// A proxy is process-scoped in the CLI. Use a metadata-only CLI process when a
// plugin proxy is selected, leaving the shared conversation daemon untouched.
async function startCloud(codexHome: string, proxy: string) {
  const root = await mkdtemp(join(tmpdir(), 'yard-plugin-network-')), socket = join(root, 'rpc.sock');
  const env = { ...process.env, CODEX_HOME: codexHome, HTTP_PROXY: proxy, HTTPS_PROXY: proxy, ALL_PROXY: proxy,
    http_proxy: proxy, https_proxy: proxy, all_proxy: proxy, NO_PROXY: '', no_proxy: '' };
  const child = spawn(process.env.AGENTS_CODEX_BIN || 'codex', ['app-server', '--listen', 'unix://' + socket], { env, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let failure: Error | undefined;
  child.on('error', error => { failure = error; });
  // Drain diagnostics without retaining account/configuration data in Yard.
  child.stderr.resume();
  const connection = new CodexConnection(socket);
  const close = async () => {
    connection.close();
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise<void>(done => child.once('exit', () => done()));
      child.kill('SIGTERM');
      const timeout = setTimeout(() => child.kill('SIGKILL'), 2000); timeout.unref();
      await exited; clearTimeout(timeout);
    }
    await rm(root, { recursive: true, force: true });
  };
  try {
    const deadline = Date.now() + 8000;
    while (!(await stat(socket).catch(() => null))) {
      if (failure || child.exitCode !== null || child.signalCode !== null || Date.now() > deadline) throw new Error('Could not start the plugin proxy backend. Check the Codex CLI and proxy settings.');
      await delay(25);
    }
    await connection.connect();
    return { connection, close };
  } catch (error) { await close(); throw error; }
}
