import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sessionSettings, threadSettings } from '../lib/codex.ts';
import { nonFullAccessChoice, permissionCatalog, permissionStart, publicPermissions } from '../lib/permissions.ts';
import type { PermissionProfile, SessionConfig } from '../lib/codex-protocol.ts';

const profiles: PermissionProfile[] = [':read-only', ':workspace', ':danger-full-access', 'team'].map(id => ({ id, allowed: true }));

test('session and thread projections preserve nulls and permission provenance without exposing config secrets', () => {
  const config = { model: null, model_provider: 'fixture', api_key: 'secret', mcp_servers: { env: 'secret' } };
  assert.deepEqual(sessionSettings(config, [{ id: 'default-model', isDefault: true }]), {
    model: 'default-model', modelProvider: 'fixture', reasoningEffort: null, approvalPolicy: null, sandboxMode: null, serviceTier: null,
  });
  assert.deepEqual(threadSettings({ model: null, activePermissionProfile: null, collaborationMode: { mode: 'plan' },
    sandbox: { type: 'externalSandbox', networkAccess: 'enabled' } }), {
    model: null, permissionProfileId: null, collaborationMode: 'plan', sandboxMode: 'external-sandbox',
  });
  assert.deepEqual(threadSettings({}), {});
});

test('managed restrictions and required automatic review cannot be bypassed by full access or named profiles', () => {
  const choices = permissionCatalog({ cwd: '/workspace', profiles,
    config: { model: 'reviewed', approvals_reviewer: 'guardian_subagent' },
    requirements: { autoReview: { requiredOnModels: ['reviewed'] }, allowedApprovalsReviewers: ['auto_review'],
      allowedPermissionProfiles: { ':workspace': true }, allowedSandboxModes: ['workspace-write'], allowedApprovalPolicies: ['on-request'] },
  });
  assert.deepEqual(choices.filter(choice => choice.allowed).map(choice => choice.id), ['guardian']);
  assert.equal(nonFullAccessChoice(choices)?.id, 'guardian');
  const denied = permissionCatalog({ cwd: '/workspace', profiles, config: {}, requirements: { allowedApprovalPolicies: [] } });
  assert.equal(nonFullAccessChoice(denied), null);
});

test('custom workspace permissions retain native paths and network limits while public choices omit native payloads', () => {
  const config: SessionConfig = { approval_policy: 'on-request', sandbox_mode: 'workspace-write', sandbox_workspace_write: {
    writable_roots: ['/private'], network_access: true, exclude_tmpdir_env_var: true, exclude_slash_tmp: true,
  } };
  const choices = permissionCatalog({ config, profiles, cwd: '/workspace' });
  const custom = choices.find(choice => choice.id === 'config');
  assert.ok(custom);
  assert.deepEqual(custom.native.sandboxPolicy, { type: 'workspaceWrite', writableRoots: ['/private'],
    networkAccess: true, excludeTmpdirEnvVar: true, excludeSlashTmp: true });
  assert.deepEqual(permissionStart(custom), { sandbox: 'workspace-write', approvalPolicy: 'on-request', approvalsReviewer: 'user' });
  assert.deepEqual(permissionStart(custom, { preserveSandboxPolicy: true }), { sandbox: 'workspace-write', approvalPolicy: 'on-request', approvalsReviewer: 'user',
    config: { sandbox_workspace_write: { writable_roots: ['/private'], network_access: true,
      exclude_tmpdir_env_var: true, exclude_slash_tmp: true } } });
  assert.doesNotMatch(JSON.stringify(publicPermissions(choices)), /native|private|writableRoots|sandboxPolicy/);
  assert.equal(nonFullAccessChoice(choices)?.id, 'ask');
});
