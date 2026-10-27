import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BrowserClipboard } from '../src/native/browser-clipboard.ts';
import { previewLimit } from '../src/native/file-limits.ts';

test('clipboard images preserve bytes and receive distinct staging names, including concurrent images', async () => {
  const files: File[] = [];
  const clipboard = new BrowserClipboard(async (selected, directory) => {
    assert.equal(directory, false);
    files.push(...selected);
    return selected.map(file => ({ fsPath: '/private/uploads/' + file.name }));
  }, error => assert.fail(error.message));
  const bytes = new Uint8Array([137, 80, 78, 71, 0, 255, 17]);
  const paths = await Promise.all([0, 1].map(() => clipboard.persistImageFileToTemp({ bytes, mimeType: 'image/png' })));
  assert.equal(new Set(paths).size, 2);
  for (const file of files) {
    assert.equal(file.type, 'image/png');
    assert.match(file.name, /^clipboard-[\w-]+\.png$/);
    assert.deepEqual(new Uint8Array(await file.arrayBuffer()), bytes);
  }
});

test('failed and invalid image staging is reported and rejected so the official composer can use its data URL fallback', async () => {
  const failures: Error[] = [];
  let uploads = 0;
  const clipboard = new BrowserClipboard(async () => { uploads++; throw new Error('Upload connection lost'); }, error => failures.push(error));
  await assert.rejects(clipboard.persistImageFileToTemp({ bytes: new Uint8Array([1]), mimeType: 'image/png' }), /Upload connection lost/);
  await assert.rejects(clipboard.persistImageFileToTemp({ bytes: new Uint8Array(), mimeType: 'image/png' }), /为空/);
  await assert.rejects(clipboard.persistImageFileToTemp({ bytes: new Uint8Array(previewLimit + 1), mimeType: 'image/png' }), /10 MiB/);
  await assert.rejects(clipboard.persistImageFileToTemp({ bytes: new Uint8Array([1]), mimeType: 'text/plain' }), /不支持/);
  assert.equal(uploads, 1);
  assert.equal(failures.length, 4);
  const missingPath = new BrowserClipboard(async () => [], error => failures.push(error));
  await assert.rejects(missingPath.persistImageFileToTemp({ bytes: new Uint8Array([1]), mimeType: 'image/png' }), /宿主路径/);
});
