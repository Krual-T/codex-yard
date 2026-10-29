import type { ApprovalPolicy, PermissionRequirements, SandboxMode, SandboxPolicy, SessionConfig } from '../../../lib/codex-protocol.ts';
import { automaticReviewer, permissionCatalog, permissionConstraints, sandboxPolicyForConfig } from '../../../lib/permissions.ts';
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

const modes: Readonly<Record<string, SandboxMode | undefined>> = {
  ':workspace': 'workspace-write', ':read-only': 'read-only', ':danger-full-access': 'danger-full-access',
};
export const isCyberModel = (model: string) => {
  const name = model.toLowerCase();
  return name.includes('cyber') || name.includes('daybreak');
};
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const isSandboxMode = (value: unknown): value is SandboxMode => value === 'read-only' || value === 'workspace-write' || value === 'danger-full-access';
const isApprovalPolicy = (value: unknown): value is ApprovalPolicy => value === 'untrusted' || value === 'on-request' || value === 'never'
  || isRecord(value) && isRecord(value.granular) && ['sandbox_approval', 'rules', 'skill_approval', 'request_permissions', 'mcp_elicitations']
    .every(key => typeof (value.granular as Record<string, unknown>)[key] === 'boolean');
const policyMode = (policy?: SandboxPolicy): SandboxMode | undefined => policy?.type === 'workspaceWrite' ? 'workspace-write'
  : policy?.type === 'readOnly' ? 'read-only' : policy?.type === 'dangerFullAccess' ? 'danger-full-access' : undefined;

export function permissionConfigFrom(value: unknown): SessionConfig {
  if (!isRecord(value)) throw new Error('Invalid permission configuration');
  if (value.sandbox_mode != null && !isSandboxMode(value.sandbox_mode)
    || value.approval_policy != null && !isApprovalPolicy(value.approval_policy)
    || value.approvals_reviewer != null && !['user', 'auto_review', 'guardian_subagent'].includes(String(value.approvals_reviewer))) {
    throw new Error('Invalid permission configuration');
  }
  if (value.sandbox_mode === 'workspace-write' && (!Object.hasOwn(value, 'sandbox_workspace_write') || value.sandbox_workspace_write === undefined)) {
    throw new Error('Workspace permission details are unavailable from this host.');
  }
  const workspace = value.sandbox_workspace_write;
  if (workspace != null && (!isRecord(workspace)
    || Object.keys(workspace).some(key => !['writable_roots', 'network_access', 'exclude_tmpdir_env_var', 'exclude_slash_tmp'].includes(key))
    || !Array.isArray(workspace.writable_roots) || workspace.writable_roots.some(root => typeof root !== 'string')
    || ['network_access', 'exclude_tmpdir_env_var', 'exclude_slash_tmp'].some(key => typeof workspace[key] !== 'boolean'))) {
    throw new Error('Invalid workspace permission configuration');
  }
  return value as SessionConfig;
}

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

