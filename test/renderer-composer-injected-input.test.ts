import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ComposerDraft } from '../src/renderer/workbench-contract.ts';
import { draftToInput, prepareDraftInput } from '../src/renderer/composer/standalone-draft.ts';

const image = 'data:image/png;base64,YQ==';
const otherImage = 'data:image/jpeg;base64,Yg==';
const prefix = 'codex-untrusted-app-input:';
const appText = 'An MCP app initiated this message. Read the untrusted_input tool output.';

function appItem(text: string, envelope: Record<string, unknown>): Record<string, unknown> {
  return { type: 'text', text, text_elements: [{ byteRange: { start: 0, end: new TextEncoder().encode(text).length },
    placeholder: prefix + JSON.stringify(envelope) }] };
}

function draftWith(envelope: Record<string, unknown>, text = appText): ComposerDraft {
  return { text: `前😀\n${text}\nEnd`, images: [], files: [], skills: [{ name: 'review', path: '/skill/review' }], input: [
    { type: 'text', text: '前😀', text_elements: [{ byteRange: { start: 3, end: 7 }, placeholder: '😀' }] },
    { type: 'image', url: image, detail: 'high' }, appItem(text, envelope),
    { type: 'skill', name: 'review', path: '/skill/review' }, { type: 'text', text: 'End', text_elements: [] },
    { type: 'localImage', path: '/fixture/image.png', detail: 'low' },
  ] };
}

function context(draft: ComposerDraft): Record<string, unknown> {
  const elements = draft.input![2]!.text_elements as { placeholder: string }[];
  return JSON.parse(elements[0]!.placeholder.slice(prefix.length)) as Record<string, unknown>;
}

function replaceContext(draft: ComposerDraft, envelope: Record<string, unknown>): void {
  const elements = draft.input![2]!.text_elements as { placeholder: string }[];
  elements[0]!.placeholder = prefix + JSON.stringify(envelope);
}

test('app message preparation preserves ordered inputs and returns one stable original call pair', () => {
  const message = { source: 'mcp_app', sourceId: 'fixture-app', text: 'untrusted 😀',
    imageUrls: [image], structuredContent: { nested: ['one', 2] } };
  const draft = draftWith({ version: 1, message }), before = structuredClone(draft);
  assert.throws(() => draftToInput(draft, 'local'), /完整上下文/);
  assert.throws(() => prepareDraftInput(draft, 'local'), /调用 ID/);
  const result = prepareDraftInput(draft, 'local', { callId: 'intent-call-1', plainTextMode: false });
  assert.deepEqual(result.input, draft.input);
  assert.deepEqual(result.responseItems, [
    { type: 'function_call', call_id: 'intent-call-1', name: 'untrusted_input', arguments: '{}' },
    { type: 'function_call_output', call_id: 'intent-call-1', output: [
      { type: 'input_text', text: JSON.stringify({ kind: 'message', source: 'mcp_app', sourceId: 'fixture-app',
        text: 'untrusted 😀', structuredContent: { nested: ['one', 2] } }) },
      { type: 'input_image', image_url: image },
    ] },
  ]);
  const copied = result.input[0]!.text_elements as { byteRange: { start: number; end: number } }[];
  copied[0]!.byteRange.start = 0;
  assert.deepEqual(draft, before);
  assert.deepEqual(prepareDraftInput(draft, 'local', { callId: 'intent-call-1' }).responseItems, result.responseItems);
});

