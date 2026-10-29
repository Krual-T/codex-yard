export interface WorkspaceIdentity {
  accountId: string;
  userId: string;
}

export type AgentView = 'recent' | 'owned' | 'directory';

export interface WorkspaceAgent {
  id: string;
  icon: unknown;
  name: string;
  description: string;
  tagline: string;
  creatorName: string | null;
  published: boolean;
  storeVisible: boolean;
  isPublic: boolean;
  updatedAt: string | null;
  lastUsedAt: string | null;
  attentionStatus: string | null;
  recentRunStatus: string | null;
  recentRunUpdatedAt: string | null;
}

export interface WorkspaceAgentPage {
  items: WorkspaceAgent[];
  nextCursor: string | null;
}

export interface WorkspaceAgentDetail {
  agentId: string;
  creatorName: string | null;
  isPinned: boolean | null;
  latestPublishedVersion: {
    name: string;
    description: string;
    tagline: string;
    icon: unknown;
    starterPrompts: { title: string; shortDescription: string }[];
  } | null;
}

export interface LoadWorkspaceAgents {
  hostId: string;
  identity: WorkspaceIdentity;
  view: AgentView;
  query: string;
  cursor: string | null;
  limit: 50;
  signal: AbortSignal;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

export function workspaceAgentPage(value: unknown): WorkspaceAgentPage {
  if (!record(value) || !Array.isArray(value.items) || !nullableString(value.nextCursor) || value.nextCursor === '') {
    throw new Error('Invalid workspace agent page');
  }
  for (const item of value.items) {
    if (!record(item) || !('icon' in item) || typeof item.id !== 'string' || !item.id.trim() ||
      typeof item.name !== 'string' || typeof item.description !== 'string' || typeof item.tagline !== 'string' ||
      !nullableString(item.creatorName) || typeof item.published !== 'boolean' ||
      typeof item.storeVisible !== 'boolean' || typeof item.isPublic !== 'boolean' ||
      !nullableString(item.updatedAt) || !nullableString(item.lastUsedAt) || !nullableString(item.attentionStatus) ||
      !nullableString(item.recentRunStatus) || !nullableString(item.recentRunUpdatedAt)) {
      throw new Error('Invalid workspace agent');
    }
  }
  return value as unknown as WorkspaceAgentPage;
}

export function workspaceAgentDetail(value: unknown, agentId: string): WorkspaceAgentDetail {
  if (!record(value) || value.agentId !== agentId || !nullableString(value.creatorName) ||
    !(typeof value.isPinned === 'boolean' || value.isPinned === null)) throw new Error('Invalid agent detail');
  const version = value.latestPublishedVersion;
  if (version !== null && (!record(version) || !('icon' in version) || typeof version.name !== 'string' ||
    typeof version.description !== 'string' || typeof version.tagline !== 'string' || !Array.isArray(version.starterPrompts) ||
    version.starterPrompts.some((prompt: unknown) => !record(prompt) || typeof prompt.title !== 'string' || typeof prompt.shortDescription !== 'string'))) {
    throw new Error('Invalid published agent');
  }
  return value as unknown as WorkspaceAgentDetail;
}
