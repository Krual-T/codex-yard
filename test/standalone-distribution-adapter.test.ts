import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { createAppTools, defaultAppToolsAdapter } from '../lib/app-tools.ts';

test('adapter overrides use the chosen file and stale vendor overrides fail with migration guidance', async t => {
  const directory = await mkdtemp('/tmp/yard-adapter-');
  t.after(() => rm(directory, { recursive: true, force: true }));
  const custom = join(directory, 'custom-adapter.mjs');
  const retired = join(directory, 'vendor', 'codex-app', '26.1013.40934', 'codex-app-tools', 'server.mjs');
  const options = { tools: [], callTool: () => ({}) };
  await writeFile(custom, '// disposable adapter fixture\n');

  const customHost = await createAppTools({ ...options, adapterPath: custom });
  try { assert.equal(customHost.config['mcp_servers.codex_app'].args[0], custom); }
  finally { await customHost.close(); }

  await assert.rejects(createAppTools({ ...options, adapterPath: retired }), error => {
    assert.ok(error instanceof Error);
    assert.ok(error.message.includes(retired));
    assert.match(error.message, /AGENTS_APP_TOOLS_ADAPTER/);
    assert.match(error.message, /自有默认适配器/);
    assert.equal((error.cause as NodeJS.ErrnoException).code, 'ENOENT');
    return true;
  });
  await assert.rejects(createAppTools({ ...options, adapterPath: join(directory, 'missing.mjs') }), error => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /无法读取 Codex App Tools 适配器/);
    assert.doesNotMatch(error.message, /旧版/);
    return true;
  });

  await mkdir(join(directory, 'vendor', 'codex-app', '26.1013.40934', 'codex-app-tools'), { recursive: true });
  await writeFile(retired, '// readable legacy override fixture\n');
  const legacyHost = await createAppTools({ ...options, adapterPath: retired });
  try { assert.equal(legacyHost.adapterPath, retired); }
  finally { await legacyHost.close(); }

  const previous = process.env.AGENTS_APP_TOOLS_ADAPTER;
  try {
    process.env.AGENTS_APP_TOOLS_ADAPTER = custom;
    const environmentHost = await createAppTools(options);
    try { assert.equal(environmentHost.adapterPath, custom); }
    finally { await environmentHost.close(); }
    const explicitHost = await createAppTools({ ...options, adapterPath: defaultAppToolsAdapter });
    try { assert.equal(explicitHost.adapterPath, defaultAppToolsAdapter); }
    finally { await explicitHost.close(); }
    process.env.AGENTS_APP_TOOLS_ADAPTER = join(directory, 'vendor', 'codex-app', 'old', 'codex-app-tools', 'server.mjs');
    await assert.rejects(createAppTools(options), /移除 AGENTS_APP_TOOLS_ADAPTER/);
    delete process.env.AGENTS_APP_TOOLS_ADAPTER;
    const defaultHost = await createAppTools(options);
    try { assert.equal(defaultHost.adapterPath, defaultAppToolsAdapter); }
    finally { await defaultHost.close(); }
  } finally {
    if (previous === undefined) delete process.env.AGENTS_APP_TOOLS_ADAPTER;
    else process.env.AGENTS_APP_TOOLS_ADAPTER = previous;
  }
});
