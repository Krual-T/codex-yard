import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { transform } from 'esbuild';
import { rendererRoot } from '../lib/app-resources.ts';
import { adaptMessageSubmission } from '../src/native/message-submission-renderer.ts';

test('message preparation adaptation compiles against pinned modules and rejects incompatible UI', async () => {
  for (const name of ['app-initial-a68277f60b93.js', 'app-primary-f5ea123a0407.js', 'local-conversation-thread-a5549d2fbc3c.js',
    'local-conversation-thread-turn-entries-4f0c5b536dd7.js']) {
    const path = '/assets/' + name;
    const source = await readFile(join(rendererRoot, 'assets', name));
    await transform(adaptMessageSubmission(path, source).toString(), { loader: 'js' });
    assert.throws(() => adaptMessageSubmission(path, Buffer.from('changed snapshot')), /固定界面版本不匹配/);
  }
});
