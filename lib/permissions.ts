import type { ApprovalPolicy, ApprovalsReviewer, PermissionProfile, PermissionRequirements,
  SandboxMode, SandboxPolicy, SessionConfig, SessionSettings } from './codex-protocol.ts';

const granular: ApprovalPolicy = { granular: { sandbox_approval: false, rules: false, skill_approval: false,
  request_permissions: true, mcp_elicitations: true } };
export const automaticReviewer = (reviewer: ApprovalsReviewer | null | undefined) => reviewer === 'auto_review' || reviewer === 'guardian_subagent';
function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((value, index) => sameValue(value, right[index]));
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) || Array.isArray(right)) return false;
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && sameValue(a[key], b[key]));
}
const builtinModes: Readonly<Record<string, SandboxMode | undefined>> = {
  ':workspace': 'workspace-write', ':read-only': 'read-only', ':danger-full-access': 'danger-full-access',
};
const modeFor = (id?: string) => id === undefined ? undefined : builtinModes[id];

export interface PermissionCatalogOptions { model?: string; projectless?: boolean; current?: Partial<SessionSettings> }
type ConfigSandbox = Exclude<SandboxPolicy, { type: 'externalSandbox' }>;
export type NativePermission = {
  approvalPolicy?: ApprovalPolicy;
  approvalsReviewer?: ApprovalsReviewer;
} & ({ permissions: string; sandboxPolicy?: never } | { permissions?: never; sandboxPolicy: ConfigSandbox });
export interface PermissionChoice {
  id: string; label: string; description: string; allowed: boolean;
  disabledReason: string; fullAccess: boolean; native: NativePermission;
}
interface CatalogInput extends PermissionCatalogOptions {
  config: SessionConfig; profiles: readonly PermissionProfile[];
  requirements?: PermissionRequirements | null; cwd: string;
}

/** Shared interpretation of the daemon's permission requirements. */
export function permissionConstraints(profiles: readonly PermissionProfile[], requirements: PermissionRequirements | null | undefined, model?: string) {
  const required = requirements || {};
  const profileAllowed = (id: string) => profiles.some(profile => profile.id === id && profile.allowed)
    && (required.allowedPermissionProfiles == null || required.allowedPermissionProfiles[id] === true);
  const allows = (key: 'allowedSandboxModes' | 'allowedApprovalPolicies' | 'allowedApprovalsReviewers', value: unknown) =>
    required[key] == null || required[key].some(entry => sameValue(entry, value));
  const permitsReviewer = (reviewer: ApprovalsReviewer) => allows('allowedApprovalsReviewers', reviewer)
    || automaticReviewer(reviewer) && (required.allowedApprovalsReviewers || []).some(automaticReviewer);
  return { profileAllowed, allows, permitsReviewer,
    requiredReview: required.autoReview?.requiredOnModels?.includes(model || '') === true };
}

export function sandboxPolicyForConfig(config: SessionConfig): ConfigSandbox {
  const workspace = config.sandbox_workspace_write;
  return config.sandbox_mode === 'danger-full-access' ? { type: 'dangerFullAccess' }
    : config.sandbox_mode === 'workspace-write' ? { type: 'workspaceWrite', writableRoots: [...(workspace?.writable_roots || [])],
      networkAccess: workspace?.network_access ?? false, excludeTmpdirEnvVar: workspace?.exclude_tmpdir_env_var ?? false,
      excludeSlashTmp: workspace?.exclude_slash_tmp ?? false } : { type: 'readOnly', networkAccess: false };
}

