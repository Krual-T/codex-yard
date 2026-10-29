import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readRichDocument } from '../src/renderer/composer/rich-document.ts';
import { projectTextAgentDocument, serializeTextAgentSegments, updateTextAgentDocument } from '../src/renderer/composer/text-agent-document.ts';
import { draftToInput } from '../src/renderer/composer/standalone-draft.ts';

const agent = { name: 'Review', displayName: 'Review', conversationId: null, path: 'thread://same-id?hostId=local' };

test('plain and segmented text retain a real agent node and ordered submission segments', () => {
  const document = updateTextAgentDocument(undefined, 'Hello @Rev\nSecond', 'Hello Review\nSecond', [
    { start: 6, end: 12, attrs: agent },
  ]);
  assert.ok(document);
  const parsed = readRichDocument(document);
  assert.ok(parsed);
  assert.deepEqual(projectTextAgentDocument(parsed)?.agents, [{ start: 6, end: 12, attrs: agent }]);
  assert.deepEqual(serializeTextAgentSegments(parsed, ['Hello Review', 'Second'], true), [
    'Hello [@Review](thread://same-id?hostId=local)', 'Second',
  ]);
  const changed = updateTextAgentDocument(document, 'Hello Review\nSecond', 'Hello Review!\nSecond', [
    { start: 6, end: 12, attrs: agent },
  ]);
  assert.ok(changed);
  assert.equal(projectTextAgentDocument(readRichDocument(changed)!)?.text, 'Hello Review!\nSecond');
});

test('agent insertion keeps selected marks and refuses unsupported or mismatched documents', () => {
  const source = { type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'text', text: 'Before TARGET after', marks: [{ type: 'strong' }] },
  ] }] };
  const document = updateTextAgentDocument(source, 'Before TARGET after', 'Before Review after', [
    { start: 7, end: 13, attrs: agent },
  ]);
  assert.ok(document);
  assert.deepEqual(document.content?.[0]?.content?.find(node => node.type === 'agentMention')?.marks, [{ type: 'strong' }]);
  assert.equal(updateTextAgentDocument(source, 'different', 'Before Review after', [{ start: 7, end: 13, attrs: agent }]), null);
  const unsafe = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'TARGET', marks: [{ type: 'code' }] }] }] };
  assert.equal(updateTextAgentDocument(unsafe, 'TARGET', 'Review', [{ start: 0, end: 6, attrs: agent }]), null);
});

test('plain agent serialization moves same-segment UTF-8 references by the exact inserted markup', () => {
  const before = '前😀 @file and @Rev @file', after = '前😀 @file and Review @file';
  const start = after.indexOf('Review');
  const document = updateTextAgentDocument(undefined, before, after, [{ start, end: start + 6, attrs: agent }]);
  assert.ok(document);
  const encoder = new TextEncoder();
  const range = (at: number) => ({ start: encoder.encode(after.slice(0, at)).length, end: encoder.encode(after.slice(0, at + 5)).length });
  const first = after.indexOf('@file'), second = after.lastIndexOf('@file');
  const input = draftToInput({ text: after, document, images: [], files: [], references: [], skills: [], input: [
    { type: 'text', text: after, text_elements: [{ byteRange: range(first), placeholder: 'first' }, { byteRange: range(second), placeholder: 'second' }] },
  ] }, 'local', { plainTextMode: true });
  const result = input[0]!, text = result.text as string, bytes = encoder.encode(text);
  assert.equal(text, '前😀 @file and [@Review](thread://same-id?hostId=local) @file');
  for (const element of result.text_elements as { byteRange: { start: number; end: number } }[]) {
    assert.equal(new TextDecoder().decode(bytes.slice(element.byteRange.start, element.byteRange.end)), '@file');
  }
});

