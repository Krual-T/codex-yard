import assert from 'node:assert/strict';
import test from 'node:test';
import { latestReasoningHeading, linkedWorkspaceOutputs } from '../src/workspace/output-files.ts';
import { fixtureTurn } from './fake-codex.ts';

test('Public reasoning captions match the pinned Markdown and comment cases', () => {
  const cases = [
    ['**Checking', '**Checking'],
    ['**Checking the fixture**', 'Checking the fixture'],
    ['**Heading**\n\nFirst public paragraph with `code` and [a link](https://example.test).', 'First public paragraph with code and a link.'],
    ['**Heading**\n\nFirst public paragraph.\n\n<!-- hidden comment -->', 'First public paragraph.'],
    ['**Heading**\n\nFirst public paragraph.\n\n**Inspecting the next state**\n\nSecond public paragraph.', 'Second public paragraph.'],
    ['<!-- hidden comment -->\n\n<!', null],
    ['**Inspect &amp; compare**', 'Inspect & compare'],
    ['`a &amp; b`', 'a &amp; b'],
  ] as const;
  for (const [summary, heading] of cases) assert.equal(latestReasoningHeading(summary), heading, summary);
});

test('Outputs only discover completed assistant links inside the thread workspace', () => {
  const cwd = '/tmp/yard workspace';
  const files = linkedWorkspaceOutputs([
    fixtureTurn('pending', [{ id: 'pending-answer', type: 'agentMessage', text: '[pending](./pending.txt)' }], 'inProgress'),
    fixtureTurn('done', [
      { id: 'user', type: 'userMessage', text: '[user](./user.txt)' },
      { id: 'answer', type: 'agentMessage', text: [
        '[report](<./A report.html>)',
        '[duplicate](file:///tmp/yard%20workspace/A%20report.html#info)',
        '[escape](../outside.pdf)',
        '[encoded escape](./%2e%2e/outside.pdf)',
        '[encoded separator](./a%2fb.txt)',
        '[adjacent](file:///tmp/yard%20workspace2/other.pdf)',
        '[remote](https://example.com/in-workspace.pdf)',
        '[remote filesystem](file://example.com/tmp/yard%20workspace/file.pdf)',
        '[not a preview](./secret.env)',
        '~~~',
        '[code](./code.txt)',
        '~~~',
        '![image][picture]',
        '[sheet][data]',
        '',
        '[picture]: ./image.png',
        '[data]: ./sheet.xlsx',
      ].join('\n') },
    ]),
  ], cwd);
  assert.deepEqual(files, [
    { path: cwd + '/A report.html', name: 'A report.html', preview: 'html' },
    { path: cwd + '/image.png', name: 'image.png', preview: 'image' },
    { path: cwd + '/sheet.xlsx', name: 'sheet.xlsx', preview: null },
  ]);
});
