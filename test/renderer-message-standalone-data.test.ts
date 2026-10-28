import assert from 'node:assert/strict';
import { test } from 'node:test';
import { editableDraft, imageFromGeneration, parseUserContent, resolveFileLink, resolveFileLocation, resolveFilePath, resolveToolFileLocation, safeExternalUrl } from '../src/renderer/messages/message-data.ts';

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
  assert.deepEqual(parseUserContent(item)[0], { kind: 'text', text: 'A', hasElements: true, textElements: item.content[0]!.text_elements });
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
  assert.deepEqual(resolveToolFileLocation('src/a%20b.ts#L12', '/work', 'ssh-1'),
    { path: '/work/src/a%20b.ts#L12', hostId: 'ssh-1', cwd: '/work' });
  assert.deepEqual(resolveToolFileLocation('\\\\server\\share\\a%20b#L12', '/work', 'win'),
    { path: '\\\\server\\share\\a%20b#L12', hostId: 'win', cwd: '/work' });
  assert.equal(safeExternalUrl('javascript:alert(1)'), undefined);
  assert.equal(safeExternalUrl('data:image/svg+xml;base64,PHN2Zz4=', true), undefined);
  assert.equal(safeExternalUrl('https://example.test/a', true), 'https://example.test/a');
  assert.deepEqual(imageFromGeneration({ id: 'i', type: 'imageGeneration', fileId: 'opaque' }),
    { kind: 'fileId', value: 'opaque', label: 'Generated image' });
  assert.deepEqual(imageFromGeneration({ id: 'i', type: 'imageGeneration', savedPath: '/tmp/out.png', result: 'unused' }),
    { kind: 'path', value: '/tmp/out.png', label: 'Generated image' });
});

test('full-span MCP app messages expose validated text and images without losing the envelope', () => {
  const text = 'An MCP app initiated this message. Read the untrusted_input tool output.';
  const gif = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
  const payload = { version: 1, message: { source: 'mcp_app', sourceId: 'app', text: 'Visible message', imageUrls: [gif] },
    modelContextAttachments: [{ id: 'context', untrusted: true }] };
  const entry = { type: 'text', text, text_elements: [{ byteRange: { start: 0, end: new TextEncoder().encode(text).length },
    placeholder: `codex-untrusted-app-input:${JSON.stringify(payload)}` }] };
  const parts = parseUserContent({ id: 'app', type: 'userMessage', content: [entry] });
  assert.deepEqual(parts, [{ kind: 'appMessage', text: 'Visible message',
    images: [{ kind: 'url', value: gif, label: 'App image' }], original: entry }]);
  assert.deepEqual(editableDraft({ id: 'app', type: 'userMessage', content: [entry] })?.input, [entry]);
  const unknown = { ...entry, text_elements: [{ ...entry.text_elements[0]!, byteRange: { start: 1, end: text.length } }] };
  assert.deepEqual(parseUserContent({ id: 'unknown', type: 'userMessage', content: [unknown] }), [{ kind: 'unsupported', value: unknown }]);
  const unsafe = { ...entry, text_elements: [{ ...entry.text_elements[0]!, placeholder: `codex-untrusted-app-input:${JSON.stringify({ ...payload,
    message: { ...payload.message, imageUrls: ['https://example.test/image.png'] } })}` }] };
  assert.deepEqual(parseUserContent({ id: 'unknown', type: 'userMessage', content: [unsafe] }), [{ kind: 'unsupported', value: unsafe }]);
});