test('untrusted attachment variants project text, images and structured content while preserving reviewed inputs', () => {
  const reviewedText = '\n# MCP app context:\n\n## Reviewed source\nConfirmed\n\n## My request:\nProceed\n';
  const envelope = { version: 1, promptContextWithoutReviewedMessages: '',
    modelContextAttachments: [
      { kind: 'context', untrusted: true, id: 'context-1', server: 'fixture-server', sourceName: 'Tool',
        text: 'tool output', imageAttachments: [{ src: image }], structuredContent: { value: 42 } },
      { kind: 'message', untrusted: true, id: 'context-2', sourceName: 'Other', content: [
        { type: 'text', text: ' first ' }, { type: 'image', data: 'Yg==', mimeType: 'image/jpeg' },
        { type: 'text', text: 'second' },
        { type: 'resource_link', name: 'guide', uri: 'file:///fixture/guide', _meta: { retained: true } },
        { type: 'resource', resource: { uri: 'file:///fixture/data', mimeType: 'text/plain', text: 'resource body',
          _meta: { retained: true } }, _meta: { retained: true } },
      ] },
    ],
    reviewedMessageAttachments: [{ kind: 'message', untrusted: false, id: 'reviewed', sourceName: 'Reviewed source',
      content: [{ type: 'text', text: 'Confirmed' }, { type: 'image', data: 'Yg==', mimeType: 'image/jpeg' }] }],
  };
  const draft = draftWith(envelope, reviewedText);
  draft.input!.push({ type: 'image', url: otherImage });
  const before = structuredClone(draft);
  const result = prepareDraftInput(draft, 'local', { callId: 'original-call' });
  assert.deepEqual(result.input, draft.input);
  assert.deepEqual(result.responseItems[1], { type: 'function_call_output', call_id: 'original-call', output: [
    { type: 'input_text', text: JSON.stringify({ kind: 'model_context', source: 'mcp_app', sourceId: 'context-1',
      server: 'fixture-server', title: 'Tool', text: 'tool output', structuredContent: { value: 42 } }) },
    { type: 'input_image', image_url: image },
    { type: 'input_text', text: JSON.stringify({ kind: 'message', source: 'mcp_app', sourceId: 'context-2',
      title: 'Other', text: 'first \n\nsecond\n\n'
        + JSON.stringify({ type: 'resource_link', name: 'guide', uri: 'file:///fixture/guide' }) + '\n\n'
        + JSON.stringify({ type: 'resource', resource: { uri: 'file:///fixture/data', mimeType: 'text/plain', text: 'resource body' } }) }) },
    { type: 'input_image', image_url: otherImage },
  ] });
  assert.deepEqual(draft, before);
  assert.throws(() => draftToInput(draft, 'local'), /完整上下文/);
});

test('resource-link icons retain the original validated shape in the model context', () => {
  const icons = [{ src: 'https://example.test/dark.svg', mimeType: 'image/svg+xml', sizes: ['16x16', 'any'], theme: 'dark' },
    { src: '', sizes: [], theme: 'light' }, { src: 'fixture' }];
  const links = [{ type: 'resource_link', name: 'empty', uri: 'file:///empty', icons: [] },
    { type: 'resource_link', name: 'full', title: 'Full', uri: 'file:///full', icons, _meta: { retained: true } }];
  const envelope = { version: 1, modelContextAttachments: [{ kind: 'context', untrusted: true, id: 'icons',
    sourceName: 'Fixture', content: links }] };
  const draft = draftWith(envelope, 'icons'), before = structuredClone(draft);
  const result = prepareDraftInput(draft, 'local', { callId: 'icon-call' });
  assert.deepEqual(result.input, draft.input);
  const output = result.responseItems[1];
  assert.equal(output?.type, 'function_call_output');
  const content = JSON.parse((output as { output: { text: string }[] }).output[0]!.text);
  assert.equal(content.text, JSON.stringify(links[0]) + '\n\n' + JSON.stringify({ ...links[1], _meta: undefined }));
  assert.deepEqual(draft, before);

  for (const invalid of [null, {}, [{ mimeType: 'image/png' }], [{ src: 1 }], [{ src: 'x', mimeType: null }],
    [{ src: 'x', sizes: '16x16' }], [{ src: 'x', sizes: ['16x16', 1] }], [{ src: 'x', theme: 'system' }],
    [{ src: 'x', future: true }]]) {
    const altered = structuredClone(envelope);
    altered.modelContextAttachments[0]!.content[1]!.icons = invalid as typeof icons;
    const unsafe = draftWith(altered, 'icons'), original = structuredClone(unsafe);
    assert.throws(() => prepareDraftInput(unsafe, 'local', { callId: 'icon-call' }), /完整上下文/);
    assert.deepEqual(unsafe, original);
  }
  const unknown = structuredClone(envelope);
  Object.assign(unknown.modelContextAttachments[0]!.content[0]!, { future: true });
  assert.throws(() => prepareDraftInput(draftWith(unknown, 'icons'), 'local', { callId: 'icon-call' }), /完整上下文/);
});

