import type { ApprovalPolicy, ApprovalsReviewer, PermissionRequirements, SandboxMode, SessionConfig } from '../../../lib/codex-protocol.ts';
import type { SubmitOptions, WorkbenchClient } from '../workbench-contract.ts';

export interface ComposerPermissionChoice {
  id: string;
  label: string;
  description: string;
  allowed: boolean;
  reason: string;
  fullAccess: boolean;
  resolved?: string;
  patch: Partial<SubmitOptions>;
}

const granular: ApprovalPolicy = { granular: { sandbox_approval: false, rules: false, skill_approval: false,
  request_permissions: true, mcp_elicitations: true } };
const modes: Readonly<Record<string, SandboxMode | undefined>> = {
  ':workspace': 'workspace-write', ':read-only': 'read-only', ':danger-full-access': 'danger-full-access',
};
const automatic = (value: ApprovalsReviewer | null | undefined) => value === 'auto_review' || value === 'guardian_subagent';
export const isCyberModel = (model: string) => {
  const name = model.toLowerCase();
  return name.includes('cyber') || name.includes('daybreak');
};
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const isSandboxMode = (value: unknown): value is SandboxMode => value === 'read-only' || value === 'workspace-write' || value === 'danger-full-access';
const isApprovalPolicy = (value: unknown): value is ApprovalPolicy => value === 'untrusted' || value === 'on-request' || value === 'never'
  || isRecord(value) && isRecord(value.granular) && ['sandbox_approval', 'rules', 'skill_approval', 'request_permissions', 'mcp_elicitations']
    .every(key => typeof (value.granular as Record<string, unknown>)[key] === 'boolean');
const samePolicy = (a: unknown, b: unknown) => {
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return a === b;
  if (!isRecord(a) || !isRecord(b) || !isRecord(a.granular) || !isRecord(b.granular)) return false;
  return ['sandbox_approval', 'rules', 'skill_approval', 'request_permissions', 'mcp_elicitations']
    .every(key => a.granular && b.granular && (a.granular as Record<string, unknown>)[key] === (b.granular as Record<string, unknown>)[key]);
};

function requirementsFrom(value: unknown): PermissionRequirements {
  if (value == null) return {};
  if (!isRecord(value)) throw new Error('Invalid permission requirements');
  const profiles = value.allowedPermissionProfiles;
  if (profiles != null && (!isRecord(profiles) || Object.values(profiles).some(item => typeof item !== 'boolean'))) throw new Error('Invalid required permission profiles');
  const sandbox = value.allowedSandboxModes;
  if (sandbox != null && (!Array.isArray(sandbox) || sandbox.some(item => item !== 'read-only' && item !== 'workspace-write' && item !== 'danger-full-access'))) throw new Error('Invalid allowed sandbox modes');
  const approval = value.allowedApprovalPolicies;
  if (approval != null && (!Array.isArray(approval) || approval.some(item => {
    if (item === 'untrusted' || item === 'on-request' || item === 'never') return false;
    if (!isRecord(item) || !isRecord(item.granular)) return true;
    return ['sandbox_approval', 'rules', 'skill_approval', 'request_permissions', 'mcp_elicitations'].some(key => typeof (item.granular as Record<string, unknown>)[key] !== 'boolean');
  }))) throw new Error('Invalid allowed approval policies');
  const reviewers = value.allowedApprovalsReviewers;
  if (reviewers != null && (!Array.isArray(reviewers) || reviewers.some(item => item !== 'user' && item !== 'auto_review' && item !== 'guardian_subagent'))) throw new Error('Invalid allowed reviewers');
  if (value.autoReview != null && (!isRecord(value.autoReview) || value.autoReview.requiredOnModels != null
    && (!Array.isArray(value.autoReview.requiredOnModels) || value.autoReview.requiredOnModels.some(item => typeof item !== 'string')))) throw new Error('Invalid automatic review requirements');
  return value as PermissionRequirements;
}

