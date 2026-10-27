import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { rendererRoot, rendererVersion } from '../lib/app-resources.ts';
import { createNativeWorkbench } from '../src/native/server.ts';
import { rendererAssets } from '../src/native/renderer-assets.ts';
import { webRendererPrefix } from '../src/native/visualizations.ts';
import { createFakeCodex } from './fake-codex.ts';

test('a fresh host serves the checked-in interface, JavaScript, stylesheet and font without a resource cache', async t => {
  const root = await mkdtemp('/tmp/yard-vendor-test-');
  const fake = await createFakeCodex(root);
  let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined;
  t.after(async () => { await app?.close(); await fake.close(); await rm(root, { recursive: true, force: true }); });
  app = await createNativeWorkbench({ port: 0, socketPath: fake.socketPath, workspace: root,
    dataDir: join(root, 'data'), codexHome: join(root, 'codex') });
  const index = await fetch(app.url);
  assert.equal(index.status, 200);
  assert.match(await index.text(), /Codex Yard/);
  const status = await (await fetch(app.url + '/api/status')).json();
  assert.equal(status.rendererVersion, rendererVersion);
  const font = (await readdir(join(rendererRoot, 'assets'))).find(name => name.endsWith('.woff2'));
  assert.ok(font, 'The checked-in snapshot includes its fonts');
  for (const asset of [rendererAssets.client, rendererAssets.applicationStyle, webRendererPrefix + '/assets/' + font]) {
    const response: Response = await fetch(app.url + asset);
    assert.equal(response.status, 200, asset);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(join(rendererRoot, asset.slice(webRendererPrefix.length))));
  }
});
