import type { WorkspaceIdentity } from './catalog.ts';

// sessionKey is a non-secret host generation, not a token or token derivative.
export interface AgentScope { hostId: string; identity: WorkspaceIdentity; sessionKey: string | number }
export type AgentCapability = 'hermes_admin' | 'hermes_write' | 'hermes_read_config' | string;
export interface AgentIconValue { name: string; color: string }
export interface AgentStarter { icon: string; title: string; short_description: string; prompt: string; source: string; [key: string]: unknown }
export interface AgentFields {
  name: string;
  tagline: string;
  description: string;
  instructions: string;
  icon: AgentIconValue;
  modelSpec: ({ name?: string; reasoning_effort?: string; [key: string]: unknown }) | null;
  starterPrompts: AgentStarter[];
  skills: unknown[];
  tools: Record<string, unknown>;
  persistentFolder?: string | null;
  fileTreeId?: string | null;
  apiDeployments?: unknown;
  slackDeployments?: unknown;
}
export interface AgentEditorDraft {
  scope: AgentScope;
  agentId: string;
  // A missing snapshot prevents writes until a fresh draft has been loaded.
  revision: string | number | null;
  fields: AgentFields;
  dirty: boolean;
  published: boolean;
  hasUnpublishedChanges: boolean;
  capability: AgentCapability;
}
export interface AgentDetail {
  agentId: string;
  capability: AgentCapability;
  creatorName: string | null;
  isPrivateToCreator: boolean;
  isPinned: boolean | null;
  published: null | {
    name: string;
    description: string;
    tagline: string;
    icon: AgentIconValue | null;
    starterPrompts: AgentStarter[];
    connectors: unknown[];
    persistentFolder: string | null;
  };
}
export interface AgentConversation {
  id: string;
  title: string;
  status: string | null;
  responding: boolean;
  updatedAt: string | null;
  source: string | null;
}
export interface AgentScheduledRun { id: string; nextRunAt: string; description: string | null }
export interface AgentActivityPage {
  items: AgentConversation[];
  scheduled: AgentScheduledRun[];
  nextCursor: string | null;
  warnings: string[];
}
export interface AgentModelOption { name: string; label: string; efforts: string[] }
export type AgentModels = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; items: AgentModelOption[] };
export type AgentShareCapability = 'hermes_read_config' | 'hermes_write';
export interface AgentRecipient { kind: 'users' | 'groups'; id: string; name: string; secondary: string | null }
export interface AgentPermissionEntry extends AgentRecipient { capability: AgentShareCapability | 'hermes_admin' }
export interface AgentPermissions {
  workspace: { workspaceId: string; capability: AgentShareCapability | null; storeVisible: boolean } | null;
  entries: AgentPermissionEntry[];
}
export type AgentSharingUpdate =
  | { workspace: { workspace_id: string; capability: 'hermes_read_config' | null; store_visible: boolean } }
  | { users?: Record<string, AgentShareCapability | null>; groups?: Record<string, AgentShareCapability | null> };
export type AgentChange = AgentScope & { operationId: string } & (
  | { kind: 'create'; fields: AgentFields }
  | { kind: 'save' | 'publish'; agentId: string; revision: string | number | null; fields: AgentFields }
  | { kind: 'duplicate'; agentId: string; name: string }
  | { kind: 'delete'; agentId: string }
  | { kind: 'pin'; agentId: string; pinned: boolean }
  | { kind: 'share'; agentId: string; update: AgentSharingUpdate; inviteRevision?: number }
);
export type AgentReceipt =
  | { operationId: string; state: 'confirmed'; agentId: string; revision?: string | number | null }
  | { operationId: string; state: 'rejected' | 'conflict' | 'unknown'; message: string };
export interface AgentReconciliation { pending: boolean; resolved: { change: AgentChange; receipt: AgentReceipt }[] }
export interface AgentMutationPorts {
  // These ports are backed by the host's durable, identity-scoped operation ledger.
  hasUnresolvedChanges: boolean;
  // Required for recovery; the host reauthorizes the original owner after session changes.
  unresolvedOperationIds?: readonly string[];
  isCurrent: (scope: AgentScope) => boolean;
  onChange?: (change: AgentChange) => Promise<AgentReceipt>;
  // Read-only reconciliation returns the original change with each verified receipt.
  onCheckChanges?: (scope: AgentScope) => Promise<AgentReconciliation>;
  // Update the saved baseline without replacing any newer local draft.
  onConfirmed?: (change: AgentChange, receipt: Extract<AgentReceipt, { state: 'confirmed' }>) => void | Promise<void>;
}

export function blankAgentFields(): AgentFields {
  return { name: '', tagline: '', description: '', instructions: '', skills: [], modelSpec: null,
    tools: { connectors: [] }, icon: { name: 'bloop', color: 'blue' }, starterPrompts: [] };
}
export function canViewAgentConfig(capability: AgentCapability): boolean {
  return capability === 'hermes_admin' || capability === 'hermes_write' || capability === 'hermes_read_config';
}
export function canEditAgent(capability: AgentCapability): boolean {
  return capability === 'hermes_admin' || capability === 'hermes_write';
}
export function validAgentScope(scope: AgentScope | null): scope is AgentScope {
  return !!scope && typeof scope.hostId === 'string' && !!scope.hostId && !!scope.identity &&
    typeof scope.identity.accountId === 'string' && !!scope.identity.accountId && typeof scope.identity.userId === 'string' && !!scope.identity.userId &&
    (typeof scope.sessionKey === 'string' && !!scope.sessionKey || typeof scope.sessionKey === 'number' && Number.isFinite(scope.sessionKey));
}
export function isAgentScopeCurrent(ports: AgentMutationPorts, scope: AgentScope): boolean {
  try { return ports.isCurrent(scope) === true; } catch { return false; }
}
export function agentError(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause); }
