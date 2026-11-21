import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, cp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { projectRoot } from '../lib/app-resources.ts';
import { nodeReplConfig } from '../lib/standalone-tools.ts';

test('original Chrome install export writes independent native-host config only in disposable XDG directories',
  { skip: process.platform !== 'linux' || process.arch !== 'x64' }, async t => {
    const root = await mkdtemp('/tmp/yard-native-host-');
    t.after(() => rm(root, { recursive: true, force: true }));
    const plugin = join(root, 'chrome'), configHome = join(root, 'config');
    await cp(join(projectRoot, 'plugins/chrome'), plugin, { recursive: true, verbatimSymlinks: true });
    const definition = nodeReplConfig({})['mcp_servers.node_repl'];
    const paths = { codexCliPath: definition.env.CODEX_CLI_PATH, nodePath: process.execPath, nodeReplPath: definition.command };
    const url = pathToFileURL(join(plugin, 'scripts/installManifest.mjs')).href;
    await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `const {install}=await import(${JSON.stringify(url)}); await install({appServerRuntimePaths:${JSON.stringify(paths)}});`],
      { env: { ...process.env, CHROME_CONFIG_HOME: configHome, XDG_CONFIG_HOME: configHome } });
    const manifest = JSON.parse(await readFile(join(configHome, 'google-chrome/NativeMessagingHosts/com.openai.codexextension.json'), 'utf8'));
    assert.equal(manifest.path, join(plugin, 'extension-host/linux/x64/extension-host'));
    assert.ok(manifest.allowed_origins.includes('chrome-extension://hehggadaopoacecdllhhajmbjkdcmajg/'));
    const host = JSON.parse(await readFile(join(plugin, 'extension-host/linux/x64/extension-host-config.json'), 'utf8'));
    for (const [key, value] of Object.entries(paths)) assert.equal(host[key], value);
    assert.equal(host.browserClientPath, join(plugin, 'scripts/browser-client.mjs'));
  });
