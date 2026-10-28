import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyElicitation, displayApprovalParameters } from '../src/renderer/app/approval-elicitation.ts';

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

test('special approvals never bypass required schema or security metadata', () => {
  const meta = { codex_approval_kind: 'mcp_tool_call', connector_id: 'mail', tool_params: {} };
  const schema = { type: 'object', required: ['approved'], properties: { approved: { type: 'boolean' } } };
  for (const params of [
    { mode: 'form', requestedSchema: schema, _meta: meta },
    { mode: 'form', requestedSchema: empty, _meta: { ...meta, 'openai/confirmation': { field: 'approved' } } },
    { mode: 'form', requestedSchema: empty, _meta: { ...meta, 'openai/elicitation': { requestedSchema: schema } } },
    { mode: 'form', requestedSchema: empty, _meta: { ...meta, security_requirement: true } },
    { mode: 'form', serverName: 'browser', requestedSchema: schema, _meta: { origin: 'https://example.test', persist: 'always' } },
    { mode: 'form', serverName: 'browser', requestedSchema: empty,
      _meta: { origin: 'https://example.test', persist: 'always', 'openai/confirmation': { field: 'approved' } } },
  ]) assert.equal(classifyElicitation(params).kind, 'unsupported');
});

test('tool persistence and risk follow declared metadata; bound database changes remain one-time', () => {
  const meta = { codex_approval_kind: 'mcp_tool_call', connector_id: 'mail', tool_params: {}, persist: ['session', 'always'], riskLevel: 'high' };
  const view = classifyElicitation({ mode: 'form', requestedSchema: empty, _meta: meta });
  assert.equal(view.kind, 'tool');
  if (view.kind === 'tool') { assert.deepEqual(view.persistence, ['session', 'always']); assert.equal(view.riskLevel, 'high'); }
  for (const persist of ['forever', [], ['session', 'session']])
    assert.equal(classifyElicitation({ mode: 'form', requestedSchema: empty, _meta: { ...meta, persist } }).kind, 'unsupported');
  const bound = classifyElicitation({ ...database(deletion), _meta: { ...database(deletion)._meta, persist: 'always' } });
  assert.equal(bound.kind, 'tool');
  if (bound.kind === 'tool') { assert.deepEqual(bound.persistence, []); assert.equal(bound.riskLevel, 'high'); }
  const browser = classifyElicitation({ mode:'form',serverName:'browser',requestedSchema:empty,
    _meta:{origin:'https://example.test',persist:'session',tool_params:{target:'page'},
      tool_params_display:[{name:'target',value:'page',display_name:'Page'}]} });
  assert.equal(browser.kind, 'tool');
  if (browser.kind === 'tool') assert.deepEqual(browser.parameters, {origin:'https://example.test',tool_params:{target:'page'},
    tool_params_display:[{name:'target',value:'page',display_name:'Page'}]});
  assert.equal(classifyElicitation({ mode:'form',serverName:'browser',requestedSchema:empty,
    _meta:{origin:'https://example.test',persist:'session',tool_params_display:'invalid'} }).kind, 'unsupported');
});

test('approval details show invisible characters in field names and values', () => {
  const rendered = displayApprovalParameters({ ['key\u200B']: 'orders\u202Eadmin\u00A0x\u{E0001}', text: '\\u202E' });
  assert.match(rendered, /key\\u200B/);
  assert.match(rendered, /orders\\u202Eadmin\\u00A0x\\u\{E0001\}/);
  assert.match(rendered, /\\\\u202E/);
  assert.doesNotMatch(rendered, /[\u200B\u202E\u00A0\u{E0001}]/u);
});

test('identity verification keeps the original challenge and rejects invalid display or metadata', () => {
  const request = { mode: 'openai/userVerification', serverName: 'fixture', title: 'Confirm', description: 'Approve access', challenge: 'YQ', _meta: null };
  assert.deepEqual(classifyElicitation(request), { kind: 'user-verification', title: 'Confirm', description: 'Approve access', challenge: 'YQ' });
  for (const invalid of [{ challenge: 'Y' }, { challenge: 'YQ==' }, { challenge: 'YR' }, { title: '' },
    { description: 'x'.repeat(4097) }, { _meta: { security_requirement: true } }])
    assert.equal(classifyElicitation({ ...request, ...invalid }).kind, 'unsupported');
});

