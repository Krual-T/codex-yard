import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ThreadItemSummary } from '../lib/codex-protocol.ts';
import { extractGeneratedImages, generatedImageId, imageCommentPrompt, imageEditPrompt,
  type EditableImage, type ImageEditAction } from '../src/workspace/image-edit-model.ts';

const first: EditableImage = { id: 'image-1', image: { path: '/fixture/first.png', name: 'first.png' }, label: 'Generated image 1' };
const second: EditableImage = { id: 'image-2', image: { url: 'data:image/png;base64,aW1hZ2U=', name: 'second.png' }, label: 'Generated image 2' };

test('local image edit instructions match the pinned single-image and mask submission', () => {
  const action: Extract<ImageEditAction, { kind: 'edit' }> = { kind: 'edit', image: first, operation: 'remove-background' };
  assert.equal(imageEditPrompt(action), 'Remove the background from this image. Keep all foreground subjects unchanged and fully intact, with clean, smooth edges. Make the background transparent.');
  assert.equal(imageEditPrompt({ ...action, operation: 'resize', ratio: '16:9' }), 'Make the aspect ratio 16:9');
  assert.equal(imageEditPrompt({ ...action, operation: 'remove', mask: new Blob(['fixture mask']) }),
    'Remove the area marked in the second image from the first image');
  assert.throws(() => imageEditPrompt({ ...action, operation: 'resize' }), /aspect ratio/);
  assert.equal(generatedImageId(first), 'image-playground:image-1');
  assert.equal(generatedImageId({ ...first, image: second.image }), 'image-playground:image-1');
});

test('single-image comments retain their text and use bounded one-decimal percentages', () => {
  assert.equal(imageCommentPrompt([{ image: first, comments: [
    { id: 'a', x: .12345, y: .5, text: 'Change this subject\nKeep its outline.' },
    { id: 'b', x: -.2, y: 1.5, text: 'Keep the edges' },
  ] }], ''), 'Image 1:\n1. (x: 12.3%, y: 50%) Change this subject\nKeep its outline.\n2. (x: 0%, y: 100%) Keep the edges');
});

test('batch comments follow submitted image order and append trimmed general instructions', () => {
  assert.equal(imageCommentPrompt([
    { image: first, comments: [] },
    { image: second, comments: [{ id: 'a', x: 0, y: .9996, text: 'Use blue' }] },
    { image: first, imageNumber: 7, comments: [{ id: 'b', x: 1, y: .25, text: 'Use green' }] },
  ], '  Match the lighting.\nPreserve the framing.  '),
  'Image 2:\n1. (x: 0%, y: 100%) Use blue\n\nImage 7:\n1. (x: 100%, y: 25%) Use green\n\nAdditional instructions:\nMatch the lighting.\nPreserve the framing.');
  const plain = '  Keep this unmodified.\n';
  assert.equal(imageCommentPrompt([], plain), plain);
  assert.equal(imageCommentPrompt([{ image: first, comments: [] }], plain), plain);
  assert.equal(imageCommentPrompt([{ image: first, comments: [{ id: 'a', x: .5, y: .5, text: 'Change it' }] }], ' \n '),
    'Image 1:\n1. (x: 50%, y: 50%) Change it');
});

test('generated image extraction preserves the gallery source precedence and path normalization', () => {
  const values: Array<{ savedPath?: string; result?: string }> = [
    { savedPath: '  /fixture/saved.png  ', result: 'data:image/png;base64,aW1hZ2U=' },
    { savedPath: ' ', result: 'file:///tmp/image%20one.png' },
    { result: 'app://fixture/@fs/tmp/image%20two.png' },
    { result: '/@fs/tmp/image-three.png' },
    { result: 'C:\\fixture\\image.png' },
    { result: '\\\\server\\fixture\\image.png' },
    { result: ' data:image/webp;base64,aW1hZ2U= ' },
    { result: ' https://example.com/generated.png ' },
    { result: 'aW1hZ2U=' },
  ];
  const items: ThreadItemSummary[] = values.map((value, index) => ({ type: 'imageGeneration', id: 'image-' + index, ...value }));
  const images = extractGeneratedImages(items, 'turn-1', 0);
  assert.deepEqual(images.map(({ image }) => image), [
    { path: '/fixture/saved.png', name: 'generated-image.png' },
    { path: '/tmp/image one.png', name: 'generated-image.png' },
    { path: '/tmp/image two.png', name: 'generated-image.png' },
    { path: '/tmp/image-three.png', name: 'generated-image.png' },
    { path: 'C:\\fixture\\image.png', name: 'generated-image.png' },
    { path: '\\\\server\\fixture\\image.png', name: 'generated-image.png' },
    { url: 'data:image/webp;base64,aW1hZ2U=', name: 'generated-image.png' },
    { url: 'https://example.com/generated.png', name: 'generated-image.png' },
    { url: 'data:image/png;base64,aW1hZ2U=', name: 'generated-image.png' },
  ]);
  assert.deepEqual(images.map(({ id, label, turnId, startedAt }) => ({ id, label, turnId, startedAt })),
    items.map((item, index) => ({ id: item.id, label: 'Generated image ' + (index + 1), turnId: 'turn-1', startedAt: 0 })));
});

test('unavailable image results and other item types do not create editable images', () => {
  const items: ThreadItemSummary[] = [
    { type: 'agentMessage', id: 'answer', result: '/fixture/not-generated.png' },
    { type: 'imageGeneration', id: 'pending', status: 'inProgress', result: null },
    { type: 'imageGeneration', id: 'blank', result: ' ' },
    { type: 'imageGeneration', id: 'relative', result: 'images/relative.png' },
    { type: 'imageGeneration', id: 'malformed', result: 'file:///tmp/%E0%A4%A.png' },
    { type: 'imageGeneration', id: 'blob', result: 'blob:https://example.com/fixture' },
    { type: 'imageGeneration', id: 'ready', result: '/fixture/ready.png' },
  ];
  assert.deepEqual(extractGeneratedImages(items), [{ id: 'ready', image: { path: '/fixture/ready.png', name: 'generated-image.png' }, label: 'Generated image 1' }]);
});