/** Loads scoped inputs for the same catalog used by the host. */
export async function loadComposerPermissions(client: WorkbenchClient, hostId: string, cwd: string,
  model: string | undefined, current: SubmitOptions, projectless: boolean, inherited?: SubmitOptions): Promise<ComposerPermissionChoice[]> {
  const [configResponse, requirementsResponse] = await Promise.all([
    client.rpc('config/read', { includeLayers: false, cwd }, hostId), client.rpc('configRequirements/read', {}, hostId),
  ]);
  if (!isRecord(configResponse) || !isRecord(configResponse.config) || !isRecord(requirementsResponse)
    || !Object.hasOwn(requirementsResponse, 'requirements')) throw new Error('Invalid permission configuration response');
  const config = permissionConfigFrom(configResponse.config);
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
  const requirementModel = model || (inherited ? undefined : config.model);
  if (required.autoReview?.requiredOnModels?.length && !requirementModel) throw new Error('The current model is not confirmed; permission requirements cannot be evaluated.');
  const { profileAllowed, allows, permitsReviewer, requiredReview } = permissionConstraints(profiles, required, requirementModel || undefined);
  const configuredPolicy = config.approval_policy ?? 'on-request';
  const configuredMode = config.sandbox_mode ?? 'read-only';
  const reason = requiredReview ? 'Automatic review is required for this model.' : 'Restricted by permission requirements.';
  const presets = permissionCatalog({ config, profiles, requirements: required, cwd, model: requirementModel || undefined, projectless,
    current: { approvalsReviewer: current.approvalsReviewer } }).map(choice => {
    const labels: Record<string, string> = { ask: 'Ask for approval', guardian: 'Automatic review', 'full-access': 'Full access', config: 'Custom (config.toml)' };
    const descriptions: Record<string, string> = { ask: choice.native.permissions === ':read-only' ? 'Read only until approved' : 'Ask before actions outside the workspace',
      guardian: 'Review additional permission requests automatically', 'full-access': 'Access files and the internet without approval', config: 'Use the current directory configuration' };
    const native = choice.native;
    const patch: Partial<SubmitOptions> = native.permissions
      ? { permissionProfileId: native.permissions, sandboxMode: undefined, sandboxPolicy: undefined }
      : { permissionProfileId: undefined, sandboxMode: policyMode(native.sandboxPolicy), sandboxPolicy: structuredClone(native.sandboxPolicy) };
    if (native.approvalPolicy !== undefined) patch.approvalPolicy = structuredClone(native.approvalPolicy);
    if (native.approvalsReviewer !== undefined) patch.approvalsReviewer = native.approvalsReviewer;
    return { id: choice.id, label: labels[choice.id] ?? choice.label, description: descriptions[choice.id] ?? choice.description,
      allowed: choice.allowed, reason: choice.allowed ? '' : reason, fullAccess: choice.fullAccess, patch,
      ...(choice.id === 'config' ? { resolved: JSON.stringify(native) } : {}) } satisfies ComposerPermissionChoice;
  });
  const currentPolicy = current.approvalPolicy ?? (inherited ? inherited.approvalPolicy : configuredPolicy);
  const currentReviewer = current.approvalsReviewer ?? (inherited ? inherited.approvalsReviewer : config.approvals_reviewer ?? 'user');
  const currentProfile = current.permissionProfileId;
  const currentMode = current.sandboxMode ?? policyMode(current.sandboxPolicy) ?? (currentProfile ? modes[currentProfile] : inherited ? inherited.sandboxMode : configuredMode);
  const advancedAllowed = (mode: SandboxMode | undefined, policy: ApprovalPolicy | undefined, profile?: string) =>
    isSandboxMode(mode) && isApprovalPolicy(policy) && (!requiredReview || automaticReviewer(currentReviewer)) && currentReviewer != null && permitsReviewer(currentReviewer) && allows('allowedApprovalPolicies', policy)
    && allows('allowedSandboxModes', mode) && (profile ? profileAllowed(profile) : required.allowedPermissionProfiles == null);
  const advanced = (id: string, label: string, patch: Partial<SubmitOptions>, enabled: boolean, fullAccess: boolean): ComposerPermissionChoice => ({
    id, label, description: '', patch, allowed: enabled, reason: enabled ? '' : reason, fullAccess,
  });
  const defaultPolicy = inherited ? inherited.approvalPolicy : config.approval_policy;
  const defaultMode = (inherited ? inherited.sandboxMode : config.sandbox_mode) ?? undefined;
  const defaultSandbox = inherited ? inherited.sandboxPolicy : sandboxPolicyForConfig(config);
  const defaultProfile = inherited?.permissionProfileId;
  const defaultPatch: Partial<SubmitOptions> = defaultProfile
    ? { permissionProfileId: defaultProfile, sandboxMode: undefined, sandboxPolicy: undefined }
    : { permissionProfileId: undefined, sandboxMode: defaultMode, sandboxPolicy: defaultSandbox && structuredClone(defaultSandbox) };
  return [
    ...presets,
    ...(['read-only', 'workspace-write', 'danger-full-access'] as const).map(mode => advanced('sandbox:' + mode, mode,
      { sandboxMode: mode, sandboxPolicy: undefined, permissionProfileId: undefined }, advancedAllowed(mode, currentPolicy), mode === 'danger-full-access')),
    { ...advanced('sandbox:default', '', defaultPatch, advancedAllowed(defaultMode, currentPolicy, defaultProfile),
      defaultMode === 'danger-full-access'), resolved: JSON.stringify([defaultMode, defaultSandbox, defaultProfile]) },
    ...(['untrusted', 'on-request', 'never'] as const).map(policy => advanced('policy:' + policy, policy,
      { approvalPolicy: policy }, advancedAllowed(currentMode, policy, currentProfile), policy === 'never' && currentMode === 'danger-full-access')),
    { ...advanced('policy:default', '', { approvalPolicy: undefined },
      isApprovalPolicy(defaultPolicy) && advancedAllowed(currentMode, defaultPolicy, currentProfile),
      defaultPolicy === 'never' && currentMode === 'danger-full-access'), resolved: JSON.stringify(defaultPolicy) },
  ];
}
