import assert from 'node:assert/strict';
import { test } from 'node:test';
import { editableDraft, imageFromGeneration, parseUserContent, resolveFileLink, resolveFilePath, safeExternalUrl } from '../src/renderer/messages/message-data.ts';

test('user inputs remain editable only when the composer contract can represent them', () => {
  const item = { id: 'one', type: 'userMessage', content: [
    { type: 'text', text: 'Describe this', text_elements: [] }, { type: 'localImage', path: 'img.png' },
  ] };
  assert.deepEqual(editableDraft(parseUserContent(item)), { text: 'Describe this', images: [
    { id: 'image-1', src: 'img.png', path: 'img.png', name: 'img.png' },
  ], files: [] });
  for (const content of [
    [{ type: 'image', fileId: 'opaque-id' }],
    [{ type: 'image', url: 'https://example.test/image.png', detail: 'high' }],
    [{ type: 'text', text: 'A', text_elements: [{ byteRange: { start: 0, end: 1 }, placeholder: 'A' }] }],
    [{ type: 'text', text: 'A' }, { type: 'text', text: 'B' }],
    [{ type: 'localImage', path: '/img.png' }, { type: 'text', text: 'A' }],
    [{ type: 'skill', name: 'skill', path: '/skill' }],
    [{ type: 'localAudio', path: '/sound.wav' }],
  ]) assert.equal(editableDraft(parseUserContent({ ...item, content })), null);
});

test('image addresses and generated image fields keep paths and opaque IDs distinct', () => {
  assert.equal(resolveFilePath('./image.png', '/work/project'), '/work/project/./image.png');
  assert.equal(resolveFilePath('file:///work/image%20one.png', '/ignored'), '/work/image one.png');
  assert.equal(resolveFilePath('file://other/image.png', '/ignored'), 'file://other/image.png');
  assert.equal(resolveFileLink('src/a%20b.ts#L12C3-L14', '/work'), '/work/src/a b.ts');
  assert.equal(safeExternalUrl('javascript:alert(1)'), undefined);
  assert.equal(safeExternalUrl('data:image/svg+xml;base64,PHN2Zz4=', true), undefined);
  assert.equal(safeExternalUrl('https://example.test/a', true), 'https://example.test/a');
  assert.deepEqual(imageFromGeneration({ id: 'i', type: 'imageGeneration', fileId: 'opaque' }),
    { kind: 'fileId', value: 'opaque', label: 'Generated image' });
  assert.deepEqual(imageFromGeneration({ id: 'i', type: 'imageGeneration', savedPath: '/tmp/out.png', result: 'unused' }),
    { kind: 'path', value: '/tmp/out.png', label: 'Generated image' });
});
