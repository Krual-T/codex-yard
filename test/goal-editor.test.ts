import assert from 'node:assert/strict';
import { test } from 'node:test';
import { goalDocument, goalMarkdown } from '../src/workspace/goal-editor.ts';

test('Goal rich text preserves formatted objectives through Markdown editing', () => {
  const text = '# Goal\n\nFinish **bold** and *italic* with ~~old~~ and `code`.\n\n' +
    '- [x] Done\n- [ ] Pending\n  - Nested\n\n' +
    '> Keep [context](https://example.com/path).\n\n' +
    '```ts\nconst value = "```";\n```\n\n' +
    '| Name | Value |\n| :--- | ---: |\n| Row | 1 |';
  const doc = goalDocument(text);
  doc.check();
  const serialized = goalMarkdown(doc), restored = goalDocument(serialized);
  assert.deepEqual(restored.toJSON(), doc.toJSON());
  assert.match(serialized, /- \[x\] Done/);
  assert.match(serialized, /````ts\nconst value = "```";\n````/);
  assert.equal(doc.firstChild?.type.name, 'heading');
  assert.equal(doc.lastChild?.type.name, 'table');
});

test('Goal editor treats HTML and unavailable file mentions as literal text', () => {
  const objective = '<script>private()</script>\n\nRead @workspace and $skill without mentions.\n\n[unsafe](javascript:alert)';
  const doc = goalDocument(objective);
  doc.check();
  const output = goalMarkdown(doc);
  assert.match(output, /<script>private\(\)<\/script>/);
  assert.match(output, /@workspace and \$skill/);
  assert.doesNotMatch(output, /javascript:/);
  assert.equal(goalMarkdown(goalDocument('first line\nsecond line')), 'first line\nsecond line');
});
