import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { createNativeWorkbench } from '../src/native/server.ts';
import { webRendererPrefix } from '../src/native/visualizations.ts';
import { createFakeCodex } from './fake-codex.ts';

test('owned entry is not cached and retired renderer URLs never fall back', async t => {
  const root = await mkdtemp('/tmp/yard-owned-entry-http-');
  const fake = await createFakeCodex(root);
  let app: Awaited<ReturnType<typeof createNativeWorkbench>> | undefined;
  t.after(async () => { await app?.close(); await fake.close(); await rm(root, { recursive: true, force: true }); });
  app = await createNativeWorkbench({ port: 0, socketPath: fake.socketPath, codexHome: join(root, 'codex'),
    dataDir: join(root, 'data'), workspace: root, hostCatalog: { hosts: [], projects: [], assignments: {} } });

  const retiredAssets = [
    'app-initial-a68277f60b93.js', 'collapsible-user-message-content-636c4ff1e0ff.js',
    'app-primary-f5ea123a0407.js', 'app-shared-61271c39e3c5.js', 'settings-page-25f8fd08b293.js',
    'user-message-58a6f09045c4.js', 'user-message-attachments-9d0c60d2f476.js',
    'general-settings-8997e171b11a.js', 'appearance-settings-deb0b7565185.js',
    'sites-end-resource-b11586198b69.js', 'local-conversation-turn-981410324fed.js',
  ];
  for (const asset of retiredAssets) {
    const path = `${webRendererPrefix}/assets/${asset}`;
    for (let request = 0; request < 2; request++) {
      const response: Response = await fetch(app.url + path);
      assert.equal(response.status, 404, path);
      await response.arrayBuffer();
    }
  }
  for (const path of ['/renderer-components.js', '/native-host.js']) {
    const response: Response = await fetch(app.url + path);
    assert.equal(response.status, 404, path);
    await response.arrayBuffer();
  }
  for (const path of ['/', '/workbench-entry.js', '/workbench-entry.css']) {
    const response: Response = await fetch(app.url + path);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get('cache-control'), 'no-store', path);
    await response.arrayBuffer();
  }
});