test('sender-wrapped visualization and plain-text mode use the original complete text', () => {
  const text = '<codex_multi_user_message>\n<account_user_id>u&amp;1</account_user_id>\n'
    + '<name>&lt;Name&gt;</name>\n<email>a@example.test</email>\n<profile_picture_url></profile_picture_url>\n'
    + '<body>Respond to the user input in the context of our conversation.</body>\n</codex_multi_user_message>';
  const draft: ComposerDraft = { text: `Bold\n${text}`, images: [], files: [], input: [
    { type: 'text', text: 'Bold', text_elements: [] }, appItem(text, { version: 1,
      sender: { accountUserId: 'u&1', name: '<Name>', email: 'a@example.test', profilePictureUrl: null },
      message: { source: 'visualization', sourceId: 'viz-1', text: 'figure' } }),
  ], document: { type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Bold', marks: [{ type: 'strong' }] }] },
    ...text.split('\n').map(line => ({ type: 'paragraph', content: [{ type: 'text', text: line }] })),
  ] } };
  const plain = prepareDraftInput(draft, 'remote-host', { callId: 'visual-1', plainTextMode: true });
  assert.deepEqual(plain.input, draft.input);
  assert.deepEqual(plain.responseItems[1], { type: 'function_call_output', call_id: 'visual-1', output: [
    { type: 'input_text', text: JSON.stringify({ kind: 'message', source: 'visualization', sourceId: 'viz-1', text: 'figure' }) },
  ] });
  assert.throws(() => prepareDraftInput(draft, 'remote-host', { callId: 'visual-1', plainTextMode: false }), /无损对应|无法安全转换/);
});

test('captured rich format changes a separate segment without rewriting the app envelope', () => {
  const app = appItem(appText, { version: 1, message: { source: 'mcp_app', sourceId: 'app', text: 'context' } });
  const draft: ComposerDraft = { text: `Bold\n${appText}`, images: [], files: [], input: [
    { type: 'text', text: 'Bold', text_elements: [] }, app,
  ], document: { type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Bold', marks: [{ type: 'strong' }] }] },
    { type: 'paragraph', content: [{ type: 'text', text: appText }] },
  ] } };
  const before = structuredClone(draft);
  const rich = prepareDraftInput(draft, 'local', { callId: 'formatted', plainTextMode: false });
  assert.deepEqual(rich.input, [{ type: 'text', text: '**Bold**', text_elements: [] }, app]);
  assert.equal(rich.responseItems[0]?.call_id, 'formatted');
  const plain = prepareDraftInput(draft, 'local', { callId: 'formatted', plainTextMode: true });
  assert.deepEqual(plain.input, draft.input);
  assert.deepEqual(draft, before);
  assert.throws(() => draftToInput(draft, 'local', { plainTextMode: true }), /完整上下文/);
});

