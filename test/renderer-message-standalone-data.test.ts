import assert from 'node:assert/strict';
import { test } from 'node:test';
import { editableDraft, imageFromGeneration, parseUserContent, resolveFileLink, resolveFileLocation, resolveFilePath, safeExternalUrl } from '../src/renderer/messages/message-data.ts';

test('editing preserves ordered input, marked text, image identity, references, and metadata', () => {
  const item = { id: 'one', type: 'userMessage', content: [
    { type: 'text', text: 'A', text_elements: [{ byteRange: { start: 0, end: 1 }, placeholder: 'A', context: { url: 'https://example.test' } }] },
    { type: 'image', fileId: 'opaque-id', detail: 'high' },
    { type: 'localImage', path: '/img.png', detail: 'low' },
    { type: 'text', text: 'B', text_elements: [] },
    { type: 'skill', name: 'skill', path: '/skill' },
    { type: 'mention', name: 'project', path: '/project' },
    { type: 'localAudio', path: '/sound.wav' },
  ], document: { type: 'doc', content: [{ type: 'text', text: 'A', marks: [{ type: 'bold' }] }] }, hints: ['search', { source: 'browser' }] };
  const draft = editableDraft(item);
  assert.ok(draft);
  assert.deepEqual(draft.input, item.content);
  assert.deepEqual(draft.document, item.document);
  assert.deepEqual(draft.hints, item.hints);
  assert.deepEqual(draft.skills, [{ name: 'skill', path: '/skill' }]);
  assert.equal(draft.text, 'A\nB');
  assert.deepEqual(draft.images, [
    { id: 'image-1', src: '', fileId: 'opaque-id', name: 'Image' },
    { id: 'image-2', src: '/img.png', path: '/img.png', name: 'img.png' },
  ]);
  assert.equal(parseUserContent(item).at(-1)?.kind, 'unsupported');
  const input = draft.input!;
  (input[0]!.text_elements as { placeholder: string }[])[0]!.placeholder = 'changed';
  assert.equal(item.content[0]!.text_elements?.[0]?.placeholder, 'A');
  assert.equal(editableDraft({ ...item, content: ['invalid'] }), null);
});

test('image addresses and generated image fields keep paths and opaque IDs distinct', () => {
  assert.equal(resolveFilePath('./image.png', '/work/project'), '/work/project/./image.png');
  assert.equal(resolveFilePath('file:///work/image%20one.png', '/ignored'), '/work/image one.png');
  assert.equal(resolveFilePath('file://other/image.png', '/ignored'), 'file://other/image.png');
  assert.equal(resolveFileLink('src/a%20b.ts#L12C3-L14', '/work'), '/work/src/a b.ts');
  assert.deepEqual(resolveFileLocation('src/a%20b.ts#L12C3-L14', '/work', 'ssh-1'),
    { path: '/work/src/a b.ts', hostId: 'ssh-1', cwd: '/work', line: 12, column: 3 });
  assert.deepEqual(resolveFileLocation('file:///work/a%20b.ts#L2', '/ignored', 'local'),
    { path: '/work/a b.ts', hostId: 'local', cwd: '/ignored', line: 2 });
  assert.deepEqual(resolveFileLocation('a.ts#L0C0', '/work', 'local'),
    { path: '/work/a.ts#L0C0', hostId: 'local', cwd: '/work' });
  assert.equal(safeExternalUrl('javascript:alert(1)'), undefined);
  assert.equal(safeExternalUrl('data:image/svg+xml;base64,PHN2Zz4=', true), undefined);
  assert.equal(safeExternalUrl('https://example.test/a', true), 'https://example.test/a');
  assert.deepEqual(imageFromGeneration({ id: 'i', type: 'imageGeneration', fileId: 'opaque' }),
    { kind: 'fileId', value: 'opaque', label: 'Generated image' });
  assert.deepEqual(imageFromGeneration({ id: 'i', type: 'imageGeneration', savedPath: '/tmp/out.png', result: 'unused' }),
    { kind: 'path', value: '/tmp/out.png', label: 'Generated image' });
});
