import { isDeepStrictEqual } from 'node:util';
import type { ApprovalPolicy, ApprovalsReviewer, PermissionProfile, PermissionRequirements,
  SandboxMode, SandboxPolicy, SessionConfig, SessionSettings } from './codex-protocol.ts';

const granular: ApprovalPolicy = { granular: { sandbox_approval: false, rules: false, skill_approval: false,
  request_permissions: true, mcp_elicitations: true } };
const automatic = (reviewer: ApprovalsReviewer | null | undefined) => reviewer === 'auto_review' || reviewer === 'guardian_subagent';
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

// Keep native arguments on the server. Only view fields are sent to the page.
export function permissionCatalog({ config, profiles, requirements, cwd, model, projectless = false, current = {} }: CatalogInput): PermissionChoice[] {
  const required = requirements || {};
  const profileAllowed = (id: string) => profiles.some(profile => profile.id === id && profile.allowed)
    && (required.allowedPermissionProfiles == null || required.allowedPermissionProfiles[id] === true);
  const allows = (key: 'allowedSandboxModes' | 'allowedApprovalPolicies' | 'allowedApprovalsReviewers', value: unknown) =>
    required[key] == null || required[key].some(entry => isDeepStrictEqual(entry, value));
  const requiredReview = required.autoReview?.requiredOnModels?.includes(model || config.model || '') === true;
  const allowed = (profile: string, policy: ApprovalPolicy, reviewer: ApprovalsReviewer) => profileAllowed(profile)
    && allows('allowedSandboxModes', modeFor(profile)) && allows('allowedApprovalPolicies', policy)
    && (allows('allowedApprovalsReviewers', reviewer) || automatic(reviewer)
      && (required.allowedApprovalsReviewers || []).some(automatic));
  const configReviewer = automatic(config.approvals_reviewer) ? config.approvals_reviewer ?? 'user' : 'user';
  const configPolicy = config.approval_policy ?? 'on-request';
  const configMode = config.sandbox_mode ?? 'read-only';
  const workspace = config.sandbox_workspace_write;
  const configSandbox: ConfigSandbox = configMode === 'danger-full-access' ? { type: 'dangerFullAccess' }
    : configMode === 'workspace-write' ? { type: 'workspaceWrite', writableRoots: [cwd, ...(workspace?.writable_roots || [])],
      networkAccess: workspace?.network_access ?? false, excludeTmpdirEnvVar: workspace?.exclude_tmpdir_env_var ?? false,
      excludeSlashTmp: workspace?.exclude_slash_tmp ?? false } : { type: 'readOnly', networkAccess: false };
  let askProfile = configMode === 'read-only' && profileAllowed(':read-only') ? ':read-only' : ':workspace';
  let askPolicy: ApprovalPolicy = (projectless || isDeepStrictEqual(configPolicy, granular)) && allowed(askProfile, granular, 'user') ? granular : 'on-request';
  if (!allowed(askProfile, askPolicy, 'user') && allowed(':read-only', 'on-request', 'user')) {
    askProfile = ':read-only'; askPolicy = 'on-request';
  }
  const reviewer = configReviewer === 'auto_review' || (required.allowedApprovalsReviewers || []).includes('auto_review') ? 'auto_review' : 'guardian_subagent';
  const guardianEnabled = automatic(configReviewer) || automatic(current.approvalsReviewer) || requiredReview;
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
    || configMode === 'workspace-write' && (configPolicy === 'on-request' || isDeepStrictEqual(configPolicy, granular))
      && !workspace?.network_access && !workspace?.writable_roots?.length && !workspace?.exclude_tmpdir_env_var && !workspace?.exclude_slash_tmp;
  if (!standardConfig && (config.approval_policy != null || config.sandbox_mode != null)) {
    add('config', '自定义（config.toml）', '使用当前目录配置中的权限',
      { sandboxPolicy: configSandbox, approvalPolicy: configPolicy, approvalsReviewer: configReviewer },
      !requiredReview && required.allowedPermissionProfiles == null && allows('allowedSandboxModes', configMode)
        && allows('allowedApprovalPolicies', configPolicy) && allows('allowedApprovalsReviewers', configReviewer), configMode === 'danger-full-access');
  }
  return choices;
}

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

export function permissionStart(choice: PermissionChoice) {
  const { sandboxPolicy, ...native } = choice.native;
  return sandboxPolicy ? { ...native, sandbox: ({ readOnly: 'read-only', workspaceWrite: 'workspace-write', dangerFullAccess: 'danger-full-access' })[sandboxPolicy.type] } : native;
}
