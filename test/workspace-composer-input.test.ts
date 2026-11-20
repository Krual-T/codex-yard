import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attachedPrompt, composerInput, editablePrompt, promptImages } from '../src/workspace/composer-input.ts';

test('the composer only adds paths and native localImage input for staged attachments', () => {
  const attachments = [
    { name: 'same.txt', path: '/stage/a/same.txt', image: false },
    { name: 'same.txt', path: '/stage/b/same.txt', image: false },
    { name: 'preview.png', path: '/stage/c/preview.png', image: true },
  ];
  const request = 'Review these files.\nKeep my second line.';
  const [text, ...images] = composerInput(request, attachments);
  assert.deepEqual(images, [{ type: 'localImage', path: attachments[2]!.path }]);
  assert.deepEqual(attachedPrompt(text!.text), { text: request, attachments });
  assert.deepEqual(composerInput(request), [{ type: 'text', text: request, text_elements: [] }]);
});

test('incomplete markup and a misleading attachment name remain literal text', () => {
  const [text] = composerInput('', [{ name: 'chart.png', path: '/path/data.csv', image: true }]);
  assert.deepEqual(attachedPrompt(text!.text), { text: text!.text, attachments: [] });
  const literal = '\n# Files mentioned by the user:\n\n## a.txt: /a.txt';
  assert.deepEqual(attachedPrompt(literal), { text: literal, attachments: [] });
});

test('generated image edits keep the native prompt and ordered image inputs while ordinary files retain their paths', () => {
  const original = { name: 'Generated image 2.png', path: '/generated/output.png', image: true,
    generatedImage: { id: 'generated-two', label: 'Generated image 2', comments: [] } };
  const mask = { name: 'selection-mask.png', path: '/stage/selection-mask.png', image: true,
    generatedImage: { id: 'generated-two:mask', label: 'Selection mask', comments: [] } };
  const prompt = 'Remove the area marked in the second image from the first image';
  assert.deepEqual(composerInput(prompt, [original, mask]), [
    { type: 'text', text: prompt, text_elements: [] },
    { type: 'localImage', path: original.path }, { type: 'localImage', path: mask.path },
  ]);
  const report = { name: 'report.md', path: '/stage/report.md', image: false };
  const mixed = composerInput('Make this brighter.', [report, original]);
  assert.deepEqual(attachedPrompt(mixed[0].text), { text: 'Make this brighter.', attachments: [report] });
  assert.deepEqual(mixed.slice(1), [{ type: 'localImage', path: original.path }]);
});

test('history recognizes structured image parts without interpreting prompt text as an image source', () => {
  const [annotation, local] = composerInput('Inspect this.', [{ name: 'preview.png', path: '/stage/preview.png', image: true }]);
  const url = 'data:image/png;base64,AAAA';
  assert.deepEqual(promptImages([
    annotation, local, { type: 'image', url }, null,
    { type: 'localImage', path: 'preview.png' },
    { type: 'image', url: 'https://example.invalid/cross-origin.png' },
    { type: 'image', url: 'data:image/svg+xml;base64,AAAA' },
  ]), [{ path: '/stage/preview.png', name: 'preview.png' }, { url, name: 'image.png' }]);
  assert.deepEqual(promptImages([annotation]), []);
});

test('editing replaces only the text while preserving native and Yard attachments', () => {
  const files = [
    { name: 'report.md', path: '/stage/report.md', image: false },
    { name: 'preview.png', path: '/stage/preview.png', image: true },
  ];
  const image = { type: 'image', url: 'https://example.invalid/from-thread.png' };
  const item = { id: 'prompt', type: 'userMessage', content: [...composerInput('Before', files), image] };
  const edit = editablePrompt(item);
  assert.equal(edit?.text, 'Before');
  assert.deepEqual(edit?.attachments, files);
  assert.deepEqual(edit?.input('After'), [...composerInput('After', files), image]);
  assert.deepEqual(item.content, [...composerInput('Before', files), image]);
  assert.equal(editablePrompt({ ...item, content: [{ type: 'text', text: 'Rich input', text_elements: [{ opaque: true }] }] }), undefined);
});