/** Mirrors the built-in choices used by the host's permission catalog without changing configuration. */
export async function loadComposerPermissions(client: WorkbenchClient, hostId: string, cwd: string,
  model: string | undefined, current: SubmitOptions, projectless: boolean, inherited?: SubmitOptions): Promise<ComposerPermissionChoice[]> {
  const [configResponse, requirementsResponse] = await Promise.all([
    client.rpc('config/read', { includeLayers: false, cwd }, hostId), client.rpc('configRequirements/read', {}, hostId),
  ]);
  if (!isRecord(configResponse) || !isRecord(configResponse.config) || !isRecord(requirementsResponse)
    || !Object.hasOwn(requirementsResponse, 'requirements')) throw new Error('Invalid permission configuration response');
  const config = configResponse.config as SessionConfig;
  const required = requirementsFrom(requirementsResponse.requirements);
  const profiles: { id: string; allowed: boolean; description?: string | null }[] = [];
  const ids = new Set<string>(), cursors = new Set<string>();
  let cursor: string | null = null;
  do {
    const page: unknown = await client.rpc('permissionProfile/list', { cwd, limit: 100, ...(cursor ? { cursor } : {}) }, hostId);
    if (!isRecord(page) || !Array.isArray(page.data) || page.nextCursor != null && typeof page.nextCursor !== 'string') throw new Error('Invalid permission profile response');
    for (const item of page.data) {
      if (!isRecord(item) || typeof item.id !== 'string' || !item.id || typeof item.allowed !== 'boolean'
        || item.description != null && typeof item.description !== 'string' || ids.has(item.id)) throw new Error('Invalid permission profile');
      ids.add(item.id); profiles.push({ id: item.id, allowed: item.allowed, description: item.description as string | null | undefined });
    }
    cursor = typeof page.nextCursor === 'string' && page.nextCursor ? page.nextCursor : null;
    if (cursor && cursors.has(cursor)) throw new Error('Permission profile cursor did not advance');
    if (cursor) cursors.add(cursor);
  } while (cursor);
  const profileAllowed = (id: string) => profiles.some(profile => profile.id === id && profile.allowed)
    && (required.allowedPermissionProfiles == null || required.allowedPermissionProfiles[id] === true);
  const allows = (key: 'allowedSandboxModes' | 'allowedApprovalPolicies' | 'allowedApprovalsReviewers', value: unknown) =>
    required[key] == null || required[key]!.some(item => samePolicy(item, value));
  const requirementModel = model || (inherited ? undefined : config.model);
  if (required.autoReview?.requiredOnModels?.length && !requirementModel) throw new Error('The current model is not confirmed; permission requirements cannot be evaluated.');
  const requiredReview = required.autoReview?.requiredOnModels?.includes(requirementModel || '') === true;
  const allowed = (profile: string, policy: ApprovalPolicy, reviewer: ApprovalsReviewer) => profileAllowed(profile)
    && allows('allowedSandboxModes', modes[profile]) && allows('allowedApprovalPolicies', policy)
    && (allows('allowedApprovalsReviewers', reviewer) || automatic(reviewer) && (required.allowedApprovalsReviewers || []).some(automatic));
  const configuredReviewer = automatic(config.approvals_reviewer) ? config.approvals_reviewer! : 'user';
  const configuredPolicy = config.approval_policy ?? 'on-request';
  const configuredMode = config.sandbox_mode ?? 'read-only';
  let askProfile = configuredMode === 'read-only' && profileAllowed(':read-only') ? ':read-only' : ':workspace';
  let askPolicy: ApprovalPolicy = (projectless || samePolicy(configuredPolicy, granular)) && allowed(askProfile, granular, 'user') ? granular : 'on-request';
  if (!allowed(askProfile, askPolicy, 'user') && allowed(':read-only', 'on-request', 'user')) { askProfile = ':read-only'; askPolicy = 'on-request'; }
  const reviewer = configuredReviewer === 'auto_review' || (required.allowedApprovalsReviewers || []).includes('auto_review') ? 'auto_review' : 'guardian_subagent';
  const guardianEnabled = automatic(configuredReviewer) || automatic(current.approvalsReviewer) || requiredReview;
  const reason = requiredReview ? 'Automatic review is required for this model.' : 'Restricted by permission requirements.';
  const choice = (id: string, label: string, description: string, profile: string, enabled: boolean,
    policy?: ApprovalPolicy, approvalsReviewer?: ApprovalsReviewer, fullAccess = false): ComposerPermissionChoice => ({
    id, label, description, allowed: enabled, reason: enabled ? '' : reason, fullAccess,
    patch: { permissionProfileId: profile, sandboxMode: undefined,
      ...(policy === undefined ? {} : { approvalPolicy: policy }), ...(approvalsReviewer === undefined ? {} : { approvalsReviewer }) },
  });
  const currentPolicy = current.approvalPolicy ?? (inherited ? inherited.approvalPolicy : configuredPolicy);
  const currentReviewer = current.approvalsReviewer ?? (inherited ? inherited.approvalsReviewer : configuredReviewer);
  const currentProfile = current.permissionProfileId;
  const currentMode = current.sandboxMode ?? (currentProfile ? modes[currentProfile] : inherited ? inherited.sandboxMode : configuredMode);
  const permitsReviewer = currentReviewer != null && (allows('allowedApprovalsReviewers', currentReviewer)
    || automatic(currentReviewer) && (required.allowedApprovalsReviewers || []).some(automatic));
  const advancedAllowed = (mode: SandboxMode | undefined, policy: ApprovalPolicy | undefined, profile?: string) =>
    isSandboxMode(mode) && isApprovalPolicy(policy) && (!requiredReview || automatic(currentReviewer)) && permitsReviewer && allows('allowedApprovalPolicies', policy)
    && allows('allowedSandboxModes', mode) && (profile ? profileAllowed(profile) : required.allowedPermissionProfiles == null);
  const advanced = (id: string, label: string, patch: Partial<SubmitOptions>, enabled: boolean, fullAccess: boolean): ComposerPermissionChoice => ({
    id, label, description: '', patch, allowed: enabled, reason: enabled ? '' : reason, fullAccess,
  });
  const defaultPolicy = inherited ? inherited.approvalPolicy : config.approval_policy;
  const defaultMode = inherited ? inherited.sandboxMode : config.sandbox_mode;
  const workspace = config.sandbox_workspace_write;
  const workspaceValid = workspace == null || isRecord(workspace)
    && Object.keys(workspace).every(key => ['writable_roots', 'network_access', 'exclude_tmpdir_env_var', 'exclude_slash_tmp'].includes(key))
    && (workspace.writable_roots == null || Array.isArray(workspace.writable_roots) && workspace.writable_roots.every(root => typeof root === 'string'))
    && ['network_access', 'exclude_tmpdir_env_var', 'exclude_slash_tmp'].every(key => (workspace as Record<string, unknown>)[key] == null
      || typeof (workspace as Record<string, unknown>)[key] === 'boolean');
  const workspaceCustom = !!workspace?.network_access || !!workspace?.writable_roots?.length
    || !!workspace?.exclude_tmpdir_env_var || !!workspace?.exclude_slash_tmp;
  const standardConfig = configuredMode === 'danger-full-access' && configuredPolicy === 'never' && configuredReviewer === 'user'
    || configuredMode === 'read-only' && configuredPolicy === 'on-request' && configuredReviewer === 'user'
    || configuredMode === 'workspace-write' && (configuredPolicy === 'on-request' || samePolicy(configuredPolicy, granular)) && workspaceValid && !workspaceCustom;
  const representableConfig = isSandboxMode(configuredMode) && isApprovalPolicy(configuredPolicy)
    && (configuredMode !== 'workspace-write' || workspaceValid && !workspaceCustom);
  const configAllowed = representableConfig && !requiredReview && required.allowedPermissionProfiles == null
    && allows('allowedSandboxModes', configuredMode) && allows('allowedApprovalPolicies', configuredPolicy)
    && allows('allowedApprovalsReviewers', configuredReviewer);
  return [
    choice('ask', 'Ask for approval', askProfile === ':read-only' ? 'Read only until approved' : 'Ask before actions outside the workspace', askProfile,
      !requiredReview && allowed(askProfile, askPolicy, 'user'), askPolicy, 'user'),
    choice('guardian', 'Automatic review', 'Review additional permission requests automatically', ':workspace',
      guardianEnabled && allowed(':workspace', 'on-request', reviewer), 'on-request', reviewer),
    choice('full-access', 'Full access', 'Access files and the internet without approval', ':danger-full-access',
      !requiredReview && allowed(':danger-full-access', 'never', 'user'), 'never', 'user', true),
    ...profiles.filter(profile => !profile.id.startsWith(':')).map(profile => choice('profile:' + profile.id, profile.id,
      profile.description || 'Permission profile', profile.id, !requiredReview && profileAllowed(profile.id))),
    ...(!standardConfig && (config.approval_policy != null || config.sandbox_mode != null) ? [{
      ...advanced('config', 'Custom (config.toml)', { permissionProfileId: undefined, sandboxMode: configuredMode,
        approvalPolicy: configuredPolicy, approvalsReviewer: configuredReviewer }, configAllowed, configuredMode === 'danger-full-access'),
      description: 'Use the current directory configuration',
      reason: representableConfig ? (configAllowed ? '' : reason) : 'Additional filesystem or network rules cannot be preserved by this composer.',
      resolved: JSON.stringify([configuredMode, configuredPolicy, configuredReviewer, workspace]),
    }] : []),
    ...(['read-only', 'workspace-write', 'danger-full-access'] as const).map(mode => advanced('sandbox:' + mode, mode,
      { sandboxMode: mode, permissionProfileId: undefined }, advancedAllowed(mode, currentPolicy), mode === 'danger-full-access')),
    { ...advanced('sandbox:default', '', { sandboxMode: undefined, permissionProfileId: undefined },
      isSandboxMode(defaultMode) && (defaultMode !== 'workspace-write' || workspaceValid && !workspaceCustom)
        && advancedAllowed(defaultMode, currentPolicy), defaultMode === 'danger-full-access'), resolved: JSON.stringify([defaultMode, workspace]) },
    ...(['untrusted', 'on-request', 'never'] as const).map(policy => advanced('policy:' + policy, policy,
      { approvalPolicy: policy }, advancedAllowed(currentMode, policy, currentProfile), policy === 'never' && currentMode === 'danger-full-access')),
    { ...advanced('policy:default', '', { approvalPolicy: undefined },
      isApprovalPolicy(defaultPolicy) && advancedAllowed(currentMode, defaultPolicy, currentProfile),
      defaultPolicy === 'never' && currentMode === 'danger-full-access'), resolved: JSON.stringify(defaultPolicy) },
  ];
}
