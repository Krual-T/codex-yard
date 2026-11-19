import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { transform } from 'esbuild';
import { rendererRoot } from '../lib/app-resources.ts';
import { adaptStartupModule } from '../src/native/startup-renderer.ts';

test('startup loader adapter compiles with the pinned renderer and rejects an incompatible loader', async () => {
  for (const name of ['app-shared-61271c39e3c5.js', 'app-initial-a68277f60b93.js']) {
    const path = '/assets/' + name;
    const original = await readFile(join(rendererRoot, path.slice(1)));
    const adapted = adaptStartupModule(path, original);
    assert.notDeepEqual(adapted, original);
    await transform(adapted.toString('utf8'), { loader: 'js' });
    assert.throws(() => adaptStartupModule(path, Buffer.from('changed renderer')), /固定界面版本不匹配/);
  }
});
