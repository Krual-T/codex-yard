import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { createNativeWorkbench } from '../src/native/server.ts';
import { createFakeCodex } from './fake-codex.ts';

test('a fresh host serves the owned entry and managed assets without a snapshot fallback', async t => {
  const root = await mkdtemp('/tmp/yard-owned-assets-');
  const fake = await createFakeCodex(root);
  let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined;
  t.after(async () => { await app?.close(); await fake.close(); await rm(root, { recursive: true, force: true }); });
  app = await createNativeWorkbench({ port: 0, socketPath: fake.socketPath, workspace: root,
    dataDir: join(root, 'data'), codexHome: join(root, 'codex') });
  const index = await fetch(app.url);
  assert.equal(index.status, 200);
  const html = await index.text();
  assert.match(html, /Codex Yard/);
  assert.match(html, /src="\/workbench-entry.js"/);
  assert.doesNotMatch(html, /web-renderer-v2|renderer-components|native-host\.js|modulepreload/);
  for (const asset of ['/workbench-entry.js', '/workbench-entry.css', '/pdf.worker.min.mjs']) {
    const response: Response = await fetch(app.url + asset);
    assert.equal(response.status, 200, asset);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(join('.local/renderer', asset)));
  }
  const metafile = JSON.parse(await readFile('.local/renderer-metafile.json', 'utf8'));
  assert(Object.keys(metafile.inputs).some(path => path.endsWith('src/renderer/app/App.tsx')));
  assert(!Object.keys(metafile.inputs).some(path => path.startsWith('vendor/')));
  for (const asset of ['/web-renderer-v2/assets/index.client-17f4cd7252fb.js', '/renderer-components.mjs']) {
    assert.equal((await fetch(app.url + asset)).status, 404, asset);
  }
});