test('marked inline references preserve ordered UTF-8 ranges even when their paths repeat the referenced text', () => {
  const variants = [
    { type: 'agentMention', label: 'A', attrs: { name: 'A', displayName: 'A', conversationId: null, path: 'thread://t?hostId=local' },
      link: '[@A](thread://t?hostId=local)' },
    { type: 'pluginMention', label: '@A', attrs: { name: 'A', displayName: 'A', path: 'plugin://local@openai-primary-runtime',
      description: '', iconSmall: '', brandColor: '', computerUseAppMentionPath: '' }, link: '[@A](plugin://local@openai-primary-runtime)' },
  ];
  const encoder = new TextEncoder(), decoder = new TextDecoder();
  for (const variant of variants) for (const sharedMarks of [false, true]) {
    const visible = variant.label + 'local文', referenceStart = encoder.encode(variant.label).length;
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [
      { type: variant.type, attrs: variant.attrs, marks: [{ type: 'strong' }] },
      { type: 'text', text: 'local文', ...(sharedMarks ? { marks: [{ type: 'strong' }] } : {}) },
    ] }, { type: 'paragraph', content: [{ type: 'text', text: 'Tail' }] }] };
    const image = { type: 'image', fileId: 'image-one', detail: 'high' };
    const draft = { text: visible + '\nTail', document: doc, images: [], files: [], references: [], skills: [], input: [
      { type: 'text', text: visible, text_elements: [{ byteRange: { start: referenceStart, end: referenceStart + 8 }, placeholder: 'ref' }] },
      image, { type: 'text', text: 'Tail', text_elements: [] },
    ] };
    for (const plainTextMode of [false, true]) {
      const result = draftToInput(draft, 'local', { plainTextMode });
      const first = result[0]!, output = first.text as string;
      const expected = plainTextMode ? variant.link + 'local文'
        : sharedMarks ? '**' + variant.link + 'local文**' : '**' + variant.link + '**local文';
      assert.equal(output, expected);
      const range = (first.text_elements as { byteRange: { start: number; end: number } }[])[0]!.byteRange;
      assert.equal(decoder.decode(encoder.encode(output).slice(range.start, range.end)), 'local文');
      assert.deepEqual(result.slice(1), [image, draft.input[2]]);
    }
    const overlap = structuredClone(draft);
    const overlapItem = overlap.input[0]!;
    assert.ok('text_elements' in overlapItem && overlapItem.text_elements);
    overlapItem.text_elements[0]!.byteRange = { start: 0, end: referenceStart };
    assert.throws(() => draftToInput(overlap, 'local', { plainTextMode: false }), /重叠/);
    const invalid = structuredClone(draft);
    const invalidItem = invalid.input[0]!;
    assert.ok('text_elements' in invalidItem && invalidItem.text_elements);
    invalidItem.text_elements[0]!.byteRange = { start: referenceStart + 6, end: referenceStart + 8 };
    assert.throws(() => draftToInput(invalid, 'local', { plainTextMode: false }), /无损|范围/);
    const unknown = structuredClone(draft), unknownItem = unknown.input[0]!;
    assert.ok('text_elements' in unknownItem && unknownItem.text_elements);
    Object.assign(unknownItem.text_elements[0]!, { future: true });
    assert.throws(() => draftToInput(unknown, 'local', { plainTextMode: false }), /未识别/);
    assert.deepEqual(draft.input[1], image);
  }
});

test('a multi-paragraph ordered text item maps references using its original segment', () => {
  const document = { type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Line' }] },
    { type: 'paragraph', content: [
      { type: 'agentMention', attrs: { name: 'A', displayName: 'A', conversationId: null, path: 'thread://t?hostId=local' }, marks: [{ type: 'strong' }] },
      { type: 'text', text: 'local文' },
    ] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Tail' }] },
  ] };
  const input = [{ type: 'text', text: 'Line\nAlocal文', text_elements: [{ byteRange: { start: 6, end: 14 }, placeholder: 'ref' }] },
    { type: 'image', fileId: 'keep' }, { type: 'text', text: 'Tail', text_elements: [] }];
  const draft = { text: 'Line\nAlocal文\nTail', document, images: [], files: [], input };
  for (const plainTextMode of [false, true]) {
    const result = draftToInput(draft, 'local', { plainTextMode }), first = result[0]!, bytes = new TextEncoder().encode(first.text as string);
    const range = (first.text_elements as { byteRange: { start: number; end: number } }[])[0]!.byteRange;
    assert.equal(new TextDecoder().decode(bytes.slice(range.start, range.end)), 'local文');
    assert.deepEqual(result.slice(1), input.slice(1));
  }
});

test('multiple UTF-8 references on both sides of a marked node retain their own positions', () => {
  const document = { type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'text', text: 'local' },
    { type: 'agentMention', attrs: { name: 'A', displayName: 'A', conversationId: null, path: 'thread://t?hostId=local' }, marks: [{ type: 'strong' }] },
    { type: 'text', text: 'local文', marks: [{ type: 'em' }] },
  ] }] };
  const draft = { text: 'localAlocal文', document, images: [], files: [], input: [{ type: 'text', text: 'localAlocal文', text_elements: [
    { byteRange: { start: 0, end: 5 }, placeholder: 'first' }, { byteRange: { start: 6, end: 14 }, placeholder: 'second' },
  ] }] };
  for (const plainTextMode of [false, true]) {
    const result = draftToInput(draft, 'local', { plainTextMode })[0]!, bytes = new TextEncoder().encode(result.text as string);
    const elements = result.text_elements as { byteRange: { start: number; end: number } }[];
    assert.deepEqual(elements.map(({ byteRange }) => new TextDecoder().decode(bytes.slice(byteRange.start, byteRange.end))), ['local', 'local文']);
  }
});

test('a text item containing line breaks retains its boundaries around an agent', () => {
  const before = 'First\nLook @Rev\nLast', after = 'First\nLook Review\nLast';
  const start = after.indexOf('Review');
  const document = updateTextAgentDocument(undefined, before, after, [{ start, end: start + 6, attrs: agent }]);
  assert.ok(document);
  const parsed = readRichDocument(document);
  assert.ok(parsed);
  assert.deepEqual(serializeTextAgentSegments(parsed, ['First\nLook Review', 'Last'], true), [
    'First\nLook [@Review](thread://same-id?hostId=local)', 'Last',
  ]);
});

test('a text-origin agent keeps literal punctuation even without a caller-supplied document mode', () => {
  const before = '*literal* @Rev', after = '*literal* Review', start = after.indexOf('Review');
  const document = updateTextAgentDocument(undefined, before, after, [{ start, end: start + 6, attrs: agent }]);
  assert.ok(document);
  const draft = { text: after, document, images: [], files: [], references: [], skills: [] };
  assert.deepEqual(draftToInput(draft, 'local')[0], { type: 'text',
    text: '*literal* [@Review](thread://same-id?hostId=local)', text_elements: [] });
});
