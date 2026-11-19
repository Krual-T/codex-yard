import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { transform } from 'esbuild';
import { rendererRoot } from '../lib/app-resources.ts';
import { adaptSidebarLayout } from '../src/native/sidebar-layout-renderer.ts';

test('sidebar layout adapter parses the pinned resources and rejects incompatible snapshots', async () => {
  for (const path of ['/assets/app-initial-a68277f60b93.js', '/assets/use-thread-summary-panel-49a5fc2c7142.js']) {
    const source = await readFile(join(rendererRoot, path.slice(1)));
    await transform(adaptSidebarLayout(path, source).toString(), { loader: 'js' });
    assert.throws(() => adaptSidebarLayout(path, Buffer.from('changed renderer')), /固定界面版本不匹配/);
    assert.equal(adaptSidebarLayout('/unrelated.js', source), source);
  }
});