export function permissionCatalog({ config, profiles, requirements, model, projectless = false, current = {} }: CatalogInput): PermissionChoice[] {
  const required = requirements || {};
  const { profileAllowed, allows, permitsReviewer, requiredReview } = permissionConstraints(profiles, required, model || config.model || undefined);
  const allowed = (profile: string, policy: ApprovalPolicy, reviewer: ApprovalsReviewer) => profileAllowed(profile)
    && allows('allowedSandboxModes', modeFor(profile)) && allows('allowedApprovalPolicies', policy)
    && permitsReviewer(reviewer);
  const configReviewer = automaticReviewer(config.approvals_reviewer) ? config.approvals_reviewer ?? 'user' : 'user';
  const configPolicy = config.approval_policy ?? 'on-request';
  const configMode = config.sandbox_mode ?? 'read-only';
  const workspace = config.sandbox_workspace_write;
  const configSandbox = sandboxPolicyForConfig(config);
  let askProfile = configMode === 'read-only' && profileAllowed(':read-only') ? ':read-only' : ':workspace';
  let askPolicy: ApprovalPolicy = (projectless || sameValue(configPolicy, granular)) && allowed(askProfile, granular, 'user') ? granular : 'on-request';
  if (!allowed(askProfile, askPolicy, 'user') && allowed(':read-only', 'on-request', 'user')) {
    askProfile = ':read-only'; askPolicy = 'on-request';
  }
  const reviewer = configReviewer === 'auto_review' || (required.allowedApprovalsReviewers || []).includes('auto_review') ? 'auto_review' : 'guardian_subagent';
  const guardianEnabled = automaticReviewer(configReviewer) || automaticReviewer(current.approvalsReviewer) || requiredReview;
  const choices: PermissionChoice[] = [];
  function add(id: string, label: string, description: string, native: NativePermission, enabled: boolean, fullAccess = false) {
    const restriction = !enabled ? requiredReview && id !== 'guardian' ? '当前模型要求自动审查'
      : id === 'guardian' && !guardianEnabled ? '当前配置未启用自动审查' : '受管理员权限要求限制' : '';
    choices.push({ id, label, description, allowed: enabled, disabledReason: restriction, fullAccess, native });
  }
  add('ask', '请求审批', askProfile === ':read-only' ? '保持只读，修改文件或访问网络前请求批准' : '修改工作区外的文件或访问网络前请求批准',
    { permissions: askProfile, approvalPolicy: askPolicy, approvalsReviewer: 'user' }, !requiredReview && allowed(askProfile, askPolicy, 'user'));
  add('guardian', '自动审查', '由 Codex 审查额外权限请求，可能不安全的操作再询问你',
    { permissions: ':workspace', approvalPolicy: 'on-request', approvalsReviewer: reviewer },
    guardianEnabled && allowed(':workspace', 'on-request', reviewer));
  add('full-access', '完全访问', '不受限制地访问电脑文件和网络',
    { permissions: ':danger-full-access', approvalPolicy: 'never', approvalsReviewer: 'user' },
    !requiredReview && allowed(':danger-full-access', 'never', 'user'), true);
  for (const profile of profiles.filter(profile => !profile.id.startsWith(':'))) {
    add('profile:' + profile.id, profile.id, profile.description || '使用此权限配置', { permissions: profile.id },
      !requiredReview && profileAllowed(profile.id));
  }
  const standardConfig = configMode === 'danger-full-access' && configPolicy === 'never' && configReviewer === 'user'
    || configMode === 'read-only' && configPolicy === 'on-request' && configReviewer === 'user'
    || configMode === 'workspace-write' && configReviewer === 'user' && (configPolicy === 'on-request' || sameValue(configPolicy, granular))
      && !workspace?.network_access && !workspace?.writable_roots?.length && !workspace?.exclude_tmpdir_env_var && !workspace?.exclude_slash_tmp;
  if (!standardConfig && (config.approval_policy != null || config.sandbox_mode != null)) {
    add('config', '自定义（config.toml）', '使用当前目录配置中的权限',
      { sandboxPolicy: configSandbox, approvalPolicy: configPolicy, approvalsReviewer: configReviewer },
      !requiredReview && required.allowedPermissionProfiles == null && allows('allowedSandboxModes', configMode)
        && allows('allowedApprovalPolicies', configPolicy) && allows('allowedApprovalsReviewers', configReviewer), configMode === 'danger-full-access');
  }
  return choices;
}

// The legacy public view does not disclose native argument details.
export function publicPermissions(choices: readonly PermissionChoice[]) {
  return choices.map(({ native, ...choice }) => ({ ...choice,
    ...(native.permissions ? { permissionProfileId: native.permissions } : {}),
    ...(modeFor(native.permissions) ? { sandboxMode: modeFor(native.permissions) } : {}),
    ...(native.approvalPolicy ? { approvalPolicy: native.approvalPolicy } : {}),
    ...(native.approvalsReviewer ? { approvalsReviewer: native.approvalsReviewer } : {}),
  }));
}

export function nonFullAccessChoice(choices: readonly PermissionChoice[]) {
  return ['guardian', 'ask'].map(id => choices.find(choice => choice.id === id && choice.allowed && !choice.fullAccess)).find(Boolean) || null;
}

/** Preserve the legacy mode-only result unless the caller opts into complete thread/start parameters. */
export function permissionStart(choice: PermissionChoice, options?: { preserveSandboxPolicy?: boolean }) {
  const { sandboxPolicy, ...native } = choice.native;
  if (!sandboxPolicy) return native;
  if (options?.preserveSandboxPolicy) return { ...native, ...sandboxPolicyThreadStart(sandboxPolicy) };
  return { ...native, sandbox: ({ readOnly: 'read-only', workspaceWrite: 'workspace-write', dangerFullAccess: 'danger-full-access' })[sandboxPolicy.type] };
}

/** Translate only policies expressible by thread/start without losing restrictions. */
export function sandboxPolicyThreadStart(policy: SandboxPolicy): Record<string, unknown> {
  const only = (allowed: string[]) => Object.keys(policy).every(key => allowed.includes(key));
  if (policy.type === 'dangerFullAccess' && only(['type'])) return { sandbox: 'danger-full-access' };
  if (policy.type === 'readOnly' && policy.networkAccess === false && only(['type', 'networkAccess'])) return { sandbox: 'read-only' };
  if (policy.type === 'workspaceWrite' && only(['type', 'writableRoots', 'networkAccess', 'excludeTmpdirEnvVar', 'excludeSlashTmp'])
    && Array.isArray(policy.writableRoots) && policy.writableRoots.every(root => typeof root === 'string')
    && typeof policy.networkAccess === 'boolean' && typeof policy.excludeTmpdirEnvVar === 'boolean' && typeof policy.excludeSlashTmp === 'boolean') {
    return { sandbox: 'workspace-write', config: { sandbox_workspace_write: {
      writable_roots: [...policy.writableRoots], network_access: policy.networkAccess,
      exclude_tmpdir_env_var: policy.excludeTmpdirEnvVar, exclude_slash_tmp: policy.excludeSlashTmp,
    } } };
  }
  throw new Error('This sandbox policy cannot be safely represented when starting a new thread.');
}