test('a verified no-message app segment maps its whole UTF-8 range in either captured format', () => {
  const envelope = { version: 1, modelContextAttachments: [{ kind: 'context', untrusted: true, id: 'tool',
    sourceName: 'Fixture', text: 'context', imageAttachments: [] }] };
  const text = '你好😀', app = appItem(text, envelope);
  const draft: ComposerDraft = { text: text + '\nSecond', images: [], files: [], input: [app,
    { type: 'image', url: image }, { type: 'skill', name: 'review', path: '/skill/review' },
    { type: 'text', text: 'Second', text_elements: [] }], document: { type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text, marks: [{ type: 'strong' }] }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Second' }] },
  ] } };
  const before = structuredClone(draft), richText = '**你好😀**';
  const rich = prepareDraftInput(draft, 'local', { callId: 'format-call', plainTextMode: false });
  const element = (rich.input[0]!.text_elements as { byteRange: { start: number; end: number }; placeholder: string }[])[0]!;
  assert.equal(rich.input[0]!.text, richText);
  assert.deepEqual(element.byteRange, { start: 0, end: new TextEncoder().encode(richText).length });
  assert.equal(element.placeholder, (app.text_elements as { placeholder: string }[])[0]!.placeholder);
  assert.deepEqual(rich.input.slice(1), draft.input!.slice(1));
  assert.equal(rich.responseItems.length, 2);
  assert.deepEqual(prepareDraftInput(draft, 'local', { callId: 'format-call', plainTextMode: true }).input, draft.input);
  const richDraft = { ...draft, text: richText + '\nSecond', input: rich.input };
  const plain = prepareDraftInput(richDraft, 'local', { callId: 'format-call', plainTextMode: true });
  assert.deepEqual(plain.input, draft.input);
  assert.deepEqual(plain.responseItems, rich.responseItems);
  assert.deepEqual(draft, before);
  assert.throws(() => draftToInput(draft, 'local', { plainTextMode: false }), /完整上下文/);
});

test('a whole app marker may cover a multi-paragraph rich document without flattening other inputs', () => {
  const text = 'Hello 😀\nSecond', envelope = { version: 1, modelContextAttachments: [
    { kind: 'context', untrusted: true, id: 'multi', sourceName: 'Fixture', text: 'context', imageAttachments: [] },
  ] };
  const draft: ComposerDraft = { text, images: [], files: [], input: [appItem(text, envelope),
    { type: 'image', url: image }, { type: 'skill', name: 'review', path: '/skill/review' }],
  document: { type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Hello 😀', marks: [{ type: 'strong' }] }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Second' }] },
  ] } };
  const before = structuredClone(draft), result = prepareDraftInput(draft, 'local', { callId: 'multi', plainTextMode: false });
  const formatted = '**Hello 😀**\nSecond';
  assert.equal(result.input[0]!.text, formatted);
  assert.deepEqual((result.input[0]!.text_elements as { byteRange: unknown }[])[0]!.byteRange,
    { start: 0, end: new TextEncoder().encode(formatted).length });
  assert.deepEqual(result.input.slice(1), draft.input!.slice(1));
  assert.deepEqual(draft, before);
});

