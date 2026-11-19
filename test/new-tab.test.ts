import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { transform } from 'esbuild';
import { rendererRoot } from '../lib/app-resources.ts';
import { adaptNewTabModule } from '../src/native/new-tab-renderer.ts';

test('New tab adapters compile against the pinned renderer and reject a changed version boundary', async () => {
  for (const name of ['app-initial-a68277f60b93.js', 'open-handler-96382bc3d49a.js', 'thread-app-shell-chrome-f65cc9d3a9eb.js', 'tab-content-7090d8d5ae50.js', 'native-page-ccd33c3eab0c.js', 'thread-side-panel-new-tab-17ea66857c53.js', 'app-primary-f5ea123a0407.js']) {
    const source = await readFile(join(rendererRoot, 'assets', name));
    const adapted = adaptNewTabModule('/assets/' + name, source);
    assert.notDeepEqual(adapted, source, name);
    await transform(adapted.toString('utf8'), { loader: 'js' });
    assert.throws(() => adaptNewTabModule('/assets/' + name, Buffer.from('changed upstream module')), /固定界面版本不匹配/);
  }
});
