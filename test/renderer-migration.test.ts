import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { transform } from 'esbuild';
import { rendererRoot } from '../lib/app-resources.ts';
import { adaptMigratedRendererModule, rendererComponentsPath } from '../src/native/renderer-migration.ts';

test('the pinned component seams produce valid ESM and require unique function boundaries', async () => {
  for (const [path, marker] of [
    ['/assets/app-initial-a68277f60b93.js', 'function YEc(e){'],
    ['/assets/collapsible-user-message-content-636c4ff1e0ff.js', 'function C(e){'],
  ]) {
    const original = await readFile(join(rendererRoot, path));
    const adapted = adaptMigratedRendererModule(path, original);
    assert.ok(adapted.includes(Buffer.from(`from"${rendererComponentsPath}"`)));
    await transform(adapted.toString(), { format: 'esm', target: 'es2022' });
    const missing = Buffer.from(original.toString().replace(marker, 'function MissingMigrationBoundary(e){'));
    assert.throws(() => adaptMigratedRendererModule(path, missing), /does not match the pinned renderer/);
    const duplicated = Buffer.concat([original, Buffer.from(marker + '}')]);
    assert.throws(() => adaptMigratedRendererModule(path, duplicated), /does not match the pinned renderer/);
    assert.deepEqual(await readFile(join(rendererRoot, path)), original);
  }
  const unrelated = Buffer.from('export const unchanged = true;');
  assert.equal(adaptMigratedRendererModule('/assets/unrelated.js', unrelated), unrelated);
});