test('formatting keeps active messages protected and revalidates reviewed context', () => {
  const withMessage = draftWith({ version: 1, message: { source: 'mcp_app', sourceId: 'app', text: 'context' } });
  withMessage.document = { type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: '前😀' }] },
    { type: 'paragraph', content: [{ type: 'text', text: appText, marks: [{ type: 'strong' }] }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'End' }] },
  ] };
  const unchanged = structuredClone(withMessage);
  assert.throws(() => prepareDraftInput(withMessage, 'local', { callId: 'active', plainTextMode: false }), /无法安全转换/);
  assert.deepEqual(withMessage, unchanged);

  const reviewedText = '\n# MCP app context:\n\n## Reviewed\nConfirmed\n\n## My request:\nProceed\n';
  const reviewed = { version: 1, promptContextWithoutReviewedMessages: '',
    modelContextAttachments: [{ kind: 'context', untrusted: true, id: 'tool', sourceName: 'Fixture', text: 'context', imageAttachments: [] }],
    reviewedMessageAttachments: [{ kind: 'message', untrusted: false, id: 'r', sourceName: 'Reviewed', text: 'Confirmed', imageAttachments: [] }] };
  const draft: ComposerDraft = { text: reviewedText, images: [], files: [], input: [appItem(reviewedText, reviewed)],
    document: { type: 'doc', content: reviewedText.split('\n').map(line => ({ type: 'paragraph',
      ...(line ? { content: [{ type: 'text', text: line, ...(line === 'Confirmed' ? { marks: [{ type: 'strong' }] } : {}) }] } : {}) })) } };
  const original = structuredClone(draft);
  assert.deepEqual(prepareDraftInput(draft, 'local', { callId: 'reviewed', plainTextMode: true }).input, draft.input);
  assert.throws(() => prepareDraftInput(draft, 'local', { callId: 'reviewed', plainTextMode: false }), /完整上下文/);
  assert.deepEqual(draft, original);

  const direct = structuredClone(draft), directEnvelope = structuredClone(reviewed);
  delete (directEnvelope as { modelContextAttachments?: unknown }).modelContextAttachments;
  direct.input![0] = appItem(reviewedText, directEnvelope);
  const directOriginal = structuredClone(direct);
  assert.deepEqual(draftToInput(direct, 'local', { plainTextMode: true }), direct.input);
  assert.throws(() => draftToInput(direct, 'local', { plainTextMode: false }), /完整上下文/);
  assert.deepEqual(direct, directOriginal);

  const untrusted: ComposerDraft = { text: 'hello', images: [], files: [],
    input: [appItem('hello', { version: 1, modelContextAttachments: reviewed.modelContextAttachments })],
    document: { type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'hello', marks: [{ type: 'strong' }] },
    ] }] } };
  for (const alter of [
    (item: Record<string, unknown>) => { item.future = 'preserve'; },
    (item: Record<string, unknown>) => { (item.text_elements as Record<string, unknown>[])[0]!.future = 'preserve'; },
    (item: Record<string, unknown>) => { ((item.text_elements as Record<string, unknown>[])[0]!.byteRange as Record<string, unknown>).future = 'preserve'; },
    (item: Record<string, unknown>) => { ((item.text_elements as Record<string, unknown>[])[0]!.byteRange as Record<string, unknown>).end = 4; },
  ]) {
    const unsafe = structuredClone(untrusted); alter(unsafe.input![0]!);
    const snapshot = structuredClone(unsafe);
    assert.throws(() => prepareDraftInput(unsafe, 'local', { callId: 'unknown', plainTextMode: false }));
    assert.deepEqual(unsafe, snapshot);
  }
});

test('unproven or incomplete app contexts are rejected without changing the draft', () => {
  const base = draftWith({ version: 1, message: { source: 'mcp_app', sourceId: 'app', text: 'content' } });
  const variants: ComposerDraft[] = [];
  const changed = (update: (envelope: Record<string, unknown>) => void) => {
    const copy = structuredClone(base), envelope = context(copy); update(envelope); replaceContext(copy, envelope); variants.push(copy);
  };
  changed(value => { value.version = 2; });
  changed(value => { value.future = 'preserve'; });
  changed(value => { (value.message as Record<string, unknown>).future = true; });
  changed(value => { (value.message as Record<string, unknown>).imageUrls = ['https://example.test/a.png']; });
  changed(value => { value.modelContextAttachments = [{ kind: 'context', untrusted: false, id: 'x', sourceName: 'x', text: '', imageAttachments: [] }]; });
  changed(value => { value.modelContextAttachments = [{ kind: 'context', untrusted: true, id: 'x', sourceName: 'x',
    content: [{ type: 'audio', data: 'YQ==', mimeType: 'audio/wav' }] }]; });
  changed(value => { value.reviewedMessageAttachments = [{ kind: 'message', untrusted: false, id: 'r', sourceName: 'review',
    text: 'not in the original prompt', imageAttachments: [] }]; });
  const wrongText = structuredClone(base); wrongText.input![2]!.text = 'not the original message'; variants.push(wrongText);
  const wrongRange = structuredClone(base); ((wrongRange.input![2]!.text_elements as { byteRange: { end: number } }[])[0]!).byteRange.end -= 1; variants.push(wrongRange);
  const extraElement = structuredClone(base); (extraElement.input![2]!.text_elements as unknown[]).push({ byteRange: { start: 0, end: 0 }, placeholder: '' }); variants.push(extraElement);
  const unknownItem = structuredClone(base); unknownItem.input!.push({ type: 'future', value: 'keep' }); variants.push(unknownItem);
  const unknownImageField = structuredClone(base); unknownImageField.input![1]!.future = 'keep'; variants.push(unknownImageField);
  const invalidImageDetail = structuredClone(base); invalidImageDetail.input![1]!.detail = ['high']; variants.push(invalidImageDetail);
  const invalidImageIdentity = structuredClone(base); invalidImageIdentity.input![1]!.fileId = null; variants.push(invalidImageIdentity);
  const nonfinite = structuredClone(base);
  (nonfinite.input![2]!.text_elements as { placeholder: string }[])[0]!.placeholder = prefix
    + '{"version":1,"message":{"source":"mcp_app","sourceId":"app","text":"content","structuredContent":{"value":1e400}}}';
  variants.push(nonfinite);
  const duplicated = structuredClone(base); duplicated.input!.push(structuredClone(duplicated.input![2]!)); duplicated.text += '\n' + appText; variants.push(duplicated);
  const multiple = structuredClone(base); multiple.input!.push(appItem('separate', { version: 1, promptContextWithoutReviewedMessages: 'retained' }));
  multiple.text += '\nseparate'; variants.push(multiple);
  const hints = { ...structuredClone(base), hints: [{ unknown: true }] }; variants.push(hints);
  const blocked = { ...structuredClone(base), blocked: 'keep raw data' }; variants.push(blocked);
  for (const value of variants) {
    const before = structuredClone(value);
    assert.throws(() => prepareDraftInput(value, 'local', { callId: 'call-1' }));
    assert.deepEqual(value, before);
  }
  assert.throws(() => prepareDraftInput(base, 'local', { callId: '  ' }), /调用 ID/);
});

