import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyElicitation } from '../src/renderer/app/approval-elicitation.ts';

const empty = { type: 'object', properties: {} };
const connector = 'connector_20205bf7d4e99a89d7154bb849718324';
const deletion = JSON.stringify({ approval_version: 1, binding_name: 'app', deployment_id: 'd', operation: 'delete',
  primary_key_column: 'id', primary_key_value: '7', project_id: 'p', table_name: 'records', values: { id: 7 } });
const database = (summary: string, token = 'token') => ({ mode: 'form', serverName: 'codex_apps', requestedSchema: empty,
  _meta: { codex_approval_kind: 'mcp_tool_call', connector_id: connector, tool_name: 'sites.execute_database_delete',
    tool_params: { confirmation_summary: summary, plan_token: token } } });

test('database approvals require canonical, execution-bound target details', () => {
  const valid = classifyElicitation(database(deletion));
  assert.equal(valid.kind, 'tool');
  if (valid.kind === 'tool') {
    assert.equal(valid.executionBound, true);
    assert.equal(valid.parameters.table_name, 'records');
    assert.equal(Object.hasOwn(valid.parameters, 'plan_token'), false);
  }
  for (const request of [database('{}'), database(deletion, ''), database(' ' + deletion),
    database(deletion.replace('"primary_key_value":"7"', '"primary_key_value":"8"')),
    database(deletion.replace('"delete"', '"insert"')),
    { ...database(deletion), _meta: { ...database(deletion)._meta, tool_params: { confirmation_summary: deletion, plan_token: 'token', other: true } } }]) {
    assert.equal(classifyElicitation(request).kind, 'unsupported');
  }
  const ordinary = classifyElicitation({ mode: 'form', _meta: { codex_approval_kind: 'mcp_tool_call',
    connector_id: 'mail', tool_name: 'send', tool_params: { to: 'user@example.test' } }, requestedSchema: empty });
  assert.equal(ordinary.kind, 'tool');
});

test('OpenAI form modes and embedded schema cannot silently use the outer empty schema', () => {
  const actual = { type: 'object', required: ['name'], properties: { name: { type: 'string', minLength: 1 } } };
  for (const mode of ['openai/form', 'openaiForm']) {
    const view = classifyElicitation({ mode, requestedSchema: actual });
    assert.equal(view.kind, 'form');
    if (view.kind === 'form') assert.equal(view.form.fields[0]?.key, 'name');
  }
  const embedded = classifyElicitation({ mode: 'form', requestedSchema: empty, _meta: { 'openai/elicitation': { requestedSchema: actual } } });
  assert.equal(embedded.kind, 'form');
  if (embedded.kind === 'form') assert.equal(embedded.form.fields[0]?.key, 'name');
  assert.equal(classifyElicitation({ mode: 'form', requestedSchema: empty, _meta: { 'openai/elicitation': {} } }).kind, 'unsupported');
  assert.equal(classifyElicitation({ mode: 'openaiForm', requestedSchema: { type: 'object',
    properties: { image: { type: 'openai/imagePicker', items: [] } } } }).kind, 'unsupported');
});

test('confirmation metadata and connector authentication are checked before acceptance', () => {
  const schema = { type: 'object', required: ['approved'], properties: { approved: { type: 'boolean' } } };
  const confirmation = { version: 1, field: 'approved', presentation: { title: 'Review', triggerLabel: 'Review',
    confirmLabel: 'Confirm', fields: [{ label: 'Record', value: 'seven' }] } };
  assert.equal(classifyElicitation({ mode: 'form', message: 'Change the record?', requestedSchema: schema,
    _meta: { 'openai/confirmation': confirmation } }).kind, 'form');
  assert.equal(classifyElicitation({ mode: 'form', message: 'Change?', requestedSchema: empty,
    _meta: { 'openai/confirmation': confirmation } }).kind, 'unsupported');
  const sectioned = { ...confirmation, presentation: { ...confirmation.presentation, destructive: true,
    fields: [{ label: 'Record', value: 'seven' }, { label: 'Action', value: 'delete' }],
    sections: [{ title: 'Target', bodyField: 0, captionField: 1 }] } };
  const sectionView = classifyElicitation({ mode: 'form', message: 'Change?', requestedSchema: schema,
    _meta: { 'openai/confirmation': sectioned } });
  assert.equal(sectionView.kind, 'form');
  if (sectionView.kind === 'form') {
    assert.equal(sectionView.confirmation?.destructive, true);
    assert.equal(sectionView.confirmation?.sections?.[0]?.title, 'Target');
    assert.equal(sectionView.confirmation?.sections?.[0]?.fields[1]?.value, 'delete');
  }
  assert.equal(classifyElicitation({ mode: 'form', message: 'Change?', requestedSchema: schema,
    _meta: { 'openai/confirmation': { ...sectioned, presentation: { ...sectioned.presentation,
      sections: [{ title: 'Target', bodyField: 0, captionField: 0 }] } } } }).kind, 'unsupported');
  const auth = { _codex_apps: { connector_auth_failure: { is_auth_failure: true, connector_id: 'c', connector_name: 'Connector',
    install_url: 'https://chatgpt.com/apps', requested_scopes: ['read'] } } };
  const params = { mode: 'url', serverName: 'codex_apps', elicitationId: 'id', url: 'https://auth.chatgpt.com/verify', _meta: auth };
  assert.equal(classifyElicitation(params).kind, 'url');
  for (const request of [{ ...params, url: 'http://chatgpt.com/' }, { ...params, url: 'https://chatgpt.com.attacker.test/' },
    { ...params, url: 'https://user@chatgpt.com/' }, { ...params, _meta: {} },
    { ...params, _meta: { ...auth, codex_approval_kind: 'browser_auth' } }]) {
    assert.equal(classifyElicitation(request).kind, 'unsupported');
  }
});
