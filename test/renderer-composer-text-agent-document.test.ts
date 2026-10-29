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