test('reviewed images and duplicate sections require complete original context', () => {
  const reviewedText = '\n# MCP app context:\n\n## Review\nText\n\n## My request:\nProceed\n';
  const reviewed = { kind: 'message', untrusted: false, id: 'r', sourceName: 'Review', text: 'Text', imageAttachments: [{ src: otherImage }] };
  const draft = draftWith({ version: 1, promptContextWithoutReviewedMessages: '', reviewedMessageAttachments: [reviewed],
    modelContextAttachments: [{ kind: 'context', untrusted: true, id: 'u', sourceName: 'App', text: null, imageAttachments: [] }] }, reviewedText);
  draft.input![1]!.url = otherImage;
  assert.throws(() => prepareDraftInput(draft, 'local', { callId: 'call-1' }), /完整上下文/);
  draft.input!.push({ type: 'image', url: otherImage });
  assert.equal(prepareDraftInput(draft, 'local', { callId: 'call-1' }).responseItems.length, 2);
  const duplicate = structuredClone(draft), envelope = context(duplicate);
  envelope.reviewedMessageAttachments = [reviewed, { ...reviewed, id: 'r2', imageAttachments: [] }];
  replaceContext(duplicate, envelope);
  assert.throws(() => prepareDraftInput(duplicate, 'local', { callId: 'call-1' }), /完整上下文/);
  const reversed = structuredClone(draft), reversedEnvelope = context(reversed);
  (reversedEnvelope.reviewedMessageAttachments as { imageAttachments: { src: string }[] }[])[0]!.imageAttachments.push({ src: image });
  replaceContext(reversed, reversedEnvelope);
  reversed.input!.push({ type: 'image', url: image });
  assert.equal(prepareDraftInput(reversed, 'local', { callId: 'call-1' }).responseItems.length, 2);
  reversed.input!.splice(reversed.input!.length - 2, 2, { type: 'image', url: image }, { type: 'image', url: otherImage });
  assert.throws(() => prepareDraftInput(reversed, 'local', { callId: 'call-1' }), /完整上下文/);
});

test('ordinary input remains compatible with the existing direct conversion', () => {
  const draft: ComposerDraft = { text: 'Hello', images: [], files: [], input: [
    { type: 'text', text: 'Hello', text_elements: [] }, { type: 'mention', name: 'file', path: '/fixture' },
  ] };
  assert.deepEqual(prepareDraftInput(draft, 'local'), { input: draftToInput(draft, 'local'), responseItems: [] });
});
