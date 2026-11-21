import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { createPlugins, pluginNetwork, pluginProxy } from '../src/native/plugins.ts';

test('proxy accepts a port or HTTP URL and rejects invalid ports, protocols and credentials', () => {
  assert.deepEqual(pluginNetwork(undefined), { cloudEnabled: false, proxyUrl: '' });
  assert.equal(pluginProxy('7897'), 'http://127.0.0.1:7897');
  assert.equal(pluginProxy(' https://proxy.example:8443/ '), 'https://proxy.example:8443');
  for (const value of ['65536', 'socks5://127.0.0.1:1080', 'http://u:p@proxy:80', 'http://proxy/path', 'not a proxy']) assert.throws(() => pluginProxy(value));
});

test('offline inventory uses configured installs, preserves disabled state and reads versions and local catalogs without native cloud RPCs', async t => {
  const root = await mkdtemp('/tmp/yard-plugin-inventory-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const config: Record<string, unknown> = { plugins: { 'browser@fixture': { enabled: false }, 'missing@fixture': { enabled: true } },
    marketplaces: { fixture: { source_type: 'local', source: root } } };
  await mkdir(join(root, '.agents/plugins'), { recursive: true });
  await writeFile(join(root, '.agents/plugins/marketplace.json'), JSON.stringify({ name: 'fixture', plugins: [{ name: 'browser' }, { name: 'uninstalled' }] }));
  const base = join(root, 'plugins/cache/fixture/browser');
  for (const version of ['1.9.0', '1.10.0-beta.1', '1.10.0']) {
    await mkdir(join(base, version, '.codex-plugin'), { recursive: true });
    await writeFile(join(base, version, '.codex-plugin/plugin.json'), JSON.stringify({ name: 'browser', version, interface: { displayName: 'Cached browser ' + version } }));
  }
  // A stale cache directory without a configured installation is not installed.
  await mkdir(join(root, 'plugins/cache/fixture/stale/2.0.0'), { recursive: true });
  const globals: Record<string, unknown> = {};
  let failSave = false;
  const host = createPlugins({ globals, codexHome: root, home: () => root,
    persist: async () => { if (failSave) throw new Error('write failed'); },
    request: async (_hostId, method) => { assert.equal(method, 'config/read'); return { config }; },
    file: async (_hostId, path) => readFile(path, 'utf8'),
    directory: async (_hostId, path) => (await readdir(path, { withFileTypes: true })).map(entry => ({ fileName: entry.name, isDirectory: entry.isDirectory() })),
  });
  t.after(() => host.close());
  let result: any = await host.request('local', 'plugin/installed', {});
  assert.deepEqual(result.marketplaces.flatMap((market: any) => market.plugins.map((plugin: any) => [plugin.id, plugin.enabled, plugin.localVersion])), [['browser@fixture', false, '1.10.0']]);
  await mkdir(join(base, 'local'));
  result = await host.request('local', 'plugin/installed', {});
  assert.equal(result.marketplaces[0].plugins[0].localVersion, 'local');
  result = await host.request('local', 'plugin/list', {});
  assert.deepEqual(result.marketplaces[0].plugins.map((plugin: any) => [plugin.name, plugin.installed]), [['browser', true], ['uninstalled', false]]);
  await rm(base, { recursive: true });
  result = await host.request('local', 'plugin/installed', {});
  assert.equal(result.marketplaces.flatMap((market: any) => market.plugins).length, 0);
  config.features = { plugins: false };
  result = await host.request('local', 'plugin/list', {});
  assert.deepEqual(result.marketplaces, []);
  await host.update({ cloudEnabled: false, proxyUrl: '7897' });
  const reloaded = pluginNetwork(globals['yard-plugin-network']);
  assert.deepEqual(reloaded, { cloudEnabled: false, proxyUrl: 'http://127.0.0.1:7897' });
  failSave = true;
  await assert.rejects(host.update({ cloudEnabled: true, proxyUrl: '' }), /write failed/);
  assert.deepEqual(host.settings(), reloaded);
});
