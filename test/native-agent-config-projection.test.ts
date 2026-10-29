import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectAgentConfiguration } from '../src/native/agent-config-projection.ts';

const home = '/fixture/codex';
const options = { codexHome: home, appServerVersion: '0.164.0' };
const userLayer = (config: unknown, changes: Record<string, unknown> = {}) => ({
  name: { type: 'user', file: `${home}/config.toml`, profile: null }, version: 'user-version', config, ...changes,
});
const response = (base: unknown, effective: unknown = {}, origins: unknown = {}) => ({
  config: effective, origins, layers: [userLayer(base)],
});
const origin = (type: string) => ({ name: { type, file: '/private/managed.toml', token: 'ORIGIN_SECRET' }, version: 'private-version' });

test('projects the actual user-layer and effective shapes separately without secrets or paths', () => {
  const raw = {
    config: { approval_policy: 'never', sandbox_mode: 'danger-full-access', web_search: 'live', model_verbosity: 'high',
      model_reasoning_summary: 'detailed', profile: 'other', api_key: 'EFFECTIVE_SECRET',
      sandbox_workspace_write: { network_access: true, writable_roots: ['/private/root'], token: 'NESTED_SECRET' } },
    origins: { approval_policy: origin('user'), web_search: origin('project'), password: origin('mdm') },
    layers: [userLayer({ approval_policy: 'on-request', sandbox_mode: 'workspace-write', web_search: 'cached',
      model_verbosity: null, model_reasoning_summary: 'concise', model_provider: 'PRIVATE_PROVIDER',
      sandbox_workspace_write: { network_access: false, writable_roots: ['/private/user-root'], api_key: 'BASE_SECRET' } }),
    { name: { type: 'project', file: '/private/project.toml' }, version: 'project-version', config: { web_search: 'live' } }],
  };
  const result = projectAgentConfiguration(raw, options);
  assert.deepEqual(result, {
    config: { approval_policy: 'never', sandbox_mode: 'danger-full-access', web_search: 'live', model_verbosity: 'high',
      model_reasoning_summary: 'detailed', sandbox_workspace_write: { network_access: true } },
    yardAgentConfiguration: { base: { approval_policy: 'on-request', sandbox_mode: 'workspace-write', web_search: 'cached',
      model_verbosity: null, model_reasoning_summary: 'concise', sandbox_workspace_write: { network_access: false } },
    lockedKeys: [], supportsIndexedWebSearch: true },
  });
  assert.doesNotMatch(JSON.stringify(result), /SECRET|PRIVATE|\/private|version|profile/);
  raw.config.sandbox_workspace_write.network_access = false;
  assert.deepEqual(result.config.sandbox_workspace_write, { network_access: true });
});

test('a missing, ambiguous, wrong-source or malformed user layer never becomes an empty base', () => {
  const cases: { label: string; raw: unknown; codexHome?: string | null }[] = [
    { label: 'missing layers', raw: { config: {}, origins: {}, layers: null } },
    { label: 'missing user layer', raw: { config: {}, origins: {}, layers: [{ name: { type: 'project' }, config: {} }] } },
    { label: 'duplicate user layers', raw: { config: {}, origins: {}, layers: [userLayer({}), userLayer({})] } },
    { label: 'profile layer', raw: { config: {}, origins: {}, layers: [userLayer({}, { name: { type: 'user', file: `${home}/config.toml`, profile: 'work' } })] } },
    { label: 'base plus profile', raw: { config: {}, origins: {}, layers: [userLayer({}), userLayer({}, { name: { type: 'user', file: `${home}/config.toml`, profile: 'work' } })] } },
    { label: 'wrong source home', raw: response({}), codexHome: '/other/codex' },
    { label: 'unknown source home', raw: response({}), codexHome: null },
    { label: 'no version', raw: { config: {}, origins: {}, layers: [userLayer({}, { version: '' })] } },
    { label: 'no config', raw: { config: {}, origins: {}, layers: [userLayer(null)] } },
    { label: 'malformed other layer', raw: { config: {}, origins: {}, layers: [userLayer({}), { name: null }] } },
    { label: 'missing origins', raw: { config: {}, layers: [userLayer({})] } },
    { label: 'malformed origin', raw: response({}, {}, { web_search: { name: null } }) },
    { label: 'malformed network origin', raw: response({}, {}, { sandbox_workspace_write: null }) },
    { label: 'missing effective config', raw: { origins: {}, layers: [userLayer({})] } },
  ];
  for (const entry of cases) {
    assert.equal(projectAgentConfiguration(entry.raw, { ...options, codexHome: entry.codexHome === undefined ? home : entry.codexHome })
      .yardAgentConfiguration.base, null, entry.label);
  }
  assert.deepEqual(projectAgentConfiguration(response({}), options).yardAgentConfiguration.base, {});
});