test('email-code approval requires the original origin, handle, source and one required boolean', () => {
  const schema = { type: 'object', required: ['approved'], properties: { approved: { type: 'boolean' } } };
  const meta = { codex_approval_kind: 'browser_email_otp', connector_id: 'browser-use', origin: 'https://example.test',
    frame_origin: 'https://example.test', browser_auth_challenge_id: 'a'.repeat(32), otp_handle: 'a'.repeat(21) + 'A' };
  const request = { mode: 'form', serverName: 'node_repl', requestedSchema: schema, _meta: meta };
  assert.deepEqual(classifyElicitation(request), { kind: 'email-otp', origin: 'https://example.test' });
  for (const invalid of [{ serverName: 'other' }, { requestedSchema: empty }, { requestedSchema: { ...schema, required: [] } },
    { _meta: { ...meta, frame_origin: 'https://other.test' } }, { _meta: { ...meta, origin: 'https://example.test/path' } },
    { _meta: { ...meta, otp_handle: 'bad' } }, { _meta: { ...meta, unknown_security: true } }])
    assert.equal(classifyElicitation({ ...request, ...invalid }).kind, 'unsupported');
});

test('tool suggestion retains the actual operation without bypassing requested fields', () => {
  const meta = { codex_approval_kind: 'tool_suggestion', tool_type: 'plugin', suggest_type: 'enable',
    tool_id: 'fixture-plugin', tool_name: 'Fixture', suggest_reason: 'Required for this task', remote_plugin_id: 'remote', persist: 'always' };
  const request = { mode: 'form', serverName: 'fixture', requestedSchema: empty, _meta: meta };
  assert.deepEqual(classifyElicitation(request), { kind: 'tool-suggestion', toolType: 'plugin', action: 'enable', toolId: 'fixture-plugin',
    toolName: 'Fixture', reason: 'Required for this task', remotePluginId: 'remote', persist: 'always' });
  for (const invalid of [{ requestedSchema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } } },
    { _meta: { ...meta, install_url: 'javascript:alert(1)' } }, { _meta: { ...meta, security_requirement: true } },
    { _meta: { ...meta, suggest_type: 'execute' } }]) assert.equal(classifyElicitation({ ...request, ...invalid }).kind, 'unsupported');
});

test('browser sign-in validates the challenge, options and complete requested schema', () => {
  const meta = { codex_approval_kind:'browser_auth', browser_auth_challenge_id:'a'.repeat(32), origin:'https://example.test', reason:'Sign in',
    fields:[{id:'user',label:'User',type:'text',required:true},{id:'password',label:'Password',type:'password',required:true}],
    options:[{id:'password-login',label:'Password',field_ids:['user','password']}], screenshot:{tabId:'2'} };
  const request = {mode:'form',serverName:'node_repl',requestedSchema:empty,_meta:meta};
  const view = classifyElicitation(request);
  assert.equal(view.kind, 'browser-auth');
  if (view.kind === 'browser-auth') {
    assert.equal(view.targetTabId, '2');
    assert.deepEqual(view.options[0]?.fieldIds, ['user','password']);
  }
  for (const invalid of [{ requestedSchema:{type:'object',required:['approved'],properties:{approved:{type:'boolean'}}} },
    { _meta:{...meta,origin:'https://user:secret@example.test'} },
    { _meta:{...meta,options:[{id:'x',label:'X',field_ids:['missing']}]} },
    { _meta:{...meta,fields:[{id:'__proto__',label:'Password',type:'password',required:true}]} },
    { _meta:{...meta,'openai/confirmation':{field:'approved'}} },
    { _meta:{...meta,browser_auth_challenge_id:'short'} }])
    assert.equal(classifyElicitation({ ...request, ...invalid }).kind, 'unsupported');
});
