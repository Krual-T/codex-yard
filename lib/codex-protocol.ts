// Host-consumed projections of codex-cli 0.163.0's exported app-server protocol
// (InitializeResponse, v2/{Config,ConfigRequirements,Thread,Turn,...}). Extra
// protocol fields stay opaque; this is not a replacement for the renderer SDK.
export type RpcId = string | number;
export type ApprovalPolicy = 'untrusted' | 'on-request' | 'never' | {
  granular: { sandbox_approval: boolean; rules: boolean; skill_approval: boolean;
    request_permissions: boolean; mcp_elicitations: boolean };
};
export type ApprovalsReviewer = 'user' | 'auto_review' | 'guardian_subagent';
export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';
export type SandboxPolicy = { type: 'dangerFullAccess' }
  | { type: 'readOnly'; networkAccess: boolean }
  | { type: 'externalSandbox'; networkAccess: 'restricted' | 'enabled' }
  | { type: 'workspaceWrite'; writableRoots: string[]; networkAccess: boolean;
      excludeTmpdirEnvVar: boolean; excludeSlashTmp: boolean };

export interface SessionConfig {
  model?: string | null;
  model_provider?: string | null;
  model_reasoning_effort?: string | null;
  approval_policy?: ApprovalPolicy | null;
  approvals_reviewer?: ApprovalsReviewer | null;
  sandbox_mode?: SandboxMode | null;
  service_tier?: string | null;
  default_permissions?: string | null;
  sandbox_workspace_write?: {
    writable_roots?: string[]; network_access?: boolean;
    exclude_tmpdir_env_var?: boolean; exclude_slash_tmp?: boolean;
  } | null;
}
export interface PermissionRequirements {
  allowedPermissionProfiles?: Record<string, boolean | undefined> | null;
  allowedSandboxModes?: SandboxMode[] | null;
  allowedApprovalPolicies?: ApprovalPolicy[] | null;
  allowedApprovalsReviewers?: ApprovalsReviewer[] | null;
  autoReview?: { requiredOnModels?: string[] | null } | null;
}
export interface PermissionProfile { id: string; allowed: boolean; description?: string | null }
export interface ModelSummary { id: string; isDefault: boolean }
export interface SessionSettings {
  model: string | null;
  modelProvider: string | null;
  reasoningEffort: string | null;
  approvalPolicy: ApprovalPolicy | null;
  sandboxMode: SandboxMode | 'external-sandbox' | null;
  serviceTier: string | null;
  approvalsReviewer?: ApprovalsReviewer | null;
  permissionProfileId?: string | null;
  collaborationMode?: 'plan' | 'default';
}
export interface ThreadSettingsResponse {
  model?: string | null;
  modelProvider?: string | null;
  reasoningEffort?: string | null;
  approvalPolicy?: ApprovalPolicy | null;
  serviceTier?: string | null;
  approvalsReviewer?: ApprovalsReviewer | null;
  sandbox?: SandboxPolicy;
  activePermissionProfile?: { id: string } | null;
  collaborationMode?: string | { mode: string } | null;
}
export interface ThreadItemSummary extends Record<string, unknown> { id: string; type: string }
export interface TurnSummary {
  id: string;
  items: ThreadItemSummary[];
  itemsView?: 'full' | 'summary' | 'notLoaded';
  status: 'completed' | 'interrupted' | 'failed' | 'inProgress';
  error?: { message: string; codexErrorInfo?: unknown; additionalDetails?: string | null } | null;
}
export interface ThreadSummary {
  id: string;
  name: string | null;
  cwd: string;
  turns: TurnSummary[];
  status: { type: 'idle' | 'notLoaded' | 'systemError' } | { type: 'active'; activeFlags: string[] };
}
export interface InitializeResponse { userAgent: string; codexHome?: string; platformFamily?: string; platformOs?: string }
export interface Page<T> { data: T[]; nextCursor: string | null }
export interface ThreadResponse extends ThreadSettingsResponse { thread: ThreadSummary }

// Declaration merging may add host-specific methods. Dynamic forwarding remains
// unknown, and callers of newer methods can supply an explicit response type.
export interface RpcResponses {
  initialize: InitializeResponse;
  'config/read': { config: SessionConfig; origins?: unknown; layers?: unknown };
  'configRequirements/read': { requirements: PermissionRequirements | null };
  'permissionProfile/list': Page<PermissionProfile>;
  'model/list': Page<ModelSummary>;
  'thread/read': ThreadResponse;
  'thread/start': ThreadResponse;
  'thread/resume': ThreadResponse;
  'thread/fork': ThreadResponse;
  'thread/list': Page<ThreadSummary>;
  'thread/loaded/list': Page<string>;
  'thread/name/set': Record<string, never>;
  'thread/archive': Record<string, never>;
  'turn/start': { turn: TurnSummary };
  'turn/interrupt': Record<string, never>;
}
export interface RpcMessage { id?: RpcId; method: string; params: unknown; seq: number }
export interface RpcResult<T> { result: T; eventCursor: number }
export type LateRpcTerminal = { outcome: 'success'; result: unknown; eventCursor?: number }
  | { outcome: 'error'; error: { message: string; code?: string | number; data?: unknown } };
export interface RequestOptions {
  mutating?: boolean;
  timeoutMs?: number;
  /** Observe this connection's original reply after the caller's timeout, never a disconnect. */
  onLateTerminal?: (terminal: LateRpcTerminal) => void | Promise<void>;
  /** Keep a durable write's original observer until its reply or socket disconnect. */
  retainLateUntilDisconnect?: true;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function errorMessage(error: unknown): string {
  return isRecord(error) && typeof error.message === 'string' ? error.message : String(error);
}