test('only known managed origins lock their matching fields, including either network origin', () => {
  for (const type of ['mdm', 'sessionFlags', 'legacyManagedConfigTomlFromFile', 'legacyManagedConfigTomlFromMdm']) {
    const origins = { approval_policy: origin(type), sandbox_mode: origin(type), web_search: origin(type),
      model_verbosity: origin(type), model_reasoning_summary: origin(type), other: origin(type),
      sandbox_workspace_write: origin(type), 'sandbox_workspace_write.network_access': origin(type) };
    const projected = projectAgentConfiguration(response({}, {}, origins), options).yardAgentConfiguration;
    assert.deepEqual(projected.lockedKeys, ['approval_policy', 'sandbox_mode', 'web_search', 'model_verbosity',
      'model_reasoning_summary', 'sandbox_workspace_write.network_access']);
    assert.doesNotMatch(JSON.stringify(projected), /private|SECRET|other/);
  }
  for (const key of ['approval_policy', 'sandbox_mode', 'web_search', 'model_verbosity', 'model_reasoning_summary']) {
    assert.deepEqual(projectAgentConfiguration(response({}, {}, { [key]: origin('mdm') }), options)
      .yardAgentConfiguration.lockedKeys, [key]);
  }
  for (const origins of [
    { sandbox_workspace_write: origin('mdm'), 'sandbox_workspace_write.network_access': origin('user') },
    { sandbox_workspace_write: origin('user'), 'sandbox_workspace_write.network_access': origin('sessionFlags') },
  ]) {
    assert.deepEqual(projectAgentConfiguration(response({}, {}, origins), options).yardAgentConfiguration.lockedKeys,
      ['sandbox_workspace_write.network_access']);
  }
  assert.deepEqual(projectAgentConfiguration(response({}, {}, { sandbox_mode: origin('project'),
    sandbox_workspace_write: origin('user'), 'sandbox_workspace_write.network_access': origin('project') }), options)
    .yardAgentConfiguration.lockedKeys, []);
});

test('indexed search follows the connected version gate, including prereleases and unknowns', () => {
  const cases: [string | null, boolean][] = [
    [null, false], ['', false], ['unknown', false], ['0.0.0', true], ['0.0.0+local', false],
    ['0.141.99', false], ['0.142.0-6', false], ['0.142.0-alpha', false], ['0.142.0-alpha.5', false],
    ['0.142.0-alpha.6', true], ['0.142.0-alpha.6+build', true], ['0.142.0-alpha.6.1', true],
    ['0.142.0-beta.1', true], ['0.142.0', true],
    ['0.143.0-alpha.1', true], ['0.163.0-alpha.10.2', true], ['0.164.0', true],
    ['0.142.0-alpha.06', false], ['0.142.0-alpha..6', false], ['0.142.0+', false], ['01.142.0', false],
  ];
  for (const [version, expected] of cases) {
    assert.equal(projectAgentConfiguration(response({}), { ...options, appServerVersion: version })
      .yardAgentConfiguration.supportsIndexedWebSearch, expected, String(version));
  }
});

test('granular approvals retain their known boolean fields and remain independent copies', () => {
  const approval = { granular: { sandbox_approval: false, rules: true, skill_approval: false, request_permissions: true, mcp_elicitations: false } };
  const raw = response({ approval_policy: approval }, { approval_policy: approval });
  const result = projectAgentConfiguration(raw, options);
  assert.deepEqual(result.yardAgentConfiguration.base, { approval_policy: approval });
  assert.deepEqual(result.config, { approval_policy: approval });
  approval.granular.rules = false;
  assert.equal((result.config.approval_policy as typeof approval).granular.rules, true);
  assert.equal((result.yardAgentConfiguration.base?.approval_policy as typeof approval).granular.rules, true);
});

test('malformed known values fail closed and never carry arbitrary nested data', () => {
  for (const malformed of [
    { approval_policy: { granular: { rules: true, api_key: 'GRANULAR_SECRET' } } },
    { approval_policy: { granular: { rules: 'GRANULAR_SECRET' } } },
    { approval_policy: { granular: { rules: true }, token: 'APPROVAL_SECRET' } },
    { approval_policy: 'STRING_SECRET' }, { sandbox_mode: ['read-only', 'ARRAY_SECRET'] },
    { model_verbosity: { token: 'VERBOSITY_SECRET' } },
    { sandbox_workspace_write: { network_access: 'NETWORK_SECRET' } },
  ]) {
    const baseInvalid = projectAgentConfiguration(response(malformed), options);
    const effectiveInvalid = projectAgentConfiguration(response({}, malformed), options);
    assert.equal(baseInvalid.yardAgentConfiguration.base, null);
    assert.equal(effectiveInvalid.yardAgentConfiguration.base, null);
    assert.doesNotMatch(JSON.stringify([baseInvalid, effectiveInvalid]), /SECRET/);
  }
});
