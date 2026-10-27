import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createZstdCompress } from 'node:zlib';
import { createPackage } from '@electron/asar';
import { create } from 'tar';
import { adapterRelativePath, copyRenderer, prepareAppResources, rendererVersion, runtimeUrl } from '../scripts/copy-renderer.ts';

async function fixture(t: import('node:test').TestContext, version = rendererVersion) {
  const root = await mkdtemp('/tmp/yard-runtime-test-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = join(root, 'app'), packageRoot = join(root, 'package');
  const resources = join(packageRoot, 'usr/lib/chatgpt/resources');
  await mkdir(join(app, 'webview'), { recursive: true });
  await writeFile(join(app, 'package.json'), JSON.stringify({ name: 'runtime-fixture', version }));
  await writeFile(join(app, 'webview/index.html'), '<title>Fixture renderer</title>');
  await mkdir(join(resources, 'plugins/openai-bundled/plugins/codex-app-tools'), { recursive: true });
  await writeFile(join(resources, adapterRelativePath), 'export const fixture = true;');
  await writeFile(join(packageRoot, 'usr/lib/chatgpt/ChatGPT'), 'Desktop executable must not be extracted');
  await createPackage(app, join(resources, 'app.asar'));
  const archive = join(root, 'package.tar.zst');
  await pipeline(create({ cwd: packageRoot }, ['usr']), createZstdCompress(), createWriteStream(archive));
  return { root, archive, target: join(root, 'runtime') };
}

test('first setup obtains the pinned web resources and adapter, then reuses them without a desktop installation', async t => {
  const f = await fixture(t);
  let requests = 0;
  const download: typeof fetch = async url => {
    requests++;
    assert.equal(url, runtimeUrl);
    return new Response(await readFile(f.archive));
  };
  assert.equal(await prepareAppResources({ target: f.target, fetch: download }), f.target);
  assert.equal(await readFile(join(f.target, adapterRelativePath), 'utf8'), 'export const fixture = true;');
  assert.deepEqual((await readdir(f.target)).sort(), ['app.asar', 'plugins']);
  const renderer = join(f.root, 'renderer');
  const metadata = await copyRenderer(join(f.target, 'app.asar'), renderer);
  assert.equal(metadata.version, rendererVersion);
  assert.equal(await readFile(join(renderer, 'index.html'), 'utf8'), '<title>Fixture renderer</title>');
  await prepareAppResources({ target: f.target, fetch: download });
  await copyRenderer(join(f.target, 'app.asar'), renderer);
  assert.equal(requests, 1);
});

test('a different App version is rejected before publishing its runtime directory', async t => {
  const f = await fixture(t, '26.9999.0');
  await assert.rejects(prepareAppResources({ target: f.target, packageArchive: f.archive }), /26\.9999\.0/);
  await assert.rejects(stat(f.target), { code: 'ENOENT' });
  assert.equal((await readdir(f.root)).some(name => name.startsWith('codex-runtime-import-')), false);
});

test('an interrupted package download leaves no usable or partial runtime cache', async t => {
  const f = await fixture(t);
  const bytes = await readFile(f.archive);
  await assert.rejects(prepareAppResources({ target: f.target, fetch: async () => new Response(bytes.subarray(0, 20)) }));
  await assert.rejects(stat(f.target), { code: 'ENOENT' });
  assert.equal((await readdir(f.root)).some(name => name.startsWith('codex-runtime-import-')), false);
});
