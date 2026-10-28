import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initialApprovalValues, parseApprovalForm, safeElicitationUrl, validateApprovalForm } from '../src/renderer/app/approval-schema.ts';

test('MCP form validates typed fields, constraints and exact selected values', () => {
  const parsed = parseApprovalForm({ type: 'object', required: ['name', 'age', 'confirmed', 'plan', 'labels'], properties: {
    name: { type: 'string', minLength: 2, maxLength: 8 },
    age: { type: 'integer', minimum: 1, maximum: 10 },
    confirmed: { type: 'boolean', default: false },
    plan: { type: 'string', oneOf: [{ const: 'team', title: 'Team plan' }, { const: 'solo', title: 'Individual' }] },
    labels: { type: 'array', items: { anyOf: [{ const: 'a', title: 'Alpha' }, { const: 'b', title: 'Beta' }] }, minItems: 1, maxItems: 2 },
    ratio: { type: 'number', minimum: -1, maximum: 1, default: 0 },
    unused: { type: 'string' },
  } });
  assert.ok(parsed.form);
  assert.deepEqual(initialApprovalValues(parsed.form), { confirmed: 'false', labels: [], ratio: '0' });
  const missing = validateApprovalForm(parsed.form, initialApprovalValues(parsed.form));
  assert.deepEqual(Object.keys(missing.errors ?? {}).sort(), ['age', 'labels', 'name', 'plan']);
  const valid = validateApprovalForm(parsed.form, { name: '  Ada  ', age: '3', confirmed: 'false',
    plan: 'team', labels: ['b', 'a'], ratio: '.5', unused: '' });
  assert.ok(valid.content);
  assert.deepEqual({ ...valid.content }, { name: '  Ada  ', age: 3, confirmed: false, plan: 'team', labels: ['b', 'a'], ratio: 0.5 });
  const invalid = validateApprovalForm(parsed.form, { name: ' ', age: '11', confirmed: 'yes', plan: 'other', labels: ['c'], ratio: 'NaN' });
  assert.deepEqual(Object.keys(invalid.errors ?? {}).sort(), ['age', 'confirmed', 'labels', 'name', 'plan', 'ratio']);
  for (const age of ['', ' ', 'NaN', 'Infinity', '3.5', '9007199254740992', '9007199254740991.1', '1e-9999', '-1']) {
    assert.ok(validateApprovalForm(parsed.form, { name: 'Ada', age, confirmed: 'false', plan: 'solo', labels: ['a'] }).errors?.age, age);
  }
});

test('MCP form supports legacy enums, formats and rejects schemas it cannot preserve', () => {
  const parsed = parseApprovalForm({ type: 'object', properties: {
    choice: { type: 'string', enum: ['one', 'two'], enumNames: ['One', 'Two'] },
    tags: { type: 'array', items: { type: 'string', enum: ['a', 'b'] }, maxItems: 1 },
    email: { type: 'string', format: 'email' }, site: { type: 'string', format: 'uri' },
    day: { type: 'string', format: 'date' }, time: { type: 'string', format: 'date-time' },
  } });
  assert.ok(parsed.form);
  const invalid = validateApprovalForm(parsed.form, { choice: 'bad', tags: ['a', 'b'], email: 'invalid',
    site: '/relative', day: '2025-02-29', time: '2026-04-31T01:00:00Z' });
  assert.deepEqual(Object.keys(invalid.errors ?? {}).sort(), ['choice', 'day', 'email', 'site', 'tags', 'time']);
  assert.ok(validateApprovalForm(parsed.form, { choice: 'two', tags: ['a'], email: 'a@example.test',
    site: 'https://example.test/path', day: '2024-02-29', time: '2024-02-29T23:30:00+02:00' }).content);
  for (const schema of [
    { type: 'object', properties: { x: { type: 'string', pattern: '^a' } } },
    { type: 'object', properties: { x: { type: 'string', format: ['email'] } } },
    { type: 'object', properties: { x: { type: 'object' } } },
    { type: 'object', properties: { x: { type: 'string', enum: ['a', 'a'] } } },
    { type: 'object', properties: { x: { type: 'integer', minimum: 5, maximum: 2 } } },
    { type: 'object', properties: {}, required: ['missing'] },
    { type: 'object', properties: {}, allOf: [] },
  ]) assert.ok(parseApprovalForm(schema).error);
});

test('elicitation links require a plain absolute HTTP(S) URL', () => {
  assert.equal(safeElicitationUrl('https://example.test/path?q=1'), 'https://example.test/path?q=1');
  assert.equal(safeElicitationUrl('http://localhost:1234/'), 'http://localhost:1234/');
  for (const url of [null, '', 'javascript:alert(1)', 'file:///etc/passwd', '/relative',
    'https://user:secret@example.test/', ' https://example.test', 'https://example.test/has space']) {
    assert.equal(safeElicitationUrl(url), null);
  }
});
